import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { packageRoot } from './expert/paths.js'

/** Standard precedence rank matching DSH `@deepseek-ai/dsh-skill` `BUNDLED_SKILL_RANK`. */
export const BUNDLED_SKILL_RANK = 600
/** Provider identity for bundled plugin skills (distinct from `omnimux-catalog` at rank 900). */
export const MARKET_BUNDLED_PROVIDER_NAME = 'omnimux-market'

export interface SkillInvocationPolicy {
  modelInvocable: boolean
  userInvocable: boolean
}

export interface BundledMarketSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  content: string
  path: string
  source: 'bundled'
  resourceBase: { kind: 'directory'; path: string }
}

interface SkillCandidate {
  name: string
  description: string
  whenToUse?: string
  path: string
  invocation: SkillInvocationPolicy
  source: 'bundled'
  provider: string
  rank: number
  resourceBase: { kind: 'directory'; path: string }
  locator: string
}

interface SkillRegistryLike {
  registerProvider?: (
    factory: () => {
      name: string
      list: () => Promise<SkillCandidate[]>
      get: (candidate?: { name?: string }) => Promise<
        | {
            name: string
            description: string
            whenToUse?: string
            path: string
            invocation: SkillInvocationPolicy
            source: 'bundled'
            provider: string
            resourceBase: { kind: 'directory'; path: string }
            content: string
          }
        | undefined
      >
    },
  ) => () => void
  register?: (entry: BundledMarketSkill) => () => void
}

/**
 * Resolve a directory to its physical `app.asar.unpacked` sibling when running
 * inside an Electron ASAR archive so external scripts and `dsh-fs-local` can
 * read skill files and helper scripts directly on disk.
 */
export function resolvePhysicalDir(dir: string): string {
  const unpacked = dir.replace(/(^|[\\/])([^\\/]*\.asar)(?=[\\/]|$)/iu, '$1$2.unpacked')
  return unpacked !== dir && existsSync(unpacked) ? unpacked : dir
}

function parseFrontmatterBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw
  if (raw === 1 || raw === '1') return true
  if (raw === 0 || raw === '0') return false
  if (typeof raw === 'string') {
    switch (raw.trim().toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  return undefined
}

export function parseSkillFrontmatter(raw: string): { metadata: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { metadata: {}, body: raw.trim() }
  const body = (match[2] ?? '').trim()
  try {
    const parsed = parseYaml(match[1] ?? '')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { metadata: parsed as Record<string, unknown>, body }
    }
  } catch (err) {
    console.warn('omnimux-market: frontmatter YAML parse fallback', err instanceof Error ? err.message : String(err))
  }
  const metadata: Record<string, unknown> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) metadata[key] = value
  }
  return { metadata, body }
}

export function parseInvocationPolicy(metadata: Record<string, unknown>): SkillInvocationPolicy {
  const disableModelInvocation = parseFrontmatterBoolean(metadata['disable-model-invocation'])
  const userInvocable = parseFrontmatterBoolean(metadata['user-invocable'])
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

function declaredSkillDirs(pkgRoot: string): string[] {
  const manifestPath = join(pkgRoot, 'dsh.manifest.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { skills?: unknown }
      if (Array.isArray(manifest?.skills) && manifest.skills.length > 0) {
        const dirs: string[] = []
        for (const rel of manifest.skills) {
          if (typeof rel !== 'string' || !rel.trim()) continue
          const file = resolve(pkgRoot, rel)
          if (existsSync(file)) dirs.push(dirname(file))
        }
        if (dirs.length > 0) return dirs
      }
    } catch (err) {
      console.warn('omnimux-market: manifest skills read fallback', err instanceof Error ? err.message : String(err))
    }
  }
  const skillsRoot = join(pkgRoot, 'skills')
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(skillsRoot, entry.name))
    .sort()
}

/**
 * Load all bundled skills shipped inside `omnimux-market/skills/`.
 */
