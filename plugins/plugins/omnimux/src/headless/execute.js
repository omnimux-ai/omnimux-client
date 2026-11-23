import { OmnimuxError } from '../media/errors.js'
import {
  assertValidOutputSchema,
  buildRepairPrompt,
  buildStructuredPrompt,
  extractJsonPayload,
  validateAgainstSchema,
} from './schema.js'
import { inferModality } from './queue.js'

export const DEFAULT_TIMEOUT_MS = 120_000
export const MAX_REPAIR_ATTEMPTS = 1
const DEFAULT_MAX_TOKENS = 4096

function normalizeSkillName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) {
    throw new OmnimuxError('headless-skill-invalid-request', 'skillName is required')
  }
  return name
}

function normalizeInput(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) {
    throw new OmnimuxError('headless-skill-invalid-request', 'input must be a non-empty string')
  }
  return text
}

function normalizeMaxRepair(value) {
  if (value === undefined) return MAX_REPAIR_ATTEMPTS
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_REPAIR_ATTEMPTS) {
    throw new OmnimuxError(
      'headless-skill-invalid-request',
      `maxRepairAttempts must be an integer between 0 and ${MAX_REPAIR_ATTEMPTS}`,
    )
  }
  return value
}

function createTimedSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  let timedOut = false
  const onParentAbort = () => {
    controller.abort(parentSignal.reason)
  }
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason)
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new OmnimuxError('headless-skill-timeout', `Headless skill timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  timer.unref?.()

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

/**
 * Execute one headless Skill run against Hub textComplete with JSON Schema validation.
 *
 * @param {{
 *   skills?: { get?: (name: string, options?: { cwd?: string, signal?: AbortSignal }) => Promise<{ name?: string, content?: string } | null> },
 *   textComplete?: { execute?: (req: Record<string, unknown>) => Promise<{ mode?: string, text?: string, model?: string }> },
 *   manager: ReturnType<import('./queue.js').createHeadlessJobManager>,
 *   defaultTimeoutMs?: number,
 * }} deps
 * @param {{
 *   skillName: string,
 *   input: string,
 *   references?: Array<{ type: 'image' | 'video' | 'audio' | 'document', pathOrUrl: string, mime?: string }>,
 *   outputSchema: Record<string, unknown>,
 *   modality?: 'text' | 'image' | 'video',
 *   label?: string,
 *   ownerPlugin?: string,
 *   targetId?: string,
 *   inputFingerprint?: string,
 *   verifyFingerprint?: () => boolean | Promise<boolean>,
 *   model?: string,
 *   cwd?: string,
 *   maxTokens?: number,
 *   timeoutMs?: number,
 *   maxRepairAttempts?: number,
 *   signal?: AbortSignal,
 * }} request
 */
export async function executeHeadlessSkill(deps, request) {
  if (!request || typeof request !== 'object') {
    throw new OmnimuxError('headless-skill-invalid-request', 'request must be an object')
  }
  const skillName = normalizeSkillName(request.skillName)
  const input = normalizeInput(request.input)
  assertValidOutputSchema(request.outputSchema)
  const modality = inferModality(request)
  const maxRepairAttempts = normalizeMaxRepair(request.maxRepairAttempts)
  const timeoutMs = typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
    ? request.timeoutMs
    : (deps.defaultTimeoutMs || DEFAULT_TIMEOUT_MS)
  const maxTokens = typeof request.maxTokens === 'number' && Number.isFinite(request.maxTokens) && request.maxTokens > 0
    ? request.maxTokens
    : DEFAULT_MAX_TOKENS

  if (!deps.skills || typeof deps.skills.get !== 'function') {
    throw new OmnimuxError('headless-skill-not-found', 'DSH skills service is unavailable')
  }
  if (!deps.textComplete || typeof deps.textComplete.execute !== 'function') {
    throw new OmnimuxError('needs-provider', 'Hub textComplete seam is unavailable')
  }

  return deps.manager.enqueue(
    {
      skillName,
      modality,
      label: request.label || skillName,
      ownerPlugin: request.ownerPlugin,
      targetId: request.targetId,
      inputFingerprint: request.inputFingerprint,
      signal: request.signal,
    },
    async ({ jobId, signal, update }) => {
      const timed = createTimedSignal(signal, timeoutMs)
      try {
        update({ stage: 'resolving-skill' })
        const skill = await deps.skills.get(skillName, { cwd: request.cwd, signal: timed.signal })
        if (!skill || typeof skill.content !== 'string' || !skill.content.trim()) {
          throw new OmnimuxError('headless-skill-not-found', `Skill "${skillName}" was not found or has empty content`)
        }

        const systemPrompt = skill.content.trim()
        const structuredPrompt = buildStructuredPrompt({ input, outputSchema: request.outputSchema })

        update({ stage: 'executing' })
        const initial = await runCompletion(deps.textComplete, {
          system: systemPrompt,
          prompt: structuredPrompt,
          references: Array.isArray(request.references) ? request.references : undefined,
          model: request.model,
          maxTokens,
          signal: timed.signal,
        }, timed)

        const modelUsed = typeof initial?.model === 'string' ? initial.model : (request.model || '')
        update({ stage: 'validating', ...(modelUsed ? { model: modelUsed } : {}) })

        let rawText = typeof initial?.text === 'string' ? initial.text : ''
        let validation = parseAndValidate(rawText, request.outputSchema)
        let repaired = false

        if (!validation.ok && maxRepairAttempts > 0) {
          update({ status: 'repairing', stage: 'repairing-schema' })
          const repairPrompt = buildRepairPrompt({
            rawOutput: rawText,
            errors: validation.errors,
            outputSchema: request.outputSchema,
          })
          // Schema repair is text-only so heavy media bytes are not re-uploaded.
          const fixed = await runCompletion(deps.textComplete, {
            system: systemPrompt,
            prompt: repairPrompt,
            model: request.model,
            maxTokens,
            signal: timed.signal,
          }, timed)
          rawText = typeof fixed?.text === 'string' ? fixed.text : ''
          validation = parseAndValidate(rawText, request.outputSchema)
          repaired = validation.ok
        }

        if (!validation.ok) {
          throw new OmnimuxError(
            'headless-skill-schema-invalid',
            `Skill "${skillName}" output failed schema validation: ${validation.errors.slice(0, 3).join('; ')}`,
            { details: { errors: validation.errors } },
          )
        }

        if (typeof request.verifyFingerprint === 'function') {
          const valid = await request.verifyFingerprint()
          if (valid === false) {
            throw new OmnimuxError(
              'headless-skill-stale-input',
              `Source content changed while "${skillName}" was running`,
            )
          }
        }

        return {
          mode: 'live',
          jobId,
          skillName,
          model: modelUsed,
          data: validation.data,
          repaired,
          ...(request.inputFingerprint ? { inputFingerprint: request.inputFingerprint } : {}),
        }
      } catch (error) {
        if (timed.didTimeout()) {
          throw new OmnimuxError('headless-skill-timeout', `Headless skill "${skillName}" timed out after ${timeoutMs}ms`)
        }
        throw error
      } finally {
        timed.cleanup()
      }
    },
  )
}

async function runCompletion(textComplete, req, timed) {
  const response = await textComplete.execute(req)
  if (timed.didTimeout()) {
    throw new OmnimuxError('headless-skill-timeout', 'Headless skill timed out')
  }
  if (!response || response.mode !== 'live' || typeof response.text !== 'string' || !response.text.trim()) {
    throw new OmnimuxError('headless-skill-empty-response', 'Model returned an empty or non-live response')
  }
  return response
}

function parseAndValidate(rawText, outputSchema) {
  const extracted = extractJsonPayload(rawText)
  if (!extracted.ok) {
    return { ok: false, errors: [extracted.error] }
  }
  const errors = validateAgainstSchema(extracted.value, outputSchema)
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, data: extracted.value }
}
