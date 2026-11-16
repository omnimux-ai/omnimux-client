# Spec: 发布为 AI 应用弹窗 UI 与交互美化

- 任务：`publish-modal-polish`
- 日期：2026-11-16
- 基线：`origin/main`
- 风险：R2（画布发布向导弹窗 UI、主题对比度与表单交互）

## 目标

修复现网「发布为 AI 应用」弹窗（`PublishWizardModalV2`）主按钮在深色宿主主题下白底白字不可见、次按钮无边界、原生 `<select>` 与暗色弹窗割裂、Step 2 暴露内部枚举等视觉与交互缺陷，同时保持极简、无冗余提示文案的界面风格。

## 范围

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/publish/PublishWizardModalV2.tsx`：
  - 使用 `.wf-publish-modal` 限定类名与结构化语义 class，替换内联 `var(--dsw-alias-state-business-primary)` + `#fff` 主按钮样式。
  - Header 内增加简洁 2 步胶囊进度条（`1 基础信息` / `2 确认发布`），支持在应用名称有效时直接切换步骤。
  - Step 1：应用名称带清空按钮与空值即时校验提示（支持 `Enter` 推进至下一步）；应用分类使用 3 选 1 分段图标胶囊（`视频` / `图片` / `音频`）；描述升级为紧凑多行文本框。
  - Step 2：以「应用输入」「预期输出」分组卡片展示自动推导结果，将内部 `widget` / `outputType` 映射为可读中文类型标签，底部显示应用摘要条与「整组已验证」状态指示。
  - Blocked 态：按阻断原因匹配对应状态图标（过期刷新 / 警示），保留「标题 + 一行原因 + 取消 / 去整组执行」极简结构。
  - 修复二次打开或切换分组时 `workflowName` / `step` / `nameTouched` 状态同步。
- `plugins/plugins/omnimux-workflow/src/canvas/theme/components.css`：
  - 仅追加 `.wf-publish-modal*` 作用域样式（不改动全局 `.wf-modal-card` / `.wf-modal-overlay`）。
  - 使用 DSH `--dsw-alias-*` 与 `--wb-*` token，确保深/浅双主题下主按钮（深色白底黑字 / 浅色黑底白字）、次按钮、输入框、分段控件对比度清晰。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/publish/publishWizardV2.test.mjs`：
  - 覆盖渲染结构、主按钮不依赖 `--dsw-alias-state-business-primary` + `#fff` 反色组合、CSS 作用域隔离、Step 1→2 交互与空名称校验、Blocked 态与可读输入输出标签。

## 验收标准

- 深色与浅色主题下，「下一步 / 发布 / 去整组执行」主按钮、「取消 / 上一步」次按钮文字清晰可读（无白底白字）。
- 仅修改 `.wf-publish-modal` 作用域样式，不破坏 `voicePickerTheme.test.mjs` 与既有弹窗样式契约。
- `PublishWizardModalV2` 在 Step 1 支持应用名必填校验、分类胶囊切换、Enter 下一步；Step 2 展示可读输入/输出标签与发布加载态；Blocked 态清晰展示状态图标、原因与操作按钮。
- `pnpm --filter omnimux-workflow typecheck`、`pnpm --filter omnimux-workflow test`、工作区与静态门禁全绿，且在 worktree 浏览器中完成真实渲染截图验收。

## 旧标准变更

无。仅新增 `publishWizardV2.test.mjs` 用例，不删除或改写既有测试断言。
