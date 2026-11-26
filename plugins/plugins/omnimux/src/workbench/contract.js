/**
 * Workbench 中枢契约（browser-safe，Host 与 Client 共用单真源）。
 *
 * 统一出口：
 * - `WORKBENCH_OCCUPANTS`：workbench Tab occupant 单真源（此前在
 *   `src/workbench/schema.js` 与 `src/client/workbench.js` 各重复一份）。
 * - `WORKBENCH_FOCUS`：chat / gui / split 焦点模式。
 * - Envelope / Surface / Context / SidebarSnapshot JSDoc 类型。
 * - 信封与快照的验证/判定纯函数。
 *
 * 本模块禁止依赖 DOM、window 或 Node API，保证浏览器与 Host 两侧均可消费。
 */

/**
 * Workbench Tab occupant 单真源。
 * @type {readonly string[]}
 */
export const WORKBENCH_OCCUPANTS = Object.freeze([
  'omnimux-workflow:canvas',
  'omnimux-clip:studio',
  'omnimux-assets:library',
  'omnimux-accounts:library',
  'omnimux-inspiration:library',
  'omnimux-publish:library',
  'omnimux-analytics:library',
  'omnimux-workflow:library',
  'omnimux-market:plaza',
])

/** 焦点模式：chat = 仅会话（右栏关闭），gui = 面板铺满，split = 会话+面板分栏。 */
export const WORKBENCH_FOCUS = Object.freeze({
  split: 'split',
  gui: 'gui',
  chat: 'chat',
})

export const VIEWPORT_STALE_THRESHOLD_MS = 3000

/**
 * 官方 better-sidebar 快照（当前 pin 的唯一合法形状）。
 * 不允许 `snap.state || snap` 式兼容猜测：没有 `.state` 即视为无状态。
 * @typedef {object} SidebarSnapshot
 * @property {string} [sessionId]
 * @property {object} [state] better-sidebar 布局状态（splits / width / panelOpen …）
 */

/**
 * workbench 表面状态：当前活跃 Tab 与面板几何投影。
 * @typedef {object} WorkbenchSurface
 * @property {string | null} tabId
 * @property {string | null} title
 * @property {string | null} type
 * @property {'workbench' | 'files' | 'native' | null} kind
 * @property {string | null} plugin
 * @property {boolean} panelOpen
 * @property {'split' | 'gui' | 'chat'} focus
 * @property {boolean} conversationCollapsed
 * @property {Array<{ id: string, type: string, title: string, kind: string }>} openedTabs
 */

/**
 * Agent 可见的上下文视图（由 Context contributor 投影）。
 * @typedef {object} WorkbenchContextView
 * @property {string} [kind]
 * @property {string} [pageId]
 * @property {string} [filterType]
 * @property {string} [query]
 * @property {Record<string, unknown>} [extra] 仅白名单键可外泄；`workspaceId` 必须为纯逻辑 ID。
 */

/**
 * UI 上下文信封：Client `getUiContext()` 产出、Host mailbox 消费。
 * @typedef {object} WorkbenchEnvelope
 * @property {1} schemaVersion
 * @property {boolean} ok
 * @property {number} capturedAt
 * @property {string} reason
 * @property {string} sessionId
 * @property {WorkbenchSurface} surface
 * @property {WorkbenchContextView | null} view
 * @property {Array<Record<string, unknown>>} selection
 */

/**
 * 严格 occupant 判定（Host 工具侧白名单）。
 * @param {unknown} tabId
 */
export function isValidTabId(tabId) {
  return typeof tabId === 'string' && WORKBENCH_OCCUPANTS.includes(tabId)
}

