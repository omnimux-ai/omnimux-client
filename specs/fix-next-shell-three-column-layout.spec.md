# 修复 dsh-desktop-next 三栏分屏黑洞、手柄脱节与双壳选择器漂移

## 背景

`dsh-desktop-next` 升级至 `DSH 0.2.2-rc.5`（commit `57c3b9bd`）并在 PR #232（`d4208f86`）切为默认 Dev 外壳后，三栏工作台在 `1728px` 等常见屏幕宽度下于中栏会话列与右栏创作面板之间出现约 `236px` 的黑色死区，同时右侧分隔线拖拽手柄与视觉边界偏离、拖拽追踪与松手落盘失效。

根因由四条断裂共同造成：

1. `conversation-box.js` 通过 `[class*="frame"]` 命中 Next 壳 `AppFrame`（`._1qAH1q_frame`），把三栏栅格写为 `280px 434px minmax(0px, 1fr)`（第三轨 `1014px`）；但 `conversation-collapse.js` 的右栏内部面板铺满规则只写了 `.dshDesktopRightbarSurface [class*="_panel"]`，未命中 Next 壳 `[data-rightbar-col]` / `[class*="rightbarCol"]`，使右锚定的 `SidebarPanel` 维持默认 `45%` 宽（`778px`），左侧裸露 `236px` 黑色背景。
2. Next 壳运行时 `@deepseek-ai/dsh-client-ui-layout@0.2.2-rc.5` 的 `LayoutController` 缺少 `getSnapshot()` 与 `setRightbar(px)`，导致 `reconcileRightbarFromRatio` 与 `ensureHealthySplitWidth` 跳过外壳同步，外壳 `layoutInfo.rightbar` 停在 `45%`，拖拽手柄停在 `x=950` 而非视觉边界 `x=714`。
3. `readShellSplitPx` 仅解析旧壳裸像素尾轨 `778px`，遇到 Next 壳 `grid-template-columns: 280px minmax(400px, 1fr) minmax(0px, 778px)` 恒返回 `right: null`，阻断拖拽帧追踪与比例落盘。
4. Next 壳 `openRightbar()` 首次打开会把 `layoutInfo.rightbar` 种子化为 `45%`；若 `getSnapshot()` 不区分默认种子与显式写入，`hasUserAuthoredPanelWidth` 会将新用户的 `45%` 种子误判为老用户自定义版式并落盘为 `46.3%` 中栏比例，破坏默认 `30%` 比例。

## 变更范围

### 1. 桌面运行时最小契约补丁（`DP-007`）

- 新增 `app/patches/dsh-client-ui-layout@0.2.2-rc.5.patch` 并在 `app/package.json`、`app/yarn.lock` 与 `docs/desktop-patches.md` 登记为 `DP-007`。
- 保持上游 `CENTER_MIN = 400`、`RIGHTBAR_MAX_RATIO = 0.7` 与 `computeColumns` 语义不变。
- 在 `createLayoutStore()` 新增 `rightbarAuthored` 标记（初始化与 `openRightbar` 默认种子为 `false`，仅 `setRightbar` 置 `true`）；在 `LayoutController` 暴露 `getSnapshot()`（返回浅拷贝）与 `setRightbar(px)`，同步更新 `lib/types/client/service.d.ts`。
- 新增 `app/dsh-desktop-next/tests/ui-layout-contract.spec.ts` 验证真实运行态包契约。

### 2. 插件侧双壳全量适配（`plugins/plugins/omnimux`）

- `conversation-collapse.js`：补齐 `[data-rightbar-col]` / `[class*="rightbarCol"]` 右栏铺满兜底（严格限定 `:not([data-rightbar-collapsed="true"])` 与 `[data-sidebar-right-panel="push"][data-sidebar-right-open]`，避免压扁关闭动画或窄屏 overlay），并补齐 `[class*="frame"]` / `[class*="centerCol"]` 在中栏收起与图像画布全屏投射规则中的孪生选择器。
- `conversation-box.js`：补齐 `[class*="centerCol"]` 在产品舞台隐藏与分屏防溢出规则中的孪生，以及 `html[data-platform="darwin"]` 在 macOS `logoRow` 与产品舞台 `PageHeader` 安全边距中的孪生。
- `sidebar-toggle-topbar.js`：`readShellSplitPx` 同时解析旧壳裸尾轨与 Next 壳 `minmax(0px, Npx)`；`hasUserAuthoredPanelWidth` 识别 `rightbarAuthored === false` 阻止误迁移；`RIGHTBAR_CHROME_STYLES` 补齐 `[class*="frame"]` 与 `html[data-platform="darwin"]` 孪生。
- `split-compact-layout.js`、`workbench/host-adapter.js`、`workbench/tab-viewport-reconciler.js`：补齐 `[class*="frame"]` 与 Next `AppFrame` React Fiber `actions` 兜底。

### 3. 测试与 CI 静态门禁加强

- `three-column-layout-contract.test.js`、`workbench/ratio-reconcile.test.js`、`conversation-ratio-authority.test.js`、`three-column-collapse.e2e.test.js`、`sidebar-toggle-topbar.test.js` 全面扩充 Legacy + Next 双壳回归用例。
- `plugins/scripts/three-column-collapse-qa.mjs` 新增 Next 壳真实样式层叠与四项硬像素不变量（零黑缝、右缘贴边、手柄对齐、关闭/overlay 非压缩保护）。
- 新增 `plugins/scripts/verify-next-shell-selectors.mjs` 与对应单测，登记到 `plugins/scripts/governance-manifest.json`，并接入 `.github/workflows/quality-gate.yml`。

## 验收标准

- **AC-1（零黑缝）**：Next 壳在 `1440 / 1728 / 1920` 展开态、左栏收起态、中栏收起态下，右侧开放面板左缘与相邻列右缘偏差 `<= 1px`，右缘与视口右缘偏差 `<= 1px`。
- **AC-2（契约与手柄对齐）**：`DP-007` 提供 `ctx.layout.getSnapshot()` 与 `ctx.layout.setRightbar(px)`；`1728 / 1920` 展开态经协调后外壳 `layoutInfo.rightbar` 与目标宽一致，拖拽手柄与视觉分割线偏差 `<= 2px`。
- **AC-3（新用户默认比例不受污染）**：全新用户在 Next 壳首开右栏（`openRightbar` 写入 45% 种子，`rightbarAuthored === false`）不触发老用户迁移，保持 `30%` 默认中栏比例。
- **AC-4（拖拽追踪与落盘）**：Next 壳 `minmax(400px, 1fr) minmax(0px, Npx)` 下拖动分割线实时跟随并在 `pointerup` 落盘比例，重载后复原。
- **AC-5（非压缩保护与 macOS 适配）**：右栏关闭态与窄屏 overlay 态面板不被 `width: 100%` 压扁为 `0px`；macOS Next 壳全屏且左栏收起时顶栏 strip 正确避让红绿灯与顶栏按钮。
- **AC-6（门禁闭环）**：`desktop-patch-audit.mjs`、`verify-next-shell-selectors.mjs`、`verify-governance-registry.test.mjs`、`verify-fix-regression-test.mjs` 与 `workspace-check.mjs --check` 全部通过。
