# Spec: 视频生成节点读取上游 JSON 参数文件（Issue #27）

- 任务：`issue-27-json-input`
- 日期：2026-11-15
- 风险：R2（画布输入契约 + 跨层类型扩展）
- 关联：omnimux-ai/omnimux-client#27

## 目标
让画布视频生成节点接收上游 JSON 文件：JSON 作为 `document` 素材导入/显示/移除，按约定读取 `prompt` 与 `duration`，空或无效 JSON 明确报错并阻断生成；原有文本、图片、视频输入不回归。

## 范围
- 数据导入：`.json` 识别为 `document`（`application/json`），允许本地上传/资产导入/画布导入。
- 读取链路：`readNodeInputSource` / `useUpstreamMedia` 输出 JSON 原始文本、解析后的提示词、文件名/MIME/来源。
- 展示链路：视频节点输入区展示 JSON 文件卡（文件名、JSON 类型、来源、移除）；JSON 文件节点展示文件卡。
- 执行链路：JSON prompt 进入上游 prompt 指纹；`duration` 在模型声明 duration 参数时作为执行参数覆盖。
- 错误状态：空、语法错误、顶层非对象、字段类型错误、无可用字段均有明确提示并阻断生成。
- 不包含：`document_to_video.file_url` 远程文档 URL 链路（另立 issue）。

## 验收（AC）
- 上游接入 JSON 文件 → 视频生成节点输入区出现文件项（文件名/JSON/来源，可移除）。
- JSON `prompt` 被读取为生成提示词；`duration` 在模型支持时生效，其他字段提示已忽略。
- 断开上游或移除文件项后输入同步消失。
- 空/无效 JSON 给出明确错误并禁用生成。
- 既有 text / image / video 输入回归正常。

## 测试
- `src/shared/jsonDocument.test.mjs`：字段约定、空/无效/类型错误。
- `src/shared/jsonDocumentInput.test.mjs`：指纹/模型兼容/执行准入/时长覆盖。
- `src/workflow/execution/jsonDocumentExecution.test.mjs`：import 执行器 document 透传、dispatch readiness、移除后 prompt/duration 不泄漏。
- `src/shared/localMedia.test.mjs`、`src/shared/graph/nodeInputSource.test.mjs`：JSON 导入与读取。
- `src/shared/validation/compatKernel.test.mjs`：document prompt 不进入媒体硬门槛，仅 document 槽吸收。
- `src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs`：文件卡、无效 JSON 阻断。
- `src/canvas/editor/utils/connectionValidator.test.mjs`、`resourcePickerPolicy.test.mjs`：连接与导入计划。

## 旧标准变更
无。仅新增类型能力与新增回归用例，不删除或改写既有标准断言。

## 边界
worktree 开发，只改 `plugins/` 与 `specs/`；不合并、不碰 Dev/Prod；公开仓红线；i18n 走仓库字典与 lint。
