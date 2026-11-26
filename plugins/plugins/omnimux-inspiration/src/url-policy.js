/**
 * Download-target policy shared by the metadata extractor and the media
 * downloader.
 *
 * An imported social post is attacker-influenced input: the resolved `video_url`
 * comes from a third-party envelope, so a naive `fetch(url)` would let a crafted
 * payload point the downloader at the cloud metadata service, a loopback port, or
 * a local-network host.
 *
 * Two layers are exported, because the two call sites need different strength:
 *
 * - `isPublicHttpUrl` — protocol plus non-private *literal* host. Used by the
 *   structural extractor, which walks envelope fields that legitimately point at
 *   extension-less CDN streams (`play_addr.url_list`, `video_versions[]`,
 *   `variants[]`, `formats[]`). Applying a downloadability rule there would drop
 *   real TikTok/Instagram streams, so only the private-target refusal applies.
 * - `isDownloadableHttpUrl` / `assertDownloadableUrl` — the stricter gate for the
 *   flat direct-link fields and, above all, for the download entry point, where a
 *   hostname is also resolved and every answer is classified before a socket is
 *   opened.
 *
 * A literal hostname check alone is not enough: `localtest.me`, `127.0.0.1.nip.io`
 * and `instance-data` are ordinary public DNS names that resolve into loopback or
 * the metadata service (wildcard-DNS / rebinding bypass). `assertDownloadableUrl`
 * therefore also resolves the host and refuses a non-public answer.
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** Only these protocols may be downloaded from. `file:`, `data:` and `ftp:` never are. */
const DOWNLOADABLE_PROTOCOLS = new Set(['http:', 'https:'])

/** Hostnames that only ever resolve inside the machine or a private network. */
const PRIVATE_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

/** Suffixes reserved for local / private-network resolution (RFC 6761, RFC 8375, mDNS). */
const PRIVATE_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa']

/** HTTP statuses that carry a `Location` and must be validated before following. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Hostnames that name the instance metadata service without any DNS indirection. */
const METADATA_HOSTNAMES = new Set(['instance-data', 'metadata', 'metadata.google.internal', 'metadata.goog'])

/** Resolver shape `assertPublicResolvedHost` needs (a `dns.lookup` subset). */
const defaultResolver = dnsLookup

/**
 * Private and special-use IPv4 ranges that must never be fetched.
 * @param {string} host dotted-quad hostname
 * @returns {boolean}
 */
function isPrivateIpv4(host) {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (!parts.every((part) => /^\d{1,3}$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((value) => value > 255)) return false
  const [a, b, c] = octets
  if (a === 0 || a === 127) return true // "this network" + loopback
  if (a === 10) return true // private
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 169 && b === 254) return true // link-local (cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF protocol / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  return a >= 224 // multicast, reserved and broadcast
}

/**
 * Detect non-canonical numeric IPv4 encodings (decimal integer, hex, octal, short forms).
 * @param {string} host
 * @returns {boolean}
 */
function isAlternativeNumericIpv4(host) {
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true
  const parts = host.split('.')
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(p))) {
    const canonical = parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && !/^0\d/.test(p))
    return !canonical
  }
  return false
}

/**
 * Expand an IPv6 literal (including trailing IPv4 dotted quad) into eight 16-bit words.
 * @param {string} raw
 * @returns {number[] | null}
 */
function expandIpv6Words(raw) {
  const withoutZone = raw.includes('%') ? raw.slice(0, raw.indexOf('%')) : raw
  let text = withoutZone.trim().toLowerCase()
  if (!text || !text.includes(':')) return null
  const lastColon = text.lastIndexOf(':')
  const tail = lastColon >= 0 ? text.slice(lastColon + 1) : ''
  if (tail.includes('.')) {
    const octets = tail.split('.').map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parseSide = (side) => {
    if (!side) return []
    const tokens = side.split(':')
    const out = []
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null
      out.push(Number.parseInt(token, 16))
    }
    return out
  }
  if (halves.length === 1) {
    const words = parseSide(halves[0])
    return words && words.length === 8 ? words : null
  }
  const left = parseSide(halves[0])
  const right = parseSide(halves[1])
  if (!left || !right) return null
  const missing = 8 - (left.length + right.length)
  if (missing < 1) return null
  return [...left, ...new Array(missing).fill(0), ...right]
}

