/**
 * Blank-session bootstrap starter catalog and active preset resolver for
 * hired cross-border SOP experts (`ecom-*`).
 *
 * Strict role isolation:
 * - `omni-agent` (and legacy TikTok aliases) belong exclusively to
 *   `ComposerQuickShortcuts`.
 * - `cordis` (Create Agent) and non-`ecom-*` presets keep zero bootstrap DOM.
 * - Live starter metadata published by `omnimux-market` on
 *   `window.__omnimuxExpertStarters` is preferred; built-in entries mirror
 *   `omnimux-market`'s 10 SOP experts so blank-session bootstrap renders
 *   deterministically even before the market bundle finishes mounting.
 */

import { resolveAgentPresetId } from '../agent-preset-enhancer.js'

/**
 * Fallback read-only starter catalog mirroring `omnimux-market`'s 10 SOP experts.
 * @type {Readonly<Record<string, ReadonlyArray<{ id: string, labelZh: string, labelEn: string, promptZh: string, promptEn: string }>>>}
 */
export const BUILTIN_EXPERT_BOOTSTRAP_STARTERS = Object.freeze({
  'ecom-market-research': Object.freeze([
    Object.freeze({
      id: 'tk-gate',
      labelZh: 'TikTok 三闸跟爆筛品',
      labelEn: 'Run TikTok 3-Gate Scout',
      promptZh: '用跟爆选品三闸工作台帮我试拉并筛选 <目标类目或关键词> 的加速爆品，先给试拉规模预估再创建任务。',
      promptEn: 'Dry-run the TikTok 3-gate selection workbench for <category/keyword> and preview hit volume before creating a task.',
    }),
    Object.freeze({
      id: 'csv-gap',
      labelZh: '类目表容量与波谷测算',
      labelEn: 'Analyze Category CSV',
      promptZh: '我有一份类目导出表 <粘贴路径或上传CSV>，请用脚本计算月容量、CR10 与价格带波谷并给出进入结论。',
      promptEn: 'Analyze my exported category sheet <path/CSV> with scripts for market size, CR10, and price-band gaps.',
    }),
    Object.freeze({
      id: 'risk-check',
      labelZh: '核查选品库并同步商品库',
      labelEn: 'Review & Sync Picks',
      promptZh: '查看当前跟爆选品库待审核商品，核对品牌敏感词风控结果，确认后同步进商品库。',
      promptEn: 'Review pending picks in the TikTok selection library, inspect risk audit results, and sync approved items to Products.',
    }),
  ]),
  'ecom-product-strategy': Object.freeze([
    Object.freeze({
      id: 'margin',
      labelZh: '核算含税毛利与盈亏价',
      labelEn: 'Calculate Net Margin',
      promptZh: '帮我核算 @Product/<商品名> 在 <目标平台站点> 的含税净利率、盈亏平衡价与优惠券余量。',
      promptEn: 'Compute tax-aware net margin, break-even price, and coupon headroom for @Product/<name> on <marketplace>.',
    }),
    Object.freeze({
      id: 'usp',
      labelZh: '收敛唯一核心卖点',
      labelEn: 'Distill Single Core USP',
      promptZh: '基于商品参数与竞品痛点，把这款产品收敛成唯一核心卖点与禁用词清单。',
      promptEn: 'Distill verified specs and competitor pain points into one core USP and forbidden-word list.',
    }),
    Object.freeze({
      id: 'sku',
      labelZh: '规划 SKU 四角色矩阵',
      labelEn: 'Plan SKU Role Matrix',
      promptZh: '为这款商品设计引流款、利润款、组合款与形象款 SKU 矩阵并沉淀进商品库。',
      promptEn: 'Design traffic, profit, bundle, and hero SKU roles and sync the verified spec table to Products.',
    }),
  ]),
  'ecom-brand-curator': Object.freeze([
    Object.freeze({
      id: 'url-onboard',
      labelZh: '从商品链接冷启动建档',
      labelEn: 'Onboard from Product URL',
      promptZh: '请抓取这个商品链接 <粘贴链接>，拆出四级事实参数表并用脚本校验缺口，确认后写入商品库。',
      promptEn: 'Fetch <product URL>, extract a 4-tier verified spec table, validate gaps via script, and save to Products.',
    }),
    Object.freeze({
      id: 'asset-anchor',
      labelZh: '整理实拍图沉淀品牌资产',
      labelEn: 'Organize Brand Assets',
      promptZh: '把这批商品实拍图与品牌主色整理成可长期复用的资产库角色、场景与风格锚点。',
      promptEn: 'Curate these product photos and brand palette into reusable Asset Center characters, scenes, and style packs.',
    }),
    Object.freeze({
      id: 'audit-kit',
      labelZh: '体检商品库与资产缺口',
      labelEn: 'Audit Workspace Truth',
      promptZh: '盘点我当前商品库和资产库里缺失的关键参数、禁用词或白底锚点图，给出补齐清单。',
      promptEn: 'Audit my existing Products and Assets for missing specs, forbidden words, or hero anchor images.',
    }),
  ]),
  'ecom-listing-copy': Object.freeze([
    Object.freeze({
      id: 'title-desc',
      labelZh: '生成母语标题与七段商详',
      labelEn: 'Draft Native Listing',
      promptZh: '读取 @Product/<商品名> 真源，生成 <目标平台与语言> 高转化标题与七段式商详，并跑完合规校验。',
      promptEn: 'Draft a native <marketplace/language> title and 7-part listing from @Product/<name> with validation.',
    }),
    Object.freeze({
      id: 'kw',
      labelZh: '输出关键词分层矩阵',
      labelEn: 'Build Keyword Tiers',
      promptZh: '为 @Product/<商品名> 拆出核心词、场景长尾词与痛点词分层表。',
      promptEn: 'Build tiered core, scenario, and pain-point keywords for @Product/<name>.',
    }),
    Object.freeze({
      id: 'lint',
      labelZh: '校验已有文案合规与参数',
      labelEn: 'Validate Existing Copy',
      promptZh: '用校验脚本检查这段 Listing 文案的字节上限、违禁词与数字参数溯源：<粘贴文案>。',
      promptEn: 'Validate this listing draft for byte limits, banned words, and spec traceability: <paste copy>.',
    }),
  ]),
  'ecom-visual-studio': Object.freeze([
    Object.freeze({
      id: 'nine-grid',
      labelZh: '规划 9 图视觉矩阵',
      labelEn: 'Plan 9-Image Stack',
      promptZh: '锁定 @Product/<商品名> 实拍外观，先输出 9 图视觉矩阵分工表，确认后再进画布出图。',
      promptEn: 'Lock real product appearance from @Product/<name> and plan a 9-image visual matrix before Canvas generation.',
    }),
    Object.freeze({
      id: 'hero-qa',
      labelZh: '质检白底主图合规像素',
      labelEn: 'Run Main-Image QA',
      promptZh: '运行像素质检脚本检查这组主图的分辨率、纯白底与主体占比：<附图片或路径>。',
      promptEn: 'Run pixel compliance QA on resolution, white background, and subject ratio for <images>.',
    }),
    Object.freeze({
      id: 'aplus',
      labelZh: '设计商详对比与场景图',
      labelEn: 'Design A+ Visuals',
      promptZh: '围绕唯一核心卖点设计痛点对比图与场景卖点图，并在创作画布搭建生成节点。',
      promptEn: 'Plan pain-point comparison and lifestyle feature visuals on the Workflow Canvas.',
    }),
  ]),
  'ecom-video-director': Object.freeze([
    Object.freeze({
      id: 'hook-script',
      labelZh: '策划 3 秒 Hook 带货脚本',
      labelEn: 'Plan 3s Hook Script',
      promptZh: '基于 @Product/<商品名> 策划 30 秒竖屏带货脚本，先用脚本校验口播时长与参数再开画布。',
      promptEn: 'Draft a 30s vertical shoppable video script for @Product/<name> with duration & spec validation.',
    }),
    Object.freeze({
      id: 'replicate',
      labelZh: '5D 拆解参考爆款复刻',
      labelEn: '5D Viral Replication',
      promptZh: '结合灵感库这条参考视频 <粘贴链接或编号> 做 5D 拆解，为我的商品搭建复刻分镜画布。',
      promptEn: 'Break down reference video <link/id> in 5D and wire a replication storyboard on Canvas.',
    }),
    Object.freeze({
      id: 'clip-cut',
      labelZh: '汇总镜头进剪辑工坊精修',
      labelEn: 'Assemble in Clip Studio',
      promptZh: '把当前画布生成的片段装配进 Clip 剪辑工程，完成字幕对轨、黑场诊断并输出预览。',
      promptEn: 'Assemble generated clips in Clip Studio, sync captions, run diagnostics, and prepare review cut.',
    }),
  ]),
  'ecom-global-localizer': Object.freeze([
    Object.freeze({
      id: 'four-col',
      labelZh: '拆解四栏跨国本地化方案',
      labelEn: 'Build 4-Column Plan',
      promptZh: '把 @Product/<商品名> 的母版视频拆解为 <美区 EN / 巴西 PT-BR / 拉美 ES> 四栏本地化方案，锁定外观与数字参数。',
      promptEn: 'Create a 4-column localization matrix for @Product/<name> targeting <US EN / BR PT-BR / LATAM ES>.',
    }),
    Object.freeze({
      id: 'dur-check',
      labelZh: '校验多语口播时长与红线',
      labelEn: 'Check Voiceover Expansion',
      promptZh: '用校验脚本核对这套多语翻译脚本的语速膨胀率、参数一致性与目标国违禁词。',
      promptEn: 'Run the localization check script on voiceover expansion ratio, spec invariance, and market redlines.',
    }),
    Object.freeze({
      id: 'pilot',
      labelZh: '先跑单市场数字人小样',
      labelEn: 'Run Single-Market Pilot',
      promptZh: '先在 <目标国家/语言> 选配本地数字人与配音跑 1 条核心镜头小样，我确认后再批量铺开其他市场。',
      promptEn: 'Run a single pilot shot for <target market> with local avatar and voiceover before scaling to all markets.',
    }),
  ]),
  'ecom-ads-optimizer': Object.freeze([
    Object.freeze({
      id: 'roas',
      labelZh: '五层漏斗诊断广告报表',
      labelEn: 'Diagnose Ad Funnel',
      promptZh: '帮我用脚本解析这份广告导出表 <路径/CSV>，算出盈亏线 ROAS 与最大 CPC，并按 P0/P1/P2 给出调优动作。',
      promptEn: 'Diagnose <ad CSV> with scripts for break-even ROAS, max CPC, and P0/P1/P2 action checklists.',
    }),
    Object.freeze({
      id: 'feedback',
      labelZh: '生成定向素材回流工单',
      labelEn: 'Emit Creative Feedback',
      promptZh: '根据当前点击率与转化率瓶颈，定位只需重做的具体主图或前 3 秒 Hook。',
      promptEn: 'Pinpoint exact listing fields, main image slots, or 3s hooks to revise from funnel bottlenecks.',
    }),
    Object.freeze({
      id: 'budget',
      labelZh: '测算新品放量预算护栏',
      labelEn: 'Set Launch Budget Guard',
      promptZh: '结合 @Product/<商品名> 毛利率，计算测品期止损线与加预算触发阈值。',
      promptEn: 'Compute stop-loss and scale-up thresholds from @Product/<name> unit economics.',
    }),
  ]),
  'ecom-review-voc': Object.freeze([
    Object.freeze({
      id: 'voc-8',
      labelZh: '差评 8 类归因与防误解补丁',
      labelEn: 'Classify 8 Review Causes',
      promptZh: '运行评论脚本分析这份评价表 <路径/CSV>，筛出误解型差评并输出可直接粘贴的商详补丁。',
      promptEn: 'Analyze <reviews CSV> across 8 root causes and emit copy-paste listing patches for misunderstandings.',
    }),
    Object.freeze({
      id: 'reply',
      labelZh: '生成多语合规售后回复',
      labelEn: 'Draft Compliant Replies',
      promptZh: '针对这几条差评生成 <目标语言> 合规客服回复话术，绝不触碰平台删评红线。',
      promptEn: 'Draft policy-compliant customer care replies in <language> for these negative reviews.',
    }),
    Object.freeze({
      id: 'praise',
      labelZh: '提炼好评高频卖点词',
      labelEn: 'Mine Praise Phrases',
      promptZh: '从五星好评里提炼买家原声高频词，反哺下一轮主图与口播钩子。',
      promptEn: 'Extract recurring buyer phrases from 5-star reviews to feed next-round hooks.',
    }),
  ]),
  'ecom-creator-growth': Object.freeze([
    Object.freeze({
      id: 'eval',
      labelZh: '评估候选达人带货匹配度',
      labelEn: 'Evaluate Creator Fit',
      promptZh: '拉取这批达人公开作品数据 <粘贴账号列表>，按中位数基线计算爆款 lift 并分层。',
      promptEn: 'Fetch public metrics for <creators>, score median-baseline lift, and tier candidates.',
    }),
    Object.freeze({
      id: 'brief',
      labelZh: '生成多语达人建联 Brief',
      labelEn: 'Draft Outreach Brief',
      promptZh: '结合 @Product/<商品名> 核心卖点与禁说红线，写一份 <目标语言> 达人寄样建联 Brief。',
      promptEn: 'Write a <language> creator brief with core USP, redlines, and gifting terms for @Product/<name>.',
    }),
    Object.freeze({
      id: 'outlier',
      labelZh: '扫描品类近期爆款信号',
      labelEn: 'Scan Category Outliers',
      promptZh: '扫描 <品类关键词> 近期在 TikTok 的高 lift 异常爆款视频并整理选题排期。',
      promptEn: 'Scan recent high-lift TikTok outlier posts for <keyword> and draft a test schedule.',
    }),
  ]),
})

