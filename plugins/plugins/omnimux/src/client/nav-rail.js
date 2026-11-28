/**
 * 固定最左侧 52px 图标导航轨与「首页 = Agent 会话工作区」联动控制器。
 *
 * 设计约束（specs/left-nav-rail.spec.md D1–D9）：
 *   1. 最左 52px 固定轨全生命周期常驻（引导页除外），上区 6 项固定为
 *      「首页 → 项目 → 技能/专家 → 资产库 → 灵感社区 → 更多」，数量恒定不变；
 *   2. 下区固定承载「应用更新（带红点）→ 远程控制 → 账号设置」，并清空首页次级会话栏底部；
 *   3. 仅「首页（含对话 + 右栏分屏）」展示次级 Agent 会话栏，切换至任何非首页业务页
 *      （项目 / 技能专家 / 资产库 / 灵感社区 / 更多子页 / 官方插件或自动化面板）时
 *      自动收起次级会话栏并隐藏顶栏折叠钮；
 *   4. 点击固定轨「首页」严格幂等：退出全屏业务页/全局面板并强制展开会话栏（已在首页时不误触收起）；
 *   5. 全量样式消费白名单 `--dsw-*` / `--omnimux-motion-*` 令牌并配对 Legacy / Next 双壳选择器。
 */

import {
  ALPHA_DESCRIPTION,
  activateExploreItem,
  activatePinnedEntry,
  isAlphaEntry,
  resolveExploreMenuItems,
} from './sidebar-coordinator.js'
import { MORE_MENU_SELECTOR } from './sidebar-panel-chrome.js'
import {
  ensureSidebarToggleTopbar,
  findOfficialSidebarToggle,
  findVisibleOfficialSidebarToggle,
  isLeftSidebarCollapsed,
  isOnboardingGuideActive,
  LEFT_COLLAPSED_HTML_ATTR,
  setExplicitLeftCollapseIntent,
  SIDEBAR_ORIGINAL_TOGGLE_ATTR,
  syncLeftCollapsedHtmlAttr,
  triggerClick,
} from './sidebar-toggle-topbar.js'
import { ensureConversationVisible } from './workbench/ensure-conversation-visible.js'
import { subscribeWorkbench } from './workbench/event-bus.js'
import {
  currentSessionId,
  getWorkbenchLayout,
  hostDocument,
  hostWindow,
} from './workbench/host-adapter.js'
import { exitHostRightSidebarFullscreen } from './workbench/host-fullscreen.js'
import {
  readFreshRailActivation,
  requestRailActivationSync,
  resolveFixedRailState,
} from './workbench/sidebar-activation.js'
import { releaseCurrentProductStage } from './workbench/sidebar-controller.js'
import { setWorkbenchFocus } from './workbench/split-layout.js'

export const NAV_RAIL_ID = 'omnimux-nav-rail'
export const NAV_RAIL_STYLE_ID = 'omnimux-nav-rail-styles'
export const NAV_RAIL_ACTIVE_ATTR = 'data-omnimux-nav-rail-active'
export const NAV_RAIL_VIEW_ATTR = 'data-omnimux-nav-view'
export const NAV_RAIL_WIDTH_VAR = '--omnimux-nav-rail-width'
export const NAV_RAIL_WIDTH_PX = 52
export const NAV_RAIL_MORE_FALLBACK_ID = 'omnimux-nav-rail-more-menu'

const OFFICIAL_PANEL_IDS = Object.freeze(['plugins', 'schedules'])
const DESKTOP_SETTINGS_TAB_RE = /^(桌面设置|Desktop settings)$/u
const REMOTE_CONTROL_BUTTON_SELECTOR = [
  '[data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="远程控制"]',
  '[data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="Remote Control"]',
  '[data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="Mobile connection"]',
  '[data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="手机连接"]',
  '[data-slot="sidebar.footer.action"] button[aria-haspopup="dialog"][aria-label="Agents Anywhere"]',
].join(', ')

const UPDATE_PILL_SELECTOR = 'button[data-next-update-pill]'

/** 固定轨上区一级入口定义（顺序与数量严格锁定，绝不动态增减）。 */
export const NAV_RAIL_TOP_ITEMS = Object.freeze([
  Object.freeze({
    id: 'home',
    label: '首页',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8.2 9 2.8l6.5 5.4"/><path d="M4.2 7.2V15h3.5v-4.2h2.6V15h3.5V7.2"/></svg>',
  }),
  Object.freeze({
    id: 'projects',
    label: '项目',
    entryId: 'omnimux-workflow-entry',
    tabId: 'omnimux-workflow:library',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 5.2a1.7 1.7 0 0 1 1.7-1.7h3.1l1.5 1.7h5a1.7 1.7 0 0 1 1.7 1.7v6.4a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7V5.2Z"/></svg>',
  }),
  Object.freeze({
    id: 'market',
    label: '技能/专家',
    entryId: 'omnimux-market-entry',
    tabId: 'omnimux-market:plaza',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1.4"/><rect x="10" y="2.5" width="5.5" height="5.5" rx="1.4"/><rect x="2.5" y="10" width="5.5" height="5.5" rx="1.4"/><rect x="10" y="10" width="5.5" height="5.5" rx="1.4"/></svg>',
  }),
  Object.freeze({
    id: 'assets',
    label: '资产库',
    entryId: 'omnimux-assets-entry',
    tabId: 'omnimux-assets:library',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.2 14.5h8a3 3 0 0 0 .5-5.95 4.3 4.3 0 0 0-8.4-.7A3.4 3.4 0 0 0 5.2 14.5Z"/></svg>',
  }),
  Object.freeze({
    id: 'inspiration',
    label: '灵感社区',
    entryId: 'omnimux-inspiration-entry',
    tabId: 'omnimux-inspiration:library',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="2.5" width="8.5" height="13" rx="1.8"/><path d="m14.8 5.2-3.3 1.4v4.8l3.3 1.4V5.2Z"/></svg>',
  }),
  Object.freeze({
    id: 'more',
    label: '更多',
    hasPopup: 'menu',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="14" cy="9" r="1.4"/></svg>',
  }),
])

