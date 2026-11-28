import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withDefaults } from '../config-store.js'
import { loadCatalog } from '../expert/catalog.js'
import { clearHttpJsonCache, configureHttpJsonCache } from '../http.js'
import { installSkill } from '../install.js'
import { handleApi } from '../local-api.js'
import { catalogItemToCard } from '../skill-aggregate.js'
import { clearEvalScoreMemo } from '../skill-detail.js'

function mockRes(): ServerResponse & { _status: number, _body: string } {
  const chunks: Buffer[] = []
  const res = {
    statusCode: 200,
    _status: 200,
    _body: '',
    setHeader() {},
    end(chunk?: string | Buffer) {
      this._status = this.statusCode
      this._body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    },
  }
  return res as unknown as ServerResponse & { _status: number, _body: string }
}

test('search returns before ratings resolve (does not await attachRatings)', async () => {
  clearHttpJsonCache()
  clearEvalScoreMemo()
  configureHttpJsonCache({ ttlMs: 0 })
  let evalCalls = 0
  let releaseEval = () => {}
  const blocked = new Promise<void>((resolve) => { releaseEval = resolve })
  const orig = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/skills?')) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          total: 1,
          skills: [{
            slug: 'slow-rating-skill',
            name: 'Slow',
            description: 'x',
            category: 'ai-agent',
            downloads: 1,
            stars: 0,
            installs: 0,
            version: '1.0.0',
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/evaluation')) {
      evalCalls += 1
      await blocked
      return new Response(JSON.stringify({
        dimensions: { trust: { items: { a: { score: 5 } } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('nope', { status: 404 })
  }
  try {
    const cfg = withDefaults({ skillsDir: '/tmp/omnimux-market-no-skills', timeoutMs: 5000, userAgent: 't' })
    const req = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method: 'search', query: 'slow', limit: 1, channels: ['skillhub'] }))
      },
    } as unknown as IncomingMessage
    const res = mockRes()
    const started = Date.now()
    await handleApi(req, res, cfg)
    const elapsed = Date.now() - started
    assert.equal(res._status, 200)
    const body = JSON.parse(res._body)
    assert.equal(body.ok, true)
    assert.equal(body.items[0].slug, 'slow-rating-skill')
    assert.equal(body.items[0].rating, undefined)
    // Would hang forever if search awaited attachRatings; we resolved under 2s.
    assert.ok(elapsed < 2000, `search blocked too long: ${elapsed}ms`)
    // Background attach may or may not have started; unblock so the promise settles.
    releaseEval()
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(evalCalls >= 0)
  } finally {
    globalThis.fetch = orig
    releaseEval()
    clearHttpJsonCache()
    clearEvalScoreMemo()
    configureHttpJsonCache({ ttlMs: 90_000 })
  }
})

test('ratings method returns scores independently', async () => {
  clearEvalScoreMemo()
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    dimensions: {
      trust: { items: { a: { score: 5 } } },
      reliability: { items: { a: { score: 4 } } },
      adaptability: { items: { a: { score: 4 } } },
      convention: { items: { a: { score: 4 } } },
      effectiveness: { items: { a: { score: 5 } } },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const cfg = withDefaults({ skillsDir: '/tmp/omnimux-market-no-skills', timeoutMs: 5000, userAgent: 't' })
    const req = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method: 'ratings', slugs: ['slow-rating-skill'] }))
      },
    } as unknown as IncomingMessage
    const res = mockRes()
    await handleApi(req, res, cfg)
    const body = JSON.parse(res._body)
    assert.equal(body.ok, true)
    assert.equal(typeof body.ratings['slow-rating-skill'], 'number')
  } finally {
    globalThis.fetch = orig
    clearEvalScoreMemo()
  }
})

test('skillContent and exploreFile alias resolve bundled catalog skill and return structure', async () => {
  const cfg = withDefaults({ skillsDir: '/tmp/omnimux-market-no-skills', timeoutMs: 5000, userAgent: 't' })
  for (const method of ['skillContent', 'exploreFile']) {
    const req = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method, slug: 'replicate-carousel' }))
      },
    } as unknown as IncomingMessage
    const res = mockRes()
    await handleApi(req, res, cfg)
    assert.equal(res._status, 200)
    const body = JSON.parse(res._body)
    assert.equal(body.ok, true)
    assert.equal(body.found, true)
    assert.ok(Array.isArray(body.tree))
    assert.ok(typeof body.skillMd === 'string' && body.skillMd.length > 0)
  }
})

test('skillTab method returns requested tab payload', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    versions: [{ version: '1.0.0', changelog: 'Init release', createdAt: Date.now() }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const cfg = withDefaults({ skillsDir: '/tmp/omnimux-market-no-skills', timeoutMs: 5000, userAgent: 't' })
    const req = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method: 'skillTab', slug: 'demo', tab: 'versions' }))
      },
    } as unknown as IncomingMessage
    const res = mockRes()
    await handleApi(req, res, cfg)
    assert.equal(res._status, 200)
    const body = JSON.parse(res._body)
    assert.equal(body.ok, true)
    assert.equal(body.tab, 'versions')
    assert.ok(Array.isArray(body.versions))
  } finally {
    globalThis.fetch = orig
  }
})

