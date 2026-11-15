# Spec: document_to_video 的 file_url 远程文档槽 UI（Issue #30）

- 任务：`issue-30-file-url-ui`
- 日期：2026-11-15
- 风险：R2（画布视频参数面板 / 文档 URL 解析与校验）
- 关联：omnimux-ai/omnimux-client#30

## 目标
`document_to_video` 的 `file_url` 远程文档槽在参数面板内提供完整文档项展示：有效文档 URL 显示文件名（从 URL 推导）、类型（扩展名与 MIME）、来源 host，并可移除；空 URL、非法扩展名、已知 MIME 但不在当前 operation `allowedMimes` 时在参数面板内联报错并阻止生成。

## 范围
- `videoParamAdapter.ts`：暴露官方 12 项文档 MIME 映射与 `inspectDocumentUrl`，统一生成文档项信息与校验错误；`validateVideoParamsForUi` 复用该检查。
- `VideoParamPopover.tsx`：`file_url` 分区渲染文档项（复用 `wf-document-input` 卡片）与内联错误；`link_url` 保持原有纯输入。
- `components.css`：补 `wf-video-param-popover__document`（全宽）与 `wf-video-param-popover__error` 样式。
- 不包含：`videoParamAdapter.ts` 的 MIME 表新增/删除、`video-models.yaml` 契约修改、`application/json` 支持、#27 上游 JSON 文件链路修改。

## 验收（AC）
- 官方 `file_url` 支持 12 种格式：docx / doc / xlsx / xls / pptx / ppt / pdf / txt / key / pages / numbers / md；映射完整，不含 `application/json`。
- 输入有效文档 URL 后显示文档项：文件名、类型（扩展名 + MIME）、来源 host，可移除。
- 空 URL、非 http(s)、未知扩展名、已知 MIME 不在 `allowedMimes` 时在参数面板内联报错，生成按钮禁用。
- `link_url`（网页参考）保持原样；#27 上游 JSON 文件卡与文本/图片输入不回归。

## 测试
- `src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/documentUrlInspection.test.mjs`：12 项完整性与 JSON 排除、URL 文件名/类型/host 推导、空/非 http/未知扩展/MIME 不允许错误。
- `src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.test.mjs`：`validateVideoParamsForUi` 复用新校验文案（空 URL / 非法扩展）。
- `src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/VideoParamPopover.document.test.mjs`：真实立面渲染文档项、移除回调、三类错误、`link_url` 回归。
- `VideoParamPopover.test.mjs`：新样式类名覆盖。

## 旧标准变更
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.test.mjs` :: `blocks a document extension outside the contract MIME list`
  - 原断言：未知扩展 `.zip` → `['文档格式不在当前模型支持列表']`。
  - 必须改的理由：Issue #30 要求参数面板内联区分未知扩展与模型 `allowedMimes` 不允许的 MIME；旧文案合并了两种场景，无法支持新 UI 的明确错误提示。
  - 新期望证据：未知扩展 → `['不支持该文档格式：支持 docx、doc、xlsx、xls、pptx、ppt、pdf、txt、key、pages、numbers、md']`；已知 MIME 但不在 `allowedMimes` 的用例在新增 `documentUrlInspection.test.mjs` / `VideoParamPopover.document.test.mjs` 覆盖。
- 其余仅新增用例；既有 `VideoParamPopover.unset.test.mjs` 的 esbuild stub 补 `lucide-react` 替换，不改断言。

## 边界
worktree 开发，只改 `plugins/plugins/omnimux-workflow` 画布参数面板/文档 URL 解析/样式与测试 + `specs/`；不合并、不碰 Dev/Prod；公开仓红线；i18n 走仓库既有硬编码中文约定。