/** 固定轨下区全局系统入口定义。 */
export const NAV_RAIL_BOTTOM_ITEMS = Object.freeze([
  Object.freeze({
    id: 'updates',
    label: '应用更新',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3.2v7.8"/><path d="m5.8 8.2 3.2 3.2 3.2-3.2"/><path d="M3.5 14.2h11"/></svg>',
  }),
  Object.freeze({
    id: 'remote-control',
    label: '远程控制',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.4" width="8" height="13.2" rx="2"/><circle cx="9" cy="12.6" r="0.8" fill="currentColor" stroke="none"/></svg>',
  }),
  Object.freeze({
    id: 'settings',
    label: '账号设置',
    iconSvg: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="6.2" r="2.7"/><path d="M3.6 14.8a5.4 5.4 0 0 1 10.8 0"/><circle cx="13.8" cy="12.6" r="1.5" fill="none"/></svg>',
  }),
])

/** 白名单令牌 CSS：严格避免裸色值、transition: all，并与 Next/Legacy 双壳配对。 */
export const NAV_RAIL_CSS = `
html[${NAV_RAIL_ACTIVE_ATTR}="1"] #root:not(:has([role="dialog"][aria-modal="true"])) {
  margin-left: var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px) !important;
  width: calc(100vw - var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px)) !important;
  box-sizing: border-box !important;
}

#${NAV_RAIL_ID}[data-omnimux-nav-rail="1"] {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px);
  z-index: 250;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  border-right: 1px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-secondary);
  user-select: none;
  overflow: visible;
}

/* macOS 窗口顶部留出 48px 红绿灯安全区（含窗口拖拽区域，按钮本身豁免拖拽） */
html[data-platform="darwin"]:not([data-fullscreen]) #${NAV_RAIL_ID}[data-omnimux-nav-rail="1"],
html:not([data-fullscreen]) body[data-dsh-desktop-platform="darwin"][data-dsh-desktop-mode] #${NAV_RAIL_ID}[data-omnimux-nav-rail="1"] {
  padding-top: 52px;
}

html[data-platform="darwin"]:not([data-fullscreen]) #${NAV_RAIL_ID}[data-omnimux-nav-rail="1"]::before,
html:not([data-fullscreen]) body[data-dsh-desktop-platform="darwin"][data-dsh-desktop-mode] #${NAV_RAIL_ID}[data-omnimux-nav-rail="1"]::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 48px;
  -webkit-app-region: drag;
  pointer-events: auto;
}

.omnimux-nav-rail-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.omnimux-nav-rail-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.omnimux-nav-rail-divider {
  width: 24px;
  height: 1px;
  margin: 4px 0;
  background: var(--dsw-alias-border-l3);
}

.omnimux-nav-rail-btn {
  position: relative;
  appearance: none;
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              transform var(--omnimux-motion-dur-press, 90ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.omnimux-nav-rail-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.omnimux-nav-rail-btn:active {
  transform: scale(var(--omnimux-motion-press-scale, 0.96));
}

.omnimux-nav-rail-btn[data-active="true"],
.omnimux-nav-rail-btn[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}

.omnimux-nav-rail-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-label-primary));
  outline-offset: 2px;
}

.omnimux-nav-rail-btn svg {
  display: block;
  width: 18px;
  height: 18px;
  pointer-events: none;
}

.omnimux-nav-rail-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary);
  box-shadow: 0 0 0 1.5px var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base));
  opacity: 0;
  transform: scale(0.5);
  pointer-events: none;
  transition: opacity var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              transform var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.omnimux-nav-rail-btn[data-has-update="true"] .omnimux-nav-rail-dot {
  opacity: 1;
  transform: scale(1);
}

.omnimux-nav-rail-tooltip {
  position: fixed;
  left: calc(var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px) + 8px);
  z-index: 1200;
  pointer-events: none;
  padding: 5px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-tooltip-bg, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-tooltip-label, var(--dsw-alias-label-primary));
  box-shadow: var(--dsw-shadow-lv2);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  white-space: nowrap;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              transform var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.omnimux-nav-rail-tooltip[data-visible="true"] {
  opacity: 1;
  transform: translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  .omnimux-nav-rail-btn,
  .omnimux-nav-rail-dot,
  .omnimux-nav-rail-tooltip {
    transition: none !important;
  }
}

/* 隐藏次级会话栏内的官方 nav.panelList 与底部 footArea（保留挂载供命令代理触发与模态弹出） */
html[${NAV_RAIL_ACTIVE_ATTR}="1"] :is(.dshDesktopSidebarSurface, [data-pane="sidebar"], [class*="sidebarCol"]) nav[class*="panelList"],
html[${NAV_RAIL_ACTIVE_ATTR}="1"] :is(.dshDesktopSidebarSurface, [data-pane="sidebar"], [class*="sidebarCol"]) [class*="footArea"]:not(:has([role="dialog"][aria-modal="true"])) {
  display: none !important;
}

/* 确保产品舞台与工作区内容不受次级栏折叠缝隙影响 */
html[${NAV_RAIL_ACTIVE_ATTR}="1"] :is(.dshDesktopSidebarSurface, [data-pane="sidebar"], [class*="sidebarCol"]) [class*="scrollArea"] {
  grid-template-rows: max-content !important;
}

/* 非首页全屏业务页：隐藏顶栏会话栏折叠钮与新对话钮，主区占满 100vw - 52px */
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${NAV_RAIL_VIEW_ATTR}="business"] [data-omnimux-sidebar-toggle-topbar="1"],
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${NAV_RAIL_VIEW_ATTR}="business"] [data-omnimux-topbar-new-session="1"] {
  display: none !important;
  pointer-events: none !important;
}

/* 非首页业务页与折叠态下彻底归零次级会话栏，排除展开态窄屏抽屉 */
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${NAV_RAIL_VIEW_ATTR}="business"] [class*="frame"]:not([data-sidebar-drawer]) [class*="sidebarCol"],
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${NAV_RAIL_VIEW_ATTR}="business"] .dshDesktopFrame:not([data-sidebar-drawer]) .dshDesktopSidebarSurface,
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${LEFT_COLLAPSED_HTML_ATTR}] [class*="frame"]:not([data-sidebar-drawer]) [class*="sidebarCol"],
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${LEFT_COLLAPSED_HTML_ATTR}] .dshDesktopFrame:not([data-sidebar-drawer]) .dshDesktopSidebarSurface {
  width: 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  overflow: hidden !important;
  border: none !important;
  padding: 0 !important;
  display: none !important;
}
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${NAV_RAIL_VIEW_ATTR}="business"] [class*="frame"]:not([data-sidebar-drawer]),
html[${NAV_RAIL_ACTIVE_ATTR}="1"][${NAV_RAIL_VIEW_ATTR}="business"] .dshDesktopFrame:not([data-sidebar-drawer]) {
  grid-template-columns: 0px minmax(0px, 1fr) 0px !important;
}

/* 对话收起且次级会话栏收起时，右侧未标注模式的旧版面板扣除 52px 固定轨宽度 */
html[${NAV_RAIL_ACTIVE_ATTR}="1"][data-omnimux-conversation-collapsed][${LEFT_COLLAPSED_HTML_ATTR}] .dshDesktopRightbarSurface [class*="_panel"]:not([data-sidebar-right-panel]):not([class*="bottom"]):not([class*="Hidden"]),
html[${NAV_RAIL_ACTIVE_ATTR}="1"][data-omnimux-conversation-collapsed][${LEFT_COLLAPSED_HTML_ATTR}] [data-rightbar-col] > [class*="_panel"]:not([data-sidebar-right-panel]):not([class*="bottom"]):not([class*="Hidden"]),
html[${NAV_RAIL_ACTIVE_ATTR}="1"][data-omnimux-conversation-collapsed][${LEFT_COLLAPSED_HTML_ATTR}] [class*="rightbarCol"] > [class*="_panel"]:not([data-sidebar-right-panel]):not([class*="bottom"]):not([class*="Hidden"]),
html[${NAV_RAIL_ACTIVE_ATTR}="1"][data-omnimux-conversation-collapsed][${LEFT_COLLAPSED_HTML_ATTR}] [data-rightbar-col] [data-dsh-panel-host] > [class*="_panel"]:not([data-sidebar-right-panel]):not([class*="bottom"]):not([class*="Hidden"]),
html[${NAV_RAIL_ACTIVE_ATTR}="1"][data-omnimux-conversation-collapsed][${LEFT_COLLAPSED_HTML_ATTR}] [class*="rightbarCol"] [data-dsh-panel-host] > [class*="_panel"]:not([data-sidebar-right-panel]):not([class*="bottom"]):not([class*="Hidden"]) {
  width: calc(100vw - var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px)) !important;
}

/* 降级版「更多」弹出菜单（老宿主未挂载官方 sidebar.panellist.actions 时使用，实体不透明底） */
#${NAV_RAIL_MORE_FALLBACK_ID} {
  position: fixed;
  left: calc(var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px) + 8px);
  z-index: 1100;
  min-width: 224px;
  max-width: calc(100vw - var(${NAV_RAIL_WIDTH_VAR}, ${NAV_RAIL_WIDTH_PX}px) - 20px);
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 6px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

#${NAV_RAIL_MORE_FALLBACK_ID} .omnimux-nav-rail-more-item {
  appearance: none;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: inherit;
  min-height: 32px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}

#${NAV_RAIL_MORE_FALLBACK_ID} .omnimux-nav-rail-more-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

#${NAV_RAIL_MORE_FALLBACK_ID} .omnimux-nav-rail-more-item[aria-current="page"] {
  background: var(--dsw-alias-interactive-bg-active);
  font-weight: 500;
}

#${NAV_RAIL_MORE_FALLBACK_ID} .omnimux-nav-rail-more-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l2);
}

#${NAV_RAIL_MORE_FALLBACK_ID} .omnimux-nav-rail-more-alpha {
  margin-left: auto;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
`