/**
 * @param {unknown} raw
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateEnvelope(raw) {
  if (!raw || typeof raw !== 'object') return { valid: false, error: 'envelope-must-be-object' }
  if (raw.schemaVersion !== 1) return { valid: false, error: 'invalid-schema-version' }
  if (typeof raw.ok !== 'boolean') return { valid: false, error: 'ok-must-be-boolean' }
  if (typeof raw.capturedAt !== 'number') return { valid: false, error: 'capturedAt-must-be-number' }
  return { valid: true }
}

/**
 * @param {{ capturedAt?: unknown } | null | undefined} viewport
 * @param {number} [now]
 */
export function isViewportStale(viewport, now = Date.now()) {
  if (!viewport || typeof viewport.capturedAt !== 'number') return true
  return now - viewport.capturedAt > VIEWPORT_STALE_THRESHOLD_MS
}

/**
 * @param {unknown} body
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateRpcAck(body) {
  if (!body || typeof body !== 'object') return { valid: false, error: 'body-must-be-object' }
  if (!body.requestId || typeof body.requestId !== 'string') return { valid: false, error: 'requestId-required' }
  if (typeof body.ok !== 'boolean') return { valid: false, error: 'ok-must-be-boolean' }
  if (typeof body.applied !== 'boolean') return { valid: false, error: 'applied-must-be-boolean' }
  return { valid: true }
}

/** Logical workspace id only — reject path-like values. */
function isSafeWorkspaceId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('~')
}

function isSafeShortToken(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && !value.includes('\n')
    && !value.includes('|')
}

/** Phase 1 navigation hint from the mounted canvas Portal. */
export function isCanvasClipActive(envelope) {
  if (envelope?.surface?.tabId !== 'omnimux-workflow:canvas' || envelope.surface.panelOpen !== true) return false
  const extra = envelope.view?.extra
  const clip = extra?.clip
  return clip?.mode === 'canvas'
    && typeof clip.workspaceId === 'string' && clip.workspaceId === extra.workspaceId
    && typeof clip.nodeId === 'string' && clip.nodeId.length > 0
    && typeof clip.projectId === 'string' && clip.projectId.length > 0
}

const clipId = value => typeof value === 'string' && /^[\p{L}\p{N}_.:-]{1,256}$/u.test(value)
  && !/^(?:blob|data|file|javascript|https?):/i.test(value) ? value : null
const clipTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

