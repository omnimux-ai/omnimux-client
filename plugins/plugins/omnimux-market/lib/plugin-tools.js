import { INSTALL_TIMEOUT_MS, isSafePluginName } from './dsh-cli.js';
import { renderPluginInstall, renderPluginList, renderPluginSearch, renderPluginUninstall, } from './host-render.js';
import { parsePluginCategory, parsePluginRef, sanitizePluginScope, } from './plugin-market.js';
export const PLUGIN_PROMPT_LINES = [
    'If the user did not name a DSH plugin, 插件市场, or `dsh plugin`, you MUST NOT call plugin_*.',
    'In the same user message, pick at most one of plaza_search, skillhub_search, plugin_search, connector_search (experts / SkillHub skills / DSH plugins / connectors).',
    'After plugin_search, reply with AT MOST one short sentence. Do NOT list plugins as markdown. Do NOT print `dsh plugin add/remove` or curl.',
    'If plugin_uninstall returns cannot be removed, explain in one sentence. Never switch to bash to uninstall.',
    'After plugin_install / plugin_uninstall succeed, say the result and that the user must restart Host themselves. Never claim you already restarted.',
    'Do not plaza_summon a plugin or connector.',
];
function clampPluginLimit(raw, fallback) {
    const n = Number(raw);
    const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    return Math.max(1, Math.min(8, base));
}
function text(render) {
    return (_args, value) => [{ type: 'text', text: render(value) }];
}
export function createPluginTools(deps) {
    return [
        {
            name: 'plugin_search',
            description: 'Search the SkillHub DSH plugin catalog. Use only when the user named a DSH plugin, 插件市场, or `dsh plugin`. Returns owner/name cards. Do not use for SkillHub skills or plaza experts.',
            parameters: {
                query: { type: 'string', description: 'Keyword, e.g. sidebar. Optional to browse verified plugins.' },
                category: { type: 'string', description: 'Optional plugin category key (fun-dressup, web-tools, memory, …).' },
                scope: { type: 'string', description: 'verified | all. Default verified.' },
                limit: { type: 'number', description: 'Cards to return, 1–8. Default from config (6).' },
                offset: { type: 'number', description: 'Skip this many already-shown cards.' },
            },
            output: {
                schema: { type: 'object', additionalProperties: true },
                render: text((value) => renderPluginSearch(value)),
                presentationMeta: (_args, value) => ({ kind: 'plugin-search', ...value }),
            },
            presentCall: (args) => ({
                card: 'generic',
                title: `插件 · ${String(args.query || args.category || '浏览')}`,
                kind: 'search',
                content: [],
            }),
            presentResult: (_args, { isError, meta }) => ({
                card: 'generic',
                title: isError ? '插件搜索失败' : `插件 · ${meta?.items?.length ?? 0} 条`,
                content: [],
            }),
            async execute(args) {
                const cfg = deps.cfg();
                const limit = clampPluginLimit(args.limit, cfg.pluginMaxResults);
                const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
                const page = Math.floor(offset / limit) + 1;
                const result = await deps.listPlugins(cfg, {
                    q: String(args.query || '').trim(),
                    category: parsePluginCategory(args.category),
                    scope: sanitizePluginScope(args.scope),
                    page,
                    pageSize: limit,
                });
                return {
                    query: String(args.query || '').trim(),
                    scope: sanitizePluginScope(args.scope),
                    category: parsePluginCategory(args.category) || '',
                    offset,
                    total: result.total,
                    items: result.items.slice(0, limit).map((it) => ({
                        owner: it.owner,
                        name: it.name,
                        fullName: it.fullName,
                        description: it.description,
                        stars: it.stars,
                        categoryKey: it.categoryKey,
                        installability: it.installability,
                        installed: it.installed,
                    })),
                };
            },
        },
        {
            name: 'plugin_install',
            description: 'Install a verified DSH plugin from SkillHub by owner/name from plugin_search. Does not restart Host. Never print `dsh plugin add`.',
            parameters: {
                owner: { type: 'string', required: true, description: 'GitHub owner from plugin_search, e.g. liustack' },
                name: { type: 'string', required: true, description: 'Repository name from plugin_search, e.g. modlens' },
            },
            output: {
                schema: { type: 'object', additionalProperties: true },
                render: text((value) => renderPluginInstall(value)),
                presentationMeta: (_args, value) => ({ kind: 'plugin-install', ...value }),
            },
            presentCall: (args) => ({ card: 'generic', title: `安装插件 · ${args.owner}/${args.name}`, content: [] }),
            presentResult: (_args, { isError, meta }) => ({
                card: 'generic',
                title: isError ? '插件安装失败' : `已安装 · ${meta?.fullName || ''}`,
                content: [],
            }),
            timeoutMs: deps.cfg().timeoutMs + INSTALL_TIMEOUT_MS,
            async execute(args) {
                const ref = parsePluginRef(args.owner, args.name);
                const cfg = deps.cfg();
                const page = await deps.listPlugins(cfg, { q: ref.fullName, scope: 'all', pageSize: 8 });
                const hit = page.items.find((it) => it.owner.toLowerCase() === ref.owner.toLowerCase() && it.name.toLowerCase() === ref.name.toLowerCase());
                if (hit && hit.installability !== 'verified') {
                    throw new Error(`${ref.fullName} is not a verified plugin`);
                }
                const result = await deps.lock(() => deps.installMarketPlugin(ref, cfg));
                return {
                    fullName: result.fullName,
                    source: result.source,
                    installed: true,
                    restartRequired: true,
                };
            },
        },
        {
            name: 'plugin_uninstall',
            description: 'Uninstall a DSH plugin by its profile package.json dependency name. Core bundles cannot be removed. Does not restart Host. Never print `dsh plugin remove` or use bash.',
            parameters: {
                name: { type: 'string', required: true, description: 'Profile package name, e.g. @scope/pkg or omnimux-workflow' },
            },
            output: {
                schema: { type: 'object', additionalProperties: true },
                render: text((value) => renderPluginUninstall(value)),
                presentationMeta: (_args, value) => ({ kind: 'plugin-uninstall', ...value }),
            },
            presentCall: (args) => ({ card: 'generic', title: `卸载插件 · ${args.name}`, content: [] }),
            presentResult: (_args, { isError, meta }) => ({
                card: 'generic',
                title: isError ? '插件卸载失败' : `已卸载 · ${meta?.name || ''}`,
                content: [],
            }),
            async execute(args) {
                const name = String(args.name || '').trim();
                if (!isSafePluginName(name))
                    throw new Error(`拒绝不安全的卸载目标: ${name}`);
                if (deps.isProtected(name))
                    throw new Error(`${name} cannot be removed`);
                const installed = deps.readInstalled();
                if (!Object.prototype.hasOwnProperty.call(installed, name)) {
                    throw new Error(`${name} is not installed`);
                }
                await deps.lock(() => deps.removeDshPlugin(name));
                return { name, uninstalled: true, restartRequired: true };
            },
        },
        {
            name: 'plugin_list',
            description: 'List DSH plugins already in the web profile package.json. Each row includes protected:true for core bundles. Do not tell the user to uninstall protected packages.',
            parameters: {},
            output: {
                schema: { type: 'object', additionalProperties: true },
                render: text((value) => renderPluginList(value)),
                presentationMeta: (_args, value) => ({ kind: 'plugin-list', ...value }),
            },
            presentCall: () => ({ card: 'generic', title: '已装插件', content: [] }),
            presentResult: (_args, { isError, meta }) => ({
                card: 'generic',
                title: isError ? '列出失败' : `已装插件 · ${meta?.items?.length ?? 0} 个`,
                content: [],
            }),
            async execute() {
                const installed = deps.readInstalled();
                const items = Object.entries(installed).map(([name, spec]) => ({
                    name,
                    spec,
                    protected: deps.isProtected(name),
                }));
                return { items };
            },
        },
    ];
}
