import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import test from 'node:test'
import { Readable } from 'node:stream'
import { withDefaults } from '../config-store.js'
import { handleApi, MUTATING_METHODS } from '../local-api.js'

function mockReq(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const bodyStr = body !== undefined ? JSON.stringify(body) : ''
  const stream = new Readable({
    read() {
      if (bodyStr) this.push(Buffer.from(bodyStr))
      this.push(null)
    },
  }) as unknown as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = {
    host: '127.0.0.1:3080',
    ...headers,
  }
  return stream
}

function mockRes(): ServerResponse & { _status: number, _body: string, _json: any } {
  const res = {
    statusCode: 200,
    _status: 200,
    _body: '',
    _json: null,
    setHeader() {},
    end(chunk?: string | Buffer) {
      this._status = this.statusCode
      this._body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      try {
        this._json = JSON.parse(this._body)
      } catch {
        this._json = null
      }
    },
  }
  return res as unknown as ServerResponse & { _status: number, _body: string, _json: any }
}

test('Issue #33: MUTATING_METHODS strictly blocks non-POST (GET/PUT/DELETE) with 405', async () => {
  const cfg = withDefaults({})
  const mutatingList = ['install', 'uninstall', 'pluginInstall', 'catalogInstall', 'catalogSummon', 'catalogUninstall', 'pluginRestart']

  for (const m of mutatingList) {
    const req = mockReq('GET', `/api?method=${m}&slug=test-skill`, {
      origin: 'http://127.0.0.1:3080',
    })
    const res = mockRes()
    await handleApi(req, res, cfg)
    assert.equal(res._status, 405, `GET ${m} should return 405 Method Not Allowed`)
    assert.match(res._json?.error || '', /Method Not Allowed/i)
  }
})

test('Issue #33: Cross-site / malicious origin mutating requests return 403 Forbidden', async () => {
  const cfg = withDefaults({})
  const mutatingList = ['install', 'uninstall', 'pluginInstall', 'catalogInstall', 'catalogSummon', 'catalogUninstall', 'pluginRestart']

  for (const m of mutatingList) {
    // 1. Cross-site via Sec-Fetch-Site
    const reqCross = mockReq('POST', '/api', {
      'sec-fetch-site': 'cross-site',
      origin: 'http://127.0.0.1:3080',
    }, { method: m, slug: 'test-skill' })
    const resCross = mockRes()
    await handleApi(reqCross, resCross, cfg)
    assert.equal(resCross._status, 403, `POST ${m} with sec-fetch-site: cross-site must return 403`)

    // 2. Malicious Origin
    const reqEvil = mockReq('POST', '/api', {
      origin: 'https://attacker.evil.com',
    }, { method: m, slug: 'test-skill' })
    const resEvil = mockRes()
    await handleApi(reqEvil, resEvil, cfg)
    assert.equal(resEvil._status, 403, `POST ${m} with evil origin must return 403`)
  }
})

test('Issue #33: Same-origin mutating POST requests pass security checks', async () => {
  const cfg = withDefaults({})
  // Valid origin calling install with missing slug -> returns 400 (application error, not 403/405)
  const req = mockReq('POST', '/api', {
    origin: 'http://127.0.0.1:3080',
  }, { method: 'install', slug: '' })
  const res = mockRes()
  await handleApi(req, res, cfg)
  assert.equal(res._status, 400, 'Same-origin install without slug should pass security and reach application logic (400)')
  assert.equal(res._json?.ok, false)
  assert.match(res._json?.error || '', /缺少 slug/)
})

test('Issue #33: Read-only operations allow GET and return 200', async () => {
  const cfg = withDefaults({})
  const readList = ['list', 'plugins', 'pluginCategories', 'experts', 'connectors']

  for (const m of readList) {
    const req = mockReq('GET', `/api?method=${m}`)
    const res = mockRes()
    await handleApi(req, res, cfg)
    assert.equal(res._status, 200, `GET ${m} should be allowed and return 200`)
    assert.equal(res._json?.ok, true)
  }
})
