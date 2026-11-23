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
 * Load bundled inspiration skills from `skills/<name>/SKILL.md`.
 * @returns {Array<{
 *   name: string,
 *   description: string,
 *   content: string,
 *   path: string,
 *   source: 'bundled',
 *   resourceBase: { kind: 'directory', path: string },
 * }>}
 */
export function loadBundledInspirationSkills() {
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
 * Register bundled inspiration skills into DSH native `ctx.skills` so both
 * Hub `headlessSkill` and foreground Agent chat share the exact same source of truth.
 *
 * Uses `ctx.inject(['skills'], ...)` when available so plugins load cleanly even
 * in minimal test contexts where `skills` is not provided.
 *
 * @param {any} ctx
 */
export function registerInspirationSkills(ctx) {
  const skills = loadBundledInspirationSkills()
  if (!skills.length || !ctx) return

  const mountInto = (registry) => {
    if (!registry || typeof registry.register !== 'function') return () => {}
    const disposers = skills.map((entry) => registry.register(entry))
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose()
      }
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['skills'], (subCtx) => {
      const registry = subCtx?.skills ?? subCtx?.get?.('skills')
      const dispose = mountInto(registry)
      if (typeof subCtx?.effect === 'function') {
        subCtx.effect(() => dispose, 'omnimux-inspiration: bundled skills')
      }
    })
    return
  }

  const direct = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills
  if (direct && typeof direct.register === 'function') {
    const dispose = mountInto(direct)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => dispose, 'omnimux-inspiration: bundled skills')
    }
  }
}
