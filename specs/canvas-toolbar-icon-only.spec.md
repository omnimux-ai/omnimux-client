# 规格：画布底部工具栏视觉与交互优化（纯图标胶囊坞 + 指针模式浮层 + 样式隔离）

## 1. 背景与目标

PR #190（Issue #111）在 `omnimux-workflow` 底部悬浮工具栏（`.wf-canvas-toolbar`）为「添加节点」和「选择 / 抓手」增加了可见文本标签，导致底栏冗长；同时 `omnimux-market` 在 [css.js](../plugins/plugins/omnimux-market/src/client/css.js) 中声明了无作用域限定的全局规则 `button[class*="add"] { width: 28px !important; background: transparent !important; ... }`，在真实宿主中直接压毁了画布主添加按钮 `.wf-canvas-toolbar__item--primary-add` 的尺寸、底色与排版。

用户明确要求：
1. 工具栏这一行的按钮**只保留图标，不要文本**，并用测试锁定；
2. 参考用户提供的底栏 UI 与交互方案，在不新增任何业务功能的前提下优化视觉与交互：
   - **同心胶囊底栏与圆形主「+」按钮**：底栏为全圆角胶囊（`border-radius: 999px`），左侧主添加节点按钮采用与胶囊曲率同心的高对比纯圆（`40×40`、`border-radius: 50%`，深色白底黑加号 / 浅色黑底白加号），右侧紧邻细分隔线。
   - **指针模式聚合触发器 + 精致浮层菜单**：底栏仅展示「当前模式图标 + 细胶囊上箭头（`^`）」无文本触发器（悬停/展开时箭头胶囊高亮）；点击展开不透明悬浮菜单（`role="menu"`），包含「选择（`V`）」与「抓手（`H`）」两行 `menuitemradio` 选项，采用四列对齐（选中勾选 `✓` / 工具图标 / 简洁模式名 / 右对齐弱化快捷键 `V`、`H`），选中行带柔和圆角底色；支持点击选切、键盘 `ArrowUp`/`ArrowDown`/`Enter`/`Escape` 与画布全局 `V`/`H` 快捷键，并与添加节点、模板面板互斥关闭，走 `useClickOutside` / `canvasDismissLayer` 避免误取消节点选中。
   - **既有二级入口纯图标化**：保留且仅保留既有「插入模板」「项目资产」「快捷键帮助」三项功能（不新增任何功能），统一为 `36×36` 纯图标圆形悬停态，帮助按钮左侧保留分隔线；全部按钮保留完整 `title`、`aria-label` 与高对比 `:focus-visible` 焦点环。
3. **跨插件样式隔离**：将 `omnimux-market` 中面向聊天输入框的 `button[class*="add"]` 选择器收敛至 `[data-composer-card]` 作用域内（保留 `.Q7WfXG_add` 精确类兼容），杜绝全局 `!important` 样式泄漏到画布工具栏及其他插件。

## 2. 边界与不做项

- 不新增参考图中的额外工具入口或新业务能力，严格保持 OmniMux 既有 5 个工具栏入口（添加节点、指针模式、插入模板、项目资产、快捷键帮助）。
- 不修改 DSH 官方上游包，不引入未定义的 `--dsw-*` Token，浮层背景严格使用不透明语义变量（通过 `guard-no-transparent-popover.mjs`）。
- 遵循 Show, Don't Tell：模式切换不额外弹 Toast 或状态提示条。

## 3. 验收项

1. **HTML 演示评审**：交付独立可打开的高保真前后对比 HTML 演示，覆盖深/浅双主题、指针模式浮层展开与切换、添加节点浮层互斥、窄屏视口与几何自检，在真实浏览器（ego-browser）操作检查并截图复核后再实施产品代码。
2. **构建、单测与静态门禁**：`build:all`、`omnimux-workflow` `typecheck` 与全量单测、`omnimux-market` 全量单测、`canvas-add-node-button-squircle.e2e.test.mjs`、`verify:dsw-tokens`、`guard:popover`、`check:boundaries`、`verify-test-standard-declarations`、`verify-fix-regression-test`、`workspace-check` 与 `bundle.lock.json` 全绿；完成双向证伪（回退核心修复时回归用例真实失败，恢复后全绿）。
3. **真实浏览器验证**：在任务 worktree 真实画布页面（同页注入 `omnimux-market` 样式验证隔离效果）下，核查深/浅双主题、窄屏、指针模式浮层展开与切换、添加节点浮层互斥与快捷键 `V`/`H`/`Escape` 交互。

## 旧标准变更

以下既有测试断言因用户明确要求「工具栏按钮仅保留图标、参考同心圆形主按钮与指针下拉浮层交互重排底栏」而按新契约同步更新（已用更强的真实渲染、CSS 层叠与交互测试替代锁定）：

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/canvasUiPolish111.test.mjs` :: `P1: Toolbar exposes visible Add Node text and direct side-by-side Select/Hand mode buttons`
- `plugins/plugins/omnimux-workflow/tests/e2e/canvas-add-node-button-squircle.e2e.test.mjs` :: `E2E: 画布底部「+」添加节点按钮为圆角方形而非纯圆`
- `plugins/plugins/omnimux-workflow/tests/e2e/canvas-toolbar-transfer-buttons-removed.e2e.test.mjs` :: `#4112 底部工具栏不再渲染导出/导入按钮，其余 Dock 入口保留`
