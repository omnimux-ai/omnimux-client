# 移除社媒导入弹窗的自动 AI 解析选项 (#369)

## 背景与范围

用户在灵感库「导入社媒灵感」弹窗与「账号监控」导入弹窗中粘贴内容链接时，当前存在「导入后自动执行 AI 多维内容解构分析」（`AutoAnalyzeSwitch`）开关。依据产品要求与 Issue #369：

- **移除界面选项与本地偏好**：从 `InspirationInlineImportDialog.jsx` 和 `RivalImportDialog.jsx` 移除自动 AI 解析开关，删除 `import-dialog-prefs.js`（`omnimux_inspiration_auto_analyze`）、`import-dialog-controls.jsx` 中的 `AutoAnalyzeSwitch`、`styles.js` 中的 `.omnimux-inspiration-switch*` 死样式以及 `locales.js` 中英双语的 `add.autoAnalyze` 文案。
- **固定不自动触发 AI 解析**：两处导入弹窗提交内容导入请求（`POST /omnimux/inspiration/local/import-url`）时显式传入 `auto_analyze: false`，仅抓取并入库内容；需要解构时可在详情侧边栏或预览弹窗手动按需触发 AI 解构。
- **保持兼容的下游与工具面**：保留后端 `/omnimux/inspiration/local/import-url` 的 `auto_analyze` 参数支持、Agent 工具（`inspiration_create`、`inspiration_rival_to_inspiration`）及对标作品卡片「AI 拆解」按钮（`RivalAccountsPanel.jsx` 中 `convertRivalPost(..., { auto_analyze: true })`）原有默认行为不变。

## 假设

1. 将两处导入弹窗中的 `AutoAnalyzeSwitch` 移除并在 `importLocalInspiration` 调用处显式传入 `auto_analyze: false` 后，即使浏览器 `localStorage` 中遗留旧键 `omnimux_inspiration_auto_analyze = 'true'`，前端也不会在导入链接时自动发起 AI 视频解构分析。
2. 后端 `http-handlers.js` 仍以 `body.auto_analyze !== false` 作为默认值，因此前端显式传递 `auto_analyze: false` 是关闭弹窗导入自动解析的必要条件；同时保留该参数可确保详情手动解析、Agent 工具与对标「AI 拆解」按钮链路不受影响。

## 证伪方式

- **双向证伪**：
  1. 在 `import-dialog-no-auto-analyze.e2e.test.js` 中预置 `localStorage['omnimux_inspiration_auto_analyze'] = 'true'`，真实挂载两个导入弹窗并提交内容链接，验证 DOM 中不存在 `[role="switch"]` 与 `add.autoAnalyze` 文案，且 `/omnimux/inspiration/local/import-url` 请求体精确包含 `auto_analyze: false`；`import-dialog-controls.test.js`、`InspirationImportStatus.test.js` 与 `import-landing-render.test.js` 同步校验源码契约、请求体及无开关渲染。
  2. 若回退源码中 `auto_analyze: false` 为 `undefined`/省略，或恢复渲染 `AutoAnalyzeSwitch`，新增端到端与单测断言均应立即失败；恢复修复后全绿。
- **真实浏览器与视觉检查**：在隔离工作树演示/渲染页检查亮色、暗色双主题以及窄屏布局下，确认两个导入弹窗与 `+ 添加自定义标签` 折叠交互视觉正常、无残余开关或死样式。

## 旧标准变更

由于产品已按 Issue #369 移除 `AutoAnalyzeSwitch`、`import-dialog-prefs.js`（`omnimux_inspiration_auto_analyze`）与 `.omnimux-inspiration-switch*` 开关样式，相关既有单测断言需随设计变更移除或更新为新契约校验：

- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `auto-analyze localStorage preference`
  - 原断言：整个 `describe('auto-analyze localStorage preference')` 测试套件验证已删除模块 `import-dialog-prefs.js` 的存储读写与默认行为。
  - 必须改的理由：`import-dialog-prefs.js` 及其偏好开关已按需求整套移除，无该测试套件存在对象。
  - 新期望证据：`import-dialog-controls.test.js` 校验 `import-dialog-prefs.js` 已删除，且 `import-dialog-no-auto-analyze.e2e.test.js` 验证即便存在遗留 `localStorage` 值，弹窗仍恒传 `auto_analyze: false`。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `defaults to true when storage is empty`
  - 原断言：调用已退役 `readAutoAnalyzePreference()`，断言空存储返回 `true`。
  - 必须改的理由：`import-dialog-prefs.js` 随自动 AI 解析开关一并移除，不再持久化该开关偏好。
  - 新期望证据：删除该废弃开关偏好模块并在 `import-dialog-controls.test.js` 断言 `import-dialog-prefs.js` 已不存在，同时在 `import-dialog-no-auto-analyze.e2e.test.js` 验证弹窗提交恒传 `auto_analyze: false`。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `reads true / false from storage`
  - 原断言：读写 `AUTO_ANALYZE_STORAGE_KEY` 验证开关偏好回读。
  - 必须改的理由：开关及其本地存储偏好已从产品中移除。
  - 新期望证据：由 `import-dialog-no-auto-analyze.e2e.test.js` 验证即便存在遗留 `localStorage` 值，弹窗仍无开关且请求固定传 `auto_analyze: false`。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `treats "1" as true for legacy values`
  - 原断言：校验 `readAutoAnalyzePreference()` 对旧值 `"1"` 返回 `true`。
  - 必须改的理由：`readAutoAnalyzePreference` 与开关偏好逻辑已退役删除。
  - 新期望证据：`import-dialog-no-auto-analyze.e2e.test.js` 覆盖旧缓存键残留场景下不再触发自动解析。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `defaults to true when localStorage throws`
  - 原断言：校验 `localStorage` 抛错时 `readAutoAnalyzePreference` / `writeAutoAnalyzePreference` 降级行为。
  - 必须改的理由：偏好读写函数已随开关移除。
  - 新期望证据：`import-dialog-controls.test.js` 验证两个弹窗不再引用 `readAutoAnalyzePreference` 或 `omnimux_inspiration_auto_analyze`。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `ships role=switch track geometry matching accounts (36x20 + 16px knob)`
  - 原断言：检查 `INSPIRATION_CSS` 中 `.omnimux-inspiration-switch` 轨道与旋钮样式规则。
  - 必须改的理由：已移除该开关控件并清理 `.omnimux-inspiration-switch*` 死样式。
  - 新期望证据：`import-dialog-controls.test.js` 断言 `INSPIRATION_CSS` 不再保留 `.omnimux-inspiration-switch` 死样式，并继续守护 `.omnimux-inspiration-tags-toggle` 几何样式。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `inline dialog uses CollapsibleTagsField + AutoAnalyzeSwitch and no native checkbox`
  - 原断言：断言 `InspirationInlineImportDialog.jsx` 源码包含 `AutoAnalyzeSwitch` 与 `readAutoAnalyzePreference`。
  - 必须改的理由：需求要求移除 `AutoAnalyzeSwitch` 及其偏好状态。
  - 新期望证据：更新该用例为校验两个导入弹窗均仅保留 `CollapsibleTagsField`，不包含 `AutoAnalyzeSwitch`、`readAutoAnalyzePreference`、`omnimux_inspiration_auto_analyze` 与 `type="checkbox"`，且显式传 `auto_analyze: false`。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `AutoAnalyzeSwitch exposes role=switch and aria-checked`
  - 原断言：检查 `import-dialog-controls.jsx` 中 `AutoAnalyzeSwitch` 的 `role="switch"`、`aria-checked` 与 `writeAutoAnalyzePreference`。
  - 必须改的理由：`AutoAnalyzeSwitch` 组件已从 `import-dialog-controls.jsx` 移除。
  - 新期望证据：在 `import-dialog-controls.test.js` 断言 `import-dialog-controls.jsx` 不含 `AutoAnalyzeSwitch` 和 `role="switch"`，并在真实 DOM 渲染测试中验证弹窗内不存在 `[role="switch"]`。
- `plugins/plugins/omnimux-inspiration/src/client/import-dialog-controls.test.js` :: `persists preference under the required localStorage key`
  - 原断言：读取 `import-dialog-prefs.js` 验证 `omnimux_inspiration_auto_analyze` 键名与读写调用。
  - 必须改的理由：`import-dialog-prefs.js` 已随废弃功能整文件删除。
  - 新期望证据：`import-dialog-controls.test.js` 验证 `import-dialog-prefs.js` 已删除且无源码引用该存储键。
- `plugins/plugins/omnimux-inspiration/src/client/import-landing-render.test.js` :: `echoes the account, imports it as an account, and lands on the 账号监控 tab without a preview`
  - 原断言：通过 `querySelector('[aria-label="${L.autoAnalyze}"]')` 断言账号链接不渲染自动解析开关。
  - 必须改的理由：`add.autoAnalyze` 文案键随开关移除而删除，无法继续用 `zh['add.autoAnalyze']` 构造选择器。
  - 新期望证据：改用 `mounted.container.querySelector('[role="switch"]')` 断言为 `null`，覆盖任何自动解析开关都不会出现在导入弹窗中。

## 验收

- `corepack pnpm --dir plugins run build:all`
- `node scripts/bundle-lock.mjs --check && node scripts/workspace-check.mjs --check`
- `corepack pnpm --dir plugins --filter omnimux-inspiration test`
- `corepack pnpm --dir plugins run verify:dsw-tokens`
- `corepack pnpm --dir plugins run check:boundaries`
- `corepack pnpm --dir plugins run verify:stages`
- `corepack pnpm --dir plugins run verify:plugin-load`
- `node --test plugins/scripts/verify-anti-slop.test.mjs`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- 真实浏览器（`ego-browser`）对修改前后高保真演示与工作树构建弹窗产物进行亮/暗双主题及窄屏交互验收
