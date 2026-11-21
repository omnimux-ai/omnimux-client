# 画布剪辑归属与实时控制

[阶段 1 #160](https://github.com/omnimux-ai/omnimux-client/issues/160) 收紧画布事件和已注册工具的失败语义。下文的阶段 2 协议按 [PRD v1.0](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 定义，待 [OpenReel v1 升级 #154](https://github.com/omnimux-ai/omnimux-client/issues/154) 合入后实施。阶段 3 的「AI 剪辑」从左侧主对话发出，另见 [#157](https://github.com/omnimux-ai/omnimux-client/issues/157)。

## 阶段 1 画布绑定与工具结果

画布节点以 `(workspaceId, nodeId, projectId)` 标识剪辑入口。节点打开时透传三个 ID，已有合法 `projectId` 继续使用，空缺时分配并记录 `clip_node_…`。粘贴副本时分配新工程 ID，移除旧 `schema`、成片与预览元数据，从 `idle` 开始。原节点以及已有成片继续使用原引用。

画布 `OPEN`、`PROGRESS`、`SAVE`、`CLOSE` 使用完整三元组。手工导出开始时，外围桥记录当前绑定。退出编辑清除画布的临时渲染状态，开始过的导出仍可按原绑定投递。

剪辑客户端在每笔 `/save-export` 上传发出时单独绑定原节点，接收 Host 的成片路径与 `revision` 后核对对应的 `SAVE`。较早的回执先到时只结算自己的上传。较新的结果先应用时，同一节点的旧回执失效，重新打开入口也无法再次投递。画布校验现有节点绑定，继续通过 `planClipExportDownstream` 写入版本并创建或复用下游节点。原生编码器和 Host 成片路径沿用现有实现。

剪辑桥只接受来自当前可见工作区的 `OPEN`。Portal 挂到对应工作区，通过画布工作台 viewport 提供 `view.extra.clip` 导航提示。Hub 遇到画布剪辑提示时保留画布页，浏览器接到自动切页请求时再次检查当前 Portal。`clip_list`、`clip_get`、`clip_diagnostics` 无条件跳过自动跟随。

- `clip_list` 保留 `projects` 与 `count`，另报 `unavailableProjects: [{ id, code, message }]` 和 `unavailableCount`。两份列表分别受 `limit` 限制，`unavailableCount` 是扫描到的总数。工程列表 HTTP 路由使用同一 Store，`projects` 的描述字段保持现有形状。
- `clip_get` / `clip_diagnostics` 可查已保存的旧 `TimelineSchema`，`clip_create` / `clip_edit` 写该格式。`clip_edit` 的单步记录属于 Host 旧档历史。
- 工具和 HTTP 先区分 `invalid-id`、`invalid-json`、`not-found`、`project-not-materialized`（`clip_node_…` 尚无保存文件）及 `openreel-migration-required`（已保存的原生 `Project`）。无法读取单个文件时返回 `project-unreadable`，对应单项 HTTP 409。列表把该条目记入 `unavailableProjects` 并继续读取其他工程。`clip_open`、`clip_view`、`clip_snapshot`、`clip_export` 读到可用旧档后抛 `ui-unavailable`。用户可在右侧操作播放与手工导出。Host 工具错误为 `ClipDomainError`，注册时将 `[code]` 带进 Harness 可读错误消息。HTTP 工程读取错误在 `error` 字段携带代码。

阶段 1 源码入口为 [画布事件](../../plugins/omnimux-workflow/src/canvas/bridge/clipEvents.ts)、[剪辑事件桥](../../plugins/omnimux-clip/src/client/CanvasBridge.js)、[自动跟随](../../plugins/omnimux/src/workbench/surface-follow.js)、[工程 Store](../../plugins/omnimux-clip/src/store/projectStore.js) 与 [工具注册](../../plugins/omnimux-clip/src/tools.js)。从仓库根运行 `corepack pnpm --filter omnimux-clip test`、`corepack pnpm --filter omnimux-workflow test`、`corepack pnpm --filter omnimux test` 和 `corepack pnpm --dir plugins test:agent-tools`。验收对应 [AC-P1-01 至 AC-P1-06](../../../specs/clip-phase1-160.spec.md#证伪方式)。

## 阶段 2 计划协议

### 工程与迁移

OpenReel v1 `Project` 是唯一编辑和持久化格式。右侧编辑器执行原生 store、渲染与 WebCodecs。Clip Host 保存带 `projectId`、`revision`、`updatedAt` 及可选画布绑定的工程快照，按预期版本原子替换。Workflow 拥有画布节点、成片引用和下游连线。Agent 与 UI 共用这两处版本校验。

| 数据来源 | 一次性迁移 |
| --- | --- |
| 旧 `TimelineSchema`（裸文件或 `schema` 包装） | 转换轨道、片段、素材、源入出点、音量、速度、字幕和转场。时间在迁移边界由毫秒精确转秒。保留可验证的旧 ID、设置、快照及媒体来源。遇到无法映射的数据，保留原档并报告缺项。 |
| 已保存的原生 UUID 工程 | 保留 UUID，校验 v1 形状和媒体引用，规范化 Host 包装并补版本。浏览器使用其原有 IndexedDB 媒体键或可验证的映射重连。 |
| 画布节点 `schema` 草稿 | 首次打开时按 `(workspaceId,nodeId)` 绑定原合法 `clip_node_…`，加载已有原生草稿或转旧格式。没有草稿时，仅按上游输入初始化一次。上游素材按来源与内容版本去重，记录稳定 `mediaId`。载入和写入都核对绑定令牌。 |

迁移先保留源文件和映射，再以来源标识、旧版本和目标 `projectId` 去重提交。已有当前版本优先载入，发现分叉交给冲突处理。失败可用原数据恢复或重试，检查 `Project` 成功落盘后才更新画布草稿指针。原生工程中的 Blob 保存在 IndexedDB 或 Host 已验证的媒体库对象。Host 工程只记 `mediaId`、来源、内容版本和缺失状态等可序列化引用。禁止把 Blob 的空 JSON 当作已迁移素材。

### 可见页面、编辑权与上下文

`ClipStage` 和独立 `OpenReelStudioTab` 共用 `useProjectStore`。同一渲染进程最多有一个可写入口。切换时先刷原工程到 IndexedDB 并按预期版本 PUT Host，再撤销旧租约并挂起旧入口，最后按目标 `projectId` 和最新 `revision` 载入后取得新租约。切回时同样重载。切去其他 Tab 或收起侧栏时先保存，暂停实时命令。画布退出前保存并释放，原节点按是否存在成片恢复 `completed` 或 `idle`。离线交接先保留本地草稿，待 Host 可达后同步。关闭 Tab 注销 contributor。

两个入口均通过 `registerContextContributor` 读当前原生快照。画布 Portal 激活时，`activeTab` 仍为 `omnimux-workflow:canvas`，保留画布信息并叠加 `view.extra.clip`。独立 Tab 为 `omnimux-clip:studio`。在 [`formatCompactContextBlock`](../../plugins/omnimux/src/workbench/contract.js) 白名单新增以下短字段，并在切走或退出时清除剪辑投影。

- 通用 `mode`、`projectId`、`title`、`revision`、`playheadSec`、`durationSec`、`selectedClips`。选段最多三条，每条仅含 `id`、`name`、`trackId`、`startSec`、`endSec`。
- 画布额外给 `workspaceId`、`nodeId`。对字符串限长并清理控制字符。投影排除本地路径、Blob、素材字节、脚本、租约和大块 JSON。首轮上下文使用最新可见入口，完整轨道和媒体信息通过工具获取。

### 租约、快照和命令

1. **登记和续期。** Hub 通过现有事件 WS 连接与同源认证 HTTP 建立关联。Host 为认证连接签发短期不透明 `leaseId`，绑定可信对话 `sessionId`、本次可信连接的 `windowInstanceId`、原生 Tab 实例、`editorInstanceId`、`mode`、`projectId`、`baseRevision` 与画布绑定。HTTP 使用认证身份并校验租约证明，原生窗口和 Tab 必须与活跃实例相符。共享 owner Peer 不代表单个窗口，客户端自报 ID 或最后到达的 viewport 也不能授予写权。跟随现有 2 秒心跳续期，过期、断连、窗口隐藏、Tab 或工程切换立即使旧租约不再可执行。重连重新登记。
2. **选择目标。** 可信执行会话下唯一可见且持有租约的工程可自动命中。显式目标与当前入口冲突，或候选多于一项且目标不明确，返回 `AMBIGUOUS_TARGET`，附 `candidates: [{ projectId, title, mode, workspaceId?, nodeId?, visible }]`。只有用户明确选定可见实例才下发命令。没有可见入口时，实时工具返回 `EDITOR_NOT_VISIBLE` / `PREVIEW_NOT_READY`，Host 断连时返回 `EDITOR_OFFLINE`。`clip_open` 只在用户明确要求打开时聚焦指定入口，等该入口回报正确工程和可见状态才成功。查档无需打开页签。
3. **读快照。** `clip_get` 优先向目标租约取无 Blob 原生快照，包含 `revision`、素材池和缺失标记、轨道、片段区间、播放头和选段。随后按 `summary`、`tracks`、`clips`、`full` 及请求范围投影。无可见入口且有明确 ID 时可读已保存快照。`clip_list` 和 `clip_diagnostics` 保持查询语义，诊断报告黑场、重叠、缺失和越界。
4. **下发和领取。** Host 记录 `requestId`、命令版本、目标租约和三元组、`baseRevision`、操作名、参数摘要以及截止时间。Hub 仅向绑定的现有 WS 连接发不可回放通知 `{ requestId }`，不进入补发缓冲。客户端凭租约通过认证 HTTP 领取，Host 同时校验同一会话和连接、目标、时效及领取状态。领取返回参数和预期版本。通用工作台打开 RPC 只做导航。
5. **执行和回执。** 客户端在原生执行入口再次核对租约、三元组、写权、可见性和 `localRevision === baseRevision`。发现本地版本前进时抛 `REVISION_CONFLICT` 并附 `currentRevision`，Agent 重读后重新计划。成功时以 `requestId` 记录操作结果、`revision` 和持久化状态，回执经认证 HTTP 提交。失败携带结构化 `ClipDomainError`。同一 ID 和同一参数只能提交一次，重复领取或回执返回原状态，参数与租约错配拒绝。Host 超时以原 ID 查状态。客户端在租约内保留结果，并与已执行的本地版本一起持久记录。若执行过但确认未到，恢复回执。结果未知时保留 `outcome-unknown`，禁止重新派发可能已发生的变更。

### 编辑、撤销和离线

P0 `clip_edit` 支持轨道增删和状态、导入素材及按 `mediaId` 上轨、裁剪/分割/移位、移除及静音区间裁切、音量/变速、字幕/花字、添加/移除转场。P1 `set_clip_effect` 只改原生静态参数。工具时间用秒，素材只走 Host 安全引用并校验范围，越界返回 `path-denied`。`clip_view` 用原生播放头/选中态执行 `seek`、`play`、`pause`、`select_clips`。`clip_snapshot` 经真实合成渲染桥获取 PNG，每次最多六帧。两个实时预览工具均不修改历史。

整批先验证，再从原生编辑入口应用。`validateOnly` 运行同一校验且零持久副作用。整批成功只入一条 OpenReel Undo 记录，使用 `description` 作标签，手动与 Agent 编辑共用历史。单个 op 失败恢复时间轴、素材、标题/图形引擎状态与历史，`revision` 保持原值。Undo/Redo 完整恢复整批状态并产生新的同步版本。绑定令牌每次切节点时更新，异步导入和导出提交前重新核对。

手动编辑防抖 1.5 秒保存 IndexedDB 并尝试同步 Host。Agent 批次完成立即保存 IndexedDB 和按预期版本 PUT Host，回执标明已同步或待同步。Host 断连时手工编辑继续保存在本地并显示离线暂存状态。重连比对 `localBaseRevision` 与 `serverRevision`，相等时静默补同步，不同则提供非阻塞三选一。界面覆盖中英与亮暗主题。

1. 保留本地并保存，先备份 Host 当前快照。
2. 采用 Host 最新版本，先备份本地草稿。
3. 本地另存新工程，原工程载入 Host 最新版。

普通剪辑按用户给出的范围执行。删除非空整轨、清空时间轴、改其他工程需用户明确指令或确认。阶段 2 禁止 Agent 写入、执行、启用 Motion Expression 代码，导入与工具都不能自签 `approved` / `trusted`。手工批准继续由编辑器 UI 审查。编辑器沿用左侧主对话，不恢复浏览器直连外部模型或协作服务。

### 导出文件与画布提交

仅在用户明确要求成片后创建任务。Host 为每个新任务分配唯一递增 `exportJobId`，绑定 `requestId`、源 `projectRevision`、租约和原画布三元组。浏览器用该固定快照和原生 WebCodecs 编码，按任务流式上传。Host 校验上传归属、媒体格式与写入完整性，在同一文件系统原子提交独立版本文件。返回文件身份、字节、尺寸、时长和版本。超时查询原任务。旧任务晚于新任务提交时标为 `superseded`，历史文件可保留，最新指针保持新任务。

画布回写由 Workflow 持久化服务执行。用最新 `WorkspaceStore` 快照验证节点绑定，继承 `planClipExportDownstream` 的创建/复用规则。把源节点的成片属性、下游素材节点和边作为一次 `expectedVersion` 更新提交。冲突后重读并重新验证原三元组和最新导出任务，按现有 GraphMutator 的重试语义处理。`exportJobId` 是幂等键，重复回写复用原结果。画布卸载后仍可提交，只要原绑定与版本检查成立。状态分别报告 `fileSaved` 与 `canvasCommitted`，后者失败可重试图更新。只报告实际提交的状态。

阶段 2 按 PRD 的 AC-P2-01 至 AC-P2-14 独立验收，覆盖原档迁移、双入口首轮注入、用户与 Agent 共用撤销、并发与断连、多窗拒绝和可播放的 MP4。保持桌面壳接口，复用 Hub WS、Host HTTP 和 Workflow 版本存储。
