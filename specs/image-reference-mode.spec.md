# 图片节点按参考图自动选择文生图/图生图

## 背景

画布图片生成节点当前仍把「文生图 / 图生图」作为独立生成方式放在图片参数浮层里让用户选择；槽位布局又跟随 `params.operation` 渲染，导致未先切到图生图时，节点上根本没有可添加参考图的入口。用户希望只保留一个可选的「参考图」槽：不选参考图就是文生图，选了参考图就是图生图，完全由 UI 选择和提交结果决定，不再单独选择生成方式。

## 目标

- 图片生成节点始终展示一个可选参考图入口（模型支持参考图时），不再展示「生成方式」选择器。
- 参考图槽实际消费 0 张图片时使用 `text_to_image`；实际消费 ≥1 张时使用该模型消费参考图的已上架 operation（`image_to_image` 或 `multi_reference`，按模型真实契约）。
- UI、选择器、槽位重算、执行前检查、执行准备和 Agent 工具共用同一份派生结果，避免 UI 显示图生图但提交文生图。

## 非目标

- 不改变视频节点的生成方式选择与执行语义。
- 不修改网关契约、operation ID、请求协议或模型参数。
- 不为无参考图能力的模型伪造参考图槽。
- 不发起真实图片生成请求。

## 研究依据

- 共享能力内核已实现图片矩阵：`buildInputCapability` 的 `MEDIA_MAIN_INPUT` 要求 `image_to_image` / `multi_reference` 至少 1 张图片；真实目录用例覆盖 `gpt-image-2.5: 0 图 → text_to_image; 1 图 → multi_reference` 与 `nano-banana-2-lite: 1 图 → image_to_image`，见 [inputCapability.ts](../plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.ts) 与 [inputCapability.test.mjs](../plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs)。
- 当前图片节点 UI 仍按 `params.operation` 派生布局，见 [ConfigPanel/index.tsx](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/index.tsx)；图片参数浮层暴露生成方式段，见 [ImageParamPopover.tsx](../plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/imageParams/ImageParamPopover.tsx)。
- `deriveModelSlotLayout` 已支持当前 operation 无媒体槽时借用同模型兄弟 operation 的槽位，用于展示模型级素材能力，见 [modelMaterialCapability.ts](../plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/modelMaterialCapability.ts)。

## 假设

所有需要额外语义的图片编辑方式（局部重绘等）仍保留独立 operation 和独立入口；本任务只覆盖「纯文本 → 参考图」这两个相邻方式。图片节点始终以模型级参考图布局展示一个可选参考图槽，`params.operation` 只作为派生结果写回。

## 证伪方式

若某个模型只有 `image_to_image` 且参考图 `min: 1`，空节点必须禁用生成并提示添加参考图，而不是回退文生图。若模型只有纯文生图能力而用户通过上游连线或选择器塞入参考图，必须阻断并提示更换支持参考图的模型，不能静默忽略。用真实目录中的 `gpt-image-2.5`、`nano-banana-2-lite` 和纯文生图型号作反证。

## 验收标准

1. 空图片生成节点在支持参考图的模型下显示提示词区和「参考图（可选）」槽，不显示「生成方式」段、模式页签或任何文生图/图生图选择控件。
2. 通过参考图槽添加图片后，节点在同一次输入变更里派生为参考图 operation；生成按钮的可提交状态、请求 operation 和 material slot 输入一致。
3. 移除最后一张参考图（或将其停用）后，节点派生回 `text_to_image`；被停用的供给边不计入参考图数量。
4. 多张参考图按模型容量选择 `multi_reference`；超过容量或类型不匹配的素材不进入本次请求，供给边保留。
5. 纯文生图模型收到参考图时，生成被阻断并给出可操作的模型能力提示，不静默丢弃参考图。
6. 保存后重新打开、撤销一次、复制节点时，参考图绑定与派生 operation 保持一致；一次添加/移除参考图对应一个撤销步骤。
7. 执行前检查与执行准备使用同一派生结果：旧节点保存的过期 `params.operation` 不得覆盖当前参考图状态。
8. 亮/暗主题、窄屏和打开的选择器浮层下，参考图入口与生成按钮均可操作；提交前先交付高保真 HTML 演示并评审通过。
9. 现有图片节点用例中锁定「只渲染当前 operation 槽位」的旧断言更新为新的模型级参考图入口语义。

## 实施边界

- 新增共享图片生成派生 helper，复用 `buildInputCapability`，不复制 `MEDIA_MAIN_INPUT` 或模型白名单。
- 图片槽位展示统一使用模型级参考图布局；`params.operation` 只作为派生结果写回，并带 `autoOperationId` 标记。
- 选择器按展示布局打开参考图槽，选中/替换/移除操作经过现有 `applyCanvasInputMutation` 事务。
- 回归测试覆盖真实目录的 0 图/1 图/多图/纯文生图模型，及一次 mutation 的 operation + binding 同步变化。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `image panel only renders slots of the selected operation`
  原断言要求图片节点只渲染当前 operation 的槽位，且无参考图时不出现槽位；本任务改为模型级展示布局，空节点也渲染可选参考图槽（仅有纯文生图能力时除外）。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/imageParams/imageParamAdapter.test.mjs` :: `ops ≥ 2 → showModeUi true 且 modeText 来自 operation label；ops ≤ 1 → 无 mode`
  原断言要求图片参数摘要显示生成方式；本任务改为参考图槽派生，图片浮层不再显示可切换模式。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/imageParams/imageParamsIntegration.test.mjs` :: `ImageParamPopover 消费 cfg 控件族，写路径先 assertImageParamWriteKey`
  原断言包含生成方式分区与 `writeParam('operation')`；本任务移除该分区，改为断言不出现生成方式选择器。
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasSlotRecompute.supplyMode.test.mjs` :: `#3214：用户显式拍板过的生成方式不被自动改写`
  原断言要求图片节点手工选择的文生图在连图后保持不变；本任务改为有参考图时派生图生图、移除参考图回到文生图。
- `plugins/plugins/omnimux-workflow/tests/media-generation-recovery-3054.test.mjs` :: `changed explicit operation goes through normal admission after an old prepared run`
  原断言要求旧准备任务变更显式 operation 返回 400；本任务改为图片 operation 由参考图派生，旧 operation 不再作为独立用户意图。

## 影响文件

- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/imageGeneration.ts`（新增共享派生）
- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/modelMaterialCapability.ts`（图片展示布局）
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasSlotRecompute.ts`
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasInputMutationGateway.ts`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/resourcePickerPolicy.ts`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/index.tsx`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/imageParams/*`
- `plugins/plugins/omnimux-workflow/src/shared/validation/executionReadiness.ts`
- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/prepareExecutionSlotGraph.ts`
- `plugins/plugins/omnimux-workflow/src/workflow/execution/materialSlotInputs.ts`
- 相关单测 / DOM / 集成测试与本 spec

## 验证

- 先交付 `ui-demo/image-reference-mode-demo.html`，覆盖修改前后、亮暗主题、窄屏、空参考图/已选参考图/打开选择器。
- 目标单测：`pnpm --filter omnimux-workflow test` 中图片 capability、slot recompute、resource picker、execution readiness、ConfigPanel DOM。
- 构建：`corepack pnpm --dir plugins run build:all`；受影响插件单测通过。
- 不发起真实模型请求。
