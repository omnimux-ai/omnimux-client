import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const SORTS = ['score', 'downloads', 'stars', 'installs', 'updated_at'];
const CHANNELS = ['custom', 'workbuddy', 'skillhub'];
const DEFAULT_CHANNELS = ['custom', 'workbuddy', 'skillhub'];
export function dshHome() {
    return process.env.DSH_HOME || join(homedir(), '.dsh');
}
export function defaultSkillsDir() {
    return join(dshHome(), 'skills');
}
export function overlayPath() {
    return join(dshHome(), 'omnimux-market.json');
}
export function sanitizeSortBy(raw, fallback = 'score') {
    const value = String(raw || '').trim();
    return SORTS.includes(value) ? value : fallback;
}
export function publicConfig(cfg) {
    return {
        apiBase: cfg.apiBase,
        webBase: cfg.webBase,
        skillsDir: cfg.skillsDir,
        timeoutMs: cfg.timeoutMs,
        maxResults: cfg.maxResults,
        sortBy: cfg.sortBy,
        plazaKeepAlive: cfg.plazaKeepAlive,
        plazaCacheTtlSec: cfg.plazaCacheTtlSec,
        pluginMaxResults: cfg.pluginMaxResults,
        connectorMaxResults: cfg.connectorMaxResults,
        protectedBundlesExtra: [...cfg.protectedBundlesExtra],
        aggregateChannels: [...cfg.aggregateChannels],
        workbuddySkillsMarketplace: cfg.workbuddySkillsMarketplace,
        aggregateRemoteSoftFail: cfg.aggregateRemoteSoftFail,
    };
}
export function readOverlay() {
    try {
        const raw = JSON.parse(readFileSync(overlayPath(), 'utf8'));
        return sanitizePatch(raw);
    }
    catch {
        return {};
    }
}
export function writeOverlay(cfg) {
    const path = overlayPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(publicConfig(cfg), null, 2)}\n`);
}
export function sanitizePatch(raw) {
    const out = {};
    if (typeof raw.apiBase === 'string' && /^https?:\/\//i.test(raw.apiBase.trim()))
        out.apiBase = raw.apiBase.trim().replace(/\/$/, '');
    if (typeof raw.webBase === 'string' && /^https?:\/\//i.test(raw.webBase.trim()))
        out.webBase = raw.webBase.trim().replace(/\/$/, '');
    if (typeof raw.skillsDir === 'string' && raw.skillsDir.trim())
        out.skillsDir = raw.skillsDir.trim();
    if (typeof raw.userAgent === 'string' && raw.userAgent.trim())
        out.userAgent = raw.userAgent.trim();
    const timeout = Number(raw.timeoutMs);
    if (Number.isFinite(timeout) && timeout >= 3000)
        out.timeoutMs = Math.min(timeout, 120000);
    const max = Number(raw.maxResults);
    if (Number.isFinite(max) && max >= 1)
        out.maxResults = Math.min(Math.floor(max), 80);
    if (raw.sortBy !== undefined)
        out.sortBy = sanitizeSortBy(raw.sortBy);
    if (typeof raw.plazaKeepAlive === 'boolean')
        out.plazaKeepAlive = raw.plazaKeepAlive;
    else if (raw.plazaKeepAlive === 'false' || raw.plazaKeepAlive === 0)
        out.plazaKeepAlive = false;
    else if (raw.plazaKeepAlive === 'true' || raw.plazaKeepAlive === 1)
        out.plazaKeepAlive = true;
    const ttl = Number(raw.plazaCacheTtlSec);
    if (Number.isFinite(ttl) && ttl >= 15)
        out.plazaCacheTtlSec = Math.min(Math.floor(ttl), 600);
    const pluginMax = Number(raw.pluginMaxResults);
    if (Number.isFinite(pluginMax) && pluginMax >= 1)
        out.pluginMaxResults = Math.min(Math.floor(pluginMax), 8);
    const connectorMax = Number(raw.connectorMaxResults);
    if (Number.isFinite(connectorMax) && connectorMax >= 1)
        out.connectorMaxResults = Math.min(Math.floor(connectorMax), 8);
    if (Array.isArray(raw.protectedBundlesExtra)) {
        out.protectedBundlesExtra = raw.protectedBundlesExtra
            .map((n) => String(n || '').trim())
            .filter((n) => n && /^(@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/.test(n));
    }
    const channels = parseAggregateChannels(raw.aggregateChannels);
    if (channels)
        out.aggregateChannels = channels;
    if (typeof raw.workbuddySkillsMarketplace === 'string')
        out.workbuddySkillsMarketplace = raw.workbuddySkillsMarketplace.trim();
    if (typeof raw.aggregateRemoteSoftFail === 'boolean')
        out.aggregateRemoteSoftFail = raw.aggregateRemoteSoftFail;
    else if (raw.aggregateRemoteSoftFail === 'false' || raw.aggregateRemoteSoftFail === 0)
        out.aggregateRemoteSoftFail = false;
    else if (raw.aggregateRemoteSoftFail === 'true' || raw.aggregateRemoteSoftFail === 1)
        out.aggregateRemoteSoftFail = true;
    return out;
}
export function parseAggregateChannels(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const out = [];
    for (const row of raw) {
        const value = String(row || '').trim();
        if (!CHANNELS.includes(value) || out.includes(value))
            continue;
        out.push(value);
    }
    return out.length ? out : undefined;
}
export function assignConfig(live, patch) {
    if (patch.apiBase)
        live.apiBase = patch.apiBase;
    if (patch.webBase)
        live.webBase = patch.webBase;
    if (patch.skillsDir)
        live.skillsDir = patch.skillsDir;
    if (patch.userAgent)
        live.userAgent = patch.userAgent;
    if (patch.timeoutMs != null)
        live.timeoutMs = patch.timeoutMs;
    if (patch.maxResults != null)
        live.maxResults = patch.maxResults;
    if (patch.sortBy)
        live.sortBy = patch.sortBy;
    if (patch.plazaKeepAlive != null)
        live.plazaKeepAlive = patch.plazaKeepAlive;
    if (patch.plazaCacheTtlSec != null)
        live.plazaCacheTtlSec = patch.plazaCacheTtlSec;
    if (patch.pluginMaxResults != null)
        live.pluginMaxResults = patch.pluginMaxResults;
    if (patch.connectorMaxResults != null)
        live.connectorMaxResults = patch.connectorMaxResults;
    if (patch.protectedBundlesExtra)
        live.protectedBundlesExtra = [...patch.protectedBundlesExtra];
    if (patch.aggregateChannels)
        live.aggregateChannels = [...patch.aggregateChannels];
    if (patch.workbuddySkillsMarketplace != null)
        live.workbuddySkillsMarketplace = patch.workbuddySkillsMarketplace;
    if (patch.aggregateRemoteSoftFail != null)
        live.aggregateRemoteSoftFail = patch.aggregateRemoteSoftFail;
    return live;
}
export function withDefaults(config) {
    return {
        apiBase: config.apiBase || 'https://api.skillhub.cn',
        webBase: config.webBase || 'https://skillhub.cn',
        skillsDir: config.skillsDir || defaultSkillsDir(),
        timeoutMs: config.timeoutMs || 20000,
        userAgent: config.userAgent || 'Mozilla/5.0 (compatible; skillhub/0.1)',
        maxResults: config.maxResults || 12,
        sortBy: sanitizeSortBy(config.sortBy, 'score'),
        plazaKeepAlive: config.plazaKeepAlive !== false,
        plazaCacheTtlSec: Number.isFinite(Number(config.plazaCacheTtlSec)) && Number(config.plazaCacheTtlSec) >= 15
            ? Math.min(Math.floor(Number(config.plazaCacheTtlSec)), 600)
            : 90,
        pluginMaxResults: clampMarketLimit(config.pluginMaxResults, 6),
        connectorMaxResults: clampMarketLimit(config.connectorMaxResults, 6),
        protectedBundlesExtra: Array.isArray(config.protectedBundlesExtra)
            ? config.protectedBundlesExtra.map((n) => String(n || '').trim()).filter(Boolean)
            : [],
        aggregateChannels: parseAggregateChannels(config.aggregateChannels) || [...DEFAULT_CHANNELS],
        workbuddySkillsMarketplace: typeof config.workbuddySkillsMarketplace === 'string' ? config.workbuddySkillsMarketplace : '',
        aggregateRemoteSoftFail: config.aggregateRemoteSoftFail !== false,
    };
}
function clampMarketLimit(raw, fallback) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1)
        return fallback;
    return Math.min(Math.floor(n), 8);
}