function resolveDoc(doc) {
  return doc || hostDocument()
}

function readOfficialGlobalPanelId(doc) {
  try {
    const snap = getWorkbenchLayout()?.getSnapshot?.()
    if (typeof snap?.activePanel === 'string' && OFFICIAL_PANEL_IDS.includes(snap.activePanel)) {
      return snap.activePanel
    }
    if (typeof snap?.panelId === 'string' && OFFICIAL_PANEL_IDS.includes(snap.panelId)) {
      return snap.panelId
    }
    if (typeof snap?.mainPanel === 'string' && OFFICIAL_PANEL_IDS.includes(snap.mainPanel)) {
      return snap.mainPanel
    }
  } catch (error) {
    console.debug('[omnimux-nav-rail] read layout snapshot for activePanel failed', error)
  }
  try {
    const activePanelEl = doc?.querySelector?.('[data-global-panel]:not([hidden])')
    const attrPanel = activePanelEl?.getAttribute?.('data-global-panel')
    if (typeof attrPanel === 'string' && OFFICIAL_PANEL_IDS.includes(attrPanel)) {
      return attrPanel
    }
    const activeRow = doc?.querySelector?.(
      '[class*="panelList"] [class*="panelEntryActive"] [class*="panelRow"], [class*="panelList"] [class*="panelRow"][class*="panelActive"]',
    )
    if (activeRow) {
      const entryHost = activeRow.closest?.('[data-entry], [data-panel-id]')
      const entryId = entryHost?.getAttribute?.('data-entry') || entryHost?.getAttribute?.('data-panel-id')
      if (typeof entryId === 'string' && OFFICIAL_PANEL_IDS.includes(entryId)) {
        return entryId
      }
      const label = String(activeRow.getAttribute?.('aria-label') || activeRow.textContent || '').trim()
      if (/^(插件|Plugins)$/i.test(label)) return 'plugins'
      if (/^(自动化任务|自动化|Schedules|Automations)$/i.test(label)) return 'schedules'
    }
  } catch (error) {
    console.debug('[omnimux-nav-rail] read DOM official panel state failed', error)
  }
  return null
}

