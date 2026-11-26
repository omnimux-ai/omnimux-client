# 画布上游文本与音频输入卡槽统一（Issue #339）

## 背景与研究依据

1. **当前受阻点（来自用户反馈与 `7bfe7186` 源码核验）**：
   - 在 `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/index.tsx` 中，PR #146/#147 将带 `prompt` 组合契约的上游文本拆出 `mediaLayout`，通过 `<SlotWells presentation="prompt" />` 以水平条（`.wf-prompt-reference`）单独渲染在 `PromptTokenEditor` 下方，与顶部素材卡槽行割裂。
   - 另一条旧链路（`textOnlySources` 的 `.wf-effective-text--slot`）及 `SlotWells.tsx` 的 `WellThumb` 文本分支渲染的是 `textContent` 正文片段而非节点名称，长正文难以辨认来源节点。
   - 上游音频正常入槽（如 `wan-3.0` 全能参考 `video_multi_ref`、数字人 `digital_human`、多模态对话 `chat`）时，`SlotWells.tsx` 的 `WellThumb` 仅渲染孤立音符图标，缺少节点名称，多个音频或混合素材并排时无法区分来源。
   - 注：当视频节点处于 `first_frame` 等未声明音频输入槽的模式，或音频不符合目标槽 MIME（如 `wan-3.0` `reference_audios` 仅允许 `audio/wav`、`audio/mpeg`）/ 时长 / 就绪态要求时，连线按 [画布生成契约](../plugins/docs/contracts/canvas-generation.md) 保留在画布上作为未消费供给，不进入当前卡槽；本次不改动模型与模式消费契约。
2. **对标与设计决策**：
   - 参照用户确认的图 2 素材卡槽视觉规范与仓库既有 `44px × 44px`、`border-radius: 10px` 媒体卡槽几何，将文本与音频已装填卡槽统一收敛到顶部素材区 `.wf-config-panel__prompt-header` 内的同一套方块样式（类型图标 + 节点名称单行省略），紧邻媒体卡槽与 `+` 添加位。
   - 视觉与交互遵循 `ui-taste-system` Existing System 模式和 `dsh-ui-kit` 语义 Token 约束：只消费 `dsw-token-allowlist.json` 已登记的 `--dsw-alias-*` / `--dsw-specific-*` Token，不引入裸色，不添加额外空文本 `+` 槽，不新增冗余状态提示条。

## 假设

将绑定到 `prompt` 槽位及旧链路 `textOnlySources` 的上游文本统一收敛到顶部素材卡槽行（`SlotWells`），并与已入槽的音频素材共用「居中图标 + 单行截断节点名」的 `44px × 44px` 方块卡槽样式后：

1. 所有布局预设（`named`、`pair`、`strip`、`none`）下的上游文本与图片/视频/音频处在同一顶部素材区，提示词输入框下方不再出现割裂的独立横条；在 `strip` 布局中，已装填卡槽全部排在尾部 `+` 添加位之前；在 `pair` 布局中，首尾帧之间的互换按钮不受影响。
2. 未连入上游文本时，顶部不新增空文本 `+` 框；当节点无媒体槽且无绑定文本/文档时，顶部保持 `24px` 紧凑高度（`.wf-config-panel__prompt-header--empty-slots`）。
3. 文本与音频已装填卡槽以节点名称（而非正文片段）作为单行省略文案，在 `44px × 44px` 盒模型内不换行、不溢出、不挤压图标，且在具名音频槽（如 `driving_audio`）已装填时不与角色底标重叠。
4. 既有悬停预览（全文查看、音频播放及完整节点名展示）、替换、停用/启用、移除绑定、键盘焦点返回与亮/暗双主题对比度（≥ 4.5:1）保持完整可用。

## 证伪方式

1. **演示与视觉评审**：在隔离浏览器（`ego-browser`）打开高保真前后对照演示 `ui-demo/text-audio-slot-wells-demo.html`，覆盖亮/暗双主题、窄屏与宽屏、`named`/`pair`/`strip`/`none` 四种布局、超长中英文无空格节点名、悬停预览浮层及加载/失效态；任一卡片出现文字换行、溢出、图标挤压、与 `positionLabel` 重叠或对比度不足即判定不通过并修正。
2. **单元与渲染回归测试**：
   - 运行 `omnimux-workflow` 全套受影响单测（`singleEmptyWell3034.test.mjs`、`generationUi.render.test.mjs`、`slotInteractionRefinement.test.mjs`、`textSlotAcceptance.test.mjs`、`videoParamsIntegration.test.mjs`、`modelCascadeInteractions.test.mjs` 及新增专项回归测试），验证：
     - 文本上游在 `first_frame`（`named`）、`first_last_frame`（`pair`，保留互换按钮）、`video_multi_ref` / `image_to_image`（`strip`，排在 `+` 之前）、`text_to_video` / `text_to_text`（`none`）下全部在顶部素材区以统一 `.wf-slot-well` 渲染「图标 + 节点名」，不再渲染底部 `wf-prompt-references` 横条。
     - 音频上游在 `video_multi_ref`（`strip`）与 `digital_human`（`named`）已入槽时渲染音频图标 + 截断节点名，且已装填音频卡不叠加 `.wf-slot-well__position` 底标；空态具名音频槽保留 `+` 与角色底标。
     - 未连入上游文本时 4 种输出节点均不渲染空文本卡槽，无媒体槽节点保留 `--empty-slots`。
     - `textOnlySources` 旧链路同样展示节点名而非正文片段。