/**
 * Resolve the currently active Agent preset ID using the exact explicit-first
 * precedence contract shared with `isTikTokAgentPreset`:
 * 1. `props.agentPreset`
 * 2. `session.projectionValues.agentPreset`
 * 3. `session.agentPreset`
 * 4. `session.meta.agentPreset`
 * Only when all four explicit fields are empty does resolution fall back to
 * `window.__omnimuxActivePreset` and composer seat DOM attributes/labels.
 *
 * @param {object | null | undefined} session
 * @param {object | null | undefined} props
 * @returns {string}
 */
export function resolveActivePresetId(session, props) {
  const explicitCandidates = [
    props?.agentPreset,
    session?.projectionValues?.agentPreset,
    session?.agentPreset,
    session?.meta?.agentPreset,
  ]

  for (const candidate of explicitCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return resolveAgentPresetId(candidate)
    }
  }

  if (typeof window !== 'undefined' && typeof window.__omnimuxActivePreset === 'string' && window.__omnimuxActivePreset.trim()) {
    return resolveAgentPresetId(window.__omnimuxActivePreset)
  }

  if (typeof document !== 'undefined') {
    const seatEl = document.querySelector('[data-omnimux-preset-seat]')
    if (seatEl) {
      const seatAttr = seatEl.getAttribute('data-omnimux-preset-seat')
      if (typeof seatAttr === 'string' && seatAttr.trim()) return resolveAgentPresetId(seatAttr)
      const idAttr = seatEl.getAttribute('data-omnimux-preset-id')
      if (typeof idAttr === 'string' && idAttr.trim()) return resolveAgentPresetId(idAttr)
    }
    const labelEl = document.querySelector('[class*="seatLabel"]')
    if (labelEl && typeof labelEl.textContent === 'string' && labelEl.textContent.trim()) {
      return resolveAgentPresetId(labelEl.textContent)
    }
  }

  return ''
}