/**
 * Fail-closed classification of IPv6 addresses: permits only global unicast `2000::/3`
 * (excluding IETF protocol assignments `2001::/23`, documentation `2001:db8::/32` & `3fff::/20`,
 * and deprecated 6to4 `2002::/16`) plus public IPv4-mapped `::ffff:0:0/96`.
 * Blocks `::/128`, `::1/128`, `::/96`, `::ffff:0:0:0/96`, `64:ff9b::/96`, `64:ff9b:1::/48`,
 * `100::/64`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, and unallocated ranges.
 * @param {string} value
 * @returns {boolean}
 */
function isPrivateIpv6(value) {
  const words = expandIpv6Words(value)
  if (!words) return true
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words
  const zeroPrefix = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0
  if (zeroPrefix && w5 === 0xffff) {
    const embedded = `${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`
    return isPrivateIpv4(embedded)
  }
  if ((w0 & 0xe000) !== 0x2000) return true
  if (w0 === 0x2001 && w1 < 0x0200) return true
  if (w0 === 0x2001 && w1 === 0x0db8) return true
  if (w0 === 0x2002) return true
  if (w0 === 0x3fff && w1 < 0x1000) return true
  return false
}

/**
 * Classify one address as non-public: loopback, private, link-local, unspecified,
 * CGNAT, IPv6 unique-local and IPv6 link-local are all refused.
 * @param {unknown} address
 * @returns {boolean} true when the address must not be connected to
 */
export function isPrivateAddress(address) {
  const text = typeof address === 'string' ? address.trim().toLowerCase().replace(/^\[|\]$/g, '') : ''
  if (!text) return true
  return text.includes(':') ? isPrivateIpv6(text) : isPrivateIpv4(text)
}

/**
 * Whether a hostname can only be reached from the local machine or a private
 * network, judged from the literal text alone. IPv6 literals are refused
 * wholesale: the URL parser keeps them bracketed, and the download paths in this
 * plugin are IPv4/CDN only.
 * @param {unknown} hostname
 * @returns {boolean}
 */
export function isPrivateHostname(hostname) {
  const raw = typeof hostname === 'string' ? hostname.trim().toLowerCase() : ''
  if (!raw || raw.includes('..')) return true
  const host = raw.replace(/\.+$/, '')
  if (!host) return true
  if (host.startsWith('[') || host.includes(':')) return true
  if (PRIVATE_HOSTNAMES.has(host)) return true
  if (METADATA_HOSTNAMES.has(host)) return true
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  if (isAlternativeNumericIpv4(host)) return true
  return isPrivateIpv4(host)
}

/**
 * Lowercased hostname of a URL, or '' when it cannot be parsed.
 * @param {unknown} url
 * @returns {string}
 */
