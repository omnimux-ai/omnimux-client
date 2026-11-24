---
name: omnimux-ecom-listing-copy
disable-model-invocation: true
description: "跨境电商多语 Listing 标题与七段式商详文案：读取商品库 spec_table 参数真源，关键词分层、母语直出（EN/PT-BR/ES等），并运行脚本执行平台标题字数、违禁词与全量数字参数溯源校验。触发：写Listing、优化标题、详情页文案、五点描述、关键词分层、多语种Listing、listing copy。"
---

# Cross-Border Listing Copy & Compliance Validation

## Overview
围绕单一参数真源（`spec_table`）和唯一核心卖点（`core_selling_point`），按目标平台语法母语直出高转化标题、五点卖点与七段式商详文案，并通过 `scripts/validate_listing.py` 执行字数上限、禁用词和数字溯源校验，零幻觉零违禁。

## When to Use
- 上新撰写或改写 Shopee / Amazon / TikTok Shop / Mercado Livre 标题与详情页；
- 根据广告诊断或评论 VOC 反馈，对特定字段做定向补丁改写；
- 将中文卖点重构为地道目标市场母语表达（EN / PT-BR / ES / SEA 语言）。

## Inputs & Contracts
- 必选真源：`spec_table`（可从 OmniMux 商品库 `products_get` 获取）、`core_selling_point`、`platform`、`language`、`forbidden_words`。
- 若缺少 `core_selling_point` 或核心规格数字，须先向用户核实，严禁编造尺寸/材质/续航/功率。

## Workflow
1. **拉取真源与平台规则**：结合 `omnimux-ecom-platform-rules` 锁定标题上限与禁区（如 Mercado Livre ≤ 60 字符、Shopee ≤ 120 字符、Amazon ≤ 200 字符）。
2. **关键词分层**：分为「核心大词（精准品类）」「场景/痛点词」「属性长尾词」，高权重前置，避免同义词无意义堆砌。
3. **母语直出七段式商详**：① 痛点开场与核心卖点 → ② 关键场景画面 → ③ 结构/材质/工艺拆解（引用 `spec_table`）→ ④ 规格与适配核对 → ⑤ 包装清单 → ⑥ 使用与保养提示（防误解）→ ⑦ 售后与合规说明。
4. **脚本硬校验**：把生成的 Listing 写入 JSON 并跑 `scripts/validate_listing.py`，未通过则修正后复跑直至通过。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-listing-copy/scripts/validate_listing.py \
  --input <listing.json> \
  --platform shopee \
  --format json
```
输入 JSON 结构：`{"title": "...", "bullets": [...], "description": "...", "spec_table": {"capacity": "500ml", "material": "304 stainless steel"}, "forbidden_words": ["BrandX"]}`。

## Compliance & Boundaries
- 禁止输出绝对化词（`100%`、`#1`、`最好`、`永久`、`garantido 100%`）、未授权品牌词与医疗功效承诺；
- 文案里每一个「数字 + 单位」都必须能在 `spec_table` 中溯源，未核实数字一律删除或请用户确认。

## Output Format
```markdown
# Listing 文案方案（{平台} · {语种}）
## 1. 关键词分层
## 2. 标题（{实测字数}/{上限}）
## 3. 五点卖点 / 核心卖点
## 4. 七段式详情页正文
## 5. 合规与参数溯源校验结果（脚本实跑输出）
```
