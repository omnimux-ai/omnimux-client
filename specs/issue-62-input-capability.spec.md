# Spec: 视频节点上游输入自动适配（#62 / Epic #63）

- 任务：`issue-62-input-capability`
- 日期：2026-11-17
- 基线：`c81e70e3d5b5f9467cf9b47020008fb7bd6c6e98`（origin/main）
- 风险：R2（视频节点 UI / 连线校验 / 执行准备；只动 `plugins/plugins/omnimux-workflow`）
- 上游真源：Epic #63；PRD `.tmp/epic-input-capability/PRD.md`（§0.1 文案审计、R1–R10、四类矩阵）

## 目标

- 新增 `shared/validation/inputCapability.ts` 纯函数，作为「上游输入 → 可用 operation / 自动选中 / 参数投影 / blocked」的唯一判定：
  - R1 可消费：operation 有匹配已连媒体类型的 input slot。
  - R2 可用：所有 required 媒体槽位满足；R2b 媒体主输入满足。视频首案（返工后）不再要求「所有已连媒体被消费」——容量/格式/类型不匹配的候选供给属于赋值关注点，留在图上但不阻断生成（见「返工切片」）。
  - R2b 语义表：`image_to_image` / `multi_reference` 需 ≥1 image；`video_multi_ref` 需 ≥1 媒体；`voice_clone` / `emotion_control` 需 ≥1 audio；`chat` 豁免。表只按 operation id，不按模型/品牌。
  - R3 自动切换：当前 operation 可用则保留；否则按 required 媒体槽位数降序 → 媒体槽位总数降序 → 目录顺序 → id 选；无媒体回 family 默认（视频 `text_to_video`）。
  - R5 连线校验（返工后）：普通拖线与共享 `applyCanvasInputMutation` 只做结构校验，不再因模型类型产生 `model_incompatible`；供给边保留在图上。能力判定侧（视频）把「该模型任何 listed operation 都没有对应媒体槽位」的媒体类型排除出评分（如 Muse 上的音频），其余不可入槽的已连媒体按候选处理，不参与生成阻断。
  - R6 断开恢复：摘要重算，无媒体回默认 operation。
  - R7 参数投影：丢弃目标 operation 不存在的控制/媒体 URL 语义，再交 #55 `normalizeVideoParamsForSchema` 做值归一化。
  - R10 模型选择（返工后）：只有真实不可执行（`executable === false`）的模型才灰态；候选边/未入槽媒体不再让原本可选的模型（如 Muse）变 disabled，模型菜单与 `applyCanvasInputMutation` 的 `validateModelPatches` 口径一致。
- 视频节点 UI：`ConfigPanel` 使用 `inputCapability` 决定选中 operation；`OperationSegment` 对不可用 operation 逐项 `disabled`（灰态无 title）；`text_to_video` 等不可用项保留在 DOM 但不可点击。
- 执行侧：`prepareExecutionSlotGraph` 先 `inputCapability` 定 operation → `paramsProjection` → #55 归一化；`executionReadiness` 同样用 `inputCapability`；payload operation 与 UI 一致，未消费媒体不进入 payload。
- 文案：不新增任何面向用户的解释性字符串；删除 `wf-input-unused` chip、`wf-model-adaptation` hint、`wf-model-unsupported` 说明块；保留 `wf-channel-healing-notes`、`panel.reason.*`、`wf-video-validation-errors`；保留 `aria-label="生成方式"` 等 a11y 名称。

## 范围

- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.ts`（新增）
- `.../shared/validation/operationUi.ts`（`disabled` / `inputIncompatible` / R10 filtered model list）
- `.../shared/validation/executionReadiness.ts`（执行 readiness 使用同一 capability）
- `.../shared/graph/feedSlot/prepareExecutionSlotGraph.ts`（执行准备）
- `.../shared/graph/feedSlot/resolveSlotOperation.ts`
- `.../shared/graph/canvasSlotRecompute.ts`
- `.../shared/graph/canvasInputMutationGateway.ts`
- `.../canvas/editor/utils/connectionValidator.ts`
- `.../canvas/editor/components/MaterialNode/ConfigPanel/index.tsx`
- `.../ConfigPanel/videoParams/SegmentControls.tsx`、`videoParamAdapter.ts`、`videoParameterSelection.ts`、`types.ts`
- `.../ConfigPanel/cfg/CfgChoiceTile.tsx`、`ModelCascadeMenu.tsx`、`modelPickerCandidates.ts`
- `.../canvas/theme/components.css`
- 对应测试、`plugins/scripts/input-capability.test.mjs`、`plugins/scripts/governance-manifest.json`、`.github/workflows/quality-gate.yml`、本 spec

## 状态机（视频）

```
上游媒体变化（连接/断开/待命）
  → inputCapability 重算
      ├─ 当前 operation 可用：保持，参数按当前 schema 归一化
      ├─ 有可用候选：自动选中（保留历史/默认值），参数投影 → #55
      ├─ 无可用候选：全灰 + 生成禁用（无新增文案）
      └─ 目标模型无该媒体类型槽位：连线拒绝（edge.reject.modelIncompatible）
