# Spec: 工作流发布为 AI 应用（最小闭环）

- 任务：`ai-app-publish-minimal`
- 日期：2026-11-15
- 基线：`origin/main`
- 风险：R2（跨前后端/执行链路）

## 目标

把选中的 Template Group 作为发布作用域，打通「分组整组执行 → 发布为 AI 应用 → 应用表单输入 → 整组重新执行 → 指定输出」的最小闭环。

MVP 场景：

- 节点 A：文本节点，内容为 TikTok 链接，作为根节点自动成为应用输入。
- 节点 B：视频节点，`outputCapabilityId: 'video-extraction'`，消费 A 的文本链接，产出视频。
- A → B 同属一个 Template Group。
- 整组执行成功后发布；发布不选择输入/输出节点，系统自动识别 A 的链接输入和 B 的视频输出。
- App Tab 只显示「TikTok 视频链接」表单，提交后重新执行整组，返回新链接对应的视频。

## 用户操作旅程与期望反馈

1. 用户把 A、B 放进同一个模板分组，点击「整组执行」。
2. A 读取链接，B 通过视频提取 capability 产出视频；两个节点均 `completed`。
3. 点击「发布应用」：
   - 未跑通：阻断并提示「当前没有跑通，所以不能发布 AI 应用」；
   - 已跑通：进入精简发布信息页，自动显示 A 链接输入、B 视频输出，不需要选择输入/输出节点。
4. 发布成功后打开 App Tab：只有必要表单字段，没有生成模型选择器。
5. 输入另一条 TikTok 链接并点击生成，应用重新执行整组，返回新链接对应的视频。
6. 修改节点能力、参数或连线后再次发布，验证失效，必须重新整组执行。

## 技术范围

### Workflow capability

- `plugins/plugins/omnimux-workflow/src/shared/specs/contracts.ts`：`ToolSpec` 增加 `executorKey?`。
- `plugins/plugins/omnimux-workflow/src/shared/specs/nodes/materialNodeSpec.ts`：新增 `video-extraction` 工具（materialType `video`、outputType `video`、acceptedInputTypes `['text']`、executorKey `capability:video-extraction`）。
- `plugins/plugins/omnimux-workflow/src/shared/graph/materialNode.ts`：`MaterialNodeData.outputCapabilityId`、`capabilityInputs` 字段与 `resolveNodeOutputType`。
- `plugins/plugins/omnimux-workflow/src/shared/graph/connectionConfig.ts`、`nodeInputSource.ts`：按 capability output type 计算节点输出/feed type。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/videoExtractionExecutor.ts`：新增 executor，复用 `workflow/videoExtraction/service.ts`。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/ExecutionManager.ts`：注册 executor；注入 workspace store / seams。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/planVideoExtractionDownstream.ts`：创建动态 `video-extraction` 输出节点；保留作者态预览；修复 parentId/group data。

### 发布分析

- 新 `plugins/plugins/omnimux-workflow/src/canvas/editor/components/publish/publishPlanAnalyzer.ts`：
  - 按组内弱连通分量识别 workflow；
  - 根节点自动生成 `PublishInput`；
  - 终端节点按 `resolveNodeOutputType` 生成 `PublishOutput`；
  - 计算稳定 `graphHash` / `planHash`；
  - MVP 多个 workflow / 无输入 / 无输出分别返回错误。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/publish/publishTypes.ts`：新增 `PublishPlan`、`PublishWorkflow`、`PublishInput`、`PublishOutput`、`PublishVerification`，manifest schemaVersion 1.1。
- 新 `PublishWizardModalV2.tsx`（CanvasEditor 使用）：两步精简 UI；不显示输入/输出选择；分类独立；发布前读取 group verification；旧 `PublishWizardModal.tsx` 保留仅作回归对照。

### 整组执行验证

- `GroupNodeData.publishVerification` 新增（`shared/canvasTypes.ts`）。
- `StartExecutionPayload` 增加 `groupId`、`graphHash`（`shared/api.ts`、`executionRoutes.ts`）。
- `ExecutionManager` / persisted record / snapshot 透传 `request` 元数据。
- `useExecutionController` 增加 terminal 回调；`App.tsx` 在整组执行结束后把 verification 写回 group node data。

### App 运行

