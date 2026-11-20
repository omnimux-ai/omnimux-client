# 画布素材入口按用途呈现

## 目标

用户可在生成节点上切换可用模型和模式。素材区随选中的能力更新，展示可用于这一轮的素材。用户在一个入口添加通用参考素材，或者在命名卡槽里明确分配首帧、尾帧、角色形象和驱动音频。提示词区可以输入文本及引用上游文本。

## 假设

同一用途的多个输入类型和数量限制可以由素材选择器处理。用户只在需要为素材分配独立角色时选择具体卡槽。Muse 的起始图由参考图顺序决定，用户仍可将另一张参考图设为起始图。

在 `99abb36` 上，`SlotWells` 为每个有容量的 strip 输入渲染一个入口。GPT Image 垫图参考和 Muse 图片参考因此分别为图片与上游文本显示加号。Muse 低于最小图数时还会显示预留图片卡。对照 PR #128、#132 及本任务经确认的交互演示。以当前网关能力派生类型、每类数量与角色，示例里的数量仅用于演示。

## 证伪方式

1. GPT Image 垫图参考和 Muse 图片参考各只有一个通用加号。Muse 低于最小图数时仍只有一个加号。填满后入口消失，释放容量后重新出现，起始图可更换。
2. 混合参考在同一个选择器内添加不同类型。某一类型填满后，其余有容量的类型仍可添加。选择期间切换模式、替换素材或容量变化时，确认须使用当前能力检查并原子应用。
3. 首尾帧和数字人展示各自的命名卡，选择器仅接收该角色的类型。首尾帧可交换。纯文本模式也可通过提示词 `@` 或画布连线引用上游文本。
4. 在同一节点连续切换模型和模式。明确选择的模式在目录仍提供时保持选中，多余素材不使模式变灰。超出上限或类型不匹配的素材退出素材区和本轮请求，供给边仍保留。提交顺序与当前有效的可见素材一致，提示词保留用户输入和已选上游文本的组合，空提示词由网关判断是否必填。
5. 在隔离的真实运行态操作并检查请求的素材和文本，覆盖已连接节点、空白节点、亮暗主题、打开的选择器和窄屏。区分可重放的夹具、构建产物与真实模型请求。
6. 按选区执行单个目标时，只调度当前输入所需的上游依赖。用户明确选择的节点、被其他已选节点消费的素材及全画布运行范围仍按现有执行语义处理。对仍阻断生成的失效文本引用保留替换和停用入口。

## 提示词引用与 `@` 菜单（#147）

以 [#147](https://github.com/omnimux-ai/omnimux-client/issues/147)、`9c51f87` 的画布组件和客户端固定的宿主主题为对照。在使用相同素材和节点配置的 Chromium 演示中，四种生成节点的空引用行原有 26 px 高度及 6 px 上间距。主、二级 `@` 菜单同为 `body` 下的浮层，旧菜单底色 alpha 均为 `0`，计算层级均为 `1200`。宿主 `--dsw-specific-menu` 在亮暗主题含透明度。两个菜单采用此语义色及层级底色后备，并将表面 alpha 固定为 `1`。

1. 视频、图片、文本及音频节点无绑定时省去整行。连线装填后出现对应文本卡片。悬停预览原文，并按当前节点的规则替换、停用或移除绑定。断开连线后引用行随最后一张卡片消失。预览卡片和操作按钮的背景在亮暗主题均全不透明，正文与按钮文字对比度至少为 4.5:1，按钮悬停时也满足该要求。
2. 输入 `@` 后，用鼠标与键盘打开图片、文本分类。选中或展开的分类保持高亮。主菜单和二级菜单在亮暗主题分别为 `10000` 和 `10001`，窄视口下检验重叠处命中二级菜单。
3. `inputBindingVersion: 1` 的节点选中 `@` 候选后继续打开素材选择器。画布连线和 Agent 工具沿用原有输入校验。

## 实施边界

复用画布输入投影和选择事务。模型、线路、角色与容量仍取自当前合同。保持原有已保存节点和独立工具操作的校验语义。使用模拟执行记录核对候选版本的请求，无需创建付费视频任务。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/promptGate2985.test.mjs` :: `*`
  将动态用例归入版本化和旧画布的具名测试。保留四种输出在有本地提示词时可提交的检查，保留文本、音频和必需媒体的阻断检查。视觉生成空提示词从客户端禁用改为可提交，并由执行请求测试检查网关收到空字符串。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/singleEmptyWell3034.test.mjs` :: `*`
  将两种画布版本的动态用例归入具名测试。满容量依旧显示零添加位，首尾帧依旧各显示一个角色卡。提示词来源改到提示词区，分别检查空状态、已有文本引用和添加入口。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/singleEmptyWell3034.test.mjs` :: `video: first_frame and last_frame each render exactly one named empty well, prompt gets one append`
  #147 将空提示词入口改为不渲染引用行，保留首帧、尾帧各一位的断言。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/singleEmptyWell3034.test.mjs` :: `new image: bound prompt slot with composition renders occupant + exactly 1 append well (PM adjudication A: capacity-exempt)`
  #147 保留绑定文本和零空媒体槽位断言，引用行只包含已绑定的文本卡片。
- `plugins/plugins/omnimux-workflow/tests/e2e/canvas-group-capabilities.e2e.test.mjs` :: `#140 real canvas narrows one selected line, restores draft inputs, and submits only active references`
  #147 将各视频模式的提示词入口计数改为检查可编辑的提示词框，并断言无绑定引用行。保留通用素材入口数量、模式切换、线路缩容和提交请求的验证。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/slotInteractionRefinement.test.mjs` :: `multi-reference strips have one add control for each open named slot on both canvas versions`
  原用例要求图片和音频分别显示添加位。普通参考素材改为共享一个添加位，两个版本的渲染测试都检查唯一入口，选择器用例检查混合添加、逐类型容量和非法输入的原子拒绝。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/inputCapabilityVideo.integration.test.mjs` :: `connected image auto-selects first_frame, greys text_to_video and projects adaptive`
  保留自动选择首帧、自适应画幅和时长的断言。已有图片时，文生视频仍可选，图片退出该模式的本轮输入。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/inputCapabilityVideo.integration.test.mjs` :: `disconnecting every image without history returns to the real text_to_video defaults`
  保留自动回到文生视频、默认参数和移除首帧参数的断言。首帧模式在没有已连接图片时仍可选，启动生成时检查必需素材。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `Issue #986：ConfigPanel 为视频节点提供基于模型能力的卡槽驱动与素材模式双向流转`
  原源码断言仅要求分组视频使用线路投影。统一改为按当前模式和线路派生卡槽，保留已选模式及禁止借用其他模式卡槽的断言。浏览器流程核对线路缩容、恢复和实际请求。
- `plugins/plugins/omnimux-workflow/src/shared/graph/effectiveInput.test.mjs` :: `IN-10: upstream description satisfies both shared and video-specific prompt validation`
  保留上游文本和本地指令的组合检查。原用例将空提示词判为视频参数错误，更新为验证空提示词可通过视觉节点的客户端校验，执行服务测试复核收到空字符串及保留错误回传。
- `plugins/plugins/omnimux-workflow/tests/e2e/gateway-video-mode-names.journey.mjs` :: `*`
  将模式命名验收迁入同目录的具名 Chromium 用例，复用可从当前单仓启动的 Host。保留 Muse 容量从 2 刷新到 10 的目录与名称检查、Seedance 的全能参考模式、同一节点的切换和亮暗主题窄屏菜单完整性。首帧从无素材时禁止选中，改为可选中并显示空首帧位，缺少首帧时禁止提交。
