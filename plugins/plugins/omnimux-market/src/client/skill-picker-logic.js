/** Pure helpers for the Composer Skill picker. Importable by tests; the UI fragment inlines the same rules. */
import catalog from '../../catalog/index.json' with { type: 'json' }
import bundledSkillsManifest from '../../catalog/bundled-skills.json' with { type: 'json' }
import marketManifest from '../../dsh.manifest.json' with { type: 'json' }

import recommendations from '../../catalog/skill-recommendations.json' with { type: 'json' }
import presetSkillsMap from '../../catalog/preset-skills.json' with { type: 'json' }

function extractManifestSkillSlugs(manifest) {
  const list = Array.isArray(manifest && manifest.skills) ? manifest.skills : []
  const slugs = []
  for (const raw of list) {
    const normalized = String(raw || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const match = normalized.match(/(?:^|\/)([^/]+)\/SKILL\.md$/)
    if (match && match[1]) slugs.push(match[1])
  }
  return slugs
}

function normalizeSlugSet(input) {
  if (!input) return new Set()
  if (input instanceof Set) {
    const out = new Set()
    for (const value of input) {
      const clean = String(value || '').trim().replace(/^\/+/, '')
      if (clean) out.add(clean)
    }
    return out
  }
  if (Array.isArray(input)) {
    const out = new Set()
    for (const value of input) {
      const slug = typeof value === 'string'
        ? value
        : (value && typeof value === 'object' ? (value.slug || value.skill || value.name || '') : '')
      const clean = String(slug || '').trim().replace(/^\/+/, '')
      if (clean) out.add(clean)
    }
    return out
  }
  return new Set()
}

/**
 * 本地随包技能真源集合（由 catalog/index.json 随包项、catalog/bundled-skills.json、
 * dsh.manifest.json 三份真实清单推导；绝不采信 preset-skills.json 里的静态 installed 字段）。
 */
export const BUNDLED_SKILL_SLUGS = Object.freeze(new Set([
  ...(Array.isArray(catalog && catalog.items) ? catalog.items : [])
    .filter((item) => item && item.kind === 'skill' && (!item.source || item.source.type === 'bundled' || item.source.type === 'plugin') && item.skill)
    .map((item) => String(item.skill).trim()),
  ...(Array.isArray(bundledSkillsManifest && bundledSkillsManifest.skills) ? bundledSkillsManifest.skills : [])
    .map((item) => String((item && item.slug) || '').trim())
    .filter(Boolean),
  ...extractManifestSkillSlugs(marketManifest),
]))

/**
 * 基于真实随包真源与实时磁盘/Provider 列表推导货架技能的可用态与安装态。
 * 忽略静态 JSON 传入的 `installed` 字段，避免空壳伪造安装态。
 *
 * @param {object} item
 * @param {{ installedSlugs?: Iterable<string | object> | null, providerSlugs?: Iterable<string | object> | null, bundledSlugs?: Iterable<string | object> | null }} [availability]
 */
export function hydratePresetSkill(item, availability = {}) {
  if (!item || typeof item !== 'object') return item
  const slug = String(item.slug || item.skill || '').trim().replace(/^\/+/, '')
  const bundledSet = availability && availability.bundledSlugs != null
    ? normalizeSlugSet(availability.bundledSlugs)
    : BUNDLED_SKILL_SLUGS
  const installedSet = normalizeSlugSet(availability && availability.installedSlugs)
  const providerSet = normalizeSlugSet(availability && availability.providerSlugs)
  const bundled = Boolean(slug && bundledSet.has(slug))
  const installed = Boolean(slug && (installedSet.has(slug) || providerSet.has(slug)))
  const { installed: _ignoredStaticInstalled, ...rest } = item
  return {
    ...rest,
    bundled,
    installed,
    available: bundled || installed,
  }
}

/** 技能是否已在本地随包或已安装/Provider 可用（无需触发远端下载）。 */
export function isSkillLocallyAvailable(item) {
  return Boolean(item && (item.installed === true || item.bundled === true))
}

/**
 * Agent 预设与 Skill 绑定表（Agent 模式决定 skill 范围）。
 */
export const AGENT_PRESET_SKILL_BINDINGS = Object.freeze(presetSkillsMap)

/** 技能激活态全局事件名：任何来源（选择器自身、爆款复刻卡片）都只走这一条通道。 */
export const SKILL_CHANGED_EVENT = 'omnimux:skill:changed'

/**
 * 从 `omnimux:skill:changed` 事件里取技能对象。
 * 载荷形状不认识时一律回落 null，避免把脏数据写进激活态。
 */
export function resolveActiveSkillFromEvent(event) {
  if (!event || typeof event !== 'object') return null
  const detail = event.detail
  if (!detail || typeof detail !== 'object') return null
  const skill = detail.skill
  if (!skill || typeof skill !== 'object') return null
  return skill
}

/**
 * 订阅技能激活态变更。
 *
 * 技能选择器只持有初始的 `window.__omnimuxActiveSkill`，别的来源（例如
 * 爆款对标卡片的「复刻」）激活技能时它必须立刻跟上，否则底部工具栏的技能药丸不会亮。
 * 返回取消订阅函数；无宿主环境时是空操作。
 *
 * @param {(skill: object | null) => void} listener
 * @param {{ addEventListener?: Function, removeEventListener?: Function } | null} [target]
 */
export function subscribeActiveSkill(listener, target) {
  const win = target || (typeof window !== 'undefined' ? window : null)
  if (!win || typeof win.addEventListener !== 'function' || typeof listener !== 'function') {
    return () => {}
  }
  const handler = (event) => listener(resolveActiveSkillFromEvent(event))
  win.addEventListener(SKILL_CHANGED_EVENT, handler)
  return () => {
    try {
      win.removeEventListener(SKILL_CHANGED_EVENT, handler)
    } catch {
      // 宿主已卸载时忽略
    }
  }
}

export function normalizePresetId(presetId) {
  return String(presetId || '').trim().toLowerCase().replace(/_/g, '-')
}

export function getPresetSkillBinding(presetId, mode, availability) {
  if (!presetId && !mode) return null
  const norm = normalizePresetId(presetId)
  const isContentTeam =
    norm === 'content-creation-team' ||
    norm === 'content-creator-team' ||
    norm === 'exp-ai-content-creator-team' ||
    norm === 'ai-content-creator-team' ||
    norm === 'content-creation' ||
    norm === 'content-creator' ||
    presetId === '内容创作' ||
    presetId === '内容创作专家团'

  const isDrama =
    mode === 'drama' ||
    norm === 'drama' ||
    norm === 'drama-agent' ||
    norm === 'omni-drama-agent' ||
    norm === 'short-drama' ||
    norm === 'short-drama-creator' ||
    presetId === '短剧' ||
    presetId === '短剧制作人' ||
    presetId === '短剧专精' ||
    presetId === '全能短剧操盘手'

  const isMarketing =
    mode === 'marketing' ||
    norm === 'marketing' ||
    norm === 'marketing-agent' ||
    norm === 'omni-marketing-agent' ||
    presetId === '营销' ||
    presetId === '全能营销操盘手'

  const isTiktokExplicit =
    norm === 'tiktok-agent' ||
    norm === 'tiktokagent' ||
    norm === 'tiktok'

  const isOmniExplicit =
    norm === 'omni-agent' ||
    norm === 'omnimux' ||
    norm === 'omni' ||
    norm === 'omni-social-agent' ||
    presetId === 'OmniMux' ||
    presetId === '内容电商助手' ||
    presetId === '全域社媒操盘手'

  const isOmniSocial =
    isTiktokExplicit ||
    isOmniExplicit ||
    norm === '全能社媒操盘手' ||
    presetId === '全能社媒操盘手'

  const isAgentDefault =
    mode === 'agent' ||
    norm === 'agent' ||
    norm === 'default'

  const entry =
    (isDrama ? AGENT_PRESET_SKILL_BINDINGS['drama-agent'] : null) ||
    (isMarketing ? AGENT_PRESET_SKILL_BINDINGS['marketing-agent'] : null) ||
    (isOmniExplicit ? AGENT_PRESET_SKILL_BINDINGS['omni-agent'] : null) ||
    (isTiktokExplicit ? AGENT_PRESET_SKILL_BINDINGS['tiktok-agent'] : null) ||
    AGENT_PRESET_SKILL_BINDINGS[presetId] ||
    AGENT_PRESET_SKILL_BINDINGS[norm] ||
    (isOmniSocial
      ? (AGENT_PRESET_SKILL_BINDINGS['tiktok-agent'] || AGENT_PRESET_SKILL_BINDINGS['omni-agent'])
      : null) ||
    (isContentTeam ? AGENT_PRESET_SKILL_BINDINGS['content-creation-team'] : null) ||
    (isAgentDefault
      ? (AGENT_PRESET_SKILL_BINDINGS['tiktok-agent'] || AGENT_PRESET_SKILL_BINDINGS['omni-agent'])
      : null)

  if (!entry) return null

  const hydrateList = (list) => (Array.isArray(list) ? list.map((item) => hydratePresetSkill(item, availability)) : [])

  if (entry.useDefaultContentCatalog) {
    const tabs = [
      { id: 'all', kind: 'all', labelKey: 'picker.tab.all', name: '全部' },
      { id: 'mine', kind: 'mine', labelKey: 'picker.tab.mine', name: '我的' },
      { id: 'featured', kind: 'featured', labelKey: 'picker.tab.featured', name: '精选' },
      ...SKILL_SHELF_TAXONOMY.map((r) => ({ id: r.id, kind: 'tag', labelKey: r.labelKey, name: r.id })),
    ]
    return {
      presetId: entry.presetId || presetId,
      name: entry.name || '内容创作',
      useDefaultContentCatalog: true,
      categories: SKILL_SHELF_TAXONOMY.map((r) => ({ id: r.id, name: r.id, labelKey: r.labelKey })),
      tabs,
      skills: hydrateList(entry.skills),
    }
  }

  const categories = entry.categories || []
  const tabs = [
    { id: 'all', kind: 'all', labelKey: 'picker.tab.all', name: '全部' },
    ...categories.map((c) => ({ id: c.id, kind: 'preset-category', name: c.name })),
  ]
  return {
    presetId: entry.presetId || presetId,
    name: entry.name || presetId,
    categories,
    tabs,
    skills: hydrateList(entry.skills),
  }
}

export function hasPresetSkillBinding(presetId) {
  return getPresetSkillBinding(presetId) !== null
}

/**
 * 按 slug 从**出厂预设技能库**里解析一款真实可用的技能。
 *
 * 优先在 Agent 模式的两条主力绑定（`tiktok-agent`、`omni-agent`）里找，找不到再遍历其余预设；
 * 不采信静态 JSON 的 `installed: true`，必须满足：
 * 1. 条目未被显式禁用（`item.installed !== false && item.available !== false`）；
 * 2. 经 `hydratePresetSkill` 校验后属于真实随包（`bundledSlugs`）或实时已装/Provider（`installedSlugs` / `providerSlugs`）。
 * 解析不到一律返回 null，绝不抛错、绝不编造技能身份。
 *
 * @param {string} slug 技能 slug（可带前导 `/`）
 * @param {Record<string, { skills?: readonly object[] }>} [bindings] 绑定表，测试可注入
 * @param {{ installedSlugs?: Iterable<string | object> | null, providerSlugs?: Iterable<string | object> | null, bundledSlugs?: Iterable<string | object> | null }} [availability]
 * @returns {object | null} 技能条目（附 `presetId`、`bundled`、`installed`、`available`）
 */
export function findPresetSkill(slug, bindings = AGENT_PRESET_SKILL_BINDINGS, availability = {}) {
  const target = String(slug || '').trim().replace(/^\/+/, '')
  if (!target || !bindings || typeof bindings !== 'object') return null
  const preferred = ['tiktok-agent', 'omni-agent']
  const keys = [
    ...preferred.filter((key) => bindings[key]),
    ...Object.keys(bindings).filter((key) => !preferred.includes(key)),
  ]
  for (const key of keys) {
    const list = bindings[key] && bindings[key].skills
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (item.installed === false || item.available === false) continue
      const itemSlug = String(item.slug || item.skill || '').trim().replace(/^\/+/, '')
      if (itemSlug !== target) continue
      const hydrated = hydratePresetSkill(item, availability)
      if (hydrated.available === true) {
        return { ...hydrated, presetId: key }
      }
    }
  }
  return null
}

