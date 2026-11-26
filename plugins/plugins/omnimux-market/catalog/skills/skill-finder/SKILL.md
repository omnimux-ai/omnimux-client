---
name: skill-finder
disable-model-invocation: true
user-invocable: true
version: 1.0.0
author: OmniMux Team
description: "按创作或营销运营目标，精准检索 OmniMux 已安装技能与官方垂直精品目录，比较适用边界与前置条件并指导安装启用。触发：找技能、推荐 Skill、有什么技能、find skill、skill finder。"
description_zh: "按创作与电商运营目标检索 OmniMux 已有及可装精品 Skill，对比适用场景并引导启用。"
description_en: "Discover installed and marketplace OmniMux skills matched to your content creation or e-commerce growth workflow."
---

# 智能发现技能（OmniMux Skill Finder）

本技能帮助用户在面对具体视频创作、爆款复刻、视觉制作、选品调研或增长运营需求时，从 OmniMux 官方垂直精品目录与本机已装技能中快速定位最合适的那一款或组合链路，避免盲目试错。

## 何时使用

- 用户不确定 OmniMux 是否已有现成技能可解决当前工作流问题；
- 用户描述了一个复合任务（如「先查竞品评论痛点，再写脚本并导剪辑草稿」），需要串联多款垂直 Skill；
- 需要排查本机已安装了哪些扩展技能，或将未安装技能推荐并引导一键安装。

## 检索与推荐流程

### 第 1 步：提炼任务意图与所属场景
将用户诉求归纳到 6 大核心垂直场景之一或组合链路：
1. **短视频创作**：`create-selling-video`、`stickman-video-director`、`character-scene-storyboard`、`cinematic-motion-language`、`omnimux-ecom-video-script`
2. **爆款复刻与再制**：`replicate-viral-video`、`video-hook-analysis`、`reverse-video-prompt`、`replicate-carousel`、`omnimux-content-repurposing`、`omnimux-transcript-intelligence`
3. **商品视觉与海报**：`shoppable-carousel`、`ecommerce-image`、`dynamic-poster`、`omnimux-ecom-visual-qa`、`omnimux-ecom-brand-curator`
4. **选品与社媒洞察**：`omnimux-ecom-market-research`、`omnimux-product-demand`、`omnimux-ecom-review-voc`、`omnimux-trend-discovery`、`omnimux-outlier-post-finder`、`omnimux-creator-teardown`、`omnimux-competitor-research`、`omnimux-social-listening`
5. **投放与增长运营**：`ad-creative`、`global-ad-localizer`、`omnimux-ecom-ads-diagnosis`、`omnimux-ecom-listing-copy`、`omnimux-ecom-pricing-strategy`、`content-strategy`、`social-caption`、`tiktok-growth`
6. **剪辑与效率工具**：`clip-craft`、`clip-export`、`skill-creator`、`skill-finder`

### 第 2 步：查询真实库存与目录（严禁臆造技能）
按需调用已注册工具核实真实可用状态：
1. 先调用 `skillhub_list` 查看本机当前已安装与启用的技能列表；
2. 再调用 `skillhub_search`（传核心中英文关键词，必要时拆分多个短词检索）查询官方精品目录与可扩展仓库中的实时匹配项；
3. 如用户任务更需要整套带工具裁剪的专职角色而非单一技能，顺带说明可经 `plaza_search` 查看相关专家方案（不擅自强制聘用或覆盖用户现有会话配置）。

### 第 3 步：输出清晰对比建议与启用方式
- 按匹配度精选 **1–3 款**最贴合的技能（或明确串联顺序），绝不堆砌冗余列表；
- 明确列出每款技能的真实状态（已内置 / 本机已安装 / 需从市场安装）、适用原因、输入要求以及可直接执行的斜杠指令（如 `/replicate-viral-video`）；
- 若用户确认需要安装未就绪的技能，引导确认后调用 `skillhub_install` 执行安装；若现有目录无匹配能力，诚实告知边界，并建议直接使用 `/skill-creator` 沉淀专属自定义 Skill。
