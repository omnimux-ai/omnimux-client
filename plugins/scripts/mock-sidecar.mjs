#!/usr/bin/env node
/**
 * scripts/mock-sidecar.mjs
 * OmniMux E2E AI & Storage Record/Replay Mock Sidecar
 *
 * Modes (OMNIMUX_MOCK_MODE):
 *   - 'record': Executes live requests, masks secrets, records cassettes to disk.
 *   - 'replay': Intercepts requests and serves matching recorded cassettes (offline CI).
 *   - 'passthrough': Directly passes requests through without recording or mocking.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CASSETTES_DIR = join(__dirname, '..', 'tests', 'fixtures', 'cassettes')

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'dsh-pat',
])

export function sanitizeHeaders(headers = {}) {
  const clean = {}
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (SENSITIVE_HEADERS.has(lower)) {
      clean[key] = '[REDACTED]'
    } else {
      clean[key] = val
    }
  }
  return clean
}

export function computeRequestHash(method, url, body = '') {
  const hash = createHash('sha256')
  hash.update(`${String(method).toUpperCase()} ${url}\n`)
  if (body) {
    if (typeof body === 'string') hash.update(body)
    else if (Buffer.isBuffer(body)) hash.update(body)
    else hash.update(JSON.stringify(body))
  }
  return hash.digest('hex').slice(0, 24)
}

export class MockSidecar {
  constructor(opts = {}) {
    this.mode = opts.mode || process.env.OMNIMUX_MOCK_MODE || 'replay'
    this.cassettesDir = opts.cassettesDir || DEFAULT_CASSETTES_DIR
    this.recordedCount = 0
    this.replayedCount = 0
  }

  cassettePath(reqHash) {
    return join(this.cassettesDir, `${reqHash}.json`)
  }

  hasCassette(reqHash) {
    return existsSync(this.cassettePath(reqHash))
  }

  readCassette(reqHash) {
    const file = this.cassettePath(reqHash)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }

  writeCassette(reqHash, cassette) {
    mkdirSync(this.cassettesDir, { recursive: true })
    const file = this.cassettePath(reqHash)
    writeFileSync(file, JSON.stringify(cassette, null, 2) + '\n', 'utf8')
    this.recordedCount++
  }

  async execute(requestFn, reqInfo) {
    const { method = 'GET', url, headers = {}, body = '' } = reqInfo
    const reqHash = computeRequestHash(method, url, body)

    // Mode 1: Replay
    if (this.mode === 'replay') {
      const cassette = this.readCassette(reqHash)
      if (!cassette) {
        throw new Error(
          `[MockSidecar:ReplayMiss] No cassette found for ${method} ${url} (hash: ${reqHash}). Run with OMNIMUX_MOCK_MODE=record first.`,
        )
      }
      this.replayedCount++
      return {
        status: cassette.response.status,
        headers: cassette.response.headers,
        body: cassette.response.body,
        fromMock: true,
      }
    }

    // Mode 2: Passthrough
    if (this.mode === 'passthrough') {
      return await requestFn()
    }

    // Mode 3: Record
    const response = await requestFn()
    const cassette = {
      hash: reqHash,
      recordedAt: new Date().toISOString(),
      request: {
        method,
        url,
        headers: sanitizeHeaders(headers),
        body: typeof body === 'string' ? body : JSON.stringify(body),
      },
      response: {
        status: response.status,
        headers: sanitizeHeaders(response.headers),
        body: response.body,
      },
    }
    this.writeCassette(reqHash, cassette)
    return { ...response, fromMock: false }
  }
}
