---
name: omnimux-ecom-global-localizer
disable-model-invocation: true
description: "跨境多国多语种带货视频与广告素材本地化裂变：锁定商品库外观与数字参数真源，按四栏矩阵拆解目标市场方案，用确定性脚本校验跨语种口播时长膨胀率、参数零漂移与本地红线，再单市场小样验证并驱动画布与剪辑工坊合成。触发：出海本地化、多语种视频、跨境裂变、多国配音、四栏本地化、本土化、ad localization、global localizer。"
---

# Cross-Border Four-Column Ad & Video Localization

## Overview
面向 TikTok、Amazon、Instagram Reels、YouTube Shorts 与跨境独立站，将已验证的母版带货视频或广告分镜安全裂变为覆盖多国家、多语言与多平台画幅的本地化版本。全程严格锁定商品本体与数字参数真源，用 Python 脚本在调用付费模型前先拦截跨语种口播撑爆时长、数字篡改与目标国红线问题。

## When to Use
- 已有 1 条跑通转化的母版带货视频/分镜，需要扩量到美区（EN）、巴西（PT-BR）、拉美（ES）、东南亚（ID/VI/TH/MS）或欧洲（DE/FR）市场；
- 需要替换本地族裔数字人、母语配音、对口型（lip-sync）与 Clip 多轨母语字幕；
- 需要批量校验多国翻译口播脚本是否超出原镜时长预算或丢失数字参数。

## Data Sources & OmniMux Tools
- **商品与资产真源**：`products_list` / `products_get` / `products_read_media`、`assets_list` / `assets_search` / `assets_cloud_save`（优先从内置云端资产库挑选匹配目标市场的数字人、本地场景与原生音色）。
- **参考拆解**：`inspiration_get` / `video_analyze`（拆解母片镜头节奏与每镜时长预算）。
- **制作与合成**：经用户确认单市场小样后，调用 `workflow_*`（画布分支 + H3 对口型/音视频节点）与 `clip_*`（加载 `clip-craft` 完成多语字幕对轨、`clip_diagnostics` 排错与确认后导出）。

## Workflow
1. **锁定商品真源与母片节奏**：读取商品库 `spec_table`、实拍参考图与禁用词，明确母片每镜秒数上限（`duration_sec`）。
2. **输出四栏本地化方案**：按国家/语言输出：
   - **全球锁定项**：商品轮廓/材质/包装比例、品牌 Logo 与经核实的 `spec_table` 数字；
   - **本地适配项**：目标国族裔数字人、生活场景光线、货币表达、文化习惯与本土前 3 秒钩子；
   - **本地待审项**：促销税费口径、功效/合规声明、需母语复核的口语表达；
   - **禁用红线**：未授权商标/地标、宗教敏感符号、绝对化夸大词。
3. **运行确定性本地化矩阵校验脚本**：把各市场口播/字幕 JSON 传入 `scripts/check_localization_matrix.py`，核验跨语种口播时长膨胀率（不得超过镜头预算）、数字参数零漂移与违禁词零命中。
4. **单市场小样验证 → 批量扩量**：先在 1 个目标市场跑 1 条核心镜头小样验证外观锁定、口型同步与文化自然度；获用户明确确认后再批量铺开其余市场并在 Clip 工坊完成多语字幕与预览交付。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-global-localizer/scripts/check_localization_matrix.py \
  --input <localization_plan.json> \
  --format json
```
- 内置多语语速基线（EN/ES/PT-BR/DE/FR/ID/MS/VI 按 WPM 计算，ZH/JA/TH 按每秒字符数计算），精确测算每个镜头每个语种的预计口播秒数与时长占比（`> 1.0` 报错拦截，`> 0.90` 预警提示压缩台词）。
- 核验全部出现在母版/译文中的数字规格均可在 `spec_table` 或显式白名单中溯源，防止翻译把 `500ml` 误译或夸大。
- 扫描 `forbidden_words` 与内置多语合规高危词，确保送审前零违规。

## Compliance & Boundaries
- 严禁未经小样确认直接批量提交多国付费生视频任务；
- 文字字幕、价格与促销标签必须留在 Clip 后期叠层，不在视频生成提示词中烧录复杂小字；
- 严禁编造目标国认证、物流时效或对比实验数据。

## Output Format
```markdown
# 多国本地化裂变方案：{商品名}
## 1. 四栏本地化矩阵（全球锁定 / 本地适配 / 本地待审 / 禁用红线）
## 2. 跨语种口播时长与参数校验结果（脚本实算）
| 市场/语言 | 镜号 | 预算时长 | 预计口播时长 | 占用比 | 参数与合规状态 |
## 3. 单市场小样计划（待确认后执行）
## 4. 交付台账与母语法务待复核项
```