/**
 * 读取当前固定导航轨的单一状态裁决。
 * @param {Document} [doc]
 */
export function computeCurrentNavRailState(doc = resolveDoc()) {
  const productStageId = doc?.documentElement?.dataset?.dshProductStage || null
  const officialPanelId = readOfficialGlobalPanelId(doc)
  const { verdict, signals } = readFreshRailActivation(doc)
  return resolveFixedRailState({
    verdict,
    signals,
    officialPanelId,
    productStageId,
    exploreItems: resolveExploreMenuItems(),
  })
}

/**
 * 同步设置次级 Agent 会话栏的折叠态，不误翻用户原有状态。
 * @param {Document} doc
 * @param {boolean} collapsed
 * @returns {boolean}
 */
export function setSecondarySidebarCollapsed(doc, collapsed) {
  if (!doc?.documentElement) return false
  const targetCollapsed = Boolean(collapsed)
  setExplicitLeftCollapseIntent(targetCollapsed)
  const shellCollapsed = isLeftSidebarCollapsed(doc)
  const domCollapsed = doc.documentElement.hasAttribute(LEFT_COLLAPSED_HTML_ATTR)
  if (shellCollapsed !== targetCollapsed) {
    const marked = doc.querySelector(`[${SIDEBAR_ORIGINAL_TOGGLE_ATTR}="1"]`)
    const official = marked || findVisibleOfficialSidebarToggle(doc) || findOfficialSidebarToggle(doc)
    if (official) {
      triggerClick(official)
      syncLeftCollapsedHtmlAttr(doc)
      ensureSidebarToggleTopbar(doc, { allowBodyFallback: targetCollapsed })
      return true
    }
  }
  if (domCollapsed !== targetCollapsed) {
    syncLeftCollapsedHtmlAttr(doc)
    ensureSidebarToggleTopbar(doc, { allowBodyFallback: targetCollapsed })
    return true
  }
  return false
}

/**
 * 幂等切换回「首页 = Agent 会话工作区」（D6）：
 *   1. 若有官方全局面板 / 遗留产品舞台 / 全屏工作台，退出并回到对话主区；
 *   2. 强制确保次级会话栏处于展开状态（已在首页且展开时不折叠、不闪烁）。
 * @param {Document} [doc]
 * @returns {{ closedGlobalPanel: boolean, releasedStage: boolean, exitedFullscreen: boolean, expandedSidebar: boolean }}
 */
