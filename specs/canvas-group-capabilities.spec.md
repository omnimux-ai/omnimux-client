# 画布视频分组能力与跨仓验收

- 客户端任务 [#140](https://github.com/omnimux-ai/omnimux-client/issues/140)（`canvas-group-capabilities`）
- 基线 `7e4b810`
- 当前状态为已确认方案，按下列验收项记录实现和运行结果。
- 长期规则见[画布生成契约](../plugins/docs/contracts/canvas-generation.md)。网关发布、实际转发、样例与中英文外部文档由[网关 #74](https://github.com/omnimux-ai/omnimux-gateway/issues/74)跟踪。

## 研究依据

网关 [#68](https://github.com/omnimux-ai/omnimux-gateway/issues/68) 已定义账号可用分组的操作变体。试点协议选择仍依赖固定模型 ID。候选验收必须从目录走到提交、轮询和产物，目录可见本身只证明可列出。客户端中枢旧指令要求上架时维护画布白名单，历史规格也记录了按 ID 分派和按连线推断模式。静态指令检查通过，说明仅检查文件结构和链接无法拦住这些行为回退。[之前的协议修复](issue-89-muse-video-mapping.spec.md) · [之前的素材规则](issue-62-input-capability.spec.md) · [目录可用性规格](model-catalog-availability.spec.md)

按[研究与决策流程](../docs/development-research.md#定方案前留下什么)复用 Magpie 的证据交接方式。记录实际版本和从入口复走的结果，让另一位 Agent 独立辨认未验项。界面方案先在可直接打开的演示中操作，再到隔离 Dev 复验。[Magpie 预览流程](https://github.com/yetone/magpie/blob/62378c5f8473539f358993d30fc24b60b4904212/.github/ui-preview/README.md)

## 用户操作旅程

1. 打开视频节点的模型菜单，选择可用模型和明确分组。组价、模式、参数和槽位随所选组更新。切模型取新组默认方式，切分组时尽量保留当前方式，参数按新组合重置。
2. 同一节点依次选择支持六张参考图的组、只支持两张的组、首尾帧方式，再返回原组和参考方式。低容量组只展示和提交有序的两张，返回后恢复六张及顺序。首尾帧方式可先选再填空槽。连线变化不得替换已选方式。
3. 提交新任务时，所选组、方式、参数、槽位和需要执行的隐式上游来自同一个有效结果。隐去的素材和其引用不能进入实际请求或触发额外付费。
4. Agent 查询当前节点的可用组选项，走同一选择与执行规则。等待超时后按原执行记录继续查看。旧项目重开、撤销、复制和已受理任务恢复均在原入口核对。

## 验收标准

| 编号 | 用例与观察结果 | 证据层级 |
| --- | --- | --- |
| CG-1 | 固定同一客户端替换合成模型 ID，目录刷新后两个不同能力的组均按支持情况显示；仅列表通过不足以验收 | 离线契约、隔离 Dev |
| CG-2 | 同一节点完成高价多图、低价少图、首尾帧、切回；亮暗主题、窄屏、键盘与开启浮层时均可操作 | HTML 演示、隔离 Dev |
| CG-3 | 同组候选变体不能拼接出不存在的组合；无权组、显式空组、无法处理的协议不显示；账号撤权后旧响应不得恢复组 | 离线契约、隔离 Dev |
| CG-4 | 使用所选组和受支持协议完成提交、查询及产物回填。检查实际分组、素材顺序、请求字段和隐式上游任务数 | 隔离 Dev 模拟线路、获准时真实测试线路 |
| CG-5 | 旧项目重开、撤销、复制和已受理任务恢复。已受理任务查询原任务，等待超时不重复创建 | 离线测试、隔离 Dev |
| CG-6 | 两个没有聊天上下文的 Agent 分别从客户端和网关的根指令及同一个工单开始，找到现行条款、固定版本样例、命令和未验事项 | 干净检出交接 |
| CG-7 | 同一用户操作在合入提交重新物化、运行指纹核对后复验。公开 PR 只记录可公开的证据 | 合入后 Dev |

现有命令从仓根运行。

- `git diff --check`。
- `node --test plugins/scripts/verify-agents-md.test.mjs`。
- `corepack pnpm --dir plugins run verify:model-contracts`。
- `corepack pnpm --dir plugins run test:agent-tools`，以及受影响插件单测和 `corepack pnpm --dir plugins run build:all`。
- 隔离运行按[插件验收入口](../plugins/README.md#本地开发与交付)记录候选版本和具体旅程。真实测试环境和生产发布各需对应授权。

## 假设

客户端消费网关 #76 候选提交生成的两份公开样例，分别覆盖组内继承同一协议及各组使用不同协议。样例的来源、版本和摘要纳入离线门禁。[固定样例](../plugins/plugins/omnimux/src/catalog/testdata/gateway-grouped-video/README.md)同一客户端支持的协议、素材角色和参数类型才能按目录上架。缺少发布字段的旧目录继续有明确兼容入口，已经发布且无可用变体的组无可选能力。独立图像生成面板不在本任务范围。

## 证伪方式

只把合成模型 ID 换成未知值，若选项、提交地址、请求字段或查询地址变化，说明仍按模型 ID 分派。切到低容量组后若隐去的上游有新增任务，或等待超时导致二次提交，说明执行与展示仍未同源。干净检出若只能从过时规格、私人 Skill 或聊天记录找到规则，交接验收失败。

## 旧标准变更

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `production emit rejects stale models and alien channel groups`
  - 原断言要求直接提交旧选择载荷。现有候选和渠道校验保留，受管视频还要求所选组唯一，将组明确写入载荷。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `picker consumes only final filtered options and renders canonical model IDs`
  - 原断言要求一律展示 ID。受管型号展示网关目录名称并使用稳定 ID 保存选择，旧目录保留其展示方式。候选来源的校验保留。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `emission and channel lists validate model membership`
  - 原断言逐处绑定旧分组查询调用。现在各处复用同一受管分组筛选入口，并继续校验模型和渠道都属于目录。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelCascadeMenu.test.mjs` :: `hover remains preview-only and clicks select a real brand row`
  - 原断言禁止点预览分组。受管型号有多个组时，悬停和点击型号只展开候选，点击具体可用组才保存。旧目录的预览保持只读。

- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamsIntegration.test.mjs` :: `Issue #986：ConfigPanel 为视频节点提供基于模型能力的卡槽驱动与素材模式双向流转`
  - 原断言要求所有模式直接从模型目录取卡槽。受管视频改为从所选组和已选模式取卡槽，供给变更只影响该模式的素材；旧目录保留基于模型能力与素材的卡槽逻辑。两个分支都保留不同模式不借用卡槽、断开素材不重置已选模式的约束。
