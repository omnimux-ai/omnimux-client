# Spec: 模型目录可见 / 可执行 / 可选择语义统一

- 任务：`omnimux-model-catalog-availability`
- 日期：2026-11-14
- 基线：`main` / `1ec38f08a`
- 风险：R1（模型边界）

## 目标

把模型目录从多轨状态收敛为单一 `selectable` 语义：

- 网关快照决定在售、线路和价格。
- Gateway Contract v2 决定模型能力、操作和参数，覆盖 `llm` / `image` / `video` / `audio` 四类。
- 本地 `adapter-profiles.json` 决定 operation 级执行能力。
- Hub 目录统一计算 `visible` / `selectable` / `availabilityReason`；workflow 的自动选型、品牌点击、默认值、picker 和 submit guard 只消费这一判定，不再从 `listed` / `executionStatus` / `generationPolicy.allowedModelIds` 各自推断。
- 未适配模型只出现在设置页的目录诊断中，不进入生成器主选择路径；已保存旧节点保留原 model 值并显示配置错误。

## 用户操作旅程与期望反馈

1. 新建空视频节点时，即使本机 `generation-preferences.json` 的 `video` 还是 `wan-3.0`，也只会选中当前 `selectable` 的视频模型，不再显示「本地暂无该型号的可执行适配」。
2. 打开视频模型菜单，不可执行型号不显示在可点选列表；点击品牌列也不会写入不可执行型号。
3. 网关新增一个带 v2 contract 且本地 `videoGenerate` profile 覆盖的模型时，刷新后自动进入目录，无需新增本地 YAML；若缺少 contract 或 adapter，则只在设置页目录诊断中显示原因。
4. 旧项目保存了已下架或不可执行的模型：节点保留原值，生成被禁用并给出明确原因，不自动改写用户选择。
5. 用户自定义 BYOK 模型仍可见、可选择，不依赖网关 membership。

## 技术范围

### Hub

- `plugins/plugins/omnimux/src/catalog/project.js`：`projectRow` / `projectModelDto` / `projectCatalog` 增加 `visible` / `selectable` / `availabilityReason`（可由共享 helper 实现）。
- `plugins/plugins/omnimux/src/catalog/list.js`：`buildModelCatalog` 默认值、analysis 默认值和 `resolveDefaultOperation` 只从 `selectable` 行解析；移除 display-only `gatewayOperationDto` / `projectGatewayPublicModels` 过渡路径和 `PREFERRED_OPERATION_MODELS` 硬编码链。
- `plugins/plugins/omnimux/src/catalog/gateway-contract.js`：移除 `GATEWAY_OVERLAY_FAMILIES` 的 text/image 限制，四类统一 overlay；`toLocalOperation` 校验 profile 存在、live、operation/output 覆盖；`toRuntimeModel` 复制本地 `routing` 并统一计算 `executionStatus`；`gatewayContractModels` 正确区分 `missingContract` 与 `adapterUnsupported`。
- `plugins/plugins/omnimux/src/catalog/contract/auto-serving-manifest.json`：移除 `canvasExcluded` 及过期说明。
- `plugins/plugins/omnimux/src/settings/schema.js`：`canvasHiddenModels` 保持旧配置 parse-only，不删用户数据。
- `plugins/plugins/omnimux/src/client/ModelsSettingsCard.jsx` / `locales.js`：删除无效的 canvasHiddenModels 开关；保留/补充只读目录诊断。

### Workflow

- `plugins/plugins/omnimux-workflow/src/shared/api.ts`：`CatalogModelDto` / `CapabilityModelItem` 增加 `visible` / `selectable` / `availabilityReason`。
- `plugins/plugins/omnimux-workflow/src/shared/validation/compatKernel.ts`：新增共享 `isSelectableModel`；`planAutoAdaptation` 只接受 `selectable` 行。
- `plugins/plugins/omnimux-workflow/src/shared/validation/operationUi.ts`：`FilteredModelOption.executable` 优先读取 `selectable`；`executionStatus` 只做原因展示。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/ModelCascadeMenu.tsx`：品牌列和型号行只选择 `executable !== false`。
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/index.tsx`：旧节点提示保留原 model 值，切换目标只取可执行行。
- `plugins/plugins/omnimux-workflow/src/workflow/analyzeModel.ts`：可执行判定兼容 `selectable !== false`。
- `plugins/plugins/omnimux-workflow/src/shared/generationPolicy.ts`：`allowedModelIds` 改为 `visibleModelIds`（或移除），`selectable` 不再依赖 policy 白名单；删除 `isCanvasModelAllowed`。

### 文档

- 原分支涉及的 `docs/contracts/{model-list-ownership,model-capabilities-matrix,generation-node-policy,hub}.md` 四份契约文档：**本仓（omnimux-client）无 `docs/` 目录**，这些文档不在此仓库，故本轮移植跳过，不在本 PR 内改动；如需同步在文档所在仓处理。
- 语义以本 spec 与 `plugins/omnimux/AGENTS.md` 的 model-truth 口径为准。

