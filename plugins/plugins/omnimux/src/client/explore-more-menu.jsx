/**
 * 官方「更多」菜单注册点（seat `sidebar.panellist.actions`）。
 *
 * 宿主 `0.2.1-rc.3` 起，官方左侧栏的 panel list 自带「更多」行：root 作用域的
 * list seat `sidebar.panellist.actions` 只要有注册就渲染该行，注册项**直接渲染成
 * 菜单行**（官方参考实现 `packages/client/ui-entry-customization/src/client/EntryMenuContent.tsx`）。
 * 本模块把 OmniMux 的探索入口注册进那个官方菜单：自绘「探索」常驻行与浮动菜单已在
 * #3785 退役，这里是这批入口在侧栏的唯一渲染面，并支持悬停/常显图钉将入口固定到固定左侧栏。
 *
 * 单一真源：清单 / 图标 / 分组 / 激活语义全部取自 `sidebar-coordinator.js`，
 * 固定持久化与图钉 SVG 取自 `nav-rail-pins.js`，本模块不复制第二份实现
 * （契约 docs/contracts/sidebar-extra-entries.md）。
 *
 * 依赖注入：官方 `MenuItemButton` 与可选 `IconPinOutlineRegular` / `IconPinFillRegular`
 * 由调用方（`index.js` 的 `apply()`）传入。
 * 本模块**不得**顶层 import `@deepseek-ai/dsh-client-ui-primitives`：该包在宿主里是
 * 外部依赖，测试与老宿主解析不到，顶层 import 会把整个模块变成不可加载。
 */
import { useSyncExternalStore } from 'react'
import { ALPHA_DESCRIPTION, activateExploreItem, isAlphaEntry, resolveExploreMenuItems } from './sidebar-coordinator.js'
import {
  OFFICIAL_PANEL_ICON_SVG,
  PIN_FILL_ICON_SVG,
  PIN_OUTLINE_ICON_SVG,
  getPinnedMoreSnapshot,
  panelPinId,
  rememberOfficialPanelMeta,
  subscribePinnedMoreItems,
  togglePinnedMoreItem,
} from './nav-rail-pins.js'
import { getRailSignals, getRailVerdict, resolveFixedRailState } from './workbench/sidebar-activation.js'

/** 官方「更多」菜单的 seat 名（root 作用域 list）。 */
export const EXPLORE_MORE_MENU_SLOT = 'sidebar.panellist.actions'
/** 本仓在该 seat 上的唯一注册 id；其它插件不得再注册同一批入口。 */
export const EXPLORE_MORE_MENU_ID = 'omnimux-explore'
/** 列表按 order 升序渲染；100 与其它 OmniMux 注册点同档，官方自带行排在其后。 */
export const EXPLORE_MORE_MENU_ORDER = 100

/**
 * 行原语是否可渲染：官方 `MenuItemButton` 现在是函数组件，将来被 `memo` /
 * `forwardRef` 包一层也应照常接受（这类对象带 `$$typeof`）。
 * @param {unknown} value
 * @returns {boolean}
 */
function isRenderableComponent(value) {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol'
}

/**
 * 菜单行图标：沿用清单里的既有 `iconSvg`。
 * 与真源清单同一信任边界（契约要求 14×14 纯矢量 HTML，无 Emoji）；
 * 行文案（`label`）一律按纯文本交给 React，绝不拼进 HTML。
 * @param {{ iconSvg: string }} item
 * @returns {import('react').ReactElement}
 */
function exploreMoreMenuIcon(item) {
  return (
    <span
      className="omnimux-explore-more-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: item.iconSvg }}
    />
  )
}

/**
 * 允许进「更多」菜单的官方面板行 id（白名单）。
 *
 * 放行官方「插件」和「自动化任务」：「插件」是 DSH 官方面板的开关与配置入口，
 * 产品自研的应用商店只负责安装/更新，不替代官方插件管理。用白名单而非黑名单，
 * 是为了让官方将来新增的面板不会未经决策就自动出现在菜单里。
 */
const PANEL_ENTRY_WHITELIST = new Set(['plugins', 'schedules'])

/**
 * 官方面板行的图标容器：与清单行同一 class 与同一信任边界（受信 14×14 纯矢量）。
 * @returns {import('react').ReactElement}
 */
function panelRowIcon() {
  return (
    <span
      className="omnimux-explore-more-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: OFFICIAL_PANEL_ICON_SVG }}
    />
  )
}

