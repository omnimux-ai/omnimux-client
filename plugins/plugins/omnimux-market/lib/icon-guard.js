import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
    // ::ffff:0:0/96 (IPv4-mapped IPv6) -> check embedded IPv4
    if (zeroPrefix && w5 === 0xffff) {
        const embedded = `${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`;
        return isBlockedIpv4(embedded);
    }
    // Fail-closed: only global unicast 2000::/3 is permitted outside IPv4-mapped public addresses.
    // This blocks ::/128, ::1/128, ::/96, ::ffff:0:0:0/96 (RFC 2765), 64:ff9b::/96, 64:ff9b:1::/48,
    // 100::/64, fc00::/7, fe80::/10, fec0::/10, ff00::/8, and unallocated ranges (e.g. 4000::/2).
    if ((w0 & 0xe000) !== 0x2000)
        return true;
    // 2001::/23 (IETF protocol assignments, including Teredo 2001::/32 and benchmarking 2001:2::/48)
    if (w0 === 0x2001 && w1 < 0x0200)
        return true;
    // 2001:db8::/32 (documentation)
    if (w0 === 0x2001 && w1 === 0x0db8)
        return true;
    // 2002::/16 (deprecated 6to4)
    if (w0 === 0x2002)
        return true;
    // 3fff::/20 (RFC 9637 documentation)
    if (w0 === 0x3fff && w1 < 0x1000)
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
export function assertSafeIconUrlSyntax(rawUrl) {
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
    if (parsed.port !== '' && parsed.port !== '443') {
        throw new HttpError('non-default HTTPS port is not allowed for icon URLs', 400);
    }
    if (parsed.username || parsed.password) {
        throw new HttpError('credentials in icon URL are not allowed', 400);
    }
    const host = normalizeHostname(parsed.hostname);
    if (isBlockedIconHostname(host)) {
        throw new HttpError('blocked private or loopback icon target', 400);
    }
    return parsed;
}
async function resolveSafePublicHttpsTarget(rawUrl, lookup) {
    const parsed = assertSafeIconUrlSyntax(rawUrl);
    const host = normalizeHostname(parsed.hostname);
    const withoutZone = host.split('%')[0] ?? host;
    const literalFamily = isIP(withoutZone);
    if (literalFamily === 4 || literalFamily === 6) {
        return { url: parsed, host, addresses: [{ address: withoutZone, family: literalFamily }] };
    }
    const lookupFn = lookup ?? defaultLookupWithTimeout;
    let rawAddresses;
    try {
        rawAddresses = await lookupFn(host);
    }
    catch {
        throw new HttpError('icon host DNS resolution failed', 400);
    }
    if (!Array.isArray(rawAddresses) || rawAddresses.length === 0) {
        throw new HttpError('icon host resolved to no addresses', 400);
    }
    const validated = [];
    for (const entry of rawAddresses) {
        if (!entry || typeof entry.address !== 'string' || isBlockedIconIp(entry.address)) {
            throw new HttpError('icon host resolved to blocked IP', 400);
        }
        const family = isIP(entry.address);
        if (family !== 4 && family !== 6) {
            throw new HttpError('icon host resolved to invalid IP', 400);
        }
        validated.push({ address: entry.address, family });
    }
    return { url: parsed, host, addresses: validated };
}
export async function assertSafePublicHttpsUrl(rawUrl, lookup) {
    const resolved = await resolveSafePublicHttpsTarget(rawUrl, lookup);
    return resolved.url;
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
/**
 * Single-hop HTTPS transport pinning the exact pre-validated DNS IP on socket connect
 * so a TTL=0 DNS rebinding response cannot redirect the TCP connection to an internal host.
 */
function pinnedHttpsFetch(target, headers, signal, requestImpl = httpsRequest) {
    return new Promise((resolve, reject) => {
        const pinnedLookup = (_hostname, opts, cb) => {
            const callback = typeof opts === 'function' ? opts : cb;
            const all = typeof opts === 'object' && opts !== null && opts.all === true;
            if (all) {
                ;
                callback(null, target.addresses.map((entry) => ({ address: entry.address, family: entry.family })));
            }
            else {
                const first = target.addresses[0];
                callback(null, first.address, first.family);
            }
        };
        const reqOptions = {
            method: 'GET',
            headers: { ...headers, 'accept-encoding': 'identity' },
            signal,
            agent: false,
            lookup: pinnedLookup,
            ...(isIP(target.host) === 0 ? { servername: target.host } : {}),
        };
        const req = requestImpl(target.url, reqOptions, (incoming) => {
            try {
                const status = incoming.statusCode ?? 500;
                if (!Number.isInteger(status) || status < 200 || status > 599) {
                    incoming.destroy();
                    reject(new HttpError('unsupported HTTP status', 502));
                    return;
                }
                const resHeaders = new Headers();
                for (const [key, value] of Object.entries(incoming.headers)) {
                    if (value !== undefined) {
                        resHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value));
                    }
                }
                if (status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400)) {
                    incoming.on('error', reject);
                    incoming.resume();
                    resolve(new Response(null, { status, headers: resHeaders }));
                    return;
                }
                const webStream = Readable.toWeb(incoming);
                resolve(new Response(webStream, { status, headers: resHeaders }));
            }
            catch (error) {
                incoming.destroy();
                req.destroy();
                reject(error);
            }
        });
        req.on('error', reject);
        req.end();
    });
}
export async function fetchSafeIconBytes(rawUrl, options, signal) {
    const maxBytes = options.maxBytes ?? MAX_ICON_BYTES;
    const maxRedirects = options.maxRedirects ?? MAX_ICON_REDIRECTS;
    let current = await resolveSafePublicHttpsTarget(rawUrl, options.lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const reqHeaders = {
        'user-agent': options.userAgent,
        accept: 'image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/avif,*/*;q=0.1',
    };
    try {
        for (let hop = 0; hop <= maxRedirects; hop += 1) {
            const res = options.fetchImpl
                ? await options.fetchImpl(current.url.href, {
                    signal: ctrl.signal,
                    headers: reqHeaders,
                    redirect: 'manual',
                })
                : await pinnedHttpsFetch(current, reqHeaders, ctrl.signal, options.requestImpl);
            if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
                await res.body?.cancel?.().catch(() => { });
                const location = res.headers.get('location');
                if (!location)
                    throw new HttpError('redirect missing location', 502);
                if (hop >= maxRedirects)
                    throw new HttpError('too many icon redirects', 502);
                let nextHref;
                try {
                    nextHref = new URL(location, current.url).href;
                }
                catch {
                    throw new HttpError('invalid redirect target', 400);
                }
                current = await resolveSafePublicHttpsTarget(nextHref, options.lookup);
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
        if (name === 'AbortError' || ctrl.signal.aborted)
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
        const now = Date.now();
        for (const file of files) {
            if (file.endsWith('.tmp')) {
                const tmpPath = join(cacheDir, file);
                try {
                    const st = lstatSync(tmpPath);
                    if (!st.isSymbolicLink() && st.isFile() && now - st.mtimeMs > 60_000) {
                        rmSync(tmpPath, { force: true });
                    }
                }
                catch { }
                continue;
            }
            if (!file.endsWith('.bin'))
                continue;
            const hash = file.slice(0, -'.bin'.length);
            const binPath = join(cacheDir, file);
            const metaPath = join(cacheDir, `${hash}.meta.json`);
            try {
                const st = lstatSync(binPath);
                if (st.isSymbolicLink() || !st.isFile())
                    continue;
                let savedAt = st.mtimeMs;
                if (existsSync(metaPath)) {
                    try {
                        const metaSt = lstatSync(metaPath);
                        if (!metaSt.isSymbolicLink() && metaSt.isFile() && metaSt.size <= 16 * 1024) {
                            const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
                            if (typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
                                savedAt = parsed.savedAt;
                            }
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
