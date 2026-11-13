export class HttpError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
const jsonCache = new Map();
let nowMs = () => Date.now();
/** Default TTL for SkillHub JSON memo (ms). Host wires `plazaCacheTtlSec`. */
let defaultTtlMs = 90_000;
/** Test hook: fake clock for TTL assertions. */
export function setHttpNow(fn) {
    nowMs = fn;
}
export function resetHttpNow() {
    nowMs = () => Date.now();
}
export function configureHttpJsonCache(opts = {}) {
    if (opts.ttlMs != null && Number.isFinite(opts.ttlMs) && opts.ttlMs >= 0) {
        defaultTtlMs = Math.floor(opts.ttlMs);
    }
}
export function clearHttpJsonCache() {
    jsonCache.clear();
}
export function httpJsonCacheSize() {
    return jsonCache.size;
}
function cacheKey(url, options) {
    return `${options.userAgent || ''}\n${url}`;
}
function wantsRefresh(url, options) {
    if (options.refresh)
        return true;
    try {
        const u = new URL(url);
        return u.searchParams.get('refresh') === '1';
    }
    catch {
        return false;
    }
}
export async function fetchJson(url, options, signal) {
    const ttl = options.cacheTtlMs != null ? options.cacheTtlMs : defaultTtlMs;
    const refresh = wantsRefresh(url, options);
    const key = cacheKey(url, options);
    if (!refresh && ttl > 0) {
        const hit = jsonCache.get(key);
        if (hit && nowMs() - hit.at < ttl)
            return hit.value;
    }
    const value = await fetchJsonUncached(url, options, signal);
    if (ttl > 0)
        jsonCache.set(key, { at: nowMs(), value });
    return value;
}
/** Direct network path used by tests that need to assert cache bypasses. */
export async function fetchJsonUncached(url, options, signal) {
    const res = await request(url, options, signal);
    return res.json();
}
export async function fetchBytes(url, options, signal) {
    const res = await request(url, options, signal);
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}
async function request(url, options, signal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'user-agent': options.userAgent, accept: '*/*' },
            redirect: 'follow',
        });
        if (!res.ok)
            throw new HttpError(`HTTP ${res.status} ${url}`, res.status);
        return res;
    }
    catch (err) {
        if (err instanceof HttpError)
            throw err;
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError')
            throw new HttpError(`timeout ${options.timeoutMs}ms ${url}`);
        throw new HttpError(err instanceof Error ? err.message : String(err));
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}