export function resolveActivePreset({ props, sessions } = {}) {
  if (props && typeof props.agentPreset === 'string' && props.agentPreset) {
    return props.agentPreset
  }
  try {
    const snap = sessions?.list?.getSnapshot?.()
    const targetId = (props && props.sessionId) || snap?.current
    if (targetId && snap?.byId?.[targetId]) {
      const p = snap.byId[targetId]?.projectionValues?.agentPreset
      if (typeof p === 'string' && p) return p
    }
  } catch {}
  if (typeof window !== 'undefined' && window.__omnimuxActivePreset) {
    return window.__omnimuxActivePreset
  }
  return undefined
}

export function filterPresetSkills(skills = [], tabId = 'all', query = '') {
  const list = Array.isArray(skills) ? skills : []
  const q = String(query || '').trim().toLowerCase()
  return list.filter((item) => {
    if (!item) return false
    if (tabId && tabId !== 'all') {
      if (isScenarioTag(tabId)) {
        if (!matchesScenarioTag(item, tabId)) return false
      } else {
        const cat = String(item.category || item.categoryLabel || '').trim()
        const tags = Array.isArray(item.tags) ? item.tags.map(String) : []
        if (cat !== tabId && !tags.includes(tabId)) return false
      }
    }
    if (q) {
      const aliases = Array.isArray(item.aliases) ? item.aliases : []
      const tags = Array.isArray(item.tags) ? item.tags : []
      const hay = [
        item.name,
        item.title,
        item.titleZh,
        item.titleEn,
        item.slug,
        item.skill,
        item.description,
        item.summary,
        item.category,
        ...aliases,
        ...tags,
      ].map((v) => String(v || '')).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Validate editorial IDs separately from resilient rendering; shipped configuration is tested. */
export function validateSkillRecommendations(config = recommendations, entries = catalog.items) {
  const errors = []
  const byId = new Map(entries.map(item => [item.id, item]))
  for (const field of ['featuredSkills', 'homeRecommendations']) {
    if (!Array.isArray(config[field])) {
      errors.push(`${field}: expected an ordered ID array`)
      continue
    }
    const seen = new Set()
    for (const id of config[field]) {
      const item = byId.get(id)
      if (seen.has(id)) errors.push(`${field}: duplicate ${id}`)
      seen.add(id)
      if (!item || item.kind !== 'skill' || item.recommended !== true) errors.push(`${field}: not a recommended Skill: ${id}`)
      if (field === 'homeRecommendations' && !config.featuredSkills?.includes(id)) errors.push(`${field}: not in featuredSkills: ${id}`)
    }
  }
  for (const item of entries) {
    if (item.kind === 'skill' && item.recommended === true && !config.featuredSkills?.includes(item.id)) errors.push(`featuredSkills: missing ${item.id}`)
  }
  return errors
}

/** Resolve from the complete bundled catalog, never a paginated search response. */
export function resolveSkillRecommendations(ids = [], entries = catalog.items) {
  const byId = new Map(entries.map(item => [item.id, item]))
  return [...new Set(ids)].flatMap(id => {
    const item = byId.get(id)
    if (!item || item.kind !== 'skill' || item.recommended !== true) return []
    return [{
      ...item,
      catalogId: item.id,
      slug: item.skill,
      name: item.title,
      description: item.summary,
      installBackend: 'catalog',
      installed: false,
      ...(item.installFlow === 'session-guide'
        ? {
            installFlow: 'session-guide',
            ...(typeof item.sessionPrefill === 'string' && item.sessionPrefill.trim()
              ? { sessionPrefill: item.sessionPrefill.trim() }
              : {}),
          }
        : {}),
    }]
  })
}

export function resolveHomeRecommendationIds(config = recommendations, customOrder = null) {
  let list = Array.isArray(customOrder) && customOrder.length ? customOrder : null
  if (!list && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem('omnimux-market:home-recommendations-order')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length) list = parsed
      }
    } catch {}
  }
  if (Array.isArray(list) && list.length) {
    const base = Array.isArray(config?.homeRecommendations) ? config.homeRecommendations : []
    const validCustom = list.filter(id => typeof id === 'string' && id)
    const seen = new Set(validCustom)
    const rest = base.filter(id => !seen.has(id))
    return [...validCustom, ...rest]
  }
  return config?.homeRecommendations || []
}

export function getHomeCustomOrder() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem('omnimux-market:home-recommendations-order')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return parsed
      }
    } catch {}
  }
  return null
}

