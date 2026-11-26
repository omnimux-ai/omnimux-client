# 画布多格式非必填参考槽收拢与必填空槽独立展示（Issue #373）

## 背景与研究依据

1. **当前受阻点（来自用户反馈与 `68055da0` 源码及目录全量核查）**：
   - 在 `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/SlotWells/SlotWells.tsx` 中，`strip` 预设通过 `distinguishSlots = references.length > 1` 为每个仍有余量的参考槽分别渲染一个带底标的虚线空槽（`+ 参考图`、`+ 参考视频`、`+ 参考音频`、`+ 文档`）。
   - 核查随包目录 `pricing.json` 全部上架操作：
     - **全可选多格式参考**：`wan-3.0`、`seedance-2-0`（图/视频/音频均 `min=0`）、`minimax-h3-video`（图/音频均 `min=0`）的 `video_multi_ref`（全能参考），以及 `gemini-3.8-flash`、`gemini-4-argon`、`seed-evolving` 的多模态 `chat`（2 至 4 个 `min=0` 槽），均会在未填素材时将全部可选格式空槽平铺在顶部，造成视觉拥挤并误导为「所有格式都需要填写」。
     - **混合必填与可选多格式参考**：`seedance-2-5` 的 `video_multi_ref`（`reference_images` 为 `min=1` 必填，视频与音频为 `min=0` 可选）当前同样平铺 3 个空槽，未突出仅参考图为必填。
     - **全必填具名/配对/单用途槽**：`first_frame`、`first_last_frame`（首帧/尾帧均 `min=1`）、`digital_human`（角色图/驱动音频均 `min=1`）、`video_edit`、`voice_clone`、`speech_to_text` 等本身都是必填空槽，应继续默认独立显示。
2. **既有复用机制与工程核验**：
   - `ResourcePickerModal` 与 `resourcePickerPolicy.ts` 已具备完整的多槽联合选取与自动路由管线（`referenceSlots`、`resourcePickerReferenceGroup`、`routePickerReferences`、`planPickerSelectionMutation`），支持在单次选择器弹窗中按所有可用参考槽的类型/MIME/大小/时长过滤画布与本地文件，并在提交时自动分配至对应 `targetSlot`。
   - 同步核查发现 `resourcePickerReferenceGroup` 仍按 `(spec.max ?? Infinity) - slotOccupied` 计算余量，未对齐 `SlotWells.tsx` 与 `slotIntent.ts` 的 `remainingSlotCapacity`（即未纳入线路级 `inputMaxByType` 约束）；本次一并对齐。

## 假设

在 `SlotWells` 的 `strip` 参考区按「未满足必填（`spec.min > 0 && occupied < spec.min`）」与「非必填/已满足最低要求的可选余量」分层渲染，并复用 `referenceSlots` 统一选择器后：

1. **全可选多格式参考**（`wan-3.0` / `seedance-2-0` / `minimax-h3-video` `video_multi_ref` 以及 `gemini-3.8-flash` / `gemini-4-argon` / `seed-evolving` `chat`）：顶部不再平铺多个分类型空槽，仅保留 1 个无类型底标的通用 `+` 添加按钮（`aria-label="添加素材"`）；当所有参考槽余量均为 0 时隐藏 `+`。
2. **混合必填与可选多格式参考**（如 `seedance-2-5` `video_multi_ref`）：当必填槽未满足时（如 0 张参考图），独立展示带警示虚线与角色底标的必填空槽（`[+ 参考图]`），并在其后提供 1 个通用 `+` 按钮用于从统一选择器中添加任意可用参考素材（图/视频/音频）；当必填槽满足后（≥1 张参考图），独立必填空槽自动消失，顶部收敛为 `[已填参考图...] [+]`。
3. **单槽与具名/配对必填模式**（`first_frame`、`first_last_frame`、`digital_human`、`image_to_image`、`muse-video`、`seedream-5-0-pro`、`video_edit` 等）：保持现有必填空槽与单槽 `SlotIntent` 交互不变；单参考槽未满足 `min` 时继续通过单个 `+` 按钮承接并附加必填警示边框。
4. **统一选择器与容量校验闭环**：点击通用 `+` 打开 `ResourcePickerModal` 时展示所有可用参考类型的画布素材与类型筛选下拉，本地导入沿用合并后的允许扩展名与逐槽 MIME/大小/时长校验，提交时一次原子写入并自动路由至匹配 `targetSlot`；`resourcePickerReferenceGroup` 同步遵循 `remainingSlotCapacity`（含 `inputMaxByType`）。

