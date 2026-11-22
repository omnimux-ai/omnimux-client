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
5. 编辑后用 `clip_get` 检查最新时间轴。已同步到 Host 后用 `clip_diagnostics` 查黑场、重叠、越界和缺失素材。可见编辑器用 `clip_view` 定位播放头，用 `clip_snapshot` 抽取几个关键点的合成帧检查字幕遮挡和切点。
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
- 用 `add_text` 的 `kind` 选择 `subtitle` 或 `title`。用 `set_text` 和 `set_subtitle_style` 调整已有文字。用关键帧截图核对遮挡与边距。

## 自动切片策略

- 去停顿用 `cut_silences`。有明确区间时传 `silences: [{ fromSec, toSec }]`。省略区间时按 `minSilenceSec`（默认 0.3 秒）收拢轨道空档。已有片段里停顿的位置需要先确定。
- 用户要从 3.2 秒切开时，用 `split_clip` 的 `atSec`。切点离片段两端至少 0.08 秒。
- 只保留 12–18 秒那句时，用 `trim_clip` 保留所需片段，或用 `remove_range` 移除多余区间。
- 用 `import_media` 导入会话工作目录下的媒体，默认同时上轨。只入素材池时传 `placeOnTimeline: false`，之后用 `mediaId` 安排落点。空工程先铺视频或音频，再补文字。
- 转场克制：硬切优先。交叉溶解 ≤400ms，黑场 ≤600ms，且只用在段落换场。连续两条都 fade 就是业余。

## 禁止

- 一次 `clip_edit` 里塞互斥操作（先删再 trim 同一 clip、先 move 到重叠位再指望 diagnostics 救）。
- 用 `clip_view` 当查询；查询走 `clip_get`。
- 在 diagnostics 仍有 `media_missing` 时宣称「可以导出」。
- 把 FFmpeg / `omnimux-video` 当多轨合成引擎。成片由本插件 WebCodecs 导出。
- 发明工具名或秒/毫秒混用却不换算。