export function activateHomeView(doc = resolveDoc()) {
  if (!doc?.documentElement) {
    return { closedGlobalPanel: false, releasedStage: false, exitedFullscreen: false, expandedSidebar: false }
  }
  const win = doc.defaultView || hostWindow()
  let closedGlobalPanel = false
  try {
    const layout = getWorkbenchLayout()
    const officialPanel = readOfficialGlobalPanelId(doc)
    if (officialPanel && typeof layout?.selectPanel === 'function') {
      layout.selectPanel(null)
      closedGlobalPanel = true
    }
  } catch (error) {
    console.debug('[omnimux-nav-rail] selectPanel(null) on Home click failed', error)
  }

  let releasedStage = false
  try {
    releasedStage = Boolean(releaseCurrentProductStage())
  } catch (error) {
    console.debug('[omnimux-nav-rail] releaseCurrentProductStage on Home click failed', error)
  }

  const currentState = computeCurrentNavRailState(doc)
  let exitedFullscreen = false
  if (currentState.view === 'business') {
    try {
      exitedFullscreen = Boolean(exitHostRightSidebarFullscreen(doc))
    } catch (error) {
      console.debug('[omnimux-nav-rail] exitHostRightSidebarFullscreen on Home click failed', error)
    }
    try {
      setWorkbenchFocus('chat', undefined, {}, undefined, { persistUserIntent: false })
    } catch (error) {
      console.debug('[omnimux-nav-rail] setWorkbenchFocus(chat) on Home click failed', error)
    }
    try {
      ensureConversationVisible(doc, win?.__omnimuxWorkbench, { sessionId: currentSessionId() })
    } catch (error) {
      console.debug('[omnimux-nav-rail] ensureConversationVisible on Home click failed', error)
    }
  }

  const expandedSidebar = setSecondarySidebarCollapsed(doc, false)
  requestRailActivationSync()
  return { closedGlobalPanel, releasedStage, exitedFullscreen, expandedSidebar }
}

function findSettingsTrigger(doc) {
  const insideTrigger = doc.querySelector('[data-slot="settings.trigger"]')
  const btn = insideTrigger?.closest?.('button')
  if (btn && !btn.closest?.('[role="dialog"]')) return btn
  const launcherBtn = doc.querySelector('[data-slot="settings.launcher"] button')
  if (launcherBtn && !launcherBtn.closest?.('[role="dialog"]')) return launcherBtn
  const slotBtn = doc.querySelector('[data-slot="sidebar.settings"] button')
  if (slotBtn && !slotBtn.closest?.('[role="dialog"]')) return slotBtn
  return null
}

function findRemoteControlTrigger(doc) {
  return doc.querySelector(REMOTE_CONTROL_BUTTON_SELECTOR)
    || Array.from(doc.querySelectorAll?.('[data-slot="sidebar.footer.action"] button') || [])
      .find((btn) => /远程控制|Remote Control|Mobile connection|手机连接|Agents Anywhere/i.test(
        `${btn.getAttribute?.('aria-label') || ''} ${btn.textContent || ''}`,
      ))
    || null
}

function findOfficialMoreTrigger(doc) {
  const candidates = doc?.querySelectorAll?.('[class*="panelList"] [class*="moreAnchor"] button[aria-haspopup="menu"], [class*="moreAnchor"] button[aria-haspopup="menu"]') || []
  for (const el of candidates) {
    if (!el.closest?.(`#${NAV_RAIL_ID}`)) return el
  }
  return null
}

function selectDesktopUpdatesSettingsTab(doc) {
  const dialog = doc.querySelector('[data-shortcut-modal="settings"]')
  if (!dialog) return false
  const desktopBtn = Array.from(dialog.querySelectorAll('nav button'))
    .find((btn) => DESKTOP_SETTINGS_TAB_RE.test(String(btn.textContent || '').trim()))
  if (desktopBtn) {
    triggerClick(desktopBtn)
    return true
  }
  return false
}

function ensureNavRailStyles(doc) {
  if (!doc?.head) return null
  let style = doc.getElementById(NAV_RAIL_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = NAV_RAIL_STYLE_ID
    style.textContent = NAV_RAIL_CSS
    doc.head.append(style)
  } else if (style.textContent !== NAV_RAIL_CSS) {
    style.textContent = NAV_RAIL_CSS
  }
  return style
}

/**
 * 安装固定 52px 左侧导航轨并接管双栏状态联动。
 * @param {Document} [doc]
 * @returns {() => void} 卸载清理函数
 */
