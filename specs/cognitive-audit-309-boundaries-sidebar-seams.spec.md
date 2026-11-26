# Issue #309：修复插件边界门禁盲区、收敛重复侧栏垫片并建档 window.__omnimux* 契约

- 关联 Issue：`#309`（首轮每周新人接手认知成本审计 Top 1，Phase 1）
- 影响范围：`plugins/scripts/verify-plugin-boundaries.mjs`、`plugins/scripts/plugin-boundaries-baseline.json`、`plugins/packages/dsh-ui-kit/`、11 个插件侧栏入口（9 个 `sidebar-entry.js` + `omnimux-clip/src/client/workbench-store.js` + `omnimux-market/src/client/apply.js`）、`plugins/docs/contracts/client-window-seams.md`
- UI 演示门禁：不触发（纯构建边界门禁、共享侧栏适配层与契约文档，零视觉/交互/DOM 契约变更）

## 假设

1. 将 `plugins/scripts/verify-plugin-boundaries.mjs` 的跨插件私有导入检测扩展到 `../omnimux/(src|lib)/`、`../omnimux-*/(src|lib)/`、`../dsh-*/(src|lib)/`、`omnimux/(src|lib)/` 以及 `export ... from` / 动态 `import()`，并把现有 32 个运行态文件的 104 处历史直连冻结进只减不增棘轮 `plugins/scripts/plugin-boundaries-baseline.json` 后，能够零误报放行存量同时立刻拦截任何新增跨插件私有导入（测试文件导入 Hub 源码做契约验证不受阻断）。
2. 在 `plugins/packages/dsh-ui-kit` 新增并导出 `createWorkbenchStageStore` 与 `createWorkbenchSidebarEntry`（同时扩展 `createSidebarEntry` 支持 `extraDatasetKeys`、`titleAttr` 与 `access: 'local'`），把 9 个插件 `sidebar-entry.js`、`omnimux-clip/src/client/workbench-store.js` 与 `omnimux-market/src/client/apply.js` 收敛到单一实现并删除零调用死文件 `plugins/plugins/omnimux-assets/src/client/stage-store.js`，可以完全保持所有侧栏入口的 DOM 属性、选择器、rank、tabId、样式与 Workbench 激活/会话隔离行为不变。
3. 在 `plugins/docs/contracts/client-window-seams.md` 集中登记全部 42 个生产态 `window.__omnimux*` 全局接口的生产者、消费者、数据结构与生命周期，能够为跨插件协作提供单一权威索引，不改变任何运行时全局变量名。

## 证伪方式

1. **边界门禁双向证伪**：在 `plugins/scripts/verify-ci-gates.test.mjs` 新增用例构造真实 `../omnimux/src/...` 导入、`export ... from '../omnimux-inspiration/src/...'` 重导出、动态 `import('../omnimux/src/...')`、`omnimux/src/...` 包内私有导入以及已入基线文件新增未登记导入；回退 `verify-plugin-boundaries.mjs` 核心修复后上述用例必红，恢复后全绿，且 `node plugins/scripts/verify-plugin-boundaries.mjs` 对当前全仓通过。
2. **侧栏收敛与运行时契约证伪**：运行 `corepack pnpm --filter dsh-ui-kit run check`（含 `Stage.test.js` 对 `createWorkbenchStageStore` 延迟轮询/取消订阅/六方法与 `createWorkbenchSidebarEntry` 行为单测 + `kit-export.test.js`）、`corepack pnpm --dir plugins run build:all` 与 `corepack pnpm --dir plugins run verify:stages`（在 JSDOM 中真实加载全部 9 个公开侧栏目标，含 `omnimux-market` 完整打包产物，逐一校验 `getSnapshot`/`subscribe`/`open`/`close`/`set`/`readBox`、聚焦切换、会话隔离与卸载清理）。
3. **全仓门禁与元数据一致性证伪**：运行受影响插件单测、`verify:dsw-tokens`、`verify:plugin-load`、`doc-lint`、`verify-test-standard-declarations`、`verify-fix-regression-test`、`bundle:lock:check` 与 `workspace-check`。

## 旧标准变更

