import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BRAND_STRATEGY_OUTPUT_SCHEMA,
  PHYSICAL_IMPORT_OUTPUT_SCHEMA,
  buildBrandStrategyUserInput,
  buildLandingAnalysisFingerprint,
  buildPhysicalImportUserInput,
  validateAgainstOutputSchema,
} from './analysis-schema.js'

const VALID_BRAND_STRATEGY = {
  brand_basic_info: {
    company: { name: 'MiniMax', website: 'https://platform.example.com', locale: 'cn' },
    product: { name: 'MiniMax 开放平台', category: 'AI 平台' },
  },
  content_angles: [
    {
      id: 'cost_01',
      title: '成本焦虑',
      description: '按量付费，无需自建 GPU',
      target_audience: 'AI 应用开发者',
      priority: 1,
    },
  ],
  tone_and_voice: {
    dos: ['用数据说话'],
    donts: ['夸大效果'],
  },
  identity_and_product: {
    core_identity: '一站式多模态模型服务',
    product_offering: ['文本模型 API', '语音模型 API'],
    unique_advantage: ['超长上下文'],
    problems_solved: ['多模型拼接成本高'],
    solutions: ['一个接口接入多模态'],
  },
  mission_and_positioning: {
    mission: '让智能触手可及',
    differentiation: ['性价比'],
    ownable_space: {
      statement: '多模态入口',
      category: 'AI 平台',
      is_not: ['通用云'],
    },
  },
  market_and_competition: {
    customer_segments: [{ name: 'AI 应用开发者', percentage: 60 }],
    competitors: [{ name: 'OpenAI', website: 'https://openai.com' }],
  },
}

const VALID_PHYSICAL_IMPORT = {
  name: 'Aurora Mug 350ml',
  description: '双层陶瓷保温杯，保温 6 小时。',
  features: '容量: 350ml,材质: 双层陶瓷',
  selling_points: '6 小时长效保温,防滑硅胶底座',
  brand: 'Aurora',
  target_audience: '咖啡爱好者',
  price: 24.9,
  sku: 'AM-350',
  promotion: '限时包邮',
  categories: ['physicalproduct', 'home', 'drinkware'],
}

describe('analysis-schema · strict JSON Schema validation', () => {
  it('accepts a valid six-module brand strategy payload', () => {
    assert.deepEqual(validateAgainstOutputSchema(VALID_BRAND_STRATEGY, BRAND_STRATEGY_OUTPUT_SCHEMA), [])
  })

  it('rejects wrapped namespaces, missing required modules, and out-of-range metrics on brand strategy', () => {
    const wrapped = validateAgainstOutputSchema(
      { brand_strategy: VALID_BRAND_STRATEGY },
      BRAND_STRATEGY_OUTPUT_SCHEMA,
    )
    assert.ok(wrapped.some((err) => /additional property is not allowed/.test(err)))
    assert.ok(wrapped.some((err) => /required property is missing/.test(err)))

    const badPriority = structuredClone(VALID_BRAND_STRATEGY)
    badPriority.content_angles[0].priority = 5
    const priorityErrors = validateAgainstOutputSchema(badPriority, BRAND_STRATEGY_OUTPUT_SCHEMA)
    assert.ok(priorityErrors.some((err) => /priority.*exceeds maximum 3/.test(err)))

    const badPercent = structuredClone(VALID_BRAND_STRATEGY)
    badPercent.market_and_competition.customer_segments[0].percentage = 120
    const percentErrors = validateAgainstOutputSchema(badPercent, BRAND_STRATEGY_OUTPUT_SCHEMA)
    assert.ok(percentErrors.some((err) => /percentage.*exceeds maximum 100/.test(err)))
  })

  it('accepts a valid physical import payload including nullable fields', () => {
    assert.deepEqual(validateAgainstOutputSchema(VALID_PHYSICAL_IMPORT, PHYSICAL_IMPORT_OUTPUT_SCHEMA), [])
    const nullable = {
      name: 'Basic Cup',
      description: null,
      features: null,
      selling_points: '耐用',
      brand: null,
      target_audience: null,
      price: null,
      sku: null,
      promotion: null,
      categories: [],
    }
    assert.deepEqual(validateAgainstOutputSchema(nullable, PHYSICAL_IMPORT_OUTPUT_SCHEMA), [])
  })

  it('rejects extra keys, missing keys, and >5 categories on physical import', () => {
    const extra = { ...VALID_PHYSICAL_IMPORT, unknown_field: 'x' }
    assert.ok(
      validateAgainstOutputSchema(extra, PHYSICAL_IMPORT_OUTPUT_SCHEMA).some((err) => /additional property/.test(err)),
    )

    const tooManyCategories = { ...VALID_PHYSICAL_IMPORT, categories: ['a', 'b', 'c', 'd', 'e', 'f'] }
    assert.ok(
      validateAgainstOutputSchema(tooManyCategories, PHYSICAL_IMPORT_OUTPUT_SCHEMA).some((err) => /exceeds maxItems 5/.test(err)),
    )

    const missingName = { ...VALID_PHYSICAL_IMPORT }
    delete missingName.name
    assert.ok(
      validateAgainstOutputSchema(missingName, PHYSICAL_IMPORT_OUTPUT_SCHEMA).some((err) => /\$\.name: required property is missing/.test(err)),
    )
  })
})

