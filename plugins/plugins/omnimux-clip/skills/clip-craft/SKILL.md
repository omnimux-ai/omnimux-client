---
name: clip-craft
description: "OmniMux Clip 专业剪辑判断层。用于剪视频、修时间轴、加字幕花字、去黑场、自动切片和导出成片。时间轴写入与导出按用户已授权范围执行；不发明未发现的工具。"
---

# Clip Craft — 剪辑判断层

本 Skill 只写**剪辑判断**。工具目录以 `clip_*` 为准，不要在回复里复述参数表。

工具时间用秒。先用 `clip_get` 核对原生工程、轨道和最新版本，再按实际时长剪辑。

## 工作循环

1. 用 `<ui_context>` 确认当前是画布 Portal 还是独立剪辑 Tab。用户指向当前唯一可见工程时，可直接调用 `clip_get`。查某个已保存版本时传实际 `projectId`，需要找工程先用 `clip_list`。用户要求新建时用 `clip_create` 创建独立空工程。
2. `clip_get` 默认给 `summary`，需要精确位置、选段或素材时用 `tracks`、`clips`、`full`。出现 `AMBIGUOUS_TARGET` 时按候选核对用户指向，需要时请用户选工程和窗口。`project-not-materialized` 表示画布节点尚未初始化工程。需要用户打开目标时说明原因，只有用户要求打开才调用 `clip_open`。
3. 把一次剪辑意图收成一批 `clip_edit`，写清 `description`，将实时 `clip_get` 的 `revision` 和 `revisionEpoch` 分别传给同一目标的 `baseRevision` 和 `baseRevisionEpoch`。复杂变更先用 `validateOnly: true` 预演。真实写入使用稳定的 `requestId`。删除非空整轨或清空时间轴前确认用户明确要求，再传 `confirmDestructive: true`。一批成功的剪辑在编辑器里可一步撤销。
4. `REVISION_CONFLICT` 时重读原生快照，按新时间轴重算。`outcome-unknown` 时用原 `requestId` 和相同参数复查。在 `EDITOR_OFFLINE`、`EDITOR_NOT_VISIBLE` 或 `PREVIEW_NOT_READY` 时说明当前阻断。界面恢复后先核对目标和版本。
5. 编辑后用 `clip_get` 检查最新时间轴。已同步到 Host 后用 `clip_diagnostics` 查黑场、重叠、越界和缺失素材（按 `reason` 与 `recoverable` 区分缓存可自愈、存量升级、源漂移或真离线；需重连时用 `clip_edit(relink_media)`，源已更新时显式传 `allowVersionUpdate: true`）。可见编辑器用 `clip_view` 定位播放头，用 `clip_snapshot` 抽取几个关键点的合成帧检查字幕遮挡和切点。
6. 用户明确要求成片才调用 `clip_export`，传 `confirm: true`。只有 `fileSaved` 为真才能交付 MP4，画布是否已回写读 `canvasCommitted`。`superseded` 表示该任务已有更新版本，按已确认的最新结果汇报。

## 时间轴感知

- 视频轨允许 **0 间距硬切**；≥80ms 的空洞视为黑场（`timeline_gap`），默认补上或 ripple 掉。
- 同轨重叠是错误（`clip_overlap`）。移动前先看落点，不要靠预览碰运气。
- 音频可与画面错开 2–6 帧做 J/L-cut；不要为「对齐」把人声掐在词中。
- 片头钩子 ≤3s；信息段单镜 1.5–4s；口播句间呼吸可留 120–240ms，再长就 `cut_silences`。

## 花字与字幕

| 画幅 | 花字字号 | 字幕字号 | 安全区 |
|---|---|---|---|
| 1080p 横/竖 | **56px 合理**（标题可到 72） | 42px | 距画幅边 ≥8% |
| 720p | 约 40px | 32px | 同上 |
| 4k | 约 96–112px | 72px | 同上 |

- 花字预设走 caption：描边要够，浅底深描边 / 深底浅描边。不要纯白无描边扣在天空上。
- 竖屏 9:16 字幕放中下，避开平台原生胶囊与进度条（大约底边 12–18%）。
- 一句一条；单条时长跟口播，不要把整段旁白糊在一条 10s 字幕上。
- 语音转字幕优先调 `omnimux_speech_to_text` 并设 `response_format: "verbose_json"` 取词级 `words[]` 与 `segments[]`，再通过 `clip_edit` 的 `import_subtitles`（支持 `transcriptJson` / `srt` / `cues`）一次性导入原生词级字幕。
- 全局或指定轨/条字幕样式与动态逐词特效（`none` / `word-highlight` / `word-by-word` / `karaoke` / `bounce` / `typewriter`）统一走 `set_caption_style`，它会保留已有词级时间戳；单个 Title 或单条文字/位置调整继续用 `add_text` / `set_text` / `set_subtitle_style`。

## 台本、节拍与自动剪辑

- **台本分析与气口精剪**：先用 `clip_analyze(mode: "transcript")` 读出分句、`pauses` 停顿与 `fillers` 口癖区间（或用 `query` 搜索关键词），再用 `cut_transcript_ranges`（`pauses` / `fillers` / `ranges`）连同画面、音频、Marker 与词级字幕整体一步涟漪裁切；无台本时的单纯轨间空隙用 `cut_silences`。
- **节拍分析、高光与音乐卡点**：需卡点或抽高光时，先用 `clip_analyze(mode: "beats")` 读取真实 `bpm`、`beats[]` 与 `downbeats[]`，或 `clip_analyze(mode: "highlights")` 抽取高能量口播片段。拿到真实节拍点后，用 `set_marker` 标出关键卡点/章节，再通过 `sync_clips_to_beats`（推荐 `cut-to-beats` 截长对齐或 `preserve-duration` 重排起点）完成音画对齐。切勿猜测或编造 `bpm` 与节拍时间戳。
- **人声闪避**：背景音乐与人声并存时，先用 `set_audio_ducking` 将人声片段标为 `audioType: "dialogue"`、将音乐片段标为 `audioType: "music"` 并开启实时闪避（`enabled: true`, `amountDb`, `attackMs`, `releaseMs`, `holdMs`）。
- **切片与导入边界**：从指定秒数切开用 `split_clip`（距两端 ≥0.08 秒）；保留所需片段用 `trim_clip` 或 `remove_range`。媒体导入用 `import_media`（`path` / `libraryAssetId` / `canvasNodeId` / `projectAssetId`）；转场克制（交叉溶解 ≤400ms，黑场 ≤600ms）。

## 禁止

- 一次 `clip_edit` 里塞互斥操作（先删再 trim 同一 clip、先 move 到重叠位再指望 diagnostics 救）。
- 用 `clip_view` 当查询；查询走 `clip_get`。
- 在 diagnostics 仍有 `media_missing` 时宣称「可以导出」。
- 把 FFmpeg / `omnimux-video` 当多轨合成引擎。成片由本插件 WebCodecs 导出。
- 发明工具名或秒/毫秒混用却不换算。
