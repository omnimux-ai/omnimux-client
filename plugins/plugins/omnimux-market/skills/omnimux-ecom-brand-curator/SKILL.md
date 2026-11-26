---
name: omnimux-ecom-brand-curator
disable-model-invocation: true
description: "跨境品牌资产与商品冷启动建档：从商品页链接与实拍素材提取四级事实参数表、品牌色值与禁用词清单，经确定性脚本校验缺口后写入 OmniMux 商品库与资产库锚点。触发：品牌建档、商品建档、商品库整理、冷启动建档、品牌资产库、brand kit、product onboarding。"
---

# Brand & Product Cold-Start Curation

## Overview
将新卖家的零散商品链接、详情页截图与实拍素材一次性结构化沉淀为 OmniMux 的共享真源：商品库（`products_*`）中的 `spec_table`、唯一核心卖点与 `forbidden_words`，以及资产库（`assets_*`）中的白底主图锚点、品牌色值风格包与固定模特/场景资产，杜绝后续每次对话重复交代背景。

## When to Use
- 刚导入一款新商品，手里只有独立站/Amazon/Shopee/1688 链接与零散实拍图；
- 需要盘点当前商品库与资产库中缺失的必填规格、禁用词或锚点参考图；
- 在进入文案、9 图视觉、短视频与多语种本地化之前，需要先把品牌与商品真源钉死。

## Data Sources & OmniMux Tools
- **网页采集**：优先调用内置 `web_fetch` 读取商品页公开正文；若页面为动态渲染或需交互，优先通过 `browser_navigate` / `browser_get_text` 获取可见内容，受阻或需登录时请用户粘贴图文，绝不编造参数。
- **商品库真源**：`products_list` / `products_get` / `products_create` / `products_update` / `products_read_media`。
- **品牌资产锚点**：`assets_list` / `assets_search` / `assets_create` / `assets_update` / `assets_upload`；如需生成品牌专属模特三视图或场景锚点，经用户确认后再调用画布（`workflow_*`）。

## Workflow
1. **现状盘点（Bootstrap）**：先调用 `products_list` 与 `assets_list` 检查是否已有同名商品或品牌资产，避免重复建档。
2. **四级事实拆解**：将抓取与用户提供的信息严格分为：
   - **已核实事实**：明确见于实拍/官方规格表的尺寸、容量、材质、重量、件数、电源/电压、包装清单；
   - **用户确认项**：目标国家/平台、唯一核心卖点方向、价格区间与品牌调性；
   - **显式标注假设**：需要用户复核才可落盘的推断项；
   - **未知项（缺口）**：严禁脑补，列入补齐清单。
3. **运行确定性建档校验脚本**：将拟落盘的 Brand & Product Kit JSON 交给 `scripts/validate_brand_kit.py` 检查必填字段、数字单位完整度、HEX 色值规范、违禁夸大词与锚点素材完整度。
4. **确认后落盘共享库**：将校验通过的档案与待补齐缺口展示给用户，获确认后调用 `products_create` / `products_update` 与 `assets_create` 持久化，并输出供下游专家直接 `@Product` / `@Asset` 引用的索引摘要。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-brand-curator/scripts/validate_brand_kit.py \
  --input <brand_kit.json> \
  --format json
```
- 校验 `product_name`、`category`、`target_markets`、`spec_table`（至少 3 项带单位/规格的可溯源参数）、`brand_palette`（合法 `#RRGGBB`）、`forbidden_words`（去重且检查竞品/禁用词格式）、`anchor_assets`（主图白底/实拍多角度/模特与场景锚点覆盖情况）。
- 返回结构化 `status`（`pass` / `needs_input` / `fail`）、`score`（0–100 完整度）、`missing_fields`、`issues` 与规范化后的 `normalized_kit`。

## Compliance & Boundaries
- 严禁伪造未提供的材质、认证（CE/FDA/UL 等）、原产地、检测数据或买家评价；
- 写入或覆写已有商品/资产记录前须向用户列出明确变更项，删除操作必须遵守 `confirm: true` 守卫。

## Output Format
```markdown
# 品牌与商品建档报告：{商品名}
## 1. 建档校验结果（脚本实算）
- 状态：pass / needs_input / fail（完整度：XX/100）
## 2. 已核实参数真源（spec_table）
## 3. 品牌视觉规范与资产锚点清单
## 4. 禁用词清单与待补齐缺口
## 5. 下一步写入确认（Products / Assets）
```
