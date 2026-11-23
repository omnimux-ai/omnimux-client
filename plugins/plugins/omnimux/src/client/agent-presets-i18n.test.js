import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AGENT_PRESETS_I18N,
  TARGET_NAMESPACE,
  getPresetFallbackCopy,
  installAgentPresetsI18n,
  patchAgentPresetsLocaleDicts,
  resolvePresetDisplayText,
} from './agent-presets-i18n.js'

test('AGENT_PRESETS_I18N exports accurate specification texts for zh and en', () => {
  assert.equal(AGENT_PRESETS_I18N.zh.presetStandardName, '代码开发')
  assert.equal(
    AGENT_PRESETS_I18N.zh.presetStandardDescription,
    '全栈架构设计、代码编写与工程交付。',
  )
  assert.equal(AGENT_PRESETS_I18N.zh.presetDailyWorkName, '日常工作')
  assert.equal(
    AGENT_PRESETS_I18N.zh.presetDailyWorkDescription,
    '日常办公协同、文档拟定与事务闭环。',
  )
  assert.equal(AGENT_PRESETS_I18N.zh.presetCordisName, '创建Agent')
  assert.equal(
    AGENT_PRESETS_I18N.zh.presetCordisDescription,
    '插件实验开发、运行时检查与团队搭建。',
  )

  assert.equal(AGENT_PRESETS_I18N.en.presetStandardName, 'CodeDev')
  assert.equal(
    AGENT_PRESETS_I18N.en.presetStandardDescription,
    'Full-stack architecture, coding, and engineering delivery.',
  )
  assert.equal(AGENT_PRESETS_I18N.en.presetDailyWorkName, 'WorkAssistant')
  assert.equal(
    AGENT_PRESETS_I18N.en.presetDailyWorkDescription,
    'Daily office collaboration, docs drafting, and task closure.',
  )
  assert.equal(AGENT_PRESETS_I18N.en.presetCordisName, 'Create Agent')
  assert.equal(
    AGENT_PRESETS_I18N.en.presetCordisDescription,
    'Plugin development, runtime inspection, and team building.',
  )
})

test('getPresetFallbackCopy returns localized fallback copy for all presets', () => {
  const zhStandard = getPresetFallbackCopy('standard', 'zh')
  assert.equal(zhStandard.name, '代码开发')
  const enStandard = getPresetFallbackCopy('standard', 'en')
  assert.equal(enStandard.name, 'CodeDev')

  const zhDailyWork = getPresetFallbackCopy('daily-work', 'zh')
  assert.equal(zhDailyWork.name, '日常工作')
  assert.ok(zhDailyWork.description.includes('办公协同'))

  const enDailyWork = getPresetFallbackCopy('daily-work', 'en')
  assert.equal(enDailyWork.name, 'WorkAssistant')
  assert.ok(enDailyWork.description.includes('office collaboration'))

  const zhCordis = getPresetFallbackCopy('cordis', 'zh')
  assert.equal(zhCordis.name, '创建Agent')
  const enCordis = getPresetFallbackCopy('cordis', 'en')
  assert.equal(enCordis.name, 'Create Agent')

  const zhSocial = getPresetFallbackCopy('omni-agent', 'zh')
  assert.equal(zhSocial.name, 'OmniMux')
  assert.ok(zhSocial.description.includes('内容电商'))

  const enSocial = getPresetFallbackCopy('omni-agent', 'en')
  assert.equal(enSocial.name, 'OmniMux')
  assert.ok(enSocial.description.includes('content e-commerce'))

  const zhTikTok = getPresetFallbackCopy('tiktok-agent', 'zh')
  assert.equal(zhTikTok.name, 'TikTok运营专家团')
  assert.ok(zhTikTok.description.includes('全链路爆款视频创作'))

  const enTikTok = getPresetFallbackCopy('tiktok-agent', 'en')
  assert.equal(enTikTok.name, 'TikTok Ops Team')

  const sopExpected = [
    ['ecom-market-research', '选品专家', 'Market Analyst'],
    ['ecom-product-strategy', '定价专家', 'Pricing Strategist'],
    ['ecom-listing-copy', '文案专家', 'Listing Copywriter'],
    ['ecom-visual-studio', '视觉专家', 'Visual Designer'],
    ['ecom-video-director', '视频导演', 'Video Director'],
    ['ecom-ads-optimizer', '广告专家', 'Ads Optimizer'],
    ['ecom-review-voc', '评论运营', 'Review Analyst'],
    ['ecom-creator-growth', '达人运营', 'Creator Manager'],
  ]
  for (const [id, expectedZh, expectedEn] of sopExpected) {
    const zh = getPresetFallbackCopy(id, 'zh')
    const en = getPresetFallbackCopy(id, 'en')
    assert.equal(zh?.name, expectedZh, `${id} zh simplified name`)
    assert.equal(en?.name, expectedEn, `${id} en simplified name`)
    assert.ok(zh?.description && en?.description, `${id} bilingual descriptions`)
    assert.doesNotMatch(`${zh.description} ${en.description}`, /topview/i)
  }
  // Ensure legacy fallback entries also have zero Topview residue
  for (const legacyId of ['youtube-creator-expert', 'media-creator']) {
    const zh = getPresetFallbackCopy(legacyId, 'zh')
    const en = getPresetFallbackCopy(legacyId, 'en')
    assert.doesNotMatch(`${zh?.description} ${en?.description}`, /topview/i)
  }

  assert.equal(getPresetFallbackCopy('unknown-preset', 'zh'), null)
})

