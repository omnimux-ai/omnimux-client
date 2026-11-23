import { OmnimuxError } from '../media/errors.js'

const SUPPORTED_ROOT_TYPES = new Set(['object', 'array'])
const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate that a caller-supplied outputSchema is a non-empty JSON Schema object.
 * @param {unknown} schema
 */
export function assertValidOutputSchema(schema) {
  if (!isPlainObject(schema)) {
    throw new OmnimuxError('headless-skill-invalid-request', 'outputSchema must be a plain JSON Schema object')
  }
  const rootType = schema.type
  if (typeof rootType !== 'string' || !SUPPORTED_ROOT_TYPES.has(rootType)) {
    throw new OmnimuxError(
      'headless-skill-invalid-request',
      'outputSchema.type must be "object" or "array"',
    )
  }
  validateSchemaDefinition(schema, '$')
}

function validateSchemaDefinition(schema, path) {
  if (!isPlainObject(schema)) {
    throw new OmnimuxError('headless-skill-invalid-request', `Invalid schema node at ${path}`)
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (types.length === 0 || types.some((t) => typeof t !== 'string' || !SUPPORTED_TYPES.has(t))) {
      throw new OmnimuxError('headless-skill-invalid-request', `Unsupported schema type at ${path}`)
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      throw new OmnimuxError('headless-skill-invalid-request', `properties at ${path} must be an object`)
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      validateSchemaDefinition(child, `${path}.${key}`)
    }
  }
  if (schema.items !== undefined) {
    validateSchemaDefinition(schema.items, `${path}[]`)
  }
}

/**
 * Extract and parse a JSON payload from raw LLM text (bare JSON, fenced block, or balanced slice).
 * @param {unknown} rawText
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function extractJsonPayload(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: 'Model output is empty' }
  }
  const trimmed = rawText.trim()

  const direct = tryParseJson(trimmed)
  if (direct.ok) return direct

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenceMatch && fenceMatch[1]) {
    const fenced = tryParseJson(fenceMatch[1].trim())
    if (fenced.ok) return fenced
  }

  const balanced = extractBalancedJson(trimmed)
  if (balanced) {
    const parsed = tryParseJson(balanced)
    if (parsed.ok) return parsed
  }

  return { ok: false, error: 'Model output did not contain a valid JSON payload' }
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function extractBalancedJson(text) {
  const firstObj = text.indexOf('{')
  const firstArr = text.indexOf('[')
  let start = -1
  let openChar = ''
  let closeChar = ''
  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj
    openChar = '{'
    closeChar = '}'
  } else if (firstArr !== -1) {
    start = firstArr
    openChar = '['
    closeChar = ']'
  }
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === openChar) depth += 1
    else if (ch === closeChar) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
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
 * Validate a parsed JSON value against a JSON Schema subset.
 * @param {unknown} value
 * @param {Record<string, any>} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function validateAgainstSchema(value, schema, path = '$') {
  const errors = []
  if (!isPlainObject(schema)) return errors

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!allowed.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${allowed.join('|')}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`)
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
        errors.push(...validateAgainstSchema(value[i], schema.items, `${path}[${i}]`))
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
        errors.push(...validateAgainstSchema(propValue, props[key], `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property is not allowed`)
      }
    }
  }

  return errors
}

/**
 * Append strict JSON Schema output instructions to the caller's user input.
 * @param {{ input: string, outputSchema: Record<string, unknown> }} params
 * @returns {string}
 */
export function buildStructuredPrompt({ input, outputSchema }) {
  return [
    input.trim(),
    '',
    'Output Contract:',
    'Return ONLY a single valid JSON document matching this JSON Schema. Do not wrap in commentary or prose outside the JSON.',
    '```json',
    JSON.stringify(outputSchema, null, 2),
    '```',
  ].join('\n')
}

/**
 * Build a text-only repair prompt for one automatic schema-fix retry.
 * @param {{ rawOutput: string, errors: string[], outputSchema: Record<string, unknown> }} params
 * @returns {string}
 */
export function buildRepairPrompt({ rawOutput, errors, outputSchema }) {
  const truncated = rawOutput.length > 12_000 ? `${rawOutput.slice(0, 12_000)}\n...[truncated]` : rawOutput
  return [
    'Your previous response did not satisfy the required JSON Schema.',
    'Validation errors:',
    ...errors.map((err) => `- ${err}`),
    '',
    'Target JSON Schema:',
    '```json',
    JSON.stringify(outputSchema, null, 2),
    '```',
    '',
    'Previous response to repair (preserve factual content, do not invent missing observations):',
    truncated,
    '',
    'Return ONLY the repaired valid JSON document.',
  ].join('\n')
}
