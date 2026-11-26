import {
  createBundledSkillProvider,
  loadBundledMarketSkills,
  loadCatalogSkillBySlug,
  type BundledMarketSkill,
} from './bundled-skills.js'

export const name = 'omnimux-market-expert-skills'
export const inject = ['skills']

export interface ExpertSkillsPluginConfig {
  presetId?: string
  skills?: readonly string[]
  packageRoot?: string
}

/**
 * Scoped Agent-plane plugin mounted inside hired Market Expert presets.
 *
 * Global bundled SOP skills stay 0-Token (`disable-model-invocation: true`) in
 * ordinary sessions. When a user hires an expert preset, this plugin registers
 * ONLY that expert's bound skills inside the preset's own DSH SkillRegistry
 * layer with `modelInvocable: true` at `BUNDLED_SKILL_RANK` (600):
 * - Nearest-layer precedence promotes the expert's skills for that preset alone;
 * - User/project overrides (`skill-filesystem`, rank 100–500) in the same layer
 *   still win over this provider;
 * - Skills owned by other plugins that are already globally model-invocable
 *   (e.g. `clip-craft`) are skipped cleanly without failing activation.
 */
export function apply(ctx: unknown, config: ExpertSkillsPluginConfig = {}): () => void {
  const requested = Array.isArray(config?.skills)
    ? [...new Set(config.skills.map((slug) => String(slug || '').trim()).filter(Boolean))]
    : []
  if (!requested.length || !ctx || typeof ctx !== 'object') return () => {}

  const allBundled = loadBundledMarketSkills(config.packageRoot)
  const byName = new Map<string, BundledMarketSkill>(allBundled.map((entry) => [entry.name, entry]))
  const matched = requested
    .map((slug) => byName.get(slug) ?? (slug === 'clip-craft' ? undefined : loadCatalogSkillBySlug(slug, config.packageRoot)))
    .filter((entry): entry is BundledMarketSkill => entry !== undefined)
  if (!matched.length) return () => {}

  let registry: { registerProvider?: (factory: () => unknown) => () => void } | undefined
  try {
    registry = (ctx as { skills?: { registerProvider?: (factory: () => unknown) => () => void } }).skills
  } catch (err) {
    console.warn('omnimux-market: expert-skills ctx.skills unavailable', err instanceof Error ? err.message : String(err))
    registry = undefined
  }
  if (!registry || typeof registry.registerProvider !== 'function') return () => {}

  const suffix = String(config.presetId || 'preset').trim() || 'preset'
  const providerName = `omnimux-expert-skills:${suffix}`
  return registry.registerProvider(() =>
    createBundledSkillProvider(matched, providerName, {
      modelInvocable: true,
      userInvocable: true,
    }),
  )
}
