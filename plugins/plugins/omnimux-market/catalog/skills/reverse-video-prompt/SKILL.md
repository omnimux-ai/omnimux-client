---
name: reverse-video-prompt
description: 将参考短视频逆向拆解为适用于 Seedance 及主流 I2V（图生视频）模型的结构化生成提示词，基于 video_reverse_prompt 真源工具严格分离参考图外观与表演/镜头/节拍指令。
---

# 反推视频生成提示词（Reverse Video Prompt for I2V / Seedance）

本技能用于将一条本地参考视频、灵感库视频或公开社媒视频逆向提炼为**可直接粘贴进 Seedance 或创作画布 I2V（图生视频）节点的高质量结构化提示词**。核心原则是围绕「人怎么动、情绪怎么变、镜头怎么看、时间节拍怎么推进」输出可执行导演指令，绝不凭空编造未看到的画面。

## 适用场景

- 用户上传参考视频或贴出链接，要求「把这个视频反推成 Seedance / AI 视频提示词」。
- 需要复用原片的动作因果、表演情绪弧与运镜节奏，同时通过参考首帧图锁定自己的人物、服装、场景或商品外观。

## 工具真源与执行步骤

按以下顺序调用当前会话已注册工具：

1. **定位或准备可分析的视频输入**：
   - 本地文件或工作区引用（`.mp4` / `.mov` / `.webm` / `@inspiration/...` / `@asset/...`）：可直接作为 `video_reverse_prompt` 的 `video` 入参；若需核查时长/画幅或压缩大视频，先用 `video_process`（`capability: "media_metadata"` 或 `"video_inline_analysis_prepare"`）。
   - 灵感库条目：先用 `inspiration_get` 或 `inspiration_search` 获取媒体路径。
   - 社媒链接（TikTok / Instagram / YouTube）：调用 `omnimux_tiktok_video`、`omnimux_instagram_post`、`omnimux_youtube_video` 或 `omnimux_social_data` 读取公开元数据与媒体线索；若无法获取可读取的视频文件，如实说明受限点并请用户上传本地视频或先导入灵感库，禁止盲猜镜头。
2. **确认关键覆盖参数（仅在用户有额外需求或存在歧义时简短确认，否则使用稳健默认值）**：
   - `identity_mode`：默认 `A`（`character_lock_upload_image`，由参考图锁人物与服装外观）；不锁特定人物时选 `B`（`describe_anonymous`）；仅复刻结构节奏时选 `C`（`structure_only`）。
   - `duration` / `aspect`：默认跟随原片；如用户指定目标时长（如 5s / 10s / 15s）或画幅（如 `9:16`、`16:9`），传入覆盖参数以按比例重映射时间码。
   - `product_or_prop_swap`：若用户要把原片道具替换为自己的产品，仅传简短替换说明（不展开长篇外观设定集）；若商品在商品库中，可用 `products_get` / `products_search` 核对真实品名与形态边界。
   - 声音/对白要求：`video_reverse_prompt` 默认执行**静默表演硬约束**（人物不张嘴说话、无口播对白，纯靠微表情、动作与氛围推进）；只有当用户明确要求生成口播/对白版本时，才在 `notes` 中显式说明。
3. **调用 `video_reverse_prompt` 生成结构化提示词**：
   - 传入 `video`、`identity_mode`，以及可选的 `duration`、`aspect`、`product_or_prop_swap`、`notes`、`dest`、`appendix_dest`。
   - 需要同时为下游 I2V 抽取参考首帧或切镜关键帧时，可按需调用 `video_process`（`capability: "video_thumbnail_extract"` 或 `"video_scene_detect"`）。

## I2V 提示词写作分工与质量守则（对齐 `video_reverse_prompt` 真源契约）

交付前对照以下规则自检 `video_reverse_prompt` 的返回结果（保留 `<<<PROMPT>>>` 与 `<<<APPENDIX>>>` 分块契约）：

1. **外观归参考图，提示词只写表演与镜头**：
   - 开篇锁定「以参考图像为准，保持人物、服装、场景与商品外观一致」，不堆砌大段外貌/妆造/装修/材质设定清单。
   - 重点写清：动作顺序与幅度终点、微表情与眼神变化、情绪起承落、机位视角、景别推进、运镜方式与禁止项。
2. **连续时间码与可计数镜头语法**：
   - 分镜节拍必须按 `0 → N 秒` 首尾相接，写明每拍的景别、视角、运镜、可见动作与叙事目的；明确硬切次数或单镜头连续。
3. **去空词与强约束**：
   - 删除「电影级、史诗、杰作、极致高清」等无执行力的形容词，改用可拍摄、可感知的光影节奏与物理动作描述。
   - 默认在【声音】与【强制约束】中保持无人声/禁口播对白、禁烧录字幕/水印/Logo（除非用户明确要求）。
4. **不确定项分离**：
   - 主提示词（`<<<PROMPT>>>`）保持紧凑、无「可能/也许」类犹疑词，可直接复制到 Seedance 或画布节点使用；推断假设、风险提示与替换建议放入 `<<<APPENDIX>>>` 或独立说明区。

## 下游衔接

- 如果用户希望直接进入生片，可询问是否创建或更新创作画布（`workflow_create` / `workflow_snapshot` / `workflow_node_add`），将参考首帧图节点与本提示词接入视频生成节点，并先确认所选模型线路与费用后再执行 `workflow_run`。