/**
 * 行内容：Alpha 内测项在文案后带一个标识，其余项保持纯字符串（零变化）。
 *
 * 判定复用 `sidebar-coordinator.isAlphaEntry()`（覆盖 `plugin-lifecycle.json`
 * 与仓外内测入口补集），本模块不维护第二份 Alpha 名单。标识放在官方 `children` 里：
 * `MenuItemButton` 没有第二个尾部插槽，`children` 渲染进 `.itemLabel` 是唯一可行位置。
 *
 * @param {{ id?: string, label: string, entryId?: string, pluginId?: string }} item
 * @returns {string | import('react').ReactElement}
 */
function exploreMoreMenuLabel(item) {
  const isAlpha = isAlphaEntry(item.entryId) || isAlphaEntry(item.pluginId) || isAlphaEntry(item.id)
  if (!isAlpha) return item.label
  return (
    <span className="omnimux-explore-more-label">
      <span className="omnimux-explore-more-label-text">{item.label}</span>
      <span className="omnimux-explore-more-alpha" title={ALPHA_DESCRIPTION}>{'Alpha'}</span>
    </span>
  )
}

function renderPinGlyph(pinned, FillIcon, OutlineIcon) {
  if (pinned) {
    if (FillIcon) return <FillIcon size={14} aria-hidden="true" />
    return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: PIN_FILL_ICON_SVG }} />
  }
  if (OutlineIcon) return <OutlineIcon size={14} aria-hidden="true" />
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: PIN_OUTLINE_ICON_SVG }} />
}

/**
 * 生成「更多」菜单内容组件：顺序 / 分组 / 激活委托全部取自 sidebar-coordinator 真源。
 *
 * - 分组：`separatorBefore` 取「上一项的 `dividerAfter`」；
 * - 点击：先 `onDismiss()` 关掉官方菜单，再走 `activateExploreItem` 既有三段委托
 *   （`action` → 已挂载行 click → `__omnimuxWorkbench.open`），不另写导航；
 * - 固定：每行右侧提供悬停空心 / 已固定常显实心图钉，点击阻止冒泡并保持菜单打开；
 * - 不订阅注册变更：官方菜单每次展开重新挂载即读取最新集合。
 *
 * @param {{
 *   MenuItemButton?: import('react').ComponentType<object>,
 *   IconPinOutlineRegular?: import('react').ComponentType<object>,
 *   IconPinFillRegular?: import('react').ComponentType<object>,
 * }} [primitives]
 *   官方 primitives 命名空间（只需 `MenuItemButton`，图钉图标可选）。
 * @returns {import('react').FunctionComponent<{
 *   onDismiss?: () => void,
 *   entries?: readonly { id: string, label: string, active?: boolean }[],
 *   onOpen?: (id: string) => void,
 * }>}
 */
function readActiveMoreItemId(items, pinnedMoreIds) {
  if (typeof document === 'undefined') return null
  const productStageId = document.documentElement?.dataset?.dshProductStage || null
  const verdict = getRailVerdict(document)
  const signals = getRailSignals(document)
  const railState = resolveFixedRailState({
    verdict,
    signals,
    productStageId,
    exploreItems: items,
    pinnedMoreIds,
  })
  return railState.railId === 'more' || railState.railId === 'pinned' ? railState.activeMoreItemId : null
}

