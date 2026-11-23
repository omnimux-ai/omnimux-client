/**
 * Transparent runtime redirect for retired OmniMux / upstream agent preset IDs.
 *
 * The preset picker roster (`list()` / `remoteExportList()`) stays untouched so
 * users see only the converged shipped presets (`omni-agent` + native `cordis`).
 * When a persisted historical session or cold transcript view resolves a retired
 * preset ID, this seam retries with `omni-agent` only on `agent-preset/not-found`,
 * preventing session resume lockups without polluting the picker or overriding
 * any preset that is explicitly registered.
 */

export const DEFAULT_PRODUCT_PRESET_ID = 'omni-agent'

/** Retired shipped and upstream preset IDs redirected to `omni-agent` on `agent-preset/not-found`. */
export const RETIRED_PRESET_IDS = Object.freeze([
  'tiktok-agent',
  'instagram-agent',
  'x-agent',
  'youtube-agent',
  'viral-video-agent',
  'ad-creative-agent',
  'media-creator',
  'shopee-ops-expert',
  'youtube-creator-expert',
  'amazon-operations-expert',
  'tiktok-ecommerce-expert',
  'marketing-agent',
  'marketing-growth-team',
  'drama-agent',
  'daily-work',
  'standard',
  'ptc',
  'minimal',
  'code',
])

const RETIRED_PRESET_SET = new Set(RETIRED_PRESET_IDS)

/**
 * Whether `presetId` belongs to the retired preset set, legacy `expert-*`
 * subagent presets, or optional market `ecom-*` experts (only invoked after
 * `agent-preset/not-found`, so installed `ecom-*` experts run untouched while
 * disabled experts cleanly fall back to `omni-agent` on historical session reopen).
 * @param {unknown} presetId
 * @returns {boolean}
 */
export function isRetiredPresetId(presetId) {
  if (typeof presetId !== 'string') return false
  const normalized = presetId.trim().toLowerCase()
  if (!normalized || normalized === DEFAULT_PRODUCT_PRESET_ID || normalized === 'cordis') return false
  return RETIRED_PRESET_SET.has(normalized) || normalized.startsWith('expert-') || normalized.startsWith('ecom-')
}

function isPresetNotFoundError(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'agent-preset/not-found')
}

const CORDIS_ORIGINAL = Symbol.for('cordis.original')

/**
 * Unwrap a Cordis Service Proxy to its underlying instance so own-property hooks
 * and teardown identity guards operate on the real target instead of ephemeral
 * shadow method proxies created on every property read.
 *
 * @param {object} registry
 * @returns {object}
 */
function unwrapCordisTarget(registry) {
  let target = registry
  const seen = new Set()
  while (target && typeof target === 'object' && !seen.has(target)) {
    seen.add(target)
    const original = Reflect.get(target, CORDIS_ORIGINAL)
    if (!original || typeof original !== 'object' || original === target) break
    target = original
  }
  return target
}

/**
 * Wrap one method on `agentPresets` so `agent-preset/not-found` for a retired ID
 * falls back to `DEFAULT_PRODUCT_PRESET_ID` without altering `list()` or unknown IDs.
 *
 * @param {object} target
 * @param {string} methodName
 * @param {number} idArgIndex
 * @returns {(() => void) | null}
 */
function wrapPresetLookupMethod(target, methodName, idArgIndex) {
  const original = target?.[methodName]
  if (typeof original !== 'function') return null
  const hadOwn = Object.prototype.hasOwnProperty.call(target, methodName)

  const wrapped = async function retiredPresetRedirectWrapper(...args) {
    const requestedId = args[idArgIndex]
    try {
      return await original.apply(this, args)
    } catch (error) {
      const failedId =
        requestedId ??
        error?.details?.agentPreset ??
        error?.data?.agentPreset ??
        this?.defaultId ??
        target?.defaultId
      if (!isPresetNotFoundError(error) || !isRetiredPresetId(failedId)) {
        throw error
      }
      const redirectedArgs = [...args]
      redirectedArgs[idArgIndex] = DEFAULT_PRODUCT_PRESET_ID
      return await original.apply(this, redirectedArgs)
    }
  }

  target[methodName] = wrapped
  return () => {
    if (target[methodName] !== wrapped) return
    if (hadOwn) target[methodName] = original
    else delete target[methodName]
  }
}

/**
 * Ensure `remoteExportList()` marks `omni-agent` as default when a legacy profile's
 * `defaultId` still points at a retired preset that is no longer registered.
 * Never filters, hides, or removes any registered preset from the roster.
 *
 * @param {object} target
 * @returns {(() => void) | null}
 */
function wrapRemoteExportListDefault(target) {
  const original = target?.remoteExportList
  if (typeof original !== 'function') return null
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'remoteExportList')

  const wrapped = async function retiredPresetDefaultExportWrapper(...args) {
    const result = await original.apply(this, args)
    if (!result || !Array.isArray(result.presets)) return result
    if (result.presets.some((row) => row?.isDefault === true)) return result
    if (!isRetiredPresetId(this?.defaultId ?? target?.defaultId)) return result
    if (!result.presets.some((row) => row?.id === DEFAULT_PRODUCT_PRESET_ID)) return result
    return {
      ...result,
      presets: result.presets.map((row) => (
        row?.id === DEFAULT_PRODUCT_PRESET_ID ? { ...row, isDefault: true } : row
      )),
    }
  }

  target.remoteExportList = wrapped
  return () => {
    if (target.remoteExportList !== wrapped) return
    if (hadOwn) target.remoteExportList = original
    else delete target.remoteExportList
  }
}

/**
 * Install retired-preset redirect hooks onto an `agentPresets` registry instance.
 * @param {object | null | undefined} registry
 * @returns {() => void} disposer that restores original methods
 */
export function installRetiredPresetRedirect(registry) {
  if (!registry || typeof registry !== 'object') return () => {}
  const target = unwrapCordisTarget(registry)
  const methods = [
    ['resolve', 0],
    ['acquireScope', 0],
    ['mount', 1],
    ['recompose', 1],
  ]
  const disposers = [
    ...methods.map(([name, index]) => wrapPresetLookupMethod(target, name, index)),
    wrapRemoteExportListDefault(target),
  ].filter(Boolean)

  return () => {
    for (const dispose of disposers.reverse()) {
      dispose()
    }
  }
}

/**
 * Mount the retired-preset redirect seam onto a Cordis Host context.
 * Uses lazy `ctx.inject(['agentPresets'], ...)` so hosts without preset registry stay unaffected.
 * @param {{ inject?: Function, effect?: Function }} ctx
 */
export function mountRetiredPresetRedirect(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return
  ctx.inject(['agentPresets'], (inner) => {
    const registry = inner?.agentPresets ?? inner?.get?.('agentPresets')
    if (!registry) return
    const dispose = installRetiredPresetRedirect(registry)
    if (typeof inner.effect === 'function') {
      inner.effect(() => dispose, 'omnimux: retired-preset redirect')
    }
  })
}
