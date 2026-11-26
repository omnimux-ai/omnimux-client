import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withDefaults } from '../config-store.js'
import { handleApi, setSkillsRuntimeProvider } from '../local-api.js'
import { readSessionTrial, renderAttachedTrialSection } from '../session-attach.js'

function mockRes(): ServerResponse & { _status: number, _body: string } {
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

function postReq(payload: Record<string, unknown>): IncomingMessage {
  return {
    method: 'POST',
    url: '/omnimux-market',
    headers: {
      origin: 'http://127.0.0.1:3080',
      host: '127.0.0.1:3080',
    },
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(payload))
    },
  } as unknown as IncomingMessage
}

test('tryAttach loads bundled skill into the session without writing skills dir', async () => {
  const home = mkdtempSync(join(tmpdir(), 'omx-try-'))
  const skillsDir = join(home, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const cfg = withDefaults({ skillsDir, timeoutMs: 5000, userAgent: 't' })
    const req = postReq({
      method: 'tryAttach',
      sessionId: 'sess-try-1',
      slug: 'replicate-carousel',
      catalogId: 'sk-omx-replicate-carousel',
      title: '图文复刻',
    })
    const res = mockRes()
    await handleApi(req, res, cfg)
    assert.equal(res._status, 200, res._body)
    const body = JSON.parse(res._body)
    assert.equal(body.ok, true)
    assert.equal(body.attached, true)
    assert.equal(body.installed, false)
    assert.equal(body.hasBody, true)
    const trial = readSessionTrial(home, 'sess-try-1')
    assert.ok(trial)
    assert.equal(trial.slug, 'replicate-carousel')
    assert.ok(trial.body.length > 0)
    const leftover = existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => !n.startsWith('.')) : []
    assert.deepEqual(leftover, [])
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
})

test('tryAttach resolves all 4 homepage quick shortcuts & bundled SOP skills offline without instruction body unavailable (#235)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'omx-try-shortcuts-'))
  const skillsDir = join(home, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    // Point apiBase to an unreachable port to prove zero reliance on remote SkillHub fallback
    const cfg = withDefaults({ skillsDir, apiBase: 'http://127.0.0.1:1', timeoutMs: 500, userAgent: 't' })
    const targets = [
      { slug: 'replicate-viral-video', title: '复刻爆款视频' },
      { slug: 'video-hook-analysis', title: '拆解视频' },
      { slug: 'create-selling-video', title: '创作带货视频' },
      { slug: 'reverse-video-prompt', title: '视频转提示词' },
      { slug: 'omnimux-ecom-market-research', title: '分析类目市场' },
    ]
    for (const target of targets) {
      const sessionId = `sess-${target.slug}`
      const req = postReq({
        method: 'tryAttach',
        sessionId,
        slug: target.slug,
        title: target.title,
      })
      const res = mockRes()
      await handleApi(req, res, cfg)
      assert.equal(res._status, 200, `${target.slug}: ${res._body}`)
      const body = JSON.parse(res._body)
      assert.equal(body.ok, true, target.slug)
      assert.equal(body.attached, true, target.slug)
      assert.equal(body.hasBody, true, `${target.slug} must resolve real SKILL.md locally offline`)
      const trial = readSessionTrial(home, sessionId)
      assert.ok(trial && trial.body.trim().length > 100, `${target.slug} trial body must be non-empty`)
      const rendered = renderAttachedTrialSection(home, sessionId)
      assert.equal(
        rendered.includes('instruction body is unavailable'),
        false,
        `${target.slug} must never fall back to instruction body is unavailable`,
      )
    }
    const leftover = existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => !n.startsWith('.')) : []
    assert.deepEqual(leftover, [])
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
})

test('handleSkillList reports live non-catalog providerSlugs and tryAttach resolves ctx.skills provider bodies (#235)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'omx-try-provider-'))
  const skillsDir = join(home, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  setSkillsRuntimeProvider({
    async list() {
      return [
        { name: 'remote-uninstalled-card', provider: 'omnimux-catalog' },
        { name: 'provider-only-skill', provider: 'omnimux-inspiration' },
      ]
    },
    async get(slug) {
      if (slug === 'provider-only-skill') {
        return { content: '# Provider Only Skill\n\nLive runtime content.' }
      }
      return undefined
    },
  })
  try {
    const cfg = withDefaults({ skillsDir, apiBase: 'http://127.0.0.1:1', timeoutMs: 500, userAgent: 't' })

    const listRes = mockRes()
    await handleApi(postReq({ method: 'list' }), listRes, cfg)
    assert.equal(listRes._status, 200, listRes._body)
    const listBody = JSON.parse(listRes._body)
    assert.equal(listBody.ok, true)
    assert.deepEqual(listBody.providerSlugs, ['provider-only-skill'])

    const attachRes = mockRes()
    await handleApi(postReq({
      method: 'tryAttach',
      sessionId: 'sess-provider-1',
      slug: 'provider-only-skill',
      title: 'Provider Only Skill',
    }), attachRes, cfg)
    assert.equal(attachRes._status, 200, attachRes._body)
    const attachBody = JSON.parse(attachRes._body)
    assert.equal(attachBody.hasBody, true)
    const trial = readSessionTrial(home, 'sess-provider-1')
    assert.match(trial?.body || '', /Live runtime content/)
  } finally {
    setSkillsRuntimeProvider(null)
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
})
