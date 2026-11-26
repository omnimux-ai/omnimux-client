# Spec: 修复「发布」页子视图「返回列表」无法点击

- 任务：`fix-publish-back-button`
- 分支：`fix/fix-publish-back-button`
- 基线：`origin/main`
- 关联插件：`plugins/plugins/omnimux-publish`

## 背景与现象

在 OmniMux 桌面端（macOS，`dsh-desktop-next` + `deepseek-harness` `0.2.2-rc.5` 工作台 Tab）进入「发布」Tab 并打开「新增发布 / 编辑草稿 / 查看详情」子视图后，左上角 `< 返回列表` 按钮无法通过鼠标点击返回列表页。

## 调研与对标（源码与机制）

1. **宿主窗口拖拽区域机制**（`app/deepseek-harness/packages/client/web/src/base.css`、`window-drag/regions.ts`）：
   - macOS Electron 原生命中测试按 **DOM 文档顺序**收集页面中所有可见且计算值 `-webkit-app-region` 为 `drag` 或 `no-drag` 的元素矩形，**忽略 `z-index` 层叠与 `overflow` 裁剪**；某坐标点最后一个包含它的盒子决定该点是否可拖拽。
   - `base.css` 通过 `:where(html[data-platform='darwin'] *) { -webkit-app-region: initial; }`（计算值为 `none`，不产生区域盒子）重置继承，并仅对 `[data-window-drag]` / `[data-window-drag-controls]` 内部控件或显式 `[data-window-drag-exclude]` 声明 `no-drag`。
2. **`omnimux-publish` DOM 与 CSS 现状**（`PublishStage.jsx`、`PublishOverlays.jsx`、`styles.js`、`dsh-ui-kit/src/stage/PageHeader.module.css`）：
   - `PublishStage` 首先渲染一级页 `<PageHeader>`（`.dshUk-PageHeader-pageHeader`），其样式在 `PageHeader.module.css:11` 声明了 `-webkit-app-region: drag;`，在工作台 Tab 顶部占据约 `0..72px` 高度。
   - 点击新建/编辑/查看时，`PublishStageModals` 在 `<PageHeader>` 之后以 `position: absolute; inset: 0; z-index: 300;` 挂载 `.omnimux-publish-subscreen` 覆盖整屏。
   - 与同类实现 `.omnimux-products-subscreen`（`plugins/plugins/omnimux-products/src/client/styles.js:359-360` 显式声明 `pointer-events: auto; -webkit-app-region: no-drag;`）不同，`.omnimux-publish-subscreen` 既未声明 `-webkit-app-region: no-drag`，也未带 `data-window-drag-exclude`，其内部 `< 返回列表`（以及详情页 `刷新`）按钮在 `dsh-desktop-next` 下计算值为 `none` 且位于 `<PageHeader>` 的 `0..72px` 矩形内，导致点击事件被 Electron 窗口拖拽层拦截。

## 假设

`PublishStage` 在进入 Composer 或 RecordDetail 子视图时仍保留带 `-webkit-app-region: drag` 的 `<PageHeader>` 在下层 DOM 中，而覆盖其上的 `.omnimux-publish-subscreen` 未声明 `-webkit-app-region: no-drag` 与 `data-window-drag-exclude`（也未将子视图顶栏及返回/操作按钮设为 `no-drag`），导致 macOS Electron 按 DOM 几何收集区域时，`< 返回列表` 按钮中心点仍落在 `<PageHeader>` 的 `drag` 矩形内而无法触发点击。

## 证伪方式

在真实无头 Chromium 浏览器中挂载真实编译产物 `omnimux-publish` 客户端与 `deepseek-harness` `base.css`、`dsh-ui-kit` `PageHeader` 样式及模拟 `ui-dockkit` 容器样式（`html[data-platform="darwin"]`），复现 `window-drag/regions.ts` 同口径的 `app-region` 几何判定并直接点击 `< 返回列表`：
- **若假设成立**：修复前，Composer 类型选择页、Composer 编辑页、RecordDetail 加载态与已加载态的 `< 返回列表` 中心点 `isDraggableAt` 均判定为 `true`（`drag`）；修复后，上述全部场景的 `< 返回列表` 及详情 `刷新` 中心点 `isDraggableAt` 均为 `false`（`no-drag`），且真实鼠标点击均可使子视图卸载并返回列表页。
- **若假设错误**：即使给 `.omnimux-publish-subscreen` 与子视图顶栏/按钮补全 `no-drag` / `data-window-drag-exclude`，测试中 `< 返回列表` 的 `isDraggableAt` 仍为 `true` 或真实点击仍无法触发 `onBack` 返回列表（可执行命令：`corepack pnpm --dir plugins --filter omnimux-publish test` 与 `node plugins/plugins/omnimux-publish/tests/e2e/publish-back-button.e2e.test.mjs`）。

## 修改方案

1. `plugins/plugins/omnimux-publish/src/client/styles.js`：
   - `.omnimux-publish-subscreen` 增加 `pointer-events: auto;` 与 `-webkit-app-region: no-drag;`。
   - `.omnimux-publish-stage:has(> .omnimux-publish-subscreen) > .dshUk-PageHeader-pageHeader` 置为 `-webkit-app-region: no-drag;`。
   - `.omnimux-publish-type-toolbar`、`.omnimux-publish-editor-head`、`.omnimux-publish-detail-head` 及 `.omnimux-publish-subscreen button, .omnimux-publish-subscreen [role="button"]` 显式声明 `-webkit-app-region: no-drag;`。
2. `plugins/plugins/omnimux-publish/src/client/views/PublishOverlays.jsx`：
   - Composer 与 RecordDetail 两种子视图的 `.omnimux-publish-subscreen` 容器统一补充 `data-window-drag-exclude`。
3. `plugins/plugins/omnimux-publish/src/client/RecordDetail.jsx`：
   - `!record` 加载/错误占位视图的 `< 返回列表` 按钮同步使用 `.omnimux-publish-detail-head` 包裹，确保位置与可点区与已加载态一致。
4. 回归与端到端测试：
   - `plugins/plugins/omnimux-publish/src/client/styles-composer.test.js`：校验 `.omnimux-publish-subscreen`、`PageHeader` 退让与头部/按钮 `no-drag` 规则。
   - `plugins/plugins/omnimux-publish/tests/e2e/publish-back-button.e2e.test.mjs`：真实浏览器端到端验证修复前后（含类型选择页、视频/图文编辑页、详情页加载态与已加载态、亮暗主题与窄屏布局）`app-region` 命中与点击 `< 返回列表` 返回列表闭环。

## 验收标准

- 修复前在 `html[data-platform="darwin"]` 真实浏览器复现下，Composer 类型选择、Composer 编辑页、RecordDetail 顶栏 `< 返回列表` 落入 `PageHeader` `drag` 区域。
- 修复后在亮/暗双主题、常规宽屏（`1280×800`）与窄屏（`820×720`）下，上述所有子视图 `< 返回列表`（含详情页 `刷新`）均为 `no-drag` 且真实点击可立即返回列表（`omnimux-publish-viewport` 可见、`.omnimux-publish-subscreen` 卸载）。
- 双向证伪：临时回退修复改动后新增单测与端到端测试必红；恢复修复后 `omnimux-publish` 全部测试、构建、`bundle.lock.json` 与仓库门禁全绿。
