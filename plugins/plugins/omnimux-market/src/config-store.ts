import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { assertSafeIconUrlSyntax } from './icon-guard.js'
import type { PluginConfig, SkillChannel, SortBy } from './types.js'

const SORTS: SortBy[] = ['score', 'downloads', 'stars', 'installs', 'updated_at']
const CHANNELS: SkillChannel[] = ['custom', 'workbuddy', 'skillhub']
const DEFAULT_CHANNELS: SkillChannel[] = ['custom', 'workbuddy', 'skillhub']

function realpathNativeOrFallback(target: string): string {
  const nativeFn = (realpathSync as typeof realpathSync & { native?: typeof realpathSync }).native
  return typeof nativeFn === 'function' ? nativeFn(target) : realpathSync(target)
}

function isContainedDir(rootReal: string, candidateReal: string): boolean {
  const rel = relative(rootReal, candidateReal)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Validate a remote market base URL (`apiBase` / `webBase`).
 * Requires canonical public HTTPS URL without credentials, non-443 ports,
 * loopback/private/metadata IPs, single-label hostnames, whitespace/control
 * characters, or query/fragment delimiters.
 */
export function sanitizeSafeMarketBaseUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed || /[?#@\\\s\u0000-\u001f]/.test(trimmed)) return undefined
  try {
    const parsed = assertSafeIconUrlSyntax(trimmed)
    if (parsed.search || parsed.hash) return undefined
    if (!parsed.hostname.includes('.')) return undefined
    const cleanPath = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.origin}${cleanPath}`
  } catch {
    return undefined
  }
}

/**
 * Resolve a directory path to its canonical realpath when it exists, or resolve
 * its nearest existing ancestor's realpath plus the remaining lexical segments
 * when the directory has not been created yet (fresh install / clean CI runner).
 */
function resolveCanonicalRoot(dirPath: string): { canonical: string; exists: boolean } | null {
  const resolved = resolve(dirPath)
  try {
    const st = lstatSync(resolved)
    if (st.isSymbolicLink() || !st.isDirectory()) return null
    return { canonical: realpathNativeOrFallback(resolved), exists: true }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return null
  }
  const missingSegments: string[] = []
  let probe = resolved
  while (true) {
    const parent = dirname(probe)
    if (parent === probe) return null
    missingSegments.unshift(relative(parent, probe))
    probe = parent
    try {
      const st = lstatSync(probe)
      if (!st.isDirectory()) return null
      const baseReal = realpathNativeOrFallback(probe)
      return { canonical: join(baseReal, ...missingSegments), exists: false }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return null
    }
  }
}

/**
 * Validate `skillsDir`: must resolve inside `dshHome()` without symlinks
 * (including intermediate symlinked segments), traversal, UNC paths, or null bytes.
 */
export function sanitizeSafeSkillsDir(raw: unknown, home: string = dshHome()): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed || trimmed.includes('\0') || /^(?:\\\\|\/\/)/.test(trimmed)) return undefined
  const expanded = trimmed === '~'
    ? homedir()
    : (trimmed.startsWith('~/') || trimmed.startsWith('~\\') ? join(homedir(), trimmed.slice(2)) : trimmed)
  if (!isAbsolute(expanded)) return undefined

  const resolvedHome = resolve(home)
  const homeInfo = resolveCanonicalRoot(resolvedHome)
  if (!homeInfo) return undefined

  const resolvedCandidate = resolve(expanded)
  // Compute relative segments under `resolvedHome` (or canonical `homeInfo.canonical`,
  // handling macOS `/var` -> `/private/var` aliasing).
  let matchedResolvedHome = true
  let rel = relative(resolvedHome, resolvedCandidate)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    matchedResolvedHome = false
    rel = relative(homeInfo.canonical, resolvedCandidate)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return undefined
    }
  }

  const segments = rel ? rel.split(sep).filter(Boolean) : []
  if (segments.some((seg) => seg === '.' || seg === '..')) return undefined

  // Walk top-down from `homeInfo.canonical` through every segment so intermediate
  // symlinks (e.g. `DSH_HOME/link/sub`) are always caught and rejected.
  const baseOut = matchedResolvedHome ? resolvedHome : homeInfo.canonical
  let current = homeInfo.canonical
  if (homeInfo.exists) {
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!
      current = join(current, seg)
      try {
        const st = lstatSync(current)
        if (st.isSymbolicLink() || !st.isDirectory()) return undefined
        const real = realpathNativeOrFallback(current)
        if (!isContainedDir(homeInfo.canonical, real)) return undefined
        current = real
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return undefined
        // First non-existent component inside `homeInfo.canonical`; remaining segments
        // are already validated non-traversal segments.
        const rest = segments.slice(i + 1)
        const canonicalFinal = rest.length ? join(current, ...rest) : current
        if (!isContainedDir(homeInfo.canonical, canonicalFinal)) return undefined
        return segments.length ? join(baseOut, ...segments) : baseOut
      }
    }
    if (!isContainedDir(homeInfo.canonical, current)) return undefined
    return segments.length ? join(baseOut, ...segments) : baseOut
  }

  // `dshHome()` does not exist yet: no symlink can exist inside it; verify
  // lexical containment and return the normalized target path.
  const canonicalFinal = segments.length ? join(homeInfo.canonical, ...segments) : homeInfo.canonical
  if (!isContainedDir(homeInfo.canonical, canonicalFinal)) return undefined
  return segments.length ? join(baseOut, ...segments) : baseOut
}

/**
 * Validate explicit user-supplied config save fields (`apiBase`, `webBase`, `skillsDir`)
 * and return an error message when any provided field violates security bounds.
 */
export function validateConfigPatchInput(raw: Record<string, unknown>, home: string = dshHome()): string | null {
  if (raw.apiBase !== undefined && raw.apiBase !== '') {
    if (!sanitizeSafeMarketBaseUrl(raw.apiBase)) {
      return 'apiBase 必须为合法的公网 HTTPS 地址'
    }
  }
  if (raw.webBase !== undefined && raw.webBase !== '') {
    if (!sanitizeSafeMarketBaseUrl(raw.webBase)) {
      return 'webBase 必须为合法的公网 HTTPS 地址'
    }
  }
  if (raw.skillsDir !== undefined && raw.skillsDir !== '') {
    if (!sanitizeSafeSkillsDir(raw.skillsDir, home)) {
      return 'skillsDir 必须位于受管 DSH 主目录内且不得包含符号链接'
    }
  }
  return null
}

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function defaultSkillsDir(): string {
  return join(dshHome(), 'skills')
}

export function overlayPath(): string {
  return join(dshHome(), 'omnimux-market.json')
}

export function sanitizeSortBy(raw: unknown, fallback: SortBy = 'score'): SortBy {
  const value = String(raw || '').trim() as SortBy
  return SORTS.includes(value) ? value : fallback
}

export function publicConfig(cfg: PluginConfig): Omit<PluginConfig, 'userAgent'> {
  return {
    apiBase: cfg.apiBase,
    webBase: cfg.webBase,
    skillsDir: cfg.skillsDir,
    timeoutMs: cfg.timeoutMs,
    maxResults: cfg.maxResults,
    sortBy: cfg.sortBy,
    plazaKeepAlive: cfg.plazaKeepAlive,
    plazaCacheTtlSec: cfg.plazaCacheTtlSec,
    pluginMaxResults: cfg.pluginMaxResults,
    connectorMaxResults: cfg.connectorMaxResults,
    protectedBundlesExtra: [...cfg.protectedBundlesExtra],
    aggregateChannels: [...cfg.aggregateChannels],
    workbuddySkillsMarketplace: cfg.workbuddySkillsMarketplace,
    aggregateRemoteSoftFail: cfg.aggregateRemoteSoftFail,
  }
}

export function readOverlay(): Partial<PluginConfig> {
  try {
    const raw = JSON.parse(readFileSync(overlayPath(), 'utf8')) as Record<string, unknown>
    return sanitizePatch(raw)
  } catch {
    return {}
  }
}

export function writeOverlay(cfg: PluginConfig): void {
  const path = overlayPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(publicConfig(cfg), null, 2)}\n`)
}

