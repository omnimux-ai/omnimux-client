import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDshPlugin, webProfileDir } from './dsh-cli.js';
import { fetchJson } from './http.js';
export { runCommand, webProfileDir } from './dsh-cli.js';
export const PLUGIN_REPO = 'cocofhu/skillhub';
export const PLUGIN_GITHUB_SPEC = `github:${PLUGIN_REPO}`;
const defaultDeps = {
    fetchJson,
    runDshPlugin,
    readPackageJson,
    readProfilePackage,
    profileDir: webProfileDir,
};
export function packageRoot() {
    return join(dirname(fileURLToPath(import.meta.url)), '..');
}
export function readPackageJson(root = packageRoot()) {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}
export function readProfilePackage(profileDir = webProfileDir()) {
    return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
}
export function normalizeVersion(raw) {
    return String(raw || '').trim().replace(/^v/i, '');
}
export function parseReleaseTag(tag) {
    const version = normalizeVersion(tag);
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
        throw new Error(`无效 release 标签: ${tag}`);
    return version;
}
export function compareSemver(a, b) {
    const pa = normalizeVersion(a).split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
    const pb = normalizeVersion(b).split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d)
            return d > 0 ? 1 : -1;
    }
    return 0;
}
export function detectSource(spec) {
    const value = String(spec || '');
    if (/^link:/i.test(value) || value.startsWith('file:'))
        return 'link';
    if (/github:cocofhu\/skillhub/i.test(value) || /github\.com\/cocofhu\/skillhub/i.test(value))
        return 'github';
    return 'unknown';
}
export async function fetchLatestRelease(opts, deps = defaultDeps, signal) {
    const url = `https://api.github.com/repos/${PLUGIN_REPO}/releases/latest`;
    const raw = await deps.fetchJson(url, opts, signal);
    const tag = String(raw.tag_name || '').trim();
    const version = parseReleaseTag(tag);
    return {
        tag: tag.startsWith('v') ? tag : `v${version}`,
        version,
        htmlUrl: String(raw.html_url || `https://github.com/${PLUGIN_REPO}/releases/tag/${tag}`),
        name: String(raw.name || tag),
    };
}
export async function getUpdateStatus(opts, deps = defaultDeps, signal) {
    const profileDir = deps.profileDir();
    const pkg = deps.readPackageJson();
    const currentVersion = normalizeVersion(pkg.version || '0.0.0') || '0.0.0';
    let source = 'unknown';
    try {
        const profile = deps.readProfilePackage(profileDir);
        source = detectSource(profile.dependencies?.skillhub);
    }
    catch {
        source = 'unknown';
    }
    const latest = await fetchLatestRelease(opts, deps, signal);
    const upToDate = compareSemver(currentVersion, latest.version) >= 0 && source !== 'link';
    const canUpdate = source === 'link' || compareSemver(currentVersion, latest.version) < 0;
    let message;
    if (source === 'link')
        message = '当前是本地开发链接，更新会改成 GitHub release 安装';
    else if (upToDate)
        message = '已是最新 release';
    return {
        currentVersion,
        latest,
        upToDate,
        source,
        profileDir,
        canUpdate,
        message,
    };
}
export async function updateToLatestRelease(opts, deps = defaultDeps, signal) {
    const status = await getUpdateStatus(opts, deps, signal);
    if (!status.latest)
        throw new Error('未找到最新 release');
    if (!status.canUpdate) {
        return { ...status, updated: false, restartedHint: false };
    }
    const spec = `${PLUGIN_GITHUB_SPEC}#${status.latest.tag}`;
    const log = await deps.runDshPlugin('web', ['add', spec]);
    const after = deps.readPackageJson();
    return {
        ...status,
        currentVersion: normalizeVersion(after.version || status.latest.version),
        source: 'github',
        upToDate: true,
        canUpdate: false,
        updated: true,
        restartedHint: true,
        message: `已更新到 ${status.latest.tag}，请重启 dsh web 并强制刷新浏览器`,
        log: log.slice(-4000),
    };
}