export function loadBundledMarketSkills(pkgRoot: string = packageRoot()): BundledMarketSkill[] {
  const loaded: BundledMarketSkill[] = []
  const seen = new Set<string>()
  for (const rawDir of declaredSkillDirs(pkgRoot)) {
    const dir = resolvePhysicalDir(rawDir)
    const file = join(dir, 'SKILL.md')
    if (!existsSync(file)) continue
    const raw = readFileSync(file, 'utf8')
    const { metadata, body } = parseSkillFrontmatter(raw)
    if (!body) continue
    const fallbackName = basename(dir)
    const name = typeof metadata.name === 'string' && metadata.name.trim()
      ? metadata.name.trim()
      : fallbackName
    if (seen.has(name)) continue
    seen.add(name)
    const description = typeof metadata.description === 'string' && metadata.description.trim()
      ? metadata.description.trim()
      : name
    const whenToUse = typeof metadata.whenToUse === 'string' && metadata.whenToUse.trim()
      ? metadata.whenToUse.trim()
      : undefined
    loaded.push({
      name,
      description,
      ...(whenToUse ? { whenToUse } : {}),
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
 * Build a DSH SkillProvider from a list of bundled skills.
 */
export function createBundledSkillProvider(
  skills: readonly BundledMarketSkill[],
  providerName: string,
  invocationOverride?: SkillInvocationPolicy,
) {
  const byName = new Map(skills.map((entry) => [entry.name, entry]))
  const candidates: SkillCandidate[] = skills.map((entry) => ({
    name: entry.name,
    description: entry.description,
    ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
    path: entry.path,
    invocation: invocationOverride ? { ...invocationOverride } : entry.invocation,
    source: 'bundled',
    provider: providerName,
    rank: BUNDLED_SKILL_RANK,
    resourceBase: entry.resourceBase,
    locator: entry.name,
  }))
  return {
    name: providerName,
    async list(): Promise<SkillCandidate[]> {
      return candidates
    },
    async get(candidate?: { name?: string }) {
      const entry = candidate?.name ? byName.get(candidate.name) : undefined
      if (!entry) return undefined
      return {
        name: entry.name,
        description: entry.description,
        ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
        path: entry.path,
        invocation: invocationOverride ? { ...invocationOverride } : entry.invocation,
        source: 'bundled' as const,
        provider: providerName,
        resourceBase: entry.resourceBase,
        content: entry.content,
      }
    },
  }
}

/**
 * Register all `omnimux-market/skills/*` entries into DSH native `ctx.skills`
 * at `BUNDLED_SKILL_RANK` (600), honoring each skill's frontmatter invocation policy.
 */
export function registerBundledMarketSkills(
  ctx: unknown,
  opts: { packageRoot?: string } = {},
): () => void {
  const skills = loadBundledMarketSkills(opts.packageRoot)
  if (!skills.length || !ctx || typeof ctx !== 'object') return () => {}

  const mountInto = (registry: SkillRegistryLike | undefined | null): (() => void) => {
    if (!registry) return () => {}
    if (typeof registry.registerProvider === 'function') {
      try {
        return registry.registerProvider(() => createBundledSkillProvider(skills, MARKET_BUNDLED_PROVIDER_NAME))
      } catch (err) {
        console.warn('omnimux-market: bundled skills registerProvider failed', err instanceof Error ? err.message : String(err))
        return () => {}
      }
    }
    if (typeof registry.register === 'function') {
      const disposers = skills.map((entry) => registry.register!(entry))
      return () => {
        for (const dispose of disposers) {
          if (typeof dispose === 'function') dispose()
        }
      }
    }
    return () => {}
  }

  let directSkills: SkillRegistryLike | undefined
  try {
    directSkills = (ctx as { skills?: SkillRegistryLike }).skills
  } catch (err) {
    console.warn('omnimux-market: ctx.skills lookup deferred to inject()', err instanceof Error ? err.message : String(err))
    directSkills = undefined
  }
  if (directSkills) {
    return mountInto(directSkills)
  }

  const inject = (ctx as { inject?: (deps: string[], fn: (subCtx: { skills?: SkillRegistryLike; get?: (name: string) => unknown }) => void) => void }).inject
  if (typeof inject === 'function') {
    let cleanup: () => void = () => {}
    inject.call(ctx, ['skills'], (subCtx) => {
      const reg = (subCtx?.skills ?? subCtx?.get?.('skills')) as SkillRegistryLike | undefined
      cleanup = mountInto(reg)
    })
    return () => cleanup()
  }

  return () => {}
}
