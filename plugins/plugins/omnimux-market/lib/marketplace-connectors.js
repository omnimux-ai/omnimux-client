import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const TYPE_META = {
    mcp: { id: 'mcp', title: 'MCP' },
    cli: { id: 'cli', title: 'CLI' },
    'skill-only': { id: 'skill-only', title: '仅技能' },
};
/**
 * WorkBuddy 本地连接器市场根目录。
 * 默认真源：`~/.workbuddy/connectors-marketplace`
 */
export function resolveMarketplaceRoot(home = homedir()) {
    if (process.env.WORKBUDDY_CONNECTORS_MARKETPLACE)
        return process.env.WORKBUDDY_CONNECTORS_MARKETPLACE;
    return join(home, '.workbuddy', 'connectors-marketplace');
}
export function marketplaceManifestPath(root = resolveMarketplaceRoot()) {
    return join(root, '.codebuddy-connector', 'connectors.json');
}
export function marketplaceIconsDir(root = resolveMarketplaceRoot()) {
    return join(root, 'icons');
}
/** 广场 icon 代理用的本地标记；真实文件在 icons/<id>.* */
export const MARKETPLACE_ICON_SCHEME = 'marketplace-icon:';
const ICON_EXTS = ['.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif'];
/** root → memoized list (invalidated when manifest mtime/size changes) */
const listMemo = new Map();
/** `${root}\0${id}` → marketplace-icon:<id> or '' */
const iconUrlMemo = new Map();
export function clearMarketplaceConnectorMemos() {
    listMemo.clear();
    iconUrlMemo.clear();
}
export function marketplaceListMemoSize() {
    return listMemo.size;
}
/**
 * 只允许安全 id：字母数字、连字符、下划线、点。拒绝路径穿越。
 */
export function sanitizeMarketplaceIconId(raw) {
    const id = String(raw || '').trim();
    if (!id || id.includes('/') || id.includes('\\') || id.includes('..'))
        return '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id))
        return '';
    return id;
}
/**
 * 按连接器 id 找 `icons/<id>.{svg,png,...}`。找不到返回空串。
 * iconUrl 写成 `marketplace-icon:<id>`，由 `/omnimux-market/icon` 代理读盘。
 * 结果按 root+id memo，热路径不反复 6× existsSync。
 */
export function resolveMarketplaceIconUrl(id, root = resolveMarketplaceRoot()) {
    const safeId = sanitizeMarketplaceIconId(id);
    if (!safeId)
        return '';
    const key = `${root}\0${safeId}`;
    if (iconUrlMemo.has(key))
        return iconUrlMemo.get(key) || '';
    const dir = marketplaceIconsDir(root);
    let url = '';
    for (const ext of ICON_EXTS) {
        const path = join(dir, `${safeId}${ext}`);
        if (existsSync(path)) {
            url = `${MARKETPLACE_ICON_SCHEME}${safeId}`;
            break;
        }
    }
    iconUrlMemo.set(key, url);
    return url;
}
/** 把 marketplace-icon:<id> 解析成绝对路径；越界或不存在返回 null。 */
export function resolveMarketplaceIconFile(iconRef, root = resolveMarketplaceRoot()) {
    if (!iconRef.startsWith(MARKETPLACE_ICON_SCHEME))
        return null;
    const safeId = sanitizeMarketplaceIconId(iconRef.slice(MARKETPLACE_ICON_SCHEME.length));
    if (!safeId)
        return null;
    const dir = marketplaceIconsDir(root);
    for (const ext of ICON_EXTS) {
        const path = join(dir, `${safeId}${ext}`);
        if (!existsSync(path))
            continue;
        return { path, contentType: contentTypeForExt(ext) };
    }
    return null;
}
function contentTypeForExt(ext) {
    switch (ext.toLowerCase()) {
        case '.svg': return 'image/svg+xml';
        case '.png': return 'image/png';
        case '.webp': return 'image/webp';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        default: return 'application/octet-stream';
    }
}
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function pickText(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return '';
}
function normalizeType(raw) {
    if (raw === 'cli')
        return 'cli';
    if (raw === 'skill-only')
        return 'skill-only';
    return 'mcp';
}
/**
 * 读本地市场清单，映射成广场卡片。**不过滤** `visible_in`。
 * 按 manifest mtime+size memo；iconUrl 解析一次写入卡片。
 */
export function listMarketplaceConnectors(root = resolveMarketplaceRoot()) {
    const manifestPath = marketplaceManifestPath(root);
    let st;
    try {
        st = statSync(manifestPath);
    }
    catch {
        return { items: [], categories: [] };
    }
    const hit = listMemo.get(root);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        return { items: hit.items, categories: hit.categories };
    }
    let doc;
    try {
        doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    }
    catch {
        return { items: [], categories: [] };
    }
    const body = asRecord(doc);
    const rawItems = Array.isArray(body?.connectors) ? body.connectors : [];
    const usedTypes = new Set();
    const items = [];
    for (const row of rawItems) {
        const entry = asRecord(row);
        if (!entry)
            continue;
        const id = pickText(entry.id, entry.source, entry.name);
        if (!id)
            continue;
        const connectorType = normalizeType(entry.type);
        usedTypes.add(connectorType);
        const meta = TYPE_META[connectorType];
        items.push({
            id,
            slug: id,
            name: pickText(entry.name_zh, entry.name, entry.name_en, id),
            description: pickText(entry.description_zh, entry.description, entry.description_en),
            iconUrl: resolveMarketplaceIconUrl(id, root),
            category: meta.id,
            categoryLabel: meta.title,
            installed: false,
            kind: 'connector',
            gesture: '',
            installable: false,
            sourceKind: 'marketplace',
            connectorType,
        });
    }
    const categories = ['mcp', 'cli', 'skill-only']
        .filter((id) => usedTypes.has(id))
        .map((id) => ({ id: TYPE_META[id].id, title: TYPE_META[id].title, tab: 'connectors' }));
    listMemo.set(root, { mtimeMs: st.mtimeMs, size: st.size, items, categories });
    return { items, categories };
}
