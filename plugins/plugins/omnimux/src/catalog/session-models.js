/**
 * Session-reachable text models for the tool-model picker.
 *
 * The composer's model button and the session engine both resolve through DSH's
 * `llm` registry (`llm-pi-ai` profiles plus installed catalog routes such as
 * `openai-codex`, `anthropic`, and `kimi-coding`). This module flattens those
 * routes into the single `provider:modelId` vocabulary `omnimux.toolModel`
 * stores, so a tool model is reachable by construction.
 */

import { findDescriptor, PI_AI_NAMESPACE } from './composer-sync.js'

function formatModelLabel(modelName, providerName) {
  return `${modelName} (${providerName})`
}

/**
 * One provider's models flattened into picker rows.
 *
 * `input` declares modalities; a model that publishes no `input` at all is
 * text-capable by convention (the composer treats it the same way), while one
 * that names modalities must include `text` to be listed.
 *
 * @param {string} providerId
 * @param {Record<string, unknown>} profile
 * @returns {Array<{ id: string, label: string }>}
 */
function providerRows(providerId, profile) {
  const models = Array.isArray(profile?.models) ? profile.models : []
  const providerName = typeof profile?.displayName === 'string' && profile.displayName.trim()
    ? profile.displayName.trim()
    : providerId
  const rows = []
  for (const model of models) {
    if (!model || typeof model !== 'object') continue
    const modelId = typeof model.id === 'string' ? model.id.trim() : ''
    if (!modelId) continue
    const input = Array.isArray(model.input)
      ? model.input
      : (Array.isArray(model.inputModalities) ? model.inputModalities : null)
    if (input !== null && !input.includes('text')) continue
    const modelName = typeof model.name === 'string' && model.name.trim()
      ? model.name.trim()
      : modelId
    rows.push({ id: `${providerId}:${modelId}`, label: formatModelLabel(modelName, providerName) })
  }
  return rows
}

/**
 * Flatten every `llm-pi-ai` provider's model list plus optional live `ctx.llm`
 * catalog groups (for routes that inherit pi-ai's built-in catalog without
 * repeating `models` in settings, such as `openai-codex`).
 *
 * @param {unknown} settingsService - the host `settings` service (describe()).
 * @param {Array<{ providerId: string, providerName?: string, models?: Array<{ id: string, name?: string, inputModalities?: string[], input?: string[] }> }>} [liveGroups]
 * @returns {Array<{ id: string, label: string }>}
 */
export function listSessionModels(settingsService, liveGroups = []) {
  const rows = []
  const seen = new Set()
  const pushUnique = (list) => {
    for (const item of list) {
      if (!item || !item.id || seen.has(item.id)) continue
      seen.add(item.id)
      rows.push(item)
    }
  }

  if (settingsService && typeof settingsService.describe === 'function') {
    let descriptor = null
    try {
      descriptor = findDescriptor(settingsService.describe(), PI_AI_NAMESPACE)
    } catch {
      descriptor = null
    }
    if (descriptor) {
      const userProviders = descriptor.user?.providers && typeof descriptor.user.providers === 'object'
        ? descriptor.user.providers
        : null
      const baseProviders = descriptor.base?.providers && typeof descriptor.base.providers === 'object'
        ? descriptor.base.providers
        : null

      const providerIds = new Set([
        ...Object.keys(userProviders ?? {}),
        ...Object.keys(baseProviders ?? {}),
      ])

      for (const providerId of providerIds) {
        const baseProfile = baseProviders && baseProviders[providerId]
        const userProfile = userProviders && userProviders[providerId]
        const profile = {
          ...(baseProfile && typeof baseProfile === 'object' ? baseProfile : {}),
          ...(userProfile && typeof userProfile === 'object' ? userProfile : {}),
        }
        pushUnique(providerRows(providerId, profile))
      }
    }
  }

  if (Array.isArray(liveGroups)) {
    for (const group of liveGroups) {
      if (!group || typeof group.providerId !== 'string' || !group.providerId.trim()) continue
      pushUnique(providerRows(group.providerId.trim(), {
        displayName: group.providerName || group.providerId.trim(),
        models: group.models,
      }))
    }
  }

  return rows
}
