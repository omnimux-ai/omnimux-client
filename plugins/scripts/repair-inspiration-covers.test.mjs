import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { applyRepair, planRepair, rollbackRepair } from './repair-inspiration-covers.mjs'

const HOST = 'http://127.0.0.1:45120'
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempFile() {
  const root = mkdtempSync(join(tmpdir(), 'repair-covers-'))
  roots.push(root)
  return join(root, 'plan.json')
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function response({ status = 200, json, type = 'application/json', length = null, bytes = [1, 2, 3] }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? type : name.toLowerCase() === 'content-length' ? length : null },
    body: { async cancel() {} },
    async json() { return clone(json) },
    async arrayBuffer() { return Uint8Array.from(bytes).buffer },
  }
}

function createHarness(options = {}) {
  let current = {
    id: options.recordId ?? 145,
    type: 'video',
    title: 'Original title',
    content: 'Original content',
    source_url: 'https://www.tiktok.com/@creator/video/123?sync=seed#fragment',
    cover_key: 'https://p16-sign.tiktokcdn-us.com/expired.jpeg?x-expires=1',
    media_keys: ['clips/original.mp4'],
    analysis: { hook: 'keep me' },
    tags: ['demo'],
    updated_at: '2026-09-01T00:00:00Z',
  }
  const calls = []
  let failPatch = Boolean(options.failPatch)
  const upload = options.upload || {
    key: 'covers/2026/09/stable.jpg',
    url: '/omnimux/inspiration/media/covers/2026/09/stable.jpg',
    content_type: 'image/jpeg',
    size: 3,
    storage: 'r2',
  }
  async function fetch(url, init = {}) {
    const method = init.method || 'GET'
    const parsed = new URL(url)
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
    if (parsed.hostname === 'www.tiktok.com' && parsed.pathname === '/oembed') {
      assert.equal(parsed.searchParams.get('url'), 'https://www.tiktok.com/@creator/video/123')
      return response({ json: { thumbnail_url: 'https://thumb.example/fresh.jpg' } })
    }
    if (url === 'https://thumb.example/fresh.jpg') return response({ type: 'image/jpeg', length: '3' })
    if (parsed.origin !== HOST) throw new Error(`unexpected URL ${url}`)
    if (parsed.pathname === '/omnimux/inspiration/media' && method === 'POST') {
      return response({ json: { success: true, data: upload } })
    }
    if (parsed.pathname.startsWith('/omnimux/inspiration/media/') && method === 'GET') {
      return response({ type: options.verifiedType || 'image/jpeg', bytes: options.verifiedBytes || [1, 2, 3] })
    }
    if (parsed.pathname === '/omnimux/inspiration/145' && method === 'GET') {
      return response({ json: { success: true, data: current } })
    }
    if (parsed.pathname === '/omnimux/inspiration/145' && method === 'PATCH') {
      if (failPatch) {
        failPatch = false
        throw new Error('connection lost during PATCH')
      }
      current = { ...current, ...JSON.parse(init.body), updated_at: '2026-09-05T12:00:00Z', ...(options.patchMutation || {}) }
      return response({ json: { success: true, data: current } })
    }
    throw new Error(`unexpected ${method} ${url}`)
  }
  return {
    deps: { fetch, now: () => '2026-09-05T10:00:00Z' },
    calls,
    get current() { return clone(current) },
    set current(value) { current = clone(value) },
  }
}

async function makePlan(harness, file = tempFile()) {
  await planRepair({ host: HOST, ids: ['145'], file }, harness.deps)
  harness.calls.length = 0
  return file
}

