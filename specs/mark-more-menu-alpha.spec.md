# 侧栏「更多」菜单：手机管理、社交采收与 AI 网红工作室标记为 Alpha

## 背景

在侧栏官方「更多」菜单（`sidebar.panellist.actions`）中，当前仅有 `plugin-lifecycle.json` 列出的 4 个仓内插件（`发布`、`账号`、`数据分析`、`任务表单`）带有 `Alpha` 标识；而「手机管理」（`omnimux-device`）、「社交采收」（`omnimux-social-harvest`）和「AI 网红工作室」（`omnimux-avatar`）仍以普通无标识条目展示，与当前内测阶段定位不一致。

## 目标

1. 将「手机管理」（`omnimux-device`）、「社交采收」（`omnimux-social-harvest`）与「AI 网红工作室」（`omnimux-avatar`）统一纳入中枢 `isAlphaEntry()` 判定。
2. 在开发版官方「更多」菜单中，上述三项与既有 4 个 Alpha 项一样显示统一的 `Alpha` 行内标识和内测说明 `title`（`ALPHA_DESCRIPTION`）；非 Alpha 项（`应用`、`图像生成`、`视频剪辑`）保持无标识纯文本。
3. 在正式版渠道（`production`）过滤入口时，三项与其余 Alpha 项一致自动隐藏，不暴露未正式发布的内测入口。
4. 保持 `plugins/plugins/omnimux/src/plugin-lifecycle.json` 仅收录仓内真实存在、参与桌面预设与物化打包的插件，避免破坏 `stage-preset-profile.ts` 与 `sync-release-policy.test.mjs`。

## 非目标

- 不把仓外未迁入包（`omnimux-device`、`omnimux-social-harvest`、`omnimux-avatar`）加入 `plugin-lifecycle.json` 或桌面打包依赖。
- 不改动「更多」菜单的条目顺序、分组分隔线、图标或点击激活逻辑。
- 不改动 `应用`、`图像生成`、`视频剪辑` 及 DSH 官方面板行（`插件`、`自动化任务`）的展示与可见性。