export function urlHostname(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Hostname without the IPv6 brackets, so it can be handed to a resolver.
 * @param {unknown} url
 * @returns {string}
 */
function resolverHostname(url) {
  return urlHostname(url).replace(/^\[|\]$/g, '')
}

/**
 * Whether a URL may be fetched at all: `http`/`https` on a host that is not a
 * private *literal*. This is the layer the structural extractor applies, so it
 * deliberately says nothing about the path or its extension.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isPublicHttpUrl(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }
  if (!DOWNLOADABLE_PROTOCOLS.has(parsed.protocol)) return false
  if (parsed.username || parsed.password) return false
  return !isPrivateHostname(parsed.hostname)
}

/**
 * Whether a URL may be downloaded from: `http`/`https` on a public host.
 * The literal-host layer of the policy; the resolved-address layer lives in
 * `assertDownloadableUrl`, which is the async download entry point.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isDownloadableHttpUrl(url) {
  return isPublicHttpUrl(url)
}

/**
 * Resolve a hostname and reject it when any answer is a non-public address.
 *
 * Every answer is inspected rather than just the first: a name that resolves to
 * one public and one loopback address must still be refused, because which answer
 * a connection uses is not under this code's control.
 *
 * A resolution failure (`ENOTFOUND`, `EAI_AGAIN`, a malformed name) is refused as
 * well. Fail-closed is the only safe reading here: this guard protects the cloud
 * metadata service and the loopback interface, and a name that will not resolve
 * is indistinguishable from one the resolver is deliberately refusing to answer
 * for. The download could not succeed either way, so nothing usable is lost —
 * only the error message changes, and it names the host that was refused.
 * @param {string} hostname
 * @param {{ resolver?: Function }} [deps] injectable resolver; defaults to `dns.lookup`
 * @throws {Error} when the host does not resolve, or resolves to a non-public address
 * @returns {Promise<void>}
 */
export async function assertPublicResolvedHost(hostname, deps = {}) {
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : ''
  if (!host) throw new Error('媒体下载地址为空')
  const resolver = deps.resolver ?? defaultResolver
  let answers
  try {
    answers = await resolver(host, { all: true })
  } catch (err) {
    const reason = err && err.code ? err.code : (err && err.message) || 'unknown error'
    throw new Error(`拒绝下载无法解析的主机 (${host}): ${reason}`)
  }
  const addresses = Array.isArray(answers) ? answers : []
  if (addresses.length === 0) {
    throw new Error(`拒绝下载无法解析的主机 (${host}): 解析结果为空`)
  }
  const validated = []
  for (const answer of addresses) {
    const address = typeof answer === 'string' ? answer : answer && answer.address
    const clean = typeof address === 'string' ? address.trim().replace(/^\[|\]$/g, '').split('%')[0] : ''
    if (!clean || isPrivateAddress(clean)) {
      throw new Error(`拒绝下载本机/内网地址 (${host} → ${String(address)})，仅允许公网 http(s) 直链`)
    }
    const family = isIP(clean)
    if (family !== 4 && family !== 6) {
      throw new Error(`拒绝下载非法解析地址 (${host} → ${String(address)})`)
    }
    validated.push({ address: clean, family })
  }
  return validated
}

/**
 * Guard used right before a download is started, and again for every redirect
 * hop. Applies both layers: the literal host must be public http(s), and the host
 * must resolve only to public addresses. Returns validated resolved IP records so
 * callers can pin socket connect to the exact checked addresses.
 * @param {unknown} url
 * @param {{ resolver?: Function }} [deps] injectable resolver; defaults to `dns.lookup`
 * @throws {Error} when the target is not a public http(s) URL
 * @returns {Promise<Array<{ address: string, family: 4 | 6 }>>}
 */
export async function assertDownloadableUrl(url, deps = {}) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) throw new Error('媒体下载地址为空')
  if (!isDownloadableHttpUrl(raw)) {
    const host = urlHostname(raw)
    throw new Error(
      host
        ? `拒绝下载本机/内网地址 (${host})，仅允许公网 http(s) 直链`
        : `拒绝下载非 http(s) 的媒体地址: ${raw}`,
    )
  }
  return assertPublicResolvedHost(resolverHostname(raw), deps)
}

/**
 * @param {unknown} status
 * @returns {boolean}
 */
export function isRedirectStatus(status) {
  return REDIRECT_STATUSES.has(Number(status))
}

/**
 * Resolve a redirect `Location` against the URL it came from.
 * @param {unknown} location
 * @param {string} baseUrl
 * @returns {string} absolute target, or '' when the header is unusable
 */
export function resolveRedirectUrl(location, baseUrl) {
  const raw = typeof location === 'string' ? location.trim() : ''
  if (!raw) return ''
  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return ''
  }
}
