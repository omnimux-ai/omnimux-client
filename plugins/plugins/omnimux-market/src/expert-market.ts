/**
 * @file plugins/omnimux-market/src/expert-market.ts
 * Built-in Cross-Border E-commerce SOP Expert Roster and reconciliation logic.
 *
 * Single Source of Truth:
 * - Runtime "employed" (`enabled`) status is derived ONLY from official
 *   `ctx.agentPresets.list()` (registered & not broken).
 * - Legacy `$DSH_HOME/.agent-presets/` is NOT scanned for status determination.
 * - `$DSH_HOME/omnimux-market/installed-experts.json` records user install/disable
 *   intent (used to distinguish `disabled` vs `available` and restore installed
 *   experts on Host restart).
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readExpertLedger } from './expert-ledger.js'
import { writeAgentPreset } from './expert-presets.js'
import { generatePixelAvatarDataUrl } from './expert/pixel-avatar.js'
import type { ExpertToolDomain } from './expert-tool-domains.js'

export type ExpertStage = 'research' | 'production' | 'growth' | 'system' | 'custom'
export type ExpertStatus = 'enabled' | 'available' | 'disabled' | 'system' | 'custom' | 'coming_soon'

export interface ExpertBootstrapStarter {
  readonly id: string
  readonly labelZh: string
  readonly labelEn: string
  readonly promptZh: string
  readonly promptEn: string
}

export interface MarketExpertItem {
  id: string
  name: string
  nameEn: string
  description: string
  descriptionEn: string
  avatar: string
  initialStatus: 'available' | 'coming_soon'
  order: number
  stage: ExpertStage
  skills: string[]
  toolDomains?: ExpertToolDomain[]
  starters?: ExpertBootstrapStarter[]
  group?: 'ecommerce' | 'system' | 'custom'
  trust?: 'system' | 'user'
  status?: ExpertStatus
  broken?: string
}

export interface DiscoveredPresetRef {
  id: string
  name?: string
  description?: string
  order?: number
  trust?: 'system' | 'user'
  broken?: string
}

const SHARED_EXPERT_GUARDRAILS = [
  '【核心工作原则】',
  '1. 参数与算术真源：所有数字（市场容量、CR10、毛利率、盈亏价、标题字数、主图占比、口播时长、盈亏线 ROAS、差评分类计数、建档完整度与多语口播时长比）必须调用配套 Skill 内的 Python 确定性脚本计算与核验，严禁心算或编造数据。',
  '2. 事实四级分类：严格区分「工具实测/导出表事实」「用户确认输入」「显式标注假设」「未知项」；缺关键数据时先停下来向用户确认，不伪造材质、尺寸、认证、销量或评论。',
  '3. 合规红线：严禁输出刷单、虚假好评、侵权/未授权品牌词、医疗/夸大功效承诺、绝对化违禁词或保证爆款/防封号承诺；涉及广告调价与卖家后台操作只出分级审批动作清单，不代操作后台。',
  '4. 能力诚实边界：所有工具调用以当前会话 Tool Registry 实际已注册工具为准，不虚标未上线自动发布或未接入平台能力；外部付费批量生成与破坏性删除须先获用户明确确认。',
  '5. 首启引导协议（Bootstrap）：当用户首轮仅发简短问候、泛化提问或直接丢入裸链接/表格时，先用当前允许域的只读工具（如 `products_list`、`assets_list` 或 `tiktok_selection_list_tasks`）探明工作区现有对象，再用不超过 3 行给出具体的下一步执行选项，不反问冗长问卷。',
].join('\n')

/** 跨境电商全链路 SOP 内置专家库（10 位按职能闭环分工的可聘用专家，全部默认可聘用） */
export const DEFAULT_MARKET_EXPERTS: MarketExpertItem[] = [
  {
    id: 'ecom-market-research',
    name: '选品专家',
    nameEn: 'Market Analyst',
    description: '接管 TikTok 三闸跟爆工作台与类目表脚本，覆盖销量加速初筛、渠道占比核验、品牌词风控及价格带波谷测算。',
    descriptionEn: 'Runs TikTok 3-gate discovery tasks and CSV category scripts for velocity screening, risk audits, CR10, and price-band gaps.',
    avatar: generatePixelAvatarDataUrl('ecom-market-research', { size: 96 }),
    initialStatus: 'available',
    order: 11,
    stage: 'research',
    skills: ['omnimux-ecom-market-research', 'omnimux-ecom-platform-rules', 'omnimux-product-demand', 'omnimux-competitor-research'],
    toolDomains: ['products', 'inspiration', 'tiktok_selection', 'social_data', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'tk-gate',
        labelZh: 'TikTok 三闸跟爆筛品',
        labelEn: 'Run TikTok 3-Gate Scout',
        promptZh: '用跟爆选品三闸工作台帮我试拉并筛选 <目标类目或关键词> 的加速爆品，先给试拉规模预估再创建任务。',
        promptEn: 'Dry-run the TikTok 3-gate selection workbench for <category/keyword> and preview hit volume before creating a task.',
      },
      {
        id: 'csv-gap',
        labelZh: '类目表容量与波谷测算',
        labelEn: 'Analyze Category CSV',
        promptZh: '我有一份类目导出表 <粘贴路径或上传CSV>，请用脚本计算月容量、CR10 与价格带波谷并给出进入结论。',
        promptEn: 'Analyze my exported category sheet <path/CSV> with scripts for market size, CR10, and price-band gaps.',
      },
      {
        id: 'risk-check',
        labelZh: '核查选品库并同步商品库',
        labelEn: 'Review & Sync Picks',
        promptZh: '查看当前跟爆选品库待审核商品，核对品牌敏感词风控结果，确认后同步进商品库。',
        promptEn: 'Review pending picks in the TikTok selection library, inspect risk audit results, and sync approved items to Products.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-product-strategy',
    name: '定价专家',
    nameEn: 'Pricing Strategist',
    description: '提炼唯一核心卖点、规划 SKU 角色矩阵、精算含税净利率/盈亏价/券余量，并沉淀进商品库作为全链路真源。',
    descriptionEn: 'Distills a single core selling point, SKU role matrix, tax-aware margin/break-even/coupon headroom, and syncs truth to Products.',
    avatar: generatePixelAvatarDataUrl('ecom-product-strategy', { size: 96 }),
    initialStatus: 'available',
    order: 12,
    stage: 'research',
    skills: ['omnimux-ecom-pricing-strategy', 'omnimux-ecom-platform-rules'],
    toolDomains: ['products', 'social_data', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'margin',
        labelZh: '核算含税毛利与盈亏价',
        labelEn: 'Calculate Net Margin',
        promptZh: '帮我核算 @Product/<商品名> 在 <目标平台站点> 的含税净利率、盈亏平衡价与优惠券余量。',
        promptEn: 'Compute tax-aware net margin, break-even price, and coupon headroom for @Product/<name> on <marketplace>.',
      },
      {
        id: 'usp',
        labelZh: '收敛唯一核心卖点',
        labelEn: 'Distill Single Core USP',
        promptZh: '基于商品参数与竞品痛点，把这款产品收敛成唯一核心卖点与禁用词清单。',
        promptEn: 'Distill verified specs and competitor pain points into one core USP and forbidden-word list.',
      },
      {
        id: 'sku',
        labelZh: '规划 SKU 四角色矩阵',
        labelEn: 'Plan SKU Role Matrix',
        promptZh: '为这款商品设计引流款、利润款、组合款与形象款 SKU 矩阵并沉淀进商品库。',
        promptEn: 'Design traffic, profit, bundle, and hero SKU roles and sync the verified spec table to Products.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-brand-curator',
    name: '品牌管家',
    nameEn: 'Brand Curator',
    description: '从商品页链接与实拍素材冷启动建档，确定性校验参数真源与色值规范，一次性沉淀可复用的商品库与品牌资产锚点。',
    descriptionEn: 'Bootstraps structured product profiles, validated spec tables, and reusable brand visual anchors from URLs and raw photos.',
    avatar: generatePixelAvatarDataUrl('ecom-brand-curator', { size: 96 }),
    initialStatus: 'available',
    order: 13,
    stage: 'research',
    skills: ['omnimux-ecom-brand-curator', 'omnimux-ecom-platform-rules'],
    toolDomains: ['products', 'assets', 'inspiration', 'workflow', 'media_gen', 'social_data', 'browser', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'url-onboard',
        labelZh: '从商品链接冷启动建档',
        labelEn: 'Onboard from Product URL',
        promptZh: '请抓取这个商品链接 <粘贴链接>，拆出四级事实参数表并用脚本校验缺口，确认后写入商品库。',
        promptEn: 'Fetch <product URL>, extract a 4-tier verified spec table, validate gaps via script, and save to Products.',
      },
      {
        id: 'asset-anchor',
        labelZh: '整理实拍图沉淀品牌资产',
        labelEn: 'Organize Brand Assets',
        promptZh: '把这批商品实拍图与品牌主色整理成可长期复用的资产库角色、场景与风格锚点。',
        promptEn: 'Curate these product photos and brand palette into reusable Asset Center characters, scenes, and style packs.',
      },
      {
        id: 'audit-kit',
        labelZh: '体检商品库与资产缺口',
        labelEn: 'Audit Workspace Truth',
        promptZh: '盘点我当前商品库和资产库里缺失的关键参数、禁用词或白底锚点图，给出补齐清单。',
        promptEn: 'Audit my existing Products and Assets for missing specs, forbidden words, or hero anchor images.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-listing-copy',
    name: '文案专家',
    nameEn: 'Listing Copywriter',
    description: '读取商品库参数真源，产出关键词分层、多语母语 Listing 标题与七段式商详，并通过字数、禁用词与参数溯源校验。',
    descriptionEn: 'Turns verified product specs into tiered keywords, native multilingual titles and 7-part listings with length, ban-word & spec checks.',
    avatar: generatePixelAvatarDataUrl('ecom-listing-copy', { size: 96 }),
    initialStatus: 'available',
    order: 14,
    stage: 'production',
    skills: ['omnimux-ecom-listing-copy', 'omnimux-ecom-platform-rules'],
    toolDomains: ['products', 'assets', 'social_data', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'title-desc',
        labelZh: '生成母语标题与七段商详',
        labelEn: 'Draft Native Listing',
        promptZh: '读取 @Product/<商品名> 真源，生成 <目标平台与语言> 高转化标题与七段式商详，并跑完合规校验。',
        promptEn: 'Draft a native <marketplace/language> title and 7-part listing from @Product/<name> with validation.',
      },
      {
        id: 'kw',
        labelZh: '输出关键词分层矩阵',
        labelEn: 'Build Keyword Tiers',
        promptZh: '为 @Product/<商品名> 拆出核心词、场景长尾词与痛点词分层表。',
        promptEn: 'Build tiered core, scenario, and pain-point keywords for @Product/<name>.',
      },
      {
        id: 'lint',
        labelZh: '校验已有文案合规与参数',
        labelEn: 'Validate Existing Copy',
        promptZh: '用校验脚本检查这段 Listing 文案的字节上限、违禁词与数字参数溯源：<粘贴文案>。',
        promptEn: 'Validate this listing draft for byte limits, banned words, and spec traceability: <paste copy>.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-visual-studio',
    name: '视觉专家',
    nameEn: 'Visual Designer',
    description: '锁定商品实拍外观与色值，规划 9 图视觉矩阵与商详排版，驱动创作画布批量出图并执行白底/主体占比像素质检。',
    descriptionEn: 'Plans 9-image visual stacks and A+ layouts locked to real product photos, drives Canvas generation, and runs pixel compliance checks.',
    avatar: generatePixelAvatarDataUrl('ecom-visual-studio', { size: 96 }),
    initialStatus: 'available',
    order: 15,
    stage: 'production',
    skills: ['omnimux-ecom-visual-qa', 'omnimux-ecom-platform-rules'],
    toolDomains: ['products', 'assets', 'inspiration', 'workflow', 'media_gen', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'nine-grid',
        labelZh: '规划 9 图视觉矩阵',
        labelEn: 'Plan 9-Image Stack',
        promptZh: '锁定 @Product/<商品名> 实拍外观，先输出 9 图视觉矩阵分工表，确认后再进画布出图。',
        promptEn: 'Lock real product appearance from @Product/<name> and plan a 9-image visual matrix before Canvas generation.',
      },
      {
        id: 'hero-qa',
        labelZh: '质检白底主图合规像素',
        labelEn: 'Run Main-Image QA',
        promptZh: '运行像素质检脚本检查这组主图的分辨率、纯白底与主体占比：<附图片或路径>。',
        promptEn: 'Run pixel compliance QA on resolution, white background, and subject ratio for <images>.',
      },
      {
        id: 'aplus',
        labelZh: '设计商详对比与场景图',
        labelEn: 'Design A+ Visuals',
        promptZh: '围绕唯一核心卖点设计痛点对比图与场景卖点图，并在创作画布搭建生成节点。',
        promptEn: 'Plan pain-point comparison and lifestyle feature visuals on the Workflow Canvas.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-video-director',
    name: '视频导演',
    nameEn: 'Video Director',
    description: '串联灵感 5D 拆解、资产与数字人、画布分镜生片与视频剪辑工坊，把控 3 秒 Hook、口播时长与参数溯源校验。',
    descriptionEn: 'Connects 5D inspiration breakdowns, assets/avatars, Canvas storyboards, and Clip timeline with 3s hook, duration & spec checks.',
    avatar: generatePixelAvatarDataUrl('ecom-video-director', { size: 96 }),
    initialStatus: 'available',
    order: 16,
    stage: 'production',
    skills: ['omnimux-ecom-video-script', 'omnimux-ecom-platform-rules', 'clip-craft'],
    toolDomains: ['products', 'assets', 'inspiration', 'workflow', 'clip', 'media_gen', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'hook-script',
        labelZh: '策划 3 秒 Hook 带货脚本',
        labelEn: 'Plan 3s Hook Script',
        promptZh: '基于 @Product/<商品名> 策划 30 秒竖屏带货脚本，先用脚本校验口播时长与参数再开画布。',
        promptEn: 'Draft a 30s vertical shoppable video script for @Product/<name> with duration & spec validation.',
      },
      {
        id: 'replicate',
        labelZh: '5D 拆解参考爆款复刻',
        labelEn: '5D Viral Replication',
        promptZh: '结合灵感库这条参考视频 <粘贴链接或编号> 做 5D 拆解，为我的商品搭建复刻分镜画布。',
        promptEn: 'Break down reference video <link/id> in 5D and wire a replication storyboard on Canvas.',
      },
      {
        id: 'clip-cut',
        labelZh: '汇总镜头进剪辑工坊精修',
        labelEn: 'Assemble in Clip Studio',
        promptZh: '把当前画布生成的片段装配进 Clip 剪辑工程，完成字幕对轨、黑场诊断并输出预览。',
        promptEn: 'Assemble generated clips in Clip Studio, sync captions, run diagnostics, and prepare review cut.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-global-localizer',
    name: '本土专家',
    nameEn: 'Global Localizer',
    description: '锁定商品实拍与参数真源，将验证过的带货视频与套图按四栏矩阵安全裂变至多国多语种，脚本校核口播时长膨胀与本地红线。',
    descriptionEn: 'Locks verified product specs and localizes proven video ads across countries and languages with duration expansion & compliance checks.',
    avatar: generatePixelAvatarDataUrl('ecom-global-localizer', { size: 96 }),
    initialStatus: 'available',
    order: 17,
    stage: 'production',
    skills: ['omnimux-ecom-global-localizer', 'omnimux-ecom-platform-rules', 'clip-craft'],
    toolDomains: ['products', 'assets', 'inspiration', 'workflow', 'clip', 'media_gen', 'social_data', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'four-col',
        labelZh: '拆解四栏跨国本地化方案',
        labelEn: 'Build 4-Column Plan',
        promptZh: '把 @Product/<商品名> 的母版视频拆解为 <美区 EN / 巴西 PT-BR / 拉美 ES> 四栏本地化方案，锁定外观与数字参数。',
        promptEn: 'Create a 4-column localization matrix for @Product/<name> targeting <US EN / BR PT-BR / LATAM ES>.',
      },
      {
        id: 'dur-check',
        labelZh: '校验多语口播时长与红线',
        labelEn: 'Check Voiceover Expansion',
        promptZh: '用校验脚本核对这套多语翻译脚本的语速膨胀率、参数一致性与目标国违禁词。',
        promptEn: 'Run the localization check script on voiceover expansion ratio, spec invariance, and market redlines.',
      },
      {
        id: 'pilot',
        labelZh: '先跑单市场数字人小样',
        labelEn: 'Run Single-Market Pilot',
        promptZh: '先在 <目标国家/语言> 选配本地数字人与配音跑 1 条核心镜头小样，我确认后再批量铺开其他市场。',
        promptEn: 'Run a single pilot shot for <target market> with local avatar and voiceover before scaling to all markets.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-ads-optimizer',
    name: '广告专家',
    nameEn: 'Ads Optimizer',
    description: '测算盈亏线 ROAS 与可承受 CPC，按五层转化漏斗定位点击/加购/转化瓶颈，输出分级调优清单并定向回流素材优化。',
    descriptionEn: 'Computes break-even ROAS & max CPC, diagnoses 5-stage ad funnels, outputs P0/P1/P2 action checklists and targeted creative feedback.',
    avatar: generatePixelAvatarDataUrl('ecom-ads-optimizer', { size: 96 }),
    initialStatus: 'available',
    order: 18,
    stage: 'growth',
    skills: ['omnimux-ecom-ads-diagnosis', 'omnimux-ecom-platform-rules'],
    toolDomains: ['products', 'analytics', 'social_data', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'roas',
        labelZh: '五层漏斗诊断广告报表',
        labelEn: 'Diagnose Ad Funnel',
        promptZh: '帮我用脚本解析这份广告导出表 <路径/CSV>，算出盈亏线 ROAS 与最大 CPC，并按 P0/P1/P2 给出调优动作。',
        promptEn: 'Diagnose <ad CSV> with scripts for break-even ROAS, max CPC, and P0/P1/P2 action checklists.',
      },
      {
        id: 'feedback',
        labelZh: '生成定向素材回流工单',
        labelEn: 'Emit Creative Feedback',
        promptZh: '根据当前点击率与转化率瓶颈，定位只需重做的具体主图或前 3 秒 Hook。',
        promptEn: 'Pinpoint exact listing fields, main image slots, or 3s hooks to revise from funnel bottlenecks.',
      },
      {
        id: 'budget',
        labelZh: '测算新品放量预算护栏',
        labelEn: 'Set Launch Budget Guard',
        promptZh: '结合 @Product/<商品名> 毛利率，计算测品期止损线与加预算触发阈值。',
        promptEn: 'Compute stop-loss and scale-up thresholds from @Product/<name> unit economics.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-review-voc',
    name: '评论运营',
    nameEn: 'Review Analyst',
    description: '差评 8 类归因与误解型差评识别、好评卖点提炼，输出商详防误解补丁、包装提示图需求与多语合规售后回复话术。',
    descriptionEn: 'Classifies negative reviews across 8 root causes to isolate fixable misunderstandings, emitting listing patches and compliant replies.',
    avatar: generatePixelAvatarDataUrl('ecom-review-voc', { size: 96 }),
    initialStatus: 'available',
    order: 19,
    stage: 'growth',
    skills: ['omnimux-ecom-review-voc', 'omnimux-ecom-platform-rules'],
    toolDomains: ['products', 'social_data', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'voc-8',
        labelZh: '差评 8 类归因与防误解补丁',
        labelEn: 'Classify 8 Review Causes',
        promptZh: '运行评论脚本分析这份评价表 <路径/CSV>，筛出误解型差评并输出可直接粘贴的商详补丁。',
        promptEn: 'Analyze <reviews CSV> across 8 root causes and emit copy-paste listing patches for misunderstandings.',
      },
      {
        id: 'reply',
        labelZh: '生成多语合规售后回复',
        labelEn: 'Draft Compliant Replies',
        promptZh: '针对这几条差评生成 <目标语言> 合规客服回复话术，绝不触碰平台删评红线。',
        promptEn: 'Draft policy-compliant customer care replies in <language> for these negative reviews.',
      },
      {
        id: 'praise',
        labelZh: '提炼好评高频卖点词',
        labelEn: 'Mine Praise Phrases',
        promptZh: '从五星好评里提炼买家原声高频词，反哺下一轮主图与口播钩子。',
        promptEn: 'Extract recurring buyer phrases from 5-star reviews to feed next-round hooks.',
      },
    ],
    group: 'ecommerce',
  },
  {
    id: 'ecom-creator-growth',
    name: '达人运营',
    nameEn: 'Creator Manager',
    description: '基于公开社媒数据评估 TikTok/YouTube/IG 达人与爆款信号，输出建联 Brief、内容排期与增长复盘。',
    descriptionEn: 'Evaluates TikTok/YouTube/IG creators & viral outliers from public data, drafting outreach briefs, schedules, and growth recaps.',
    avatar: generatePixelAvatarDataUrl('ecom-creator-growth', { size: 96 }),
    initialStatus: 'available',
    order: 20,
    stage: 'growth',
    skills: ['omnimux-ecom-platform-rules', 'omnimux-creator-teardown', 'omnimux-outlier-post-finder', 'omnimux-trend-discovery'],
    toolDomains: ['products', 'inspiration', 'social_data', 'analytics', 'viewer', 'market', 'workbench'],
    starters: [
      {
        id: 'eval',
        labelZh: '评估候选达人带货匹配度',
        labelEn: 'Evaluate Creator Fit',
        promptZh: '拉取这批达人公开作品数据 <粘贴账号列表>，按中位数基线计算爆款 lift 并分层。',
        promptEn: 'Fetch public metrics for <creators>, score median-baseline lift, and tier candidates.',
      },
      {
        id: 'brief',
        labelZh: '生成多语达人建联 Brief',
        labelEn: 'Draft Outreach Brief',
        promptZh: '结合 @Product/<商品名> 核心卖点与禁说红线，写一份 <目标语言> 达人寄样建联 Brief。',
        promptEn: 'Write a <language> creator brief with core USP, redlines, and gifting terms for @Product/<name>.',
      },
      {
        id: 'outlier',
        labelZh: '扫描品类近期爆款信号',
        labelEn: 'Scan Category Outliers',
        promptZh: '扫描 <品类关键词> 近期在 TikTok 的高 lift 异常爆款视频并整理选题排期。',
        promptEn: 'Scan recent high-lift TikTok outlier posts for <keyword> and draft a test schedule.',
      },
    ],
    group: 'ecommerce',
  },
]

const EXPERT_PERSONA_DETAILS: Record<string, string> = {
  'ecom-market-research': [
    '你是 OmniMux「选品专家」，负责跨境电商 SOP 第 01 环节（类目容量/竞争格局/价格带波谷分析 + TikTok Shop 三闸实时跟爆筛品）。',
    '',
    '【首选 Skill 与双轨工作流】',
    '- **Track A（类目导出表分析）**：收到 Shopee / Amazon / Mercado Livre / TikTok Shop 导出 CSV/JSON 时，优先加载 `omnimux-ecom-market-research` 与 `omnimux-ecom-platform-rules`，运行 `scripts/analyze_market.py` 清洗巴西/美式/中文万单位数字并计算月容量、CR3/CR10/HHI 与不平滑价格带波谷。',
    '- **Track B（TikTok Shop 三闸跟爆工作台）**：收到热榜/关键词实时跟爆或定时巡检需求时，直接调用 `tiktok_selection_query_rank` / `tiktok_selection_search_products` / `tiktok_selection_import_snapshot` 发现商品，先经 `tiktok_selection_gate_dry_run` 预估命中规模并获用户确认，再调用 `tiktok_selection_create_task` 跑通 G1 销量加速初筛 → G2 商品卡/视频占比核验（缺失渠道数据时严格标出 `G2_CHANNEL_DATA_MISSING` 不伪造）→ G3 品牌与敏感词风控（fail-closed）；筛选结果先经 `tiktok_selection_ingest_products` 入选品库（删除使用 `tiktok_selection_remove_products` 且必须传 `confirm: true`），经用户确认后用 `tiktok_selection_generate_assets`（`kind: "sync_omnimux_products"`）或 `products_create` 沉淀进商品库。',
    '- 需要社媒侧需求验证与竞品内容对标时，加载 `omnimux-product-demand` / `omnimux-competitor-research`，复用 `omnimux_social_data`、`omnimux_tiktok_shop_*` 与 `inspiration_rival_*` 工具取证。',
    '- 交付必须包含：市场可进入性结论（建议进入/谨慎验证/不建议）、量化指标表或三闸漏斗明细、目标价格带与空白机会，以及直接传给「定价专家」的下游契约摘要。',
  ].join('\n'),

  'ecom-product-strategy': [
    '你是 OmniMux「定价专家」，负责跨境电商 SOP 第 02 环节（唯一核心卖点收敛、SKU 四角色矩阵、含税单元经济核算与商品库真源沉淀）。',
    '',
    '【首选 Skill 与工作流】',
    '- 优先加载 `omnimux-ecom-pricing-strategy` 与 `omnimux-ecom-platform-rules`，调用 `scripts/calc_pricing.py` 精确计算采购/头程/佣金/免运/税费/广告预留下的含税净利率、盈亏平衡价与优惠券余量。',
    '- 必须把定位收敛为「唯一核心卖点（core_selling_point）」+ 明确的 `forbidden_words`（禁用词清单）+ `spec_table`（已核实数字参数表），严禁大而全卖点堆砌。',
    '- 经用户确认后，主动通过商品库工具（`products_*`）将核实后的产品定位、SKU 结构与 `spec_table` 沉淀进 OmniMux 商品库，供下游 Listing、主图与短视频环节复用，防止参数跨环节漂移。',
  ].join('\n'),

  'ecom-brand-curator': [
    '你是 OmniMux「品牌管家」，负责新商品与品牌冷启动建档、四级事实参数提取校验，以及商品库（`products_*`）与创作资产库（`assets_*`）共享锚点沉淀。',
    '',
    '【首选 Skill 与工作流】',
    '- 优先加载 `omnimux-ecom-brand-curator` 与 `omnimux-ecom-platform-rules`：先盘点当前 `products_list` / `assets_list` 避免重复建档，再使用 `web_fetch`（动态渲染页用 `browser_navigate` / `browser_get_text`，受阻时请用户粘贴图文）采集商品页与实拍素材。',
    '- 落盘前必须运行 `scripts/validate_brand_kit.py` 确定性核验 `spec_table`（至少 3 项已核实规格）、HEX 品牌色值、禁用词与主锚点实拍图完整性，显式列出缺口交用户确认。',
    '- 获用户确认后写入 `products_create`/`products_update` 与 `assets_create`/`assets_upload`，必要时在画布生成可复用角色三视图与风格锚点，确保下游全链路可直接通过 `@Product` / `@Asset` 零漂移复用。',
  ].join('\n'),

  'ecom-listing-copy': [
    '你是 OmniMux「文案专家」，负责跨境电商 SOP 第 03 环节（关键词分层、平台高转化标题、七段式商详文案与多语母语直出）。',
    '',
    '【首选 Skill 与工作流】',
    '- 开工前先从商品库（`products_*`）或用户提供的 `spec_table` 与 `core_selling_point` 锁定唯一参数真源；缺核心参数或 `forbidden_words` 时先提醒补齐，不凭空编造。',
    '- 优先加载 `omnimux-ecom-listing-copy` 与 `omnimux-ecom-platform-rules`，按目标平台规则（Shopee / Amazon / TikTok Shop / Mercado Livre）母语直出（EN / PT-BR / ES / 东南亚语等，不做机械直译）。',
    '- 交付前必须运行 `scripts/validate_listing.py` 完成标题字符/字节上限、违禁绝对化词、未授权品牌词及全量数字参数溯源校验，仅在全部通过或显式标出剩余风险后交付。',
  ].join('\n'),

  'ecom-visual-studio': [
    '你是 OmniMux「视觉专家」，负责跨境电商 SOP 第 04 环节（9 图视觉矩阵规划、A+/Carousel 商详排版、画布批量出图与像素级合规质检）。',
    '',
    '【首选 Skill 与工作流】',
    '- 严格锁定商品库实拍图中的产品轮廓、材质、色值、件数与 Logo，严禁篡改商品真实外观或凭空叠加未证实认证徽章。',
    '- 优先加载 `omnimux-ecom-visual-qa` 与 `omnimux-ecom-platform-rules`：先输出 9 图分工表（首图白底合规 + 核心卖点图 + 痛点对比 + 场景/尺寸规格 + 细节工艺 + 配件清单 + 信任背书），用户确认方案后再驱动创作画布（`workflow_*`）与参考图槽位批量生成。',
    '- 每张交付主图必须运行 `scripts/check_main_image.py` 检查分辨率、画幅、白底边距及主体占比，必要时用 `--fix` 规范尺寸白边后再交付。',
  ].join('\n'),

  'ecom-video-director': [
    '你是 OmniMux「视频导演」，负责跨境电商 SOP 第 05 环节（15s–60s 带货短视频策划、爆款结构复刻、多镜生成与剪辑成片）。',
    '',
    '【首选 Skill 与工作流】',
    '- 优先加载 `omnimux-ecom-video-script`、`omnimux-ecom-platform-rules` 与 `clip-craft`：先从商品库锁定 `core_selling_point` 与 `spec_table`，结合灵感库 5D 拆解（`inspiration_*`）设计前 3 秒强 Hook 与分镜脚本。',
    '- 交付脚本前必须运行 `scripts/validate_video_script.py` 校验口播词数/时长预算、前 3 秒钩子与数字参数溯源，并按需导出 `.srt` 字幕。',
    '- 制作期串联 OmniMux 资产/数字人（`assets_*`、`avatar_*`）→ 创作画布（`workflow_*`）分镜出片 → 视频剪辑工坊（`clip_*`）多轨合成与 `clip_diagnostics` 检查，先交付可编辑工程供审阅再导出成片。',
  ].join('\n'),

  'ecom-global-localizer': [
    '你是 OmniMux「本土专家」，负责跨国多语种带货视频与广告素材本地化裂变（全球锁定外观参数、本地适配族裔数字人/语境/配音/字幕）。',
    '',
    '【首选 Skill 与工作流】',
    '- 优先加载 `omnimux-ecom-global-localizer`、`omnimux-ecom-platform-rules` 与 `clip-craft`：先从商品库锁定实拍图与 `spec_table`，输出目标市场四栏本地化方案（全球锁定 / 本地适配 / 本地待审 / 禁用红线）。',
    '- 调用任何付费生视频/配音工具前，必须运行 `scripts/check_localization_matrix.py` 确定性校核跨语种口播时长膨胀率（防止西/葡/德语等撑爆原镜时长与对口型）、全量数字参数零漂移与目标国违禁词。',
    '- 严格遵守「先单市场小样、后多国批量」：挑选云地资产库（`assets_*`）匹配目标国的数字人与音色，在画布（`workflow_*`）先跑 1 条核心镜头小样确认后，再扩量并在剪辑工坊（`clip_*`）完成多语字幕叠层与 `clip_diagnostics` 核验。',
  ].join('\n'),

  'ecom-ads-optimizer': [
    '你是 OmniMux「广告专家」，负责跨境电商 SOP 第 06 环节（盈亏线 ROAS 核算、五层漏斗诊断、分级调优动作与素材定向回流）。',
    '',
    '【首选 Skill 与工作流】',
    '- 收到广告导出报表（Shopee Ads / Amazon PPC / TikTok Ads / Meta Ads）与产品毛利参数后，优先加载 `omnimux-ecom-ads-diagnosis` 与 `omnimux-ecom-platform-rules`，运行 `scripts/diagnose_ads.py` 计算盈亏平衡 ROAS、最大可承受 CPC 与五层转化漏斗（曝光 → CTR → 加购率 → 转化率 → ROAS）。',
    '- 严格区分瓶颈层级（如高 CTR 低转化属于页面/价格/信任问题，而非盲目换主图），输出按 P0/P1/P2 分级的审批操作清单（不代操作广告后台）。',
    '- 给出精准的「定向回流工单」：仅指派需要修改的具体 Listing 字段、单张主图或视频前 3 秒 Hook，严禁推倒重做非症状环节。',
  ].join('\n'),

  'ecom-review-voc': [
    '你是 OmniMux「评论运营」，负责跨境电商 SOP 第 07 环节（差评 8 类归因、误解型差评隔离、好评卖点提炼、防误解补丁与合规客服回复）。',
    '',
    '【首选 Skill 与工作流】',
    '- 优先加载 `omnimux-ecom-review-voc` 与 `omnimux-ecom-platform-rules`，运行 `scripts/analyze_reviews.py` 对评论表执行 8 类差评归因、总条数守恒核验、可修复误解型占比计算与好评高频词提取；需要补充 TikTok Shop 公开评价时可调用 `omnimux_social_data(platform="tiktok", capability="shop_reviews")` 并注明平台样本边界。',
    '- 重点抓出「可通过改商详/补提示图修复的误解型差评」，直接输出可复制粘贴的 Listing 补丁段落、包装插页提示文案与视觉补图需求。',
    '- 生成多语售后/差评回复话术时严格遵守平台政策，绝不包含诱导删评、现金返现换好评或推卸责任话术。',
  ].join('\n'),

  'ecom-creator-growth': [
    '你是 OmniMux「达人运营」，负责 TikTok / YouTube / Instagram 达人筛选评估、建联 Brief、内容排期与爆款复盘增长。',
    '',
    '【首选 Skill 与工作流】',
    '- 优先加载 `omnimux-creator-teardown`、`omnimux-outlier-post-finder`、`omnimux-trend-discovery` 与 `omnimux-ecom-platform-rules`，使用 `omnimux_social_data` 与平台直调工具拉取公开达人资料、作品流与转写数据，用账号自身中位数基线计算 lift（样本 <10 标低置信）。',
    '- 输出达人分级评估表、带产品核心卖点与禁说红线的多语建联 Brief（含佣金/寄样/使用权核对项）、以及可执行的内容排期测试矩阵。',
    '- 诚实声明数据与发布边界：无受众人口学、无私密评论正文、无广告库内部数据；账号发布与外部互动涉及授权的必须先经用户明确确认。',
  ].join('\n'),
}

/** 官方系统预设的增强元数据字典 */
export const SYSTEM_PRESET_METADATA: Record<string, { name: string, nameEn: string, description: string, descriptionEn: string, order: number }> = {
  'omni-agent': {
    name: 'OmniMux',
    nameEn: 'OmniMux',
    description: '内容电商全链路默认 Agent——覆盖选品洞察、脚本分镜、素材生产与全域增长。',
    descriptionEn: 'All-in-one content e-commerce Agent for product research, scripts, media production, and cross-border growth.',
    order: 1,
  },
  cordis: {
    name: '创建Agent',
    nameEn: 'Create Agent',
    description: 'DSH 原生创造模式：插件实验开发、运行时检查与自定义 Agent 搭建。',
    descriptionEn: 'DSH native Creator Mode: plugin development, runtime inspection, and custom Agent building.',
    order: 2,
  },
  standard: {
    name: '代码开发',
    nameEn: 'Code Developer',
    description: '全栈软件工程、代码重构、测试编写与系统架构设计。',
    descriptionEn: 'Full-stack software engineering, refactoring, testing and architecture.',
    order: 3,
  },
  'drama-agent': {
    name: '短剧专家',
    nameEn: 'Short Drama Expert',
    description: '短剧漫剧策划、剧本拆解、分镜编排与出海译制发行。',
    descriptionEn: 'Short drama planning, script breakdown, storyboard and distribution.',
    order: 4,
  },
  'tiktok-agent': {
    name: 'TikTok运营专家团',
    nameEn: 'TikTok Ops Team',
    description: 'TikTok 全链路爆款视频创作、带货选品、互动截流与投流增长。',
    descriptionEn: 'Full-funnel TikTok viral content creation, product selection, engagement and paid growth.',
    order: 5,
  },
  'marketing-agent': {
    name: '营销专家',
    nameEn: 'Marketing Expert',
    description: '全域营销战略策划、高转化文案撰写与品牌获客增长。',
    descriptionEn: 'Marketing strategy, high-converting copywriting and user acquisition.',
    order: 6,
  },
  'marketing-growth-team': {
    name: '增长专家团',
    nameEn: 'Growth Team',
    description: '数据驱动的漏斗分析、病毒传播机制与规模化增长试验。',
    descriptionEn: 'Data-driven funnel optimization, viral loops and scalable growth experimentation.',
    order: 7,
  },
  'daily-work': {
    name: '日常工作',
    nameEn: 'Daily Work',
    description: '通用办公助理，协助文档处理、日常沟通、会议纪要与信息整理。',
    descriptionEn: 'General office assistant for documentation, communication and notes.',
    order: 8,
  },
  'software-company': {
    name: '软件开发团队',
    nameEn: 'Software Company',
    description: '多角色协同交付团队，涵盖架构师、前端、后端、QA、产品与审查员。',
    descriptionEn: 'Multi-role collaborative software delivery team.',
    order: 9,
  },
}

const DEPRECATED_LEGACY_EXPERT_IDS = new Set([
  'html-generator',
  'amazon-ops-expert',
  'tiktok-shop-ops-expert',
])

export function findMarketExpertById(id: string): MarketExpertItem | undefined {
  return DEFAULT_MARKET_EXPERTS.find((it) => it.id === id)
}

export function isMarketExpertId(id: string): boolean {
  return DEFAULT_MARKET_EXPERTS.some((it) => it.id === id)
}

/**
 * Derive market expert status purely from official live registry + persisted ledger.
 * Legacy `$DSH_HOME/.agent-presets/` is deliberately ignored.
 */
export function getMarketExpertStatus(
  home: string,
  exp: MarketExpertItem,
  officialPresets?: readonly DiscoveredPresetRef[] | null,
): 'enabled' | 'available' | 'disabled' | 'coming_soon' {
  if (exp.initialStatus === 'coming_soon') return 'coming_soon'
  if (Array.isArray(officialPresets)) {
    const live = officialPresets.find((p) => p && p.id === exp.id)
    if (live && !live.broken) return 'enabled'
  }
  const ledger = readExpertLedger(home)
  if (ledger.disabled.includes(exp.id)) return 'disabled'
  return 'available'
}

export function resolveExpertPersonaText(exp: Pick<MarketExpertItem, 'id' | 'name' | 'description'>): string {
  const detail = EXPERT_PERSONA_DETAILS[exp.id]
  if (detail) {
    return `${detail}\n\n${SHARED_EXPERT_GUARDRAILS}`
  }
  return `你是「${exp.name}」AI Agent专家。${exp.description}。`
}

/**
 * Legacy helper retained for file-based preset schema tests (e.g. verify-agent-presets).
 * Runtime installation uses `ExpertPresetRuntime` + `ctx.agentPresets.register()`.
 */
export function installMarketExpertPreset(
  home: string,
  exp: Pick<MarketExpertItem, 'id' | 'name' | 'description' | 'order'>,
): void {
  writeAgentPreset(home, {
    id: exp.id,
    name: exp.name,
    description: exp.description,
    order: exp.order,
    persona: resolveExpertPersonaText(exp),
  })
  const retiredDir = join(home, '.agent-presets', '.retired')
  if (existsSync(retiredDir)) {
    try {
      const files = readdirSync(retiredDir)
      for (const f of files) {
        if (f === exp.id || f.startsWith(`${exp.id}-`)) {
          rmSync(join(retiredDir, f), { recursive: true, force: true })
        }
      }
    } catch (err) {
      console.warn(`[omnimux-market] failed to prune legacy .retired marker for ${exp.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * Retired no-op: DSH 0.1.7+ removed `.agent-presets/` filesystem scanning, and
 * market experts default to `available` (user-installed experts restore via
 * `ExpertPresetRuntime.restoreInstalled()`).
 */
export function materializeEnabledMarketExperts(_home: string): string[] {
  return []
}

/**
 * Legacy helper retained for backward export compatibility.
 * Runtime disabling uses `ExpertPresetRuntime.disable()` + `expert-ledger.ts`.
 */
export function disableMarketExpertPreset(home: string, id: string): void {
  const dir = join(home, '.agent-presets', id)
  const retiredDir = join(home, '.agent-presets', '.retired')
  mkdirSync(retiredDir, { recursive: true })
  if (existsSync(dir)) {
    const dest = join(retiredDir, `${id}-${Date.now()}`)
    try {
      rmSync(dest, { recursive: true, force: true })
      renameSync(dir, dest)
    } catch (renameErr) {
      console.warn(`[omnimux-market] rename legacy preset dir failed (${id}), falling back to rmSync: ${renameErr instanceof Error ? renameErr.message : String(renameErr)}`)
      rmSync(dir, { recursive: true, force: true })
    }
  } else {
    try {
      writeFileSync(join(retiredDir, `${id}-${Date.now()}`), '', 'utf8')
    } catch (writeErr) {
      console.warn(`[omnimux-market] failed to write legacy retired marker (${id}): ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`)
    }
  }
}

/**
 * Reconcile built-in market experts against official `ctx.agentPresets.list()`.
 *
 * Truthfulness guarantees:
 * 1. Market experts are marked `'enabled'` ONLY when present in `officialPresets`
 *    and NOT `broken`. Stale `$DSH_HOME/.agent-presets/*` files never produce false
 *    positives.
 * 2. System presets (`omni-agent`, `cordis`, or `trust === 'system'`) receive
 *    `status: 'system'` and never display a Disable button.
 * 3. User-created presets receive `status: 'custom'` and never display a market
 *    Disable button.
 */
export function reconcileMarketExperts(
  home: string,
  officialPresets?: readonly DiscoveredPresetRef[] | null,
): MarketExpertItem[] {
  const effectivePresets = Array.isArray(officialPresets) ? officialPresets : []
  const liveById = new Map<string, DiscoveredPresetRef>()
  for (const p of effectivePresets) {
    if (p && typeof p.id === 'string' && p.id.trim()) {
      liveById.set(p.id.trim(), p)
    }
  }

  const ledger = readExpertLedger(home)
  const disabledSet = new Set(ledger.disabled)
  const itemsMap = new Map<string, MarketExpertItem>()

  // 1. Built-in 10 SOP experts (status strictly verified against live officialPresets)
  for (const exp of DEFAULT_MARKET_EXPERTS) {
    const live = liveById.get(exp.id)
    let status: ExpertStatus
    if (exp.initialStatus === 'coming_soon') {
      status = 'coming_soon'
    } else if (live && !live.broken) {
      status = 'enabled'
    } else if (disabledSet.has(exp.id)) {
      status = 'disabled'
    } else {
      status = 'available'
    }
    itemsMap.set(exp.id, {
      ...exp,
      group: 'ecommerce',
      status,
      ...(live?.broken ? { broken: live.broken } : {}),
    })
  }

  // 2. Official system presets and user-authored custom presets
  for (const p of effectivePresets) {
    if (!p?.id || DEPRECATED_LEGACY_EXPERT_IDS.has(p.id)) continue
    if (itemsMap.has(p.id)) continue

    if (p.id === 'omni-agent' || p.id === 'cordis' || p.trust === 'system' || Boolean(SYSTEM_PRESET_METADATA[p.id])) {
      const meta = SYSTEM_PRESET_METADATA[p.id]
      itemsMap.set(p.id, {
        id: p.id,
        name: meta?.name || p.name || p.id,
        nameEn: meta?.nameEn || p.name || p.id,
        description: meta?.description || p.description || '',
        descriptionEn: meta?.descriptionEn || p.description || '',
        avatar: generatePixelAvatarDataUrl(p.id, { size: 96 }),
        initialStatus: 'available',
        status: 'system',
        order: meta?.order ?? (p.order ?? 50),
        stage: 'system',
        skills: [],
        group: 'system',
        trust: 'system',
        ...(p.broken ? { broken: p.broken } : {}),
      })
    } else {
      itemsMap.set(p.id, {
        id: p.id,
        name: p.name || p.id,
        nameEn: p.name || p.id,
        description: p.description || '',
        descriptionEn: p.description || '',
        avatar: generatePixelAvatarDataUrl(p.id, { size: 96 }),
        initialStatus: 'available',
        status: 'custom',
        order: p.order ?? 80,
        stage: 'custom',
        skills: [],
        group: 'custom',
        trust: 'user',
        ...(p.broken ? { broken: p.broken } : {}),
      })
    }
  }

  return Array.from(itemsMap.values()).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id))
}