test('resolvePresetDisplayText handles translation and fallback cleanly', () => {
  const fakeTranslate = (key) => {
    if (key === 'presetStandardName') return '代码开发'
    if (key === 'presetStandardDescription') return '标准描述'
    if (key === 'presetDailyWorkName') return '日常工作'
    if (key === 'presetDailyWorkDescription') return '日常描述'
    return ''
  }

  const standardRes = resolvePresetDisplayText({ id: 'standard' }, fakeTranslate, 'zh')
  assert.equal(standardRes.name, '代码开发')

  const dailyWorkRes = resolvePresetDisplayText({ id: 'daily-work' }, fakeTranslate, 'zh')
  assert.equal(dailyWorkRes.name, '日常工作')

  // Fallback when t cannot translate custom daily-work preset in en
  const dailyWorkFallbackEn = resolvePresetDisplayText({ id: 'daily-work' }, null, 'en')
  assert.equal(dailyWorkFallbackEn.name, 'WorkAssistant')
  assert.ok(dailyWorkFallbackEn.description.includes('office collaboration'))
})

test('patchAgentPresetsLocaleDicts immediately patches existing zh and en dictionaries', () => {
  const zhDict = {
    presetStandardName: 'Standard mode (raw)',
    presetStandardDescription: 'Standard description',
    presetCordisName: 'Create Agent mode',
    presetCordisDescription: 'Creator description',
  }
  const enDict = {
    presetStandardName: 'Standard mode',
    presetStandardDescription: 'Standard description',
    presetCordisName: 'Creator mode',
    presetCordisDescription: 'Creator description',
  }

  const localesMap = new Map([
    ['zh', zhDict],
    ['en', enDict],
  ])
  const dictsMap = new Map([[TARGET_NAMESPACE, localesMap]])

  let published = false
  const locale = {
    dicts: dictsMap,
    snapshot: { active: 'zh' },
    publish: () => {
      published = true
    },
  }

  const changed = patchAgentPresetsLocaleDicts(locale)
  assert.equal(changed, true)
  assert.equal(published, true)

  assert.equal(zhDict.presetStandardName, '代码开发')
  assert.equal(
    zhDict.presetStandardDescription,
    '全栈架构设计、代码编写与工程交付。',
  )
  assert.equal(zhDict.presetDailyWorkName, '日常工作')
  assert.equal(zhDict.presetCordisName, '创建Agent')

  assert.equal(enDict.presetStandardName, 'CodeDev')
  assert.equal(
    enDict.presetStandardDescription,
    'Full-stack architecture, coding, and engineering delivery.',
  )
  assert.equal(enDict.presetDailyWorkName, 'WorkAssistant')
  assert.equal(enDict.presetCordisName, 'Create Agent')
})

