import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { VideoExtractionError } from './errors.ts';

export type VideoUrlLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family?: number }>>;

export const MAX_VIDEO_REDIRECTS = 5;
export const DEFAULT_MAX_VIDEO_BYTES = 250 * 1024 * 1024;
export const DEFAULT_VIDEO_FETCH_TIMEOUT_MS = 60_000;
const DNS_LOOKUP_TIMEOUT_MS = 5_000;

const ALLOWED_VIDEO_MIME_PREFIXES = ['video/'];
const ALLOWED_VIDEO_MIME_EXACT = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/mp4',
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  '0.0.0.0',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home.arpa',
];

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return true;
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function expandIpv6Words(raw: string): number[] | null {
  const withoutZone = raw.split('%')[0] ?? raw;
  const lower = withoutZone.toLowerCase();
  if (!lower) return null;

  let normalized = lower;
  const lastColon = lower.lastIndexOf(':');
  const tail = lastColon >= 0 ? lower.slice(lastColon + 1) : '';
  if (tail.includes('.')) {
    const octets = parseIpv4Octets(tail);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${lower.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(':');
    const words: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      words.push(parseInt(token, 16));
    }
    return words;
  };

  if (halves.length === 1) {
    const words = parseSide(halves[0]!);
    return words && words.length === 8 ? words : null;
  }

  const left = parseSide(halves[0]!);
  const right = parseSide(halves[1]!);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isBlockedIpv6(ip: string): boolean {
  const words = expandIpv6Words(ip);
  if (!words) return true;
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const allZeroPrefix = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0;
  // ::/128 (unspecified) and ::1/128 (loopback)
  if (allZeroPrefix && w5 === 0 && w6 === 0 && (w7 === 0 || w7 === 1)) return true;
  // ::ffff:0:0/96 (IPv4-mapped) or ::/96 (deprecated IPv4-compatible)
  if (allZeroPrefix && (w5 === 0xffff || w5 === 0)) {
    const embedded = `${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`;
    return isBlockedIpv4(embedded);
  }
  // ::ffff:0:0:0/96 (RFC 2765 IPv4-translated)
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0xffff && w5 === 0) {
    const embedded = `${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`;
    return isBlockedIpv4(embedded);
  }
  // 64:ff9b::/96 (NAT64 well-known prefix) and 64:ff9b:1::/48 (RFC 8215 local-use NAT64)
  if (w0 === 0x0064 && w1 === 0xff9b && ((w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) || w2 === 0x0001)) return true;
  // 100::/64 (discard-only)
  if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0) return true;
  // 2001:db8::/32 (documentation)
  if (w0 === 0x2001 && w1 === 0x0db8) return true;
  // 2002::/16 (6to4 embeds IPv4 in w1:w2)
  if (w0 === 0x2002) {
    const embedded = `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`;
    return isBlockedIpv4(embedded);
  }
  // fc00::/7 (unique local)
  if ((w0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (link-local)
  if ((w0 & 0xffc0) === 0xfe80) return true;
  // fec0::/10 (deprecated site-local)
  if ((w0 & 0xffc0) === 0xfec0) return true;
  // ff00::/8 (multicast)
  if ((w0 & 0xff00) === 0xff00) return true;
  return false;
}

export function isBlockedIpAddress(rawIp: string): boolean {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, '');
  const withoutZone = cleaned.split('%')[0] ?? cleaned;
  const version = isIP(withoutZone);
  if (version === 4) return isBlockedIpv4(withoutZone);
  if (version === 6) return isBlockedIpv6(withoutZone);
  return true;
}

function isAlternativeNumericIpv4Host(hostname: string): boolean {
  if (/^\d+$/.test(hostname)) return true;
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  const parts = hostname.split('.');
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(p))) {
    return true;
  }
  return false;
}

