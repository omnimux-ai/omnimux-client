import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TIKTOK_SELECTION_RISK_AUDIT_SKILL = 'tiktok-selection-risk-audit'
export const TIKTOK_SELECTION_VIDEO_SCRIPT_SKILL = 'tiktok-selection-video-script'
export const BUNDLED_SKILL_RANK = 600
export const PROVIDER_NAME = 'omnimux-tiktok-selection'

const here = dirname(fileURLToPath(import.meta.url))
const skillsRoot = join(here, '..', 'skills')

const BUNDLED_SKILL_NAMES = [
  TIKTOK_SELECTION_RISK_AUDIT_SKILL,
  TIKTOK_SELECTION_VIDEO_SCRIPT_SKILL,
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
 * Load bundled TikTok selection skills from `skills/<name>/SKILL.md`.
 * @param {string} [rootDir]
 */
export function loadBundledSelectionSkills(rootDir = skillsRoot) {
  const loaded = []
  for (const skillName of BUNDLED_SKILL_NAMES) {
    const dir = resolvePhysicalDir(join(rootDir, skillName))
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

/**
 * Register bundled TikTok selection skills into DSH native `ctx.skills` so
 * Hub `headlessSkill` and slash commands resolve them identically on both
 * `dsh-desktop-next` and `dsh-plugin-desktop` with 0 global prompt overhead.
 *
 * @param {any} ctx
 */
export function registerSelectionSkills(ctx) {
  const skills = loadBundledSelectionSkills()
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