export function saveHomeCustomOrder(ids) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (Array.isArray(ids)) {
        window.localStorage.setItem('omnimux-market:home-recommendations-order', JSON.stringify(ids))
        return true
      }
      window.localStorage.removeItem('omnimux-market:home-recommendations-order')
      return true
    } catch {}
  }
  return false
}

/** Split only displayed recommendations out of discovery; full-library search stays independent. */
export function plazaDiscoverySections(items = [], { category = '', query = '', uninstalledOnly = false,
  installedItems = [], providerSlugs = [], config = recommendations, entries = catalog.items, presetBinding = null, customOrder = null } = {}) {
  const key = item => item.slug || item.skill || item.catalogId || item.id
  // 预设分类是预设私有货架：目录同 slug 条目只提供展示元数据，归属一律以预设清单为准，
  // 目录独有的技能也不得借领域标签混入，否则分类计数与预设清单错位。
  const presetCategoryOf = new Map(
    (presetBinding && Array.isArray(presetBinding.skills) ? presetBinding.skills : [])
      .map(item => [String(item.slug || item.skill || '').trim(), String(item.category || item.categoryLabel || '').trim()])
      .filter(([slug]) => slug),
  )
  const presetCategoryIds = new Set(
    (presetBinding && Array.isArray(presetBinding.categories) ? presetBinding.categories : []).map(c => c.id),
  )
  const matches = item => {
    if (!category || category === 'featured') return true
    if (isScenarioTag(category)) return matchesScenarioTag(item, category)
    if (presetBinding && Array.isArray(presetBinding.skills)) {
      if (presetCategoryIds.has(category)) return presetCategoryOf.get(key(item)) === category
      const cat = String(item.category || item.categoryLabel || '').trim()
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : []
      if (cat === category || tags.includes(category)) return true
      if (presetCategoryIds.has(cat)) return false
      if (category === '创作视频') {
        const videoDomains = ['短剧漫剧', '专业影视', '动画']
        if (tags.some(t => videoDomains.includes(t)) || videoDomains.includes(cat)) return true
        if (tags.some(t => ['视频', '多模态', '二创', '分镜', '运镜', '剪辑', 'AI视频'].includes(t))) return true
        const text = [item.name, item.title, item.slug, item.skill, item.description, item.summary].join(' ')
        if (/(视频|短剧|分镜|运镜|剪映|宣传片|成片|TVC|MV|FPV|提示词专家)/i.test(text) && !/(会议|总结网页|微信|企业微信)/i.test(text)) return true
      }
      return false
    }
    return matchesDomainTag(item, category)
  }
  const available = item => !uninstalledOnly || !item.installed
  const unique = list => [...new Map(list.map(item => [key(item), item])).values()]
  const installed = new Map(installedItems.map(item => [key(item), item]))
  const providerSet = normalizeSlugSet(providerSlugs)
  const availability = { installedSlugs: [...installed.keys()], providerSlugs: providerSet }
  const live = new Map(items.map(item => [item.catalogId || item.id, item]))
  const hasQuery = Boolean(String(query).trim())
  const homeIds = resolveHomeRecommendationIds(config, customOrder)
  const ids = category ? config.featuredSkills : homeIds
  const isPresetCategory = Boolean(presetBinding && category && presetBinding.categories?.some(c => c.id === category))
  const presetFeatured = (!hasQuery && isPresetCategory && Array.isArray(presetBinding.skills))
    ? presetBinding.skills
        .filter(item => item.recommended === true)
        .filter(item => {
          const cat = String(item.category || item.categoryLabel || '').trim()
          const tags = Array.isArray(item.tags) ? item.tags.map(String) : []
          return cat === category || tags.includes(category)
        })
        .map(item => {
          const hydrated = hydratePresetSkill(item, availability)
          const current = live.get(item.id)
          const local = installed.get(key(item))
          return { ...hydrated, ...(current ? { rating: current.rating, installed: current.installed, enabled: current.enabled } : {}),
            ...(local ? { installed: true, enabled: local.enabled !== false } : {}) }
        }).filter(available)
    : []
  // 预设分类是预设私有货架：目录推荐位不参与分区，避免同一技能同时进入 featured 与 regular。
  const baseFeatured = hasQuery || presetCategoryIds.has(category) ? [] : resolveSkillRecommendations(ids || [], entries)
    .filter(item => category || config.featuredSkills?.includes(item.id))
    .map(item => {
      const current = live.get(item.id)
      const local = installed.get(key(item))
      const inProvider = providerSet.has(key(item))
      const isPluginSource = Boolean(item.preinstalled === true || (item.source && item.source.type === 'plugin'))
      return { ...item, ...(!category && item.homeCover ? { cover: item.homeCover } : {}),
        ...(current ? { rating: current.rating, installed: current.installed, enabled: current.enabled } : {}),
        ...(local ? { installed: true, enabled: local.enabled !== false } : (inProvider || isPluginSource ? { installed: true } : {})),
        ...(isPluginSource ? { preinstalled: true } : {}) }
    }).filter(matches).filter(available)
  const featured = isPresetCategory && presetFeatured.length > 0 ? presetFeatured : unique([...presetFeatured, ...baseFeatured])
  const featuredKeys = new Set(featured.map(key))
  const catalogFeatured = new Set(entries.filter(item => item.kind === 'skill' && item.recommended === true).map(item => item.skill))
  // 本地目录卡片：技能与套件同为货架条目；套件只落「套件」分类（见 matchesDomainTag）。
  const includeSuites = category === SUITE_SHELF_TAG
  const localCards = hasQuery
    ? []
    : entries
      .filter(item => (includeSuites ? item.kind === 'suite' : item.kind === 'skill'))
      .map(item => {
        const isPluginSource = Boolean(item.preinstalled === true || (item.source && item.source.type === 'plugin'))
        return {
          ...item,
          catalogId: item.id,
          slug: item.skill,
          name: item.title,
          description: item.summary,
          installBackend: 'catalog',
          installed: installed.has(item.skill) || providerSet.has(item.skill) || isPluginSource,
          ...(isPluginSource ? { preinstalled: true } : {}),
        }
      })
  const presetCards = presetBinding && Array.isArray(presetBinding.skills)
    ? filterPresetSkills(presetBinding.skills, category, query).map(item => hydratePresetSkill(item, availability))
    : []
  // 预设分类内，目录同 slug 条目只贡献展示元数据；可用态与归属一律按真实随包/已装真源重推。
  // 广场浏览（!hasQuery 且非预设私域）只允许官方目录/本地随包池进入，禁止未入库 $DSH_HOME/远端条目污染计数。
  const presetScoped = presetCategoryIds.size > 0 && presetCategoryIds.has(category)
  const localKeys = new Set(localCards.map(key))
  const scopedPresetCards = presetScoped ? presetCards : []
  const scopedItems = hasQuery ? items : items.filter(item => localKeys.has(key(item)))
  const regular = unique([...scopedPresetCards, ...localCards, ...scopedItems])
    .map(item => presetScoped && presetCategoryOf.has(key(item))
      ? hydratePresetSkill({ ...item, category: presetCategoryOf.get(key(item)) }, availability)
      : item)
    .map(item => installed.has(key(item))
    ? { ...item, installed: true, enabled: installed.get(key(item)).enabled !== false }
    : (providerSet.has(key(item)) ? { ...item, installed: true } : item)).filter(matches).filter(available)
    .filter(item => !featuredKeys.has(key(item)))
    .filter(item => category !== 'featured' || (hasQuery && catalogFeatured.has(key(item))))
  return { featured, regular }
}

