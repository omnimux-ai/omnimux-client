import { categoryLabel, parseCategory } from './categories.js';
import { fetchJson } from './http.js';
import { sanitizeSortBy } from './config-store.js';
export function parseSlug(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0'))
        throw new Error('无效 slug');
    const s = trimmed.replace(/^@/, '');
    const slug = s.includes('/') ? s.split('/').filter(Boolean).pop() || '' : s;
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(slug))
        throw new Error('无效 slug');
    return slug.toLowerCase();
}
export function flattenDetail(raw) {
    const skill = raw?.skill || {};
    const stats = skill.stats || {};
    return {
        slug: String(skill.slug || raw?.slug || ''),
        name: String(skill.displayName || skill.name || ''),
        description: String(skill.summary || skill.description || ''),
        description_zh: String(skill.summary_zh || skill.description_zh || ''),
        category: String(skill.category || ''),
        downloads: Number(stats.downloads ?? skill.downloads) || 0,
        stars: Number(stats.stars ?? skill.stars) || 0,
        installs: Number(stats.installs ?? skill.installs) || 0,
        version: String(raw?.latestVersion?.version || skill.version || ''),
        iconUrl: skill.iconUrl,
        ownerName: raw?.owner?.handle || skill.ownerName,
        publisher: raw?.publisher || skill.publisher,
        namespace: raw?.namespace || skill.namespace,
        securityReports: raw?.securityReports || skill.securityReports,
    };
}
export async function fetchSkillCard(slug, cfg, installed, signal, fetchJsonImpl) {
    const id = parseSlug(slug);
    const fetchImpl = fetchJsonImpl || fetchJson;
    const url = `${cfg.apiBase.replace(/\/$/, '')}/api/v1/skills/${encodeURIComponent(id)}`;
    try {
        const raw = await fetchImpl(url, fetchOpts(cfg), signal);
        const card = mapSkill(flattenDetail(raw), cfg.webBase, installed);
        if (!card?.version)
            return card;
        try {
            const sigUrl = `${cfg.apiBase.replace(/\/$/, '')}/api/v1/open/skills/${encodeURIComponent(id)}/versions/${encodeURIComponent(card.version)}/signature`;
            const integrity = mapIntegrity(await fetchImpl(sigUrl, fetchOpts(cfg), signal));
            if (integrity)
                card.integrity = integrity;
        }
        catch { /* signature is optional */ }
        return card;
    }
    catch {
        return null;
    }
}
export function mapSkill(raw, webBase, installed) {
    const slug = String(raw.slug || raw.namespace?.publicSlug || '').trim();
    if (!slug)
        return null;
    const name = String(raw.name || slug).trim();
    const description = String(raw.description_zh || raw.description || '').trim();
    const category = String(raw.category || '').trim();
    const id = String(raw.namespace?.canonicalName || `@${raw.ownerName || 'skill'}/${slug}`);
    const card = {
        id,
        slug,
        name,
        description,
        category,
        categoryLabel: categoryLabel(category),
        version: String(raw.version || '').trim(),
        downloads: Number(raw.downloads) || 0,
        stars: Number(raw.stars) || 0,
        installs: Number(raw.installs) || 0,
        pageUrl: `${webBase.replace(/\/$/, '')}/skills/${encodeURIComponent(slug)}`,
        owner: raw.ownerName || raw.namespace?.handle,
        installed: installed?.has(slug) || false,
        channel: 'skillhub',
        installBackend: 'skillhub',
    };
    if (raw.iconUrl)
        card.iconUrl = String(raw.iconUrl);
    const publisher = raw.publisher;
    if (publisher?.verified) {
        card.verified = true;
        const pubName = String(publisher.name || '').trim();
        if (pubName)
            card.publisherName = pubName;
    }
    const security = mapSecurityReports(raw.securityReports);
    if (security)
        card.security = security;
    return card;
}
const VISIBLE_SECURITY = new Set(['benign', 'scanning', 'suspicious', 'malicious']);
export function mapSecurityReports(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const src = raw;
    const out = {};
    const keen = mapSecurityReport(src.keen);
    const sanbu = mapSecurityReport(src.sanbu);
    if (keen)
        out.keen = keen;
    if (sanbu)
        out.sanbu = sanbu;
    return out.keen || out.sanbu ? out : undefined;
}
function mapSecurityReport(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const r = raw;
    const status = String(r.status || '').toLowerCase();
    if (!VISIBLE_SECURITY.has(status))
        return undefined;
    const report = {
        status: status,
        statusText: String(r.statusText || '').slice(0, 80),
    };
    const url = String(r.reportUrl || '');
    if (/^https:\/\//i.test(url) && !url.includes('..'))
        report.reportUrl = url;
    return report;
}
export function mapIntegrity(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const r = raw;
    const contentHash = String(r.content_hash || '').replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
    const signature = String(r.signature || '').replace(/\s+/g, '').slice(0, 200);
    if (!contentHash && !signature)
        return undefined;
    return {
        signed: r.signed === true && !!signature,
        contentHash: contentHash || undefined,
        signature: signature || undefined,
    };
}
export function parseSearchResponse(body, webBase, installed) {
    if (body.code !== 0 || !body.data)
        throw new Error(body.message || 'SkillHub 返回错误');
    const items = [];
    for (const raw of body.data.skills || []) {
        const card = mapSkill(raw, webBase, installed);
        if (card)
            items.push(card);
    }
    return { items, total: Number(body.data.total) || items.length };
}
export function collectQueries(query, extra) {
    const out = [];
    const add = (raw) => {
        const t = String(raw || '').trim();
        if (t.length < 2)
            return;
        if (out.some((x) => x.toLowerCase() === t.toLowerCase()))
            return;
        out.push(t);
    };
    add(query);
    if (Array.isArray(extra))
        extra.forEach(add);
    else if (typeof extra === 'string')
        extra.split(/[,，、|]/).forEach(add);
    return out.slice(0, 4);
}
/**
 * Reciprocal-rank constant from the classic RRF recipe; keeps deep ranks from
 * vanishing without letting one keyword page dominate the merged group.
 */
const MERGE_RRF_K = 60;
function prefersRepresentative(next, prev, sortBy) {
    if (sortBy === 'stars')
        return next.stars > prev.stars || (next.stars === prev.stars && next.downloads > prev.downloads);
    if (sortBy === 'installs')
        return next.installs > prev.installs || (next.installs === prev.installs && next.downloads > prev.downloads);
    if (sortBy === 'updated_at')
        return false;
    return next.downloads > prev.downloads || (next.downloads === prev.downloads && next.stars > prev.stars);
}
/**
 * Merge per-keyword SkillHub pages.
 *
 * `sortBy: 'score'` keeps the relevance signal every keyword page carries: how
 * many keyword pages matched the slug and its reciprocal rank in each page.
 * Downloads/stars only break a genuine relevance tie, so a high-download but
 * weakly related result cannot push a strongly related result out.
 * Explicit `downloads` / `stars` / `installs` sort by that metric. The list
 * payload has no timestamp, so `updated_at` keeps the server-provided order.
 */
export function mergeBySlug(groups, sortBy = 'score') {
    const seen = new Map();
    let index = 0;
    for (const items of groups) {
        for (let rank = 0; rank < items.length; rank += 1) {
            const it = items[rank];
            if (!it || typeof it.slug !== 'string' || !it.slug) {
                index += 1;
                continue;
            }
            const prev = seen.get(it.slug);
            if (!prev) {
                seen.set(it.slug, { card: it, hits: 1, rrf: 1 / (MERGE_RRF_K + rank + 1), first: index });
            }
            else {
                prev.hits += 1;
                prev.rrf += 1 / (MERGE_RRF_K + rank + 1);
                if (prefersRepresentative(it, prev.card, sortBy))
                    prev.card = it;
            }
            index += 1;
        }
    }
    const rows = [...seen.values()];
    if (sortBy === 'score') {
        return rows
            .sort((a, b) => (b.hits - a.hits)
            || (b.rrf - a.rrf)
            || (b.card.downloads - a.card.downloads)
            || (b.card.stars - a.card.stars)
            || (a.first - b.first))
            .map((row) => row.card);
    }
    if (sortBy === 'updated_at') {
        // No timestamp in the list payload: preserve the per-page server order.
        return rows.sort((a, b) => a.first - b.first).map((row) => row.card);
    }
    const metric = sortBy === 'stars' ? 'stars' : sortBy === 'installs' ? 'installs' : 'downloads';
    return rows
        .sort((a, b) => (b.card[metric] - a.card[metric])
        || (b.card.downloads - a.card.downloads)
        || (b.card.stars - a.card.stars)
        || (a.first - b.first))
        .map((row) => row.card);
}
export function pageFromOffset(offset, limit) {
    const pageSize = Math.max(1, Math.min(100, Math.floor(limit) || 12));
    const off = Math.max(0, Math.floor(offset) || 0);
    return {
        page: Math.floor(off / pageSize) + 1,
        pageSize,
        skip: off % pageSize,
    };
}
export async function searchSkills(query, options) {
    const cfg = options.cfg;
    const limit = clamp(options.limit ?? cfg.maxResults, 1, 80);
    const offset = Math.max(0, Math.floor(options.offset || 0));
    const category = parseCategory(options.category);
    const keywords = collectQueries(query, options.queries);
    const browsing = keywords.length === 0;
    const sortBy = sanitizeSortBy(options.sortBy, browsing ? 'downloads' : cfg.sortBy);
    const fetchImpl = options.fetchJsonImpl || fetchJson;
    const pageOpts = {
        cfg,
        category,
        sortBy,
        installed: options.installed,
        signal: options.signal,
        fetchImpl,
    };
    const single = async (keyword, off) => {
        const { page, pageSize, skip } = pageFromOffset(off, limit);
        const parsed = await fetchPage(keyword, { ...pageOpts, page, pageSize });
        const items = parsed.items.slice(skip, skip + limit);
        return {
            query: keyword,
            queries: keyword ? [keyword] : [],
            category,
            sortBy,
            items,
            total: parsed.total,
            offset: off,
            hasMore: off + items.length < parsed.total,
        };
    };
    if (offset > 0 || keywords.length <= 1) {
        const first = await single(keywords[0] || '', offset);
        if (first.items.length)
            return first;
        const popular = await single('', 0);
        return { ...popular, query: keywords[0] || '', fallback: true };
    }
    const pageSize = clamp(Math.max(limit, 12), 1, 40);
    const pages = await Promise.all(keywords.map((keyword) => fetchPage(keyword, { ...pageOpts, page: 1, pageSize })));
    const merged = mergeBySlug(pages.map((p) => p.items), sortBy);
    const items = merged.slice(0, limit);
    if (items.length) {
        return {
            query: keywords[0],
            queries: keywords,
            category,
            sortBy,
            items,
            total: Math.max(merged.length, ...pages.map((p) => p.total)),
            offset: 0,
            hasMore: pages.some((p) => p.total > items.length) || merged.length > items.length,
        };
    }
    const popular = await single('', 0);
    return { ...popular, query: keywords[0] || '', fallback: true };
}
async function fetchPage(keyword, options) {
    const params = new URLSearchParams();
    if (keyword)
        params.set('keyword', keyword);
    if (options.category)
        params.set('category', options.category);
    params.set('sortBy', options.sortBy);
    params.set('order', 'desc');
    params.set('page', String(options.page));
    params.set('pageSize', String(options.pageSize));
    const url = `${options.cfg.apiBase.replace(/\/$/, '')}/api/skills?${params.toString()}`;
    const body = await options.fetchImpl(url, fetchOpts(options.cfg), options.signal);
    return parseSearchResponse(body, options.cfg.webBase, options.installed);
}
export function fetchOpts(cfg) {
    return { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent };
}
export function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
