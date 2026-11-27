import { lookup as dnsLookup } from 'node:dns/promises'
import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { VideoError } from '../errors.js'

export const MAX_REMOTE_MEDIA_BYTES = 512 * 1024 * 1024
export const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'instance-data', 'metadata', 'metadata.google.internal', 'metadata.goog', '0.0.0.0',
])
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa']

function isBlockedIpv4(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return true
  const nums = parts.map(Number)
  if (nums.some((n) => n < 0 || n > 255)) return true
  const [a, b, c] = nums
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  if (a === 192 && b === 88 && c === 99) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  return a >= 224
}

function expandIpv6Words(raw) {
  const withoutZone = raw.includes('%') ? raw.slice(0, raw.indexOf('%')) : raw
  let text = withoutZone.trim().toLowerCase()
  if (!text || !text.includes(':')) return null
  const lastColon = text.lastIndexOf(':')
  const tail = lastColon >= 0 ? text.slice(lastColon + 1) : ''
  if (tail.includes('.')) {
    const octets = tail.split('.').map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN))
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    text = `${text.slice(0, lastColon + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parseSide = (s) => {
    if (!s) return []
    const out = []
    for (const tok of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(tok)) return null
      out.push(Number.parseInt(tok, 16))
    }
    return out
  }
  if (halves.length === 1) {
    const w = parseSide(halves[0])
    return w && w.length === 8 ? w : null
  }
  const left = parseSide(halves[0])
  const right = parseSide(halves[1])
  if (!left || !right) return null
  const missing = 8 - (left.length + right.length)
  return missing >= 1 ? [...left, ...new Array(missing).fill(0), ...right] : null
}

function isBlockedIp(rawIp) {
  const clean = String(rawIp || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const ver = isIP(clean)
  if (ver === 4) return isBlockedIpv4(clean)
  if (ver === 6) {
    const words = expandIpv6Words(clean)
    if (!words) return true
    const [w0, w1, w2, w3, w4, w5, w6, w7] = words
    if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0xffff) {
      return isBlockedIpv4(`${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`)
    }
    if ((w0 & 0xe000) !== 0x2000) return true
    if (w0 === 0x2001 && w1 < 0x0200) return true
    if (w0 === 0x2001 && w1 === 0x0db8) return true
    if (w0 === 0x2002) return true
    if (w0 === 0x3fff && w1 < 0x1000) return true
    return false
  }
  return true
}

function isAlternativeNumericIpv4(host) {
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true
  const parts = host.split('.')
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(p))) {
    const canonical = parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && !/^0\d/.test(p))
    return !canonical
  }
  return false
}

export async function assertSafeRemoteMediaUrl(rawUrl, lookup = dnsLookup) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new VideoError('video-invalid-input', `invalid remote media URL: ${rawUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new VideoError('video-invalid-input', `remote media URL must use http(s): ${rawUrl}`)
  }
  if (parsed.username || parsed.password) {
    throw new VideoError('video-invalid-input', 'remote media URL must not contain embedded credentials')
  }
  const rawHost = parsed.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!rawHost || rawHost.includes('..')) {
    throw new VideoError('video-invalid-input', `remote media host is not allowed: ${rawHost}`)
  }
  const host = rawHost.replace(/\.+$/, '').split('%')[0]
  if (!host || BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || isAlternativeNumericIpv4(host)) {
    throw new VideoError('video-invalid-input', `remote media host is not allowed: ${host}`)
  }
  const literalVer = isIP(host)
  if (literalVer === 4 || literalVer === 6) {
    if (isBlockedIp(host)) {
      throw new VideoError('video-invalid-input', `remote media target IP is not public: ${host}`)
    }
    return { url: parsed, host, addresses: [{ address: host, family: literalVer }] }
  }
  let answers
  try {
    answers = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new VideoError('video-invalid-input', `remote media host DNS lookup failed: ${host}`)
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new VideoError('video-invalid-input', `remote media host resolved to no addresses: ${host}`)
  }
  const addresses = []
  for (const entry of answers) {
    const addr = typeof entry === 'string' ? entry : entry?.address
    if (!addr || isBlockedIp(addr)) {
      throw new VideoError('video-invalid-input', `remote media host resolved to non-public IP: ${host}`)
    }
    const family = isIP(addr)
    if (family !== 4 && family !== 6) {
      throw new VideoError('video-invalid-input', `remote media host resolved to invalid IP: ${host}`)
    }
    addresses.push({ address: addr, family })
  }
  return { url: parsed, host, addresses }
}

