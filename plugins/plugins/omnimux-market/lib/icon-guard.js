import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { HttpError } from './http.js';
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
export const MAX_ICON_REDIRECTS = 5;
export const MAX_AVATAR_CACHE_ENTRIES = 500;
export const MAX_AVATAR_CACHE_BYTES = 50 * 1024 * 1024;
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
export const ICON_SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'cross-origin-resource-policy': 'same-origin',
};
export const SAFE_RASTER_ICON_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/avif',
    'image/bmp',
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
function parseIpv4Octets(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4)
        return null;
    const nums = [];
    for (const part of parts) {
        if (!/^\d+$/.test(part))
            return null;
        const n = Number(part);
        if (!Number.isInteger(n) || n < 0 || n > 255)
            return null;
        nums.push(n);
    }
    return [nums[0], nums[1], nums[2], nums[3]];
}
function isBlockedIpv4(ip) {
    const octets = parseIpv4Octets(ip);
    if (!octets)
        return true;
    const [a, b, c] = octets;
    if (a === 0)
        return true;
    if (a === 10)
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    if (a === 127)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 0 && c === 0)
        return true;
    if (a === 192 && b === 0 && c === 2)
        return true;
    if (a === 192 && b === 88 && c === 99)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 198 && (b === 18 || b === 19))
        return true;
    if (a === 198 && b === 51 && c === 100)
        return true;
    if (a === 203 && b === 0 && c === 113)
        return true;
    if (a >= 224)
        return true;
    return false;
}
function expandIpv6Words(raw) {
    const withoutZone = raw.split('%')[0] ?? raw;
    const lower = withoutZone.toLowerCase();
    if (!lower)
        return null;
    let normalized = lower;
    const lastColon = lower.lastIndexOf(':');
    const tail = lastColon >= 0 ? lower.slice(lastColon + 1) : '';
    if (tail.includes('.')) {
        const octets = parseIpv4Octets(tail);
        if (!octets)
            return null;
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        normalized = `${lower.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
    const halves = normalized.split('::');
    if (halves.length > 2)
        return null;
    const parseSide = (side) => {
        if (!side)
            return [];
        const tokens = side.split(':');
        const words = [];
        for (const token of tokens) {
            if (!/^[0-9a-f]{1,4}$/.test(token))
                return null;
            words.push(parseInt(token, 16));
        }
        return words;
    };
    if (halves.length === 1) {
        const words = parseSide(halves[0]);
        return words && words.length === 8 ? words : null;
    }
    const left = parseSide(halves[0]);
    const right = parseSide(halves[1]);
    if (!left || !right)
        return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1)
        return null;
    return [...left, ...new Array(missing).fill(0), ...right];
}
function isBlockedIpv6(ip) {
    const words = expandIpv6Words(ip);
    if (!words)
        return true;
    const [w0, w1, w2, w3, w4, w5, w6, w7] = words;
    const zeroPrefix = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0;
    if (zeroPrefix && w5 === 0 && w6 === 0 && (w7 === 0 || w7 === 1))
        return true;
    if (zeroPrefix && (w5 === 0xffff || w5 === 0)) {
        const embedded = `${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`;
        return isBlockedIpv4(embedded);
    }
    if (w0 === 0x0064 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0)
        return true;
    if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0)
        return true;
    if (w0 === 0x2001 && w1 === 0x0db8)
        return true;
    if (w0 === 0x2002) {
        const embedded = `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`;
        return isBlockedIpv4(embedded);
    }
    if ((w0 & 0xfe00) === 0xfc00)
        return true;
    if ((w0 & 0xffc0) === 0xfe80)
        return true;
    if ((w0 & 0xffc0) === 0xfec0)
        return true;
    if ((w0 & 0xff00) === 0xff00)
        return true;
    return false;
}
export function isBlockedIconIp(rawIp) {
    const cleaned = rawIp.trim().replace(/^\[|\]$/g, '');
    const withoutZone = cleaned.split('%')[0] ?? cleaned;
    const version = isIP(withoutZone);
    if (version === 4)
        return isBlockedIpv4(withoutZone);
    if (version === 6)
        return isBlockedIpv6(withoutZone);
    return true;
}
function isAlternativeNumericIpv4Host(hostname) {
    if (/^\d+$/.test(hostname))
        return true;
    if (/^0x[0-9a-f]+$/i.test(hostname))
        return true;
    const parts = hostname.split('.');
    if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(p))) {
        return true;
    }
    return false;
}
function normalizeHostname(rawHost) {
    return rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}
export function isBlockedIconHostname(rawHost) {
    const host = normalizeHostname(rawHost);
    if (!host)
        return true;
    if (BLOCKED_HOSTNAMES.has(host))
        return true;
    for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
        if (host.endsWith(suffix))
            return true;
    }
    const withoutZone = host.split('%')[0] ?? host;
    if (isIP(withoutZone) !== 0)
        return isBlockedIconIp(withoutZone);
    if (isAlternativeNumericIpv4Host(host))
        return true;
    return false;
}
export function normalizeSafeRasterMime(raw) {
    if (typeof raw !== 'string')
        return null;
    const mime = raw.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!mime)
        return null;
    return SAFE_RASTER_ICON_MIME_TYPES.has(mime) ? mime : null;
}
/** Verify leading magic bytes correspond to a safe raster image (never HTML/SVG/script). */
export function sniffSafeRasterImageMime(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 4)
        return null;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 8
        && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'image/png';
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    // GIF: GIF87a / GIF89a
    if (bytes.length >= 6) {
        const header6 = bytes.subarray(0, 6).toString('ascii');
        if (header6 === 'GIF87a' || header6 === 'GIF89a')
            return 'image/gif';
    }
    // WebP: RIFF....WEBP
    if (bytes.length >= 12
        && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'image/webp';
    }
    // ICO / CUR: 00 00 01 00 or 00 00 02 00
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02) && bytes[3] === 0x00) {
        return 'image/x-icon';
    }
    // BMP: BM
    if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.length >= 14) {
        return 'image/bmp';
    }
    // AVIF: ....ftypavif / ....ftypavis
    if (bytes.length >= 12
        && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
        && (bytes.subarray(8, 12).toString('ascii') === 'avif' || bytes.subarray(8, 12).toString('ascii') === 'avis')) {
        return 'image/avif';
    }
    return null;
}
async function defaultLookupWithTimeout(hostname) {
    let timer;
    try {
        return await Promise.race([
            dnsLookup(hostname, { all: true, verbatim: true }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('DNS lookup timeout')), DNS_LOOKUP_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
export async function assertSafePublicHttpsUrl(rawUrl, lookup) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        throw new HttpError('bad url', 400);
    }
    if (parsed.protocol !== 'https:') {
        throw new HttpError('only https icon URLs are allowed', 400);
    }
    if (parsed.username || parsed.password) {
        throw new HttpError('credentials in icon URL are not allowed', 400);
    }
    const host = normalizeHostname(parsed.hostname);
    if (isBlockedIconHostname(host)) {
        throw new HttpError('blocked private or loopback icon target', 400);
    }
    const withoutZone = host.split('%')[0] ?? host;
    if (isIP(withoutZone) === 0) {
        const lookupFn = lookup ?? defaultLookupWithTimeout;
        let addresses;
        try {
            addresses = await lookupFn(host);
        }
        catch {
            throw new HttpError('icon host DNS resolution failed', 400);
        }
        if (!Array.isArray(addresses) || addresses.length === 0) {
            throw new HttpError('icon host resolved to no addresses', 400);
        }
        for (const entry of addresses) {
            if (!entry || typeof entry.address !== 'string' || isBlockedIconIp(entry.address)) {
                throw new HttpError('icon host resolved to blocked IP', 400);
            }
        }
    }
    return parsed;
}
async function readBoundedResponseBuffer(res, maxBytes) {
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel?.().catch(() => { });
        throw new HttpError(`icon exceeds ${maxBytes} byte limit`, 413);
    }
    if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value) {
                    total += value.byteLength;
                    if (total > maxBytes) {
                        await reader.cancel().catch(() => { });
                        throw new HttpError(`icon exceeds ${maxBytes} byte limit`, 413);
                    }
                    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
                }
            }
        }
        finally {
            reader.releaseLock();
        }
        return Buffer.concat(chunks, total);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
        throw new HttpError(`icon exceeds ${maxBytes} byte limit`, 413);
    }
    return buf;
}
export async function fetchSafeIconBytes(rawUrl, options, signal) {
    const maxBytes = options.maxBytes ?? MAX_ICON_BYTES;
    const maxRedirects = options.maxRedirects ?? MAX_ICON_REDIRECTS;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    let current = await assertSafePublicHttpsUrl(rawUrl, options.lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        for (let hop = 0; hop <= maxRedirects; hop += 1) {
            const res = await fetchImpl(current.href, {
                signal: ctrl.signal,
                headers: { 'user-agent': options.userAgent, accept: 'image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/avif,*/*;q=0.1' },
                redirect: 'manual',
            });
            if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
                await res.body?.cancel?.().catch(() => { });
                const location = res.headers.get('location');
                if (!location)
                    throw new HttpError('redirect missing location', 502);
                if (hop >= maxRedirects)
                    throw new HttpError('too many icon redirects', 502);
                let nextHref;
                try {
                    nextHref = new URL(location, current).href;
                }
                catch {
                    throw new HttpError('invalid redirect target', 400);
                }
                current = await assertSafePublicHttpsUrl(nextHref, options.lookup);
                continue;
            }
            if (!res.ok) {
                await res.body?.cancel?.().catch(() => { });
                throw new HttpError(`HTTP ${res.status}`, res.status);
            }
            const headerType = (res.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() ?? '';
            if (headerType && headerType !== 'application/octet-stream' && !SAFE_RASTER_ICON_MIME_TYPES.has(headerType)) {
                await res.body?.cancel?.().catch(() => { });
                throw new HttpError(`unsupported icon content-type: ${headerType}`, 415);
            }
            const body = await readBoundedResponseBuffer(res, maxBytes);
            const sniffed = sniffSafeRasterImageMime(body);
            if (!sniffed) {
                throw new HttpError('icon response is not a valid raster image', 415);
            }
            return { body, contentType: sniffed };
        }
        throw new HttpError('too many icon redirects', 502);
    }
    catch (err) {
        if (err instanceof HttpError)
            throw err;
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError')
            throw new HttpError(`timeout ${options.timeoutMs}ms`, 504);
        throw new HttpError(err instanceof Error ? err.message : String(err), 502);
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}
export function pruneAvatarDiskCache(cacheDir, limits = {}) {
    const maxEntries = limits.maxEntries ?? MAX_AVATAR_CACHE_ENTRIES;
    const maxBytes = limits.maxBytes ?? MAX_AVATAR_CACHE_BYTES;
    if (!existsSync(cacheDir))
        return;
    try {
        const files = readdirSync(cacheDir);
        const entries = [];
        let totalBytes = 0;
        for (const file of files) {
            if (!file.endsWith('.bin'))
                continue;
            const hash = file.slice(0, -'.bin'.length);
            const binPath = join(cacheDir, file);
            const metaPath = join(cacheDir, `${hash}.meta.json`);
            try {
                const st = statSync(binPath);
                let savedAt = st.mtimeMs;
                if (existsSync(metaPath)) {
                    try {
                        const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
                        if (typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
                            savedAt = parsed.savedAt;
                        }
                    }
                    catch { }
                }
                totalBytes += st.size;
                entries.push({ hash, binPath, metaPath, size: st.size, savedAt });
            }
            catch { }
        }
        if (entries.length <= maxEntries && totalBytes <= maxBytes)
            return;
        entries.sort((a, b) => a.savedAt - b.savedAt);
        let count = entries.length;
        for (const entry of entries) {
            if (count <= maxEntries && totalBytes <= maxBytes)
                break;
            try {
                rmSync(entry.binPath, { force: true });
            }
            catch { }
            try {
                rmSync(entry.metaPath, { force: true });
            }
            catch { }
            count -= 1;
            totalBytes -= entry.size;
        }
    }
    catch { }
}