/**
 * Resolve localized blank-session bootstrap starters for a preset ID.
 * Returns an empty list for `omni-agent`, `cordis`, or any non-`ecom-*` preset.
 *
 * @param {string} presetId
 * @param {{ lang?: 'zh' | 'en', seam?: { resolveStarters?: (id: string) => any[] } | null }} [opts]
 * @returns {Array<{ id: string, label: string, prompt: string }>}
 */
export function resolveExpertBootstrapStarters(presetId, opts = {}) {
  const normalized = resolveAgentPresetId(presetId)
  if (!normalized || !normalized.startsWith('ecom-')) return []

  const seam = opts.seam !== undefined
    ? opts.seam
    : (typeof window !== 'undefined' ? window.__omnimuxExpertStarters : null)

  let raw = null
  if (seam && typeof seam.resolveStarters === 'function') {
    try {
      const fromSeam = seam.resolveStarters(normalized)
      if (Array.isArray(fromSeam) && fromSeam.length > 0) raw = fromSeam
    } catch {
      raw = null
    }
  }
  if (!raw) {
    raw = BUILTIN_EXPERT_BOOTSTRAP_STARTERS[normalized] ?? null
  }
  if (!Array.isArray(raw) || raw.length === 0) return []

  const isEn = opts.lang === 'en'
  const out = []
  for (const entry of raw) {
    if (!entry || typeof entry.id !== 'string') continue
    const zhLabel = typeof entry.labelZh === 'string' ? entry.labelZh : (typeof entry.label === 'string' ? entry.label : '')
    const enLabel = typeof entry.labelEn === 'string' ? entry.labelEn : zhLabel
    const zhPrompt = typeof entry.promptZh === 'string' ? entry.promptZh : (typeof entry.prompt === 'string' ? entry.prompt : '')
    const enPrompt = typeof entry.promptEn === 'string' ? entry.promptEn : zhPrompt
    const label = isEn ? enLabel : zhLabel
    const prompt = isEn ? enPrompt : zhPrompt
    if (!label || !prompt) continue
    out.push({ id: entry.id, label, prompt })
    if (out.length >= 3) break
  }
  return out
}
