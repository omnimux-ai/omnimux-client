/**
 * Injects and maintains localized copy for OmniMux built-in agent presets
 * in the official `settings.agentPreset` dictionary namespace.
 *
 * The official UI agent-preset plugin maps built-in preset IDs to:
 * - standard: `presetStandardName` / `presetStandardDescription`
 * - cordis: `presetCordisName` / `presetCordisDescription`
 * - daily-work: `presetDailyWorkName` / `presetDailyWorkDescription`
 *
 * This module ensures:
 * - `standard` renders as "代码开发" / "CodeDev"
 * - `daily-work` renders as "日常工作" / "WorkAssistant"
 * - `cordis` renders as "创建Agent" / "Create Agent"
 */

export const AGENT_PRESETS_I18N = {
  zh: {
    presetStandardName: '代码开发',
    presetStandardDescription: '全栈架构设计、代码编写与工程交付。',
    presetDailyWorkName: '日常工作',
    presetDailyWorkDescription: '日常办公协同、文档拟定与事务闭环。',
    presetCordisName: '创建Agent',
    presetCordisDescription: '插件实验开发、运行时检查与团队搭建。',
    dailyWorkName: '日常工作',
    dailyWorkDescription: '日常办公协同、文档拟定与事务闭环。',
  },
  en: {
    presetStandardName: 'CodeDev',
    presetStandardDescription: 'Full-stack architecture, coding, and engineering delivery.',
    presetDailyWorkName: 'WorkAssistant',
    presetDailyWorkDescription: 'Daily office collaboration, docs drafting, and task closure.',
    presetCordisName: 'Create Agent',
    presetCordisDescription: 'Plugin development, runtime inspection, and team building.',
    dailyWorkName: 'WorkAssistant',
    dailyWorkDescription: 'Daily office collaboration, docs drafting, and task closure.',
  },
}

export const TARGET_NAMESPACE = 'settings.agentPreset'

/**
 * Resolves fallback display copy for a preset ID if not translated by the framework.
 * @param {string} presetId
 * @param {string} [locale='zh']
 * @returns {{ name: string, description: string } | null}
 */
