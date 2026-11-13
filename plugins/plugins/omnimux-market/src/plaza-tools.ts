import { decorateCatalog } from './expert/catalog.js'
import { findItem, installItem } from './expert/install.js'
import { summonItem } from './expert/summon.js'
import { readSessionExpert, sessionIdFromExec, writeSessionExpert } from './session-attach.js'
import type { MarketToolSpec } from './types.js'

/** Host / 测试共用的 DSH 根目录。 */
export interface PlazaRoots {
  home: string
  profileDir: string
  packageRoot: string
}

/** catalog.js 是 JS；这里只依赖 items[]，安装/召唤再交给 findItem。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CatalogDoc = any

const PLAZA_KINDS = new Set(['expert', 'team'])

/**
 * 系统提示 `tool:plaza-experts`（order 209）。语义按规格 §7.3，英文便于与 skillhub 段并列。
 */
export const PLAZA_PROMPT_LINES = [
  'PRIORITY RULE (experts beat skills): An expert is an identity that carries its skills; the skill tool only installs one step. So when the task needs a professional role, attach an expert FIRST, and let the expert bring its skill — do not inject a skill directly.',
  'If this session has no expert attached, and the user task needs a professional role to do well that a generic assistant cannot supply on its own — such as PRD/roadmap, competitive analysis, user research, legal/contracts, investment research, deep reports, code review beyond a one-line change, long-form/brand ops, psychological tests/assessments (MBTI, 性格/心理测试, 测评问卷), marketing/activity planning, ad creative planning, or any task where an expert methodology, rubric, or framework materially improves the outcome — then you MUST call plaza_search FIRST, before doing any work.',
  'Do NOT use the skill tool to inject a matching-sounding skill whenever an expert may exist for this domain. Even if the session skill catalog lists a skill whose name clearly matches the task, you must still call plaza_search FIRST and let the user choose an expert (which brings its own skill). You may only fall back to the skill tool after plaza_search returns zero experts. Never skill-inject before the expert choice appears.',
  'Do not plaza_search when an expert (or team) is already attached, the user only wants a SkillHub skill, or the user is chatting casually or asking a simple factual/short task that a generic assistant handles fine.',
  'When plaza_search returns cards: immediately call ask_user_question (single-select, not multi_select) so the composer chips pick the expert. One option per card. Copy each expert option label VERBATIM from the plaza_search result lines (`label=\`id · 中文名\``). Description = the description on that same line. Always include a last option whose label is exactly `skip · 不用专家`. Do not invent ids. Do not invent process options like 先用专家分诊. Do not list experts as markdown. Do not wait for a message-card click. If the tool result has no label= lines, continue the original task silently — never invent experts.',
  'After the user answers: if they chose skip, continue the original task silently and do not plaza_summon. Otherwise parse the catalog id as the text before the first ` · ` in the selected label, then call plaza_summon({ id }) in THIS turn. Never plaza_summon unless that answer named an id.',
  'Zero matches or the user skipped: continue the original task silently. No apology essay. Do not call plaza_search again in this turn.',
  'Use skillhub_search only for SkillHub skills. Do not call plaza_search and skillhub_search in the same user message (experts first).',
  'plaza_summon persists the expert on this session (disk + every later system prompt). A /skill gesture only injects one step; do not treat that as the attachment. After summon, the client may send a follow-up — do not rewrite the user task.',
]

function clampLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 3
  return Math.min(3, Math.max(1, Math.floor(n)))
}

/** 模型常把整句塞进 query。整串 includes 打不中「产品管理专家」这类真条目。 */
const PLAZA_STOP = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'and', 'or', 'from', 'by', 'as', 'is', 'at',
  'this', 'that', 'into',
  '的', '了', '和', '与', '及', '或', '在', '为', '对', '把', '被', '让', '请', '帮', '我', '你',
  '一个', '一份', '一些', '这个', '那个', '帮我', '我要', '写', '做', '开发', '实现', '需要',
])

const PLAZA_ALIAS: Record<string, string[]> = {
  prd: ['prd', '产品', '需求'],
  product: ['product', '产品'],
  requirements: ['requirements', '需求'],
  plugin: ['plugin', '插件'],
  legal: ['legal', '法律', '合同'],
  contract: ['contract', '合同'],
  research: ['research', '研究'],
}