function clipLabel(value) {
  if (typeof value !== 'string' || /[\\/]|(?:^|\s)[a-z]:/i.test(value)) return ''
  return Array.from(value).filter(char => char.codePointAt(0) >= 32 && !/[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(char))
    .join('').replace(/[|<>]/g, ' ').trim().slice(0, 96)
}

/** Only the active seat can contribute the compact, path-free Clip projection. */
export function clipContextFromEnvelope(envelope) {
  if (envelope?.surface?.panelOpen !== true) return null
  const clip = envelope.view?.extra?.clip
  const canvas = isCanvasClipActive(envelope)
  if (!clip || (!canvas && !(envelope.surface.tabId === 'omnimux-clip:studio' && clip.mode === 'standalone'))) return null
  const projectId = clipId(clip.projectId)
  const durationSec = clipTime(clip.durationSec)
  const playheadSec = clipTime(clip.playheadSec)
  const revisionEpoch = clip.revisionEpoch === undefined ? 0 : clip.revisionEpoch
  if (!projectId || !Number.isSafeInteger(clip.revision) || clip.revision < 0
    || !Number.isSafeInteger(revisionEpoch) || revisionEpoch < 0 || durationSec === null || playheadSec === null) return null
  if (canvas && (!isSafeWorkspaceId(clip.workspaceId) || !clipId(clip.nodeId))) return null
  const selectedClips = []
  for (const clipRow of Array.isArray(clip.selectedClips) ? clip.selectedClips.slice(0, 3) : []) {
    const id = clipId(clipRow?.id)
    const trackId = clipId(clipRow?.trackId)
    const startSec = clipTime(clipRow?.startSec)
    const endSec = clipTime(clipRow?.endSec)
    if (id && trackId && startSec !== null && endSec !== null && endSec >= startSec) {
      selectedClips.push({ id, trackId, name: clipLabel(clipRow.name), startSec, endSec })
    }
  }
  return {
    mode: clip.mode, projectId, title: clipLabel(clip.title), revision: clip.revision, revisionEpoch, playheadSec, durationSec, selectedClips,
    ...(canvas ? { workspaceId: clip.workspaceId, nodeId: clip.nodeId } : {}),
  }
}

/**
 * @param {WorkbenchEnvelope} envelope
 * @param {{ includeClip?: boolean }} options
 */
export function formatCompactContextBlock(envelope, { includeClip = true } = {}) {
  if (!envelope || !envelope.surface) return ''
  const s = envelope.surface
  const view = envelope.view && typeof envelope.view === 'object' ? envelope.view : null
  const extra = view?.extra && typeof view.extra === 'object' ? view.extra : null
  const lines = []
  lines.push('<ui_context schema="1">')

  const titleStr = s.title && s.title !== s.tabId ? ` (${s.title})` : ''
  let firstLine = `tab: ${s.tabId || 'none'}${titleStr}`
  if (isSafeShortToken(view?.kind)) {
    firstLine += ` | view: ${view.kind}`
  }
  if (isSafeShortToken(view?.pageId)) {
    firstLine += ` | page: ${view.pageId}`
  }
  // Canvas workspace is a P0 routing key — whitelist only, never dump all extra.
  const workspaceId = extra?.workspaceId
  if (isSafeWorkspaceId(workspaceId)) {
    firstLine += ` | workspace: ${workspaceId}`
  }
  if (view?.filterType) {
    firstLine += ` | filter: ${view.filterType}`
  }
  if (view?.query) {
    firstLine += ` | query: ${view.query}`
  }
  if (Array.isArray(envelope.selection) && envelope.selection.length > 0) {
    const selStr = envelope.selection.slice(0, 3).map((item) => {
      const name = item.name || item.title || item.id
      return item.id && name !== item.id ? `${name} (${item.id})` : name
    }).join(', ')
    firstLine += ` | selected: ${selStr}`
  }
  lines.push(firstLine)

  if (Array.isArray(s.openedTabs) && s.openedTabs.length > 0) {
    const openStr = s.openedTabs.map((t) => {
      if (!t) return ''
      if (typeof t === 'string') return t
      const label = t.title && t.title !== t.id ? t.title : (t.id || t.type || '')
      return t.id === s.tabId ? `${label}*` : label
    }).filter(Boolean).join(', ')
    if (openStr) lines.push(`open: ${openStr}`)
  }

  const secondLine = `panel: ${s.panelOpen ? 'open' : 'closed'} | focus: ${s.focus || 'split'}`
  lines.push(secondLine)
  const clip = includeClip ? clipContextFromEnvelope(envelope) : null
  if (clip) {
    const fields = [
      `mode: ${clip.mode}`, `projectId: ${clip.projectId}`, `title: ${clip.title}`,
      `revision: ${clip.revision}`, `revisionEpoch: ${clip.revisionEpoch}`, `playheadSec: ${clip.playheadSec}`, `durationSec: ${clip.durationSec}`,
    ]
    if (clip.mode === 'canvas') fields.push(`workspaceId: ${clip.workspaceId}`, `nodeId: ${clip.nodeId}`)
    lines.push(`clip | ${fields.join(' | ')}`)
    if (clip.selectedClips.length) lines.push(`selectedClips: ${JSON.stringify(clip.selectedClips)}`)
  }
  if (s.panelOpen && s.tabId === 'omnimux:media-viewer' && view?.kind === 'canvas') {
    lines.push('图像生成页已打开：仅当本轮用户明确要求生成或编辑图片、视频时才调用生图/生视频工具（编辑须用用户指定的原图），普通提问与分析不启动生成；等待调度不等于工具已启动。')
  }
  lines.push('</ui_context>')
  return lines.join(String.fromCharCode(10))
}