export function sanitizePatch(raw: Record<string, unknown>): Partial<PluginConfig> {
  const out: Partial<PluginConfig> = {}
  const safeApiBase = sanitizeSafeMarketBaseUrl(raw.apiBase)
  if (safeApiBase) out.apiBase = safeApiBase
  const safeWebBase = sanitizeSafeMarketBaseUrl(raw.webBase)
  if (safeWebBase) out.webBase = safeWebBase
  const safeSkillsDir = sanitizeSafeSkillsDir(raw.skillsDir)
  if (safeSkillsDir) out.skillsDir = safeSkillsDir
  if (typeof raw.userAgent === 'string' && raw.userAgent.trim()) out.userAgent = raw.userAgent.trim()
  const timeout = Number(raw.timeoutMs)
  if (Number.isFinite(timeout) && timeout >= 3000) out.timeoutMs = Math.min(timeout, 120000)
  const max = Number(raw.maxResults)
  if (Number.isFinite(max) && max >= 1) out.maxResults = Math.min(Math.floor(max), 80)
  if (raw.sortBy !== undefined) out.sortBy = sanitizeSortBy(raw.sortBy)
  if (typeof raw.plazaKeepAlive === 'boolean') out.plazaKeepAlive = raw.plazaKeepAlive
  else if (raw.plazaKeepAlive === 'false' || raw.plazaKeepAlive === 0) out.plazaKeepAlive = false
  else if (raw.plazaKeepAlive === 'true' || raw.plazaKeepAlive === 1) out.plazaKeepAlive = true
  const ttl = Number(raw.plazaCacheTtlSec)
  if (Number.isFinite(ttl) && ttl >= 15) out.plazaCacheTtlSec = Math.min(Math.floor(ttl), 600)
  const pluginMax = Number(raw.pluginMaxResults)
  if (Number.isFinite(pluginMax) && pluginMax >= 1) out.pluginMaxResults = Math.min(Math.floor(pluginMax), 8)
  const connectorMax = Number(raw.connectorMaxResults)
  if (Number.isFinite(connectorMax) && connectorMax >= 1) out.connectorMaxResults = Math.min(Math.floor(connectorMax), 8)
  if (Array.isArray(raw.protectedBundlesExtra)) {
    out.protectedBundlesExtra = raw.protectedBundlesExtra
      .map((n) => String(n || '').trim())
      .filter((n) => n && /^(@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/.test(n))
  }
  const channels = parseAggregateChannels(raw.aggregateChannels)
  if (channels) out.aggregateChannels = channels
  if (typeof raw.workbuddySkillsMarketplace === 'string') out.workbuddySkillsMarketplace = raw.workbuddySkillsMarketplace.trim()
  if (typeof raw.aggregateRemoteSoftFail === 'boolean') out.aggregateRemoteSoftFail = raw.aggregateRemoteSoftFail
  else if (raw.aggregateRemoteSoftFail === 'false' || raw.aggregateRemoteSoftFail === 0) out.aggregateRemoteSoftFail = false
  else if (raw.aggregateRemoteSoftFail === 'true' || raw.aggregateRemoteSoftFail === 1) out.aggregateRemoteSoftFail = true
  return out
}

export function parseAggregateChannels(raw: unknown): SkillChannel[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: SkillChannel[] = []
  for (const row of raw) {
    const value = String(row || '').trim() as SkillChannel
    if (!CHANNELS.includes(value) || out.includes(value)) continue
    out.push(value)
  }
  return out.length ? out : undefined
}

export function assignConfig(live: PluginConfig, patch: Partial<PluginConfig>): PluginConfig {
  if (patch.apiBase) live.apiBase = patch.apiBase
  if (patch.webBase) live.webBase = patch.webBase
  if (patch.skillsDir) live.skillsDir = patch.skillsDir
  if (patch.userAgent) live.userAgent = patch.userAgent
  if (patch.timeoutMs != null) live.timeoutMs = patch.timeoutMs
  if (patch.maxResults != null) live.maxResults = patch.maxResults
  if (patch.sortBy) live.sortBy = patch.sortBy
  if (patch.plazaKeepAlive != null) live.plazaKeepAlive = patch.plazaKeepAlive
  if (patch.plazaCacheTtlSec != null) live.plazaCacheTtlSec = patch.plazaCacheTtlSec
  if (patch.pluginMaxResults != null) live.pluginMaxResults = patch.pluginMaxResults
  if (patch.connectorMaxResults != null) live.connectorMaxResults = patch.connectorMaxResults
  if (patch.protectedBundlesExtra) live.protectedBundlesExtra = [...patch.protectedBundlesExtra]
  if (patch.aggregateChannels) live.aggregateChannels = [...patch.aggregateChannels]
  if (patch.workbuddySkillsMarketplace != null) live.workbuddySkillsMarketplace = patch.workbuddySkillsMarketplace
  if (patch.aggregateRemoteSoftFail != null) live.aggregateRemoteSoftFail = patch.aggregateRemoteSoftFail
  return live
}

export function withDefaults(config: Partial<PluginConfig>): PluginConfig {
  return {
    apiBase: config.apiBase || 'https://api.skillhub.cn',
    webBase: config.webBase || 'https://skillhub.cn',
    skillsDir: config.skillsDir || defaultSkillsDir(),
    timeoutMs: config.timeoutMs || 20000,
    userAgent: config.userAgent || 'Mozilla/5.0 (compatible; skillhub/0.1)',
    maxResults: config.maxResults || 12,
    sortBy: sanitizeSortBy(config.sortBy, 'score'),
    plazaKeepAlive: config.plazaKeepAlive !== false,
    plazaCacheTtlSec: Number.isFinite(Number(config.plazaCacheTtlSec)) && Number(config.plazaCacheTtlSec) >= 15
      ? Math.min(Math.floor(Number(config.plazaCacheTtlSec)), 600)
      : 90,
    pluginMaxResults: clampMarketLimit(config.pluginMaxResults, 6),
    connectorMaxResults: clampMarketLimit(config.connectorMaxResults, 6),
    protectedBundlesExtra: Array.isArray(config.protectedBundlesExtra)
      ? config.protectedBundlesExtra.map((n) => String(n || '').trim()).filter(Boolean)
      : [],
    aggregateChannels: parseAggregateChannels(config.aggregateChannels) || [...DEFAULT_CHANNELS],
    workbuddySkillsMarketplace: typeof config.workbuddySkillsMarketplace === 'string' ? config.workbuddySkillsMarketplace : '',
    aggregateRemoteSoftFail: config.aggregateRemoteSoftFail !== false,
  }
}

function clampMarketLimit(raw: unknown, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), 8)
}
