import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCTS_BRAND_STRATEGY_SKILL = 'products-brand-strategy'
export const PRODUCTS_PHYSICAL_IMPORT_SKILL = 'products-physical-import'
export const PRODUCTS_SKILL_PROVIDER_NAME = 'omnimux-products'
export const PRODUCTS_SKILL_RANK = 600

const here = dirname(fileURLToPath(import.meta.url))
const skillsRoot = join(here, '..', 'skills')

const BUNDLED_SKILL_NAMES = Object.freeze([
  PRODUCTS_BRAND_STRATEGY_SKILL,
  PRODUCTS_PHYSICAL_IMPORT_SKILL,
])

/**
 * Parse simple YAML frontmatter from a bundled `SKILL.md` file.
 * @param {string} raw
 * @returns {{ metadata: Record<string, string>, body: string }}
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { metadata: {}, body: raw.trim() }
  /** @type {Record<string, string>} */
  const metadata = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) metadata[key] = value
  }
  return { metadata, body: match[2].trim() }
}

/**
 * Load bundled product analysis skills from `skills/<name>/SKILL.md`.
 * @returns {Array<{
 *   name: string,
 *   description: string,
 *   content: string,
 *   path: string,
 *   source: 'bundled',
 *   resourceBase: { kind: 'directory', path: string },
 * }>}
 */
export function loadBundledProductsSkills() {
  const loaded = []
  for (const skillName of BUNDLED_SKILL_NAMES) {
    const dir = join(skillsRoot, skillName)
    const file = join(dir, 'SKILL.md')
    if (!existsSync(file)) continue
    const raw = readFileSync(file, 'utf8')
    const { metadata, body } = parseFrontmatter(raw)
    if (!body) continue
    loaded.push({
      name: metadata.name || skillName,
      description: metadata.description || skillName,
      content: body,
      path: file,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: dir },
    })
  }
  return loaded
}

/**
 * Register bundled product analysis skills into DSH native `ctx.skills` so both
 * Hub `headlessSkill` and foreground Agent chat share the exact same source of truth.
 *
 * Prefers `skills.registerProvider` at `PRODUCTS_SKILL_RANK` (600) so user overrides
 * in `$DSH_HOME/skills` keep higher precedence, and falls back to `skills.register`
 * for minimal test registries.
 *
 * @param {any} ctx
 */
export function registerProductsSkills(ctx) {
  const skills = loadBundledProductsSkills()
  if (!skills.length || !ctx) return

  const mountInto = (registry) => {
    if (!registry) return
    if (typeof registry.registerProvider === 'function') {
      const byName = new Map(skills.map((entry) => [entry.name, entry]))
      const candidates = skills.map((entry) => ({
        name: entry.name,
        description: entry.description,
        path: entry.path,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: PRODUCTS_SKILL_PROVIDER_NAME,
        rank: PRODUCTS_SKILL_RANK,
        resourceBase: entry.resourceBase,
        locator: entry.name,
      }))
      registry.registerProvider(() => ({
        name: PRODUCTS_SKILL_PROVIDER_NAME,
        list: async () => candidates,
        get: async (candidate) => {
          const entry = byName.get(candidate?.name)
          if (!entry) return undefined
          return {
            name: entry.name,
            description: entry.description,
            path: entry.path,
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'bundled',
            provider: PRODUCTS_SKILL_PROVIDER_NAME,
            resourceBase: entry.resourceBase,
            content: entry.content,
          }
        },
      }))
      return
    }
    if (typeof registry.register === 'function') {
      for (const entry of skills) registry.register(entry)
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['skills'], (subCtx) => {
      const registry = subCtx?.skills ?? subCtx?.get?.('skills')
      mountInto(registry)
    })
    return
  }

  const direct = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills
  mountInto(direct)
}