export function createExploreMoreMenuContent({ MenuItemButton, IconPinOutlineRegular, IconPinFillRegular } = {}) {
  const OutlinePinIcon = isRenderableComponent(IconPinOutlineRegular) ? IconPinOutlineRegular : null
  const FillPinIcon = isRenderableComponent(IconPinFillRegular) ? IconPinFillRegular : null

  /**
   * 官方「更多」菜单内容：owner 提供 `onDismiss` 与折叠的官方面板清单，
   * 其余输入全部来自真源清单。
   */
  function ExploreMoreMenuContent({ onDismiss, entries, onOpen }) {
    const items = resolveExploreMenuItems()
    const pinnedIds = useSyncExternalStore(
      subscribePinnedMoreItems,
      getPinnedMoreSnapshot,
      getPinnedMoreSnapshot,
    )
    const pinnedSet = new Set(pinnedIds)
    const activeMoreId = readActiveMoreItemId(items, pinnedIds)
    // 白名单：官方「插件」和「自动化任务」进「更多」菜单；官方「插件」承载 bundle
    // 开关和配置页，其余官方新增面板不自动冒出来。
    const panels = Array.isArray(entries)
      ? entries.filter((entry) => PANEL_ENTRY_WHITELIST.has(entry?.id))
      : []
    for (const entry of panels) {
      rememberOfficialPanelMeta(entry)
    }

    const renderPinAction = (pinId, label) => {
      const pinned = pinnedSet.has(pinId)
      const actionLabel = pinned ? `取消固定${label}` : `固定${label}到左侧边栏`
      return (
        <span className="omnimux-explore-more-pin-anchor">
          <button /* exempt-ui01: 宿主原生 Menu 插槽内嵌 22px 图标按钮，禁止顶层耦合 dsh-ui-kit */
            type="button"
            className="omnimux-explore-more-pin-btn"
            data-omnimux-pin-toggle={pinId}
            aria-label={actionLabel}
            aria-pressed={pinned ? 'true' : 'false'}
            title={pinned ? '取消固定' : '固定到左侧边栏'}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              togglePinnedMoreItem(pinId)
            }}
          >
            {renderPinGlyph(pinned, FillPinIcon, OutlinePinIcon)}
          </button>
        </span>
      )
    }

    return (
      <>
        {panels.map((entry) => {
          const pinId = panelPinId(entry.id)
          const pinned = pinnedSet.has(pinId)
          return (
            <div
              key={`panel:${entry.id}`}
              className="omnimux-explore-more-row"
              data-omnimux-more-item={pinId}
              data-pinned={pinned ? 'true' : 'false'}
            >
              <MenuItemButton
                icon={panelRowIcon()}
                current={entry.active === true}
                separatorBefore={false}
                onSelect={() => {
                  onDismiss?.()
                  onOpen?.(entry.id)
                }}
              >
                {entry.label}
              </MenuItemButton>
              {renderPinAction(pinId, entry.label)}
            </div>
          )
        })}
        {items.map((item, index) => {
          const pinned = pinnedSet.has(item.id)
          return (
            <div
              key={item.id}
              className="omnimux-explore-more-row"
              data-omnimux-more-item={item.id}
              data-pinned={pinned ? 'true' : 'false'}
            >
              <MenuItemButton
                icon={exploreMoreMenuIcon(item)}
                current={activeMoreId !== null && activeMoreId === item.id}
                separatorBefore={
                  (index > 0 && items[index - 1].dividerAfter === true)
                  // 折叠块之后断开：官方面板入口与产品入口不是同一组。
                  || (index === 0 && panels.length > 0)
                }
                onSelect={() => {
                  onDismiss?.()
                  activateExploreItem(item)
                }}
              >
                {exploreMoreMenuLabel(item)}
              </MenuItemButton>
              {renderPinAction(item.id, item.label)}
            </div>
          )
        })}
      </>
    )
  }
  return ExploreMoreMenuContent
}

/**
 * 把「更多」菜单注册进官方侧栏。
 *
 * 老宿主没有 `slots` 服务时直接 no-op；seat 本身不存在的情况交给
 * `ctx.slots.inject` 的惰性语义（回调不触发），因此这里不需要 `try/catch` 兜底。
 * 宿主没有可渲染的行原语时同样不注册：宁可没有菜单，也不注册一个渲染即崩、
 * 或渲染出空壳的占用项。
 *
 * @param {{ slots?: { inject?: Function, register?: Function } }} [ctx] cordis 插件上下文
 * @param {{ MenuItemButton?: unknown, IconPinOutlineRegular?: unknown, IconPinFillRegular?: unknown }} [primitives]
 *   官方 `@deepseek-ai/dsh-client-ui-primitives` 命名空间。
 * @returns {boolean} 是否完成注册
 */
export function installExploreMoreMenu(ctx, primitives) {
  if (typeof ctx?.slots?.inject !== 'function') return false
  const { MenuItemButton, IconPinOutlineRegular, IconPinFillRegular } = primitives ?? {}
  if (!isRenderableComponent(MenuItemButton)) return false
  const Content = createExploreMoreMenuContent({
    MenuItemButton,
    IconPinOutlineRegular,
    IconPinFillRegular,
  })
  ctx.slots.inject(EXPLORE_MORE_MENU_SLOT, () => ctx.slots.register({
    name: EXPLORE_MORE_MENU_SLOT,
    id: EXPLORE_MORE_MENU_ID,
    order: EXPLORE_MORE_MENU_ORDER,
  }, Content))
  return true
}
