---
name: clip-craft
description: "OmniMux Clip 专业剪辑判断层。用于剪视频、修时间轴、加字幕花字、去黑场、自动切片和导出成片。时间轴写入与导出按用户已授权范围执行；不发明未发现的工具。"
---

# Clip Craft — 剪辑判断层

本 Skill 只写**剪辑判断**。工具目录以 `clip_*` 为准，不要在回复里复述参数表。

工具时间用秒，当前 Host 旧格式 `TimelineSchema` 内部用毫秒。先用 `clip_get` 核对已保存的时间轴，再按实际时长规划。

## 工作循环

1. 从 `clip_list` 或工作流快照取实际 `projectId`。`clip_list` 的 `unavailableProjects` 会标记待迁移或读失败的文件。
2. `clip_get` 查看已保存的旧档，按需要使用 `summary`、`tracks`、`clips` 或 `full`。仅在用户要求处理旧档时用 `clip_create` 或 `clip_edit`。
3. 每次 `clip_edit` 对应旧档的一步保存历史。复杂变更先 `validateOnly: true`；成功落盘后用 `clip_diagnostics` 查空洞、重叠或素材缺失。
4. 用户正在画布 Portal 或独立 Tab 剪辑时，`clip_get` 只能读到已支持的落盘工程。`project-not-materialized` 表示画布工程未保存到 Host，`openreel-migration-required` 表示原生文件待迁移。根据实际错误说明哪一份工程可查。
5. `clip_open`、`clip_view`、`clip_snapshot`、`clip_export` 目前没有右侧实时通道，读到旧档后返回 `ui-unavailable`。播放、视觉自检和用户明确要求的导出走右侧界面，切 Tab 后重复调用不会建立通道。

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
- `set_text` / `add_text` / `set_subtitle_style` 调整旧档的 text 轨。视觉检查使用右侧预览，核对遮挡与边距。

## 自动切片策略

- 用户说「太拖 / 去停顿 / 剪掉废话」：`cut_silences`。有明确静音区间就传 `silences: [{ fromSec, toSec }]`；否则用 `minSilenceSec`（默认 0.3）收视频/音频轨缝。
- 用户给时间点：「从 3.2 秒切开」→ `split_clip` + `atSec`。切点离片段两端至少 80ms。
- 「只要 12–18 秒那句」→ `trim_clip` 或 `remove_range`，不要先整段删再加回来。
- 导入素材：`import_media`（默认可上轨）。空工程先铺 video / audio，再挂 text。
- 转场克制：硬切优先。交叉溶解 ≤400ms，黑场 ≤600ms，且只用在段落换场。连续两条都 fade 就是业余。

## 禁止

- 一次 `clip_edit` 里塞互斥操作（先删再 trim 同一 clip、先 move 到重叠位再指望 diagnostics 救）。
- 用 `clip_view` 当查询；查询走 `clip_get`。
- 在 diagnostics 仍有 `media_missing` 时宣称「可以导出」。
- 把 FFmpeg / `omnimux-video` 当多轨合成引擎。成片由本插件 WebCodecs 导出。
- 发明工具名或秒/毫秒混用却不换算。
