import type { StageStore } from './createStageStore.ts'
import { createWorkbenchStageStore } from '../workbench-stage-store.js'
import type { WorkbenchStageStoreOptions } from '../workbench-stage-store.d.ts'

export { createWorkbenchStageStore }
export type { WorkbenchStageStoreOptions }

export interface SidebarCoordinatorApi {
  register: (row: {
    id: string
    rank: number
    styles?: string
    styleId?: string
    kind?: 'inline'
    create: () => HTMLElement
  }) => () => void
}

export type PluginAccess = 'offline' | 'cloud' | 'local'

export interface SidebarEntryOptions {
  id: string
  rank: number
  label: string | (() => string)
  iconSvg: string
  stageStore: StageStore
  locale?: { subscribe?: (fn: () => void) => () => void }
  customClassName?: string
  datasetKey?: string
  /** Optional extra marker attributes (e.g. `data-omnimux-esc-entry`) set with empty value. */
  extraDatasetKeys?: string[]
  /** When true, mirrors the resolved label onto `button.title` for native tooltip parity. */
  titleAttr?: boolean
  /**
   * Access classification (default 'offline'):
   * - 'offline' / 'local': always visible, clicks open stage directly without auth gating
   * - 'cloud': cloud-dependent; always visible in sidebar, clicks trigger explicit auth gating
   */
  access?: PluginAccess
  /** @deprecated use access instead */
  requireAuth?: boolean
  authReason?: string | (() => string)
}

export interface WorkbenchSidebarEntryOptions extends Omit<SidebarEntryOptions, 'stageStore'> {
  tabId: string
  /** Optional workbench tab title resolver; defaults to `label`. */
  title?: string | (() => string)
  /** Optional workbench sentinel path forwarded to `createSidebarStore`. */
  path?: string
}

const SIDEBAR_ENTRY_COMMON_STYLES = `
.omnimux-sidebar-nav-entry {
  box-sizing: border-box; display: flex; align-items: center; gap: 6px; position: relative;
  width: calc(100% - 8px); height: 32px; margin: 0 4px; padding: 0 8px;
  border: none; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-s-14, inherit); font-size: 14px; line-height: 20px;
  cursor: pointer; text-align: left;
  transition: background-color var(--omnimux-motion-dur-press, 90ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform var(--omnimux-motion-dur-press, 90ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.omnimux-sidebar-nav-entry[data-hidden="true"],
.omnimux-sidebar-nav-entry.omnimux-sidebar-nav-entry-hidden {
  display: none !important;
}
.omnimux-sidebar-nav-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.omnimux-sidebar-nav-entry:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.omnimux-sidebar-nav-entry:active {
  transform: scale(var(--omnimux-motion-press-scale, 0.96));
}
@media (prefers-reduced-motion: reduce) {
  .omnimux-sidebar-nav-entry { transition: none; }
  .omnimux-sidebar-nav-entry:active { transform: none; }
}
.omnimux-sidebar-nav-entry[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  font-weight: 500;
}
.omnimux-sidebar-nav-entry-icon {
  flex: none; display: inline-flex; width: 14px; height: 14px; align-items: center; justify-content: center;
}
.omnimux-sidebar-nav-entry-icon svg {
  display: block; width: 14px; height: 14px;
}
.omnimux-sidebar-nav-entry-label {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 20px;
}
`

function resolveLabel(label: string | (() => string)): string {
  return typeof label === 'function' ? label() : label
}

function paintLabel(entry: HTMLElement, labelText: string, titleAttr = true) {
  entry.setAttribute('aria-label', labelText)
  if (titleAttr) {
    entry.title = labelText
  }
  const node = entry.querySelector('.omnimux-sidebar-nav-entry-label')
  if (node) node.textContent = labelText
}

function registerWhenCoordinatorReady(row: {
  id: string
  rank: number
  styles?: string
  styleId?: string
  create: () => HTMLElement
}): () => void {
  let unregister = () => {}
  let disposed = false
  const attempt = () => {
    if (disposed) return
    const win = typeof window !== 'undefined' ? (window as unknown as { __omnimuxSidebar?: SidebarCoordinatorApi }) : undefined
    const api = win?.__omnimuxSidebar
    if (!api || typeof api.register !== 'function') return
    unregister = api.register(row)
    clearInterval(timer)
  }
  const timer = setInterval(attempt, 500)
  attempt()
  return () => {
    disposed = true
    clearInterval(timer)
    unregister()
  }
}

