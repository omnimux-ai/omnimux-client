---
name: omnimux-ecom-video-script
disable-model-invocation: true
description: "跨境带货短视频策划、爆款结构复刻与口播时长/合规脚本校验：串联 OmniMux 灵感 5D 拆解、资产与数字人、画布分镜出片和剪辑工坊，用脚本精准校验前 3 秒 Hook、多语口播时长、禁用词与参数溯源并一键导出 SRT 字幕。触发：带货视频脚本、短视频分镜、爆款复刻、口播时长校验、导出SRT、TikTok脚本、video script。"
---

# Shoppable Short-Video Script, Duration QA & SRT Export

## Overview
将商品核心卖点与灵感爆款结构转化为 15s / 30s / 60s 可直接进 OmniMux 画布与剪辑工坊执行的带货视频分镜脚本，并用 `scripts/validate_video_script.py` 确定性校验前 3 秒 Hook、口播语速时长、合规禁用词与数字参数溯源，同时支持一键导出 `.srt` 字幕。

## When to Use
- 为 TikTok / Reels / Shorts / Shopee / Amazon 编写 15s–60s 带货短视频分镜与口播；
- 拆解爆款视频结构后重构自有商品版本（只复刻节奏/钩子机制，绝不抄袭他人品牌/台词/未证实功效）；
- 进画布出片或剪辑工坊配音前，精确核对口播是否超时并导出 `.srt` 字幕轨。

## OmniMux Tools Integration
- **商品与卖点真源**：`products_get` 锁定 `core_selling_point` 与 `spec_table`；
- **爆款拆解参考**：`inspiration_*` / `video_analyze` / `omnimux_speech_to_text`；
- **角色与素材复用**：`assets_*`、`avatar_*`；
- **分镜生片与成片剪辑**：创作画布（`workflow_*`）生成分镜素材 → 视频剪辑工坊（`clip_*` + `clip-craft` Skill）合成配音/字幕/BGM 并运行 `clip_diagnostics`。

## Workflow
1. **锁定目标规格**：确认目标时长（15s / 30s / 60s）、语言（`en` / `zh` / `pt-br` / `es`）、画幅（9:16 优先）与唯一 `core_selling_point`。
2. **四段式结构写脚本**：
   - `0–3s` **Hook 强钩子**：直接抛痛点/结果画面/反常识对比（禁止「大家好今天推荐…」类慢热开场）；
   - `3–12s` **实测演示**：可视化证明核心卖点；
   - `12–24s` **参数与信任支撑**：引用 `spec_table` 真数字或解决高频顾虑；
   - `末尾 3–5s` **清晰 CTA**：引导点击小黄车/链接查看详情（禁止虚假倒计时/保证效果）。
3. **运行脚本校验与导出 SRT**：跑 `scripts/validate_video_script.py`，确保无超时、无违禁词、无未溯源数字，再交付画布/剪辑工坊。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-video-script/scripts/validate_video_script.py \
  --input <script.json> \
  --srt <captions.srt> \
  --format json
```

## Compliance & Boundaries
- 禁止夸大医疗/功效效果、绝对化保证词、引导站外私下交易或抄袭原参考视频商标；
- 仅交付脚本不等于已完成视频渲染；进入大规模付费生片前须经用户确认脚本与生成范围。

## Output Format
```markdown
# 带货短视频分镜与口播方案（{时长}s · {语种}）
## 1. 核心钩子与节奏结构
## 2. 分镜表（时间段 / 画面与运镜 / 口播台词 / 屏幕花字 / 预估朗读秒数）
## 3. 脚本时长与合规校验结果（脚本实跑输出 + SRT 路径）
```