/**
 * 空白/标点切开；中文保留整词并补 2 字片；英文 ≥2 字母。停用词丢掉。
 */
export function tokenizePlazaQuery(query: string): string[] {
  const raw = String(query || '').trim().toLowerCase()
  if (!raw) return []
  const parts = raw.split(/[^0-9a-zA-Z\u4e00-\u9fff]+/).filter(Boolean)
  const out = new Set<string>()
  for (const part of parts) {
    if (PLAZA_STOP.has(part)) continue
    if (/[\u4e00-\u9fff]/.test(part)) {
      if (part.length >= 2) out.add(part)
      for (let i = 0; i + 1 < part.length; i++) {
        const bg = part.slice(i, i + 2)
        if (!PLAZA_STOP.has(bg)) out.add(bg)
      }
    }
    else if (part.length >= 2) {
      out.add(part)
    }
    const aliases = PLAZA_ALIAS[part]
    if (aliases) {
      for (const alias of aliases) out.add(alias)
    }
  }
  return [...out]
}

function plazaHay(item: Record<string, unknown>): string {
  const tags = Array.isArray(item.tags) ? item.tags.join(' ') : ''
  return `${item.title || ''} ${item.subtitle || ''} ${item.summary || ''} ${tags} ${item.id || ''}`.toLowerCase()
}

function plazaTokenWeight(token: string): number {
  if (token.length >= 4) return 5
  if (token.length >= 3) return 3
  return 2
}

function scorePlazaItem(item: Record<string, unknown>, tokens: string[]): number {
  if (!tokens.length) return 1
  const hay = plazaHay(item)
  const title = `${item.title || ''} ${item.id || ''}`.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (!hay.includes(token)) continue
    const w = plazaTokenWeight(token)
    score += title.includes(token) ? w * 2 : w
  }
  return score
}

/**
 * 从本地 catalog 筛专家 / 专家团。默认 tab=experts，只保留 kind∈{expert,team}。
 * query 按词 OR 打分，不再要求整句出现在摘要里。
 */