## 数据模型

`CatalogModelDto` / `CapabilityModelItem`：

```text
visible?: boolean
selectable?: boolean
availabilityReason?: 'gateway_delisted' | 'contract_missing' | 'adapter_missing' | 'profile_incomplete'
```

约束：

- `visible`：网关在售（`enableGroups` 非空）或 `source === 'custom'`。
- `selectable`：`visible && executionStatus === 'ready' && 至少一个 operation 可执行`。
- `models[]` 保持完整契约注册表，四个 bucket 为公开选择视图；不得把 `models[]` 当 picker 集合使用。
- 旧 hub 不提供 `selectable` 时，客户端按 `executionStatus === 'ready'` + bucket membership 兼容。

## 验收标准

- 新增测试：`preferredModels: { video: 'wan-3.0' }` 创建空视频节点不得选中 `wan-3.0`。
- 品牌点击 `Wan` 品牌不写入不可执行型号。
- 合成 gateway video 模型（有 v2 contract、无本地 YAML、`videoGenerate` profile 覆盖）出现在目录且 `selectable: true`。
- `wan-3.0` 有 v2 contract + profile 时 `executionStatus: 'ready'`；无 profile 时 `selectable: false`。
- `muse-video` 无 v2 contract 时进入 `gateway.missingContract`，不进入 `adapterUnsupported`。
- 旧节点保存 `wan-3.0` 时保留 `params.model`，`compat.status === 'configuration_error'`。
- `canvasHiddenModels` 旧配置可解析但不再改变可见性；设置页无无效开关。
- `canvasExcluded` 在 manifest 中归零。

## 假设

- 产品采用方案 A：生成器主选择只显示 `selectable`，未适配模型在设置页目录诊断中展示；不会把每个未适配网关模型放进 picker 置灰。
- 当前生产 video/audio 模型都具有 Gateway Contract v2；没有 v2 contract 的模型只做诊断，不伪造能力。
- `adapter-profiles.json` 的 operation 覆盖足以表示本机执行能力；是否需要新 profile 由具体模型接入任务决定。
- `models[]` 继续作为完整契约注册表，不改成员数量，减少跨插件破坏面。
- 不发起真实模型 API 请求，全部使用离线 snapshot/fixture。

## 证伪方式

- 新建视频节点在 `video: wan-3.0` 偏好下仍选中 `wan-3.0`：P0 失败。
- 品牌点击仍能写入 `executable:false` 型号：P0 失败。
- 无本地 YAML 的合成 gateway video 模型在 v2 contract + profile 覆盖下没有出现在目录：P1 失败。
- `wan-3.0` 有 v2 contract + `videoGenerate` profile 仍为 `unsupported`：P1 失败。
- `muse-video` 无 contract 仍被归入 `adapterUnsupported`：P1 失败。
- `suno-sounds` 等不可执行模型进入生成器或自动选型：P0/P1 失败。
- 旧节点 `params.model` 被自动改写：失败。
- 出现真实模型 API 请求：失败。

## 旧标准变更

- `plugins/plugins/omnimux/src/catalog/gateway-contract.test.js`：`adapterUnsupported` 从 `['suno-sounds', 'wan-3.0']` 收敛为仅真正缺 profile 的型号；`wan-3.0` 由 `unsupported` 改为 `ready`（前提是 `videoGenerate` operation coverage 通过）。
- `plugins/plugins/omnimux/src/catalog/list.test.js`：更新 `wan-3.0` 状态与 `models[]` 行上的 `selectable` 断言；保持 `models[]` 成员数不变。
- `plugins/plugins/omnimux-workflow/tests/gateway-public-model-authority.e2e.test.mjs`：由“wan 可见且 unsupported”改为“wan 有 profile 则 ready；无 profile 则 disabled 但不进入 picker”。
- `scripts/verify-cross-plugin-model-alignment.test.mjs`：移除旧 canvas `allowedModelIds` 白名单计数断言，改为 `visible/selectable` 与 catalog projection 对账。
- `plugins/plugins/omnimux/src/catalog/gateway-truth-p1b.test.js`：更新 gateway 诊断断言（`missingContract` / `adapterUnsupported` 分离）。

## 命令

```bash
pnpm --filter omnimux test
pnpm --filter omnimux-workflow test
pnpm verify:model-contracts
pnpm catalog:snapshot:check
pnpm verify:models
pnpm verify:product-baseline
pnpm test:gates
```

UI 改动另做隔离工作树真实浏览器验收（ego-browser 或 worktree Web QA），不发真实模型请求。

## 边界

- Always：保持网关快照为在售真源；保留旧配置和旧节点数据；离线 fixture 验证。
- Ask first：新增 adapter profile 类型、改网关 contract 格式、真实生成测试。
- Never：改网关仓库、官方 DSH 源码；把本地 `canvasHiddenModels` / `canvasExcluded` / 模型白名单作为新真源；静默把 unsupported 模型当 ready。
