import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MCP_BEGIN = '# --- omnimux-market managed ---'
export const MCP_END = '# --- end omnimux-market managed ---'

/**
 * Package root that works in both layouts: src/expert/ during tests and
 * lib/expert/ after build (both sit two levels below the package root).
 */
export function packageRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/**
 * @param {string | undefined} home
 */
export function resolveHome(home) {
  return home || process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Resolve the profile directory that should receive MCP rows: env override
 * first (dev profiles), then derive from the install location
 * (`<profile>/node_modules/omnimux-market`), then the production default.
 * @param {string} home
 * @param {string} [profile]
 */
export function profileDir(home, profile) {
  if (profile) return join(home, 'profiles', profile)
  if (process.env.OMNIMUX_PLUGIN_PROFILE) return join(home, 'profiles', process.env.OMNIMUX_PLUGIN_PROFILE)
  const root = packageRoot()
  if (basename(dirname(root)) === 'node_modules') return dirname(dirname(root))
  return join(home, 'profiles', 'omnimux')
}

/**
 * @param {string} home
 * @param {string} skill
 */
export function skillDir(home, skill) {
  return join(home, 'skills', skill)
}

/**
 * @param {string} itemId
 */
export function mcpRowId(itemId) {
  return `esc-mcp-${itemId}`
}

/**
 * 整行精确匹配某条 MCP 行的 id（`    - id: <rowId>`）。
 * 子串匹配会让 esc-mcp-cn-tencent-docs 误中 esc-mcp-cn-tencent-docs-oa（id 前缀碰撞），
 * 已装态检测必须整行比对。id 是 kebab-case 不含正则元字符，转义只是稳妥兜底。
 * @param {string} rowId 形如 `esc-mcp-<itemId>`
 */
export function mcpRowPattern(rowId) {
  const escaped = String(rowId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^[ \\t]*- id: ${escaped}[ \\t]*$`, 'm')
}

/**
 * @param {string} home
 */
export function expertModePresent(home) {
  return join(home, '.agent-presets', 'expert-mode', 'agent.cordis.yml')
}

const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const PLUGIN_SKILL_PATH_RE = /^skills\/[a-z0-9][a-z0-9_-]*(?:\/SKILL\.md)?$/

/**
 * Resolve the physical SKILL.md path for a `source.type === 'plugin'` catalog entry
 * without copying files into $DSH_HOME/skills. Supports both repo workspace layouts
 * (`plugins/plugins/<plugin>`) and installed node_modules / app.asar.unpacked layouts.
 *
 * @param {{ type?: string; plugin?: string; path?: string } | null | undefined} source
 * @param {string | undefined} pkgRoot
 * @returns {string}
 */
export function resolvePluginSkillFile(source, pkgRoot) {
  if (!source || source.type !== 'plugin' || !pkgRoot) return ''
  const plugin = String(source.plugin || '').trim()
  const rawPath = String(source.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!PLUGIN_NAME_RE.test(plugin) || !PLUGIN_SKILL_PATH_RE.test(rawPath) || rawPath.includes('..')) {
    return ''
  }
  const relFile = rawPath.endsWith('/SKILL.md') ? rawPath : `${rawPath}/SKILL.md`
  const bases = plugin === 'omnimux-market'
    ? [resolve(pkgRoot), resolve(dirname(pkgRoot), plugin)]
    : [resolve(dirname(pkgRoot), plugin)]
  for (const base of bases) {
    const candidate = join(base, relFile)
    const unpacked = candidate.replace(/(^|[\\/])([^\\/]*\.asar)(?=[\\/]|$)/iu, '$1$2.unpacked')
    for (const target of unpacked !== candidate ? [unpacked, candidate] : [candidate]) {
      try {
        if (existsSync(target) && statSync(target).isFile()) return target
      } catch {}
    }
  }
  return ''
}
