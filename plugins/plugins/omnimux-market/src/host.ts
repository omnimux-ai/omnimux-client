import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { clamp } from './api.js'
import { CATEGORY_KEYS, categoryLabel, parseCategory } from './categories.js'
import { CONNECTOR_PROMPT_LINES, createConnectorTools } from './connector-tools.js'
import { assignConfig, dshHome, readOverlay, sanitizeSortBy, withDefaults } from './config-store.js'
import { removeDshPlugin } from './dsh-cli.js'
import { decorateCatalog, loadCatalog } from './expert/catalog.js'
import { registerCatalogSkillProvider } from './expert/catalog-provider.js'
import { findItem, installItem, removeMcpRow, withConnectorPatchLock } from './expert/install.js'
import { packageRoot, profileDir } from './expert/paths.js'
import { configureHttpJsonCache } from './http.js'
import { installSkill, installedSlugs, listInstalled, uninstallSkill } from './install.js'
import { aggregateSkillSearch } from './skill-aggregate.js'
import { getSessionModel, setAgentPresetsNotify, setAgentPresetsProvider, setExpertPresetRuntime, setModelCatalogResolver, setSkillsRuntimeProvider, handleApi, handleIcon, handleWorkshopApi } from './local-api.js'
import type { DiscoveredPresetRef } from './expert-market.js'
import { ExpertPresetRuntime, type DynamicPresetDefinition } from './expert-runtime.js'
import { InventoryService } from './workshop-inventory.js'
import { QueryService, createWorkshopSources } from './workshop-sources.js'
import type { WorkshopSources, WorkshopDetailRequest } from './workshop-sources.js'
import { RequestGuard, canonicalWorkshopOrigin, WORKSHOP_READ_METHODS } from './workshop-request-guard.js'
import type { WorkshopConnection, WorkshopReadAuthorization, WorkshopReadMethod } from './workshop-request-guard.js'
import { WorkshopReadError } from './workshop-store.js'
import type { CapabilityResult, WorkshopReadScope, WorkshopState, WorkshopInventoryResult, WorkshopQueryRequest } from './types.js'
import { cloneJson, renderInstall, renderList, renderSearch } from './host-render.js'
import { listMarketplaceConnectors } from './marketplace-connectors.js'
import { createPlazaTools, PLAZA_PROMPT_LINES } from './plaza-tools.js'
import { PLUGIN_PROMPT_LINES, createPluginTools } from './plugin-tools.js'
import {
  installMarketPlugin,
  isProtectedBundle,
  listPlugins,
  readInstalledPlugins,
  withPluginInstallLock,
} from './plugin-market.js'
import { renderAttachedExpertSection, renderAttachedTrialSection, sessionIdFromExec } from './session-attach.js'
import type { InstallResult, InstalledSkill, MarketToolSpec, PluginConfig, SearchResult, SortBy } from './types.js'

export const name = 'omnimux-market'
export const inject = ['tools', 'skills']

export interface Config extends PluginConfig {
  workshopOrigin?: string
}

export interface WorkshopReadHostOptions {
  scope?: WorkshopReadScope | null
  connection?: WorkshopConnection
  trustedOrigin?: string
  authorizeRead?: WorkshopReadAuthorization['authorizeRead']
  store?: { read(): Promise<WorkshopState> }
  sources?: WorkshopSources
}