describe('analysis-schema · deterministic fingerprint & user input builders', () => {
  it('produces deterministic sha256 fingerprints sensitive to kind, url, language, and content', () => {
    const base = buildLandingAnalysisFingerprint({
      kind: 'digital',
      url: 'https://platform.example.com',
      language: '中文',
      pageContent: 'MiniMax 开放平台',
    })
    const same = buildLandingAnalysisFingerprint({
      kind: 'digital',
      url: 'https://platform.example.com',
      language: '中文',
      pageContent: 'MiniMax 开放平台',
    })
    assert.equal(base, same)
    assert.match(base, /^sha256:[0-9a-f]{64}$/)

    assert.notEqual(base, buildLandingAnalysisFingerprint({
      kind: 'physical',
      url: 'https://platform.example.com',
      language: '中文',
      pageContent: 'MiniMax 开放平台',
    }))
    assert.notEqual(base, buildLandingAnalysisFingerprint({
      kind: 'digital',
      url: 'https://other.example.com',
      language: '中文',
      pageContent: 'MiniMax 开放平台',
    }))
    assert.notEqual(base, buildLandingAnalysisFingerprint({
      kind: 'digital',
      url: 'https://platform.example.com',
      language: 'English',
      pageContent: 'MiniMax 开放平台',
    }))
    assert.notEqual(base, buildLandingAnalysisFingerprint({
      kind: 'digital',
      url: 'https://platform.example.com',
      language: '中文',
      pageContent: 'MiniMax 开放平台 v2',
    }))
  })

  it('builds concise structured user inputs without embedding hardcoded playbook templates', () => {
    const brandInput = buildBrandStrategyUserInput({
      url: 'https://platform.example.com',
      language: '中文',
      pageContent: '一站式多模态模型服务',
    })
    assert.match(brandInput, /目标语言：中文/)
    assert.match(brandInput, /https:\/\/platform\.example\.com/)
    assert.match(brandInput, /一站式多模态模型服务/)
    assert.doesNotMatch(brandInput, /```yaml/)

    const physicalInput = buildPhysicalImportUserInput({
      url: 'https://shop.example.com/p/aurora-mug',
      language: '中文',
      pageContent: 'Aurora Mug 350ml：双层陶瓷内胆',
    })
    assert.match(physicalInput, /目标语言：中文/)
    assert.match(physicalInput, /https:\/\/shop\.example\.com\/p\/aurora-mug/)
    assert.match(physicalInput, /Aurora Mug 350ml：双层陶瓷内胆/)
    assert.doesNotMatch(physicalInput, /产品信息调研专家/)
  })
})
