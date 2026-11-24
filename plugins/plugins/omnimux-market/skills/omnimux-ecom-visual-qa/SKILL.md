---
name: omnimux-ecom-visual-qa
disable-model-invocation: true
description: "跨境电商 9 图视觉矩阵规划、画布批量出图与主图像素级合规质检：锁定商品实拍外观与色值，规划首图/核心卖点/痛点对比/尺寸规格/细节配件图，并运行脚本检查分辨率、画幅、白底边距、主体占比与自动白边修复（--fix）。触发：电商主图、9图规划、商详视觉、白底图检测、主图质检、主体占比、A+图片、visual qa。"
---

# E-commerce 9-Image Visual Stack & Main Image Pixel QA

## Overview
将商品库实拍参考图与唯一核心卖点转化为高转化 9 图视觉矩阵（含 A+ / Carousel），通过 OmniMux 创作画布批量生成素材，并用 `scripts/check_main_image.py` 执行客观像素级合规检查与 `--fix` 规范化输出。

## When to Use
- 规划跨境商品 9 张主图与商详配图分工；
- 用创作画布基于实拍参考图批量出图，保证外观/色值/Logo 不漂移；
- 上架前对首图及卖点图执行白底纯度、分辨率、1:1 画幅与主体占比核验。

## OmniMux Tools Integration
- **真源锁定**：先用 `products_get` 读取商品实拍图与 `spec_table`，确认 `core_selling_point`（未确认唯一主卖点前不开工批量出图）。
- **画布批量生成**：在创作画布（`workflow_*`）里搭建图像生成节点与参考槽位，先出首图与 1 张锚点风格图请用户确认，再批量跑完其余图位；不得在未经授权时擅自扩大付费生图数量。

## Workflow
1. **9 图分工表（先确认再生图）**：
   - 图 1：合规白底首图（无文字水印，主体占比 65%–90%）；
   - 图 2：核心卖点首屏图（呼应唯一 `core_selling_point`）；
   - 图 3：痛点对比图（使用前 vs 使用后，禁止虚假功效）；
   - 图 4：核心场景代入图；
   - 图 5：精确尺寸与核心参数标注图（全部数字取自 `spec_table`）；
   - 图 6：材质/工艺微距细节图；
   - 图 7：开箱配件清单图（降低「少件/误解」差评）；
   - 图 8：使用步骤/防误解提示图（承接评论 VOC 反馈）；
   - 图 9：包装实拍与品质保障图。
2. **锚点试跑 → 批量生成**：严禁修改产品轮廓、件数、Logo 或凭空贴上未获认证的 CE/FDA 徽章。
3. **像素级质检与修复**：逐张运行 `scripts/check_main_image.py`，白底或占比不达标时使用 `--fix` 居中补白边并复检。

## Deterministic Scripts
```bash
# 检查单张主图是否符合 Amazon / Shopee / Mercado Livre 规范
python3 skills/omnimux-ecom-visual-qa/scripts/check_main_image.py \
  --input <main.png> \
  --platform amazon \
  --format json

# 自动规范白底方图并调整至合规分辨率与主体占比
python3 skills/omnimux-ecom-visual-qa/scripts/check_main_image.py \
  --input <raw.png> \
  --platform amazon \
  --fix --output <main_fixed.png>
```

## Compliance & Boundaries
- 不虚构产品实拍细节、颜色、配件数量或认证标志；
- 像素脚本校验的是客观合规项（尺寸、比例、白底、主体占比），不替代人工对产品外观失真的复核；
- 纯 Python 标准库原生支持 PNG 完整像素分析与 `--fix`；处理 JPEG/WebP 像素分析时建议使用内置 Python（带 Pillow，通过 `load_workspace_dependencies` 获取路径）。

## Output Format
```markdown
# 9 图视觉规划与主图质检报告：{产品名}
## 1. 9 图视觉矩阵（图位 / 目的 / 画面元素 / 溯源参数）
## 2. 画布生成与参考图锁定说明
## 3. 主图像素合规质检表（脚本实测：尺寸 / 比例 / 白底率 / 主体占比 / 结论）
```