const recommendedSkillSlugs = new Set(catalog.items
  .filter(item => item.kind === 'skill' && item.recommended === true && item.skill)
  .map(item => item.skill))

/** Installed listings omit catalog metadata; only authoritative catalog identities qualify. */
export function isRecommendedInstalledSkill(item) {
  return recommendedSkillSlugs.has(skillToken(item))
}

export const PLAZA_INTENT_KEY = 'omnimux-market:plaza-intent'
/** 暂时隐藏的广场 Tab（Issue #502）：恢复时清空数组并在 plaza-shell.js 还原守卫。 */
export const PLAZA_HIDDEN_TABS = Object.freeze(['connectors'])
/** 广场可见 Tab（隐藏 Tab 不再是合法 intent 目标）。 */
export const PLAZA_TABS = Object.freeze(['plugins', 'skills', 'experts'])
export const CREATE_SKILL = Object.freeze({
  id: 'sk-omx-skill-creator',
  slug: 'skill-creator',
  skill: 'skill-creator',
  catalogId: 'sk-omx-skill-creator',
  name: '技能创建',
  description: '创建双语可复用Skill',
})
export const PICKER_SEARCH_LIMIT = 20
export const PICKER_DEBOUNCE_MS = 200
export const PICKER_CACHE_TTL_MS = 90_000