## 证伪方式

1. **高保真演示评审**：在隔离 `ego-browser` 打开 `ui-demo/optional-reference-slots-demo.html`，覆盖亮/暗双主题、宽/窄视口、`wan-3.0` 全能参考前后对照、`seedance-2-5` 填图前后状态收敛、`first_last_frame` / `digital_human` 必填保留、`gemini-3.8-flash` 多模态对话前后对照与统一选择器交互；任一布局出现非必填分类型空槽、文字溢出、对比度不足或必填空槽丢失即判定不通过。
2. **单元与策略回归测试**：
   - 更新 `slotInteractionRefinement.test.mjs` 并新增专项单测 `optionalReferenceSlotCollapse.test.mjs`，覆盖 `wan-3.0`、`seedance-2-0`、`minimax-h3-video`、`seedance-2-5`（0 图、1 图及降级为单可用槽）、`gemini-3.8-flash` `chat`、`first_last_frame`、`digital_human`、`muse-video`、`image_to_image`、多必填无可选参考模式以及容量耗尽态。
   - 在 `optionalReferenceSlotCollapse.test.mjs` 同步验证 `resourcePickerReferenceGroup` 与 `routePickerReferences` 严格遵守线路级 `layout.inputMaxByType`（包括 0 占用多选同类型时的总上限与 `slot_capacity` 拒绝），并在真实 `wan-3.0` 与 `seedance-2-5` 目录上一次提交混合图片+视频+音频到各自目标槽。
3. **静态门禁与全量单测**：运行 `typecheck`、`build:all`、`omnimux-workflow` 全量单测、`workspace-check.mjs --check`、`verify-test-standard-declarations.mjs`、`verify:dsw-tokens`、`verify:stages`、`verify:slots`、`guard:popover`、`check:boundaries`、`verify:product-baseline` 全绿。
4. **真实浏览器端到端验收**：在任务工作树运行 `unified-text-audio-slot-wells.e2e.test.mjs`（含新增的 Issue #373 `wan-3.0` 全能参考单 `+` 打开多类型选择器选图入槽、`seedance-2-5` 必填空槽亮/暗主题警示边框与填图后收敛为单 `+`、`gemini-3.8-flash` 单 `+` 验收），结合真实 `dist/index.js` + `lib/canvas.js` + 真实 DSH 主题验证。

## 实施边界

- 仅修改 `SlotWells.tsx` 的 `strip` 添加按钮分层收敛与组上限计算、`autoFillSlots.ts` 的 `remainingTypeCapacity` / `totalSlotGroupCapacity`、`resourcePickerPolicy.ts` 与 `ResourcePickerModal.tsx` / `useResourcePicker.ts` 的多槽余量/路由与操作兜底、`components.css` 的 `.wf-slot-well--required` 真实 DSH 警示边框 Token 与特异性，以及对应测试、演示与文档 `plugins/docs/contracts/canvas-generation.md`。
- 不改动网关模型目录契约、`min`/`max` 定义、`assignOperationSlots` 自动分配规则或后端提交载荷；不新增冗余提示条或 Toast 播报。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/slotInteractionRefinement.test.mjs` :: `image and audio add controls carry distinct slot identities on both canvas versions`
  按 Issue #373 用户需求与方案确认，多格式参考区仅对未满足最低数量（`min > 0 && occupied < min`）的必填参考槽保留带角色底标的独立空槽，非必填多格式参考收拢为 1 个通用 `+` 添加按钮（通过 `referenceSlots` 在统一选择器内按类型路由）。原用例中 `reference_images` 为 `min: 1` 必填、`reference_audios` 为 `min: 0` 可选，因此同步更新断言：验证未填参考图时渲染 1 个带 `data-slot="reference_images"` 与 `wf-slot-well--required` 的必填空槽 + 1 个通用 `+` 按钮（不再为可选音频平铺独立空槽），且当必填图已满足或全为可选槽时仅渲染 1 个通用 `+` 按钮；同时保留 `displayOnlyFromOperation` 与无槽 `text_to_video` 的原有断言。