function pinnedVideoFetch(target, signal, requestImpl, timeoutMs = DEFAULT_REMOTE_FETCH_TIMEOUT_MS) {
  const request = requestImpl ?? (target.url.protocol === 'https:' ? httpsRequest : httpRequest)
  return new Promise((resolve, reject) => {
    let settled = false
    const ac = new AbortController()
    let timer = null
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (signal && onCallerAbort) {
        signal.removeEventListener('abort', onCallerAbort)
      }
    }
    const fail = (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    const succeed = (resp) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(resp)
    }
    const onCallerAbort = () => {
      ac.abort(signal?.reason ?? new VideoError('video-canceled', `download canceled: ${target.url.href}`))
      fail(new VideoError('video-canceled', `download canceled: ${target.url.href}`))
    }
    if (signal) {
      if (signal.aborted) {
        onCallerAbort()
        return
      }
      signal.addEventListener('abort', onCallerAbort, { once: true })
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        const err = new VideoError('video-timeout', `remote media download timed out after ${timeoutMs}ms: ${target.url.href}`)
        ac.abort(err)
        fail(err)
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    }

    const pinnedLookup = (_hostname, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb
      const all = typeof opts === 'object' && opts !== null && opts.all === true
      if (all) callback(null, target.addresses.map((e) => ({ address: e.address, family: e.family })))
      else callback(null, target.addresses[0].address, target.addresses[0].family)
    }

    let req
    try {
      req = request(target.url, {
        method: 'GET',
        headers: { 'accept-encoding': 'identity' },
        signal: ac.signal,
        agent: false,
        lookup: pinnedLookup,
        ...(target.url.protocol === 'https:' && isIP(target.host) === 0 ? { servername: target.host } : {}),
      }, (incoming) => {
        try {
          const status = incoming.statusCode ?? 0
          if (!Number.isInteger(status) || status < 200 || status > 599) {
            incoming.resume()
            fail(new VideoError('video-ffmpeg-failed', `unexpected HTTP status ${status} downloading ${target.url.href}`))
            return
          }
          const headers = new Headers()
          for (const [k, v] of Object.entries(incoming.headers || {})) {
            if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
          }
          if ([204, 205, 304].includes(status) || REDIRECT_STATUSES.has(status)) {
            incoming.on('error', fail)
            incoming.resume()
            succeed(new Response(null, { status, headers }))
            return
          }
          succeed(new Response(Readable.toWeb(incoming), { status, headers }))
        } catch (err) {
          incoming.destroy?.()
          fail(err instanceof VideoError ? err : new VideoError('video-ffmpeg-failed', String(err?.message ?? err)))
        }
      })
    } catch (err) {
      fail(err instanceof VideoError ? err : new VideoError('video-ffmpeg-failed', String(err?.message ?? err)))
      return
    }
    req.on('error', (err) => {
      fail(err instanceof VideoError ? err : new VideoError('video-ffmpeg-failed', String(err?.message ?? err)))
    })
    req.end()
  })
}

async function writeChunkWithBackpressure(stream, chunk) {
  if (stream.write(chunk)) return
  await new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError)
      resolve()
    }
    const onError = (err) => {
      stream.off('drain', onDrain)
      reject(err)
    }
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}

async function streamResponseToFile(resp, destFile, maxBytes, sourceUrl) {
  const declared = Number(resp.headers?.get?.('content-length') || 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await resp.body?.cancel?.().catch(() => {})
    throw new VideoError('video-ffmpeg-failed', `remote media exceeds ${maxBytes} byte limit: ${sourceUrl}`)
  }

  const partFile = `${destFile}.part`
  const ws = createWriteStream(partFile, { mode: 0o600 })
  let streamError = null
  const onWsError = (err) => { streamError = err }
  ws.on('error', onWsError)

  const abortAndCleanup = async () => {
    try { ws.destroy() } catch { /* ignore */ }
    await unlink(partFile).catch(() => {})
  }

  try {
    if (resp.body && typeof resp.body.getReader === 'function') {
      const reader = resp.body.getReader()
      let total = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (streamError) throw streamError
          if (value && value.byteLength > 0) {
            total += value.byteLength
            if (total > maxBytes) {
              await reader.cancel().catch(() => {})
              throw new VideoError('video-ffmpeg-failed', `remote media exceeds ${maxBytes} byte limit: ${sourceUrl}`)
            }
            const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
            await writeChunkWithBackpressure(ws, buf)
          }
        }
      } finally {
        reader.releaseLock()
      }
    } else {
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length > maxBytes) {
        throw new VideoError('video-ffmpeg-failed', `remote media exceeds ${maxBytes} byte limit: ${sourceUrl}`)
      }
      if (buf.length > 0) {
        await writeChunkWithBackpressure(ws, buf)
      }
    }

    if (streamError) throw streamError
    await new Promise((resolve, reject) => {
      ws.once('error', reject)
      ws.end(resolve)
    })
    await rename(partFile, destFile)
    return destFile
  } catch (err) {
    await abortAndCleanup()
    throw err
  }
}

