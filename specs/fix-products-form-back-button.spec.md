# Spec: 修复 ProductFormPage 子屏内 PageHeader 面包屑返回按钮被窗口拖拽区遮挡

- 任务：`fix-products-form-back-button`
- 分支：`fix/fix-products-form-back-button`
- 基线：`origin/main`
- 关联范围：`plugins/packages/dsh-ui-kit`、`plugins/plugins/omnimux-products`、`plugins/plugins/omnimux-assets`

## 背景与现象

在 macOS 桌面端（`dsh-desktop-next` 与 `deepseek-harness` `0.2.2-rc.5`）进入「资产库 → 产品库 → 添加实物/数字产品或编辑产品」二级全屏表单页 `ProductFormPage` 后，左上角面包屑返回区包含返回箭头 `IconButton`（`.omnimux-products-back-button`）与「产品库」`Button`。该区域位于子屏内置 `<PageHeader>` 的顶部矩形内，存在点击事件被 Electron 窗口拖拽层拦截的风险。

## 调研与对标（源码与机制）

1. **macOS `app-region` 收集规则**（`app/deepseek-harness/packages/client/web/src/base.css`、`window-drag/regions.ts`）：
   - macOS Electron 按 **DOM 文档序**收集可见且 `-webkit-app-region` 计算值为 `drag` 或 `no-drag` 的盒矩形，忽略 `z-index` 与 `overflow`；命中测试坐标点由最后包含它的盒子决定。
   - `base.css:56` 通过 `:where(html[data-platform='darwin'] *) { -webkit-app-region: initial; }`（计算值为 `none`，不产生盒子）清除继承，仅在 `[data-window-drag]` / `[data-window-drag-controls]` 内部或 `[data-window-drag-exclude]` 节点启用控件 `no-drag`。
2. **`dsh-ui-kit` `<PageHeader>` 现状**（`PageHeader.tsx`、`PageHeader.module.css`）：
   - `.pageHeader`（`PageHeader.module.css:11`）声明 `-webkit-app-region: drag;`，而 `.tabsContainer`（第 63 行）与 `.controls`（第 71 行）均声明 `-webkit-app-region: no-drag;`；唯有 `.breadcrumb`（第 22 行）遗漏 `-webkit-app-region: no-drag;`。
   - `<header className="dshUk-PageHeader-pageHeader">` 未携带 `[data-window-drag]`，导致 `base.css:99` 不自动豁免面包屑内的 `button`。
3. **`ProductFormPage` 现场 DOM/CSS 现状**（`AssetsStage.jsx`、`ProductFormPage.jsx`、`omnimux-products/src/client/styles.js`）：
   - `.omnimux-products-subscreen`（`styles.js:351-360`）虽有 `-webkit-app-region: no-drag`，但缺少 `data-window-drag-exclude`；且随后在其**内部**渲染的第二个 `<PageHeader>` 在 DOM 序上位于 `.omnimux-products-subscreen` 之后，其 `.dshUk-PageHeader-pageHeader` 重新绘制 `drag` 矩形并覆盖 `.omnimux-products-back-button` 与「产品库」按钮。

## 假设

`ProductFormPage` 在 `.omnimux-products-subscreen` 内部渲染的 `<PageHeader>` 携带 `-webkit-app-region: drag` 且在 DOM 文档序上晚于 `.omnimux-products-subscreen`，而 `dsh-ui-kit` `PageHeader.module.css` 的 `.breadcrumb` 以及 `omnimux-products/src/client/styles.js` 的 `.omnimux-products-back-path` / 子屏 `<PageHeader>` 均未声明 `-webkit-app-region: no-drag`（容器亦缺 `data-window-drag-exclude`），同时外层 `AssetsStage` 未在子屏打开时退让外层 `<AssetsHeader>` 的 `drag`，导致 macOS Electron 下返回箭头 `IconButton` 与「产品库」`Button` 中心点被判定为 `isDraggableAt === true`（`drag`）而无法响应点击。

## 证伪方式