export interface OmnimuxAuthGlobal {
  isLoggedIn?: () => boolean
  peekCache?: () => { ok?: boolean; body?: { logged_in?: boolean } } | null
  getSnapshot?: () => { phase?: string }
  ensureLogin?: (opts: { reason?: string; kind?: 'nav' | 'write' | 'explicit'; onSuccess?: () => void }) => void
  subscribe?: (fn: () => void) => () => void
}

/**
 * Creates and mounts a standardized sidebar entry under the 新会话 button.
 * Uses idempotent activation (stageStore.open()) to guarantee persistent selection.
 */
export function createSidebarEntry(options: SidebarEntryOptions): () => void {
  const {
    id,
    rank,
    label,
    iconSvg,
    stageStore,
    locale,
    customClassName,
    datasetKey,
    extraDatasetKeys,
    titleAttr = true,
    access = 'offline',
    requireAuth,
    authReason,
  } = options

  const entry = document.createElement('button')
  entry.type = 'button'
  if (datasetKey) {
    entry.setAttribute(datasetKey, '')
  }
  if (Array.isArray(extraDatasetKeys)) {
    for (const key of extraDatasetKeys) {
      if (key) entry.setAttribute(key, '')
    }
  }
  entry.className = `omnimux-sidebar-nav-entry ${customClassName || ''}`.trim()
  entry.innerHTML = `<span class="omnimux-sidebar-nav-entry-icon">${iconSvg}</span><span class="omnimux-sidebar-nav-entry-label"></span>`

  const updateLabel = () => {
    paintLabel(entry, resolveLabel(label), titleAttr)
  }
  updateLabel()

  // Idempotent click: always open/claim the stage, never toggle!
  entry.addEventListener('click', () => {
    // If access is 'cloud' or legacy requireAuth is true, gate with explicit auth; offline/local opens stage directly
    const needsAuth = access === 'cloud' || (access === 'offline' && requireAuth === true)
    if (needsAuth) {
      const win = typeof window !== 'undefined' ? (window as unknown as { __omnimuxAuth?: OmnimuxAuthGlobal }) : undefined
      const auth = win?.__omnimuxAuth
      if (auth && typeof auth.ensureLogin === 'function') {
        const reason = authReason ? resolveLabel(authReason) : resolveLabel(label)
        auth.ensureLogin({
          reason,
          kind: 'explicit',
          onSuccess: () => {
            stageStore.open()
          },
        })
        return
      }
    }
    stageStore.open()
  })

  const syncActive = () => {
    if (stageStore.getSnapshot()) {
      entry.dataset.active = 'true'
    } else {
      delete entry.dataset.active
    }
  }

  const unsubscribeStage = stageStore.subscribe(syncActive)
  syncActive()

  const unsubscribeLocale = typeof locale?.subscribe === 'function' ? locale.subscribe(updateLabel) : () => {}

  const unregisterCoordinator = registerWhenCoordinatorReady({
    id: `${id}-entry`,
    rank,
    styles: SIDEBAR_ENTRY_COMMON_STYLES,
    styleId: 'omnimux-sidebar-nav-entry-styles',
    create: () => entry,
  })

  return () => {
    unregisterCoordinator()
    unsubscribeStage()
    unsubscribeLocale()
  }
}

/**
 * Convenience helper for Workbench Tab sidebar entries.
 * Wires `createWorkbenchStageStore` directly into `createSidebarEntry` so plugins
 * do not copy-paste `window.__omnimuxWorkbench` polling boilerplate.
 */
export function createWorkbenchSidebarEntry(options: WorkbenchSidebarEntryOptions): () => void {
  const { tabId, title, path, ...rest } = options
  const stageStore = createWorkbenchStageStore({
    tabId,
    title: title ?? rest.label,
    ...(path ? { path } : {}),
  })
  return createSidebarEntry({
    ...rest,
    stageStore,
  })
}