describe('inspiration cover repair', () => {
  it('plans with GETs only and preserves the full original record in a private file', async () => {
    const harness = createHarness()
    const file = tempFile()
    await planRepair({ host: HOST, ids: ['145'], file }, harness.deps)

    assert.deepEqual(new Set(harness.calls.map((call) => call.method)), new Set(['GET']))
    const document = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(document.plan.items['145'].record, harness.current)
    assert.equal(document.plan.items['145'].original_cover_key, harness.current.cover_key)
    assert.equal(document.plan.items['145'].candidate.canonical_url, 'https://www.tiktok.com/@creator/video/123')
    assert.equal(document.plan.items['145'].candidate.content_type, 'image/jpeg')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    await assert.rejects(() => planRepair({ host: HOST, ids: ['145'], file }, harness.deps), /overwrite existing plan/)
  })

  it('refuses a changed record before any network write', async () => {
    const harness = createHarness()
    const file = await makePlan(harness)
    harness.current = { ...harness.current, title: 'Changed elsewhere' }

    await assert.rejects(() => applyRepair({ file }, harness.deps), /conflict/)
    assert.equal(harness.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false)
  })

  it('requires positive numeric ids and rejects a mismatched detail response', async () => {
    const file = tempFile()
    const harness = createHarness()
    await assert.rejects(() => planRepair({ host: HOST, ids: ['0'], file }, harness.deps), /positive numeric ids/)
    assert.equal(harness.calls.length, 0)

    const wrongRecord = createHarness({ recordId: 999 })
    await assert.rejects(() => planRepair({ host: HOST, ids: ['145'], file }, wrongRecord.deps), /returned record id 999/)
  })

  it('uploads, verifies, and patches only cover_key while preserving every other field', async () => {
    const harness = createHarness()
    const original = harness.current
    const file = await makePlan(harness)
    await applyRepair({ file, host: HOST, ids: ['145'] }, harness.deps)

    const upload = harness.calls.find((call) => call.method === 'POST')
    assert.deepEqual(upload.body, { url: 'https://thumb.example/fresh.jpg', kind: 'cover' })
    const patch = harness.calls.find((call) => call.method === 'PATCH')
    assert.deepEqual(patch.body, { cover_key: 'covers/2026/09/stable.jpg' })
    const { cover_key, updated_at, ...unchanged } = harness.current
    const { cover_key: _oldCover, updated_at: _oldTime, ...expected } = original
    assert.equal(cover_key, 'covers/2026/09/stable.jpg')
    assert.equal(updated_at, '2026-09-05T12:00:00Z')
    assert.deepEqual(unchanged, expected)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).state.phase, 'applied')
  })

  it('rejects an unsafe or empty upload before PATCH', async () => {
    const harness = createHarness({ upload: { key: 'https://cdn.example/new.jpg', content_type: 'image/jpeg', size: 3, storage: 'r2' } })
    const file = await makePlan(harness)

    await assert.rejects(() => applyRepair({ file }, harness.deps), /unsafe or non-persistent key/)
    assert.equal(harness.calls.some((call) => call.method === 'PATCH'), false)
    const document = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(document.state.failure.id, '145')
    assert.equal(document.state.items['145'].status, 'uploaded_unverified')
    assert.equal(document.state.items['145'].upload.key, 'https://cdn.example/new.jpg')
  })

  it('detects changes to nested non-media fields after PATCH', async () => {
    const harness = createHarness({ patchMutation: { analysis: { hook: 'keep me', updated_at: 'nested mutation' } } })
    const file = await makePlan(harness)
    await assert.rejects(() => applyRepair({ file }, harness.deps), /non-media fields changed/)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).state.phase, 'failed')
  })

  it('journals a verified upload before PATCH and resumes without another upload', async () => {
    const harness = createHarness({ failPatch: true })
    const file = await makePlan(harness)
    await assert.rejects(() => applyRepair({ file }, harness.deps), /connection lost/)

    let document = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(document.state.items['145'].status, 'uploaded')
    assert.equal(document.state.items['145'].upload.key, 'covers/2026/09/stable.jpg')
    assert.equal(document.state.phase, 'failed')
    harness.calls.length = 0
    await applyRepair({ file }, harness.deps)
    assert.equal(harness.calls.filter((call) => call.method === 'POST').length, 0)
    assert.equal(harness.calls.filter((call) => call.method === 'PATCH').length, 1)

    harness.calls.length = 0
    await applyRepair({ file }, harness.deps)
    assert.equal(harness.calls.filter((call) => call.method === 'POST' || call.method === 'PATCH').length, 0)
    document = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(document.state.phase, 'applied')
  })

  it('rolls back only while the applied key and non-media fields still match', async () => {
    const harness = createHarness()
    const originalCover = harness.current.cover_key
    const file = await makePlan(harness)
    await applyRepair({ file }, harness.deps)
    harness.calls.length = 0
    await rollbackRepair({ file }, harness.deps)

    assert.equal(harness.current.cover_key, originalCover)
    assert.deepEqual(harness.calls.filter((call) => call.method === 'PATCH').map((call) => call.body), [{ cover_key: originalCover }])
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).state.phase, 'rolled_back')

    const second = createHarness()
    const secondFile = await makePlan(second)
    await applyRepair({ file: secondFile }, second.deps)
    second.current = { ...second.current, cover_key: 'covers/other.jpg' }
    await assert.rejects(() => rollbackRepair({ file: secondFile }, second.deps), /does not have the applied cover key/)
    assert.equal(second.calls.filter((call) => call.method === 'PATCH').length, 1)
  })
})