export function normalizeHostname(rawHost: string): string {
  return rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

export function isBlockedHostname(rawHost: string): boolean {
  const host = normalizeHostname(rawHost);
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  const withoutZone = host.split('%')[0] ?? host;
  if (isIP(withoutZone) !== 0) {
    return isBlockedIpAddress(withoutZone);
  }
  if (isAlternativeNumericIpv4Host(host)) return true;
  return false;
}

export function isTikTokHostname(rawHost: string): boolean {
  const host = normalizeHostname(rawHost);
  return (
    host === 'tiktok.com'
    || host.endsWith('.tiktok.com')
    || host === 'tiktokv.com'
    || host.endsWith('.tiktokv.com')
  );
}

async function defaultLookupWithTimeout(
  hostname: string,
): Promise<Array<{ address: string; family?: number }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timeout')), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function assertSafeRemoteVideoUrl(
  rawUrl: string,
  options: { lookup?: VideoUrlLookup; skipDns?: boolean } = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new VideoExtractionError('unsafe-url', '无效的远程视频链接', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new VideoExtractionError('unsafe-url', '仅允许 HTTP(S) 协议的远程视频链接', 400);
  }
  if (parsed.username || parsed.password) {
    throw new VideoExtractionError('unsafe-url', '不允许携带内嵌凭据的远程链接', 400);
  }

  const host = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(host)) {
    throw new VideoExtractionError('unsafe-url', '拒绝访问私网、环回或元数据地址', 400);
  }

  const withoutZone = host.split('%')[0] ?? host;
  if (isIP(withoutZone) === 0 && !options.skipDns) {
    const lookupFn = options.lookup ?? defaultLookupWithTimeout;
    let addresses: Array<{ address: string; family?: number }>;
    try {
      addresses = await lookupFn(host);
    } catch {
      throw new VideoExtractionError('unsafe-url', '目标域名解析失败，已拒绝请求', 400);
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new VideoExtractionError('unsafe-url', '目标域名未返回有效 IP，已拒绝请求', 400);
    }
    for (const entry of addresses) {
      if (!entry || typeof entry.address !== 'string' || isBlockedIpAddress(entry.address)) {
        throw new VideoExtractionError('unsafe-url', '目标域名解析到私网或环回地址，已拒绝请求', 400);
      }
    }
  }

  return parsed;
}

export function isAllowedVideoContentType(contentTypeHeader: string | null | undefined): boolean {
  if (!contentTypeHeader) return true;
  const mime = contentTypeHeader.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime) return true;
  if (ALLOWED_VIDEO_MIME_EXACT.has(mime)) return true;
  return ALLOWED_VIDEO_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

export function isSafeHttpUrlLexical(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return !isBlockedHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export async function fetchWithSafeRedirects(
  rawUrl: string,
  options: {
    fetcher: typeof fetch;
    lookup?: VideoUrlLookup;
    skipDns?: boolean;
    headers?: Record<string, string>;
    maxRedirects?: number;
    timeoutMs?: number;
  },
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? MAX_VIDEO_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VIDEO_FETCH_TIMEOUT_MS;
  let current = await assertSafeRemoteVideoUrl(rawUrl, {
    lookup: options.lookup,
    skipDns: options.skipDns,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await options.fetcher(current.href, {
        headers: options.headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      const status = response.status;
      if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
        await response.body?.cancel?.().catch(() => {});
        const location = response.headers?.get?.('location');
        if (!location) {
          throw new VideoExtractionError('download-failed', '重定向缺少 Location 头', 502);
        }
        if (hop >= maxRedirects) {
          throw new VideoExtractionError('download-failed', '远程链接重定向次数过多', 502);
        }
        let nextHref: string;
        try {
          nextHref = new URL(location, current).href;
        } catch {
          throw new VideoExtractionError('unsafe-url', '重定向目标链接无效', 400);
        }
        current = await assertSafeRemoteVideoUrl(nextHref, {
          lookup: options.lookup,
          skipDns: options.skipDns,
        });
        continue;
      }

      return { response, finalUrl: current.href };
    }
    throw new VideoExtractionError('download-failed', '远程链接重定向次数过多', 502);
  } catch (err) {
    if (err instanceof VideoExtractionError) throw err;
    throw new VideoExtractionError(
      'download-failed',
      `视频下载请求失败: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