以下 10 条既有静态正则单测原断言的是「收敛前各插件内联粘贴的 `createSidebarStore` / `createWorkbenchStageStore` / `window.__omnimuxSidebar` 与内联 CSS 源码文本」；收敛至 `dsh-ui-kit` 单一真源后，各插件入口改为调用 `createWorkbenchSidebarEntry` 或 `createWorkbenchStageStore`，底层 `window.__omnimuxWorkbench.createSidebarStore`、`window.__omnimuxSidebar` 与 32px 样式契约由 `dsh-ui-kit`（`Stage.test.js`）、`omnimux-market/src/tests/client-bundle.test.ts` 与 `plugins/scripts/live-stage-contracts.mjs` 统一守卫，覆盖度不降反升：

- `plugins/plugins/omnimux-accounts/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(source, /createSidebarStore/)` 检查 `sidebar-entry.js` 内联粘贴的 `createSidebarStore`；改为 `assert.match(source, /createWorkbenchSidebarEntry/)` 校验其委托 `dsh-ui-kit` 共享 Workbench 入口且不调用 `claimProductStage`。
- `plugins/plugins/omnimux-analytics/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(source, /createSidebarStore/)` 改为 `assert.match(source, /createWorkbenchSidebarEntry/)`，原因同上。
- `plugins/plugins/omnimux-assets/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(source, /createSidebarStore/)` 改为 `assert.match(source, /createWorkbenchSidebarEntry/)`，原因同上。
- `plugins/plugins/omnimux-clip/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(storeSource, /createSidebarStore/)` 检查 `workbench-store.js` 内联轮询实现；改为 `assert.match(storeSource, /createWorkbenchStageStore/)`，同时保留 `omnimux-clip/src/client/sidebar-entry.test.js` 对真实运行时转发 `window.__omnimuxWorkbench.createSidebarStore` 的行为断言。
- `plugins/plugins/omnimux-forms/src/client/workbench-seat.test.mjs` :: `sidebar entry uses the workbench store and exports standard selectors`
  - 原断言 `assert.match(source, /createWorkbenchStageStore/)` 检查本地粘贴函数；改为 `assert.match(source, /createWorkbenchSidebarEntry/)`，同时保留 `FORMS_TAB_ID` 与 `ENTRY_SELECTOR` 断言。
- `plugins/plugins/omnimux-inspiration/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(source, /createSidebarStore/)` 改为 `assert.match(source, /createWorkbenchSidebarEntry/)`，原因同上。
- `plugins/plugins/omnimux-publish/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(source, /createSidebarStore/)` 改为 `assert.match(source, /createWorkbenchSidebarEntry/)`，原因同上。
- `plugins/plugins/omnimux-workflow/src/client/workbench-seat.test.js` :: `sidebar entry uses the workbench store, not the product stage`
  - 原断言 `assert.match(source, /createSidebarStore/)` 改为 `assert.match(source, /createWorkbenchSidebarEntry/)`，原因同上。
- `plugins/plugins/omnimux-market/src/client/workbench-seat.test.js` :: `plaza entry is registered to __omnimuxSidebar under projects (rank 4.1), not in footer`
  - 原断言 `assert.match(source, /__omnimuxSidebar/)` 检查 `apply.js` 手写副本；改为 `assert.match(source, /createWorkbenchSidebarEntry/)`（继续断言 `rank: 4.1`、`data-omnimux-market-entry`、`PLAZA_TAB_ID` 与无 `sidebar.footer.action`），`__omnimuxSidebar` 注册与行为由 `client-bundle.test.ts` 与 `live-stage-contracts.mjs` 端到端校验。
- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `sidebar entry is positioned under projects (rank 4.1) via __omnimuxSidebar and footer action is removed`
  - 原断言直接对 `apply.js` 匹配 `window.__omnimuxSidebar` 及内联 CSS（`height: 32px` / `font-size: 14px` / `width: 14px; height: 14px`）；收敛后改为断言 `apply.js` 委托 `createWorkbenchSidebarEntry`（含 `rank: 4.1`、`data-omnimux-market-entry`、`data-omnimux-esc-entry` 与无 `sidebar.footer.action`），并直接读取 `dsh-ui-kit/src/stage/createSidebarEntry.ts` 真源校验 `window.__omnimuxSidebar` 与上述 32px/14px 样式基线。