test('patchAgentPresetsLocaleDicts handles region variants like zh-CN and en-US', () => {
  const zhCnDict = { presetStandardName: 'old', presetCordisName: 'old' }
  const enUsDict = { presetStandardName: 'old', presetCordisName: 'old' }

  const localesMap = new Map([
    ['zh-cn', zhCnDict],
    ['en-us', enUsDict],
  ])
  const dictsMap = new Map([[TARGET_NAMESPACE, localesMap]])
  const locale = { dicts: dictsMap }

  patchAgentPresetsLocaleDicts(locale)
  assert.equal(zhCnDict.presetStandardName, '代码开发')
  assert.equal(zhCnDict.presetDailyWorkName, '日常工作')
  assert.equal(zhCnDict.presetCordisName, '创建Agent')
  assert.equal(enUsDict.presetStandardName, 'CodeDev')
  assert.equal(enUsDict.presetDailyWorkName, 'WorkAssistant')
  assert.equal(enUsDict.presetCordisName, 'Create Agent')
})

test('installAgentPresetsI18n intercepts late register calls and applies patch immediately', () => {
  const dictsMap = new Map()
  let registerCalled = false

  const locale = {
    dicts: dictsMap,
    register: function (ns, pairs) {
      registerCalled = true
      let locs = dictsMap.get(ns)
      if (!locs) {
        locs = new Map()
        dictsMap.set(ns, locs)
      }
      for (const [k, v] of Object.entries(pairs)) {
        locs.set(k.toLowerCase(), { ...v })
      }
    },
  }

  const cleanup = installAgentPresetsI18n({ locale })

  // Simulate late registration by official ui-agent-preset
  const officialZh = {
    presetStandardName: '标准模式',
    presetStandardDescription: '功能完整的编码 Agent',
    presetCordisName: '创造模式',
    presetCordisDescription: '用于创建自定义 Agent preset',
  }
  const officialEn = {
    presetStandardName: 'Standard mode',
    presetStandardDescription: 'Full coding agent',
    presetCordisName: 'Creator mode',
    presetCordisDescription: 'Built for creating custom agent presets',
  }

  locale.register(TARGET_NAMESPACE, { zh: officialZh, en: officialEn })

  assert.equal(registerCalled, true)
  const locs = dictsMap.get(TARGET_NAMESPACE)
  assert.ok(locs)
  assert.equal(locs.get('zh').presetStandardName, '代码开发')
  assert.equal(locs.get('zh').presetDailyWorkName, '日常工作')
  assert.equal(locs.get('zh').presetCordisName, '创建Agent')
  assert.equal(locs.get('en').presetStandardName, 'CodeDev')
  assert.equal(locs.get('en').presetDailyWorkName, 'WorkAssistant')
  assert.equal(locs.get('en').presetCordisName, 'Create Agent')

  cleanup()
})

test('installAgentPresetsI18n defensive timer cleans up properly', async () => {
  const dictsMap = new Map()
  const locale = { dicts: dictsMap }
  let effectRan = false

  const cleanup = installAgentPresetsI18n({
    locale,
    effect: (fn) => {
      effectRan = true
      return fn()
    },
  })

  assert.equal(effectRan, true)

  // Simulate direct mutation after installation
  const locs = new Map([
    ['zh', { presetStandardName: 'stale' }],
    ['en', { presetStandardName: 'stale' }],
  ])
  dictsMap.set(TARGET_NAMESPACE, locs)

  // Wait for defensive interval
  await new Promise((resolve) => setTimeout(resolve, 250))

  assert.equal(locs.get('zh').presetStandardName, '代码开发')
  assert.equal(locs.get('zh').presetDailyWorkName, '日常工作')
  assert.equal(locs.get('en').presetStandardName, 'CodeDev')
  assert.equal(locs.get('en').presetDailyWorkName, 'WorkAssistant')

  cleanup()
})

test('defensive handling when locale is missing or malformed', () => {
  assert.doesNotThrow(() => installAgentPresetsI18n())
  assert.doesNotThrow(() => installAgentPresetsI18n({}))
  assert.doesNotThrow(() => installAgentPresetsI18n({ locale: {} }))
  assert.doesNotThrow(() => patchAgentPresetsLocaleDicts(null))
  assert.doesNotThrow(() => patchAgentPresetsLocaleDicts({ dicts: new Map() }))
})
