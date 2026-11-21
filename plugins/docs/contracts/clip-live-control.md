---
title: "画布剪辑归属与实时控制"
id: "contract-clip-live-control"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-21"
updated: "2026-11-22"
---

# 画布剪辑归属与实时控制

[阶段 1 #160](https://github.com/omnimux-ai/omnimux-client/issues/160) 定下画布归属与工具错误协议。[阶段 2 #159](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 接通 OpenReel v1 原生编辑器、Host 持久化与 Workflow 回写。本文记录阶段 2 的源码行为。运行验收按对应构建和 PRD 验收项单独记录。

## 阶段 1 画布绑定与工具结果

阶段 1 已确立的画布边界沿用至今。打开节点时携带 `(workspaceId, nodeId, projectId)`，缺少工程 ID 时生成 `clip_node_…`。复制节点时分配新工程 ID，清除副本的旧草稿、成片和预览引用。手工导出的外围桥按每笔 `/save-export` 上传记录原绑定，接到回执后核对节点归属。同一节点应用新版回执后丢弃迟到的旧回执。

该阶段的工具使用旧 `TimelineSchema` 查档和写档。已保存的原生 UUID 工程报告 `openreel-migration-required`，实时打开、播放、截帧和导出在工程校验通过后抛 `ui-unavailable`。查询不触发自动跟随，截帧与导出停止返回占位结果。历史验收见 [AC-P1-01 至 AC-P1-06](../../../specs/clip-phase1-160.spec.md#证伪方式)。

## 阶段 2 实现

### 工程、归属与迁移

Clip 编辑器和 Host 使用同一 OpenReel `Project`。Host 保存含 `projectId`、`revision`、`updatedAt` 和可选画布绑定的快照。工具时间统一用秒。旧 `TimelineSchema` 的毫秒在转换时换成秒。画布下游节点的 `outputDurationMs`、兼容导出元数据和 HTTP 工程列表里的 `durationMs` 仍用毫秒。[Host 工程 Store](../../plugins/omnimux-clip/src/store/projectStore.js)

- 裸格式及包装过的原生 UUID 工程保留 ID。旧格式转换轨道、片段、素材引用、源入出点、音量、速度、字幕和可映射的转场。读取可投影已识别的旧档。首次物化或保存时原子写入新格式，并保留转换前的原档。无法映射的旧条目保留在备份中，已识别的缺项可在诊断中查看。[迁移](../../plugins/omnimux-clip/src/store/legacyProject.js)
- 首次进入 `video_composition` 时，Workflow 先保存节点绑定，再打开 Portal。Clip 以原工程 ID 物化 Host 草稿。已有 Host 工程优先，其次载入节点旧 `schema` 草稿或新建。后续自动保存更新 Workflow 的 `draftRevision`，图里继续保存绑定与成片引用。上游素材按来源和版本复用。首次导入结束并尝试保存后，入口才登记实时租约。切换节点后的迟到导入不得应用到新工程。[画布打开](../../plugins/omnimux-workflow/src/canvas/bridge/canvasClipActions.ts) · [素材导入](../../plugins/omnimux-clip/src/client/hooks/useCanvasIngestion.ts)
- 浏览器将草稿和媒体字节保存在 IndexedDB。Host 工程保存可序列化的媒体引用，投影以 `mediaId`、`missing` 和安全来源标识表示素材状态。原生文件中失效的媒体引用需要在编辑器重新链接。[原生工程](../../plugins/omnimux-clip/src/store/nativeProject.js) · [快照投影](../../plugins/omnimux-clip/src/timeline/nativeProjectView.js)

### 可见入口、编辑权和对话上下文

画布入口是 `omnimux-workflow:canvas` 中的剪辑 Portal，归属由工作区、节点和工程三项确定。独立入口 `omnimux-clip:studio` 只绑定工程。两个入口共用原生 Store。同一渲染进程只保留一个可写入口。切页、收起面板或切换工程时，客户端暂停旧入口，刷入 IndexedDB 并尝试保存到 Host，释放租约后再加载目标工程。切回时重新读取工程和草稿。退出画布编辑时先尝试保存，至少在本地草稿写入成功后再退出。节点有成片时回到 `completed`，否则回到 `idle`。[编辑会话](../../plugins/omnimux-clip/src/client/live/editor-session.js) · [画布事件](../../plugins/omnimux-workflow/src/canvas/bridge/canvasClipActions.ts)

两个入口使用 `registerContextContributor` 提交剪辑状态。Hub 在每轮第一步从该会话的已认证窗口刷新视口。各窗口视口均成功刷新且其中只有一份有效剪辑视口时，`<ui_context>` 会带上以下字段。[上下文注入](../../plugins/omnimux/src/workbench/context-injector.js)

- 通用字段为 `mode`、`projectId`、`title`、`revision`、`playheadSec`、`durationSec`。有选段时附至多三条 `selectedClips`，每条含 `id`、`name`、`trackId`、`startSec`、`endSec`。
- 画布模式另带 `workspaceId`、`nodeId`。退出 Portal 或切走后交回普通工作台上下文。剪辑区块按白名单限长和清理字符串，排除本地文件路径、媒体字节、脚本、租约和原始工程 JSON。[上下文格式](../../plugins/omnimux/src/workbench/contract.js)

剪辑工具不通过 `surface-follow` 切页。需要进入某个工程时，显式调用 `clip_open`。已处于目标入口时直接读取该租约，否则等对应入口报告可见且工程吻合后返回。打开画布工程时聚焦对应工作区和节点 Portal，独立工程打开剪辑 Tab。[工作面跟随](../../plugins/omnimux/src/workbench/surface-follow.js) · [窗口导航](../../plugins/omnimux-clip/src/client/live/live-channel.js)

### 租约、命令与失败

1. Hub 在已有事件 WebSocket 上为每个认证窗口分配身份。Clip 通过 `/omnimux-clip/api/live/lease`、`renew`、`release` 管理短期租约。Host 核对连接证明、会话、原生 Tab 实例、编辑器实例、模式、工程、版本和可选画布绑定。客户端每 2 秒续期。隐藏、切页、换工程、断连或租约过期后，旧入口无法领取新命令。[窗口登记](../../plugins/omnimux/src/events/windows.js) · [Clip HTTP 路由](../../plugins/omnimux-clip/src/http/routes.js)
2. 当前会话唯一匹配且可见的租约可自动命中。有多个匹配项，或实时操作显式目标与可见入口不符时，返回 `AMBIGUOUS_TARGET` 和候选项，包含 `projectId`、`title`、`mode`、`visible`、`windowInstanceId`，画布另有两项绑定 ID。先核对用户意图，再以工程 ID 和必要的 `windowInstanceId` 定位。无认证窗口时返回 `EDITOR_OFFLINE`，已连接但目标未就绪时可能返回 `EDITOR_NOT_VISIBLE`。原生预览不可用时返回 `PREVIEW_NOT_READY`。明确指定保存工程的 `clip_get` 可以离线查档，未物化画布工程返回 `project-not-materialized`。[目标选择](../../plugins/omnimux-clip/src/live/command-broker.js)
3. 命令以短 WS 通知 `{ requestId }` 发往目标窗口，通知不进入回放缓冲。客户端通过认证 HTTP `claim` 领取，核对身份、可见性、归属、时效和写入版本。`receipt` 携带领取时生成的证明。工具抛 `ClipDomainError` 并在消息保留 `[code]`，HTTP 错误体携带 `error` 代码。写入版本冲突时用 `REVISION_CONFLICT` 和 `currentRevision` 提示重读。回执超时或结果为 `outcome-unknown` 时，用同一 `requestId` 和同样参数复查原调用。已领取的同一请求只执行一次，参数改变会报 `REQUEST_ID_CONFLICT`。Agent 编辑回执可随 IndexedDB 草稿恢复投递，过期请求有 `REQUEST_EXPIRED` 状态。[命令及回执](../../plugins/omnimux-clip/src/live/command-broker.js) · [客户端执行](../../plugins/omnimux-clip/src/client/live/live-channel.js)

### 工具入参与编辑行为

以 [Host 工具注册](../../plugins/omnimux-clip/src/tools.js) 的 JSON Schema 为准。以下 `?` 表示可选。实时工具共用 `projectId?`、`windowInstanceId?`、`requestId?`，其中 `clip_open` 必须传 `projectId`。`clip_edit` 和 `clip_export` 接收 `baseRevision?`，省略时用当前租约版本。编辑前宜先读取版本并显式带上。写入与导出宜提供稳定的 `requestId`，供结果不明时复查。

| 工具 | 其他参数与结果 |
| --- | --- |
| `clip_list` | `limit?` 为 1–100，默认 50。返回 `projects`、`count`、`unavailableProjects`、`unavailableCount`。已保存列表与异常列表各自截取，异常总数另报。 |
| `clip_create` | 必填 `name`。`resolution?` 为 `landscape`、`portrait`、`square`，默认 `landscape`。`fps?` 默认 30。生成独立原生空工程并保存，返回 `projectId` 与初始 `revision`。 |
| `clip_open` | 打开尚未物化的画布工程时同时带 `workspaceId`、`nodeId` 和 `projectId`。已有画布工程可从保存记录解析绑定。只在用户要求打开时调用。 |
| `clip_get` | `view?` 为 `summary`、`tracks`、`clips`、`full`，默认 `summary`。可带 `trackId`、`clipId`、`fromSec`、`toSec`。优先读当前原生投影，指定 ID 时可查已保存工程。`full` 附轨道、片段、转场、素材与字幕。 |
| `clip_diagnostics` | 必填 `projectId`，只查 Host 已保存版本。报告 `timeline_gap`（可见视频空档 ≥0.08 秒）、`clip_overlap`、`media_missing` 与 `clip_out_of_bounds` 等。`ok` 表示有无问题，有问题时为 `false`，工具本身失败仍抛领域错误。 |
| `clip_edit` | 必填可读的 `description` 和 1–100 条 `operations`。`validateOnly: true` 预演。删除非空整轨或清空已有时间轴需明确授权并传 `confirmDestructive: true`。 |
| `clip_view` | 必填 `action`。`seek` 使用 `toSec`，`play` 可用 `fromSec`，`select_clips` 需 `clipIds`，传空数组清除选段。`pause` 直接暂停。返回原生播放头、播放状态、选段 ID 与版本。 |
| `clip_snapshot` | `times` 为 1–6 个时间点，或用 `fromSec`、`toSec` 和可选 `count` 等距采样。区间默认 6 帧。都省略时截当前播放头。Host 校验并保存真实合成 PNG，可附图片附件。 |
| `clip_export` | 必填 `confirm: true`，仅在用户要求渲染成片时传入。`confirm: false` 会抛 `CONFIRMATION_REQUIRED`。`resolution?` 支持 `720p`、`1080p`、`4k` 并保持画幅，`fps?` 覆盖项目帧率。返回原任务实际落盘和画布提交状态。 |

`clip_edit` 的 `operations[].type` 支持 `add_track`、`remove_track`、`set_track_state`、`import_media`、`add_clip`、`trim_clip`、`split_clip`、`move_clip`、`remove_clip`、`remove_range`、`cut_silences`、`set_volume`、`set_speed`、`add_text`、`set_text`、`set_subtitle_style`、`add_transition`、`remove_transition` 和静态参数 `set_clip_effect`。`import_media` 需要恰好一个 `path` 或 `sourceUrl`，Host 校验解析后的文件归属当前会话工作目录及媒体白名单，越界返回 `path-denied`。素材已在项目中时，可用 `add_clip` 的 `mediaId` 和 `trackId` 上轨。普通剪辑按用户给出的范围执行，涉及其他工程先核对目标。[原生批次](../../plugins/omnimux-clip/src/client/live/native-edit.ts)

整批在草稿副本上校验，所有操作通过后才以 `description` 为标签入一条原生撤销记录。校验或任一操作失败时保留原时间轴、历史和版本。`validateOnly` 不生成历史或保存。手动编辑、Agent 编辑、撤销和重做共用原生历史。播放和截图走原生预览，均不入历史。Agent 编辑、截帧和导出遵守 Motion 表达式限制，导入或工具不得替用户批准或写入脚本。[原生播放与截帧](../../plugins/omnimux-clip/src/client/live/native-view.ts) · [Motion 边界](../../plugins/omnimux-clip/src/client/live/native-motion.ts)

### 草稿保存与重连

手工编辑防抖 1.5 秒保存，Agent 批次立即尝试写 IndexedDB，再用 `expectedRevision` 和更高的 `revision` 提交 Host。`persisted` 表示本地草稿写入，`synchronized` 表示 Host 已同步。Host 不可达时继续保留本地草稿。重连按 `localBaseRevision` 比对远端版本，能继续原保存时自动同步。版本分叉时，界面提供三种处理方式。[保存与冲突](../../plugins/omnimux-clip/src/client/live/editor-session.js) · [IndexedDB 草稿](../../plugins/omnimux-clip/src/client/live/persistence.js)

1. 保留本地并保存，先备份 Host 当前版本。
2. 采用 Host 最新版本，先备份本地草稿。
3. 本地草稿另存新工程，原工程载入 Host 最新版。

### MP4 与画布提交

版本化的 Agent 导出在领命时绑定原 `requestId`、`exportJobId`、`projectRevision` 和可选画布三元组。右侧按原生快照运行 WebCodecs，经带凭证的 `/omnimux-clip/api/exports/:id/upload` 流式上传。Host 校验 MP4 结构、视频轨、各现有轨道的数据包及尺寸、时长，再原子提交独立任务版本文件。关闭或隐藏 Portal 后，已开始的任务仍可完成原上传与提交。若共享原生编辑器在渲染期间换了工程，渲染会报冲突。迟到的旧任务标记为 `superseded`，保留其独立文件和更新任务的画布指针。[原生导出](../../plugins/omnimux-clip/src/client/live/native-export.ts) · [Host 导出任务](../../plugins/omnimux-clip/src/export-jobs.js)

Workflow 通过 `workflowClip.commitExport` 重核节点绑定，复用 `planClipExportDownstream`，在一次 `WorkspaceStore.expectedVersion` 提交中写入来源节点、下游素材、`out -> in` 连线和任务回执。首次创建下游节点，重导出更新同一节点和版本化 URL。版本冲突后重读工作区、核对归属再试。画布重新打开可从持久化工作区读到提交状态。手工导出保留画布的 `/save-export` 兼容链路。[Workflow 回写](../../plugins/omnimux-workflow/src/workflow/clip/workflowClip.ts) · [下游节点规则](../../plugins/omnimux-workflow/src/canvas/nodes/definitions/videoCompositionDownstream.ts)

`fileSaved` 和 `canvasCommitted` 分别表示确认落盘与画布提交。独立工程正常状态为 `file-saved`，画布成功为 `committed`。`canvas-failed` 表示 MP4 已保存且画布写入失败，Host 可用同一任务重试图更新。`superseded` 表示有更新的结果占据当前指针。报告成片和画布状态时，分别核对这两个字段。

从仓库根运行 `corepack pnpm --dir plugins verify:tools`、`corepack pnpm --dir plugins test:agent-tools`，以及 `corepack pnpm --filter omnimux-clip test`、`corepack pnpm --filter omnimux-workflow test`、`corepack pnpm --filter omnimux test`。离线工具套件覆盖保存工程和无窗口错误。双入口、原生 Undo/Redo、真实截帧及 MP4 播放证据按 [AC-P2-01 至 AC-P2-14](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 在隔离运行环境验证。

## 阶段 3 规划

顶栏「AI 剪辑 / AI Edit」由 [#157](https://github.com/omnimux-ai/omnimux-client/issues/157) 跟踪。目标是从两个入口聚焦左侧主对话，并预填当前工程、播放头和选段，用户自行发送。
