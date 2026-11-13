#!/usr/bin/env node
// Live OmniMux video check. Inject the key via:
//   omnimux tokens exec 40 --yes --timeout=600 -- env OMNIMUX_API_KEY=__OMNIMUX_TOKEN_40__ node scripts/verify-omnimux-live.mjs
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeOmnimuxVideo } from '../plugins/omnimux/src/media/video.js'

const prompt = process.env.OMNIMUX_VIDEO_PROMPT || 'a close-up portrait in soft cinematic lighting'

const destDir = mkdtempSync(join(tmpdir(), 'omnimux-live-'))
const dest = join(destDir, 'e01-s01.mp4')

const SECRET_KEY = /^(authorization|api[_-]?key|access[_-]?token|token|secret|password|bearer)$/i
const SECRET_VALUE = /\bsk-[A-Za-z0-9._-]{8,}\b/g

/**
 * @param {unknown} value
 * @param {number} [depth]
 */
function redact(value, depth = 0) {
  if (depth > 8) return '[truncated]'
  if (typeof value === 'string') {
    const cleaned = value.replace(SECRET_VALUE, 'sk-[redacted]')
    return cleaned.length > 4000 ? `${cleaned.slice(0, 4000)}…` : cleaned
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
    }
    return out
  }
  return value
}

/**
 * @param {unknown} input
 */
function requestUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input && typeof input === 'object' && 'url' in input) return String(/** @type {{ url: unknown }} */ (input).url)
  return String(input)
}

/**
 * @param {string} url
 */
function isVideoJson(url) {
  try {
    return new URL(url).pathname.includes('/video/generations')
  } catch {
    return url.includes('/video/generations')
  }
}

/**
 * @param {unknown} input
 * @param {RequestInit} [init]
 */
async function loggingFetch(input, init) {
  const url = requestUrl(input)
  const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const response = await fetch(input, init)
  if (!isVideoJson(url)) return response
  const clone = response.clone()
  let body
  try {
    body = await clone.json()
  } catch {
    body = { _parse: 'not-json', status: response.status }
  }
  const event = method === 'POST' ? 'submit' : 'poll'
  process.stdout.write(`${JSON.stringify({
    event,
    method,
    httpStatus: response.status,
    path: new URL(url, 'https://api.omnimux.ai').pathname,
    body: redact(body),
  })}\n`)
  return response
}

const started = Date.now()
try {
  const result = await executeOmnimuxVideo({
    prompt,
    dest,
    duration: 4,
    fetcher: loggingFetch,
  })
  const bytes = statSync(dest).size
  process.stdout.write(`${JSON.stringify({
    event: 'result',
    mode: result.mode,
    taskId: result.taskId,
    url: redact(result.url),
    bytes,
    dest,
    modelId: process.env.OMNIMUX_VIDEO_MODEL ?? 'seedance-2-0-fast',
    elapsedMs: Date.now() - started,
  })}\n`)
  if (result.mode !== 'live' || !result.taskId || !result.url || bytes <= 0) {
    process.exitCode = 1
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    event: 'error',
    name: error instanceof Error ? error.name : 'Error',
    code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
    message: redact(error instanceof Error ? error.message : String(error)),
    elapsedMs: Date.now() - started,
  })}\n`)
  process.exitCode = 1
}
