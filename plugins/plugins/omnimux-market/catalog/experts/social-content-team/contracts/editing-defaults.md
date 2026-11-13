---
name: editing-defaults
agents: [editing-agent]
---

# Editing Defaults Contract — 后期剪辑硬指标契约

## 1. 音画时延防崩塌（Stream Parity Check）
- 在多轨拼接、音视频混流（amix）后，必须计算音视频流的时长差：
  $$|\Delta| = |\text{Duration}_{\text{video}} - \text{Duration}_{\text{audio}}|$$
- **硬红线**：$|\Delta| \le 0.08\text{s}$（80毫秒以内）。若超过 80ms，严禁交付，必须查明原因并重新校准。

## 2. 背景音乐智能避让（Audio Ducking）
- 当解说旁白或人物对话与 BGM 共存时，BGM 音量必须自动下压 `-12\text{dB} \sim -18\text{dB}`（音量比例 `0.15 \sim 0.25`）；
- 片尾处 BGM 必须在最后 3~5 秒平滑淡出（`afade=t=out`）。

## 3. 字幕压制规范
- 默认由 `editing-agent` 在后期合成时作为独立字幕轨或滤镜叠加，视频生成阶段严禁在 Prompt 中直接生成或烧录文字。
