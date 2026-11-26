import { createRequire } from 'node:module';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { clamp } from './api.js';
import { CATEGORY_KEYS, categoryLabel, parseCategory } from './categories.js';
import { CONNECTOR_PROMPT_LINES, createConnectorTools } from './connector-tools.js';
import { assignConfig, dshHome, readOverlay, sanitizeSortBy, withDefaults } from './config-store.js';
import { removeDshPlugin } from './dsh-cli.js';
import { decorateCatalog, loadCatalog } from './expert/catalog.js';
import { registerCatalogSkillProvider } from './expert/catalog-provider.js';
import { registerBundledMarketSkills } from './bundled-skills.js';
import { findItem, installItem, removeMcpRow, withConnectorPatchLock } from './expert/install.js';
import { packageRoot, profileDir } from './expert/paths.js';
import { configureHttpJsonCache } from './http.js';
import { installSkill, installedSlugs, listInstalled, uninstallSkill } from './install.js';
import { aggregateSkillSearch } from './skill-aggregate.js';
import { setAgentPresetsNotify, setAgentPresetsProvider, setExpertPresetRuntime, setSkillsRuntimeProvider, handleApi, handleIcon, handleWorkshopApi } from './local-api.js';
import { ExpertPresetRuntime } from './expert-runtime.js';
import { InventoryService } from './workshop-inventory.js';
import { QueryService, createWorkshopSources } from './workshop-sources.js';
import { RequestGuard, canonicalWorkshopOrigin, WORKSHOP_READ_METHODS } from './workshop-request-guard.js';
import { WorkshopReadError } from './workshop-store.js';
import { cloneJson, renderInstall, renderList, renderSearch } from './host-render.js';
import { listMarketplaceConnectors } from './marketplace-connectors.js';
import { createPlazaTools, PLAZA_PROMPT_LINES } from './plaza-tools.js';
import { PLUGIN_PROMPT_LINES, createPluginTools } from './plugin-tools.js';
import { installMarketPlugin, isProtectedBundle, listPlugins, readInstalledPlugins, withPluginInstallLock, } from './plugin-market.js';
import { renderAttachedExpertSection, renderAttachedTrialSection, sessionIdFromExec } from './session-attach.js';
export const name = 'omnimux-market';
export const inject = ['tools', 'skills'];
/** Public package seam. Host owns this binding; request payloads never choose scope or roots. */
export function createWorkshopReadHost(cfg, options = {}) {
    const scope = options.scope ? structuredClone(options.scope) : null;
    const inventory = new InventoryService({ scope, store: options.store });
    const query = new QueryService(options.sources || createWorkshopSources(cfg), inventory);
    const guard = new RequestGuard({ connection: options.connection, trustedOrigin: options.trustedOrigin,
        authorizeRead: options.authorizeRead || ((_req, method) => method === 'workshopCapabilities') });
    const authorize = (req, method, peer) => guard.authorizeHeaders(req, method, peer);
    return {
        async workshopCapabilities(req, peer) {
            await authorize(req, 'workshopCapabilities', peer);
            return { scopeKey: scope?.scopeKey || null, scopeLabel: scope?.label || '未核实', scopeVerified: scope?.complete === true,
                connectionAuth: !!options.connection, exactOrigin: canonicalWorkshopOrigin(options.trustedOrigin) !== null,
                operationAuth: false, registryVerify: false, unifiedPolicy: false, commitBarrier: false, writable: false,
                reasons: [...(scope?.reasons || ['SCOPE_UNVERIFIED']), 'OPERATION_AUTH_UNVERIFIED', 'REGISTRY_VERIFY_UNAVAILABLE', 'COMMIT_BARRIER_UNAVAILABLE'] };
        },
        async workshopInventory(req, peer) {
            await authorize(req, 'workshopInventory', peer);
            return inventory.reconcile();
        },
        async workshopQuery(req, request, peer) {
            await authorize(req, 'workshopQuery', peer);
            assertWorkshopFields(request, ['view', 'query', 'domain', 'source', 'uninstalledOnly', 'queryRevision', 'cursor']);
            return query.query(request);
        },
        async workshopDetail(req, request, peer) {
            await authorize(req, 'workshopDetail', peer);
            assertWorkshopFields(request, ['skillKey', 'sourceRef', 'installId']);
            return query.detail(request);
        },
    };
}
function assertWorkshopFields(request, fields) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !fields.includes(key))) {
        throw new WorkshopReadError('INVALID_REQUEST', 400);
    }
}
export const Config = Schema.object({
    apiBase: Schema.string().default('https://api.skillhub.cn').description('SkillHub API'),
    webBase: Schema.string().default('https://skillhub.cn').description('技能主页'),
    skillsDir: Schema.string().description('安装目录，默认 $DSH_HOME/skills'),
    timeoutMs: Schema.number().default(20000).description('上游请求超时（毫秒）'),
    userAgent: Schema.string().default('Mozilla/5.0 (compatible; skillhub/0.1)').description('请求 UA'),
    maxResults: Schema.number().default(12).description('搜索结果上限'),
    sortBy: Schema.union(['score', 'downloads', 'stars', 'installs', 'updated_at']).default('score').description('默认排序'),
    plazaKeepAlive: Schema.boolean().default(true).description('广场关页保活（display:none）；false 回退旧 unmount'),
    plazaCacheTtlSec: Schema.number().default(90).description('SkillHub JSON Host memo TTL（秒）'),
    pluginMaxResults: Schema.number().min(1).max(8).default(6).description('plugin_search 上限（1–8）'),
    connectorMaxResults: Schema.number().min(1).max(8).default(6).description('connector_search 上限（1–8）'),
    protectedBundlesExtra: Schema.array(Schema.string()).default([]).description('追加不可卸包名；不能覆盖核心四项'),
    aggregateChannels: Schema.array(Schema.union(['custom', 'workbuddy', 'skillhub'])).default(['custom', 'workbuddy', 'skillhub']).description('技能搜索默认聚合渠道'),
    workbuddySkillsMarketplace: Schema.string().default('').description('WorkBuddy 技能市场扩展目录；空则探测 ~/.workbuddy/skills-marketplace'),
    aggregateRemoteSoftFail: Schema.boolean().default(true).description('远程 SkillHub 失败时不阻断本地渠道'),
    workshopOrigin: Schema.string().default('').description('Skills只读入口的受信完整Origin；未配置拒绝请求'),
});
/** System prompt `tool:skillhub` (order 210); shared with tests so the boundary stays asserted. */
export const SKILLHUB_PROMPT_LINES = [
    'Finding / recommending / browsing Agent Skills or SkillHub skills: you MUST call skillhub_search. It aggregates OmniMux custom catalog, WorkBuddy local market, and SkillHub remote. Never web_search, skill-catalog, load_skill, bash, or SKILL.md dump. Never print skillhub install, curl, or sh -c.',
    'Experts and expert teams live in the plaza: use plaza_search. SKILL REQUEST FIRST: when the user explicitly mentions 技能库 / SkillHub / 找技能 / find skills, call skillhub_search directly and do not call plaza_search first for that skill request. When the same message also asks for a separate professional deliverable (research, report, etc.), finish the skill search first and then continue the remaining task normally; plaza_search may be used for that remainder.',
    'You decide the keyword. Extract a real topic from the user; do not paste their whole sentence as query. No topic / just 好玩 有趣 推荐 → omit query to browse. 还有吗 → same previous query + offset. One call per user message.',
    'Do not say 点卡片查看 unless skillhub_search has already returned cards in this turn.',
    'When this user message ONLY asks to find, recommend, or browse skills, after cards appear reply with AT MOST one short sentence and do NOT list skills or write essays. When the message also contains another task (for example find skills + research and produce a report), show the cards and then continue that task normally — the one-sentence limit does not apply.',
    'Install only after the user chooses a card: skillhub_install with that slug (and catalogId when present). Then one short sentence.',
    `Categories: ${CATEGORY_KEYS.map((k) => `${k}=${categoryLabel(k)}`).join(', ')}.`,
    'For installed skills, call skillhub_list / skillhub_uninstall.',
];
export function apply(ctx, config) {
    const cfg = withDefaults(config);
    assignConfig(cfg, readOverlay());
    configureHttpJsonCache({ ttlMs: Math.max(15, cfg.plazaCacheTtlSec) * 1000 });
    ctx.tools.register(defineTool({
        name: 'skillhub_search',
        description: 'Search skills across OmniMux custom catalog, WorkBuddy local market, and SkillHub remote; show clickable cards. ALWAYS call this instead of web_search, skill-catalog, load_skill, or bash when the user wants to find/recommend/browse skills. Call EXACTLY ONCE per user message. You extract the search topic: pass a real keyword (PDF, 周报, face-warp), not the user\'s whole sentence. Omit query to browse popular skills. For 还有吗, reuse the previous query with offset = cards already shown. After cards appear, reply with AT MOST one short sentence only when the user asked solely to find/browse skills; when the same message also asks for another task, show the cards and then continue that task normally.',
        parameters: {
            query: { type: 'string', description: 'Main keyword, e.g. PDF or 周报. Optional when category is set.' },
            queries: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional extra keywords/synonyms for this SAME call. Merged into one card group. Do not make extra skillhub_search calls.',
            },
            category: {
                type: 'string',
                description: `Optional first-level category: ${CATEGORY_KEYS.join(', ')}`,
            },
            sortBy: { type: 'string', description: 'score, downloads, stars, installs, updated_at. Default score.' },
            limit: { type: 'number', description: 'Cards in this batch. Default from config.' },
            offset: { type: 'number', description: 'Skip this many already-shown cards when the user wants more.' },
            channels: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional subset: custom, workbuddy, skillhub. Default all three.',
            },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
            presentationMeta: (_args, value) => ({ kind: 'skillhub-search', ...value }),
        },
        presentCall: (args) => ({
            card: 'generic',
            title: `技能检索 · ${String(args.query || args.category || '浏览')}`,
            kind: 'search',
            content: [],
        }),
        presentResult: (_args, { isError, meta }) => ({
            card: 'generic',
            title: isError ? '技能搜索失败' : `技能 · ${meta?.items?.length ?? 0} 条`,
            content: [],
        }),
        timeoutMs: cfg.timeoutMs + 5000,
        async execute(args, exec) {
            const query = String(args.query || '').trim();
            const category = parseCategory(args.category);
            const installed = await installedSlugs(cfg.skillsDir);
            const explicit = Number(args.limit);
            const limit = Number.isFinite(explicit) && explicit > 0 ? clamp(explicit, 1, 80) : cfg.maxResults;
            const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
            const sortBy = sanitizeSortBy(args.sortBy, query ? cfg.sortBy : 'downloads');
            return cloneJson(await aggregateSkillSearch(query, {
                cfg,
                queries: args.queries,
                category,
                sortBy,
                limit,
                offset,
                installed,
                channels: args.channels,
                signal: exec.signal,
            }));
        },
    }));
    ctx.tools.register(defineTool({
        name: 'skillhub_install',
        description: 'Install a skill into the configured skills directory after the user chooses one. Pass the slug from skillhub_search (custom/WorkBuddy cards install from local catalog; SkillHub cards download remotely). Do not print CLI commands. After success, say the skill is installed.',
        parameters: {
            slug: { type: 'string', required: true, description: 'Skill slug from search, e.g. pdf-ocr-md or face-warp' },
            catalogId: { type: 'string', description: 'Optional catalog id from search, e.g. sk-omx-face-warp' },
            version: { type: 'string', description: 'Optional exact version such as 1.0.0. Default is latest.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: renderInstall(value) }],
            presentationMeta: (_args, value) => ({ kind: 'skillhub-install', ...value }),
        },
        presentCall: (args) => ({ card: 'generic', title: `安装 · ${args.slug}`, kind: 'search', content: [] }),
        presentResult: (_args, { isError, meta }) => ({
            card: 'generic',
            title: isError ? '安装失败' : `已安装 · ${meta?.name || ''}`,
            content: [],
        }),
        timeoutMs: cfg.timeoutMs + 15000,
        async execute(args, exec) {
            return cloneJson(await installSkill(String(args.slug || ''), cfg, undefined, exec.signal, args.version ? String(args.version) : undefined, args.catalogId ? String(args.catalogId) : undefined));
        },
    }));
    ctx.tools.register(defineTool({
        name: 'skillhub_list',
        description: 'List skills already installed in the SkillHub plugin skills directory. Use when the user asks what skills are installed or to manage local skills.',
        parameters: {},
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: renderList(value) }],
            presentationMeta: (_args, value) => ({ kind: 'skillhub-list', ...value }),
        },
        presentCall: () => ({ card: 'generic', title: '已装技能', kind: 'search', content: [] }),
        presentResult: (_args, { isError, meta }) => ({
            card: 'generic',
            title: isError ? '列出失败' : `已装 · ${meta?.items?.length ?? 0} 个`,
            content: [],
        }),
        async execute() {
            const items = await listInstalled(cfg.skillsDir);
            return cloneJson({ skillsDir: cfg.skillsDir, items });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'skillhub_uninstall',
        description: 'Uninstall a locally installed skill by slug. Only removes a directory under the configured skills directory that contains SKILL.md.',
        parameters: {
            slug: { type: 'string', required: true, description: 'Installed skill directory name / slug' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: `已卸载 ${value.slug}` }],
            presentationMeta: (_args, value) => ({ kind: 'skillhub-uninstall', ...value }),
        },
        presentCall: (args) => ({ card: 'generic', title: `卸载 · ${args.slug}`, content: [] }),
        presentResult: (_args, { isError, meta }) => ({
            card: 'generic',
            title: isError ? '卸载失败' : `已卸载 · ${meta?.slug || ''}`,
            content: [],
        }),
        async execute(args) {
            return cloneJson(await uninstallSkill(String(args.slug || ''), cfg.skillsDir));
        },
    }));
    registerPlazaTools(ctx);
    registerPluginTools(ctx, cfg);
    registerConnectorTools(ctx, cfg);
    ctx.inject(['systemPrompt'], (c) => {
        const prompt = c.systemPrompt;
        prompt.section({
            name: 'tool:plaza-experts',
            order: 209,
            text: PLAZA_PROMPT_LINES.join(' '),
        });
        prompt.section({
            name: 'plaza:attached-expert',
            order: 8,
            text: (assemble) => renderAttachedExpertSection(dshHome(), sessionIdFromExec(assemble)),
        });
        prompt.section({
            name: 'plaza:trial-skill',
            order: 9,
            text: (assemble) => renderAttachedTrialSection(dshHome(), sessionIdFromExec(assemble)),
        });
        prompt.section({
            name: 'tool:skillhub',
            order: 210,
            text: SKILLHUB_PROMPT_LINES.join(' '),
        });
        prompt.section({
            name: 'tool:plugins',
            order: 211,
            text: PLUGIN_PROMPT_LINES.join(' '),
        });
        prompt.section({
            name: 'tool:connectors',
            order: 212,
            text: CONNECTOR_PROMPT_LINES.join(' '),
        });
    });
    ctx.inject(['webServer'], (c) => {
        const server = c.webServer;
        const hostRequestRejection = (req, peer) => {
            if (peer !== undefined && peer !== null && typeof peer === 'object')
                return undefined;
            try {
                const service = c.get('connection');
                if (typeof service?.requestRejection !== 'function')
                    return 503;
                const raw = service.requestRejection(req);
                if (raw === undefined)
                    return undefined;
                const status = typeof raw === 'number' ? raw : raw?.status;
                return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 403;
            }
            catch {
                return 503;
            }
        };
        const guardRoute = (handler) => async (req, res, peer) => {
            const rejection = hostRequestRejection(req, peer);
            if (rejection !== undefined) {
                res.statusCode = rejection;
                res.setHeader('content-type', 'application/json; charset=utf-8');
                res.setHeader('cache-control', 'no-store');
                res.end(JSON.stringify({ ok: false, error: 'request-denied' }));
                return;
            }
            await handler(req, res);
        };
        server.register({ kind: 'exact', path: '/omnimux-market', auth: 'required', handler: guardRoute((req, res) => handleApi(req, res, cfg)) });
        server.register({ kind: 'exact', path: '/omnimux-market/icon', auth: 'required', handler: guardRoute((req, res) => handleIcon(req, res, cfg)) });
        const connection = {
            requestRejection(req) {
                try {
                    const service = c.get('connection');
                    if (typeof service?.requestRejection !== 'function')
                        return { status: 503 };
                    const raw = service.requestRejection(req);
                    if (raw === undefined)
                        return undefined;
                    if (typeof raw === 'number') {
                        return { status: Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 403 };
                    }
                    if (raw !== null && typeof raw === 'object') {
                        const status = raw.status;
                        const normalized = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 403;
                        return { ...raw, status: normalized };
                    }
                    return { status: 403 };
                }
                catch {
                    return { status: 503 };
                }
            },
        };
        // cfg.skillsDir alone does not prove all effective provider roots or read authorization.
        const authorization = { connection, trustedOrigin: config.workshopOrigin,
            authorizeRead: (_req, method) => method === 'workshopCapabilities' };
        const workshop = createWorkshopReadHost(cfg, authorization);
        for (const method of WORKSHOP_READ_METHODS) {
            server.register({ kind: 'exact', path: `/omnimux-market/workshop/${method}`, auth: 'required',
                handler: (req, res, peer) => handleWorkshopApi(req, res, method, workshop, authorization, peer) });
        }
    });
    // 插件配置页按 Host settings 命名空间分发 settings.plugin.item。
    // 不登记 omnimux-market 的话，客户端卡片永远不会被 dispatch。
    // settings 服务仅在组合了 profileContext 时存在（官方 settings 行在无上下文时 disabled），
    // 桌面宿主没有它：改为按需取用，缺席时不注册命名空间，不阻塞激活。
    const settingsService = typeof ctx.get === 'function'
        ? ctx.get('settings')
        : undefined;
    if (settingsService && typeof settingsService.register === 'function') {
        settingsService.register('omnimux-market', Config, { base: config });
    }
    registerBundledMarketSkills(ctx);
    registerCatalogSkillProvider(ctx);
    const runtimeSkills = (() => {
        try {
            const svc = ctx.skills;
            return svc && (typeof svc.list === 'function' || typeof svc.get === 'function') ? svc : null;
        }
        catch (err) {
            console.warn(`[omnimux-market] ctx.skills unavailable for runtime bridge: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    })();
    if (runtimeSkills) {
        const providerBridge = {
            list: typeof runtimeSkills.list === 'function' ? () => runtimeSkills.list() : undefined,
            get: typeof runtimeSkills.get === 'function' ? (slug) => runtimeSkills.get(slug) : undefined,
        };
        if (typeof ctx.effect === 'function') {
            ;
            ctx.effect(() => {
                setSkillsRuntimeProvider(providerBridge);
                return () => { setSkillsRuntimeProvider(null); };
            });
        }
        else {
            setSkillsRuntimeProvider(providerBridge);
        }
    }
    // Agent 预设列表变更广播：官方 `@deepseek-ai/dsh-client-ui-agent-preset` 监听
    // `settings/document-updated` 且命名空间为 `AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'`。
    // 市场安装/禁用/启动恢复后借此免重启即时刷新会话下拉与设置页列表。
    const AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry';
    let agentPresetsNotifyRevision = 0;
    const notifyAgentPresetsChanged = () => {
        try {
            ctx.emit('settings/document-updated', AGENT_PRESET_SETTINGS_NS, ++agentPresetsNotifyRevision);
        }
        catch (err) {
            console.warn(`[omnimux-market] failed to emit settings/document-updated: ${err instanceof Error ? err.message : String(err)}`);
        }
    };
    setAgentPresetsNotify(notifyAgentPresetsChanged);
    // 注入官方 AgentPresets 服务，作为专家市场的唯一动态运行态真源：
    // - 绑定 Host root baseUrl 保证动态挂载的 DSH Agent-plane 包可正确解析；
    // - 启动时仅恢复 installed-experts.json 中用户显式安装过的专家，不自动物化未安装项；
    // - 插件卸载/重载时通过 effect 自动反注册本插件创建的动态预设，防止重复 ID 冲突。
    ctx.inject(['agentPresets'], (c) => {
        const rawCtx = c;
        const resolveBase = rawCtx.root?.baseUrl || rawCtx.baseUrl;
        const regCtx = (rawCtx.root?.baseUrl && typeof rawCtx.extend === 'function'
            ? rawCtx.extend({ baseUrl: rawCtx.root.baseUrl })
            : rawCtx);
        const service = regCtx.agentPresets ?? rawCtx.agentPresets;
        if (!service || typeof service.list !== 'function')
            return;
        const pluginPackages = typeof rawCtx.get === 'function'
            ? rawCtx.get('pluginPackages')
            : undefined;
        const isPackageResolvable = pluginPackages && typeof pluginPackages.packageOf === 'function' && resolveBase
            ? (pkg) => pluginPackages.packageOf(pkg, resolveBase) !== undefined
            : undefined;
        // `packageOf` deliberately strips the subpath, so it cannot tell whether a
        // row's export actually exists. Resolve the full specifier for that, which
        // is what distinguishes DSH 0.2.1 (own `./list-agents` entry) from 0.2.2
        // (registration folded into the main entry, subpath removed).
        const resolvesSpecifier = resolveBase
            ? (specifier) => {
                try {
                    createRequire(resolveBase).resolve(specifier);
                    return true;
                }
                catch {
                    return false;
                }
            }
            : undefined;
        const runtime = new ExpertPresetRuntime({
            home: () => dshHome(),
            registry: {
                list: () => service.list(),
                register: typeof service.register === 'function'
                    ? (definition) => service.register(definition)
                    : undefined,
            },
            isPackageResolvable,
            resolvesSpecifier,
            onChanged: notifyAgentPresetsChanged,
        });
        setAgentPresetsProvider(() => runtime.listOfficial());
        setExpertPresetRuntime(runtime);
        void runtime.restoreInstalled().catch((err) => {
            console.warn(`[omnimux-market] expert restore failed on boot: ${err instanceof Error ? err.message : String(err)}`);
        });
        if (typeof rawCtx.effect === 'function') {
            rawCtx.effect(() => () => {
                setExpertPresetRuntime(null);
                setAgentPresetsProvider(null);
                return runtime.disposeAll();
            });
        }
    });
}
function registerMarketTools(ctx, specs) {
    for (const tool of specs) {
        ctx.tools.register(defineTool({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: tool.output,
            presentCall: tool.presentCall,
            presentResult: tool.presentResult,
            timeoutMs: tool.timeoutMs ?? 20_000,
            async execute(args, exec) {
                return cloneJson(await tool.execute(args, exec));
            },
        }));
    }
}
function marketRoots() {
    const home = dshHome();
    return { home, profileDir: profileDir(home), packageRoot: packageRoot() };
}
/** 专家广场工具：实现见 plaza-tools.ts，host 只负责注册。 */
function registerPlazaTools(ctx) {
    registerMarketTools(ctx, createPlazaTools(marketRoots, () => loadCatalog()));
}
function registerPluginTools(ctx, cfg) {
    registerMarketTools(ctx, createPluginTools({
        cfg: () => cfg,
        lock: withPluginInstallLock,
        listPlugins,
        installMarketPlugin,
        removeDshPlugin,
        readInstalled: () => readInstalledPlugins(),
        isProtected: (name) => isProtectedBundle(name, cfg.protectedBundlesExtra),
    }));
}
function registerConnectorTools(ctx, cfg) {
    registerMarketTools(ctx, createConnectorTools({
        roots: marketRoots,
        loadCatalog: () => decorateCatalog(loadCatalog(), marketRoots()),
        listMarketplace: () => listMarketplaceConnectors(),
        installItem,
        removeMcpRow,
        findItem,
        lock: withConnectorPatchLock,
    }, () => ({ maxResults: cfg.connectorMaxResults })));
}
export { CORE_PROTECTED_BUNDLES, isProtectedBundle } from './plugin-market.js';
export { INSTALL_TIMEOUT_MS } from './dsh-cli.js';
export { cloneJson, renderConnectorInstall, renderConnectorList, renderConnectorSearch, renderConnectorUninstall, renderInstall, renderList, renderPluginInstall, renderPluginList, renderPluginSearch, renderPluginUninstall, renderSearch, } from './host-render.js';
