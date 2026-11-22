# 画布素材连线与分配

工单 [#88](https://github.com/omnimux-ai/omnimux-client/issues/88)。现行行为见 [画布生成契约](../plugins/docs/contracts/canvas-generation.md)。

## 依据

- 基线 `312319424e5c801343235f1f8d9af6363bd77d39` 已允许普通超量连线。打包对照中，V0/V1 音频入口都显示通用的「添加素材」，文件选择同时请求图片、视频及音频扩展名。随包目录里的 Muse Video `first_frame` 要求一张 JPEG、PNG 或 WebP，同模型还支持 `video_multi_ref`。超量对照显式固定 `first_frame`。Seedance 2.5 `first_last_frame` 首尾各需一张图，`video_multi_ref` 的图槽 `min=1`、`max=30`，视频与音频槽各 `max=10`，音频允许 `audio/mpeg` 和 `audio/wav`。
- 冻结演示复走了 Muse 中两条边只消费 A、断开 A 后 B 入槽，以及多参考音频槽只显示 WAV 和 MP3。这个对照定义了回归观察值。演示中的提交预览由夹具生成，运行验证须从产品提交入口捕获请求。
- 现有 Feed-Slot 提供槽位、顺序和选择记录。普通连线沿用固定端口规则。为每种方式分配完整候选，以实际消费的不同素材数排序，选中的分配驱动卡槽、提示词与提交。具名槽添加和替换另校验选槽时的意图。
- 随包目录未包含 `wan-image-3.0`，`gemini-3.7-flash` 无上架方式。对照分别使用同为参考图 `max=1` 的 `gpt-image-2.5/multi_reference` 和支持多模态构成输入的 `gemini-3.8-flash/chat`。

## 验收标准

1. 自连、重复、缺节点、环和固定端口不匹配继续被拒绝。其他普通连线可保存。容量、无类型槽、MIME 或角色不支持的候选不进入卡槽、引用或载荷。切换后重新分配，断开后按稳定顺序补位。
2. 显式可用方式优先。自动方式按实际分配计分，同一来源输出只能消费一次。Muse 首帧超量仅消费 A，断开 A 后消费 B。Seedance 两图选择首尾帧，多参考只有音频时保留音频占位，缺图阻塞生成。
3. 保留 V0/V1 读取兼容。显式清空保留，待命不自动入槽，显式角色暂不可用时保留旧意图。显式已绑定的未就绪素材保留状态。图片、音频、文本和支持的文档输入使用各自契约。
4. 当前具名槽才提供添加和替换。已有素材、原生选择、本地拖入及提交前复核使用同一槽位约束。替换确认针对一条稳定的边，已有边可继续留作供给。范围变化拒绝写入，成功和撤销各是一次画布事务。
5. 提交冻结已消费素材、角色与顺序。快照与当前输入或契约发生有意义的变化时阻塞错误提交。参数继续按 #55 归一化。已提交任务沿原任务上下文执行及恢复。
6. 使用同一组夹具在独立 Web Host 复核亮暗主题、宽窄视口、展开的选择器及最终载荷。保存可复核的请求与界面摘要。实际网关及模型调用单独记录。

## 证伪方式

- 恢复用全量候选作严格匹配，Muse 溢出会使生成不可用。提前截断 Seedance 两图，首尾帧用例应失败。把未入槽边送进引用或提交，载荷对照应失败。
- 恢复未消费卡片、按模型拒绝拖线或粗略按类型筛选，DOM、边或 FLAC 对照应失败。恢复 V1 本地导入早退，V1 落图与撤销用例应失败。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeInteractions.test.mjs` :: `clicking a single-image line includes trimmed reference bindings in the first node write`
  原用例检查线路修改内的裁剪字段。现以实际画布写入和组件渲染核对线路合计上限、两条供给边、一次写入、窄线路的请求集合以及切回后的顺序。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `missingRequiredSlots validates against displayedSlotLayout.slots and trims slotBindings for single-image channels`
  原用例匹配已移除的独立就绪和裁剪代码。现从图分配验证缺图阻塞、只消费一张、格式不匹配保边及断开补位，同时核对运行快照。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/slotInteractionRefinement.test.mjs` :: `image and audio references share one add control on both canvas versions`
  原用例要求混类型共用入口。具名槽各有一个入口，交互断言两个画布版本分别发出准确的图槽和音槽意图，已消费项不增加同槽入口。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `Issue #1007：视频节点生成模式防退化长效保障，连线素材下生成模式选择器与底栏文字不可被误杀隐藏`
  原用例依赖适配器调用和选择器源码。现打开真实组件的方式菜单并操作，核对当前方式、候选行和面板文字。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `Issue #986：ConfigPanel 为视频节点提供基于模型能力的卡槽驱动与素材模式双向流转`
  原用例检查装填和回调源码。现用实际组件切换方式，观察首尾帧装填，断线后验证显式方式保留。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `R4: standby image cannot erase a single-operation duration schema or its validation`
  原用例传入适配器的待命数组。现用已分配和未消费的图片核对时长控件范围、必填值拦截及合法值。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `video raw supply keeps modes discoverable while the selected first-frame gate consumes one image`
  原用例直接测试宽松供给参数。现用实际分配核对首帧只消费一张、其他在售方式仍可选、显示与就绪一致。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `视频有效参数经 resolveEffectiveVideoParams 解析（消费 catalog/upstreams）`
  原用例以函数名作断言。现以现行适配路径核对目录时长的有效值、无合法默认时报阻塞、表格上游正文只拼一次。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/hooks/useConnectionMenu.test.mjs` :: `B1：invalid connection 拒绝提示链 validateConnectionDetailed 携带 catalogRuntime`
  原用例要求把目录传给普通连线。图结构拒绝只依赖端口和图，现用重复连线核对真实拒绝码进入既有本地化提示。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/clipboardUtils.test.mjs` :: `paste remaps retained video mode drafts without retaining unselected upstream references`
  原用例只检查视频草稿。现同时检查暂存角色和对口型草稿均映射新节点与边，未复制连接被过滤且原稿保持完整。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/connectionValidator.test.mjs` :: `Stage 2 does not gate import targets and prompt-only input`
  原标题依赖此前两阶段结构。现按普通连线入口核对导入节点和提示词供给边的允许结果。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/connectionValidator.test.mjs` :: `fifth edge beyond max four is accepted with unused supply advisory`
  原用例依赖未消费告知字段。现核对第 5 条合法边通过结构闸门，分配用例另外核对容量超量的分类。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/resourcePickerPolicy.test.mjs` :: `R1 adapter→store allows two invalid intents to be disabled one by one without granting restore or arbitrary strict patches`
  原用例覆盖失效选择的停用和恢复。现用统一分配结果验证一次只修改所选边，失效素材保持不可恢复，严格写入仍有约束。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/resourcePickerPolicy.test.mjs` :: `a newly chosen reference can fill space vacated by incompatible saved supply`
  原用例通过混合添加入口验证补位。现按具名参考槽核对合法新素材入槽，旧不合规供给留在图上。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/utils/resourcePickerPolicy.test.mjs` :: `named picker hides unsupported audio before selection on both canvas versions`
  原用例只检查已有素材列表。现走具名槽契约验证 V0/V1 的 FLAC 过滤，浏览器对照同时校验原生选择的扩展名和实际落图。
- `plugins/plugins/omnimux-workflow/src/canvas/store/canvasStore.catalogHydrate.test.mjs` :: `catalog-first hydrate reconciles the loaded graph even when runtime fingerprint is unchanged`
  原用例把无槽记录当作 `{}`。现核对仍保留连线，无槽节点的 `slotBindings` 继续缺省，用户清空使用独立的 `{}` 见回归用例。
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasInputMutationGateway.compat.test.mjs` :: `known model selection is allowed with unconsumed feed and does not rewrite preferences`
  原用例期望切换无槽模型产生 `{}`。现检查缺省绑定和原边，切回有槽模型后可用同一条边恢复入槽。
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasInputMutationGateway.compat.test.mjs` :: `new image supply to a model with no image-consuming operation is kept as unused (#88)`
  原用例期望不能消费的普通供给生成 `{}`。现校验写入成功、边保留、绑定和待命状态保持缺省。
- `plugins/plugins/omnimux-workflow/src/shared/graph/catalogReconcile.test.mjs` :: `unsupported historical feed keeps edges and does not invalidate a prompt-only task`
  原用例把目录刷新后的无槽状态写成显式清空。现核对边保留、绑定缺省，生成仍受必需提示词约束。
- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/imageGeneration.test.mjs` :: `models without a reference operation do not pretend to accept one`
  原用例将无参考图方式视为阻塞。现核对模型仍可用文生图方式、无参考槽、保留普通图边，且图片未被消费。
- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/inputCapabilityExecution.test.mjs` :: `Muse legacy mode changes carry the chosen start image between single and ordered pair slots`
  原用例要求切换首帧后没有暂存意图。现核对原开始图入首帧，原显式参考图保留在暂不可用的槽位草稿。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `A32 permits a mode that can use the first frame while the explicit tail is out of scope`
  原用例只检查方式可用。现核对已选首尾帧的优先级与引用角色，额外供给留在原用途，另一方式可正常选择。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `R10 keeps media-incompatible models in the picker as grey options`
  原用例要求因供给不匹配置灰。现对照有无供给时同一批可售模型仍可点击，实际分配另行限制消费。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `R6 no media falls back to the family default operation`
  原用例对所有来源要求回退。现只对自动选择验证零图回默认，显式选择保留并单独验证必需输入。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `gemini-3.8-flash absorbs text/image/video/audio/pdf; gemini-4-argon rejects audio`
  原用例要求拒绝含音频的候选。现继续检查 Argon 未声明音频槽，运行的 `chat` 静默略过音频。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `gpt-image-2.5: no media → text_to_image; 1 image → the image-consuming reference op`
  原用例将参考图供给视为文生图不可用。现核对实际分配仍派生参考图方式，同时目录保留可用的文生图操作。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `image models without any image-consuming operation cannot consume an image (R5/R10)`
  原用例要求带图时模型被挡。现保留不能消费图片的检查，并核对可用文生图方式和没有已分配图片。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `minimax-h3-video: 1 image → video_multi_ref; image+audio → digital_human`
  原用例用整组匹配检查方式。现核对单图选择多参考、图音选择对口型，各方式实际匹配自己的素材。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `muse-video: no media → text_to_video; 1 image → first_frame`
  原用例要求文生方式拒图。现仍核对零图走文生、单图自动走首帧，文生方式保留并略过不消费的供给。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `nano-banana-2-lite: no media → text_to_image; 1 image → image_to_image`
  原用例要求文生图因供给禁用。现保留零图和单图的派生验证，同时检查可用的文生图操作。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `seedance-2-5: 2 images → first_last_frame, video_multi_ref stays usable (not grey)`
  原用例按整组筛选方式。现两图仍选首尾帧，按每个方式的实际消费检查首帧、多参考及已列出的其他组合。
- `plugins/plugins/omnimux-workflow/src/shared/validation/inputCapability.test.mjs` :: `suno / suno-sounds reject audio input (no media slot)`
  原用例要求统一拒音频。现核对 Suno 的文生音乐略过音频，随包目录中 Suno Sounds 在有无音频时均无上架方式。
- `plugins/plugins/omnimux-workflow/src/workflow/routes/localFileRoutes.test.mjs` :: `named picker probe distinguishes FLAC data from a WAV filename`
  原用例检查一条扩展名伪装。现通过实际探测继续验证内容 MIME 优先，并覆盖具名槽元数据响应和格式请求。
- `plugins/plugins/omnimux-workflow/src/shared/graph/canvasSlotRecompute.multimodal.test.mjs` :: `#62: a naturally auto-created video node keeps text_to_video after an audio edge`
  原用例要求未手选的文生视频模式忽略可消费音频。现验证自动选择先分配音频，缺必需图仍阻塞生成，同时验证手选文生方式保留并略过音频。
- `plugins/plugins/omnimux-workflow/src/shared/graph/feedSlot/feedSlotKernel.test.mjs` :: `new-version node and supply mutation preserve explicitly empty bindings and do not compose supply text`
  原用例要求所有 V1 普通文本供给都不入槽。现验证新连接可成为正文，用户显式清空后的已保存文本边仍不回填。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/executionReadinessEntries.test.mjs` :: `HTTP and Agent hydrate the same occupied slots and ignore unused missing media before scheduling`
  原用例把未消费的缺失供给留在调度子图。现核对 HTTP 与 Agent 都只调度已分配素材，并保留两条入口的就绪与快照断言。
- `plugins/plugins/omnimux-workflow/src/workflow/execution/feedSlotSubmission.test.mjs` :: `V1 dispatch retains both current named roles on one edge and never refills inactive roles`
  原用例允许同一输出占首尾两槽。现验证重复身份阻塞，一图只占一个角色，待命的角色仍不自动回填。
