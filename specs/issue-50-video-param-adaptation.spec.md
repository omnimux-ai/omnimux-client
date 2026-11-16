# Spec: 视频节点模型切换参数适配（#50）

- 任务：`issue-50-video-param-adaptation`
- 日期：2026-11-17
- 基线：`10298055e0e342507f43b31e5ad3ac68d10f06fb`（origin/main）
- 风险：R2（视频节点参数读侧/执行侧/历史恢复；只动 `plugins/plugins/omnimux-workflow`）

## 目标

- 以「模型 + 当前 operation + 当前渠道线」的实时 capability 为唯一真源，统一归一化视频参数。
- 不兼容参数自动映射/回退并提示；必填无默认时阻断并给出设置入口；内容字段（prompt/正文/附件/槽位/链接）保留。
- 读侧 `resolveEffectiveVideoParams`、执行准备 `prepareExecutionSlotGraph`、历史恢复 `readVideoParameterSelections`、写回 `buildVideoParameterSelection` 使用同一 `normalizeVideoParamsForSchema`。
- `first_last_frame` + `9:16` 回退 `adaptive`；同模型 `text_to_video` 的 `9:16` 保留。
- 同模型渠道线切换也走统一归一化；历史 `parameterSelections` v1 不变，非法历史值丢弃并提示。
- 无 catalog/模型未就绪时不写假默认、不覆盖 params，显示「模型配置尚未就绪」并禁用生成。

## 范围

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamNormalization.ts`（新增）
- `.../videoParams/videoParamAdapter.ts`
- `.../videoParams/videoParameterSelection.ts`
- `.../ConfigPanel/index.tsx`
- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/prepareExecutionSlotGraph.ts`
- 相关测试与 `specs/issue-50-video-param-adaptation.spec.md`

## 状态机

```
idle → switching（模型/operation/渠道线变化或旧项目加载）
  → normalizing（model + operation + line capability）
      ├─ 合法：keep
      ├─ 可映射/有默认：adjust + 一次性提示
      ├─ 必填无默认：blocked + 设置 CTA，禁止生成
      └─ prompt/正文/附件/槽位/链接：preserve
  → ready / blocked → idle
```

## 验收标准

- [ ] AC-1 `minimax-h3-video` + `first_last_frame` + 旧 `9:16` → 展示与执行均为 `adaptive`，无 aspectRatio 错误，生成可用（其他必填满足）。
- [ ] AC-2 同模型 `text_to_video` + `9:16` 保留，不误降级。
- [ ] AC-3 模型 A→B / B→A：兼容参数保留，不兼容参数按目标 schema 回退并提示；duration/resolution/sound/seed 无旧模型残留；A 的合法历史可恢复。
- [ ] AC-4 同模型渠道线切换走统一归一化，不因 `channelSelection` 分支保留旧参数。
- [ ] AC-5 `prepareExecutionSlotGraph` 输出与 UI 展示一致；执行请求 payload 不携带目标 operation 不支持的 aspectRatio/duration/resolution。
- [ ] AC-6 旧项目 / 旧 `parameterSelections` 的非法值被修正或阻断并提示，不写入新模型历史。
- [ ] AC-7 必填无默认值阻断并显示明确设置入口，不偷偷选择第一个/高价选项。
- [ ] AC-8 至少 2 个模型 × 3 组参数（aspectRatio/duration/resolution）矩阵、first_last_frame adaptive、同模型渠道切换、读侧/执行侧一致性测试。
- [ ] AC-9 真实 Dev 画布 + 真实 `minimax-h3-video` 目录验证，截图 + DOM/请求证据；回退归一化/读侧/执行侧用例变红。

## 测试计划

- 单元：`normalizeVideoParamsForSchema` 合法保留、非法回退、必填阻断、空 catalog、幂等；`resolveEffectiveVideoParams` adaptive/9:16；`prepareExecutionSlotGraph` 请求 payload；`buildVideoParameterSelection` A→B→A、渠道切换、旧历史。
- 矩阵：`seedance-2-0` / `minimax-h3-video` × aspectRatio(16:9/9:16/adaptive) × duration(5/10/超范围) × resolution(720p/1080p/不支持)。
- 双向证伪：回退 `normalizeVideoParamsForSchema`、读侧调用、执行侧调用必须变红；恢复全绿。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.test.mjs` :: `saved unsupported values remain visible until the user decides`
  - 原断言：读侧直接保留 `bogus` / `99` / `8K`，等待用户确认。
  - 必须改的理由：#50 要求读侧按当前 operation capability 归一化，禁止旧值进入展示与执行。
  - 新期望证据：`normalizes unsupported saved values before display instead of keeping stale values` 断言 `16:9` / `10` / `1080P`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.test.mjs` :: `saved ratio is displayed unchanged and rejected until an editing transition corrects it`
  - 原断言：`first_frame` 的 `9:16` 原样显示并产生 aspectRatio 校验错误。
  - 必须改的理由：#50 要求 operation 级 `adaptive` 回退，不得把 operation 约束误报为模型不支持。
  - 新期望证据：`normalizes an adaptive-only operation before display and does not report a model-level error` 断言 `adaptive` 且无 aspectRatio 错误。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `R4: standby image cannot erase a single-operation duration schema or its validation`
  - 原断言：非法 `duration: 10` 保留并产生 duration 校验错误。
  - 必须改的理由：#50 要求执行准备/读侧按当前契约归一化，非法 duration 不得进入执行。
  - 新期望证据：`effective.duration === 5`，`validateVideoParamsForUi` 返回 `[]`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `actual model handler preserves routing-only parameters and transitions switches once`
  - 原断言：同模型渠道切换严禁调用 transition，参数原样保留。
  - 必须改的理由：#50 AC-4 明确同模型渠道线切换也必须走统一归一化。
  - 新期望证据：视频分支先匹配 `buildVideoParameterSelection`，非视频同模型分支仍保留原参数。
