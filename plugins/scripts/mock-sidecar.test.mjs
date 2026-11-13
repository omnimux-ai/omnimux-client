import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { computeRequestHash, MockSidecar, sanitizeHeaders } from './mock-sidecar.mjs'

describe('mock sidecar (record & replay infrastructure)', () => {
  it('sanitizes sensitive authorization and api keys in headers', () => {
    const raw = {
      'Authorization': 'Bearer secret_pat_12345',
      'x-api-key': 'sk-99999999',
      'Content-Type': 'application/json',
      'User-Agent': 'omnimux-agent',
    }
    const clean = sanitizeHeaders(raw)
    assert.equal(clean['Authorization'], '[REDACTED]')
    assert.equal(clean['x-api-key'], '[REDACTED]')
    assert.equal(clean['Content-Type'], 'application/json')
    assert.equal(clean['User-Agent'], 'omnimux-agent')
  })

  it('computes deterministic request hash for method, url, and body', () => {
    const h1 = computeRequestHash('POST', 'https://api.example.com/v1/generate', '{"prompt":"hello"}')
    const h2 = computeRequestHash('POST', 'https://api.example.com/v1/generate', '{"prompt":"hello"}')
    const h3 = computeRequestHash('GET', 'https://api.example.com/v1/generate', '{"prompt":"hello"}')
    assert.equal(h1, h2)
    assert.notEqual(h1, h3)
  })

  it('records live response in record mode and saves sanitized cassette', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mock-sidecar-test-'))
    const sidecar = new MockSidecar({ mode: 'record', cassettesDir: tempDir })

    const fakeFetch = async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { result: 'video_rendered_ok', duration: 5.4 },
    })

    const reqInfo = {
      method: 'POST',
      url: 'https://api.omnimux.internal/render',
      headers: { 'Authorization': 'Bearer secret-key' },
      body: JSON.stringify({ shotId: 's01' }),
    }

    const res = await sidecar.execute(fakeFetch, reqInfo)
    assert.equal(res.status, 200)
    assert.equal(res.body.result, 'video_rendered_ok')
    assert.equal(res.fromMock, false)
    assert.equal(sidecar.recordedCount, 1)

    // Verify written cassette
    const hash = computeRequestHash(reqInfo.method, reqInfo.url, reqInfo.body)
    assert.equal(sidecar.hasCassette(hash), true)
    const cassette = sidecar.readCassette(hash)
    assert.equal(cassette.request.headers.Authorization, '[REDACTED]')
    assert.deepEqual(cassette.response.body, { result: 'video_rendered_ok', duration: 5.4 })

    // Now test Replay mode
    const replaySidecar = new MockSidecar({ mode: 'replay', cassettesDir: tempDir })
    const replayed = await replaySidecar.execute(() => {
      throw new Error('Should not make live call in replay mode')
    }, reqInfo)

    assert.equal(replayed.status, 200)
    assert.equal(replayed.body.result, 'video_rendered_ok')
    assert.equal(replayed.fromMock, true)
    assert.equal(replaySidecar.replayedCount, 1)

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('fails fast on replay miss with descriptive error message', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mock-sidecar-miss-'))
    const sidecar = new MockSidecar({ mode: 'replay', cassettesDir: tempDir })

    await assert.rejects(
      async () => {
        await sidecar.execute(() => {}, { method: 'GET', url: 'https://unknown.host/missing' })
      },
      (err) => {
        assert.ok(err.message.includes('[MockSidecar:ReplayMiss]'))
        return true
      },
    )

    rmSync(tempDir, { recursive: true, force: true })
  })
})
