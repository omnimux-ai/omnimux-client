# omnimux-workflow

本页介绍画布插件及其运行入口。模型、分组、生成方式和执行规则见[画布生成契约](../../docs/contracts/canvas-generation.md)。


> 构建、隔离验收和合入后的 Dev 物化入口见[插件开发与交付](../../README.md#本地开发与交付)。


DeepSeek Harness（dsh）的工作流无限画布插件：拖拽节点、连线成 DAG、编排多模态生成任务，并允许 dsh 会话里的 **Agent 通过工具查询与执行画布**。画布自身零模型 API 调用——所有生成经 OmniMux 执行中枢的 seam 提交（M4 已接通）；数据 100% 本地文件（`$DSH_HOME/omnimux/workflow/`）。

## 产品能力总览（M1–M5）

| 里程碑 | 能力 |
|---|---|
| M1 脚手架 | 四区目录（client/canvas/host/shared）+ 三 bundle 构建；React 19 island 桥（宿主 React 18 与 island 双 React 共存）；侧边栏「工作流」入口 + product-stage 全屏页；`--wb-*` 主题变量层 + 暗色跟随 |
| M2 编辑器 | React Flow 画布 + MaterialNode（prompt/模型/参数配置面板）；连接校验链（类型矩阵/环检测/mutation gateway）；撤销重做/剪贴板/右键菜单；1s 防抖自动保存 + 乐观锁（409 冲突保护） |
| M3 执行引擎 | Kahn 拓扑分层调度 + maxParallel 节流并行；暂停/恢复/取消/单步/断点；11 事件 SSE 协议（带回放缓冲）；执行记录持久化 + 重启断点恢复；节点执行徽标 + 下游边流动动画 |
| M4 真实生成 | OmniMuxSeamClient 经 cordis seam 消费执行中枢（不 import hub、零三方依赖、不落 key）；三模式装配（omnimux/mock/auto）+ 晚绑定单向升级；seam 并发上限（默认 2）；能力目录真数据；组/子集执行（上游闭包） |
| M5 产品化 | **Agent 工具**（workflow_list / workflow_run / workflow_snapshot）+ workflow:ops 系统提示词；性能基线（200 节点 DAG 实测，见下）；渲染优化（节点 memo 修复 + 视口裁剪） |

## Agent 工具（M5）

H3 的「对口型」可先选方式，再分别添加角色图和驱动音频。官方目录要求一张图和一段音频，两项可用后即可生成。提示词可继续编辑，切回「文生视频」时保留最新草稿。画布、Agent 和无界面运行按同一份操作声明选择要提交的输入。

dsh 会话里的 Agent 可通过宿主侧工具指挥画布（注册在 cordis `tools` 座位，直连进程内 store / executionManager，无额外 HTTP 调用）。

| 工具 | 参数 | 行为 |
|---|---|---|
| `workflow_list` | `include_executions?: boolean` | 列出工作区（id/name/version/nodeCount/updatedAt，新→旧）；`include_executions=true` 附带最近 5 条执行概览（状态 + 进度） |
| `workflow_run` | `workspace_id \| workspace_name`、`execution_id?`、`mode: full\|subset\|single`、`node_ids?`、`wait?`、`timeout_ms?`（默认 120000） | 创建执行。`subset` 执行指定节点及有效上游，`single` 使用已有输入执行指定节点。`wait=true` 等待终态或超时。传返回的 `executionId` 作为 `execution_id` 查询或等待原执行。分组节点按[执行契约](../../docs/contracts/canvas-generation.md#执行和恢复)校验和恢复。 |
| `workflow_snapshot` | `workspace_id`、`include_nodes?: boolean`、`node_id?` | 查看画布摘要或完整结构。传入 `node_id` 可查看指定节点的当前分组、方式、参数和目录版本。 |
| `workflow_node_update` | `workspace_id`、`node_id`、`patch` | 更新属性。网关分组切换和参数编辑按[选择规则](../../docs/contracts/canvas-generation.md#选择和素材)执行。更换起始图时，先用 `workflow_snapshot` 的 `include_nodes=true` 读取当前绑定，再单独传入 `patch.swap_reference_images`。`slot` 为有序参考图卡槽名称，`first_edge_id` 和 `second_edge_id` 分别为当前起始图与待交换图片的连线 ID |

为节点选择网关视频线路前，按 `node_id` 读取 `workflow_snapshot`，再提交 `patch.params.model` 和 `patch.params.routing.channelGroupId`，并在需要时带上该组的新报价 `patch.params.routing.videoLineQuote`。更换模型、组或方式会应用相应默认值。当前组合内可以只修改需要调整的参数。过期报价或无法共同匹配组内规则的参数会被拒绝，节点保持原状。

更换起始图与画布共用校验和保存逻辑，保留原连线。若起始图已改变或待交换图片不可用，工具返回 `error: "mutation-rejected"` 和 `reasonCode: "input_changed"`，应先重读快照再判断是否仍需换序。

`workflow_connect` 和 `workflow_disconnect` 按[素材规则](../../docs/contracts/canvas-generation.md#选择和素材)重算入槽。已接入分组能力的节点保持用户选中的方式，已有具名绑定保留原角色。提交时只消费当前有效的槽位。

- 错误统一 `{error, message}` 返回形态（不抛出）：`invalid-args` / `workspace-not-found` / `ambiguous-workspace-name` / `invalid-subgraph` / `empty-graph` / `execution-not-found`
- 系统提示词：`ctx.systemPrompt.section` 注册 `workflow:ops`（order 60，与 omnimux-assets 的 assets:ops=50 不冲突），说明工具用法和 Agent 与画布的协作方式
- 生成结果如实上报（含 `[omnimux:<code>]` 节点错误），Agent 不编造产物

## 画布剪辑

打开 `video_composition` 节点时，Workflow 保存工作区、节点和工程的绑定，再打开当前画布内的剪辑 Portal。首次打开由 Clip Host 物化 OpenReel 草稿。复制节点会分配新工程 ID，清除副本的草稿和成片引用。剪辑查询、写入及导出使用 `clip_*` 工具。[剪辑工具参数](../../docs/contracts/clip-live-control.md#工具入参与编辑行为)

Workflow 的 `workflowClip` 服务保存草稿版本。Agent 导出回写按 `exportJobId` 去重，在同一次工作区版本提交中保存成片引用、下游视频节点和 `out -> in` 连线。再次导出更新对应的下游节点。已提交的结果随工作区重开恢复。Agent 以 `canvasCommitted` 判断成片是否已回写画布。[画布回写契约](../../docs/contracts/clip-live-control.md#mp4-与画布提交)

## 安装

```bash
# 本地源码位于 plugins/plugins/omnimux-workflow/
cd /path/to/omnimux-workflow
pnpm install       # workspace 根执行亦可：pnpm install --filter omnimux-workflow
                   # prepare 会构建四个产物；禁止 --ignore-scripts
npm run build      # 显式重建：dist/index.js、lib/client.js、lib/canvas.js、lib/director.js
```

这些构建产物**不入库**。新检出需先构建生成 `dist/` 和 `lib/*.js`。桌面 Dev 的同步与运行版本核对见[插件开发与交付](../../README.md#本地开发与交付)。

### Profile 方式加载（dsh 标准安装形态）

在目标 profile（如 `~/.dsh/profiles/<name>/package.json`）中：

```jsonc
{
  "dependencies": {
    "omnimux-workflow": "link:<omnimux-client 检出目录>/plugins/plugins/omnimux-workflow"
  },
  "dsh": { "profile": { "bundles": [ /* ...既有 bundles... */ "omnimux-workflow" ] } }
}
```

上述链接适用于手工配置的开发 profile。桌面 Dev 运行已物化的产物，源码构建、物化和运行验收分别核对。

## 打开画布

1. dsh web 侧边栏「新会话」下方出现「工作流」条目（32/14/14 规格行）
2. 点击条目 → 全屏 claim product-stage（`omnimux-workflow`）→ 首次打开时懒加载画布 island（`GET /omnimux-workflow/canvas.js`，内容 hash 缓存戳）
3. 画布内：左侧工具栏添加素材节点（文本/图片/视频/音频）→ 选中节点展开配置面板（prompt + 模型）→ 悬停节点出现锚点拖线（类型校验 + 环检测）→ 更改自动保存（1s 防抖 + 乐观锁）
4. 画布顶部执行控制条：**▶ 执行全部**（拓扑分层 + maxParallel 节流并行）/ **⏸ 暂停 / ▶ 恢复 / ✕ 取消**，进度 `completed/total` 实时更新；节点卡片显示执行徽标（运行中转圈 + 下游边流动动画 / 完成绿 / 失败红 + 错误信息），节点面板内可**单节点执行**（subset 子图：该节点 + 上游闭包）

## 执行引擎（M3）

- **调度**：Gxgen ExecutionScheduler 全量移植（TypeScript strict 化，算法语义不变）——Kahn 拓扑分层、maxParallel 并行节流（默认 3，读工作区 settings）、Promise 挂起式暂停/恢复、取消（含在途任务 abort）、单步模式、500ms 防抖 DAG 状态落盘
- **协议**：11 种 SSE 事件（execution_start / node_start / node_progress / node_complete / node_error / node_skipped / execution_paused / execution_resumed / execution_complete / execution_error / execution_cancelled），与 Gxgen 前端协议逐字段对齐；事件带回放缓冲（迟订阅也能拿到完整序列）
- **断点恢复**：执行记录与 DAG 状态持久化到 `$DSH_HOME/omnimux/workflow/executions/<id>/`（execution.json + dag-state.json，原子写）；宿主重挂载时自动恢复（fromPersistedState），暂停的执行保持暂停等待手动恢复，崩溃时在途节点自动回置 pending
- **HTTP API**（`/omnimux-workflow/*` 为 canonical 前缀，legacy `/dsh-workflow/*` 全量别名兼容）：
  - `POST /omnimux-workflow/api/workspaces/:id/executions` `{mode: 'full'|'subset', nodeIds?}`
  - `GET  .../executions`（列表）/ `GET .../executions/:execId`（状态快照）
  - `POST .../executions/:execId/pause | resume | cancel`
  - `GET .../executions/:execId/events`（SSE，text/event-stream）

## 真实网关（M4：OmniMux 执行中枢接缝）

生成的默认通道是 **OmniMuxSeamClient**（`src/workflow/seam/omnimuxGateway.ts`）：画布插件通过 cordis 依赖注入 `ctx.get('videoGenerate' | 'imageGenerate' | 'textComplete')` 消费执行中枢（hub）能力——**不 import hub 包、不自带 HTTP client、不落任何 provider key**（见[中枢边界](../omnimux/AGENTS.md#hard-bounds)）。

### 装配与降级

挂载时（`mountWorkflowHost`）按以下顺序选择网关（`src/workflow/seam/gatewaySelection.ts`）：

| 环境 | 行为 |
|---|---|
| `OMNIMUX_WORKFLOW_GATEWAY=omnimux` | 强制 seam 客户端；hub 缺席时节点错误 `[omnimux:needs-provider]`（**绝不静默 mock**） |
| `OMNIMUX_WORKFLOW_GATEWAY=mock` | 只在本地模拟生成；Hub 在场时读取其模型合同目录，未安装 Hub 时使用静态测试目录 |
| 未设置（默认 `auto`） | 探测 `ctx.get` seam：hub 在场 → seam 客户端；否则 mock。auto 模式在每次提交前重新探测，hub 晚于本插件挂载时自动升级（单向 mock→omnimux，已提交任务仍归原网关所有） |

代码注入优先级最高：`mountWorkflowHost(ctx, { gateway })` 显式传入网关时跳过装配（测试用）。

强制模拟模式只调用本地 `modelCatalog.list()` 投影模型、模式和参数，不调用生成 seam。模拟输出在执行记录和画布节点中保留 `simulated: true`，完成节点显示「模拟结果」；后续真实输出会清除该标记。模拟完成不能作为真实模型调用成功的证据。

### 输入映射（节点 data → seam 请求）

素材入口、上游文本引用及执行范围见[画布生成契约](../../docs/contracts/canvas-generation.md#选择和素材)。

| 节点字段 | seam 请求字段 | 说明 |
|---|---|---|
| `prompt` / `content` / 上游文本 | `prompt` | 按操作声明组合可用文本。普通图像及视频生成的空提示词交由上游网关校验。H3 对口型发送所选角色图和驱动音频。 |
| 上游图片产物 | `image` | i2v / 图生图 / 视觉文本输入 |
| 上游音频产物（视频节点） | `audio` | 参考音频 |
| `params.duration` | `duration` | 秒 |
| `params.model` | `model` | 省略 → hub 默认（`Config.media` + env 覆盖） |
| — | `dest` | `$DSH_HOME/omnimux/workflow/media/executions/<execId>/<nodeId>.<ext>`，**hub 负责下载落盘**，回填 `mediaUrl` 走既有 M3 链路 |
| 取消 | `signal` | AbortSignal 贯通 hub 的 submit/poll/download |

提交语义：`wait:false` 异步提交拿 `taskId` → `{ dest, taskId }` 轮询 + 下载。`textComplete` 无 taskId 机制，在 awaitTask 阶段一次性执行并把文本落盘。

图片节点的生成方式不在面板单独选择：`params.operation` 由参考图槽派生，本轮消费 0 张参考图提交 `text_to_image`，消费 ≥1 张提交该模型消费参考图的已上架 operation（`image_to_image` / `multi_reference`）。画布展示、执行前检查与请求构造共用同一派生结果。

### 并发与限流

- 节点级并发：工作区 `settings.maxParallel`（=1 串行，N>1 批量，M3 既有行为，真实网关下不变）
- **seam 级并发上限**：对 hub 的在途请求数上限，默认保守 **2**，`OMNIMUX_WORKFLOW_MAX_SEAM_CONCURRENCY` 或 `mountWorkflowHost({ seamConcurrency })` 可调——宽 DAG 不容易触发 hub 侧限流
- 组/子集执行：右键选中多个节点 →「**执行选中节点（含上游）**」；右键单节点 →「**执行此节点（含上游）**」（subset 模式，见[执行范围规则](../../docs/contracts/canvas-generation.md#执行和恢复)）

### 错误处理

hub 错误（`OmnimuxError`，带 `code`）映射为节点执行错误，格式 `[omnimux:<code>] <message>`，透传到节点徽标（Agent 工具的结果摘要同样如实上报）；单节点失败按节点 `failStrategy`（abort/skip）处理，不炸整个执行。常见 code：`needs-provider`（seam 缺失）、`omnimux-unconfigured`（未配置 OMNIMUX_API_KEY）、`unknown-model` / `unknown-provider`（路由解析失败）、`omnimux-request-failed` / `omnimux-download-failed`（HTTP 失败）。磁盘异常（如盘满）时快照写入经 tmp+rename 原子写保护——失败时旧文件完好，host 返回 500 `{error:'internal'}`；canvas.json 损坏（无法通过 zod 校验）按「工作区不存在」处理（404），不会让整个插件崩溃。

### 能力目录（模型下拉数据源）

视频生成模式的目录项可包含网关发布的 `modeKind`。中枢根据该字段提供本地化名称，画布菜单与摘要共用这组名称。图片张数等限制读取同一操作的槽位。历史节点与 Agent 工具继续使用 operation ID。

`GET /omnimux-workflow/api/capabilities` 在 seam 可达时返回 hub `modelCatalog.list()`（`source: "omnimux"`，含 `fingerprint` / `defaults` / 四类模型行，按显示名 A–Z）。目录由中枢构建，官方模型信息来自网关快照。账号目录仅对授权的本机 Host 视图返回，鉴权响应和缓存规则见下方契约。模型是否可选以及如何消费分组和操作，见[目录和协议](../../docs/contracts/canvas-generation.md#目录和协议)。`OMNIMUX_*_MODEL` env 与 Settings 默认模型字段只覆盖 **defaults**，不收缩列表。画布 ConfigPanel 无生产假回退；已保存但不在目录中的 `params.model` 保留并标 deprecated。hub 不可达 / mock 模式返回 `source: "static-stub"` 夹具。

## 性能基线（M5）

`npm run perf:baseline`（`scripts/perf-baseline.mjs`）：200 节点 / 380 边分层 DAG + **零延迟网关**（隔离调度/持久化/事件管道的纯开销，不含生成延迟），本机实测（Apple Silicon，Node 22）：

| 指标 | 数值 |
|---|---|
| 拓扑分层 `getTopologicalGroups`（50 次均值） | ~0.15ms |
| subset 上游闭包 `resolveExecutionSubgraph`（50 次均值） | ~0.14ms |
| 引擎直跑 `scheduler.execute()`（200 节点，602 事件） | ~3ms（~20 万事件/s） |
| 200 节点快照保存 PUT（JSON 序列化 + 原子写） | ~6ms |
| 创建执行 POST executions | ~6ms |
| host 全链路（创建 → SSE execution_complete，1002 事件） | ~10ms（~10 万事件/s，~2.1 万节点/s） |
| 状态快照轮询 GET executions/:id | ~0.4ms/次 |

结论：200 节点规模下 host 侧调度与事件管道开销在毫秒级，瓶颈只会出现在真实生成的网络等待（这正是 seam 并发上限守卫的场景）。

**island（浏览器）侧验证方法**（现场手动，不强制自动化）：
1. 造图：打开画布 → 控制台执行批量建节点脚本（或复制粘贴 10×20 网格），达成 200+ 节点
2. 检查 React DevTools：「Highlight updates when components render」下拖拽/框选时确认只有视口内节点重渲染（`onlyRenderVisibleElements` 视口裁剪 + `flowNodes` memo 化 + MaterialNode `memo` 三层防护）
3. DevTools Performance 面板录一段「执行全部」：主线程无长任务阻塞（SSE 事件到达时只更新变化节点的 data，无全量 setState）
4. 回归项：滚动后离屏节点重回视口时状态完整恢复（节点数据在 canvasStore，不依赖组件存活）

## 架构速览

```
┌ dsh web（宿主 React 18）────────────────────────┐
│ sidebar-entry ── shell.overlay slot             │
│      └ WorkflowStage（React 18 chrome）          │
│           └ CanvasBridge ── DOM 容器 + plain props│
├ ────────────────── React 边界（硬规则）──────────┤
┌ canvas island（自带 React 19.2.8，懒加载）──────┐
│ React Flow 画布 + MaterialNode(memo) + canvasStore│
│ 执行控制条 + useExecutionController(SSE) + 徽标  │
│ 连接校验链（Gxgen 移植） + --wb-* 主题变量层      │
├ HTTP /omnimux-workflow/*（同源 fetch + SSE）────┤
┌ host（Node，dist/index.js，零运行时三方依赖）───┐
│ ┌ Agent 工具层（M5）──────────────────────────┐ │
│ │ ctx.tools: workflow_list / _run / _snapshot │ │
│ │ ctx.systemPrompt: workflow:ops section      │ │
│ └──────┬ 直连（无 HTTP 调用）────────────────┘ │
│ WorkspaceStore（快照 + 乐观锁 + 原子写）          │
│ ExecutionManager + Scheduler + Context + SSE     │
│ 扩展点：执行器注册表 / GenerationGateway          │
│   ├ mockGateway（开发/离线回退）                  │
│   └ OmniMuxSeamClient ── ctx.get seam ──→ hub    │
└ 磁盘 $DSH_HOME/omnimux/workflow/ ──────────────┘
```

详见 `docs/ARCHITECTURE.md` 与 `docs/contracts/`。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 三 bundle 构建（host/client/canvas） |
| `npm run typecheck` | tsc（canvas + host 双 project，strict） |
| `npm run dev` | esbuild watch，改码 1-2s 重建，刷新 dsh web 生效 |
| `npm test` | host 冒烟 + 执行引擎/路由 + seam 客户端 + agent 工具测试（node --test，51 个） |
| `npm run verify:m5` | M5 自验：工具注册 + 三工具往返 + 性能基线（mock 网关，零真实请求） |
| `npm run perf:baseline` | 200 节点 DAG 性能基线（零延迟网关，输出上表数字） |
| `node scripts/m3-self-verify.mjs` | M3 执行链路端到端自验（SSE/暂停恢复取消/断点恢复） |
| `node scripts/m4-self-verify.mjs` | M4 真实网关自验（fake seam 全链路/回退/并发上限） |

## 运维注意

- **重启要杀净进程**：OmniMux Desktop 的 quit 可能残留旧 Host 进程（「假重启」）——旧进程继续以旧路由/旧 bundle 服务，表现为新前缀/新构建「不生效」。重启后若行为异常，先确认只有一个 Host 进程再排查代码。
- **核对物化产物**。候选版本在隔离环境运行，合入后从主分支按[同步流程](../../README.md#本地开发与交付)更新桌面 Dev，核对运行中的版本再验收。
- 旧会话/书签用的 `/dsh-workflow/*` 前缀长期兼容（in-memory 改写，不重定向），无需迁移。

## 已知限制

- **视频输入和参数**按[画布生成契约](../../docs/contracts/canvas-generation.md)判断。运行环境的实际分组覆盖以对应版本的测试线路验收为准。
- **音频生成不可用**：hub 无 `audioGenerate` seam；音频生成节点在真实网关下报 `[omnimux:needs-provider]`，能力目录 audio 列表为空
- **能力目录不代表真实执行历史**：目录来自 Hub 的本地合同投影；文档确认、适配就绪和真实执行证据分别记录。
- **跨进程任务恢复**按[执行和恢复](../../docs/contracts/canvas-generation.md#执行和恢复)查询原任务。任务仍在运行时沿用原提交时刻计算的剩余等待窗口。上游确认原任务无法取回时，需要重新确认输入后再创建任务。
- **Agent 修改范围**见[工具清单](../../docs/contracts/plugin-agent-tools-inventory.md#36-omnimux-workflow工作流无限画布)。结构修改和 UI 使用同一校验，破坏性操作按工具的确认字段执行。
- hub 不可达时的 auto 回退是 mock 网关（模拟生成）——`source: "static-stub"` 目录会明示；要硬保证不跑 mock，用 `OMNIMUX_WORKFLOW_GATEWAY=omnimux`
- canvas.json 损坏（zod 校验不过）按「工作区不存在」（404）处理——文件仍在磁盘上，可手工修复后恢复
- 宿主进程内 unmount 时在途执行的后台 loop 可能短暂续跑（监听已摘除，不会污染恢复记录）；进程重启场景无此问题
- React DevTools 双 root（宿主 18 + island 19）为预期现象