export function listPlazaLocal(catalog: CatalogDoc, query: string, tab: string, limit: number): {
  list: Array<Record<string, unknown>>
  total: number
} {
  const wantTab = String(tab || 'experts').trim() || 'experts'
  const tokens = tokenizePlazaQuery(query)
  const pool = (catalog.items as Array<Record<string, unknown>>).filter((item: Record<string, unknown>) => {
    const kind = String(item.kind || '')
    if (!PLAZA_KINDS.has(kind)) return false
    if (wantTab && String(item.tab || '') !== wantTab) return false
    return true
  })
  const ranked = tokens.length
    ? pool
      .map((item, index) => ({ item, index, score: scorePlazaItem(item, tokens) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((row) => row.item)
    : pool
  const cap = clampLimit(limit)
  return { list: ranked.slice(0, cap), total: ranked.length }
}

function decoratePlaza(item: Record<string, unknown>) {
  return {
    id: String(item.id || ''),
    title: String(item.title || ''),
    summary: String(item.summary || '').slice(0, 200),
    kind: String(item.kind || ''),
    avatar: typeof item.avatar === 'string' ? item.avatar : '',
    installed: Boolean(item.installed),
    skill: typeof item.skill === 'string' ? item.skill : '',
  }
}

/** 模型只看见这段字，看不见结构化 items。必须把 catalog id / 中文名写进去。 */
export function renderPlazaSearch(value: {
  items?: Array<Record<string, unknown>>
  skipped?: string
  attached?: { title?: string; id?: string }
}): string {
  if (value.skipped === 'already-attached') {
    return `本会话已挂专家 ${value.attached?.title || value.attached?.id || ''}。禁止再搜、再推、再召唤。继续原任务。`
  }
  const items = value.items || []
  if (!items.length) {
    return '广场无匹配专家。不要对用户道歉长文，静默继续原任务。不要再调用 plaza_search。'
  }
  const cards = items.map((item, index) => {
    const id = String(item.id || '').trim()
    const title = String(item.title || id).trim()
    const summary = String(item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const label = `${id} · ${title}`
    return `${index + 1}. label=\`${label}\`${summary ? `  description=${summary}` : ''}`
  })
  return [
    `已搜到 ${items.length} 位专家。立刻 ask_user_question（单选，不是 multi_select）让用户点选。`,
    '选项必须与下列卡片一一对应。每个专家选项的 label 必须与下列 label 字段完全一致（含 catalog id 和间隔点），禁止改写、禁止发明 id、禁止把流程选项当专家。',
    ...cards,
    '最后一项必须是 label=`skip · 不用专家` description=不用广场专家，继续用当前助手做原任务。',
    '未得到用户选项卡答案前禁止 plaza_summon。禁止 markdown 清单当产品选项。点 skip 则静默继续原任务。',
  ].join('\n')
}

function renderPlazaSummon(value: { id?: string, gesture?: string, skill?: string, attached?: boolean, title?: string }): string {
  const persist = value.attached
    ? `已持久挂上本会话：${value.title || value.id}（skill ${value.skill || ''}）。之后每一轮系统提示都会带上该专家身份，不只是这一条 /skill。`
    : `技能已安装，但未能写入会话挂载（无会话 id）。本轮仍可走 ${value.gesture || ''}，刷新后身份可能丢失。`
  return `已召唤 ${value.id || ''} → ${value.gesture || ''}。${persist} 客户端可能会发续任务，不要再手写一遍。`
}

/**
 * 组装 plaza_* 工具（不含注册）。广场逻辑集中在本文件，host 只负责 defineTool + prompt 段。
 */
export function createPlazaTools(roots: () => PlazaRoots, loadCatalog: () => CatalogDoc): MarketToolSpec[] {
  return [
    {
      name: 'plaza_search',
      description:
        'Search the local OmniMux plaza catalog for experts and expert teams. Default tab is experts. Returns at most 3 cards. Use when the session has no expert attached and the task needs a professional role, or the user asked for an expert. Do not use for SkillHub skills (skillhub_search). There is no hub/online merge.',
      parameters: {
        query: { type: 'string', description: 'Keywords (space-separated or a short phrase). Matched as tokens, not as one substring. Optional to browse experts.' },
        tab: { type: 'string', description: 'experts (default). Only expert/team rows are returned.' },
        limit: { type: 'number', description: 'Cards to return, 1–3. Default 3.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderPlazaSearch(value as { items?: Array<Record<string, unknown>> }) }],
        presentationMeta: (_args: unknown, value: unknown) => ({ kind: 'plaza-search', ...(value as object) }),
      },
      presentCall: (args: Record<string, unknown>) => ({
        card: 'generic',
        title: `广场 · ${String(args.tab || 'experts')}${args.query ? ` ${args.query}` : ''}`,
        kind: 'search',
        content: [],
      }),
      presentResult: (_args: unknown, { isError, meta }: { isError?: boolean; meta?: Record<string, unknown> }) => ({
        card: 'generic',
        title: isError ? '广场搜索失败' : `广场 · ${(meta as { items?: unknown[] } | undefined)?.items?.length ?? 0} 条`,
        content: [],
      }),
      async execute(args: Record<string, unknown>, exec?: unknown) {
        const attached = readSessionExpert(roots().home, sessionIdFromExec(exec))
        if (attached) {
          return {
            source: 'plaza',
            tab: String(args.tab || 'experts').trim() || 'experts',
            query: String(args.query || '').trim(),
            total: 0,
            items: [],
            skipped: 'already-attached',
            attached: { id: attached.id, skill: attached.skill, title: attached.title, kind: attached.kind },
          }
        }
        const q = String(args.query || '').trim()
        const tab = String(args.tab || 'experts').trim() || 'experts'
        const limit = clampLimit(args.limit)
        const doc = decorateCatalog(loadCatalog(), roots()) as CatalogDoc
        const found = listPlazaLocal(doc, q, tab, limit)
        return {
          source: 'plaza',
          tab,
          query: q,
          total: found.total,
          items: found.list.map((item) => decoratePlaza(item)),
        }
      },
    },
    {
      name: 'plaza_summon',
      description:
        'Install (if needed) and persist a plaza expert/team on THIS session by catalog id. Writes a durable session attachment so later turns keep the identity (not only a one-step /skill injection). Only after ask_user_question returns a label that starts with that id. Never summon silently. Connectors and SkillHub skills are rejected.',
      parameters: {
        id: { type: 'string', required: true, description: 'Catalog id of an expert or team, e.g. exp-product-manager' },
        sessionState: { type: 'string', description: 'blank | locked. Conversation clicks should pass locked.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderPlazaSummon(value as { id?: string, gesture?: string }) }],
        presentationMeta: (_args: unknown, value: unknown) => ({ kind: 'plaza-summon', ...(value as object) }),
      },
      presentCall: (args: Record<string, unknown>) => ({ card: 'generic', title: `召唤 · ${args.id}`, content: [] }),
      presentResult: (_args: unknown, { isError, meta }: { isError?: boolean; meta?: Record<string, unknown> }) => ({
        card: 'generic',
        title: isError ? '召唤失败' : `召唤 · ${String(meta?.gesture || '')}`,
        content: [],
      }),
      async execute(args: Record<string, unknown>, exec?: unknown) {
        const id = String(args.id || '').trim()
        if (!id) throw new Error('缺少 id')
        const doc = loadCatalog()
        const item = findItem(doc, id) as Record<string, unknown> | undefined
        if (!item) throw new Error(`unknown item ${id}`)
        if (item.kind === 'connector') throw new Error('connectors are installed, not summoned')
        if (!PLAZA_KINDS.has(String(item.kind || ''))) throw new Error(`${id} is not an expert or team`)
        const r = roots()
        const sessionState = args.sessionState === 'blank' ? 'blank' : 'locked'
        const result = summonItem({
          catalog: doc,
          id,
          sessionState,
          home: r.home,
          profileDir: r.profileDir,
          packageRoot: r.packageRoot,
        }) as { id: string, skill: string, gesture: string, stagePreset: string | null, sessionState: string }
        const sessionId = sessionIdFromExec(exec)
        let attached: ReturnType<typeof writeSessionExpert> | null = null
        if (sessionId) {
          attached = writeSessionExpert(r.home, sessionId, {
            id: result.id,
            skill: result.skill,
            title: String(item.title || result.id),
            kind: String(item.kind || 'expert'),
          })
        }
        return {
          id: result.id,
          skill: result.skill,
          gesture: result.gesture,
          stagePreset: result.stagePreset,
          installed: true,
          attached: Boolean(attached),
          sessionId: sessionId || '',
          title: attached?.title || String(item.title || result.id),
        }
      },
    },
    {
      name: 'plaza_install',
      description:
        'Install a plaza catalog item by id without summoning. Internal/compat path. Agent should install connectors with connector_install. Reserved for connectors / skill packs. Expert path is disabled — for experts and teams use plaza_summon (install is included).',
      parameters: {
        id: { type: 'string', required: true, description: 'Catalog id. Do not pass expert/team ids.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => {
          const v = value as { id?: string, already?: boolean }
          return [{ type: 'text', text: `已安装 ${v.id || ''}${v.already ? '（已存在）' : ''}` }]
        },
        presentationMeta: (_args: unknown, value: unknown) => ({ kind: 'plaza-install', ...(value as object) }),
      },
      presentCall: (args: Record<string, unknown>) => ({ card: 'generic', title: `安装 · ${args.id}`, content: [] }),
      presentResult: (_args: unknown, { isError, meta }: { isError?: boolean; meta?: Record<string, unknown> }) => ({
        card: 'generic',
        title: isError ? '安装失败' : `已安装 · ${String(meta?.id || '')}`,
        content: [],
      }),
      async execute(args: Record<string, unknown>) {
        const id = String(args.id || '').trim()
        if (!id) throw new Error('缺少 id')
        const doc = loadCatalog()
        const item = findItem(doc, id) as Record<string, unknown> | undefined
        if (!item) throw new Error(`unknown item ${id}`)
        if (PLAZA_KINDS.has(String(item.kind || ''))) {
          throw new Error('plaza_install is disabled for experts/teams; use plaza_summon')
        }
        const r = roots()
        const result = installItem({
          catalog: doc,
          id,
          home: r.home,
          profileDir: r.profileDir,
          packageRoot: r.packageRoot,
        }) as { id: string, installed?: boolean, already?: boolean, skill?: string, kind?: string }
        return {
          id: result.id,
          installed: true,
          already: Boolean(result.already),
          skill: result.skill || '',
          kind: result.kind || String(item.kind || ''),
        }
      },
    },
  ]
}
