import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INSPIRATION_DECONSTRUCT_SKILL = 'inspiration-deconstruct'
export const INSPIRATION_TRANSLATE_SKILL = 'inspiration-translate'

const here = dirname(fileURLToPath(import.meta.url))
const skillsRoot = join(here, '..', 'skills')

const BUNDLED_SKILL_NAMES = [
  INSPIRATION_DECONSTRUCT_SKILL,
  INSPIRATION_TRANSLATE_SKILL,
]

function resolvePhysicalDir(dir) {
  const unpacked = dir.replace(/(^|[\\/])([^\\/]*\.asar)(?=[\\/]|$)/iu, '$1$2.unpacked')
  return unpacked !== dir && existsSync(unpacked) ? unpacked : dir
}

function parseFrontmatterBoolean(raw) {
  if (typeof raw === 'boolean') return raw
  if (raw === undefined || raw === null) return undefined
  const value = String(raw).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(value)) return true
  if (['false', 'no', 'off', '0'].includes(value)) return false
  return undefined
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { metadata: {}, body: raw.trim() }
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

function parseInvocationPolicy(metadata) {
  const disableModelInvocation = parseFrontmatterBoolean(metadata['disable-model-invocation'])
  const userInvocable = parseFrontmatterBoolean(metadata['user-invocable'])
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

/**
 * Load bundled inspiration skills from `skills/<name>/SKILL.md`.
 * @returns {Array<{
 *   name: string,
 *   description: string,
 *   invocation: { modelInvocable: boolean, userInvocable: boolean },
 *   content: string,
 *   path: string,
 *   source: 'bundled',
 *   resourceBase: { kind: 'directory', path: string },
 * }>}
 */
export function loadBundledInspirationSkills() {
  const loaded = []
  for (const skillName of BUNDLED_SKILL_NAMES) {
    const dir = resolvePhysicalDir(join(skillsRoot, skillName))
    const file = join(dir, 'SKILL.md')
    if (!existsSync(file)) continue
    const raw = readFileSync(file, 'utf8')
    const { metadata, body } = parseFrontmatter(raw)
    if (!body) continue
    loaded.push({
      name: metadata.name || skillName,
      description: metadata.description || skillName,
      ...(metadata.whenToUse ? { whenToUse: metadata.whenToUse } : {}),
      invocation: parseInvocationPolicy(metadata),
      content: body,
      path: file,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: dir },
    })
  }
  return loaded
}

const BUNDLED_SKILL_RANK = 600
const PROVIDER_NAME = 'omnimux-inspiration'

/**
 * Register bundled inspiration skills into DSH native `ctx.skills` so both
 * Hub `headlessSkill` and foreground Agent chat share the exact same source of truth.
 *
 * Prefers `skills.registerProvider` at `BUNDLED_SKILL_RANK` (600) so user overrides
 * in `$DSH_HOME/skills` keep higher precedence (matching DSH `skill-office`), and falls
 * back to `skills.register` for minimal test registries. Both DSH methods already bind
 * Cordis fiber disposal, so no duplicate outer `ctx.effect` disposer is attached.
 *
 * @param {any} ctx
 */
export function registerInspirationSkills(ctx) {
  const skills = loadBundledInspirationSkills()
  if (!skills.length || !ctx) return

  const mountInto = (registry) => {
    if (!registry) return
    if (typeof registry.registerProvider === 'function') {
      const byName = new Map(skills.map((entry) => [entry.name, entry]))
      const candidates = skills.map((entry) => ({
        name: entry.name,
        description: entry.description,
        ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
        path: entry.path,
        invocation: entry.invocation,
        source: 'bundled',
        provider: PROVIDER_NAME,
        rank: BUNDLED_SKILL_RANK,
        resourceBase: entry.resourceBase,
        locator: entry.name,
      }))
      registry.registerProvider(() => ({
        name: PROVIDER_NAME,
        list: async () => candidates,
        get: async (candidate) => {
          const entry = byName.get(candidate?.name)
          if (!entry) return undefined
          return {
            name: entry.name,
            description: entry.description,
            ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
            path: entry.path,
            invocation: entry.invocation,
            source: 'bundled',
            provider: PROVIDER_NAME,
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
