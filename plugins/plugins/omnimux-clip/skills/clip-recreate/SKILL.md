---
name: clip-recreate
description: "OmniMux 参考视频拆解与品牌复刻编排层。把参考视频或灵感条目拆解为结构化分镜规范，结合商品卖点、风格包与 OpenReel 原生图形和包装模板，在 omnimux-clip 中重建为可继续手调的成片工程并做同时间点视觉对照。"
disable-model-invocation: true
---

# Clip Recreate — 参考视频复刻编排层

本 Skill 负责「看参考 -> 拆节奏 -> 换内容 -> 装工程 -> 对照验收」。时间轴精度、安全区、诊断和导出的执行纪律遵守 `clip-craft`，这里不重复参数表。

## 适用边界

- 适用：参考口播精剪、产品功能演示、教程标注、标题与数据卡片包装、社媒短片结构复刻。
- 明确上限：当前阶段基于 OpenReel 原生轨道、关键帧、25 种文字动效、参数化图形模板（GraphicTemplate）与一键包装模板（EditingTemplate）复刻。如果参考片核心依赖复杂 3D 运镜、粒子或 Shader 特效，必须在动手前向用户明示边界并给出替代方案（如 AI 生成镜头或简化卡片），严禁冒充等比复刻。

## 五步复刻闭环

### 1. 读取参考与品牌真源
- 已有 `omnimux-inspiration` 条目先调 `inspiration_get`；有本地参考视频先用 `omnimux-video` 调 `media_metadata`、`video_analyze` 与 `video_scene_detect`（开启 `extractFrames` 取真实切点与关键帧）。需要逐词字幕与口播节奏时，调用 `omnimux_speech_to_text` 并设 `response_format: "verbose_json"` 提取词级时间戳；绝不凭文字描述臆测切点或节奏秒数。
- 查询用户指定的商品（`products_get`）与风格或素材资产（`assets_search` / `assets_get`），固定品牌色、字体、产品图与真实卖点；绝不沿用参考片的第三方品牌数据、口号或未核实宣称。

### 2. 输出精简 MotionSpec
动手装配前先给出一张简明分镜映射表：
- 每镜起止秒数与时长（来自真实切点或 `clip_analyze(mode: "beats" | "highlights")` 分析出的真实重拍与高光点）
- 保留项（开场钩子节奏、镜头运动方向、转场与停留时长、字幕动态风格）
- 替换项（用户的画面、录屏、文案、品牌色、配音与背景乐）
- 实现手段（实拍或生成素材 / GraphicTemplate / EditingTemplate / `import_subtitles` + `set_caption_style` / `sync_clips_to_beats` / `set_audio_ducking` / `set_keyframes` + `set_text_animation`）

### 3. 盘点模板并补齐缺口素材
- 调用 `clip_templates` 检索内置与受管资产库模板，只使用真实返回的 `templateId` 与参数 `id`。
- 缺口配音、BGM、画面或 B-roll 通过 Hub 既有生成工具（`omnimux_audio_submit`、`omnimux_image_submit`、`omnimux_video_submit`）或画布生成，等任务落盘拿到有效句柄再进 Clip，不拿未完成任务 ID 占位。

### 4. 在 omnimux-clip 原子装配
- 先用 `clip_list`、`clip_create`、`clip_get` 获取有效 `projectId`、`revision` 与 `revisionEpoch`。
- 将同阶段意图收成清晰批次（大改前先 `validateOnly: true` 预演，通过后再落盘为单个可读 Undo 步）：
  1. `import_media` 铺主视频、录屏、配音与背景音轨；
  2. 导入用户音频与字幕：对配音用 `import_subtitles` 导入词级 `transcriptJson` 或 `srt`，用 `clip_analyze(mode: "transcript")` 检查停顿与口癖并用 `cut_transcript_ranges` 做口播精剪；
  3. 节拍分析与音画对齐：对实时打开工程中的 BGM 跑 `clip_analyze(mode: "beats")`（或 `highlights`），用 `set_marker` 标出重拍切换点，再用 `sync_clips_to_beats` 对齐 B-roll / 分镜片段，并用 `set_audio_ducking` 配置人声与背景乐实时闪避；
  4. `add_graphic_instance` 落开场标题、标注卡、下三分之一与结尾 CTA，绑定品牌色与文案参数；
  5. `apply_editing_template` 套用进度条、露脸框或质感滤镜包装，`set_caption_style` 套用逐词高亮/卡拉OK等动态字幕风格，再配合克制的 `set_keyframes` 推拉与 `set_text_animation` 做关键词强调；
  6. 修改已建图形实例的参数或时长时走 `update_graphic_params`，不直接篡改其展开后的成员图层。

### 5. 双帧对照与诚实交付
- 必跑 `clip_diagnostics`，清零时间轴黑场缝隙、片段重叠、片段越界与缺失素材问题。
- 选 3–6 个关键停留点（开场钩子、核心揭示、字幕高亮、结尾 CTA）：用 `video_thumbnail_extract` 抽原片对应帧，再用 `clip_snapshot` 截复刻工程对应帧并逐一核对文字可读性、人物无遮挡、品牌色一致与节奏对齐。
- 仅在用户明确要求成片时执行 `clip_export`（传 `confirm: true`）。汇报时分开列出已还原项与剩余差异，并提示用户可直接在右侧 OpenReel 时间轴微调图形模板参数。

## 硬禁止
- 严禁把参考视频原片整段塞进工程充当复刻结果。
- 严禁臆造 `clip_templates` 未返回的模板 ID、参数名或文字动效名。
- 严禁在未运行 `clip_diagnostics` 与 `clip_snapshot` 前宣称画面还原完成。
- 严禁传入自定义 JS 表达式、脚本或审批字段。