- `plugins/plugins/omnimux-workflow/src/workflow/agent-tools.test.mjs` :: `workflow_run blocks invalid model parameters even when operation is implicit`
  - 原断言：`workflow_run` 返回 `configuration_error` / `parameter_unsupported`。
  - 必须改的理由：#50 执行准备先归一化参数，非法 aspect/resolution 不应阻断。
  - 新期望证据：`execution preparation normalizes invalid model parameters before readiness` 断言 `16:9` / `720p` 且 readiness 通过。
- `plugins/plugins/omnimux-workflow/src/workflow/agent-tools.test.mjs` :: `workflow_run blocks stale explicit and invalid implicit operation contracts before mock submission`
  - 原断言：stale operation 与 implicit duration 均返回 `configuration_error` 且不提交。
  - 必须改的理由：#50 要求不存在 operation 回退 `text_to_video`/首个 operation，非法控制值归一化。
  - 新期望证据：`execution preparation normalizes stale explicit and invalid implicit operations` 断言 operation `video_edit`、duration `-1`、readiness 通过。
- `plugins/plugins/omnimux-workflow/src/workflow/agent-tools.test.mjs` :: `workflow_run requires an explicit video mode when multiple modes are effective`
  - 原断言：多 effective operation 且未指定 mode 时返回 `configuration_error`。
  - 必须改的理由：#50 规定 operation 缺失时回退 `text_to_video` / 首个 ready operation / 首个 operation。
  - 新期望证据：`execution preparation falls back to text_to_video for an unset multi-operation mode` 断言 `text_to_video` 且 readiness 通过。
- `plugins/plugins/omnimux-workflow/src/workflow/execution-routes.test.mjs` :: `execution API keeps an invalid user parameter but rejects it before mock submission`
  - 原断言：400 `parameter_unsupported`，无 gateway 请求。
  - 必须改的理由：#50 执行 API 与 UI 共用归一化，非法 aspect/resolution 应被归一化后提交。
  - 新期望证据：`execution API normalizes an invalid user parameter before mock submission` 断言 200、请求 `aspectRatio: 16:9` / `resolution: 720p`。
- `plugins/plugins/omnimux-workflow/src/workflow/execution-routes.test.mjs` :: `execution API blocks stale explicit and invalid implicit operations before mock submission`
  - 原断言：stale/implicit operation 返回 400 且无请求。
  - 必须改的理由：#50 operation 回退与参数归一化适用于执行 API。
  - 新期望证据：`execution API normalizes stale explicit and invalid implicit operations before mock submission` 断言 200、请求 operation `video_edit`、duration `-1`。
- `plugins/plugins/omnimux-workflow/src/workflow/execution-routes.test.mjs` :: `execution API requires an explicit video mode when multiple modes are effective`
  - 原断言：多 operation 未指定 mode 返回 400。
  - 必须改的理由：#50 缺失 operation 走 `text_to_video`/首个 operation 回退。
  - 新期望证据：`execution API falls back to text_to_video when multiple modes are effective without an explicit mode` 断言 200、请求 operation `text_to_video`。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/feedSlotSubmission.test.mjs` :: `prepareExecutionSlotGraph preserves invalid fixed ratio for adaptive-only mode until UI corrects it (#1785)`
  - 原断言：model-level 无参数、operation-level 仅 `aspectRatio: adaptive` 时执行准备保留 `9:16`，并断言 readiness/提交报 `parameter_unsupported`。
  - 必须改的理由：AC-5 要求执行准备对真实 gateway catalog 始终按有效 operation schema（model + operation + 渠道线）归一化；model-level 为空不能跳过 operation-level 约束。
  - 新期望证据：`prepareExecutionSlotGraph normalizes an operation-level-only invalid ratio before execution` 断言执行准备与真实提交请求均为 `adaptive`、readiness 通过；另新增 model-level 空 + operation-level-only 的 duration/resolution 用例。