在真实无头 Chromium 浏览器中以 `html[data-platform="darwin"]` 挂载 `base.css` 核心规则、真实编译后的 `dsh-ui-kit` CSS 模块及真实构建的 `ProductTab` + `ProductFormPage`（含 `AssetsStage` 外层 `<PageHeader>`），按 `window-drag/regions.ts` 同口径计算 DOM 序 `isDraggableAt` 并触发真实鼠标左键点击：
- **若假设成立**：修复前，新建实物、编辑数字与未保存拦截场景中返回箭头 `IconButton` 与「产品库」`Button` 中心点均落入 `.dshUk-PageHeader-pageHeader` 的 `drag` 区域（`draggable === true`）；修复后，亮/暗双主题与宽屏（`1280×800`）/ 窄屏（`820×720`）下两个返回按钮、右上角「取消 / 保存产品」及未保存确认框按钮均为 `no-drag`，真实鼠标点击返回按钮可退出子屏返回产品列表或稳定弹出未保存确认框。
- **若假设错误**：即使为 `PageHeader.module.css` `.breadcrumb`、`.omnimux-products-subscreen` 及其内/外 `<PageHeader>` 与返回路径补齐 `no-drag` 与 `data-window-drag-exclude`，实测两个返回按钮仍落入 `drag` 矩形或点击无法触发 `requestLeave`（可执行命令：`corepack pnpm --dir plugins --filter dsh-ui-kit test`、`corepack pnpm --dir plugins --filter omnimux-products test`、`corepack pnpm --dir plugins --filter omnimux-assets test`）。

## 修改方案（方案 A + 子屏顶栏整体 `no-drag`）

1. **`plugins/packages/dsh-ui-kit`**：
   - `src/stage/PageHeader.module.css`：为 `.breadcrumb` 补充 `-webkit-app-region: no-drag;`。
   - `src/stage/Stage.test.js`：精确断言 `.breadcrumb`、`.tabsContainer`、`.controls` 均声明 `-webkit-app-region: no-drag;`。
   - 重建并更新已跟踪产物 `lib/index.js`（及对应类型/sourcemap 产物若构建发生变化）。
2. **`plugins/plugins/omnimux-products`**：
   - `src/client/ProductFormPage.jsx`：`.omnimux-products-subscreen` 容器补充 `data-window-drag-exclude`。
   - `src/client/styles.js`：为 `.omnimux-products-subscreen`、子屏内 `<PageHeader>`（包含兼容壳 `[class*="PageHeader"]` 与 `header` 高优先级选择器）、`.dshUk-PageHeader-breadcrumb`、`.omnimux-products-back-path` 以及子屏 `button` / `[role="button"]` 声明 `-webkit-app-region: no-drag;`。
   - `src/client-form-subscreen.test.js` & `tests/e2e/form-back-button.e2e.spec.js`：新增静态契约断言与无头 Chromium 端到端回归测试。
3. **`plugins/plugins/omnimux-assets`** & **`plugins/plugins/omnimux`**：
   - `omnimux-assets/src/client/styles.js`：新增 `.omnimux-assets-stage:has(> .omnimux-products-subscreen) > .dshUk-PageHeader-pageHeader { -webkit-app-region: no-drag; }`，使子屏开启时外层页头退让。
   - `omnimux-assets/src/client/ProductsIntegration.test.js`：补充对应回归断言。
   - `plugins/plugins/omnimux/src/client/conversation-box.js` 与 `apps-stage-box.test.js`：兼容壳 `PRODUCT_STAGE_CHROME` 中排除 `[data-window-drag-exclude] *` 的内层 `header`，并将 `header [class*="breadcrumb"]` 纳入 `no-drag !important`。
4. **`bundle.lock.json`**：全量构建后重算并校验 14 个插件一致性。

## 验收标准

- 高保真演示与真实无头 Chromium 测试均能复现「修复前 `isDraggableAt === true`（所属 `.dshUk-PageHeader-pageHeader`）、修复后 `isDraggableAt === false`（`no-drag`）」。
- 覆盖新建实物、编辑数字、未保存修改触发 `UnsavedChangesDialog`、亮/暗主题与 `1280×800` / `820×720` 视口。
- 双向证伪：临时回退产品代码改动后新增单测与端到端测试均失败；恢复后 `dsh-ui-kit`、`omnimux-products`、`omnimux-assets` 全量构建测试、`bundle.lock.json` 与仓库门禁全绿。