export function installNavRail(doc = resolveDoc()) {
  if (!doc?.documentElement || !doc?.body) return () => {}
  const root = doc.documentElement
  const win = doc.defaultView || hostWindow()

  ensureNavRailStyles(doc)

  let rail = doc.getElementById(NAV_RAIL_ID)
  if (!rail) {
    rail = doc.createElement('aside')
    rail.id = NAV_RAIL_ID
    rail.setAttribute('data-omnimux-nav-rail', '1')
    rail.setAttribute('aria-label', '主导航')

    const topGroup = doc.createElement('div')
    topGroup.className = 'omnimux-nav-rail-group'
    for (const item of NAV_RAIL_TOP_ITEMS) {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'omnimux-nav-rail-btn'
      btn.setAttribute('data-omnimux-rail-item', item.id)
      btn.setAttribute('data-tooltip', item.label)
      btn.setAttribute('aria-label', item.label)
      if (item.hasPopup) {
        btn.setAttribute('aria-haspopup', item.hasPopup)
        btn.setAttribute('aria-expanded', 'false')
      }
      btn.innerHTML = item.iconSvg
      topGroup.append(btn)
    }

    const bottomGroup = doc.createElement('div')
    bottomGroup.className = 'omnimux-nav-rail-bottom'
    const divider = doc.createElement('div')
    divider.className = 'omnimux-nav-rail-divider'
    divider.setAttribute('aria-hidden', 'true')
    bottomGroup.append(divider)

    for (const item of NAV_RAIL_BOTTOM_ITEMS) {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'omnimux-nav-rail-btn'
      btn.setAttribute('data-omnimux-rail-item', item.id)
      btn.setAttribute('data-tooltip', item.label)
      btn.setAttribute('aria-label', item.label)
      btn.innerHTML = item.id === 'updates'
        ? `${item.iconSvg}<span class="omnimux-nav-rail-dot" aria-hidden="true"></span>`
        : item.iconSvg
      bottomGroup.append(btn)
    }

    rail.append(topGroup, bottomGroup)
    doc.body.prepend(rail)
  }

  let tooltip = doc.querySelector('.omnimux-nav-rail-tooltip')
  if (!tooltip) {
    tooltip = doc.createElement('div')
    tooltip.className = 'omnimux-nav-rail-tooltip'
    tooltip.setAttribute('role', 'tooltip')
    tooltip.setAttribute('aria-hidden', 'true')
    tooltip.setAttribute('data-visible', 'false')
    doc.body.append(tooltip)
  }

  let fallbackMenu = null
  let fallbackMenuCleanup = null
  let updatesWaitCleanup = null
  let wasMoreMenuOpenOnPointerDown = false
  let prevView = null
  let prevSplit = false

  const closeFallbackMoreMenu = () => {
    fallbackMenuCleanup?.()
    fallbackMenuCleanup = null
    fallbackMenu?.remove()
    fallbackMenu = null
  }

  const openFallbackMoreMenu = (anchorBtn, activeMoreItemId) => {
    closeFallbackMoreMenu()
    const items = resolveExploreMenuItems()
    const menu = doc.createElement('div')
    menu.id = NAV_RAIL_MORE_FALLBACK_ID
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '更多工具')

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (i > 0 && items[i - 1]?.dividerAfter === true) {
        const sep = doc.createElement('div')
        sep.className = 'omnimux-nav-rail-more-sep'
        sep.setAttribute('role', 'separator')
        menu.append(sep)
      }
      const row = doc.createElement('button')
      row.type = 'button'
      row.className = 'omnimux-nav-rail-more-item'
      row.setAttribute('role', 'menuitem')
      if (activeMoreItemId && activeMoreItemId === item.id) {
        row.setAttribute('aria-current', 'page')
      }
      const iconWrap = doc.createElement('span')
      iconWrap.setAttribute('aria-hidden', 'true')
      iconWrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;'
      iconWrap.innerHTML = item.iconSvg || ''
      const labelSpan = doc.createElement('span')
      labelSpan.textContent = item.label
      row.append(iconWrap, labelSpan)

      const isAlpha = isAlphaEntry(item.entryId) || isAlphaEntry(item.pluginId) || isAlphaEntry(item.id)
      if (isAlpha) {
        const badge = doc.createElement('span')
        badge.className = 'omnimux-nav-rail-more-alpha'
        badge.title = ALPHA_DESCRIPTION
        badge.textContent = 'Alpha'
        row.append(badge)
      }

      row.addEventListener('click', () => {
        closeFallbackMoreMenu()
        syncAll()
        activateExploreItem(item)
      })
      menu.append(row)
    }

    doc.body.append(menu)
    fallbackMenu = menu

    const anchorTop = Math.round(anchorBtn.getBoundingClientRect().top || 200)
    const vh = win?.innerHeight || 800
    const menuHeight = Math.round(menu.getBoundingClientRect().height || items.length * 36)
    const clampedTop = Math.max(12, Math.min(anchorTop, Math.max(12, vh - 12 - menuHeight)))
    menu.style.top = `${clampedTop}px`

    const onPointerDownDoc = (event) => {
      const target = event.target
      if (target && (menu.contains(target) || anchorBtn.contains(target))) return
      closeFallbackMoreMenu()
      syncAll()
    }
    const onKeyDownDoc = (event) => {
      if (event.key === 'Escape') {
        closeFallbackMoreMenu()
        syncAll()
        anchorBtn.focus?.()
      }
    }
    doc.addEventListener('pointerdown', onPointerDownDoc, true)
    doc.addEventListener('keydown', onKeyDownDoc, true)
    fallbackMenuCleanup = () => {
      doc.removeEventListener('pointerdown', onPointerDownDoc, true)
      doc.removeEventListener('keydown', onKeyDownDoc, true)
    }
  }

  const showTooltipFor = (btn) => {
    const label = btn?.getAttribute?.('data-tooltip') || ''
    if (!label) return
    const rect = btn.getBoundingClientRect?.()
    tooltip.textContent = label
    tooltip.style.top = `${Math.round((rect?.top ?? 0) + ((rect?.height ?? 36) - 26) / 2)}px`
    tooltip.setAttribute('data-visible', 'true')
  }

  const hideTooltip = () => {
    tooltip.setAttribute('data-visible', 'false')
  }

  const syncOnboardingMode = () => {
    const onboarding = isOnboardingGuideActive(doc)
    if (onboarding) {
      root.removeAttribute(NAV_RAIL_ACTIVE_ATTR)
      root.removeAttribute(NAV_RAIL_VIEW_ATTR)
      root.style.setProperty(NAV_RAIL_WIDTH_VAR, '0px')
      rail.hidden = true
      closeFallbackMoreMenu()
      hideTooltip()
      return true
    }
    rail.hidden = false
    root.setAttribute(NAV_RAIL_ACTIVE_ATTR, '1')
    root.style.setProperty(NAV_RAIL_WIDTH_VAR, `${NAV_RAIL_WIDTH_PX}px`)
    return false
  }

  const syncAll = () => {
    if (syncOnboardingMode()) return
    const state = computeCurrentNavRailState(doc)
    if (root.getAttribute(NAV_RAIL_VIEW_ATTR) !== state.view) {
      root.setAttribute(NAV_RAIL_VIEW_ATTR, state.view)
    }

    // 边缘触发次级会话栏自动收起，绝不在同态下覆盖用户手动折叠/展开操作
    if (prevView !== state.view) {
      const leavingHome = prevView === 'home' || prevView === null
      if (state.view === 'business' && leavingHome) {
        setSecondarySidebarCollapsed(doc, true)
      } else if (state.view === 'home' && prevView === 'business') {
        ensureSidebarToggleTopbar(doc, { allowBodyFallback: isLeftSidebarCollapsed(doc) })
      }
      prevView = state.view
    }
    if (state.view === 'home' && !prevSplit && state.isSplit) {
      setSecondarySidebarCollapsed(doc, true)
    }
    prevSplit = state.isSplit

    for (const item of NAV_RAIL_TOP_ITEMS) {
      const btn = rail.querySelector(`[data-omnimux-rail-item="${item.id}"]`)
      if (!btn) continue
      const isActive = state.railId === item.id
      btn.setAttribute('data-active', isActive ? 'true' : 'false')
      if (item.id === 'more') {
        const officialMore = findOfficialMoreTrigger(doc)
        const expanded = Boolean(
          fallbackMenu
          || officialMore?.getAttribute?.('aria-expanded') === 'true'
          || doc.querySelector(MORE_MENU_SELECTOR),
        )
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
      }
    }

    const updateBtn = rail.querySelector('[data-omnimux-rail-item="updates"]')
    if (updateBtn) {
      const hasUpdate = Boolean(doc.querySelector(UPDATE_PILL_SELECTOR))
      updateBtn.setAttribute('data-has-update', hasUpdate ? 'true' : 'false')
    }

    const remoteBtn = rail.querySelector('[data-omnimux-rail-item="remote-control"]')
    if (remoteBtn) {
      const officialRemote = findRemoteControlTrigger(doc)
      const expanded = officialRemote?.getAttribute?.('aria-expanded') === 'true'
      remoteBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    }

    // 保底让 coordinator 撤掉未移除的次级栏并排或一级行
    try {
      win?.__omnimuxSidebar?.place?.()
    } catch (error) {
      console.debug('[omnimux-nav-rail] coordinator place during sync failed', error)
    }
  }

  const handleMoreClick = (btn) => {
    if (wasMoreMenuOpenOnPointerDown) {
      wasMoreMenuOpenOnPointerDown = false
      closeFallbackMoreMenu()
      syncAll()
      return
    }
    const officialMore = findOfficialMoreTrigger(doc)
    if (officialMore) {
      const isOpen = officialMore.getAttribute('aria-expanded') === 'true' || Boolean(doc.querySelector(MORE_MENU_SELECTOR))
      if (!isOpen) {
        triggerClick(officialMore)
      }
      syncAll()
      return
    }
    if (fallbackMenu) {
      closeFallbackMoreMenu()
    } else {
      const state = computeCurrentNavRailState(doc)
      openFallbackMoreMenu(btn, state.railId === 'more' ? state.activeMoreItemId : null)
    }
    syncAll()
  }

  const handleUpdatesClick = () => {
    const pill = doc.querySelector(UPDATE_PILL_SELECTOR)
    if (pill) {
      triggerClick(pill)
      return
    }
    if (selectDesktopUpdatesSettingsTab(doc)) return
    const trigger = findSettingsTrigger(doc)
    if (!trigger) return
    updatesWaitCleanup?.()
    const Observer = win?.MutationObserver || globalThis.MutationObserver
    if (typeof Observer === 'function') {
      let done = false
      let timer = null
      const observer = new Observer(() => {
        if (done) return
        if (selectDesktopUpdatesSettingsTab(doc)) {
          finishWait()
        }
      })
      const finishWait = () => {
        if (done) return
        done = true
        observer.disconnect()
        if (timer !== null) clearTimeout(timer)
        if (updatesWaitCleanup === finishWait) updatesWaitCleanup = null
      }
      updatesWaitCleanup = finishWait
      observer.observe(doc.body, { childList: true, subtree: true })
      timer = setTimeout(finishWait, 4000)
    }
    triggerClick(trigger)
  }

  const handleRemoteControlClick = () => {
    const remoteBtn = findRemoteControlTrigger(doc)
    if (remoteBtn) {
      triggerClick(remoteBtn)
      syncAll()
      return
    }
    const settingsBtn = findSettingsTrigger(doc)
    if (settingsBtn) triggerClick(settingsBtn)
  }

  const handleSettingsClick = () => {
    const settingsBtn = findSettingsTrigger(doc)
    if (settingsBtn) triggerClick(settingsBtn)
  }

  const onPointerDownMore = () => {
    const officialMore = findOfficialMoreTrigger(doc)
    wasMoreMenuOpenOnPointerDown = Boolean(
      fallbackMenu
      || doc.querySelector(MORE_MENU_SELECTOR)
      || officialMore?.getAttribute?.('aria-expanded') === 'true',
    )
  }

  const moreRailBtn = rail.querySelector('[data-omnimux-rail-item="more"]')
  moreRailBtn?.addEventListener('pointerdown', onPointerDownMore)

  const onRailClick = (event) => {
    const target = event.target
    const btn = target?.closest?.('[data-omnimux-rail-item]')
    if (!btn || !rail.contains(btn)) return
    hideTooltip()
    const id = btn.getAttribute('data-omnimux-rail-item')
    if (id === 'home') {
      closeFallbackMoreMenu()
      activateHomeView(doc)
      syncAll()
      return
    }
    const pinnedItem = NAV_RAIL_TOP_ITEMS.find((entry) => entry.id === id && entry.tabId)
    if (pinnedItem) {
      closeFallbackMoreMenu()
      activatePinnedEntry(pinnedItem.entryId, pinnedItem.tabId, pinnedItem.label)
      requestRailActivationSync()
      syncAll()
      return
    }
    if (id === 'more') {
      handleMoreClick(btn)
      return
    }
    if (id === 'updates') {
      closeFallbackMoreMenu()
      handleUpdatesClick()
      return
    }
    if (id === 'remote-control') {
      closeFallbackMoreMenu()
      handleRemoteControlClick()
      return
    }
    if (id === 'settings') {
      closeFallbackMoreMenu()
      handleSettingsClick()
    }
  }

  const onPointerOver = (event) => {
    const btn = event.target?.closest?.('[data-omnimux-rail-item]')
    if (btn && rail.contains(btn)) showTooltipFor(btn)
  }
  const onPointerOut = (event) => {
    const related = event.relatedTarget
    if (related && related.closest?.('[data-omnimux-rail-item]') && rail.contains(related)) return
    hideTooltip()
  }
  const onFocusIn = (event) => {
    const btn = event.target?.closest?.('[data-omnimux-rail-item]')
    if (btn && rail.contains(btn) && btn.matches?.(':focus-visible')) showTooltipFor(btn)
  }
  const onFocusOut = () => {
    hideTooltip()
  }

  rail.addEventListener('click', onRailClick)
  rail.addEventListener('pointerover', onPointerOver)
  rail.addEventListener('pointerout', onPointerOut)
  rail.addEventListener('focusin', onFocusIn)
  rail.addEventListener('focusout', onFocusOut)

  const unsubWorkbench = subscribeWorkbench(() => syncAll())
  const onStageEvent = () => syncAll()
  win?.addEventListener?.('dsh-product-stage', onStageEvent)

  const Observer = win?.MutationObserver || globalThis.MutationObserver
  const observers = []
  let observedFooter = null
  let observedPanelList = null

  const bindFooterObserver = () => {
    if (typeof Observer !== 'function') return
    const footerSlot = doc.querySelector('[data-slot="sidebar.footer.action"]')
    if (!footerSlot || footerSlot === observedFooter) return
    observedFooter = footerSlot
    const footerObserver = new Observer(() => syncAll())
    footerObserver.observe(footerSlot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'data-next-update-pill'],
    })
    observers.push(footerObserver)
  }

  const bindPanelListObserver = () => {
    if (typeof Observer !== 'function') return
    const panelList = doc.querySelector('nav[class*="panelList"]')
    if (!panelList || panelList === observedPanelList) return
    observedPanelList = panelList
    const panelListObserver = new Observer(() => syncAll())
    panelListObserver.observe(panelList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-expanded', 'aria-current'],
    })
    observers.push(panelListObserver)
  }

  if (typeof Observer === 'function') {
    const rootObserver = new Observer(() => {
      bindFooterObserver()
      bindPanelListObserver()
      syncAll()
    })
    rootObserver.observe(root, {
      attributes: true,
      attributeFilter: [
        'data-dsh-product-stage',
        LEFT_COLLAPSED_HTML_ATTR,
        'data-omnimux-conversation-collapsed',
        'data-platform',
        'data-fullscreen',
      ],
    })
    observers.push(rootObserver)

    const rootContainer = doc.getElementById('root')
    if (rootContainer) {
      const containerObserver = new Observer(() => {
        bindFooterObserver()
        bindPanelListObserver()
        syncAll()
      })
      containerObserver.observe(rootContainer, {
        attributes: true,
        subtree: true,
        attributeFilter: [
          'data-global-panel',
          'inert',
          'data-sidebar-right-panel',
          'data-sidebar-right-open',
          'data-sidebar-right-mode',
          'data-rightbar-fullscreen',
          'data-rightbar-collapsed',
        ],
      })
      observers.push(containerObserver)
    }

    bindFooterObserver()
    bindPanelListObserver()
  }

  syncAll()

  return () => {
    moreRailBtn?.removeEventListener('pointerdown', onPointerDownMore)
    rail.removeEventListener('click', onRailClick)
    rail.removeEventListener('pointerover', onPointerOver)
    rail.removeEventListener('pointerout', onPointerOut)
    rail.removeEventListener('focusin', onFocusIn)
    rail.removeEventListener('focusout', onFocusOut)
    win?.removeEventListener?.('dsh-product-stage', onStageEvent)
    unsubWorkbench?.()
    closeFallbackMoreMenu()
    updatesWaitCleanup?.()
    for (const observer of observers) observer.disconnect()
    rail.remove()
    tooltip.remove()
    doc.getElementById(NAV_RAIL_STYLE_ID)?.remove()
    root.removeAttribute(NAV_RAIL_ACTIVE_ATTR)
    root.removeAttribute(NAV_RAIL_VIEW_ATTR)
    root.style.removeProperty(NAV_RAIL_WIDTH_VAR)
    try {
      win?.__omnimuxSidebar?.place?.()
    } catch (error) {
      console.debug('[omnimux-nav-rail] coordinator place on nav-rail uninstall failed', error)
    }
  }
}
