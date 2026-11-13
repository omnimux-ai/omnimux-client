# Storyboard Rules — 分镜脚本规则

## 景别设计规则

**相邻 Beat 必须切换景别。** 如果连续两个 Beat 都是全景或都是特写，视频会显得单调。

景别类型及用法：
| 景别 | 英文 | 用途 | Image Prompt 关键词 |
|------|------|------|-------------------|
| 全景 | Wide shot | Setup 建立场景，展示产品与环境关系 | `wide shot, full environment visible, product in context` |
| 中景 | Medium shot | 展示产品主体 + 部分环境 | `medium shot, product fills 40-60% of frame` |
| 近景 | Medium close-up | 突出产品细节 + 少量环境 | `medium close-up, product fills 60-80% of frame` |
| 特写 | Close-up | 产品纹理/材质/细节 | `close-up, macro detail, shallow depth of field` |

**典型景别组合**（3 Beat 为例）：
- 全景 → 近景 → 特写（渐进聚焦）
- 特写 → 全景 → 中景（先抓眼球再展开）
- 中景 → 全景 → 特写（先展示再铺开再收焦）

---

## Visual Delta 规则

**Visual Delta 是整个工作流的关键。** 如果相邻 Beat 的图看起来差不多，视频就不会有叙事张力。

每个 Visual Delta 必须回答：**"如果把两张图并排放，观众 1 秒内能看出什么不同？"**

合格的 Visual Delta 示例：
- "地面从干净水泥变成 60% 被绿色植被覆盖"
- "产品周围新增 5-6 个同方向倾斜的物体"
- "背景从完整建筑变成碎片悬浮状态"
- "画面从单一产品变成 20+ 个同类产品填满货架"

不合格的 Visual Delta：
- "氛围更紧张" ← 不可见
- "变化加剧" ← 太模糊
- "光线变暖" ← 差异太小，视频模型几乎不会表现

---

## Beat 数量参考

| 时长 | 建议 Beat 数 | 说明 |
|------|-------------|------|
| 5s | 2-3 | 起始 + 变化/定格 |
| 8-10s | 3-4 | 起始 + 渐变阶段 + 定格 |
| 12-15s | 4-5 | 起始 + 多阶段变化 + 定格 |

**第一个 Beat 必须是静态起始场景，最后一个 Beat 必须是定格收尾。** 中间 Beat 的数量和内容由冲突弧线自然决定。

---

## Image Prompt 景别关键词

景别必须写进 Image Prompt。示例：
- Wide: `wide shot, full environment visible, product in context`
- Close-up: `close-up, macro detail, shallow depth of field`

---

## 人物与身份规则

- 人物只在创意确实需要且身份使用有依据时加入。
- 用户提供人物参考时，保持外观、服装与身份一致；没有依据时不生成可识别真实人物。
- 背影、剪影、局部肢体和远景人物是可选叙事手段，不是规避审核的默认手段。
- 若所选模型或平台拒绝请求，停止并按政策调整创意；不得通过裁切五官、拼图或换模型来绕过。

---

## 品牌文字规则

- 仅最后一个 Beat（Payoff）的 Image Prompt 中包含品牌名/slogan
- 在 prompt 中描述文字的位置和样式，例如 `the text "BRAND NAME" in clean white sans-serif appears at the bottom center of the frame`
- 如有用户提供的 slogan，也在最后一帧中呈现
- 中间 Beat 的 prompt 中禁止包含任何文字
- Payoff 帧需要文字时，从运行时已发现的兼容图像能力中选择，并先确认其文字渲染和参考图约束。
