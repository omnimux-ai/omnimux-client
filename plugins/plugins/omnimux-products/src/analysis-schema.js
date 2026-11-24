import { createHash } from 'node:crypto'

/**
 * Strict JSON Schema validated by Hub `headlessSkill` for `products-brand-strategy`.
 * Mirrors the six persisted modules normalized by `brand-strategy.js`.
 */
export const BRAND_STRATEGY_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'brand_basic_info',
    'content_angles',
    'tone_and_voice',
    'identity_and_product',
    'mission_and_positioning',
    'market_and_competition',
  ],
  properties: {
    brand_basic_info: {
      type: 'object',
      additionalProperties: false,
      required: ['company', 'product'],
      properties: {
        company: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'website', 'locale'],
          properties: {
            name: { type: 'string' },
            website: { type: 'string' },
            locale: { type: 'string' },
          },
        },
        product: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'category'],
          properties: {
            name: { type: 'string' },
            category: { type: 'string' },
          },
        },
      },
    },
    content_angles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'description', 'target_audience', 'priority'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          target_audience: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 3 },
        },
      },
    },
    tone_and_voice: {
      type: 'object',
      additionalProperties: false,
      required: ['dos', 'donts'],
      properties: {
        dos: { type: 'array', items: { type: 'string' } },
        donts: { type: 'array', items: { type: 'string' } },
      },
    },
    identity_and_product: {
      type: 'object',
      additionalProperties: false,
      required: ['core_identity', 'product_offering', 'unique_advantage', 'solutions'],
      properties: {
        core_identity: { type: 'string' },
        product_offering: { type: 'array', items: { type: 'string' } },
        unique_advantage: { type: 'array', items: { type: 'string' } },
        problems_solved: { type: 'array', items: { type: 'string' } },
        solutions: { type: 'array', items: { type: 'string' } },
      },
    },
    mission_and_positioning: {
      type: 'object',
      additionalProperties: false,
      required: ['mission', 'differentiation', 'ownable_space'],
      properties: {
        mission: { type: 'string' },
        differentiation: { type: 'array', items: { type: 'string' } },
        ownable_space: {
          type: 'object',
          additionalProperties: false,
          required: ['statement'],
          properties: {
            statement: { type: 'string' },
            category: { type: 'string' },
            is_not: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    market_and_competition: {
      type: 'object',
      additionalProperties: false,
      required: ['customer_segments', 'competitors'],
      properties: {
        customer_segments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'percentage'],
            properties: {
              name: { type: 'string' },
              percentage: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
        },
        competitors: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'website'],
            properties: {
              name: { type: 'string' },
              website: { type: 'string' },
            },
          },
        },
      },
    },
  },
})

/**
 * Strict JSON Schema validated by Hub `headlessSkill` for `products-physical-import`.
 */
export const PHYSICAL_IMPORT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'description',
    'features',
    'selling_points',
    'brand',
    'target_audience',
    'price',
    'sku',
    'promotion',
    'categories',
  ],
  properties: {
    name: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    features: { type: ['string', 'null'] },
    selling_points: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    target_audience: { type: ['string', 'null'] },
    price: { type: ['number', 'string', 'null'] },
    sku: { type: ['string', 'null'] },
    promotion: { type: ['string', 'null'] },
    categories: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
    },
  },
})

/**
 * Build a deterministic fingerprint covering product kind, URL, target language,
 * and normalized page copy for Hub `headlessSkill` stale-write protection.
 *
 * @param {{ kind: 'digital' | 'physical', url?: string, language?: string, pageContent: string }} params
 * @returns {string}
 */
export function buildLandingAnalysisFingerprint({ kind, url = '', language = '中文', pageContent }) {
  const payload = JSON.stringify({
    kind,
    url: String(url || '').trim(),
    language: String(language || '中文').trim() || '中文',
    pageContent: String(pageContent || ''),
  })
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`
}

/**
 * Build concise structured user input for `products-brand-strategy`.
 * Methodology and output rules live in `skills/products-brand-strategy/SKILL.md`.
 *
 * @param {{ url?: string, language?: string, pageContent: string }} params
 * @returns {string}
 */
export function buildBrandStrategyUserInput({ url = '', language = '中文', pageContent }) {
  const lines = [
    `目标语言：${String(language || '中文').trim() || '中文'}`,
  ]
  const cleanUrl = String(url || '').trim()
  if (cleanUrl) lines.push(`参考 URL（仅作来源标注，不代表已访问）：${cleanUrl}`)
  lines.push(
    '',
    '以下是已提供的产品页面正文/简介：',
    '---',
    String(pageContent || '').trim(),
    '---',
  )
  return lines.join('\n')
}

/**
 * Build concise structured user input for `products-physical-import`.
 * Methodology and output rules live in `skills/products-physical-import/SKILL.md`.
 *
 * @param {{ url?: string, language?: string, pageContent: string }} params
 * @returns {string}
 */
export function buildPhysicalImportUserInput({ url = '', language = '中文', pageContent }) {
  const lines = [
    `目标语言：${String(language || '中文').trim() || '中文'}`,
  ]
  const cleanUrl = String(url || '').trim()
  if (cleanUrl) lines.push(`参考 URL（仅作来源标注，不代表已访问）：${cleanUrl}`)
  lines.push(
    '',
    '以下是已提供的商品页面正文/图文简介：',
    '---',
    String(pageContent || '').trim(),
    '---',
  )
  return lines.join('\n')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesType(value, expected) {
  if (expected === 'null') return value === null
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return isPlainObject(value)
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (expected === 'string') return typeof value === 'string'
  if (expected === 'boolean') return typeof value === 'boolean'
  return false
}

/**
 * Defensive plugin-side JSON Schema validator aligned with Hub `headless/schema.js`.
 *
 * @param {unknown} value
 * @param {Record<string, any>} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function validateAgainstOutputSchema(value, schema, path = '$') {
  /** @type {string[]} */
  const errors = []
  if (!isPlainObject(schema)) return errors

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!allowed.some((t) => matchesType(value, t))) {
      const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      errors.push(`${path}: expected ${allowed.join('|')}, got ${actual}`)
      return errors
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value must be one of ${JSON.stringify(schema.enum)}`)
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: string length ${value.length} is less than minLength ${schema.minLength}`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: string length ${value.length} exceeds maxLength ${schema.maxLength}`)
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: value ${value} is less than minimum ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: value ${value} exceeds maximum ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: array length ${value.length} is less than minItems ${schema.minItems}`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: array length ${value.length} exceeds maxItems ${schema.maxItems}`)
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i += 1) {
        errors.push(...validateAgainstOutputSchema(value[i], schema.items, `${path}[${i}]`))
      }
    }
  }

  if (isPlainObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!Object.hasOwn(value, reqKey) || value[reqKey] === undefined) {
          errors.push(`${path}.${reqKey}: required property is missing`)
        }
      }
    }
    const props = isPlainObject(schema.properties) ? schema.properties : {}
    for (const [key, propValue] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) {
        errors.push(...validateAgainstOutputSchema(propValue, props[key], `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property is not allowed`)
      }
    }
  }

  return errors
}