## 研究依据

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`：`EXPLORE_MENU_ITEMS` 定义内置 9 项，其中包含 `omnimux-device`（手机管理）与 `omnimux-social-harvest`（社交采收）；`isAlphaEntry()` 同时供给 `explore-more-menu.jsx`、`filterExploreItemsForChannel()`、`markAlphaEntry()` 与 `window.__omnimuxSidebar.isAlphaEntry` 公共接缝。
- `plugins/plugins/omnimux/src/client/explore-more-menu.jsx`：`exploreMoreMenuLabel()` 直接复用 `isAlphaEntry()`，命中时渲染 `.omnimux-explore-more-label` + `.omnimux-explore-more-alpha`（`title={ALPHA_DESCRIPTION}`）。
- Dev 运行态已安装的 `omnimux-avatar`（AI 网红工作室）在 `sidebar.panellist.actions`（order 120）渲染菜单项时，已直接调用 `window.__omnimuxSidebar?.isAlphaEntry?.('omnimux-avatar') === true` 与 `window.__omnimuxSidebar?.alphaDescription`，并自带同规格 `.omnimux-avatar-more-alpha` 样式。
- `app/dsh-plugin-desktop/scripts/stage-preset-profile.ts`（L138-L142）与 `specs/plugins-migration-paths.spec.md`（PR #26）：`plugin-lifecycle.json` 中每个 key 都必须在 `plugins/plugins/<name>` 存在源码目录，否则桌面预设打包直接抛出 `unknown lifecycle plugin`；因此未迁入单仓的 3 个外部插件不能写回 `plugin-lifecycle.json`，应在 `sidebar-coordinator.js` 以 `EXTERNAL_ALPHA_PLUGINS` 补集并入 `isAlphaEntry()`。
- 演示：`ui-demo/more-menu-alpha-demo.html`，同屏对照修改前后，覆盖暗/亮主题、开发/正式渠道切换与窄视口。

## 假设

`omnimux-device`、`omnimux-social-harvest` 与 `omnimux-avatar` 当前均处于内测阶段，且不属于本仓 `plugins/plugins/` 的构建/打包集合；在中枢 `sidebar-coordinator.js` 将三者作为 `EXTERNAL_ALPHA_PLUGINS` 并入 `isAlphaEntry()`（并让 `markAlphaEntry()` 与 `exploreMoreMenuLabel()` 复用同一判定），即可同时驱动内置「更多」菜单与 `omnimux-avatar` 自注册菜单行显示统一 `Alpha` 标识，且不影响桌面预设打包与仓内发布策略。

## 证伪方式

1. 若实测中 `omnimux-avatar` 菜单行未读取 `window.__omnimuxSidebar.isAlphaEntry('omnimux-avatar')` 或样式未生效导致角标错位/缺失，则仅改中枢 `isAlphaEntry()` 不足以覆盖「AI 网红工作室」。
2. 若运行 `node scripts/workspace-check.mjs --check`、`corepack pnpm --dir plugins --filter omnimux test` 或 `node --test plugins/scripts/sync-release-policy.test.mjs` 出现生命周期校验或菜单渲染断言失败，即证明补集机制或渠道过滤与现有契约冲突。

## 验收标准

- `isAlphaEntry()` 对 `omnimux-device` / `omnimux-device-entry`、`omnimux-social-harvest` / `omnimux-social-harvest-entry`、`omnimux-avatar` / `omnimux-avatar-entry` 均返回 `true`；对 `omnimux-apps`、`image-generation`、`omnimux-clip`、`omnimux-workflow` 返回 `false`。
- 开发版「更多」菜单内置 9 项中，带 `Alpha` 标识的 6 项按顺序为：`发布`、`账号`、`手机管理`、`数据分析`、`任务表单`、`社交采收`；其余 3 项（`应用`、`图像生成`、`视频剪辑`）保持纯字符串文案；自注册的 `AI网红工作室` 通过 `__omnimuxSidebar.isAlphaEntry('omnimux-avatar')` 渲染同一规格 `Alpha` 标识与 `ALPHA_DESCRIPTION` 提示文案。
- 正式版渠道下 `filterExploreItemsForChannel(EXPLORE_MENU_ITEMS, 'production')` 仅保留 `['应用', '图像生成', '视频剪辑']`，`omnimux-device-entry`、`omnimux-social-harvest-entry`、`omnimux-avatar-entry` 在正式版注册时不创建 DOM、不进收敛集合。
- `plugin-lifecycle.json` 维持 4 个仓内 Alpha 包不变，`sync-release-policy.test.mjs` 与 `workspace-check.mjs --check` 全绿。
- 修改前后高保真演示 `ui-demo/more-menu-alpha-demo.html` 可直接打开，暗/亮主题、开发/正式渠道与窄视口下 `Alpha` 标识均完整可见且不挤没行文案。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `发布渠道过滤：开发版保留全部入口，正式版只过滤 Alpha 测试版`
  - 原断言：`assert.deepEqual(prod.map((item) => item.label), ['应用', '图像生成', '视频剪辑', '手机管理', '社交采收'])`
  - 必须改的理由：本次需求明确将「手机管理」（`omnimux-device`）与「社交采收」（`omnimux-social-harvest`）标记为 Alpha 内测项；按照既有正式版隐藏全部 Alpha 项的渠道规则，正式版过滤结果不再包含这两项。
  - 新期望证据：`filterExploreItemsForChannel(EXPLORE_MENU_ITEMS, 'production').map((item) => item.label)` 精确等于 `['应用', '图像生成', '视频剪辑']`，开发版仍返回全部 9 项。

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js` :: `正式版渠道：Alpha 行注册不创建元素、不进收敛集合，菜单只剩非 Alpha 项`
  - 原断言：`assert.deepEqual(resolveExploreMenuItems().map((item) => item.label), ['应用', '图像生成', '视频剪辑', '手机管理', '社交采收'])`
  - 必须改的理由：「手机管理」与「社交采收」已标记为 Alpha，正式版渠道下 `resolveExploreMenuItems()` 过滤全部 Alpha 入口后仅剩非 Alpha 项；同时补充验证 `device`、`social-harvest`、`avatar` 在正式版注册时也不创建元素、不进收敛集合。
  - 新期望证据：正式版下 `resolveExploreMenuItems().map((item) => item.label)` 精确等于 `['应用', '图像生成', '视频剪辑']`，且 7 个 Alpha 插件（含新增 3 项）注册均不创建 DOM、不入 `CONVERGED_ROWS`。

## 实施边界

仅改动 `plugins/plugins/omnimux` 的侧栏协调器/「更多」菜单模块、对应单测、任务规格、修改前后演示和根 `bundle.lock.json`；不改 `plugin-lifecycle.json`、不改 `app/` 桌面壳、不修改仓外插件源码。

## 影响文件

- `plugins/plugins/omnimux/src/client/sidebar-coordinator.js`
- `plugins/plugins/omnimux/src/client/explore-more-menu.jsx`
- `plugins/plugins/omnimux/src/client/sidebar-coordinator.test.js`
- `plugins/plugins/omnimux/src/client/explore-more-menu.test.js`
- `bundle.lock.json`
- `specs/mark-more-menu-alpha.spec.md`
- `ui-demo/more-menu-alpha-demo.html`

## 验证

- `corepack pnpm --dir plugins --filter omnimux build`
- `corepack pnpm --dir plugins --filter omnimux test`
- `node --test plugins/scripts/sync-release-policy.test.mjs`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- `node scripts/workspace-check.mjs --check`
- 真实浏览器验收：检查 `ui-demo/more-menu-alpha-demo.html`（暗/亮主题与窄视口）及在隔离真实浏览器渲染实际编译后的 `explore-more-menu.jsx` + `sidebar-coordinator.js` + `omnimux-avatar` 接缝调用，核对 7 个 Alpha 行几何与文案；本轮无真实模型调用。