/**
 * 套件：本地目录独有的条目形态（多技能 / 附带规则 / 附带预设 Agent 的打包单元）。
 * 远端渠道没有对应物，故该分类跳过远端检索，只渲染本地目录卡片。
 */
export const SUITE_SHELF_TAG = '套件'

export function isLocalOnlyShelfTag(tag) {
  return String(tag || '').trim() === SUITE_SHELF_TAG
}

/**
 * Skill 货架分类法（Taxonomy）唯一语义真源。顺序即展示顺序。
 * UI 片段（skill-picker.js / skill-plaza.js / plaza-shell.js）运行时经 boot.js
 * 注入的 SkillShelf 命名空间消费本模块，禁止再维护内联副本（parity 测试守卫）。
 * keywords 为 L2/L3 兜底匹配词表；仅电商扩充为五词，其余收敛为 [id]；
 * 短英文词（ad、music）不得入词表，扩充需评估误命中。
 * 套件行只作 id / labelKey / 词表真源：套件的成员判定走 kind === 'suite'，不靠词表。
 */
export const SKILL_SHELF_TAXONOMY = Object.freeze([
  // AIGC 创作是归类型分类：词表只放分类名本身，成员一律靠条目 tags 显式声明，
  // 禁止用「生图 / 视频 / 图像」等泛词做兜底匹配，否则会把无关技能吸进来。
  { id: 'AIGC 创作', labelKey: 'picker.tab.aigc', keywords: Object.freeze(['AIGC 创作']) },
  { id: '电商', labelKey: 'picker.tab.ecom', keywords: Object.freeze(['电商', '独立站', '跨境', 'shopify', '选品']) },
  { id: '商业广告', labelKey: 'picker.tab.ad', keywords: Object.freeze(['商业广告']) },
  { id: '短剧漫剧', labelKey: 'picker.tab.drama', keywords: Object.freeze(['短剧漫剧']) },
  { id: '专业影视', labelKey: 'picker.tab.film', keywords: Object.freeze(['专业影视']) },
  { id: '动画', labelKey: 'picker.tab.anim', keywords: Object.freeze(['动画']) },
  { id: '教育', labelKey: 'picker.tab.edu', keywords: Object.freeze(['教育']) },
  { id: '创意实验', labelKey: 'picker.tab.lab', keywords: Object.freeze(['创意实验']) },
  { id: '音频音乐', labelKey: 'picker.tab.audio', keywords: Object.freeze(['音频音乐']) },
  { id: '平台工具', labelKey: 'picker.tab.platform', keywords: Object.freeze(['平台工具']) },
  { id: SUITE_SHELF_TAG, labelKey: 'picker.tab.suite', keywords: Object.freeze([SUITE_SHELF_TAG]) },
])

export const SKILL_SHELF_TAGS = Object.freeze(SKILL_SHELF_TAXONOMY.map((row) => row.id))