/** Public package seam. Host owns this binding; request payloads never choose scope or roots. */
export function createWorkshopReadHost(cfg: PluginConfig, options: WorkshopReadHostOptions = {}) {
  const scope = options.scope ? structuredClone(options.scope) : null
  const inventory = new InventoryService({ scope, store: options.store })
  const query = new QueryService(options.sources || createWorkshopSources(cfg), inventory)
  const guard = new RequestGuard({ connection: options.connection, trustedOrigin: options.trustedOrigin,
    authorizeRead: options.authorizeRead || ((_req, method) => method === 'workshopCapabilities') })
  const authorize = (req: IncomingMessage, method: WorkshopReadMethod, peer?: unknown) => guard.authorizeHeaders(req, method, peer)
  return {
    async workshopCapabilities(req: IncomingMessage, peer?: unknown): Promise<CapabilityResult> {
      await authorize(req, 'workshopCapabilities', peer)
      return { scopeKey: scope?.scopeKey || null, scopeLabel: scope?.label || '未核实', scopeVerified: scope?.complete === true,
        connectionAuth: !!options.connection, exactOrigin: canonicalWorkshopOrigin(options.trustedOrigin) !== null,
        operationAuth: false, registryVerify: false, unifiedPolicy: false, commitBarrier: false, writable: false,
        reasons: [...(scope?.reasons || ['SCOPE_UNVERIFIED']), 'OPERATION_AUTH_UNVERIFIED', 'REGISTRY_VERIFY_UNAVAILABLE', 'COMMIT_BARRIER_UNAVAILABLE'] }
    },
    async workshopInventory(req: IncomingMessage, peer?: unknown): Promise<WorkshopInventoryResult> {
      await authorize(req, 'workshopInventory', peer)
      return inventory.reconcile()
    },
    async workshopQuery(req: IncomingMessage, request: WorkshopQueryRequest, peer?: unknown) {
      await authorize(req, 'workshopQuery', peer)
      assertWorkshopFields(request, ['view', 'query', 'domain', 'source', 'uninstalledOnly', 'queryRevision', 'cursor'])
      return query.query(request)
    },
    async workshopDetail(req: IncomingMessage, request: WorkshopDetailRequest, peer?: unknown) {
      await authorize(req, 'workshopDetail', peer)
      assertWorkshopFields(request, ['skillKey', 'sourceRef', 'installId'])
      return query.detail(request)
    },
  }
}

function assertWorkshopFields(request: unknown, fields: string[]): void {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !fields.includes(key))) {
    throw new WorkshopReadError('INVALID_REQUEST', 400)
  }
}

export const Config: Schema<Config> = Schema.object({
  apiBase: Schema.string().default('https://api.skillhub.cn').description('SkillHub API'),
  webBase: Schema.string().default('https://skillhub.cn').description('技能主页'),
  skillsDir: Schema.string().description('安装目录，默认 $DSH_HOME/skills'),
  timeoutMs: Schema.number().default(20000).description('上游请求超时（毫秒）'),
  userAgent: Schema.string().default('Mozilla/5.0 (compatible; skillhub/0.1)').description('请求 UA'),
  maxResults: Schema.number().default(12).description('搜索结果上限'),
  sortBy: Schema.union(['score', 'downloads', 'stars', 'installs', 'updated_at'] as const).default('score').description('默认排序'),
  plazaKeepAlive: Schema.boolean().default(true).description('广场关页保活（display:none）；false 回退旧 unmount'),
  plazaCacheTtlSec: Schema.number().default(90).description('SkillHub JSON Host memo TTL（秒）'),
  pluginMaxResults: Schema.number().min(1).max(8).default(6).description('plugin_search 上限（1–8）'),
  connectorMaxResults: Schema.number().min(1).max(8).default(6).description('connector_search 上限（1–8）'),
  protectedBundlesExtra: Schema.array(Schema.string()).default([]).description('追加不可卸包名；不能覆盖核心四项'),
  aggregateChannels: Schema.array(Schema.union(['custom', 'workbuddy', 'skillhub'] as const)).default(['custom', 'workbuddy', 'skillhub']).description('技能搜索默认聚合渠道'),
  workbuddySkillsMarketplace: Schema.string().default('').description('WorkBuddy 技能市场扩展目录；空则探测 ~/.workbuddy/skills-marketplace'),
  aggregateRemoteSoftFail: Schema.boolean().default(true).description('远程 SkillHub 失败时不阻断本地渠道'),
  workshopOrigin: Schema.string().default('').description('Skills只读入口的受信完整Origin；未配置拒绝请求'),
})

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
]

