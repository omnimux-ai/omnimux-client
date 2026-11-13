import { fetchOpts, parseSlug } from './api.js';
import { fetchJson } from './http.js';
export const TRACE_DIMS = [
    { key: 'trust', letter: 'T', name: '可信任度' },
    { key: 'reliability', letter: 'R', name: '可靠性' },
    { key: 'adaptability', letter: 'A', name: '适用性' },
    { key: 'convention', letter: 'C', name: '规范性' },
    { key: 'effectiveness', letter: 'E', name: '有效性' },
];
const defaultDeps = { fetchJson };
/** Evaluation score memo: slug → { at, score }. Default TTL 20 min. */
const evalScoreMemo = new Map();
const EVAL_TTL_MS = 20 * 60 * 1000;
let evalNow = () => Date.now();
/** Test hook. */
export function setEvalNow(fn) {
    evalNow = fn;
}
export function resetEvalNow() {
    evalNow = () => Date.now();
}
export function clearEvalScoreMemo() {
    evalScoreMemo.clear();
}
export function evalScoreMemoSize() {
    return evalScoreMemo.size;
}
export function dimScore(dim) {
    if (!dim || typeof dim !== 'object')
        return null;
    const items = dim.items;
    const scores = Object.values(items || {}).map((it) => Number(it?.score)).filter((n) => Number.isFinite(n));
    if (!scores.length)
        return null;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}
export function overallScore(dimensions) {
    const scores = TRACE_DIMS.map((d) => dimScore(dimensions?.[d.key])).filter((n) => n != null);
    if (!scores.length)
        return null;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}
export async function fetchEvalScore(slug, cfg, deps = defaultDeps, signal) {
    const id = parseSlug(slug);
    const hit = evalScoreMemo.get(id);
    if (hit && evalNow() - hit.at < EVAL_TTL_MS)
        return hit.score;
    try {
        const raw = await deps.fetchJson(url(cfg, id, 'evaluation'), fetchOpts(cfg), signal);
        const score = overallScore(raw.dimensions);
        evalScoreMemo.set(id, { at: evalNow(), score });
        return score;
    }
    catch {
        evalScoreMemo.set(id, { at: evalNow(), score: null });
        return null;
    }
}
export async function fetchSkillTab(slug, tab, cfg, deps = defaultDeps, signal) {
    const id = parseSlug(slug);
    if (tab === 'versions') {
        const raw = await deps.fetchJson(url(cfg, id, 'versions'), fetchOpts(cfg), signal);
        return {
            tab,
            versions: (raw.versions || []).slice(0, 40).map((v) => ({
                version: String(v.version || ''),
                changelog: String(v.changelog || '').slice(0, 500),
                createdAt: Number(v.createdAt) || 0,
            })),
        };
    }
    if (tab === 'evaluation') {
        try {
            const raw = await deps.fetchJson(url(cfg, id, 'evaluation'), fetchOpts(cfg), signal);
            return { tab, evaluation: sanitizeEval(raw) };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/404|not found/i.test(msg))
                return { tab, evaluation: null };
            throw err;
        }
    }
    throw new Error(`未知 tab: ${tab}`);
}
function sanitizeEval(raw) {
    const dimensions = {};
    for (const dim of TRACE_DIMS) {
        const src = raw.dimensions?.[dim.key];
        if (!src || typeof src !== 'object')
            continue;
        const items = {};
        for (const [key, it] of Object.entries(src.items || {})) {
            items[key] = { score: Number(it?.score) || 0, userReason: String(it?.userReason || '').slice(0, 400) };
        }
        dimensions[dim.key] = {
            score: dimScore(src),
            userReason: String(src.userReason || '').slice(0, 1200),
            items,
        };
    }
    return {
        userSummary: String(raw.userSummary || raw.summary || '').slice(0, 1200),
        score: overallScore(raw.dimensions),
        dimensions,
    };
}
function url(cfg, slug, suffix) {
    return `${cfg.apiBase.replace(/\/$/, '')}/api/v1/skills/${encodeURIComponent(slug)}/${suffix}`;
}