/**
 * 场景分类法（Skill 货架一级分类）唯一真源。
 * 与 SKILL_SHELF_TAXONOMY（选择器/我的 Skill 的领域分类）相互独立：
 * 场景回答「用户要完成什么营销任务」，领域回答「技能属于什么内容域」。
 * 目录条目以 `scenario` 字段显式归属；旧条目按 `category` 做兼容映射。
 */
export const SKILL_SCENARIOS = Object.freeze(
  (Array.isArray(catalog.skillScenarios) ? catalog.skillScenarios : [])
    .filter((row) => row && row.id)
    .map((row) => Object.freeze({
      id: String(row.id),
      title: String(row.title || row.titleZh || row.id),
      titleZh: String(row.titleZh || row.title || row.id),
      titleEn: String(row.titleEn || row.title || row.id),
      labelKey: 'cat.' + String(row.id),
    })),
)

export const SKILL_SCENARIO_TAGS = Object.freeze(SKILL_SCENARIOS.map((row) => row.id))

const LEGACY_CATEGORY_SCENARIO = Object.freeze({
  'ugc-testimonial': 'scene-growth',
  'storytelling-script': 'scene-video',
  'image-static': 'scene-visual',
  'video-ads': 'scene-video',
  'product-showcase': 'scene-visual',
  'meme-native': 'scene-replicate',
  other: 'scene-tools',
  'scene-seeding': 'scene-growth',
  'scene-brand': 'scene-video',
  'scene-product': 'scene-visual',
  'scene-performance': 'scene-growth',
  'scene-app': 'scene-growth',
  'scene-local': 'scene-growth',
  'scene-repurpose': 'scene-replicate',
})

const SCENARIO_KEYWORDS = Object.freeze({
  'scene-video': Object.freeze(['短视频', '带货', '分镜', '运镜', '脚本', '口播', '火柴人', 'storyboard', 'video']),
  'scene-replicate': Object.freeze(['复刻', '拆解', '提示词', '转写', '改写', '切片', '再制', 'replicate', 'repurpose']),
  'scene-visual': Object.freeze(['主图', '轮播图', '套图', '海报', '9图', '视觉', '品牌资产', '商详', 'image', 'visual']),
  'scene-research': Object.freeze(['选品', '调研', '洞察', '趋势', '爆款帖', '达人', '竞品', '评论', 'voc', 'cr10', '聆听', 'research']),
  'scene-growth': Object.freeze(['广告', '投放', 'roas', 'listing', '定价', '利润', '本地化', '多语', '文案', '配文', 'tiktok', 'growth']),
  'scene-tools': Object.freeze(['剪辑', '草稿', '剪映', '创建', '发现', '工具', 'clip', 'creator', 'finder']),
})

export function isScenarioTag(tag) {
  return SKILL_SCENARIO_TAGS.includes(String(tag || '').trim())
}

