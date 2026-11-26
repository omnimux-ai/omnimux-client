---
name: global-ad-localizer
disable-model-invocation: true
user-invocable: true
version: 2.1.0
author: OmniMux Team
description: "面向 TikTok、Amazon 与独立站等跨境电商场景，锁定商品外观与参数真源，将已验证的带货视频与广告素材按四栏矩阵安全裂变为多国多语种版本，并用确定性脚本校验跨语种口播时长膨胀率、参数零漂移与合规红线。触发：出海本地化、多语种视频、跨境裂变、多国配音、四栏本地化、视频多语改编、ad localization、global localizer。"
description_zh: "面向 TikTok、Amazon 与独立站等跨境电商场景，锁定商品与品牌事实真源，按四栏矩阵与脚本校验安全裂变为多国多语种广告。"
description_en: "Localizes validated product video ads for TikTok, Amazon, and cross-border storefronts into culturally adapted multilingual matrices with duration-expansion and spec-drift script checks."
---

# 出海多语言视频广告本地化（Global Ad Localizer）

本技能面向 TikTok、Amazon、Instagram Reels、YouTube Shorts 与跨境独立站场景，将经过验证的商品广告素材或母版带货视频，系统化裂变为覆盖多国家、多语言与多平台画幅的本地化视频广告矩阵，并在调用任何付费模型前先用确定性脚本核验口播时长、数字参数与合规红线。

## 核心工作原则

1. **四栏本地化拆解矩阵**
   - **全球锁定项（不可篡改）**：商品实拍外观、材质工艺、包装比例、品牌主色、Logo 规范、经核实的 `spec_table` 数字参数与合规卖点。
   - **目标市场适配项（语境重塑）**：目标国族裔数字人与本地音色、居家/户外使用场景光线、货币表达、消费习惯与前 3 秒本土钩子。
   - **本地待审项（人工把关）**：母语口播文案、促销与税费表述、功效声明及目标平台广告合规准入（严禁凭空编造认证、物流时效或对比实验数据）。
   - **禁用红线**：刻板印象、未授权地标/商标、敏感宗教或政治符号、绝对化夸大承诺。
2. **平台画幅与安全区规范**
   - **TikTok / Reels / Shorts**：9:16 竖屏，避开右侧交互区与底部字幕区；前 2–3 秒建立冲突或场景反差。
   - **Amazon / 独立站商详**：16:9 或 1:1，优先清晰呈现商品结构、真实使用演示与核心卖点特写。
3. **先提案、先脚本校核、先小样、再扩量**
   - 在调用任何付费生图/生视频工具前，先交付四栏拆解矩阵并用 `scripts/check_localization_matrix.py` 校验多语种口播膨胀与参数一致性；
   - 默认先在 1 个目标市场产出 1 条核心小样镜头验证外观锁定、对口型（lip-sync）与文化自然度，获用户明确确认后再扩展至多市场批量清单；
   - 文字字幕、价格、促销标签与免责声明统一交由 Clip 后期叠层处理，不在视频生成提示词中烧录复杂小字。

## OmniMux 工具联动

- **商品与资产真源**：优先调用 `products_list` / `products_get` / `products_read_media` 读取 `spec_table` 与实拍参考图，并经 `assets_list` / `assets_search` / `assets_cloud_save` 选择匹配目标市场的数字人、本地场景与原生音色。
- **母片节奏拆解**：经 `inspiration_get` / `video_analyze` 拆解参考母片的每镜秒数上限（`duration_sec`）。
- **单市场小样与多轨交付**：在用户确认提案后，通过 `omnimux_image_submit`、`omnimux_video_submit` 或创作画布工作流（`workflow_*`）完成单市场小样生成；确认无误后再扩量，并结合剪辑工坊（`clip_*` 与 `clip-craft`、`clip_diagnostics`）完成多语字幕叠层与成片预览导出。

## 确定性校验脚本

- 从安装后的技能目录（例如 `$DSH_HOME/skills/global-ad-localizer/`）运行：

```bash
python3 scripts/check_localization_matrix.py \
  --input <localization_plan.json> \
  --format json
```

- 在 `plugins/plugins/omnimux-market/` 包根目录下也可直接运行：

```bash
python3 catalog/skills/global-ad-localizer/scripts/check_localization_matrix.py \
  --input <localization_plan.json> \
  --format json
```

- 内置多语语速基线（EN/ES/PT-BR/DE/FR/ID/MS/VI 按 WPM 计算，ZH/JA/TH 按每秒字符数计算），精确测算每个镜头各语种预计口播秒数与预算占比（`> 1.0` 报错拦截，`> 0.90` 预警提示压缩台词）。
- 核验译文中出现的数字规格均可在 `spec_table` 或显式白名单中溯源，防止翻译把 `500ml` 误译或夸大。
- 扫描 `forbidden_words` 与内置多语合规高危词，送审前实现零违规。

## 标准输出结构

1. 四栏本地化矩阵（全球锁定 / 本地适配 / 本地待审 / 禁用红线）
2. 跨语种口播时长与数字参数脚本实算表（`市场/语言 | 镜号 | 预算时长 | 预计口播时长 | 占用比 | 参数与合规状态`）
3. 单市场小样计划（待确认后执行）
4. 多市场交付台账与母语法务待复核清单

## 配套角色

- 专属多语言本地化导演角色定义见：`agents/global-ad-localizer.md`