- `HeadlessExecutionSeam` 消费 `publishPlan.inputs`，把表单值写回节点 `content` / `mediaUrl` / `capabilityInputs`。
- 新 `workflow/routes/appRoutes.ts`：`POST /omnimux-workflow/api/apps/executions` fallback，使用 manifest snapshot + publishPlan 执行整组。
- `AppTab.jsx`：优先 `__OMNIMUX_APPS_EXECUTE__`，否则调用 fallback route；按 `publishPlan.outputs` 取节点产物，不再取 `artifacts[0]`。
- `appTabWidgets.js`：capability 节点不显示生成模型选择器。

### UI 精简

- 删除发布向导中的解释性 hint、rationale、链路图、长摘要、非必要 badge。
- 发布向导只保留：应用名、分类下拉、字段标题/必填、输出摘要、发布按钮。
- 阻断弹窗只保留：标题「当前没有跑通，所以不能发布 AI 应用」、一行原因、两个操作按钮。
- 节点输出方式控件只显示当前值和一个下拉，不显示说明文字。
- App Tab 只保留必要字段标签、输入控件与生成按钮。

## 验收标准

- 纯函数 `analyzeGroupPublishPlan` 对 A→B 场景返回 1 个 workflow、1 个输入、1 个视频输出。
- `video-extraction` executor 从 A 的文本链接生成视频 artifact；失败错误不被吞。
- `HeadlessExecutionSeam` 应用 `publishPlan.inputs` 后正确执行；`nodeStates` 与 `nodeOutputs` 包含 B 视频。
- 未跑通、执行失败、验证过期、模拟结果均不能发布。
- App Tab 表单只有一个 TikTok 链接字段；输入另一条链接后输出对应视频。
- 旧 manifest 仍可读取，旧流程不回归。
- 运行 `corepack pnpm --filter omnimux-workflow typecheck`、`corepack pnpm --filter omnimux-workflow test`、相关浏览器验收。

## 假设

- MVP 只支持单 workflow；多 workflow 检测后阻断，P1 再做表单分组和并发结果。
- 应用分类是独立筛选元数据，不影响输出。
- 当前仓库无 `omnimux-apps` 插件源码；MVP 使用 workflow 内的 app execution fallback route，生产已有宿主时保留 `__OMNIMUX_APPS_EXECUTE__` 优先。
- 前端产品代码修改前先交付精简版 HTML 演示并取得确认。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/planVideoExtractionDownstream.test.mjs` :: `planVideoExtractionDownstream: 首次提取创建下游视频节点与连线`
  - 原断言：`nodeKind === 'import'`、`selectedTool === 'import'`、`realPath === videoResult.videoPath`。
  - 必须改的理由：视频提取下游节点由静态 `import` 占位升级为动态 `video-extraction` capability 节点，支持工作流重跑与 AI 应用发布，且不再持久化本地 `realPath`。
  - 新期望证据：`nodeKind === 'generate'`、`selectedTool === 'video-extraction'`、`outputCapabilityId === 'video-extraction'`、`mediaUrl === videoResult.mediaUrl`、`previewUrl === videoResult.previewUrl`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/planVideoExtractionDownstream.test.mjs` :: `planVideoExtractionDownstream: 再次提取时就地更新已有关联视频节点，不创建冗余节点`
  - 原断言：校验 `patch.data.realPath === updatedVideoResult.videoPath`。
  - 必须改的理由：同上，再次提取更新 `mediaUrl` 与 `outputCapabilityId: 'video-extraction'`，不再写入 `realPath`。
  - 新期望证据：校验 `patch.data.mediaUrl === updatedVideoResult.mediaUrl` 与 `patch.data.outputCapabilityId === 'video-extraction'`。
- `plugins/plugins/omnimux-workflow/src/shared/specs/nodeSpecRegistry.test.mjs` :: `Test 1: NodeSpecRegistry contains all built-in node specifications`
  - 原断言：`Object.keys(materialSpec.tools).length === 16`。
  - 必须改的理由：新增内置 `video-extraction` 能力工具，内置工具总数由 16 增至 17。
  - 新期望证据：`Object.keys(materialSpec.tools).length === 17`。
- `plugins/plugins/omnimux-workflow/src/shared/specs/nodeSpecRegistry.test.mjs` :: `Test 2: MATERIAL_TOOL_INPUT_TYPES is 100% equivalent to legacy behavior across all 16 tools`
  - 原断言：用例标题及 `expectedToolInputs` 覆盖 16 个工具。
  - 必须改的理由：内置工具新增 `video-extraction`（`acceptedInputTypes: ['text']`），矩阵校验同步覆盖全部 17 个工具及 `MATERIAL_TOOLS.video`。
  - 新期望证据：17 个工具全部通过映射与 `MATERIAL_TOOLS.video` 断言。
