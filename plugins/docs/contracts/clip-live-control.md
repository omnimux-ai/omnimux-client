---
title: "画布剪辑归属与实时控制"
id: "contract-clip-live-control"
type: "contract"
status: "living"
authority: "L1"
date: "2026-11-21"
updated: "2026-11-23"
---

# 画布剪辑归属与实时控制

[阶段 1 #160](https://github.com/omnimux-ai/omnimux-client/issues/160) 定下画布归属与工具错误协议。[阶段 2 #159](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 接通 OpenReel v1 原生编辑器、Host 持久化与 Workflow 回写。[阶段 3 #157](https://github.com/omnimux-ai/omnimux-client/issues/157) 接通剪辑顶栏与主对话。运行验收按对应构建和验收项单独记录。

## 阶段 1 画布绑定与工具结果

阶段 1 已确立的画布边界沿用至今。打开节点时携带 `(workspaceId, nodeId, projectId)`，缺少工程 ID 时生成 `clip_node_…`。复制节点时分配新工程 ID，清除副本的旧草稿、成片和预览引用。阶段 1 的手工导出桥按每笔 `/save-export` 上传记录原绑定，接到回执后核对节点归属。同一节点应用新版回执后丢弃迟到的旧回执。

该阶段的工具使用旧 `TimelineSchema` 查档和写档。已保存的原生 UUID 工程报告 `openreel-migration-required`，实时打开、播放、截帧和导出在工程校验通过后抛 `ui-unavailable`。查询不触发自动跟随，截帧与导出停止返回占位结果。历史验收见 [AC-P1-01 至 AC-P1-06](../../../specs/clip-phase1-160.spec.md#证伪方式)。

## 阶段 2 实现

### 工程、归属与迁移

Clip 编辑器和 Host 使用同一 OpenReel `Project`。Host 保存含 `projectId`、`revision`、`updatedAt` 和可选画布绑定的快照。工具时间统一用秒。旧 `TimelineSchema` 的毫秒在转换时换成秒。画布下游节点的 `outputDurationMs`、兼容导出元数据和 HTTP 工程列表里的 `durationMs` 仍用毫秒。[Host 工程 Store](../../plugins/omnimux-clip/src/store/projectStore.js)

- 裸格式及包装过的原生 UUID 工程保留 ID。旧格式转换轨道、片段、素材引用、源入出点、音量、速度、字幕和可映射的转场。读取可投影已识别的旧档。首次物化或保存时原子写入新格式，并保留转换前的原档。无法映射的旧条目保留在备份中，已识别的缺项可在诊断中查看。[迁移](../../plugins/omnimux-clip/src/store/legacyProject.js)
- 首次进入 `video_composition` 时，Workflow 先保存节点绑定，再打开 Portal。Clip 以原工程 ID 物化 Host 草稿。已有 Host 工程优先，其次载入节点旧 `schema` 草稿或新建。后续自动保存更新 Workflow 的 `draftRevision`，图里继续保存绑定与成片引用。上游素材按来源和版本复用。首次导入结束并尝试保存后，入口才登记实时租约。切换节点后的迟到导入不得应用到新工程。[画布打开](../../plugins/omnimux-workflow/src/canvas/bridge/canvasClipActions.ts) · [素材导入](../../plugins/omnimux-clip/src/client/hooks/useCanvasIngestion.ts)
- 媒体字节以 Host 为单一事实源，IndexedDB 仅作可清空的 L1 缓存。执行中心提供无状态 `mediaResolver` Seam，按 `MediaHandle v1` 路由到 `project-asset`、`canvas-node`（`omnimux-workflow`）、`library-file`（`omnimux-assets`）和 `clip-vault`（`omnimux-clip`）四个 Provider，并执行 256 KiB 块级 SHA-256 校验。本地导入和录屏在保存前经 `PUT /omnimux-clip/api/projects/:id/media/:mediaId/bytes` 持久化到 `<ProjectRoot>/assets/imported/`（已绑定项目）或 `clip-vault`（独立工坊/自由画布）。打开工程前经 `POST /omnimux-clip/api/projects/:id/media/reconcile` 核对 Host 可达性与上游连线：对单候选且时长误差 ≤0.15s 的存量无摘要条目先写 `.backups/` 备份再受控升级；对 `source_drifted` 禁止静默替换（`GET .../bytes` 返回 `409 media-version-mismatch`）；画布模式重连优先展示 OmniMux 画布同步与重连面板，保原 `mediaId` 并自动收敛缩短素材的裁剪入出点。工具投影仅返回安全来源标识（含 `scope`），不暴露宿主机绝对路径。[媒体路由 Seam](../../plugins/omnimux/src/host/media-resolver.js) · [Host 对账](../../plugins/omnimux-clip/src/media/reconcile.js) · [Clip Vault](../../plugins/omnimux-clip/src/media/clipVault.js) · [画布重连面板](../../plugins/omnimux-clip/src/client/live/CanvasRelinkDialog.tsx) · [媒体恢复](../../plugins/omnimux-clip/src/client/live/native-state.ts) · [画布上游](../../plugins/omnimux-clip/src/client/hooks/useCanvasIngestion.ts)

### 可见入口、编辑权和对话上下文

画布入口是 `omnimux-workflow:canvas` 中的剪辑 Portal，归属由工作区、节点和工程三项确定。独立入口 `omnimux-clip:studio` 只绑定工程。两个入口共用原生 Store。同一渲染进程只保留一个可写入口。切页、收起面板、换工程或退出画布时，客户端先暂停旧入口并写入 IndexedDB，确认 Host 已同步后再释放编辑权。保存离线或遇到版本冲突时保留源草稿和归属，恢复同步后继续交接。退出成功后，节点有成片时回到 `completed`，否则回到 `idle`。切回时重新读取工程和草稿。[编辑会话](../../plugins/omnimux-clip/src/client/live/editor-session.js) · [画布事件](../../plugins/omnimux-workflow/src/canvas/bridge/canvasClipActions.ts)

两个入口使用 `registerContextContributor` 提交剪辑状态。Hub 在每轮第一步定向刷新认证视口。新会话尚未登记首份视口时，现有连接可用同一刷新请求提交当前视口。刷新可以越过尚未完成的普通心跳，按采集顺序和认证会话验收，最长等待 600 毫秒。确认当前会话只有一份有效剪辑视口时，`<ui_context>` 带上以下字段。超时或目标仍有歧义时，对话照常进行。[窗口刷新](../../plugins/omnimux/src/events/windows.js) · [上下文注入](../../plugins/omnimux/src/workbench/context-injector.js)

- 通用字段为 `mode`、`projectId`、`title`、`revision`、`revisionEpoch`、`playheadSec`、`durationSec`。有选段时附至多三条 `selectedClips`，每条含 `id`、`name`、`trackId`、`startSec`、`endSec`。
- 画布模式另带 `workspaceId`、`nodeId`。退出 Portal 或切走后交回普通工作台上下文。剪辑区块按白名单限长和清理字符串，排除本地文件路径、媒体字节、脚本、租约和原始工程 JSON。[上下文格式](../../plugins/omnimux/src/workbench/contract.js)

剪辑工具不通过 `surface-follow` 切页。需要进入某个工程时，显式调用 `clip_open`。已处于目标入口时直接读取该租约，否则等对应入口报告可见且工程吻合后返回。打开画布工程时聚焦对应工作区和节点 Portal，独立工程打开剪辑 Tab。[工作面跟随](../../plugins/omnimux/src/workbench/surface-follow.js) · [窗口导航](../../plugins/omnimux-clip/src/client/live/live-channel.js)

### 租约、命令与失败

1. Hub 在已有事件 WebSocket 上为每个认证窗口分配身份。Clip 通过 `/omnimux-clip/api/live/lease`、`renew`、`release` 管理短期租约。Host 核对连接证明、会话、原生 Tab 实例、编辑器实例、模式、工程、版本和可选画布绑定。客户端每 2 秒续期。隐藏、切页、换工程、断连或租约过期后，旧入口无法领取新命令。[窗口登记](../../plugins/omnimux/src/events/windows.js) · [Clip HTTP 路由](../../plugins/omnimux-clip/src/http/routes.js)
2. 当前会话唯一匹配且可见的租约可自动命中。有多个匹配项，或实时操作显式目标与可见入口不符时，返回 `AMBIGUOUS_TARGET` 和候选项，包含 `projectId`、`title`、`mode`、`visible`、`windowInstanceId`，画布另有两项绑定 ID。同窗保活的画布入口由认证视口上报，Host 复核绑定后以 `visible: false` 列出。先核对用户意图，再以工程 ID 和必要的 `windowInstanceId` 定位。无认证窗口时返回 `EDITOR_OFFLINE`，已连接但目标未就绪时可能返回 `EDITOR_NOT_VISIBLE`。原生预览不可用时返回 `PREVIEW_NOT_READY`。明确指定保存工程的 `clip_get` 可以离线查档，未物化画布工程返回 `project-not-materialized`。[目标选择](../../plugins/omnimux-clip/src/live/command-broker.js)
3. 命令以短 WS 通知 `{ requestId }` 发往目标窗口，通知不进入回放缓冲。客户端通过认证 HTTP `claim` 领取，核对身份、可见性、归属、时效和写入版本。`receipt` 携带原领取时生成的证明。重连先登记新连接的认证视口，再发送挂起回执。Host 以可重试的 `409 / VIEWPORT_NOT_REGISTERED` 回应尚未登记的窗口，客户端继续暂存回执。超时或 `outcome-unknown` 时，用原 `requestId` 和相同参数复查。同一已领取请求只执行一次，参数改变会报 `REQUEST_ID_CONFLICT`。过期请求返回 `REQUEST_EXPIRED`。[命令及回执](../../plugins/omnimux-clip/src/live/command-broker.js) · [客户端执行](../../plugins/omnimux-clip/src/client/live/live-channel.js)
4. Host 使用同会话、入口、编辑器和工程已认证的视口版本。采用 Host 版本时推进 `revisionEpoch`，迟到的旧续租和回执只属于原世代。Host 派发和领取时复核版本，编辑器执行前再次复核。写入冲突返回 `REVISION_CONFLICT` 和当前的 `currentRevision`、`currentRevisionEpoch`，工具消息保留 `[code]`，HTTP 响应携带 `error` 代码。

### 工具入参与编辑行为

以 [Host 工具注册](../../plugins/omnimux-clip/src/tools.js) 的 JSON Schema 为准。以下 `?` 表示可选。实时工具共用 `projectId?`、`windowInstanceId?`、`requestId?`，其中 `clip_open` 必须传 `projectId`。`clip_edit` 和 `clip_export` 接收 `baseRevision?` 与 `baseRevisionEpoch?`。编辑前用实时 `clip_get` 读取 `revision` 和 `revisionEpoch`，对同工程和窗口分别传入这两个版本字段。省略数字版本时采用当前租约。省略世代时，编辑和指定版本的导出核对同一会话与目标最后一次实时读取的世代。旧世代即使数字版本相同也返回 `REVISION_CONFLICT`。仅确认导出当前可见工程时可省略两个版本字段。写入与导出宜提供稳定的 `requestId`，供结果不明时复查。

十个工具的输入和输出 schema 均使用 DSH Host 支持的 JSON Schema 子集。Clip 执行时继续校验数值范围、字符串长度、批次数量及窗口身份。

| 工具 | 其他参数与结果 |
| --- | --- |
| `clip_list` | `limit?` 为 1–100，默认 50。返回 `projects`、`count`、`unavailableProjects`、`unavailableCount`。已保存列表与异常列表各自截取，异常总数另报。 |
| `clip_templates` | 只读查询 `kind?`（`all` / `graphic` / `editing` / `text_animation`）、`category?`、`templateId?`、`includeAssetLibrary?`，与 `GET /omnimux-clip/api/templates` 共用目录服务。未知 `templateId` 报 `template-not-found`。 |
| `clip_create` | 必填 `name`。`resolution?` 为 `landscape`、`portrait`、`square`，默认 `landscape`。`fps?` 默认 30。生成独立原生空工程并保存，返回 `projectId` 与初始 `revision`。 |
| `clip_open` | 打开尚未物化的画布工程时同时带 `workspaceId`、`nodeId` 和 `projectId`。已有画布工程可从保存记录解析绑定。只在用户要求打开时调用。 |
| `clip_get` | `view?` 为 `summary`、`tracks`、`clips`、`full`，默认 `summary`。可带 `trackId`、`clipId`、`fromSec`、`toSec`。返回必填整数 `revision` 和 `revisionEpoch`，实时读取另返回可选字符串 `windowInstanceId`。指定 ID 时也可读保存工程。`summary` 含 `graphicInstanceCount`，`full` 附轨道、片段、转场、素材、字幕与 `graphicInstances`。 |
| `clip_diagnostics` | 必填 `projectId`，查 Host 已保存版本并复用 `reconcileProjectMedia` 做离线归因。报告 `timeline_gap`（可见视频空档 ≥0.08 秒）、`clip_overlap`、`media_missing`（附 `reason`：`cache_miss_recoverable` / `legacy_unsigned_exact` / `source_drifted` / `legacy_ambiguous` / `missing_unlinked`、`recoverable`、可选 `suggestedSourceNodeId` 与 `scope`）及 `clip_out_of_bounds`。`ok` 表示有无问题，跨工作区越权或存储错误仍抛领域错误。 |
| `clip_edit` | 必填可读的 `description` 和 1–100 条 `operations`。`validateOnly: true` 预演。删除非空整轨或清空已有时间轴需明确授权并传 `confirmDestructive: true`。 |
| `clip_view` | 必填 `action`。`seek` 使用 `toSec`，`play` 可用 `fromSec`，`select_clips` 需 `clipIds`，传空数组清除选段。`pause` 直接暂停。返回原生播放头、播放状态、选段 ID 与版本。 |
| `clip_snapshot` | `times` 为 1–6 个时间点，或用 `fromSec`、`toSec` 和可选 `count` 等距采样。区间默认 6 帧。都省略时截当前播放头。Host 校验并保存真实合成 PNG，可附图片附件。 |
| `clip_export` | 必填 `confirm: true`，仅在用户要求渲染成片时传入。`confirm: false` 会抛 `CONFIRMATION_REQUIRED`。`resolution?` 支持 `720p`、`1080p`、`4k` 并保持画幅，`fps?` 覆盖项目帧率。返回原任务实际落盘和画布提交状态。 |

`clip_edit` 的 `operations[].type` 支持 `add_track`、`remove_track`、`set_track_state`、`import_media`、`relink_media`、`add_clip`、`trim_clip`、`split_clip`、`move_clip`、`remove_clip`、`remove_range`、`cut_silences`、`set_volume`、`set_speed`、`add_text`、`set_text`、`set_subtitle_style`、`add_transition`、`remove_transition`、静态参数 `set_clip_effect`，以及声明式动效操作 `add_graphic_instance`、`update_graphic_params`、`remove_graphic_instance`、`apply_editing_template`、`set_keyframes`、`set_text_animation`。`add_graphic_instance` 支持内置 `templateId` 或受管资产库 `libraryAssetId`（经 Host `validateGraphicTemplate` 校验后注入），直接编辑模板展开成员报 `graphic-member-readonly`，关键帧越界报 `keyframe-out-of-range`。`import_media` 接受恰好一种已授权媒体来源：`path`/`sourceUrl`（当前会话工作目录）、`libraryAssetId`（加可选 `fileId`，全局资产库）、`canvasNodeId`（加可选 `outputIndex`，画布上游节点）或 `projectAssetId`（当前绑定项目资产）。句柄类来源由 Host 经 `mediaResolver` 校验后签发会话绑定的短时 `/omnimux-clip/api/media-transfer/:token` 传流，跨工作区或越权统一返回 `path-denied`。`relink_media` 接受 `mediaId`、`source`（同上四种来源）与可选 `allowVersionUpdate`（默认 `false`，摘要漂移时拒绝并报 `media-version-mismatch`；显式 `true` 时更新版本并收敛引用该素材的片段入出点，返回 `adjustedClips` 诊断，整体纳入同一 Undo 步）。素材已在项目中时，可用 `add_clip` 的 `mediaId` 和 `trackId` 上轨。[Host 授权](../../plugins/omnimux-clip/src/media/authorizeToolMedia.js) · [原生批次](../../plugins/omnimux-clip/src/client/live/native-edit.ts) · [原生模板桥接](../../plugins/omnimux-clip/src/client/live/native-templates.ts)

整批在草稿副本上校验，所有操作通过后才以 `description` 为标签入一条原生撤销记录。校验或任一操作失败时保留原时间轴、历史和版本。`validateOnly` 不生成历史或保存。手动编辑、Agent 编辑、撤销和重做共用原生历史。播放和截图走原生预览，均不入历史。Agent 编辑、截帧和导出遵守 Motion 表达式限制，导入或工具不得替用户批准或写入脚本。[原生播放与截帧](../../plugins/omnimux-clip/src/client/live/native-view.ts) · [Motion 边界](../../plugins/omnimux-clip/src/client/live/native-motion.ts)

### 草稿保存与重连

手工编辑防抖 1.5 秒保存。Agent 批次立即尝试写 IndexedDB，再用 `expectedRevision` 和更高的 `revision` 提交 Host。`persisted` 表示本地草稿写入，`synchronized` 表示 Host 已同步。Host 不可达时继续保留本地草稿。重连后待同步草稿等待当前连接的认证视口登记，再按 `localBaseRevision` 比对远端版本。旧保存响应晚到或从其他工作面切回时，有待同步改动就恢复排程。版本分叉时，界面提供三种处理方式。处理选择期间暂停编辑器输入，包括窗口级撤销、播放和蒙版钢笔提交键。[保存与冲突](../../plugins/omnimux-clip/src/client/live/editor-session.js) · [IndexedDB 草稿](../../plugins/omnimux-clip/src/client/live/persistence.js)

1. 保留本地并保存，先备份 Host 当前版本。
2. 采用 Host 最新版本，先备份本地草稿。
3. 本地草稿另存新工程，原工程载入 Host 最新版。

### MP4 与画布提交

Agent 领命时和画布手工导出开始前，从同一 Host 预约递增的 `exportJobId`。任务固定原 `requestId`、`projectRevision`、已认证的 `revisionEpoch` 和可选画布三元组。右侧基于固定快照运行 WebCodecs，经带凭证的 `/omnimux-clip/api/exports/:id/upload` 流式上传。Host 校验 MP4 结构、轨道数据包、尺寸和时长，再原子保存独立版本文件。Host 与 Workflow 先比较与任务一起持久化的导出世代。同世代继续比较 `exportJobId` 和 `projectRevision`。采用 Host 后较低数字版本的新版成片可以胜过旧世代的较高版本。迟到的旧任务保留独立文件，状态为 `superseded`。

关闭或隐藏 Portal 后，已预约的任务仍按原绑定完成上传和提交。若渲染过程中共享编辑器切换到另一工程，渲染会报冲突。显式点击「取消导出」会中止浏览器上传，并用同一任务的上传证明通知 Host。Host 记录取消后拒绝已缓冲或随后到达的写入。导出文件已经提交时，Host 返回该任务的实际结果。[原生导出](../../plugins/omnimux-clip/src/client/live/native-export.ts) · [手工上传与取消](../../plugins/omnimux-clip/src/client/live/export-transport.js) · [Host 导出任务](../../plugins/omnimux-clip/src/export-jobs.js)

Workflow 通过 `workflowClip.commitExport` 重核节点绑定，复用 `planClipExportDownstream`，在一次 `WorkspaceStore.expectedVersion` 提交中写入来源节点、下游素材、`out -> in` 连线和任务回执。绑定本地项目时，Host 将已算好 `sha256` 的 MP4 优先硬链接（跨分区原子复制）落入 `<ProjectRoot>/artifacts/` 并以 `clip_export` 血缘登记到 `.omnimux/assets.json`，下游节点写入带 `rev=sha256:…` 的工作区文件 URL 与 `project-asset` 句柄（可直接串联至二级合成节点）；画布提交成功后回收 `exports/jobs/<id>/video.mp4` 冗余副本，`canvas-failed` 期间保留副本以保障 `retryCanvas` 幂等。存量 `/api/local-file` 下游节点在重导出时原地升级并保留用户拖动后的坐标。未绑定项目的自由画布回退到带 `rev=sha256:…` 的本地文件 URL。版本冲突后重读工作区，按最新画布内容和历史重新生成保存请求。「保留当前画布修改」保留同时在 Host 提交的成片指针和任务回执。客户端将已提交的导出字段和连线同步到适用的撤销历史，撤销普通编辑时保留成片。`/save-export` 继续服务旧调用方。[Workflow 回写](../../plugins/omnimux-workflow/src/workflow/clip/workflowClip.ts) · [画布历史合并](../../plugins/omnimux-workflow/src/canvas/bridge/rebaseClipWrite.ts)

`fileSaved` 和 `canvasCommitted` 分别表示确认落盘与画布提交。独立工程正常状态为 `file-saved`，画布成功为 `committed`。`canvas-failed` 表示 MP4 已保存且画布写入失败，Host 可用同一任务重试图更新。`superseded` 表示有更新的结果占据当前指针。报告成片和画布状态时，分别核对这两个字段。

从仓库根运行 `corepack pnpm --dir plugins verify:tools`、`corepack pnpm --dir plugins test:agent-tools`，以及 `corepack pnpm --filter omnimux-clip test`、`corepack pnpm --filter omnimux-workflow test`、`corepack pnpm --filter omnimux test`。Clip 默认测试包含走真实 HTTP、Workflow 画布 Store 与磁盘的混合导出。离线工具套件覆盖保存工程和无窗口错误。双入口、原生 Undo/Redo、真实截帧及 MP4 播放证据按 [AC-P2-01 至 AC-P2-14](https://github.com/omnimux-ai/omnimux-client/issues/159#issuecomment-7058694513) 在隔离运行环境验证。

## 阶段 3 顶栏与主对话

两个入口在导出左侧提供「AI 剪辑 / AI Edit」。剪辑区域小于 560px 时以 30×30 图标呈现，保留可访问名称和悬停标题。无工程或编辑器阻塞时无法唤起。[顶栏](../../plugins/omnimux-clip/src/client/openreel/web/components/editor/Toolbar.tsx)

Clip 先通过 Workbench 展开主对话，再用 `attachClipContext({ sessionId, editorInstanceId, signal })` 请求 Hub 读取当前工作面。Hub 核对会话与编辑器身份，从与 `<ui_context>` 相同的精简投影生成点击时的快照。该快照还包括 `revisionEpoch`。Hub 在当前会话的可见主 Composer 的原生附件区域展示一枚芯片并聚焦输入框。再次点击替换同一枚芯片的数据，关闭芯片后可再次唤起。切换会话或释放该编辑器时清除相应快照。[Clip 请求](../../plugins/omnimux-clip/src/client/live/live-channel.js) · [Composer 接入](../../plugins/omnimux/src/client/attachments/clipComposer.js)

草稿正文由原生 Composer 保管。用户手动发送后，Hub 仍按阶段 2 的认证刷新规则采集发送时的 `<ui_context>`。阶段 3 的浏览器证据按 [AC-P3-01 至 AC-P3-07](../../../specs/clip-ai-entry-157.spec.md#证伪方式) 记录。