function catalogScenarioForSlug(slug) {
  const key = String(slug || '').replace(/^\//, '').trim()
  if (!key) return ''
  const row = (Array.isArray(catalog.items) ? catalog.items : []).find(
    (item) => item && item.kind === 'skill' && (item.skill === key || item.id === key),
  )
  return row && row.scenario ? String(row.scenario) : ''
}

/** 解析条目的场景：显式 scenario -> 目录同 slug 条目 -> 旧 category 兼容映射。 */
export function scenarioForItem(item) {
  if (!item) return ''
  const direct = String(item.scenario || '').trim()
  if (direct) return direct
  const byCatalog = catalogScenarioForSlug(item.skill || item.slug || item.catalogId || '')
  if (byCatalog) return byCatalog
  const legacy = LEGACY_CATEGORY_SCENARIO[String(item.category || item.categoryLabel || '').trim()]
  return legacy || ''
}

export function matchesScenarioTag(item, tag) {
  if (!item || !tag) return true
  if (item.kind === 'suite') return false
  const scenario = scenarioForItem(item)
  if (scenario) return scenario === tag
  const label = SKILL_SCENARIOS.find((row) => row.id === tag)
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : []
  if (label && tags.includes(label.titleZh)) return true
  const hay = [
    item.category, item.categoryLabel, item.name, item.title, item.description, item.summary, tags.join(' '),
  ].map((value) => String(value || '')).join(' ').toLowerCase()
  return (SCENARIO_KEYWORDS[tag] || []).some((keyword) => hay.includes(String(keyword).toLowerCase()))
}

/** 场景计数：全部（技能条目）+ 各场景成员数。 */
export function skillScenarioCounts() {
  const counts = { total: 0, byId: {} }
  for (const row of SKILL_SCENARIOS) counts.byId[row.id] = 0
  for (const item of Array.isArray(catalog.items) ? catalog.items : []) {
    if (!item || item.kind !== 'skill') continue
    counts.total += 1
    const scenario = scenarioForItem(item)
    if (scenario && Object.hasOwn(counts.byId, scenario)) counts.byId[scenario] += 1
  }
  return counts
}

export const PICKER_TABS = Object.freeze([
  { id: 'all', kind: 'all', labelKey: 'picker.tab.all' },
  { id: 'mine', kind: 'mine', labelKey: 'picker.tab.mine' },
  { id: 'featured', kind: 'featured', labelKey: 'picker.tab.featured' },
  // 本地目录专属分类不进选择器：其数据源是远端结果，放进来只会得到一个恒空的页签。
  ...SKILL_SHELF_TAXONOMY.filter((row) => !isLocalOnlyShelfTag(row.id))
    .map((row) => ({ id: row.id, kind: 'tag', labelKey: row.labelKey })),
])

export function skillToken(item) {
  const raw = String((item && (item.skill || item.slug)) || '').trim()
  const slug = raw.replace(/^\//, '')
  return slug
}

export function skillGesture(item) {
  const slug = skillToken(item)
  return slug ? `/${slug} ` : ''
}

export function appendSkillGesture(draft, gesture) {
  const token = String(gesture || '')
  if (!token) return String(draft || '')
  const withSpace = token.endsWith(' ') ? token : `${token} `
  const base = String(draft || '')
  const prefix = base && !/\s$/.test(base) ? `${base} ` : base
  return `${prefix}${withSpace}`
}

function escapeSkillSlug(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 查找 draft 中某个技能 slug 的 `/slug` token 范围（含尾随空格）。 */
export function findSkillTokenRange(draft, slug) {
  const text = String(draft || '')
  const name = String(slug || '').replace(/^\//, '').trim()
  if (!text || !name) return null
  const pattern = new RegExp(`(^|\\s)/${escapeSkillSlug(name)}(?=\\s|$)[ \\t]?`)
  const match = pattern.exec(text)
  if (!match) return null
  const prefixLength = match[1] ? match[1].length : 0
  return { start: match.index + prefixLength, end: match.index + match[0].length }
}

/** draft 是否仍包含指定技能的 `/slug` token。 */
export function draftHasSkillToken(draft, slug) {
  return findSkillTokenRange(draft, slug) !== null
}

/** 删除指定技能的 `/slug` token（连同尾随空格），保留其余正文。 */
export function removeSkillTokenFromDraft(draft, slug) {
  const text = String(draft || '')
  const range = findSkillTokenRange(text, slug)
  if (!range) return text
  return text.slice(0, range.start) + text.slice(range.end)
}

export function buildSearchPayload(tabId, query) {
  const q = String(query || '').trim()
  const tab = PICKER_TABS.find((row) => row.id === tabId) || PICKER_TABS[0]
  const payload = { query: q, limit: PICKER_SEARCH_LIMIT, offset: 0 }
  if (tab.kind === 'featured') payload.channels = ['custom']
  if (tab.kind === 'tag') payload.query = q ? `${q} ${tab.id}` : tab.id
  return payload
}

/**
 * tag 在 taxonomy 中有对应行且 keywords 有效时取该行 keywords，
 * 未知分类回落 [tag]（字面匹配，不崩、不落入「全部」）。
 */
export function keywordsForTag(tag) {
  const row = SKILL_SHELF_TAXONOMY.find((r) => r.id === tag)
  if (row && Array.isArray(row.keywords) && row.keywords.length) return row.keywords
  return [tag]
}

export function matchesDomainTag(item, tag) {
  if (!item || !tag) return true
  // 场景分类走独立判定；套件不参与技能场景。
  if (isScenarioTag(tag)) return matchesScenarioTag(item, tag)
  // 套件是独立条目形态：只落「套件」分类，且绝不混入任何技能领域分类。
  if (isLocalOnlyShelfTag(tag)) return item.kind === 'suite'
  if (item.kind === 'suite') return false
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : []
  if (tags.includes(tag)) return true
  const hay = [
    item.category,
    item.categoryLabel,
    item.name,
    item.title,
    item.description,
    item.summary,
    tags.join(' '),
  ].map((v) => String(v || '')).join(' ')
  const lowerHay = hay.toLowerCase()
  return keywordsForTag(tag).some((kw) => {
    const k = String(kw || '').toLowerCase()
    return k ? lowerHay.includes(k) : false
  })
}

export function itemShelfTags(item) {
  const tags = Array.isArray(item && item.tags) ? item.tags.map(String) : []
  return tags.filter((tag) => SKILL_SHELF_TAGS.includes(tag))
}

export function inSkillShelf(item) {
  if (!item) return false
  if (itemShelfTags(item).length) return true
  return SKILL_SHELF_TAGS.some((tag) => matchesDomainTag(item, tag))
}

export function filterPickerItems(items, tabId, presetBinding = null, query = '') {
  if (presetBinding && Array.isArray(presetBinding.skills)) {
    return filterPresetSkills(presetBinding.skills, tabId, query)
  }
  const list = Array.isArray(items) ? items : []
  const tab = PICKER_TABS.find((row) => row.id === tabId) || PICKER_TABS[0]
  if (tab.kind === 'mine') return list.filter((it) => it && it.installed === true)
  const shelf = list.filter((it) => inSkillShelf(it))
  if (tab.kind === 'tag') return shelf.filter((it) => matchesDomainTag(it, tab.id))
  return shelf
}

/**
 * Plaza 货架过滤：先收敛到货架全集，再按分类严格判定。
 * 未知分类走 matchesDomainTag 的「未知 → [tag]」字面分支，严禁回落「全部」。
 */
export function filterPlazaShelf(items, tag) {
  const list = Array.isArray(items) ? items : []
  const shelf = list.filter((it) => inSkillShelf(it))
  const key = String(tag || '').trim()
  if (!key) return shelf
  return shelf.filter((it) => matchesDomainTag(it, key))
}

/** Plaza 检索渠道：仅用户提交 query 时才追加 skillhub；分类浏览保持默认双渠道。 */
export const PLAZA_DEFAULT_CHANNELS = Object.freeze(['custom', 'workbuddy'])
export const PLAZA_QUERY_CHANNELS = Object.freeze(['custom', 'workbuddy', 'skillhub'])
export const PLAZA_PAGE_SIZE = 48

export function buildPlazaSearchPayload(submitted, category, page = 1, pageSize = PLAZA_PAGE_SIZE) {
  const q = String(submitted || '').trim()
  const cat = String(category || '').trim()
  const query = cat ? (q ? `${q} ${cat}` : cat) : q
  return {
    query,
    limit: pageSize,
    offset: (Math.max(1, Number(page) || 1) - 1) * pageSize,
    channels: q ? [...PLAZA_QUERY_CHANNELS] : [...PLAZA_DEFAULT_CHANNELS],
  }
}

/**
 * 技能/专家工作台 Tab id（与 plaza Tab 的注册值一致）。
 *
 * 说明：本模块只声明「会话内入口打开参数」用到的 Tab 值；plaza-shell.js 与
 * session-create.js 里既有的同值字面量不在本任务重构范围内，避免扩大改动面。
 */
export const PLAZA_WORKBENCH_TAB_ID = 'omnimux-market:plaza'

/**
 * 会话内入口（输入框技能面板「探索更多」）打开技能/专家工作台的参数。
 *
 * 工作台 Tab 的默认 focus 是 `gui`：右栏吃满视口、中间会话栏被压掉。会话内的
 * 入口必须显式 `split`，在当前页面状态下激活右侧边栏、把会话栏留在原地。
 */
export function buildPlazaWorkbenchOpenOptions(title) {
  return { tabId: PLAZA_WORKBENCH_TAB_ID, title, focus: 'split' }
}

export function installPayload(item) {
  if (!item || isSkillLocallyAvailable(item)) return null
  const slug = String(item.slug || item.skill || '').trim()
  if (!slug) return null
  const catalogId = String(item.catalogId || (String(item.id || '').startsWith('sk-') ? item.id : '') || '').trim()
  return catalogId ? { slug, catalogId } : { slug }
}

export function writePlazaIntent(tab, storage) {
  const next = PLAZA_TABS.includes(tab) ? tab : 'skills'
  if (!storage || typeof storage.setItem !== 'function') return next
  storage.setItem(PLAZA_INTENT_KEY, JSON.stringify({ tab: next }))
  return next
}

export function consumePlazaIntent(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  let raw = null
  try {
    raw = storage.getItem(PLAZA_INTENT_KEY)
  } catch {
    return null
  }
  try {
    if (typeof storage.removeItem === 'function') storage.removeItem(PLAZA_INTENT_KEY)
  } catch { /* ignore */ }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const tab = parsed && parsed.tab
    return PLAZA_TABS.includes(tab) ? tab : null
  } catch {
    return null
  }
}

export function pickerCacheKey(payload) {
  return JSON.stringify(payload || {})
}

export function peekPickerCache(store, key, now = Date.now(), ttlMs = PICKER_CACHE_TTL_MS) {
  if (!store || typeof store.get !== 'function' || !key) return null
  const hit = store.get(key)
  if (!hit || !hit.body) return null
  const at = Number(hit.at) || 0
  if (now - at >= ttlMs) return null
  return hit.body
}

export function writePickerCache(store, key, body, now = Date.now()) {
  if (!store || typeof store.set !== 'function' || !key || !body) return false
  store.set(key, { at: now, body })
  return true
}

export function loadPickerSearch(payload, opts) {
  const key = pickerCacheKey(payload)
  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now()
  const ttl = opts && typeof opts.ttlMs === 'number' ? opts.ttlMs : PICKER_CACHE_TTL_MS
  const cache = opts && opts.cache
  const inflight = opts && opts.inflight
  const fetchSearch = opts && opts.fetchSearch
  const cached = peekPickerCache(cache, key, now, ttl)
  if (cached) return Promise.resolve({ body: cached, fromCache: true })
  if (inflight && typeof inflight.get === 'function' && inflight.has(key)) {
    return inflight.get(key).then((body) => ({ body, fromCache: false }))
  }
  if (typeof fetchSearch !== 'function') {
    return Promise.resolve({ body: null, fromCache: false })
  }
  const pending = Promise.resolve(fetchSearch(payload)).then((body) => {
    // TTL 自请求完成时刻起算：必须在 then 回调内读取时钟，禁止闭包捕获发起时刻。
    const at = opts && typeof opts.completedAt === 'function' ? opts.completedAt() : Date.now()
    writePickerCache(cache, key, body, at)
    if (inflight && typeof inflight.delete === 'function') inflight.delete(key)
    return body
  }, (err) => {
    if (inflight && typeof inflight.delete === 'function') inflight.delete(key)
    throw err
  })
  if (inflight && typeof inflight.set === 'function') inflight.set(key, pending)
  return pending.then((body) => ({ body, fromCache: false }))
}

export function skillTitle(item, tr) {
  if (!item) return ''
  const trFn = typeof tr === 'function' ? tr : null
  const isEn = trFn ? trFn('locale') === 'en' : (typeof document !== 'undefined' && document.documentElement.lang === 'en')
  const slug = item.slug || item.skill || item.id || ''
  if (trFn) {
    const key = 'skill.name.' + slug
    const translated = trFn(key)
    if (translated && translated !== key) return translated
    const keyById = 'skill.name.' + (item.id || '')
    const translatedById = trFn(keyById)
    if (translatedById && translatedById !== keyById) return translatedById
  }
  if (isEn && (item.titleEn || item.nameEn)) return item.titleEn || item.nameEn
  if (!isEn && (item.titleZh || item.nameZh)) return item.titleZh || item.nameZh
  return item.name || item.title || slug
}

export function skillDesc(item, tr) {
  if (!item) return ''
  const trFn = typeof tr === 'function' ? tr : null
  const isEn = trFn ? trFn('locale') === 'en' : (typeof document !== 'undefined' && document.documentElement.lang === 'en')
  const slug = item.slug || item.skill || item.id || ''
  if (trFn) {
    const key = 'skill.desc.' + slug
    const translated = trFn(key)
    if (translated && translated !== key) return translated
    const keyById = 'skill.desc.' + (item.id || '')
    const translatedById = trFn(keyById)
    if (translatedById && translatedById !== keyById) return translatedById
  }
  if (isEn && (item.descriptionEn || item.summaryEn)) return item.descriptionEn || item.summaryEn
  if (!isEn && (item.descriptionZh || item.summaryZh)) return item.descriptionZh || item.summaryZh
  return item.description || item.summary || ''
}