```

## 验收标准

- [ ] AC-1：视频节点连 1 图 → operation `first_frame`，`text_to_video` 灰态，参数 `adaptive`，无 chip/提示文案。
- [ ] AC-2：断开图片 → 回 `text_to_video`。若连接前已有合法历史值 `9:16 · 5s`，断开后恢复 `9:16 · 5s`；无历史时按真实模型 catalog 的 `text_to_video` 默认（`muse-video` = `16:9`、`seedance-2-5` = `adaptive`，时长默认 `5s`），不得为验收强行写死 `9:16`；`DEFAULT_ASPECT_RATIO = 16:9` 仅作为 schema 缺失时的兜底，不得覆盖模型自己的 `defaultValue`。无提示文案。
- [ ] AC-3：`seedance-2-5` 2 图 → `first_last_frame`；再连视频 → `video_multi_ref`；断开视频 → 回 `first_last_frame`。
- [ ] AC-4：执行侧与 UI 一致：`first_frame` 请求体携带绑定图片，不含未消费媒体；`text_to_video` 请求体不携带图片。
- [ ] AC-5：文案审计：`git diff` 无新增面向用户的解释性字符串；`wf-input-unused` 及其文案不再渲染；`aria-label`/控件名保留。
- [ ] AC-6：双向证伪——回退自动切换 → 用例红；回退灰态 → 用例红；回退参数投影 → 用例红；恢复全绿。
- [ ] AC-7：真实 Dev 画布验收（截图 + DOM + 请求 payload），不创建真实付费任务。

## 返工切片（2026-11-18，视频首案）

原实现把「上游供给 = 生成输入」当成硬约束：模型类型不匹配直接拒绝连线/变更，未入槽媒体并入能力判定并阻断生成，模型菜单因候选边灰态。真实画布 A/B 暴露 Muse 两张 ready 图 + prompt 无法提交。返工改为复用 #88 的候选/已入槽规则，不新增按模型/场景的分散特判。

- `shared/validation/compatKernel.ts`：`matchOperationInputs(op, fingerprint, { ignoreUnused })`；默认保持严格，`ignoreUnused` 只忽略 `slot_capacity` / `mime_unsupported` / `size_exceeded` / `duration_exceeded`，`role_conflict` / `operation_incompatible` 仍拒绝。
- `shared/validation/inputCapability.ts`：视频能力判定启用 `ignoreUnused`；视频模型任何 listed operation 都不消费的媒体类型（如 Muse 音频）不进入评分；其他输出类型保持原严格矩阵。
- `canvas/editor/utils/connectionValidator.ts`、`shared/graph/canvasInputMutationGateway.ts`：删除模型媒体类型的 `model_incompatible` 拒绝，只保留结构校验。
- `ConfigPanel/index.tsx`：`videoDisplayUpstreams = consumedUpstreams`（不再把 `inputDisplay.unused` 并回能力输入）；`buildFilteredModelOptions` 用 `consumedFingerprint`；`strictVerdict` 参数校验改用 `videoEffectiveParams`。

不做：完整全节点迁移、#88 严格槽位选择器（MIME/声明扩展名/剩余名额/本地导入）。

A/B（真实 CanvasEditor + 真实 bundled catalog 投影 + 实际 `prepareExecutionSlotGraph → nodeExecutors → materialGatewayExecutor → resolveCanvasSubmission` + 实际 `POST /omnimux-workflow/api/workspaces/:id/executions`，本地 mock gateway，0 付费任务）：

| 场景 | 新 main `b2c18ee` | 返工 head |
| --- | --- | --- |
| Muse 两图 + prompt | 200，仅首帧，但渲染「图片 · 卡槽已满，不会被使用」 | 200，仅首帧（`img-a`），无 unused 卡 |
| Muse 空图 | `text_to_video`，`16:9` | `text_to_video`，`16:9` |
| Muse 旧音频边 | 200 首帧，但渲染「音频 · 当前生成方式不支持该素材」 | 200 首帧，音频边保留、无 unused、无阻断 |
| Muse 音频候选 | 拖线放行 + unused 文案 | 拖线放行，无 unused，模型菜单 Muse 不 disabled |
| 切 Seedance `video_multi_ref` 再切回 | 回 Muse 后带 unused 文案 | 回 Muse 首帧可用、无 unused |
| Seedance 两图 | `video_multi_ref`，仅 `img-a` 入 payload | `first_last_frame`，`img-a`→首帧、`img-b`→尾帧 |
| 同图两槽 | `first_last_frame` 缺尾帧 → 400 `min_unsatisfied` | 同左（真实阻断，不是候选阻断） |

门禁（返工 head 本地实跑）：`omnimux-workflow` test 3376/3376、typecheck、build；`build:all` 11/11；`check:boundaries` 4242；`verify:stages` PASS 9；`verify:plugin-load` 13/13；`verify:product-baseline` pass；`plugins/scripts/input-capability.test.mjs` 33/33；workspace-check / bundle-lock OK；`git diff --check` OK。证据目录 `.tmp/pr64-ab-verify/{main-b2c18ee,rework-final}/`（ui.json / exec.json / host.json / scene-*.png）。

## 测试计划

- 纯函数：`src/shared/validation/inputCapability.test.mjs` — 真实 16 模型 catalog（`buildModelCatalog` + `projectCanvasCatalog`）的视频/图片/音频/文本矩阵、R2b、R3 排序与 explicit preference、R6、R7 投影、fail-closed。
- 视频集成：`src/canvas/editor/components/MaterialNode/ConfigPanel/inputCapabilityVideo.integration.test.mjs` — `resolveEffectiveVideoParams` 的自动选中/灰态/参数投影，`OperationSegment` 灰态 DOM（无 title、保留 aria-label）。
- 执行 payload：`src/shared/graph/feedSlot/inputCapabilityExecution.test.mjs` — `prepareExecutionSlotGraph` + `materialGatewayExecutor` 实际请求体：1 图 `first_frame`、2 图 `first_last_frame`、断开回 `text_to_video`、待命媒体不进 payload。
- 回归修复：`inputCapability.test.mjs` / `inputCapabilityExecution.test.mjs` 覆盖 `autoOperationId` 与显式选择的区分；`videoParameterSelection.test.mjs` 覆盖无 operation legacy 参数保留。
- 仓库级 runner：`plugins/scripts/input-capability.test.mjs`（governance `manual` + quality-gate `node --test`）。

## 双向证伪

- F1 回退「输入推导模式」：恢复存量 `params.operation` 优先（不按媒体可用性切换）→ 连 1 图/连 2 图用例红；恢复绿。
- F2 回退「逐项 disabled」：`OperationSegment` 不再映射 `op.disabled` → 不可选态 DOM 用例红；恢复绿。
- F3 回退「参数投影」：不执行 `paramsProjection` 直接把旧 params 交给 #55 → 切换后参数残留用例红；恢复绿。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `automatic model adaptation is a status message, not an error`
  - 原断言：渲染 `wf-model-adaptation` 状态提示。
  - 必须改的理由：Epic #63 §0.1 删除该解释性 hint，适配只由选中态/灰态表达。
  - 新期望证据：DOM 不含 `wf-model-adaptation` 与旧提示文案。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `actual model handler preserves routing-only parameters and transitions switches once`
  - 原断言：`handleModelChange` 的 candidate 门禁只检查 `executable === false`。
  - 必须改的理由：Epic #63 R10 增加 `inputIncompatible` 灰态模型，处理器必须拒绝选中。
  - 新期望证据：静态门禁同时匹配 `candidate.inputIncompatible === true`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/operationUi.dom.test.mjs` :: `ConfigPanel 消费 buildFilteredModelOptions / buildEffectiveOpsUiState（唯一判定）`
  - 原断言：`disabled: false`（Hide, Don't Grey）。
  - 必须改的理由：R10 要求媒体不兼容模型灰态，`inputIncompatible` 进入筛选结果。
  - 新期望证据：断言 `inputIncompatible` 与 `includeInputIncompatible: materialType === 'video'`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/operationUi.dom.test.mjs` :: `manual selection remembers the model and reports failed persistence`
  - 原断言：源码必须含 `nodeCompat?.adaptation` 与 `wf-model-adaptation`。
  - 必须改的理由：§0.1 删除该 hint。
  - 新期望证据：源码不含 `wf-model-adaptation`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/operationUi.dom.test.mjs` :: `#4103 AC7 不可执行型号：生成禁用 + 中性提示 + 一键切换`
  - 原断言：必须存在 `wf-model-unsupported` 与 `wf-model-unsupported-switch`。
  - 必须改的理由：§0.1 删除说明块和切换按钮，历史数据只复用既有阻断。
  - 新期望证据：源码不含 `wf-model-unsupported` / `panel.modelUnsupportedSwitch`，保留 `selectedModelUnsupported` 门禁。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.test.mjs` :: `canonical operation remains selected when effective`
  - 原断言：无媒体时 `first_last_frame` 仍选中。
  - 必须改的理由：R2/R6 无媒体回 `text_to_video`，`first_last_frame` 缺首尾帧不可用。
  - 新期望证据：`result.operation === 'text_to_video'`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamNormalization.test.mjs` :: `resolveEffectiveVideoParams and prepareExecutionSlotGraph produce the same normalized params`
  - 原测试无媒体但使用 `first_last_frame`；R2/R6 后该模式不可用。
  - 新期望证据：测试改为传入 2 张图片，仍断言原来的参数归一化/读侧执行侧一致性。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParameterSelection.test.mjs` :: `unknown explicit mode remains invalid rather than fabricating support`
  - 原断言：未知 operation 保持无效。
  - 必须改的理由：R3 当前 operation 不可用自动回退到可用默认。
  - 新期望证据：`params.operation === 'text_to_video'`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `video raw supply keeps modes discoverable while the selected first-frame gate consumes one image`
  - 原断言：2 张 raw 图片仍选 `first_frame` 且只消费 1 张。
  - 必须改的理由：R2/R3 2 图选 `first_last_frame`。
  - 新期望证据：测试改为 1 张图片，保留原断言。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `R4: standby image cannot erase a single-operation duration schema or its validation`
  - 原断言：源码字符串必须为 `upstreams: consumedUpstreams.filter(...)`，即能力判定只读已消费槽位。
  - 必须改的理由：历史非法边未落槽（如 audio → seedance）时也必须参与 R2/R4，否则未消费媒体被丢弃、不可用 operation 仍显示可选。
  - 新期望证据（返工后覆盖）：源码恢复 `upstreams: consumedUpstreams.filter(...)`；`videoDisplayUpstreams` 仅等于已消费槽位，未入槽候选不参与 R2/R4，standby 仍排除。

- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/slotEngine.test.mjs` :: `连线校验解耦：从图片节点拉线到图片节点（即使槽位已满或纯文生图），连线永远 valid: true`
  - 原断言：纯文生图模型接收图片也 `valid: true`。
  - 必须改的理由：R5 目标模型无任何 operation 能消费该媒体类型 → 拒绝。
  - 新期望证据（返工后覆盖）：场景 B 恢复 `valid: true`、`reasonCode: undefined`；普通拖线只做结构校验，容量满同样 `valid: true`。测试名同步为「槽位满与纯文生图模型的图片供给都保持 valid」。