export function getPresetFallbackCopy(presetId, locale = 'zh') {
  if (!presetId) return null
  const lang = String(locale).toLowerCase().startsWith('en') ? 'en' : 'zh'
  const dict = AGENT_PRESETS_I18N[lang]
  if (presetId === 'daily-work' || presetId === 'dailywork') {
    return {
      name: dict.presetDailyWorkName,
      description: dict.presetDailyWorkDescription,
    }
  }
  if (presetId === 'standard') {
    return {
      name: dict.presetStandardName,
      description: dict.presetStandardDescription,
    }
  }
  if (presetId === 'cordis') {
    return {
      name: dict.presetCordisName,
      description: dict.presetCordisDescription,
    }
  }
  if (
    presetId === 'content-creation-team' ||
    presetId === 'content-creator-team' ||
    presetId === 'exp-ai-content-creator-team' ||
    presetId === '内容创作' ||
    presetId === '内容创作专家团'
  ) {
    return {
      name: lang === 'en' ? 'Content Creation' : '内容创作',
      description:
        lang === 'en'
          ? 'Multimodal creative planning, scripts, and video production.'
          : '多模态创意策划、脚本分镜与视听制作。',
    }
  }
  if (presetId === 'tiktok-agent' || presetId === 'tiktokagent' || presetId === 'tiktok-ops-team' || presetId === 'TikTok运营专家团') {
    return {
      name: lang === 'en' ? 'TikTok Ops Team' : 'TikTok运营专家团',
      description:
        lang === 'en'
          ? 'TikTok end-to-end viral video creation, shop ops, and growth matrix.'
          : '全链路爆款视频创作、带货选品、互动截流与投流增长。',
    }
  }
  if (
    presetId === 'omni-agent' ||
    presetId === 'OmniMux' ||
    presetId === '内容电商助手' ||
    presetId === '全域社媒操盘手' ||
    presetId === '全能社媒操盘手' ||
    presetId === '社媒专家'
  ) {
    return {
      name: 'OmniMux',
      description:
        lang === 'en'
          ? 'All-in-one content e-commerce Agent for product research, scripts, media production, and cross-border growth.'
          : '内容电商全链路默认 Agent——覆盖选品洞察、脚本分镜、素材生产与全域增长。',
    }
  }
  if (presetId === 'marketing-agent' || presetId === 'omni-marketing-agent' || presetId === '全能营销操盘手' || presetId === '营销专家') {
    return {
      name: lang === 'en' ? 'Marketing Lead' : '营销专家',
      description:
        lang === 'en'
          ? 'Omnichannel campaign strategy, creative ads, and ROI attribution.'
          : '全域获客、创意策划、全渠道投放与ROI数据归因。',
    }
  }
  if (presetId === 'drama-agent' || presetId === 'omni-drama-agent' || presetId === '全能短剧操盘手' || presetId === '短剧专家') {
    return {
      name: lang === 'en' ? 'Short Drama Showrunner' : '短剧专家',
      description:
        lang === 'en'
          ? 'Short drama scriptwriting, storyboards, voice acting, and global dubbing.'
          : '微短剧工业化编剧、分镜运镜、多角色配音、剪辑成片与出海译配。',
    }
  }
  if (presetId === 'ecom-market-research') {
    return {
      name: lang === 'en' ? 'Market Analyst' : '选品专家',
      description: lang === 'en'
        ? 'Live TikTok 3-gate trending discovery & creator cross-checks plus CSV category sizing, CR10, and price-band gap analysis.'
        : '联动 TikTok 实时选品与三闸跟爆验证、CSV 类目容量/CR10/价格带波谷测算与竞品拆解，输出可验证选品结论。',
    }
  }
  if (presetId === 'ecom-brand-curator') {
    return {
      name: lang === 'en' ? 'Brand Curator' : '品牌管家',
      description: lang === 'en'
        ? 'Builds verified product fact sheets, brand tone, color palettes, forbidden words, and Hero shot packs synced to Products.'
        : '冷启动构建商品参数真源、品牌调性、主辅色规范、禁用词表与 Hero 实拍资产包，沉淀商品库供全链路复用。',
    }
  }
  if (presetId === 'ecom-product-strategy') {
    return {
      name: lang === 'en' ? 'Pricing Strategist' : '定价专家',
      description: lang === 'en'
        ? 'Distills a single core selling point, SKU role matrix, tax-aware margin/break-even/coupon headroom, and syncs truth to Products.'
        : '提炼唯一核心卖点、规划 SKU 角色矩阵、精算含税净利率/盈亏价/券余量，并沉淀进商品库作为全链路真源。',
    }
  }
  if (presetId === 'ecom-listing-copy') {
    return {
      name: lang === 'en' ? 'Listing Copywriter' : '文案专家',
      description: lang === 'en'
        ? 'Turns verified product specs into tiered keywords, native multilingual titles and 7-part listings with length, ban-word & spec checks.'
        : '读取商品库参数真源，产出关键词分层、多语母语 Listing 标题与七段式商详，并通过字数、禁用词与参数溯源校验。',
    }
  }
  if (presetId === 'ecom-visual-studio') {
    return {
      name: lang === 'en' ? 'Visual Designer' : '视觉专家',
      description: lang === 'en'
        ? 'Plans 9-image visual stacks and A+ layouts locked to real product photos, drives Canvas generation, and runs pixel compliance checks.'
        : '锁定商品实拍外观与色值，规划 9 图视觉矩阵与商详排版，驱动创作画布批量出图并执行白底/主体占比像素质检。',
    }
  }
  if (presetId === 'ecom-video-director') {
    return {
      name: lang === 'en' ? 'Video Director' : '视频导演',
      description: lang === 'en'
        ? 'Connects 5D inspiration breakdowns, assets/avatars, Canvas storyboards, and Clip timeline with 3s hook, duration & spec checks.'
        : '串联灵感 5D 拆解、资产与数字人、画布分镜生片与视频剪辑工坊，把控 3 秒 Hook、口播时长与参数溯源校验。',
    }
  }
  if (presetId === 'ecom-global-localizer') {
    return {
      name: lang === 'en' ? 'Global Localizer' : '本土专家',
      description: lang === 'en'
        ? 'Adapts winning scripts into native US/SEA/LATAM/JP/DE creative matrices with localized hooks, avatars, voices, and compliance checks.'
        : '将母版爆款脚本适配美/东南亚/拉美/日/德多国市场，完成本土化口播、数字人音色配对、语速合规质检与画布矩阵裂变。',
    }
  }
  if (presetId === 'ecom-ads-optimizer') {
    return {
      name: lang === 'en' ? 'Ads Optimizer' : '广告专家',
      description: lang === 'en'
        ? 'Computes break-even ROAS & max CPC, diagnoses 5-stage ad funnels, outputs P0/P1/P2 action checklists and targeted creative feedback.'
        : '测算盈亏线 ROAS 与可承受 CPC，按五层转化漏斗定位点击/加购/转化瓶颈，输出分级调优清单并定向回流素材优化。',
    }
  }
  if (presetId === 'ecom-review-voc') {
    return {
      name: lang === 'en' ? 'Review Analyst' : '评论运营',
      description: lang === 'en'
        ? 'Classifies negative reviews across 8 root causes to isolate fixable misunderstandings, emitting listing patches and compliant replies.'
        : '差评 8 类归因与误解型差评识别、好评卖点提炼，输出商详防误解补丁、包装提示图需求与多语合规售后回复话术。',
    }
  }
  if (presetId === 'ecom-creator-growth') {
    return {
      name: lang === 'en' ? 'Creator Manager' : '达人运营',
      description: lang === 'en'
        ? 'Evaluates TikTok/YouTube/IG creators & viral outliers from public data, drafting outreach briefs, schedules, and growth recaps.'
        : '基于公开社媒数据评估 TikTok/YouTube/IG 达人与爆款信号，输出建联 Brief、内容排期与增长复盘。',
    }
  }
  if (presetId === 'shopee-ops-expert') {
    return {
      name: lang === 'en' ? 'Shopee Ops Expert' : 'Shopee运营专家',
      description: lang === 'en' ? 'Shopee operation specialist for market, product, shop, brand and keyword analysis.' : '负责市场、产品、店铺、品牌和关键词分析的Shopee运营专员。',
    }
  }
  if (presetId === 'youtube-creator-expert') {
    return {
      name: lang === 'en' ? 'YouTube Creator Expert' : 'YouTube创作者专家',
      description: lang === 'en' ? 'Helps merchants discover and evaluate YouTube creators using public channel metrics.' : '帮助商家基于公开频道数据发现和评估 YouTube 创作者。',
    }
  }
  if (presetId === 'amazon-operations-expert') {
    return {
      name: lang === 'en' ? 'Amazon Operations Expert' : '亚马逊运营专家',
      description: lang === 'en' ? 'Focused on Amazon store operations, listing optimization, advertising, and competitor analysis to improve conversion.' : '专注于亚马逊店铺运营、商品详情优化、广告投放和竞争对手分析，以提高转化率和销售额。',
    }
  }
  if (presetId === 'tiktok-ecommerce-expert') {
    return {
      name: lang === 'en' ? 'TikTok Ecommerce Expert' : 'TikTok电商专家',
      description: lang === 'en' ? 'Expert in TikTok short-video selling, creator partnerships, and growth strategies to help brands launch on TikTok Shop.' : '擅长TikTok短视频销售、创作者合作和增长策略，帮助品牌在TikTok Shop上推出产品。',
    }
  }
  if (presetId === 'media-creator') {
    return {
      name: lang === 'en' ? 'Media Creator' : '媒体创作者',
      description: lang === 'en' ? 'AI content generation for videos, images, digital avatars, and voiceovers in OmniMux.' : '在 OmniMux 中进行视频、图像、数字替身与配音等多模态 AI 内容创作。',
    }
  }
  return null
}