test('plugin-sourced skills resolve skillContent/exploreFile, install without copying to skillsDir, and project preinstalled card state', async () => {
  const emptySkillsDir = mkdtempSync(join(tmpdir(), 'omx-plugin-skill-test-'))
  try {
    const cfg = withDefaults({ skillsDir: emptySkillsDir, timeoutMs: 5000, userAgent: 't' })

    for (const method of ['skillContent', 'exploreFile']) {
      const req = {
        method: 'POST',
        url: '/omnimux-market',
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from(JSON.stringify({ method, slug: 'clip-craft' }))
        },
      } as unknown as IncomingMessage
      const res = mockRes()
      await handleApi(req, res, cfg)
      assert.equal(res._status, 200)
      const body = JSON.parse(res._body)
      assert.equal(body.ok, true)
      assert.equal(body.found, true)
      assert.ok(Array.isArray(body.tree) && body.tree.some((f: { name: string }) => f.name === 'SKILL.md'))
      assert.ok(typeof body.skillMd === 'string' && body.skillMd.includes('clip-craft'))
    }

    const catalog = loadCatalog()
    const pluginItem = catalog.items.find((item) => item.skill === 'clip-craft' && item.source?.type === 'plugin')
    assert.ok(pluginItem, 'clip-craft should exist with source.type = plugin')
    const card = catalogItemToCard(pluginItem, 'custom', cfg, new Set())
    assert.equal(card.installed, true)
    assert.equal(card.preinstalled, true)

    const installed = await installSkill('clip-craft', cfg)
    assert.equal(installed.slug, 'clip-craft')
    assert.ok(installed.path.includes('omnimux-clip'))
    assert.deepEqual(readdirSync(emptySkillsDir), [], 'zero-copy plugin skill must not copy files into cfg.skillsDir')
  } finally {
    rmSync(emptySkillsDir, { recursive: true, force: true })
  }
})

test('external SeaLeap skills search by platform/keyword, detail skips remote fetch, and skillContent reports honest external state', async () => {
  const prevHome = process.env.DSH_HOME
  const tmpHome = mkdtempSync(join(tmpdir(), 'omx-sealeap-api-test-'))
  const skillsDir = join(tmpHome, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  process.env.DSH_HOME = tmpHome
  const origFetch = globalThis.fetch
  let remoteFetchCalled = false
  globalThis.fetch = async () => {
    remoteFetchCalled = true
    throw new Error('unexpected remote SkillHub call for local external catalog item')
  }
  try {
    const cfg = withDefaults({
      skillsDir,
      aggregateChannels: ['custom', 'workbuddy'],
      timeoutMs: 5000,
      userAgent: 't',
    })

    // 1. Search by Chinese platform keyword 美客多
    const searchReq = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method: 'search', query: '美客多' }))
      },
    } as unknown as IncomingMessage
    const searchRes = mockRes()
    await handleApi(searchReq, searchRes, cfg)
    assert.equal(searchRes._status, 200)
    const searchBody = JSON.parse(searchRes._body)
    assert.equal(searchBody.ok, true)
    assert.ok(searchBody.items.some((i: { subtitle?: string; origin?: string; license?: string; author?: string }) => (
      i.subtitle === '美客多' && i.origin === 'third-party' && i.license === 'MIT' && i.author === 'SeaLeap'
    )))

    // 2. Detail skips remote fetch for third-party git item
    remoteFetchCalled = false
    const detailReq = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({
          method: 'detail',
          slug: 'sealeap-ozon-mpstats-data-audit',
          catalogId: 'sk-sealeap-ozon-mpstats-data-audit',
        }))
      },
    } as unknown as IncomingMessage
    const detailRes = mockRes()
    await handleApi(detailReq, detailRes, cfg)
    assert.equal(detailRes._status, 200)
    const detailBody = JSON.parse(detailRes._body)
    assert.equal(detailBody.card.subtitle, 'OZON')
    assert.equal(detailBody.card.license, 'MIT')
    assert.equal(detailBody.card.installed, false)
    assert.equal(remoteFetchCalled, false)

    // 3. Uninstalled skillContent returns external metadata honestly
    const contentBeforeReq = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method: 'skillContent', slug: 'sealeap-ozon-mpstats-data-audit' }))
      },
    } as unknown as IncomingMessage
    const contentBeforeRes = mockRes()
    await handleApi(contentBeforeReq, contentBeforeRes, cfg)
    const contentBefore = JSON.parse(contentBeforeRes._body)
    assert.equal(contentBefore.ok, true)
    assert.equal(contentBefore.found, false)
    assert.equal(contentBefore.external, true)
    assert.equal(contentBefore.catalog.subtitle, 'OZON')

    // 4. After writing local SKILL.md, skillContent returns found=true and real SKILL.md
    const destDir = join(skillsDir, 'sealeap-ozon-mpstats-data-audit')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, 'SKILL.md'), '---\nname: sealeap-ozon-mpstats-data-audit\n---\n\n# Real OZON Doc\n', 'utf8')
    const contentAfterReq = {
      method: 'POST',
      url: '/omnimux-market',
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ method: 'skillContent', slug: 'sealeap-ozon-mpstats-data-audit' }))
      },
    } as unknown as IncomingMessage
    const contentAfterRes = mockRes()
    await handleApi(contentAfterReq, contentAfterRes, cfg)
    const contentAfter = JSON.parse(contentAfterRes._body)
    assert.equal(contentAfter.ok, true)
    assert.equal(contentAfter.found, true)
    assert.ok(String(contentAfter.skillMd).includes('Real OZON Doc'))
  } finally {
    globalThis.fetch = origFetch
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(tmpHome, { recursive: true, force: true })
  }
})