- `plugins/plugins/omnimux-workflow/src/shared/generationPolicy.hub.test.mjs` :: `same-model valid operation recommendations initialize new nodes while invalid recommendations are removed (#3312)`
  - 原断言：新视频节点按目录推荐 `video_multi_ref`。
  - 必须改的理由：R6 无媒体视频默认 `text_to_video`；`video_multi_ref` 无媒体不可用。
  - 新期望证据：视频期望 `text_to_video`，其他模态仍按目录推荐。
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasInputMutationGateway.compat.test.mjs` :: `new image supply cannot switch prompt-only model or operation`
  - 原断言：图片连接到纯文生图模型 allowed 且忽略。
  - 必须改的理由：R5 拒绝无图片槽位模型。
  - 新期望证据（返工后覆盖）：`plan.status = 'allowed'`、边保留（`plan.edges.length === 1`）、`slotBindings = {}`；测试名同步为「kept as unused」。
- `plugins/plugins/omnimux-workflow/src/shared/validation/executionReadiness.test.mjs` :: `stale explicit operation blocks readiness instead of falling through to the gateway`
  - 原断言：stale operation 阻断。
  - 必须改的理由：R3/R6 当前 operation 不可用时自动切换到可用候选。
  - 新期望证据：`findExecutionReadinessFailure(...) = null`。
- `plugins/plugins/omnimux-workflow/src/shared/validation/executionReadiness.test.mjs` :: `multiple effective video operations require a persisted selection`
  - 原断言：多 operation 无 saved operation 返回「请选择生成方式」。
  - 必须改的理由：R6 无媒体回 `text_to_video` 默认。
  - 新期望证据：`null`。
- `plugins/plugins/omnimux-workflow/src/shared/validation/executionReadiness.test.mjs` :: `Seedance 2.0: video_multi_ref with reference image upstream passes execution readiness`
  - 原断言：`first_frame` + reference edge 触发 `min_unsatisfied`。
  - 必须改的理由：R3 模型有 `video_multi_ref` 可消费该边时自动切换，不阻断。
  - 新期望证据：`null`。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/issue469AcceptanceMatrix.test.mjs` :: `多生成方式产生歧义时，若未指定 operation 则 fail-fast 拦截，底层 seam 调用次数为 0`
  - 原断言：未指定 operation 时 fail-fast，seam 0 次。
  - 必须改的理由：R6 无媒体默认 `text_to_video`。
  - 新期望证据：提交 1 次 `text_to_video`。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/issue469AcceptanceMatrix.test.mjs` :: `指定非法或未列出 (unlisted) 的 operation 时 fail-fast 拦截，底层 seam 调用次数为 0`
  - 原断言：非法/unlisted operation fail-fast，seam 0 次。
  - 必须改的理由：R3 自动切换到唯一可用 operation。
  - 新期望证据：提交 2 次 `valid_op`。
- `plugins/plugins/omnimux-workflow/tests/canvas-default-operation.test.mjs` :: `a fresh video node receives the media-consuming mode and renders slots`
  - 原断言：新视频节点 `video_multi_ref` 并渲染参考槽。
  - 必须改的理由：R6 无媒体视频默认 `text_to_video`，无卡槽。
  - 新期望证据：`operation === 'text_to_video'`、`layout.preset === 'none'`。
- `plugins/plugins/omnimux-workflow/tests/e2e/upstream-unused-supply-3109.e2e.test.mjs` :: `E2E #3109: 已就绪的上游图片在当前生成方式不接纳时，必须在卡槽外显式呈现而不是消失`
  - 原断言：`wf-input-unused` chip 显示「当前生成方式不支持该素材」。
  - 必须改的理由：Epic #63 自动切换后 chip 状态不存在，整块删除。
  - 新期望证据：`unusedChips(html) === []` 且文案不渲染。
- `plugins/plugins/omnimux-workflow/tests/e2e/upstream-unused-supply-3109.e2e.test.mjs` :: `E2E #3109: 同一份上游图片在 operation 声明图片槽位时照常入槽，且不再报未使用`
  - 原断言：未使用 chip 列表为空作为「已消费」证明。
  - 必须改的理由：chip 永远不渲染；保留卡槽已装填断言。
  - 新期望证据：chip 为空 + `filledWells === 1`。
- `plugins/plugins/omnimux-workflow/tests/e2e/upstream-unused-supply-3109.e2e.test.mjs` :: `E2E #3109: 用户主动置为待命的供给不进入未使用列表（待命池语义不变）`
  - 原断言：待命池过滤后 chip 为空。
  - 必须改的理由：chip 已删除；保留待命池语义。
  - 新期望证据：chip 为空、`filledWells === 0`。