export function apply(ctx: Context, config: Config): void {
  const cfg = withDefaults(config)
  assignConfig(cfg, readOverlay())
  configureHttpJsonCache({ ttlMs: Math.max(15, cfg.plazaCacheTtlSec) * 1000 })

  ctx.tools.register(defineTool({
    name: 'skillhub_search',
    description:
      'Search skills across OmniMux custom catalog, WorkBuddy local market, and SkillHub remote; show clickable cards. ALWAYS call this instead of web_search, skill-catalog, load_skill, or bash when the user wants to find/recommend/browse skills. Call EXACTLY ONCE per user message. You extract the search topic: pass a real keyword (PDF, 周报, face-warp), not the user\'s whole sentence. Omit query to browse popular skills. For 还有吗, reuse the previous query with offset = cards already shown. After cards appear, reply with AT MOST one short sentence only when the user asked solely to find/browse skills; when the same message also asks for another task, show the cards and then continue that task normally.',
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
      render: (_args, value) => [{ type: 'text', text: renderSearch(value as unknown as SearchResult) }],
      presentationMeta: (_args, value) => ({ kind: 'skillhub-search', ...(value as object) }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `技能检索 · ${String(args.query || args.category || '浏览')}`,
      kind: 'search',
      content: [],
    }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '技能搜索失败' : `技能 · ${(meta as SearchResult | undefined)?.items?.length ?? 0} 条`,
      content: [],
    }),
    timeoutMs: cfg.timeoutMs + 5000,
    async execute(args, exec) {
      const query = String(args.query || '').trim()
      const category = parseCategory(args.category)
      const installed = await installedSlugs(cfg.skillsDir)
      const explicit = Number(args.limit)
      const limit = Number.isFinite(explicit) && explicit > 0 ? clamp(explicit, 1, 80) : cfg.maxResults
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0))
      const sortBy = sanitizeSortBy(args.sortBy, query ? cfg.sortBy : 'downloads') as SortBy
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
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'skillhub_install',
    description:
      'Install a skill into the configured skills directory after the user chooses one. Pass the slug from skillhub_search (custom/WorkBuddy cards install from local catalog; SkillHub cards download remotely). Do not print CLI commands. After success, say the skill is installed.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Skill slug from search, e.g. pdf-ocr-md or face-warp' },
      catalogId: { type: 'string', description: 'Optional catalog id from search, e.g. sk-omx-face-warp' },
      version: { type: 'string', description: 'Optional exact version such as 1.0.0. Default is latest.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderInstall(value as unknown as InstallResult) }],
      presentationMeta: (_args, value) => ({ kind: 'skillhub-install', ...(value as object) }),
    },
    presentCall: (args) => ({ card: 'generic', title: `安装 · ${args.slug}`, kind: 'search', content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '安装失败' : `已安装 · ${(meta as InstallResult | undefined)?.name || ''}`,
      content: [],
    }),
    timeoutMs: cfg.timeoutMs + 15000,
    async execute(args, exec) {
      return cloneJson(await installSkill(
        String(args.slug || ''),
        cfg,
        undefined,
        exec.signal,
        args.version ? String(args.version) : undefined,
        args.catalogId ? String(args.catalogId) : undefined,
      ))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'skillhub_list',
    description: 'List skills already installed in the SkillHub plugin skills directory. Use when the user asks what skills are installed or to manage local skills.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderList(value as unknown as { items: InstalledSkill[]; skillsDir: string }) }],
      presentationMeta: (_args, value) => ({ kind: 'skillhub-list', ...(value as object) }),
    },
    presentCall: () => ({ card: 'generic', title: '已装技能', kind: 'search', content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '列出失败' : `已装 · ${(meta as { items?: InstalledSkill[] } | undefined)?.items?.length ?? 0} 个`,
      content: [],
    }),
    async execute() {
      const items = await listInstalled(cfg.skillsDir)
      return cloneJson({ skillsDir: cfg.skillsDir, items })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'skillhub_uninstall',
    description: 'Uninstall a locally installed skill by slug. Only removes a directory under the configured skills directory that contains SKILL.md.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Installed skill directory name / slug' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: `已卸载 ${(value as { slug: string }).slug}` }],
      presentationMeta: (_args, value) => ({ kind: 'skillhub-uninstall', ...(value as object) }),
    },
    presentCall: (args) => ({ card: 'generic', title: `卸载 · ${args.slug}`, content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '卸载失败' : `已卸载 · ${(meta as { slug?: string } | undefined)?.slug || ''}`,
      content: [],
    }),
    async execute(args) {
      return cloneJson(await uninstallSkill(String(args.slug || ''), cfg.skillsDir))
    },
  }))

  registerPlazaTools(ctx)
  registerPluginTools(ctx, cfg)
  registerConnectorTools(ctx, cfg)

  if (typeof ctx.inject === 'function') {
    ctx.inject(['modelCatalog'], (c: any) => {
      if (c.modelCatalog && typeof c.modelCatalog.list === 'function') {
        setModelCatalogResolver(async () => {
          try {
            return c.modelCatalog.list()
          } catch {
            return null
          }
        })
      }
    })
  }

  if (typeof ctx.on === 'function') {
    // 监听工具执行门禁，当用户在会话中手动锁定模型时，禁用其他视频/图像生成工具
    ctx.on('tools/pre-execute' as any, async (exec: any, next: () => Promise<any>) => {
      const sessionId = sessionIdFromExec(exec)
      if (!sessionId) return next()
      const sel = getSessionModel(sessionId)
      if (!sel || sel.auto || !sel.selectedModel) return next()

      const toolName = exec.tool?.name || ''
      const isVideoTool = ['video_generate', 'omnimux_video_submit'].includes(toolName)
      const isImageTool = ['image_generate', 'omnimux_image_submit'].includes(toolName)

      if (!isVideoTool && !isImageTool) return next()

      const chosen = sel.selectedModel
      if (chosen.type === 'video') {
        if (isImageTool) {
          return {
            kind: 'deny',
            reason: `当前会话已手动选择视频模型【${chosen.name}】，图像生成工具已被禁用。`,
          }
        }
        if (toolName === 'video_generate') {
          return {
            kind: 'deny',
            reason: `当前会话已手动选择模型【${chosen.name}】，Grok 视频生成工具已被禁用，请使用已选中的模型。`,
          }
        }
        if (toolName === 'omnimux_video_submit' && exec.arguments && typeof exec.arguments === 'object') {
          if (!exec.arguments.model || exec.arguments.model !== chosen.id) {
            exec.arguments.model = chosen.id
          }
        }
      } else if (chosen.type === 'image') {
        if (isVideoTool) {
          return {
            kind: 'deny',
            reason: `当前会话已手动选择图像模型【${chosen.name}】，视频生成工具已被禁用。`,
          }
        }
        if (chosen.id === 'gpt-image-2.5') {
          if (toolName === 'omnimux_image_submit' && exec.arguments && typeof exec.arguments === 'object') {
            if (!exec.arguments.model || exec.arguments.model !== chosen.id) {
              exec.arguments.model = chosen.id
            }
          }
        } else {
          if (toolName === 'image_generate') {
            return {
              kind: 'deny',
              reason: `当前会话已手动选择图像模型【${chosen.name}】，请使用对应的图像生成工具 omnimux_image_submit。`,
            }
          }
          if (toolName === 'omnimux_image_submit' && exec.arguments && typeof exec.arguments === 'object') {
            if (!exec.arguments.model || exec.arguments.model !== chosen.id) {
              exec.arguments.model = chosen.id
            }
          }
        }
      }
      return next()
    })

    // 当 agent 注册时（rc.3+ 事件），通过 tools.restrict 动态屏蔽不相关的多模态生成工具，实现“不显示”
    ctx.on('agent/created' as any, ({ agent }: { agent: any }) => {
      const sessionId = sessionIdFromExec(agent)
      if (!sessionId) return
      const sel = getSessionModel(sessionId)
      if (!sel || sel.auto || !sel.selectedModel) return

      const chosen = sel.selectedModel
      const deniedTools: string[] = []
      if (chosen.type === 'video') {
        deniedTools.push('image_generate', 'omnimux_image_submit', 'video_generate')
      } else if (chosen.type === 'image') {
        deniedTools.push('video_generate', 'omnimux_video_submit')
        if (chosen.id !== 'gpt-image-2.5') {
          deniedTools.push('image_generate')
        }
      }

      try {
        const restrictable = agent.ctx?.tools?.view?.(agent)?.restrictableNames
        const validDenies = restrictable
          ? deniedTools.filter((t: string) => restrictable.has(t))
          : deniedTools
        if (validDenies.length > 0 && typeof agent.ctx?.tools?.restrict === 'function') {
          agent.ctx.tools.restrict({ deny: validDenies })
        }
      } catch {
        // ignore
      }
    })
  }

  ctx.inject(['systemPrompt'], (c) => {
    const prompt = (c as unknown as {
      systemPrompt: {
        section: (section: { name: string; order: number; text: string | ((assemble?: unknown) => string) }) => void
      }
    }).systemPrompt
    prompt.section({
      name: 'session:selected-model',
      order: 15,
      text: (assemble?: unknown) => {
        const sid = sessionIdFromExec(assemble)
        if (!sid) return ''
        const sel = getSessionModel(sid)
        if (sel && !sel.auto && sel.selectedModel) {
          const typeName = sel.selectedModel.type === 'video' ? '视频' : '图像'
          return `【会话模型锁定】当前会话用户已手动选择${typeName}生成模型: "${sel.selectedModel.name}" (类型: ${typeName}, ID: ${sel.selectedModel.id})。当前会话中其他视频/图像模型生成工具已被禁用并隐藏，若需要生成${typeName}，请仅使用此模型执行生成任务。`
        }
        return ''
      },
    })
    prompt.section({
      name: 'tool:plaza-experts',
      order: 209,
      text: PLAZA_PROMPT_LINES.join(' '),
    })
    prompt.section({
      name: 'plaza:attached-expert',
      order: 8,
      text: (assemble?: unknown) => renderAttachedExpertSection(dshHome(), sessionIdFromExec(assemble)),
    })
    prompt.section({
      name: 'plaza:trial-skill',
      order: 9,
      text: (assemble?: unknown) => renderAttachedTrialSection(dshHome(), sessionIdFromExec(assemble)),
    })
    prompt.section({
      name: 'tool:skillhub',
      order: 210,
      text: SKILLHUB_PROMPT_LINES.join(' '),
    })
    prompt.section({
      name: 'tool:plugins',
      order: 211,
      text: PLUGIN_PROMPT_LINES.join(' '),
    })
    prompt.section({
      name: 'tool:connectors',
      order: 212,
      text: CONNECTOR_PROMPT_LINES.join(' '),
    })
  })

  ctx.inject(['webServer'], (c) => {
    const server = (c as unknown as { webServer: { register: (route: { kind: string; path: string; auth?: 'anonymous' | 'required' | 'deny'; handler: (req: IncomingMessage, res: ServerResponse, peer?: unknown) => void | Promise<void> }) => void } }).webServer
    server.register({ kind: 'exact', path: '/omnimux-market', auth: 'required', handler: (req, res) => handleApi(req, res, cfg) })
    server.register({ kind: 'exact', path: '/omnimux-market/icon', auth: 'required', handler: (req, res) => handleIcon(req, res, cfg) })
    const connection: WorkshopConnection = {
      requestRejection(req) {
        const service = (c as unknown as { get(name: string): unknown }).get('connection') as Partial<WorkshopConnection> | undefined
        if (typeof service?.requestRejection === 'function') return service.requestRejection(req)
        return { status: 401 }
      },
    }
    // cfg.skillsDir alone does not prove all effective provider roots or read authorization.
    const authorization: WorkshopReadAuthorization = { connection, trustedOrigin: config.workshopOrigin,
      authorizeRead: (_req, method) => method === 'workshopCapabilities' }
    const workshop = createWorkshopReadHost(cfg, authorization)
    for (const method of WORKSHOP_READ_METHODS) {
      server.register({ kind: 'exact', path: `/omnimux-market/workshop/${method}`, auth: 'required',
        handler: (req, res, peer) => handleWorkshopApi(req, res, method, workshop, authorization, peer) })
    }
  })

  // 插件配置页按 Host settings 命名空间分发 settings.plugin.item。
  // 不登记 omnimux-market 的话，客户端卡片永远不会被 dispatch。
  // settings 服务仅在组合了 profileContext 时存在（官方 settings 行在无上下文时 disabled），
  // 桌面宿主没有它：改为按需取用，缺席时不注册命名空间，不阻塞激活。
  const settingsService = typeof ctx.get === 'function'
    ? (ctx.get('settings') as { register?: (ns: string, schema: typeof Config, options?: { base?: Config }) => void } | undefined)
    : undefined
  if (settingsService && typeof settingsService.register === 'function') {
    settingsService.register('omnimux-market', Config, { base: config })
  }

  registerCatalogSkillProvider(ctx)

  const runtimeSkills = (() => {
    try {
      const svc = (ctx as unknown as { skills?: { list?: () => Promise<Array<{ name?: string; provider?: string }>>; get?: (slug: string) => Promise<{ content?: string } | undefined> } }).skills
      return svc && (typeof svc.list === 'function' || typeof svc.get === 'function') ? svc : null
    } catch (err) {
      console.warn(`[omnimux-market] ctx.skills unavailable for runtime bridge: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  })()
  if (runtimeSkills) {
    const providerBridge = {
      list: typeof runtimeSkills.list === 'function' ? () => runtimeSkills.list!() : undefined,
      get: typeof runtimeSkills.get === 'function' ? (slug: string) => runtimeSkills.get!(slug) : undefined,
    }
    if (typeof (ctx as unknown as { effect?: (fn: () => () => void) => void }).effect === 'function') {
      ;(ctx as unknown as { effect: (fn: () => () => void) => void }).effect(() => {
        setSkillsRuntimeProvider(providerBridge)
        return () => { setSkillsRuntimeProvider(null) }
      })
    } else {
      setSkillsRuntimeProvider(providerBridge)
    }
  }

  // Agent 预设列表变更广播：官方 `@deepseek-ai/dsh-client-ui-agent-preset` 监听
  // `settings/document-updated` 且命名空间为 `AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'`。
  // 市场安装/禁用/启动恢复后借此免重启即时刷新会话下拉与设置页列表。
  const AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'
  let agentPresetsNotifyRevision = 0
  const notifyAgentPresetsChanged = () => {
    try {
      ctx.emit('settings/document-updated' as any, AGENT_PRESET_SETTINGS_NS, ++agentPresetsNotifyRevision)
    } catch (err) {
      console.warn(`[omnimux-market] failed to emit settings/document-updated: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  setAgentPresetsNotify(notifyAgentPresetsChanged)

  // 注入官方 AgentPresets 服务，作为专家市场的唯一动态运行态真源：
  // - 绑定 Host root baseUrl 保证动态挂载的 DSH Agent-plane 包可正确解析；
  // - 启动时仅恢复 installed-experts.json 中用户显式安装过的专家，不自动物化未安装项；
  // - 插件卸载/重载时通过 effect 自动反注册本插件创建的动态预设，防止重复 ID 冲突。
  ctx.inject(['agentPresets'], (c) => {
    const rawCtx = c as unknown as {
      baseUrl?: string
      root?: { baseUrl?: string }
      extend?: (meta: { baseUrl?: string }) => unknown
      get?: (name: string) => unknown
      effect?: (fn: () => (() => void | Promise<void>)) => void
      agentPresets?: {
        list: () => Promise<DiscoveredPresetRef[]>
        register?: (definition: DynamicPresetDefinition) => Promise<() => Promise<void>>
      }
    }
    const resolveBase = rawCtx.root?.baseUrl || rawCtx.baseUrl
    const regCtx = (rawCtx.root?.baseUrl && typeof rawCtx.extend === 'function'
      ? rawCtx.extend({ baseUrl: rawCtx.root.baseUrl })
      : rawCtx) as typeof rawCtx
    const service = regCtx.agentPresets ?? rawCtx.agentPresets
    if (!service || typeof service.list !== 'function') return

    const pluginPackages = typeof rawCtx.get === 'function'
      ? (rawCtx.get('pluginPackages') as { packageOf?: (specifier: string, parentURL: string) => unknown } | undefined)
      : undefined
    const isPackageResolvable = pluginPackages && typeof pluginPackages.packageOf === 'function' && resolveBase
      ? (pkg: string) => pluginPackages.packageOf!(pkg, resolveBase) !== undefined
      : undefined

    const runtime = new ExpertPresetRuntime({
      home: () => dshHome(),
      registry: {
        list: () => service.list(),
        register: typeof service.register === 'function'
          ? (definition) => service.register!(definition)
          : undefined,
      },
      isPackageResolvable,
      onChanged: notifyAgentPresetsChanged,
    })

    setAgentPresetsProvider(() => runtime.listOfficial())
    setExpertPresetRuntime(runtime)

    void runtime.restoreInstalled().catch((err) => {
      console.warn(`[omnimux-market] expert restore failed on boot: ${err instanceof Error ? err.message : String(err)}`)
    })

    if (typeof rawCtx.effect === 'function') {
      rawCtx.effect(() => () => {
        setExpertPresetRuntime(null)
        setAgentPresetsProvider(null)
        return runtime.disposeAll()
      })
    }
  })
}

function registerMarketTools(ctx: Context, specs: MarketToolSpec[]): void {
  for (const tool of specs) {
    ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: tool.output,
      presentCall: tool.presentCall,
      presentResult: tool.presentResult,
      timeoutMs: tool.timeoutMs ?? 20_000,
      async execute(args: Record<string, unknown>, exec?: unknown) {
        return cloneJson(await tool.execute(args, exec))
      },
    } as never))
  }
}

function marketRoots() {
  const home = dshHome()
  return { home, profileDir: profileDir(home), packageRoot: packageRoot() }
}

/** 专家广场工具：实现见 plaza-tools.ts，host 只负责注册。 */
function registerPlazaTools(ctx: Context): void {
  registerMarketTools(ctx, createPlazaTools(marketRoots, () => loadCatalog()))
}

function registerPluginTools(ctx: Context, cfg: PluginConfig): void {
  registerMarketTools(ctx, createPluginTools({
    cfg: () => cfg,
    lock: withPluginInstallLock,
    listPlugins,
    installMarketPlugin,
    removeDshPlugin,
    readInstalled: () => readInstalledPlugins(),
    isProtected: (name) => isProtectedBundle(name, cfg.protectedBundlesExtra),
  }))
}

function registerConnectorTools(ctx: Context, cfg: PluginConfig): void {
  registerMarketTools(ctx, createConnectorTools({
    roots: marketRoots,
    loadCatalog: () => decorateCatalog(loadCatalog(), marketRoots()),
    listMarketplace: () => listMarketplaceConnectors(),
    installItem,
    removeMcpRow,
    findItem,
    lock: withConnectorPatchLock,
  }, () => ({ maxResults: cfg.connectorMaxResults })))
}

export { CORE_PROTECTED_BUNDLES, isProtectedBundle } from './plugin-market.js'
export { INSTALL_TIMEOUT_MS } from './dsh-cli.js'
export {
  cloneJson,
  renderConnectorInstall,
  renderConnectorList,
  renderConnectorSearch,
  renderConnectorUninstall,
  renderInstall,
  renderList,
  renderPluginInstall,
  renderPluginList,
  renderPluginSearch,
  renderPluginUninstall,
  renderSearch,
} from './host-render.js'
