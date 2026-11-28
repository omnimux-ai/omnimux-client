import React from 'react';
import { generatePixelAvatarDataUrl } from './pixel-avatar.js';

export function isValidPositiveNumber(val) {
  if (typeof val !== 'number') return false;
  return Number.isFinite(val) && val > 0;
}

export function resolvePlazaIconSize(size) {
  if (isValidPositiveNumber(size)) return size;
  if (!size || typeof size !== 'object') return 16;
  if (isValidPositiveNumber(size.size)) return size.size;
  if (isValidPositiveNumber(size.width)) return size.width;
  return 16;
}

export function renderPlazaIcon(size = 16) {
  const h = React.createElement;
  const px = resolvePlazaIconSize(size);
  const iconStyle = { width: px, height: px, minWidth: px, minHeight: px, flex: 'none', flexShrink: 0, display: 'block' };
  return h('svg', { width: px, height: px, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet', style: iconStyle },
    h('rect', { x: '1.75', y: '1.75', width: '5.5', height: '5.5', rx: '1.2', stroke: 'currentColor', strokeWidth: '1.4', fill: 'none' }),
    h('rect', { x: '8.75', y: '1.75', width: '5.5', height: '5.5', rx: '1.2', stroke: 'currentColor', strokeWidth: '1.4', fill: 'none' }),
    h('rect', { x: '1.75', y: '8.75', width: '5.5', height: '5.5', rx: '1.2', stroke: 'currentColor', strokeWidth: '1.4', fill: 'none' }),
    h('rect', { x: '8.75', y: '8.75', width: '5.5', height: '5.5', rx: '1.2', stroke: 'currentColor', strokeWidth: '1.4', fill: 'none' }),
  );
}

export function PlazaIcon(props) {
  return renderPlazaIcon(props);
}

export function resolvePlazaPluginUrl(path) {
  const suffix = String(path || '').replace(/^\/+/, '');
  const sub = './omnimux-market' + (suffix ? '/' + suffix : '');
  try {
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://localhost/';
    return new URL(sub, base).toString();
  } catch {
    return '/' + sub.replace(/^\.\//, '');
  }
}

export function resolveIconSrc(url) {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  if (typeof globalThis !== 'undefined' && typeof globalThis.iconSrc === 'function') {
    try {
      const res = globalThis.iconSrc(url);
      if (res) return res;
    } catch {}
  }
  return resolvePlazaPluginUrl('icon?url=' + encodeURIComponent(url));
}

export function resolveInitials(name) {
  if (typeof initials === 'function') {
    try {
      const res = initials(name);
      if (res) return res;
    } catch {}
  }
  const t = String(name || '').replace(/[a-zA-Z0-9._-]/g, '');
  return (t.slice(0, 3) || String(name || 'SK').slice(0, 2)).toUpperCase();
}

export function getIsLocaleEn(tr) {
  if (typeof tr === 'function') {
    return Boolean(tr('locale') === 'en' || tr.locale === 'en');
  }
  if (tr && typeof tr === 'object') {
    return Boolean(tr.locale === 'en');
  }
  return false;
}

export function getItemPreferredTitle(item, isEn) {
  const enTitle = item.titleEn || item.nameEn;
  const zhTitle = item.titleZh || item.nameZh;
  return isEn ? enTitle : zhTitle;
}

export function resolveItemTitle(item, tr) {
  if (typeof skillTitle === 'function') return skillTitle(item, tr);
  if (typeof SkillShelf !== 'undefined' && typeof SkillShelf.skillTitle === 'function') {
    return SkillShelf.skillTitle(item, tr);
  }
  if (!item) return '';
  const isEn = getIsLocaleEn(tr);
  const preferred = getItemPreferredTitle(item, isEn);
  if (preferred) return preferred;
  const fallback = item.name || item.title;
  return fallback || item.slug || '';
}

export function getItemPreferredDesc(item, isEn) {
  const enDesc = item.descriptionEn || item.summaryEn;
  const zhDesc = item.descriptionZh || item.summaryZh;
  return isEn ? enDesc : zhDesc;
}

export function resolveItemDesc(item, tr) {
  if (typeof skillDesc === 'function') return skillDesc(item, tr);
  if (typeof SkillShelf !== 'undefined' && typeof SkillShelf.skillDesc === 'function') {
    return SkillShelf.skillDesc(item, tr);
  }
  if (!item) return '';
  const isEn = getIsLocaleEn(tr);
  const preferred = getItemPreferredDesc(item, isEn);
  if (preferred) return preferred;
  return item.description || item.summary || '';
}

export function WorkshopSwitch(props) {
  const h = React.createElement;
  const { checked, onChange, disabled } = props || {};
  const toggle = () => { if (!disabled && onChange) onChange(!checked); };
  const handleClick = (e) => { e.stopPropagation(); toggle(); };
  const handleKeyDown = (e) => {
    const isTrigger = e.key === 'Enter' || e.key === ' ';
    if (isTrigger) { e.preventDefault(); e.stopPropagation(); toggle(); }
  };
  return h('div', {
    className: 'toggle-wrap', role: 'switch', 'aria-checked': Boolean(checked), tabIndex: disabled ? -1 : 0,
    onClick: handleClick, onKeyDown: handleKeyDown,
  }, h('div', { className: 'switch-bg' + (checked ? ' on' : '') }, h('div', { className: 'switch-knob' })));
}

/** 套件域置首位：分类栏紧跟「全部」之后展示，「我的」下拉亦紧随「全部分类」。 */
export const WORKSHOP_DOMAIN_ORDER = [
  '套件',
  'AIGC 创作',
  '短剧漫剧',
  '专业影视',
  '动画',
  '商业广告',
  '电商',
  '教育',
  '创意实验',
  '音频音乐',
  '平台工具',
];

/** 套件构成计数：三个清单缺省即 0，不做隐藏、不伪造。 */
export function resolveSuiteCounts(item) {
  const suite = (item && item.suite) || {};
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return { skills: count(suite.skills), rules: count(suite.rules), agents: count(suite.agents) };
}

/** 套件卡构成行文案：「技能 N · 规则 N · Agent N」。 */
export function suiteCompositionText(item, tr) {
  const { skills, rules, agents } = resolveSuiteCounts(item);
  const label = (key, fallback) => (typeof tr === 'function' ? (tr(key) || fallback) : fallback);
  return [
    label('suite.count.skills', '技能') + ' ' + skills,
    label('suite.count.rules', '规则') + ' ' + rules,
    label('suite.count.agents', 'Agent') + ' ' + agents,
  ].join(' · ');
}

export const EXPERT_STAGE_OPTIONS = [
  { id: 'all', labelKey: 'expertMarket.stageAll', defaultZh: '全部', defaultEn: 'All' },
  { id: 'research', labelKey: 'expertMarket.stageResearch', defaultZh: '选品', defaultEn: 'Research' },
  { id: 'production', labelKey: 'expertMarket.stageProduction', defaultZh: '内容', defaultEn: 'Content' },
  { id: 'growth', labelKey: 'expertMarket.stageGrowth', defaultZh: '运营', defaultEn: 'Operations' },
  { id: 'system', labelKey: 'expertMarket.stageSystem', defaultZh: '系统', defaultEn: 'System' },
];

export const DEFAULT_MARKET_EXPERTS = [
  {
    id: 'ecom-market-research',
    name: '选品专家',
    nameEn: 'Market Analyst',
    description: '接管 TikTok 三闸跟爆工作台与类目表脚本，覆盖销量加速初筛、渠道占比核验、品牌词风控及价格带波谷测算。',
    descriptionEn: 'Runs TikTok 3-gate discovery tasks and CSV category scripts for velocity screening, risk audits, CR10, and price-band gaps.',
    avatar: generatePixelAvatarDataUrl('ecom-market-research', { size: 96 }),
    status: 'available',
    stage: 'research',
    group: 'ecommerce',
    starters: [
      { id: 'tk-gate', labelZh: 'TikTok 三闸跟爆筛品', labelEn: 'Run TikTok 3-Gate Scout', promptZh: '用跟爆选品三闸工作台帮我试拉并筛选 <目标类目或关键词> 的加速爆品，先给试拉规模预估再创建任务。', promptEn: 'Dry-run the TikTok 3-gate selection workbench for <category/keyword> and preview hit volume before creating a task.' },
      { id: 'csv-gap', labelZh: '类目表容量与波谷测算', labelEn: 'Analyze Category CSV', promptZh: '我有一份类目导出表 <粘贴路径或上传CSV>，请用脚本计算月容量、CR10 与价格带波谷并给出进入结论。', promptEn: 'Analyze my exported category sheet <path/CSV> with scripts for market size, CR10, and price-band gaps.' },
      { id: 'risk-check', labelZh: '核查选品库并同步商品库', labelEn: 'Review & Sync Picks', promptZh: '查看当前跟爆选品库待审核商品，核对品牌敏感词风控结果，确认后同步进商品库。', promptEn: 'Review pending picks in the TikTok selection library, inspect risk audit results, and sync approved items to Products.' },
    ],
  },
  {
    id: 'ecom-product-strategy',
    name: '定价专家',
    nameEn: 'Pricing Strategist',
    description: '提炼唯一核心卖点、规划 SKU 角色矩阵、精算含税净利率/盈亏价/券余量，并沉淀进商品库作为全链路真源。',
    descriptionEn: 'Distills a single core selling point, SKU role matrix, tax-aware margin/break-even/coupon headroom, and syncs truth to Products.',
    avatar: generatePixelAvatarDataUrl('ecom-product-strategy', { size: 96 }),
    status: 'available',
    stage: 'research',
    group: 'ecommerce',
    starters: [
      { id: 'margin', labelZh: '核算含税毛利与盈亏价', labelEn: 'Calculate Net Margin', promptZh: '帮我核算 @Product/<商品名> 在 <目标平台站点> 的含税净利率、盈亏平衡价与优惠券余量。', promptEn: 'Compute tax-aware net margin, break-even price, and coupon headroom for @Product/<name> on <marketplace>.' },
      { id: 'usp', labelZh: '收敛唯一核心卖点', labelEn: 'Distill Single Core USP', promptZh: '基于商品参数与竞品痛点，把这款产品收敛成唯一核心卖点与禁用词清单。', promptEn: 'Distill verified specs and competitor pain points into one core USP and forbidden-word list.' },
      { id: 'sku', labelZh: '规划 SKU 四角色矩阵', labelEn: 'Plan SKU Role Matrix', promptZh: '为这款商品设计引流款、利润款、组合款与形象款 SKU 矩阵并沉淀进商品库。', promptEn: 'Design traffic, profit, bundle, and hero SKU roles and sync the verified spec table to Products.' },
    ],
  },
  {
    id: 'ecom-brand-curator',
    name: '品牌管家',
    nameEn: 'Brand Curator',
    description: '从商品页链接与实拍素材冷启动建档，确定性校验参数真源与色值规范，一次性沉淀可复用的商品库与品牌资产锚点。',
    descriptionEn: 'Bootstraps structured product profiles, validated spec tables, and reusable brand visual anchors from URLs and raw photos.',
    avatar: generatePixelAvatarDataUrl('ecom-brand-curator', { size: 96 }),
    status: 'available',
    stage: 'research',
    group: 'ecommerce',
    starters: [
      { id: 'url-onboard', labelZh: '从商品链接冷启动建档', labelEn: 'Onboard from Product URL', promptZh: '请抓取这个商品链接 <粘贴链接>，拆出四级事实参数表并用脚本校验缺口，确认后写入商品库。', promptEn: 'Fetch <product URL>, extract a 4-tier verified spec table, validate gaps via script, and save to Products.' },
      { id: 'asset-anchor', labelZh: '整理实拍图沉淀品牌资产', labelEn: 'Organize Brand Assets', promptZh: '把这批商品实拍图与品牌主色整理成可长期复用的资产库角色、场景与风格锚点。', promptEn: 'Curate these product photos and brand palette into reusable Asset Center characters, scenes, and style packs.' },
      { id: 'audit-kit', labelZh: '体检商品库与资产缺口', labelEn: 'Audit Workspace Truth', promptZh: '盘点我当前商品库和资产库里缺失的关键参数、禁用词或白底锚点图，给出补齐清单。', promptEn: 'Audit my existing Products and Assets for missing specs, forbidden words, or hero anchor images.' },
    ],
  },
  {
    id: 'ecom-listing-copy',
    name: '文案专家',
    nameEn: 'Listing Copywriter',
    description: '读取商品库参数真源，产出关键词分层、多语母语 Listing 标题与七段式商详，并通过字数、禁用词与参数溯源校验。',
    descriptionEn: 'Turns verified product specs into tiered keywords, native multilingual titles and 7-part listings with length, ban-word & spec checks.',
    avatar: generatePixelAvatarDataUrl('ecom-listing-copy', { size: 96 }),
    status: 'available',
    stage: 'production',
    group: 'ecommerce',
    starters: [
      { id: 'title-desc', labelZh: '生成母语标题与七段商详', labelEn: 'Draft Native Listing', promptZh: '读取 @Product/<商品名> 真源，生成 <目标平台与语言> 高转化标题与七段式商详，并跑完合规校验。', promptEn: 'Draft a native <marketplace/language> title and 7-part listing from @Product/<name> with validation.' },
      { id: 'kw', labelZh: '输出关键词分层矩阵', labelEn: 'Build Keyword Tiers', promptZh: '为 @Product/<商品名> 拆出核心词、场景长尾词与痛点词分层表。', promptEn: 'Build tiered core, scenario, and pain-point keywords for @Product/<name>.' },
      { id: 'lint', labelZh: '校验已有文案合规与参数', labelEn: 'Validate Existing Copy', promptZh: '用校验脚本检查这段 Listing 文案的字节上限、违禁词与数字参数溯源：<粘贴文案>。', promptEn: 'Validate this listing draft for byte limits, banned words, and spec traceability: <paste copy>.' },
    ],
  },
  {
    id: 'ecom-visual-studio',
    name: '视觉专家',
    nameEn: 'Visual Designer',
    description: '锁定商品实拍外观与色值，规划 9 图视觉矩阵与商详排版，驱动创作画布批量出图并执行白底/主体占比像素质检。',
    descriptionEn: 'Plans 9-image visual stacks and A+ layouts locked to real product photos, drives Canvas generation, and runs pixel compliance checks.',
    avatar: generatePixelAvatarDataUrl('ecom-visual-studio', { size: 96 }),
    status: 'available',
    stage: 'production',
    group: 'ecommerce',
    starters: [
      { id: 'nine-grid', labelZh: '规划 9 图视觉矩阵', labelEn: 'Plan 9-Image Stack', promptZh: '锁定 @Product/<商品名> 实拍外观，先输出 9 图视觉矩阵分工表，确认后再进画布出图。', promptEn: 'Lock real product appearance from @Product/<name> and plan a 9-image visual matrix before Canvas generation.' },
      { id: 'hero-qa', labelZh: '质检白底主图合规像素', labelEn: 'Run Main-Image QA', promptZh: '运行像素质检脚本检查这组主图的分辨率、纯白底与主体占比：<附图片或路径>。', promptEn: 'Run pixel compliance QA on resolution, white background, and subject ratio for <images>.' },
      { id: 'aplus', labelZh: '设计商详对比与场景图', labelEn: 'Design A+ Visuals', promptZh: '围绕唯一核心卖点设计痛点对比图与场景卖点图，并在创作画布搭建生成节点。', promptEn: 'Plan pain-point comparison and lifestyle feature visuals on the Workflow Canvas.' },
    ],
  },
  {
    id: 'ecom-video-director',
    name: '视频导演',
    nameEn: 'Video Director',
    description: '串联灵感 5D 拆解、资产与数字人、画布分镜生片与视频剪辑工坊，把控 3 秒 Hook、口播时长与参数溯源校验。',
    descriptionEn: 'Connects 5D inspiration breakdowns, assets/avatars, Canvas storyboards, and Clip timeline with 3s hook, duration & spec checks.',
    avatar: generatePixelAvatarDataUrl('ecom-video-director', { size: 96 }),
    status: 'available',
    stage: 'production',
    group: 'ecommerce',
    starters: [
      { id: 'hook-script', labelZh: '策划 3 秒 Hook 带货脚本', labelEn: 'Plan 3s Hook Script', promptZh: '基于 @Product/<商品名> 策划 30 秒竖屏带货脚本，先用脚本校验口播时长与参数再开画布。', promptEn: 'Draft a 30s vertical shoppable video script for @Product/<name> with duration & spec validation.' },
      { id: 'replicate', labelZh: '5D 拆解参考爆款复刻', labelEn: '5D Viral Replication', promptZh: '结合灵感库这条参考视频 <粘贴链接或编号> 做 5D 拆解，为我的商品搭建复刻分镜画布。', promptEn: 'Break down reference video <link/id> in 5D and wire a replication storyboard on Canvas.' },
      { id: 'clip-cut', labelZh: '汇总镜头进剪辑工坊精修', labelEn: 'Assemble in Clip Studio', promptZh: '把当前画布生成的片段装配进 Clip 剪辑工程，完成字幕对轨、黑场诊断并输出预览。', promptEn: 'Assemble generated clips in Clip Studio, sync captions, run diagnostics, and prepare review cut.' },
    ],
  },
  {
    id: 'ecom-global-localizer',
    name: '本土专家',
    nameEn: 'Global Localizer',
    description: '锁定商品实拍与参数真源，将验证过的带货视频与套图按四栏矩阵安全裂变至多国多语种，脚本校核口播时长膨胀与本地红线。',
    descriptionEn: 'Locks verified product specs and localizes proven video ads across countries and languages with duration expansion & compliance checks.',
    avatar: generatePixelAvatarDataUrl('ecom-global-localizer', { size: 96 }),
    status: 'available',
    stage: 'production',
    group: 'ecommerce',
    starters: [
      { id: 'four-col', labelZh: '拆解四栏跨国本地化方案', labelEn: 'Build 4-Column Plan', promptZh: '把 @Product/<商品名> 的母版视频拆解为 <美区 EN / 巴西 PT-BR / 拉美 ES> 四栏本地化方案，锁定外观与数字参数。', promptEn: 'Create a 4-column localization matrix for @Product/<name> targeting <US EN / BR PT-BR / LATAM ES>.' },
      { id: 'dur-check', labelZh: '校验多语口播时长与红线', labelEn: 'Check Voiceover Expansion', promptZh: '用校验脚本核对这套多语翻译脚本的语速膨胀率、参数一致性与目标国违禁词。', promptEn: 'Run the localization check script on voiceover expansion ratio, spec invariance, and market redlines.' },
      { id: 'pilot', labelZh: '先跑单市场数字人小样', labelEn: 'Run Single-Market Pilot', promptZh: '先在 <目标国家/语言> 选配本地数字人与配音跑 1 条核心镜头小样，我确认后再批量铺开其他市场。', promptEn: 'Run a single pilot shot for <target market> with local avatar and voiceover before scaling to all markets.' },
    ],
  },
  {
    id: 'ecom-ads-optimizer',
    name: '广告专家',
    nameEn: 'Ads Optimizer',
    description: '测算盈亏线 ROAS 与可承受 CPC，按五层转化漏斗定位点击/加购/转化瓶颈，输出分级调优清单并定向回流素材优化。',
    descriptionEn: 'Computes break-even ROAS & max CPC, diagnoses 5-stage ad funnels, outputs P0/P1/P2 action checklists and targeted creative feedback.',
    avatar: generatePixelAvatarDataUrl('ecom-ads-optimizer', { size: 96 }),
    status: 'available',
    stage: 'growth',
    group: 'ecommerce',
    starters: [
      { id: 'roas', labelZh: '五层漏斗诊断广告报表', labelEn: 'Diagnose Ad Funnel', promptZh: '帮我用脚本解析这份广告导出表 <路径/CSV>，算出盈亏线 ROAS 与最大 CPC，并按 P0/P1/P2 给出调优动作。', promptEn: 'Diagnose <ad CSV> with scripts for break-even ROAS, max CPC, and P0/P1/P2 action checklists.' },
      { id: 'feedback', labelZh: '生成定向素材回流工单', labelEn: 'Emit Creative Feedback', promptZh: '根据当前点击率与转化率瓶颈，定位只需重做的具体主图或前 3 秒 Hook。', promptEn: 'Pinpoint exact listing fields, main image slots, or 3s hooks to revise from funnel bottlenecks.' },
      { id: 'budget', labelZh: '测算新品放量预算护栏', labelEn: 'Set Launch Budget Guard', promptZh: '结合 @Product/<商品名> 毛利率，计算测品期止损线与加预算触发阈值。', promptEn: 'Compute stop-loss and scale-up thresholds from @Product/<name> unit economics.' },
    ],
  },
  {
    id: 'ecom-review-voc',
    name: '评论运营',
    nameEn: 'Review Analyst',
    description: '差评 8 类归因与误解型差评识别、好评卖点提炼，输出商详防误解补丁、包装提示图需求与多语合规售后回复话术。',
    descriptionEn: 'Classifies negative reviews across 8 root causes to isolate fixable misunderstandings, emitting listing patches and compliant replies.',
    avatar: generatePixelAvatarDataUrl('ecom-review-voc', { size: 96 }),
    status: 'available',
    stage: 'growth',
    group: 'ecommerce',
    starters: [
      { id: 'voc-8', labelZh: '差评 8 类归因与防误解补丁', labelEn: 'Classify 8 Review Causes', promptZh: '运行评论脚本分析这份评价表 <路径/CSV>，筛出误解型差评并输出可直接粘贴的商详补丁。', promptEn: 'Analyze <reviews CSV> across 8 root causes and emit copy-paste listing patches for misunderstandings.' },
      { id: 'reply', labelZh: '生成多语合规售后回复', labelEn: 'Draft Compliant Replies', promptZh: '针对这几条差评生成 <目标语言> 合规客服回复话术，绝不触碰平台删评红线。', promptEn: 'Draft policy-compliant customer care replies in <language> for these negative reviews.' },
      { id: 'praise', labelZh: '提炼好评高频卖点词', labelEn: 'Mine Praise Phrases', promptZh: '从五星好评里提炼买家原声高频词，反哺下一轮主图与口播钩子。', promptEn: 'Extract recurring buyer phrases from 5-star reviews to feed next-round hooks.' },
    ],
  },
  {
    id: 'ecom-creator-growth',
    name: '达人运营',
    nameEn: 'Creator Manager',
    description: '基于公开社媒数据评估 TikTok/YouTube/IG 达人与爆款信号，输出建联 Brief、内容排期与增长复盘。',
    descriptionEn: 'Evaluates TikTok/YouTube/IG creators & viral outliers from public data, drafting outreach briefs, schedules, and growth recaps.',
    avatar: generatePixelAvatarDataUrl('ecom-creator-growth', { size: 96 }),
    status: 'available',
    stage: 'growth',
    group: 'ecommerce',
    starters: [
      { id: 'eval', labelZh: '评估候选达人带货匹配度', labelEn: 'Evaluate Creator Fit', promptZh: '拉取这批达人公开作品数据 <粘贴账号列表>，按中位数基线计算爆款 lift 并分层。', promptEn: 'Fetch public metrics for <creators>, score median-baseline lift, and tier candidates.' },
      { id: 'brief', labelZh: '生成多语达人建联 Brief', labelEn: 'Draft Outreach Brief', promptZh: '结合 @Product/<商品名> 核心卖点与禁说红线，写一份 <目标语言> 达人寄样建联 Brief。', promptEn: 'Write a <language> creator brief with core USP, redlines, and gifting terms for @Product/<name>.' },
      { id: 'outlier', labelZh: '扫描品类近期爆款信号', labelEn: 'Scan Category Outliers', promptZh: '扫描 <品类关键词> 近期在 TikTok 的高 lift 异常爆款视频并整理选题排期。', promptEn: 'Scan recent high-lift TikTok outlier posts for <keyword> and draft a test schedule.' },
    ],
  },
];

export function buildExpertStartersLookup(items = DEFAULT_MARKET_EXPERTS) {
  const map = new Map();
  const applyItems = (list) => {
    map.clear();
    for (const item of Array.isArray(list) ? list : []) {
      if (item && typeof item.id === 'string' && Array.isArray(item.starters) && item.starters.length > 0) {
        map.set(item.id, item.starters);
      }
    }
  };
  applyItems(items);
  return {
    resolveStarters(presetId) {
      const key = typeof presetId === 'string' ? presetId.trim() : '';
      if (!key) return [];
      const list = map.get(key);
      return Array.isArray(list) ? list : [];
    },
    listExpertIds() {
      return [...map.keys()];
    },
    update(nextItems) {
      applyItems(nextItems);
    },
  };
}

export function getExpertStageLabel(stage, tr, isEn) {
  const opt = EXPERT_STAGE_OPTIONS.find((it) => it.id === stage);
  if (!opt) return '';
  if (typeof tr === 'function') {
    const localized = tr(opt.labelKey);
    if (localized && localized !== opt.labelKey) return localized;
  }
  return isEn ? opt.defaultEn : opt.defaultZh;
}

export function resolveExpertAvatar(item, size = 96) {
  if (!item) return '';
  if (item.avatar && typeof item.avatar === 'string') {
    if (item.avatar.startsWith('data:') || item.avatar.startsWith('http://') || item.avatar.startsWith('https://')) {
      return item.avatar;
    }
  }
  return generatePixelAvatarDataUrl(item.id || item.name || '', { size });
}

export function safeTrySkillInSession(item) {
  const fromWindow = typeof window !== 'undefined' && typeof window.trySkillInSession === 'function'
    ? window.trySkillInSession
    : null;
  const fromFactory = typeof trySkillInSession === 'function' ? trySkillInSession : null;
  const fromShelf = typeof SkillShelf !== 'undefined' && typeof SkillShelf.trySkillInSession === 'function'
    ? SkillShelf.trySkillInSession
    : null;
  const fn = fromWindow || fromFactory || fromShelf;
  if (fn) return fn(item);
}

export const EXPERT_STATUS_CONFIG = {
  enabled: { statusKey: 'expertMarket.enabled', defaultZh: '已入职', defaultEn: 'Employed', btnKey: 'expertMarket.disable', defaultBtn: '禁用', defaultBtnEn: 'Disable' },
  available: { statusKey: 'expertMarket.available', defaultZh: '可聘用', defaultEn: 'Hireable', btnKey: 'expertMarket.install', defaultBtn: '安装', defaultBtnEn: 'Install' },
  disabled: { statusKey: 'expertMarket.disabled', defaultZh: '已离职', defaultEn: 'Resigned', btnKey: 'expertMarket.install', defaultBtn: '安装', defaultBtnEn: 'Install' },
  system: { statusKey: 'expertMarket.system', defaultZh: '系统预置', defaultEn: 'System', btnKey: '', defaultBtn: '', defaultBtnEn: '' },
  custom: { statusKey: 'expertMarket.custom', defaultZh: '用户自建', defaultEn: 'Custom', btnKey: '', defaultBtn: '', defaultBtnEn: '' },
  coming_soon: { statusKey: 'expertMarket.comingSoon', defaultZh: '即将推出', defaultEn: 'Coming soon', btnKey: '', defaultBtn: '', defaultBtnEn: '' },
};

export function getExpertButtonText(conf, tr, isEn) {
  if (!conf.btnKey) return '';
  const val = tr(conf.btnKey);
  if (val) return val;
  return isEn ? conf.defaultBtnEn : conf.defaultBtn;
}

export function getExpertLocalizedNames(item, isEn) {
  const title = isEn ? (item.nameEn || item.name) : item.name;
  const desc = isEn ? (item.descriptionEn || item.description) : item.description;
  return { title, desc };
}

export function getExpertStatusText(conf, tr, isEn) {
  const statusVal = tr(conf.statusKey);
  const fallback = isEn ? conf.defaultEn : conf.defaultZh;
  return '[ ' + (statusVal || fallback) + ' ]';
}

export function resolveIntroHeading(isExpertTab, isEn, tr, isPluginsTab) {
  if (isPluginsTab) {
    const defaultEn = 'Plugins';
    const defaultZh = '插件专栏';
    return tr('pluginsColumn.title') || (isEn ? defaultEn : defaultZh);
  }
  if (isExpertTab) {
    const defaultEn = 'Experts Market';
    const defaultZh = '专家市场';
    return tr('expertMarket.title') || (isEn ? defaultEn : defaultZh);
  }
  return tr('workshop.title') || 'Skill';
}

export function resolveIntroSubtitle(isExpertTab, isEn, tr, isPluginsTab) {
  if (isPluginsTab) {
    const defaultEn = 'Manage and configure OmniMux features and extension plugins';
    const defaultZh = '管理与配置 OmniMux 功能插件与扩展能力';
    return tr('pluginsColumn.subtitle') || (isEn ? defaultEn : defaultZh);
  }
  if (isExpertTab) {
    const defaultEn = 'Discover and install AI Agents to extend your workspace';
    const defaultZh = '发现并安装AI代理以扩展您的工作区';
    return tr('expertMarket.subtitle') || (isEn ? defaultEn : defaultZh);
  }
  return tr('workshop.subtitle');
}

export function resolvePlaceholderText(isExpertTab, isEn, mainTab, tr, isPluginsTab) {
  if (isPluginsTab || mainTab === 'plugins') {
    return tr('pluginsColumn.searchPlaceholder') || (isEn ? 'Search all plugins...' : '搜索全部插件...');
  }
  if (isExpertTab) {
    return tr('expertMarket.searchPlaceholder') || (isEn ? 'Search all experts...' : '搜索全部专家');
  }
  const key = mainTab === 'mine' ? 'workshop.searchMinePlaceholder' : 'workshop.searchPlaceholder';
  return tr(key);
}

export function resolveIntroTexts(state, tr, isEn, isExpertTab, isPluginsTab) {
  const isPlugins = isPluginsTab || (state && state.mainTab === 'plugins');
  return {
    introHeading: resolveIntroHeading(isExpertTab, isEn, tr, isPlugins),
    introSubtitle: resolveIntroSubtitle(isExpertTab, isEn, tr, isPlugins),
    placeholderText: resolvePlaceholderText(isExpertTab, isEn, state.mainTab, tr, isPlugins),
  };
}

export function extractItemSourceKey(it) {
  const primary = it.source || it.origin;
  return primary || it.channel || 'OmniMux';
}

/** 空值安全的绝对路径规整：非字符串或空白一律回落空串。 */
function normalizeDirPath(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.replace(/[/\\]+$/, '') : '';
}

/**
 * 当前项目绝对路径（套件安装写规则用）：会话 cwd 优先，回落当前 / 最近工作区目录。
 * 解析不到时返回空串 —— 调用方必须显式提示，不得把空路径当项目根发给服务端。
 */
export function resolveProjectDir(sessions, workspaces) {
  try {
    const sessionSnap = sessions && sessions.list && typeof sessions.list.getSnapshot === 'function'
      ? sessions.list.getSnapshot()
      : null;
    const currentId = sessionSnap ? sessionSnap.current : '';
    const currentSession = sessionSnap && sessionSnap.byId && currentId ? sessionSnap.byId[currentId] : null;
    const cwd = normalizeDirPath(currentSession && currentSession.cwd);
    if (cwd) return cwd;
    const wsSnap = workspaces && workspaces.list && typeof workspaces.list.getSnapshot === 'function'
      ? workspaces.list.getSnapshot()
      : null;
    const items = wsSnap && Array.isArray(wsSnap.items) ? wsSnap.items : [];
    const byId = (id) => (id ? items.find((ws) => ws && String(ws.workspaceId || '') === String(id)) : null);
    const owner = byId(currentSession && currentSession.workspaceId) || byId(wsSnap && wsSnap.recentWorkspaceId) || items[0];
    return normalizeDirPath(owner && owner.path);
  } catch {
    return '';
  }
}

/**
 * 首页自定义排序写失败的诊断留痕（Issue #3528）。
 * 本地顺序已乐观更新，持久化失败不能静默消失；本函数不抛错、不影响后续交互。
 * @param {'move-to-top' | 'reset'} action
 * @param {unknown} error
 */
export function reportHomeOrderWriteFailure(action, error) {
  try {
    const detail = error && typeof error.message === 'string' ? error.message : String(error);
    console.warn(`[omnimux-market] home custom order write failed (${action}): ${detail}`);
  } catch (reportError) {
    // 诊断留痕绝不能反向打断调用链（宿主/扩展可能替换 console.warn）；
    // 丢掉一条 warn 可接受，这里保留被吞值以避免空 catch。
    void reportError;
  }
}

export function handleMoveToTop(targetId, featuredItems, state, apiFn) {
  const rest = featuredItems.map((it) => it.id).filter((id) => id !== targetId);
  const newOrder = [targetId, ...rest];
  state.setCustomOrder(newOrder);
  if (typeof SkillShelf !== 'undefined' && typeof SkillShelf.saveHomeCustomOrder === 'function') {
    SkillShelf.saveHomeCustomOrder(newOrder);
  }
  const runApi = apiFn || (typeof api === 'function' ? api : null);
  if (runApi) runApi('homeCustomOrder', { order: newOrder }).catch((error) => reportHomeOrderWriteFailure('move-to-top', error));
}

export function handleResetOrder(state, apiFn) {
  state.setCustomOrder(null);
  if (typeof SkillShelf !== 'undefined' && typeof SkillShelf.saveHomeCustomOrder === 'function') {
    SkillShelf.saveHomeCustomOrder(null);
  }
  const runApi = apiFn || (typeof api === 'function' ? api : null);
  if (runApi) runApi('homeCustomOrder', { order: [] }).catch((error) => reportHomeOrderWriteFailure('reset', error));
}

export function setSingleExpertStatus(setItems, id, status) {
  setItems((cur) => cur.map((it) => (it.id === id ? { ...it, status } : it)));
}

export async function executeToggleExpert(item, state, apiFn) {
  if (!item || state.expertMarketToggling) return;
  if (item.status === 'system' || item.status === 'custom' || item.status === 'coming_soon') return;
  const isEnabled = item.status === 'enabled';
  const action = isEnabled ? 'expertMarketDisable' : 'expertMarketInstall';
  const nextStatus = isEnabled ? 'disabled' : 'enabled';
  if (typeof state.setExpertMarketError === 'function') state.setExpertMarketError('');
  setSingleExpertStatus(state.setExpertMarketItems, item.id, nextStatus);
  state.setExpertMarketToggling(item.id);
  const runApi = apiFn || (typeof api === 'function' ? api : null);
  if (!runApi) {
    state.setExpertMarketToggling('');
    return;
  }
  try {
    const res = await runApi(action, { id: item.id });
    if (res && res.ok === false) {
      throw new Error(res.error || (isEnabled ? '禁用专家失败' : '安装专家失败'));
    }
    const finalStatus = res ? (res.status || nextStatus) : nextStatus;
    setSingleExpertStatus(state.setExpertMarketItems, item.id, finalStatus);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || (isEnabled ? '禁用专家失败' : '安装专家失败'));
    console.warn(`[omnimux-market] ${action}(${item.id}) failed: ${message}`);
    setSingleExpertStatus(state.setExpertMarketItems, item.id, item.status);
    if (typeof state.setExpertMarketError === 'function') state.setExpertMarketError(message);
  } finally {
    state.setExpertMarketToggling('');
  }
}

export function updatePlazaItemInstalled(item, installed, state, updater) {
  state.setItems((cur) => cur.map((it) => (it.slug === item.slug || it.id === item.id ? { ...it, installed } : it)));
  state.setInstalledItems((cur) => updater(cur, item, installed));
  state.setOpen((cur) => (cur && (cur.slug === item.slug || cur.id === item.id) ? { ...cur, installed } : cur));
}

export {
  EXTERNAL_PLATFORM_ORDER,
  isExternalCatalogSkill,
  resolveExternalPlatform,
} from '../skill-picker-logic.js';

export function handleSwitchToggle(item, state, updater, apiFn) {
  if (item.installed) {
    if (item.preinstalled === true) return;
    const runApi = apiFn || (typeof api === 'function' ? api : null);
    const slug = resolveItemSlug(item);
    if (runApi && updater && slug) {
      if (typeof state.setInstallError === 'function') state.setInstallError('');
      Promise.resolve(runApi('uninstall', { slug }))
        .then(() => {
          updatePlazaItemInstalled(item, false, state, updater);
        })
        .catch((err) => {
          if (typeof state.setInstallError === 'function') {
            state.setInstallError(err ? (err.message || String(err)) : '卸载失败');
          }
        });
      return;
    }
    const next = item.enabled === false;
    state.setItems((cur) => cur.map((it) => (it.slug === item.slug || it.id === item.id ? { ...it, enabled: next } : it)));
    state.setInstalledItems((cur) => cur.map((it) => (it.slug === item.slug || it.id === item.id ? { ...it, enabled: next } : it)));
    return;
  }
  state.setConfirmInstallError('');
  state.setConfirmInstallItem(item);
}

export function resolveItemSlug(item) {
  const token = item.slug || item.token;
  return token || item.skillKey || '';
}

export async function handleConfirmInstall(item, state, mark, apiFn) {
  if (!item || state.confirmInstalling) return;
  const slug = resolveItemSlug(item);
  state.setConfirmInstalling(true);
  state.setConfirmInstallError('');
  const runApi = apiFn || (typeof api === 'function' ? api : null);
  if (!runApi) {
    state.setConfirmInstalling(false);
    return;
  }
  try {
    // session-guide：确认安装也走会话预填，不静默 bundling 第三方引擎
    if (item.installFlow === 'session-guide') {
      const tryFn = (typeof trySkillInSession === 'function')
        ? trySkillInSession
        : (typeof SkillShelf !== 'undefined' && typeof SkillShelf.trySkillInSession === 'function')
          ? SkillShelf.trySkillInSession
          : (typeof window !== 'undefined' && typeof window.trySkillInSession === 'function')
            ? window.trySkillInSession
            : null;
      if (tryFn) {
        await tryFn({
          ...item,
          slug,
          token: slug,
          catalogId: item.catalogId || item.id,
          installFlow: 'session-guide',
          installed: false,
        });
        mark(item, true);
        state.setConfirmInstallItem(null);
        return;
      }
    }
    await runApi('install', { slug, catalogId: item.catalogId || item.id });
    mark(item, true);
    state.setConfirmInstallItem(null);
  } catch (err) {
    state.setConfirmInstallError(err ? (err.message || String(err)) : '安装失败');
  } finally {
    state.setConfirmInstalling(false);
  }
}
