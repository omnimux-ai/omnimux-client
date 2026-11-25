# 左侧栏 0.2.2-rc.5 结构对齐与行度量修复

## 背景与现象

宿主 `@deepseek-ai/dsh-client-ui-sidebar` 升级至 `0.2.2-rc.5` 后，展开态左侧边栏出现三处布局与对齐异常：

1. **「新对话」与「项目」紧贴（0px）**：`SidebarRoot.tsx` 将「新对话」包进 `.newSessionRow`（`margin: 0 4px`，无下边距），原 12px 顶距迁至 `.scrollRegion`（`margin-top: 4px`）与 `.scrollArea` 首行网格占位（`8px`）。`sidebar-coordinator.js` 的 `placeBelow()` 仍把自定义行插在 `.root` 下 `.newSessionRow` 之后，因 `.root` 无 `gap` 且 `.omnimux-sidebar-nav-entry` 为 `margin: 0 4px`，导致顶距为 0px。
2. **「更多」按钮左右多缩进 3px**：新版 `SidebarRoot.module.css` 为 `.panelRow` 增加 `border-inline: 3px solid transparent`（`--dsh-sidebar-paint-inset: 3px`）+ `background-clip: padding-box`。`sidebar-panel-chrome.js` 的 `PANEL_CHROME_CSS` 覆盖了 `margin: 0 4px`，但未清零 `border-inline`，叠加成 7px 内缩（背景框左右各窄 3px，图标右偏 3px）。
3. **「灵感社区」与「更多」之间约 16px 断层**：自定义行位于 `.scrollRegion` 之外，「更多」位于 `.scrollRegion > .scrollArea > nav.panelList` 内，中间夹入 `.scrollRegion`（4px）+ `.scrollArea` 首行占位（8px）；且官方面板行新增外层 `<div class="panelEntry">` 包裹，`sidebar-panel-chrome.js` 仅隐藏内层 `.panelRow`，空 `.panelEntry` 在 `gap: 2px` 的 `.panelList` 中再占约 4px。

## 方案取舍（采用方案 A）

- **方案 A（采用，结构对齐）**：
  1. `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`：`placeBelow(root)` 优先查找 `nav[class*="panelList"]`，存在时将自定义常驻行按 `rank` 升序挂在 `panelList` 头部（所有 `.panelEntry` 与 `.moreAnchor` 之前）；缺失 `panelList`（旧宿主或最小夹具）时保持既有回退逻辑（插在 `newSession` 所属直接子之后）。
  2. `plugins/plugins/omnimux/src/client/sidebar-panel-chrome.js`：在展开态 `.panelRow` 度量覆盖中补 `border-inline: 0`，并将官方面板行隐藏规则扩展为同时隐藏外层 `[class*="panelEntry"]:has([class*="panelRow"]:not([aria-haspopup="menu"]))` 与内层 `[class*="panelRow"]:not([aria-haspopup="menu"])`。
- **放弃方案 B（CSS 修补）理由**：保留自定义行在 `.scrollRegion` 之外需要跨模块覆写宿主 `.scrollRegion` / `.scrollArea` 顶部网格占位，既破坏 `scroll-handoff.ts` 将导航区与「更多」整体滚出的设计，也会在收起态/Windows 标题栏态与 `.panelList` 脱节。

## 假设

当自定义常驻行迁入 `nav[class*="panelList"]` 头部、`PANEL_CHROME_CSS` 对展开态 `.panelRow` 清零 `border-inline: 0` 并同步隐藏含非「更多」面板行的外层 `.panelEntry` 后：
- 展开态「新对话」底边到首条自定义行「项目」顶边的间距严格复用宿主 `.scrollRegion`（4px）+ `.scrollArea::before`（8px）= 12px；
- 自定义行之间及「灵感社区」与「更多」之间均复用 `.panelList` 的 `gap: 2px`，不再出现 16px 断层；
- 「更多」按钮绘制框（padding box）与「新对话」及自定义行完全左右齐边，图标起始 X 坐标一致（误差 ≤ 0.5px）；
- 收起态轨道、旧宿主/无 `panelList` 夹具、「更多」菜单打开态定位与实底以及 React 对 `panelList` 的增量重渲染均保持幂等无回归。

## 证伪方式

在真实 Chromium（加载 `0.2.2-rc.5` `SidebarRoot.module.css` 等价样式与真实生产 `sidebar-coordinator.js`、`sidebar-panel-chrome.js`、`.omnimux-sidebar-nav-entry` 样式，且不注入掩盖盒模型的全局 reset）中测量以下指标，任一项违背即推翻假设：
1. `firstCustomRow.top - newSessionRow.bottom !== 12`（回退修复后测得 0px）；
2. `Math.abs(moreRowPaintRect.left - firstCustomRow.left) > 0.5` 或 `Math.abs(moreRowPaintRect.right - firstCustomRow.right) > 0.5` 或 `Math.abs(moreGlyph.left - firstCustomIcon.left) > 0.5`（回退修复后测得左偏 +3px、宽差 -6px）；
3. `moreRow.top - lastCustomRow.bottom !== 2`（回退修复后测得约 16px）；
4. 任一非「更多」`.panelEntry` 的计算样式 `display !== 'none'` 或占据布局高度/间隙；
5. 连续多次 `api.place()` 或 React 模拟增删 `panelEntry` 后出现顺序漂移、重复移动或抛错。

验证命令：
- `node --test plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js plugins/plugins/omnimux/src/client/sidebar-panel-chrome.test.js`
- `node --test plugins/plugins/omnimux/src/client/sidebar-rc5-layout.e2e.test.js`
- `corepack pnpm --dir plugins --filter omnimux test`

## 验收标准

- **AC-1 顶部间距**：展开态「新对话」（`.newSessionRow`）底边到「项目」顶边间距为 `12px`。
- **AC-2 水平齐边与图标对齐**：「更多」按钮实际绘制区（扣除外框透明边框）与「新对话」及自定义行左右边界对齐（误差 ≤ 0.5px），图标左边界与自定义行图标左边界对齐（误差 ≤ 0.5px），高度/圆角/字阶一致。
- **AC-3 连续行距与零断层**：自定义常驻行之间、`灵感社区` 与 `更多` 之间垂直间距均为 `2px`；非「更多」的官方面板 `.panelEntry` 外层包裹节点与内层 `.panelRow` 均 `display: none`，不再留空隙或暴露 `panelUnpin` 按钮。
- **AC-4 亮/暗双主题与浮层**：「更多」菜单打开态保持右侧实底弹出且顶边对齐触发行；亮/暗主题与窄屏（drawer）下布局对齐一致。
- **AC-5 滚动与收起态**：侧栏滚动区高度不足时自定义行随 `.panelList` 与「更多」一起滚出；收起态下官方面板 `.panelEntry` 仍隐藏、展开态度量规则不污染收起态轨道。
- **AC-6 兼容与幂等**：无 `nav[class*="panelList"]` 的旧宿主/夹具回退到 `newSession` 之后挂载；连续调用 `place()` 与 `panelEntry` 增删均幂等无异常。