/**
 * Resolves localized preset display text with fallback support for custom/unrecognized presets like daily-work.
 * @param {{ id: string, name?: string, description?: string, trust?: string }} preset
 * @param {(key: string) => string} [t]
 * @param {string} [activeLocale='zh']
 * @returns {{ name: string, description?: string }}
 */
export function resolvePresetDisplayText(preset, t, activeLocale = 'zh') {
  if (!preset) return { name: '' }
  const lang = String(activeLocale).toLowerCase().startsWith('en') ? 'en' : 'zh'
  const dict = AGENT_PRESETS_I18N[lang]

  if (typeof t === 'function') {
    if (preset.id === 'standard') {
      return {
        name: t('presetStandardName') || dict.presetStandardName,
        description: t('presetStandardDescription') || dict.presetStandardDescription,
      }
    }
    if (preset.id === 'daily-work') {
      const translatedName = t('presetDailyWorkName')
      const translatedDesc = t('presetDailyWorkDescription')
      return {
        name: (translatedName && translatedName !== 'presetDailyWorkName') ? translatedName : dict.presetDailyWorkName,
        description: (translatedDesc && translatedDesc !== 'presetDailyWorkDescription') ? translatedDesc : dict.presetDailyWorkDescription,
      }
    }
    if (preset.id === 'cordis') {
      return {
        name: t('presetCordisName') || dict.presetCordisName,
        description: t('presetCordisDescription') || dict.presetCordisDescription,
      }
    }
  }

  const fallback = getPresetFallbackCopy(preset.id, activeLocale)
  if (fallback) {
    return {
      name: fallback.name,
      description: fallback.description,
    }
  }

  return {
    name: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { description: preset.description }),
  }
}

