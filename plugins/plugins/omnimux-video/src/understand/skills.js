import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Skill names are domain-prefixed on purpose: `video-analyze` and
 * `video-reverse-prompt` must stay clear of market catalog skill slugs
 * (`verify-skill-hygiene` rejects cross-plugin collisions).
 */
export const VIDEO_ANALYZE_SKILL = 'video-analyze'
export const VIDEO_REVERSE_PROMPT_SKILL = 'video-reverse-prompt'

/** Rank shared with the other bundled plugin skills (user overrides win above it). */
export const BUNDLED_SKILL_RANK = 600
const PROVIDER_NAME = 'omnimux-video'

const here = dirname(fileURLToPath(import.meta.url))
const skillsRoot = join(here, '..', '..', 'skills')

const BUNDLED_SKILL_NAMES = [VIDEO_ANALYZE_SKILL, VIDEO_REVERSE_PROMPT_SKILL]

/**
 * Electron packages the plugin inside `app.asar`; the bundled `skills/` folder is
 * unpacked next to it, so read the physical directory when it exists.
 * @param {string} dir
 */
function resolvePhysicalDir(dir) {
  const unpacked = dir.replace(/(^|[\\/])([^\\/]*\.asar)(?=[\\/]|$)/iu, '$1$2.unpacked')
  return unpacked !== dir && existsSync(unpacked) ? unpacked : dir
}

/**
 * Parse a boolean frontmatter scalar; `undefined` when absent.
 * @param {string | undefined} raw
 * @returns {boolean | undefined}
 */
function parseFrontmatterBoolean(raw) {
  if (raw === undefined || raw === null) return undefined
  const value = String(raw).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(value)) return true
  if (['false', 'no', 'off', '0'].includes(value)) return false
  return undefined
}

/**
 * Resolve the DSH invocation policy from `SKILL.md` frontmatter. Headless
 * JSON-Schema skills opt out of the global model context with
 * `disable-model-invocation: true` while staying reachable through `/<slug>`.
 * @param {Record<string, string>} metadata
 */
function parseInvocationPolicy(metadata) {
  return {
    modelInvocable: parseFrontmatterBoolean(metadata['disable-model-invocation']) !== true,
    userInvocable: parseFrontmatterBoolean(metadata['user-invocable']) !== false,
  }
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

/**
 * Load bundled video skills from `skills/<name>/SKILL.md`.
 * The SKILL.md body is the single source of truth for both Hub `headlessSkill`
 * and foreground Agent chat; this module never duplicates prompt prose in code.
 *
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
export function loadBundledVideoSkills() {
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
      invocation: parseInvocationPolicy(metadata),
      content: body,
      path: file,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: dir },
    })
  }
  return loaded
}

/**
 * Register bundled video skills into DSH native `ctx.skills` so Hub
 * `headlessSkill` and foreground chat share one methodology source.
 *
 * Prefers `skills.registerProvider` at `BUNDLED_SKILL_RANK` (600) matching the
 * other OmniMux plugin skills; falls back to `skills.register` for minimal test
 * registries. Both DSH methods already bind Cordis fiber disposal.
 *
 * @param {any} ctx
 */
export function registerVideoSkills(ctx) {
  const skills = loadBundledVideoSkills()
  if (!skills.length || !ctx) return

  const mountInto = (registry) => {
    if (!registry) return
    if (typeof registry.registerProvider === 'function') {
      const byName = new Map(skills.map((entry) => [entry.name, entry]))
      const candidates = skills.map((entry) => ({
        name: entry.name,
        description: entry.description,
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
