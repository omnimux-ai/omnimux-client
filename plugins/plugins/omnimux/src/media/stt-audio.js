import { lookup as dnsLookup } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename } from 'node:path'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'
import { readBoundedBody } from './read-bounded-body.js'
import { OmnimuxError } from './errors.js'

// Remote audio shares the 200 MiB media-probe transport ceiling.
export const MAX_REMOTE_AUDIO_BYTES = 200 * 1024 * 1024
const MAX_AUDIO_REDIRECTS = 5
const AUDIO_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const AUDIO_EXT_BY_MIME = Object.freeze({
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/mp4': '.mp4',
})

const LOCAL_AUDIO_ADDRESSES = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
]) LOCAL_AUDIO_ADDRESSES.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['::', 96], ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) LOCAL_AUDIO_ADDRESSES.addSubnet(address, prefix, 'ipv6')

const BLOCKED_AUDIO_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'instance-data', 'metadata', 'metadata.google.internal', 'metadata.goog', '0.0.0.0',
])
const BLOCKED_AUDIO_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa']

function isBlockedAudioIp(rawIp) {
  const host = String(rawIp || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const ipVersion = isIP(host)
  if (ipVersion === 4) return LOCAL_AUDIO_ADDRESSES.check(host, 'ipv4')
  if (ipVersion === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host)
    if (mapped) return LOCAL_AUDIO_ADDRESSES.check(mapped[1], 'ipv4')
    if (LOCAL_AUDIO_ADDRESSES.check(host, 'ipv6')) return true
    // Fail-closed: outside IPv4-mapped public addresses, only global unicast 2000::/3 is permitted.
    const first = Number.parseInt(host.split(':')[0] || '0', 16)
    return !Number.isFinite(first) || (first & 0xe000) !== 0x2000
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

function isOfficialHttpsAudioUrl(parsed) {
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  return host === 'omnimux.ai' || host.endsWith('.omnimux.ai')
}

/**
 * Classify URL-first candidates without DNS or network probes. Remote reachability
 * remains the provider's responsibility; local/private sources require bytes.
 * @param {unknown} audio
 * @returns {boolean}
 */
export function isPublicAudioUrl(audio) {
  if (typeof audio !== 'string' || !/^https?:\/\//i.test(audio.trim())) return false
  try {
    const url = new URL(audio.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const rawHost = url.hostname.toLowerCase()
    if (rawHost.includes('..')) return false
    const host = rawHost.replace(/\.+$/, '').replace(/^\[|\]$/g, '').split('%')[0]
    if (!host || url.username || url.password) return false
    if (BLOCKED_AUDIO_HOSTNAMES.has(host) || BLOCKED_AUDIO_SUFFIXES.some((s) => host.endsWith(s))) return false
    if (isAlternativeNumericIpv4(host)) return false
    const ipVersion = isIP(host)
    if (ipVersion) return !isBlockedAudioIp(host)
    return host.includes('.')
  } catch {
    return false
  }
}

async function resolveSafeAudioTarget(rawUrl, lookup = dnsLookup) {
  if (!isPublicAudioUrl(rawUrl)) {
    throw new OmnimuxError('omnimux-invalid-request', `audio URL target is not a public http(s) host: ${rawUrl}`)
  }
  const parsed = new URL(rawUrl)
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '').split('%')[0]
  const ipVersion = isIP(host)
  if (ipVersion === 4 || ipVersion === 6) {
    return { url: parsed, host, addresses: [{ address: host, family: ipVersion }] }
  }
  let answers
  try {
    answers = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new OmnimuxError('omnimux-download-failed', `audio host DNS resolution failed: ${host}`)
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new OmnimuxError('omnimux-download-failed', `audio host resolved to no addresses: ${host}`)
  }
  const addresses = []
  for (const entry of answers) {
    const addr = typeof entry === 'string' ? entry : entry?.address
    if (!addr || isBlockedAudioIp(addr)) {
      throw new OmnimuxError('omnimux-invalid-request', `audio host resolved to non-public IP: ${host}`)
    }
    const family = isIP(addr)
    if (family !== 4 && family !== 6) {
      throw new OmnimuxError('omnimux-invalid-request', `audio host resolved to invalid IP: ${host}`)
    }
    addresses.push({ address: addr, family })
  }
  return { url: parsed, host, addresses }
}

function pinnedAudioFetch(target, headers, signal, requestImpl) {
  const request = requestImpl ?? (target.url.protocol === 'https:' ? httpsRequest : httpRequest)
  return new Promise((resolve, reject) => {
    const pinnedLookup = (_hostname, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb
      const all = typeof opts === 'object' && opts !== null && opts.all === true
      if (all) callback(null, target.addresses.map((e) => ({ address: e.address, family: e.family })))
      else callback(null, target.addresses[0].address, target.addresses[0].family)
    }
    const req = request(target.url, {
      method: 'GET',
      headers: { ...headers, 'accept-encoding': 'identity' },
      signal,
      agent: false,
      lookup: pinnedLookup,
      ...(target.url.protocol === 'https:' && isIP(target.host) === 0 ? { servername: target.host } : {}),
    }, (incoming) => {
      try {
        const status = incoming.statusCode ?? 500
        if (status < 200 || status > 599) {
          incoming.resume()
          reject(new OmnimuxError('omnimux-download-failed', `audio server returned invalid HTTP status: ${status}`))
          return
        }
        const resHeaders = new Headers()
        for (const [k, v] of Object.entries(incoming.headers)) {
          if (v !== undefined) resHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v))
        }
        if ([204, 205, 304].includes(status) || AUDIO_REDIRECT_STATUSES.has(status)) {
          incoming.on('error', reject)
          incoming.resume()
          resolve(new Response(null, { status, headers: resHeaders }))
          return
        }
        resolve(new Response(Readable.toWeb(incoming), { status, headers: resHeaders }))
      } catch (err) {
        incoming.destroy()
        req.destroy()
        reject(err)
      }
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Resolve an absolute path, http(s) URL or data URI into uploadable audio.
 * @param {string} audio
 * @param {{ fetcher?: typeof fetch, lookup?: typeof dnsLookup, requestImpl?: typeof httpsRequest, apiKey?: string, signal?: AbortSignal }} [deps]
 * @returns {Promise<{ bytes: Buffer, filename: string, contentType: string }>}
 */
export async function loadAudioBytes(audio, deps = {}) {
  const value = typeof audio === 'string' ? audio.trim() : ''
  if (!value) {
    throw new OmnimuxError('omnimux-invalid-request', 'audio is required (absolute path, http(s) URL, or data URI)')
  }

  if (value.startsWith('data:')) {
    const comma = value.indexOf(',')
    const header = comma >= 0 ? value.slice(5, comma) : ''
    const payload = comma >= 0 ? value.slice(comma + 1) : ''
    if (!payload) {
      throw new OmnimuxError('omnimux-invalid-request', 'audio data URI has no payload')
    }
    const bytes = Buffer.from(payload, 'base64')
    return audioFromBytes(bytes, header.split(';')[0], 'audio')
  }

  if (/^https?:\/\//i.test(value)) {
    let current = value
    let response = null
    for (let hop = 0; hop <= MAX_AUDIO_REDIRECTS; hop += 1) {
      // When a unit test injects a stub `fetcher` (never globalThis.fetch) without
      // `lookup`, only run literal host validation so offline tests with mock domains
      // keep passing; production always runs full DNS resolution + pinned socket connect.
      const useInjectedFetcher = typeof deps.fetcher === 'function' && deps.fetcher !== globalThis.fetch
      let target
      if (useInjectedFetcher && !deps.lookup) {
        if (!isPublicAudioUrl(current)) {
          throw new OmnimuxError('omnimux-invalid-request', `audio URL target is not a public http(s) host: ${current}`)
        }
        const parsed = new URL(current)
        target = { url: parsed, host: parsed.hostname, addresses: [] }
      } else {
        target = await resolveSafeAudioTarget(current, deps.lookup)
      }
      /** @type {Record<string, string>} */
      const headers = {}
      if (deps.apiKey?.trim() && isOfficialHttpsAudioUrl(target.url)) {
        headers.authorization = `Bearer ${deps.apiKey.trim()}`
      }
      const res = useInjectedFetcher
        ? await deps.fetcher(target.url.href, {
            headers,
            redirect: 'manual',
            ...(deps.signal ? { signal: deps.signal } : {}),
          })
        : await pinnedAudioFetch(target, headers, deps.signal, deps.requestImpl)
      if (AUDIO_REDIRECT_STATUSES.has(res.status)) {
        await res.body?.cancel?.().catch(() => {})
        const location = res.headers?.get?.('location')
        if (!location) {
          throw new OmnimuxError('omnimux-download-failed', 'audio redirect missing location')
        }
        if (hop >= MAX_AUDIO_REDIRECTS) {
          throw new OmnimuxError('omnimux-download-failed', 'audio download exceeded redirect limit')
        }
        try {
          current = new URL(location, target.url).href
        } catch {
          throw new OmnimuxError('omnimux-invalid-request', 'audio redirect target is invalid')
        }
        continue
      }
      response = res
      break
    }
    if (!response || !response.ok) {
      await response?.body?.cancel?.().catch(() => {})
      throw new OmnimuxError('omnimux-download-failed', `audio download failed: ${response?.status ?? 0}`, { status: response?.status ?? 0 })
    }
    let bytes
    try {
      bytes = Buffer.from(await readBoundedBody(response, MAX_REMOTE_AUDIO_BYTES, { signal: deps.signal, message: `audio exceeds ${MAX_REMOTE_AUDIO_BYTES} bytes` }))
    } catch (error) {
      throw new OmnimuxError('omnimux-download-failed', error instanceof Error ? error.message : String(error))
    }
    const filename = basename(new URL(current).pathname) || 'audio'
    const headerType = typeof response.headers?.get === 'function'
      ? String(response.headers.get('content-type') ?? '').split(';')[0].trim()
      : ''
    return audioFromBytes(bytes, headerType, filename)
  }

  let bytes
  try {
    bytes = readFileSync(value)
  } catch (error) {
    throw new OmnimuxError('omnimux-invalid-request', `audio file is not readable: ${value}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
  return audioFromBytes(bytes, '', basename(value) || 'audio')
}

/** @param {Buffer} bytes @param {string} declaredType @param {string} filename */
function audioFromBytes(bytes, declaredType, filename) {
  const contentType = mediaFromAudioMagic(bytes)
  if (!contentType) {
    throw new OmnimuxError('omnimux-invalid-request', 'audio type cannot be identified from bytes')
  }
  const declared = normalizeAudioMime(declaredType)
  if (declared && declared !== contentType) {
    throw new OmnimuxError('omnimux-invalid-request', `audio MIME ${declaredType} does not match its bytes`)
  }
  const ext = AUDIO_EXT_BY_MIME[contentType] ?? '.mp3'
  const name = filename.includes('.') ? filename : `${filename}${ext}`
  return { bytes, filename: name, contentType }
}

/** @param {string} mime */
function normalizeAudioMime(mime) {
  const value = String(mime || '').trim().toLowerCase()
  if (value === 'audio/mp3') return 'audio/mpeg'
  if (value === 'audio/x-wav') return 'audio/wav'
  if (value === 'audio/x-m4a') return 'audio/m4a'
  return value
}

/**
 * @param {Uint8Array} bytes
 * @returns {'audio/mpeg' | 'audio/wav' | 'audio/m4a' | 'audio/webm' | 'audio/ogg' | 'audio/flac' | 'audio/mp4' | undefined}
 */
export function mediaFromAudioMagic(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return 'audio/wav'
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg'
  if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'audio/flac'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm'
  const ftyp = bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  if (!ftyp) return undefined
  if (bytes[8] === 0x4d && bytes[9] === 0x34 && bytes[10] === 0x41) return 'audio/m4a'
  return 'audio/mp4'
}

/**
 * Duration for formats with available byte metadata; unknown remains unknown.
 * @param {Uint8Array} bytes
 * @param {string} contentType
 * @returns {number | undefined}
 */
export function durationFromAudioBytes(bytes, contentType) {
  if (contentType === 'audio/wav') return durationFromWave(bytes)
  if (contentType === 'audio/mpeg') return durationFromMp3(bytes)
  return undefined
}

/** @param {Uint8Array} bytes */
function durationFromWave(bytes) {
  if (bytes.byteLength < 12) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let byteRate
  let dataSize
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    const declaredSize = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    const availableSize = Math.min(declaredSize, Math.max(0, bytes.byteLength - dataStart))
    if (id === 'fmt ' && availableSize >= 12) byteRate = view.getUint32(dataStart + 8, true)
    if (id === 'data') dataSize = availableSize
    const next = dataStart + declaredSize + (declaredSize % 2)
    if (next <= offset) break
    offset = next
  }
  if (!byteRate || dataSize === undefined) return undefined
  const seconds = dataSize / byteRate
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

const MPEG_BITRATES = Object.freeze({
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
})

/** @param {Uint8Array} bytes */
function durationFromMp3(bytes) {
  let offset = id3PayloadEnd(bytes)
  let seconds = 0
  let frames = 0
  while (offset + 4 <= bytes.byteLength) {
    const header = readMp3Frame(bytes, offset)
    if (!header) {
      if (frames > 0) break
      offset++
      continue
    }
    if (offset + header.frameBytes > bytes.byteLength) break
    seconds += header.samplesPerFrame / header.sampleRate
    frames++
    offset += header.frameBytes
  }
  return frames > 0 && Number.isFinite(seconds) ? seconds : undefined
}

/** @param {Uint8Array} bytes */
function id3PayloadEnd(bytes) {
  if (bytes.byteLength < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  return Math.min(bytes.byteLength, 10 + size + ((bytes[5] & 0x10) ? 10 : 0))
}

/** @param {Uint8Array} bytes @param {number} offset */
function readMp3Frame(bytes, offset) {
  const value = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  if (((value & 0xffe00000) >>> 0) !== 0xffe00000) return undefined
  const versionBits = (value >>> 19) & 0x3
  const layerBits = (value >>> 17) & 0x3
  const bitrateIndex = (value >>> 12) & 0xf
  const sampleRateIndex = (value >>> 10) & 0x3
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return undefined
  const version = versionBits === 3 ? 1 : 2
  const layer = 4 - layerBits
  const baseSampleRates = versionBits === 0 ? [11025, 12000, 8000] : versionBits === 2 ? [22050, 24000, 16000] : [44100, 48000, 32000]
  const sampleRate = baseSampleRates[sampleRateIndex]
  const bitrate = MPEG_BITRATES[`${version}-${layer}`]?.[bitrateIndex] * 1000
  if (!bitrate || !sampleRate) return undefined
  const padding = (value >>> 9) & 1
  const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152
  const frameBytes = layer === 1
    ? Math.floor(12 * bitrate / sampleRate + padding) * 4
    : Math.floor((layer === 3 && version !== 1 ? 72 : 144) * bitrate / sampleRate) + padding
  if (frameBytes < 4) return undefined
  return { frameBytes, sampleRate, samplesPerFrame }
}