/**
 * Patch existing locale dictionary maps for settings.agentPreset.
 * @param {any} locale
 * @returns {boolean} True if any value was patched.
 */
export function patchAgentPresetsLocaleDicts(locale) {
  if (!locale || !locale.dicts || typeof locale.dicts.get !== 'function') {
    return false
  }

  const locales = locale.dicts.get(TARGET_NAMESPACE)
  if (!locales || typeof locales.entries !== 'function') {
    return false
  }

  let changed = false

  for (const [lang, overrides] of Object.entries(AGENT_PRESETS_I18N)) {
    // 1. Update any existing entry that matches the language prefix (e.g. 'zh', 'zh-cn', 'en', 'en-us')
    for (const [localeKey, dict] of locales.entries()) {
      if (typeof localeKey !== 'string' || !dict || typeof dict !== 'object') continue
      const lower = localeKey.toLowerCase()
      if (lower === lang || lower.startsWith(`${lang}-`)) {
        for (const [key, val] of Object.entries(overrides)) {
          if (dict[key] !== val) {
            dict[key] = val
            changed = true
          }
        }
      }
    }

    // 2. Ensure base language entry exists in the locales map
    const baseDict = locales.get(lang)
    if (baseDict && typeof baseDict === 'object') {
      for (const [key, val] of Object.entries(overrides)) {
        if (baseDict[key] !== val) {
          baseDict[key] = val
          changed = true
        }
      }
    }
  }

  if (changed) {
    try {
      if (typeof locale.publish === 'function') {
        locale.publish(locale.snapshot?.active, false)
      }
    } catch {
      // Defensive ignore
    }
  }

  return changed
}

/**
 * Install the i18n patch onto the given Cordis context.
 * Uses immediate application, `ctx.locale.register` interception, periodic polling,
 * and lifecycle cleanup via `ctx.effect`.
 *
 * @param {{
 *   locale?: {
 *     dicts?: Map<string, Map<string, Record<string, string>>>,
 *     register?: (namespace: string, pairs: Record<string, any>) => any,
 *     publish?: Function,
 *     snapshot?: { active?: string },
 *   },
 *   effect?: (fn: () => (() => void) | void, desc?: string) => void,
 * }} ctx
 * @returns {() => void} Dispose function
 */
export function installAgentPresetsI18n(ctx) {
  if (!ctx || !ctx.locale) {
    return () => {}
  }

  const locale = ctx.locale
  let timer = null
  let disposed = false

  const apply = () => {
    if (disposed) return false
    return patchAgentPresetsLocaleDicts(locale)
  }

  // Hook ctx.locale.register defensively to catch synchronous / late registrations
  let originalRegister = null
  let patchedRegisterRef = null

  if (typeof locale.register === 'function') {
    originalRegister = locale.register
    patchedRegisterRef = function patchedRegister(namespace, pairs) {
      try {
        if (namespace === TARGET_NAMESPACE && pairs && typeof pairs === 'object') {
          for (const [lang, overrides] of Object.entries(AGENT_PRESETS_I18N)) {
            for (const [pairKey, pairDict] of Object.entries(pairs)) {
              const lower = String(pairKey).toLowerCase()
              if ((lower === lang || lower.startsWith(`${lang}-`)) && pairDict && typeof pairDict === 'object') {
                Object.assign(pairDict, overrides)
              }
            }
          }
        }
      } catch {
        // Defensive ignore
      }

      const res = originalRegister.apply(this, arguments)
      apply()
      return res
    }
    locale.register = patchedRegisterRef
  }

  // 1. Immediate try
  apply()

  // 2. Interval polling for safety against unintercepted dictionary writes
  if (typeof setInterval !== 'undefined') {
    timer = setInterval(apply, 200)
    if (timer && typeof timer.unref === 'function') {
      timer.unref()
    }
  }

  const cleanup = () => {
    if (disposed) return
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (originalRegister && locale.register === patchedRegisterRef) {
      locale.register = originalRegister
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => cleanup, 'omnimux: agent presets i18n cleanup')
  }

  return cleanup
}