3. **静态与主题门禁**：运行 `corepack pnpm --dir plugins run build:all`、`corepack pnpm --dir plugins verify:dsw-tokens`、`corepack pnpm --dir plugins verify:stages`、`corepack pnpm --dir plugins verify:slots`、`corepack pnpm --dir plugins guard:popover`、`node --test plugins/scripts/verify-anti-slop.test.mjs` 及 `node plugins/scripts/verify-test-standard-declarations.mjs` 全绿。
4. **真实浏览器端到端验收**：在任务工作树运行 `plugins/plugins/omnimux-workflow/tests/e2e/unified-text-audio-slot-wells.e2e.test.mjs`（生产包 + 真实 DSH 主题 + 隔离 `ego-browser`），实测亮/暗双主题与窄屏下顶部文本/音频卡槽几何（44×44、可见底色填充、无横向溢出、单行省略）、悬停预览（不透明底色 + ≥4.5:1 对比度 + 完整名称/正文/音频播放器）、替换、停用与多布局（`named` / `pair` / `strip` / `none`）；同步更新 `plugins/plugins/omnimux-workflow/tests/e2e/canvas-group-capabilities.e2e.test.mjs` 的 `checkPromptMentions` 顶部卡槽选择器与 DSH 主题提取（保留全部既有断言不变；该旧套件另有 PR #183 遗留的 `withCapacity` / `@` 菜单 `canvasReferences` 漂移，不在 Issue #339 改动范围内）。

## 实施边界

- 仅调整画布配置面板顶部素材卡槽渲染、悬停预览标题补充与对应样式/测试，不改变 `resolveInputAssignment`、`autoFillSlots`、网关模型目录契约或后端执行提交载荷。
- 复用既有 `SlotWells`、`SlotHoverPreview`、`components.css` 与 `--dsw-alias-*` 语义 Token，不引入新的状态提示条或额外样式框架。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/singleEmptyWell3034.test.mjs` :: `new image: a bound prompt slot only renders the upstream text chip`
  上游文本卡槽按 Issue #339 从提示词下方独立横条（`wf-prompt-references` / `wf-prompt-reference`）统一迁回顶部 `wf-slot-wells` 素材卡槽，采用 `wf-slot-well` 方块样式显示图标与节点名；更新断言验证顶部 `wf-slot-wells` 中渲染 1 张绑定文本卡且不再渲染底部 `wf-prompt-references`，继续保留零空媒体槽与生成按钮可用断言。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `text sources occupy the input header without creating media slots or copying the editor value`
  旧链路顶部文本卡槽改为显示节点名称（`正文来源`）而非正文内容（`1dog`），与图 2 规范一致；更新文本内容匹配断言为节点名并继续验证不复制正文进 `<textarea>`、无多余媒体槽且去除 `--empty-slots`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `image node with one text upstream renders exactly one text chip`
  已绑定上游文本改由顶部统一 `wf-slot-wells` 以 `.wf-slot-well` 文本卡渲染，不再使用底部 `.wf-prompt-reference`；更新计数辅助与断言匹配顶部统一文本卡槽并保留单张去重校验。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `image node with multiple text upstreams renders each once in stable order`
  同步使用顶部统一文本卡槽选择器验证多条文本上游各渲染一次且保持稳定边序。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `image node text chips stay deduplicated across repeated renders and disappear after upstream removal`
  同步使用顶部统一文本卡槽选择器验证重复渲染去重与断连后完整消失。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/generationUi.render.test.mjs` :: `image node keeps image and file inputs while deduplicating text chips`
  同步验证图片卡槽与统一文本卡槽在同一顶部素材区内共存且文本去重。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/slotInteractionRefinement.test.mjs` :: `a composed text binding with a role conflict remains available for replacement`
  移除 `SlotWells` 的独立 `presentation="prompt"` 底部渲染模式后，冲突态组合文本绑定直接在统一顶部 `SlotWells` 中渲染并保留 `data-slot-state="invalid"` 与替换入口。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/textSlotAcceptance.test.mjs` :: `TC-T02-02: ConfigPanel 对纯文本模型追加 wf-config-panel__prompt-header--empty-slots 且不渲染空 span`
  顶部素材区同时承接媒体槽与已绑定文本槽（`mediaSlotCount > 0 || promptRecords.length > 0`），且空态判定同步覆盖 `promptRecords` 与 `documentSources`；更新源码结构断言以匹配统一后的空态判断与 `SlotWells` 渲染条件，仍验证无媒体无文本时保留 `--empty-slots` 且不渲染空 `<span />`。