function guessExt(url) {
  try {
    const pathname = new URL(url).pathname
    const m = /\.([a-zA-Z0-9]{1,5})$/.exec(pathname)
    return m ? `.${m[1].toLowerCase()}` : '.dat'
  } catch {
    return '.dat'
  }
}

function safeLabel(label) {
  return String(label || 'input').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function isWindowsDrivePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value)
}

function hasUriScheme(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

/**
 * Turn an input into a local seekable path: http(s) URLs are downloaded into
 * tmpDir after validating public DNS targets, manual redirects, and byte caps;
 * other URI/FFmpeg protocol schemes (concat:, subfile:, tcp://, ftp://, file://,
 * etc.) are rejected; local filesystem paths pass through untouched.
 * @param {string} input @param {string} tmpDir @param {string} label
 * @param {{ fetcher?: typeof fetch, lookup?: typeof dnsLookup, requestImpl?: typeof httpsRequest, maxBytes?: number, signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export async function materializeInput(input, tmpDir, label, opts = {}) {
  const s = String(input || '').trim()
  if (!s) {
    throw new VideoError('video-invalid-input', 'media input path or URL must not be empty')
  }
  if (/[\0\r\n]/.test(s)) {
    throw new VideoError('video-invalid-input', 'media input path or URL contains invalid control characters')
  }
  if (/^https?:\/\//i.test(s)) {
    const maxBytes = typeof opts.maxBytes === 'number' && opts.maxBytes > 0 ? opts.maxBytes : MAX_REMOTE_MEDIA_BYTES
    const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_REMOTE_FETCH_TIMEOUT_MS
    const customFetcher = typeof opts.fetcher === 'function' && opts.fetcher !== globalThis.fetch ? opts.fetcher : null
    let current = s
    let finalResp = null
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = await assertSafeRemoteMediaUrl(current, opts.lookup)
      const resp = customFetcher
        ? await customFetcher(target.url.href, { redirect: 'manual', ...(opts.signal ? { signal: opts.signal } : {}) })
        : await pinnedVideoFetch(target, opts.signal, opts.requestImpl, timeoutMs)
      if (REDIRECT_STATUSES.has(resp.status)) {
        await resp.body?.cancel?.().catch(() => {})
        const location = resp.headers?.get?.('location')
        if (!location) throw new VideoError('video-ffmpeg-failed', `redirect missing location for ${current}`)
        if (hop >= MAX_REDIRECTS) throw new VideoError('video-ffmpeg-failed', `too many redirects downloading ${s}`)
        try {
          current = new URL(location, target.url).href
        } catch {
          throw new VideoError('video-invalid-input', `invalid redirect target for ${current}`)
        }
        continue
      }
      finalResp = resp
      break
    }
    if (!finalResp || !finalResp.ok) {
      await finalResp?.body?.cancel?.().catch(() => {})
      throw new VideoError('video-ffmpeg-failed', `failed to download ${s}: HTTP ${finalResp?.status ?? 0}`)
    }
    const file = join(tmpDir, `${safeLabel(label)}${guessExt(current)}`)
    return streamResponseToFile(finalResp, file, maxBytes, current)
  }
  if (!isWindowsDrivePath(s) && hasUriScheme(s)) {
    throw new VideoError('video-invalid-input', `unsupported media URI scheme: ${s}`)
  }
  return s
}

/**
 * Resolve any capability media input through `ctx.materialize` (or fallback to
 * `materializeInput` when a capability is invoked directly in isolation).
 *
 * @param {unknown} rawInput
 * @param {string} label
 * @param {{ materialize?: (u: string, l: string) => Promise<string>, tmpDir?: string, signal?: AbortSignal }} [ctx]
 * @returns {Promise<string>}
 */
export async function resolveInputPath(rawInput, label, ctx) {
  const value = String(rawInput ?? '')
  if (typeof ctx?.materialize === 'function') {
    return ctx.materialize(value, label)
  }
  return materializeInput(value, ctx?.tmpDir || tmpdir(), label, { signal: ctx?.signal })
}
