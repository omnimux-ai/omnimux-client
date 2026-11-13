#!/usr/bin/env node
/**
 * check-plugin-files.mjs — gate: package.json `files` must cover the Host
 * relative-import closure reachable from `main`.
 *
 * Why: `pnpm install` of a `file:` package re-packs via the npm `files`
 * whitelist. Listing only `src/index.js` + `src/client` silently drops Host
 * modules (`paths.js`, `local-store.js`, …). Cordis then fails to load.
 *
 * Usage:
 *   node scripts/check-plugin-files.mjs
 *   node scripts/check-plugin-files.mjs plugins/omnimux-inspiration
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const productRoot = resolve(scriptDir, '..')
const defaultPluginsRoot = resolve(productRoot, 'plugins')

const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json'])
const INDEX_NAMES = ['index.js', 'index.mjs', 'index.cjs', 'index.jsx', 'index.ts', 'index.tsx']
const RELATIVE_SPEC_RE =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.[^'"]+)['"]/g

/**
 * Strip block / line comments. Good enough for import scanning; does not try
 * to be a full JS parser.
 * @param {string} source
 */
export function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function extractRelativeSpecifiers(source) {
  const specs = []
  const re = new RegExp(RELATIVE_SPEC_RE.source, 'g')
  const text = stripComments(source)
  let match
  while ((match = re.exec(text))) specs.push(match[1])
  return specs
}

/**
 * @param {string} fromFile
 * @param {string} spec
 * @returns {string | null}
 */
export function resolveRelativeSpecifier(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec)
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of SOURCE_EXTS) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const name of INDEX_NAMES) {
      const candidate = join(base, name)
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return null
}

/**
 * @param {unknown} exportsField
 * @returns {string | null}
 */
function entryFromExports(exportsField) {
  if (typeof exportsField === 'string') return exportsField
  if (!exportsField || typeof exportsField !== 'object') return null
  const root = /** @type {Record<string, unknown>} */ (exportsField)['.']
  if (typeof root === 'string') return root
  if (!root || typeof root !== 'object') return null
  const cond = /** @type {Record<string, unknown>} */ (root)
  for (const key of ['node', 'import', 'require', 'default']) {
    if (typeof cond[key] === 'string') return cond[key]
  }
  return null
}

/**
 * @param {Record<string, unknown>} pkg
 * @param {string} pkgRoot
 * @returns {string | null}
 */
export function resolveMainEntry(pkg, pkgRoot) {
  const declared =
    (typeof pkg.main === 'string' && pkg.main) ||
    entryFromExports(pkg.exports) ||
    null
  if (!declared) return null
  const abs = resolve(pkgRoot, declared)
  if (existsSync(abs) && statSync(abs).isFile()) return abs
  return null
}

/**
 * Walk static relative imports from `entryFile`, staying inside `pkgRoot`.
 * @param {string} entryFile
 * @param {string} pkgRoot
 * @returns {{ files: string[], unresolved: { from: string, spec: string }[] }}
 */
export function collectRelativeImportClosure(entryFile, pkgRoot) {
  const root = resolve(pkgRoot)
  const files = []
  const unresolved = []
  /** @type {string[]} */
  const queue = [resolve(entryFile)]
  const seen = new Set()

  while (queue.length > 0) {
    const current = queue.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    const rel = toPosix(relative(root, current))
    if (rel.startsWith('..')) continue
    files.push(rel)
    if (!SOURCE_EXTS.has(extname(current))) continue
    // Bundled Host artefacts (workflow dist, market concat) can be tens of
    // thousands of lines; they are already self-contained leaves.
    const source = readFileSync(current, 'utf8')
    if (source.length > 400_000) continue
    for (const spec of extractRelativeSpecifiers(source)) {
      const resolved = resolveRelativeSpecifier(current, spec)
      if (!resolved) {
        unresolved.push({ from: rel, spec })
        continue
      }
      const nextRel = toPosix(relative(root, resolved))
      if (nextRel.startsWith('..')) continue
      if (!seen.has(resolved)) queue.push(resolved)
    }
  }

  files.sort()
  return { files, unresolved }
}

/**
 * @param {string} value
 */
function toPosix(value) {
  return value.split(sep).join('/')
}

/**
 * @param {string[]} neededRelPaths
 * @param {Iterable<string>} packRelPaths
 * @returns {string[]}
 */
export function missingFromPack(neededRelPaths, packRelPaths) {
  const packed = new Set()
  for (const path of packRelPaths) packed.add(toPosix(path).replace(/^\.\//, ''))
  return neededRelPaths.filter((path) => {
    const rel = toPosix(path).replace(/^\.\//, '')
    if (packed.has(rel)) return false
    // Directory whitelist entries (e.g. "src") still expand to files in
    // `npm pack --dry-run`; the pack list is file-level. Keep the prefix
    // check as a safety net for mocked pack sets in tests.
    for (const entry of packed) {
      if (rel === entry || rel.startsWith(`${entry.replace(/\/$/, '')}/`)) return false
    }
    return true
  })
}

/**
 * @param {string} stdout
 * @returns {string[]}
 */
export function packFilesFromNpmJson(stdout) {
  const json = extractTrailingJson(stdout)
  const records = Array.isArray(json) ? json : json ? [json] : []
  /** @type {string[]} */
  const files = []
  for (const record of records) {
    const list = record && typeof record === 'object' ? record.files : null
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item === 'string') files.push(item)
      else if (item && typeof item === 'object' && typeof item.path === 'string') files.push(item.path)
    }
  }
  return files
}

/**
 * @param {string} stdout
 * @returns {unknown}
 */
function extractTrailingJson(stdout) {
  const text = String(stdout)
  const startArr = text.lastIndexOf('\n[')
  const startObj = text.lastIndexOf('\n{')
  let start = -1
  if (startArr >= 0 && startObj >= 0) start = Math.max(startArr, startObj) + 1
  else if (startArr >= 0) start = startArr + 1
  else if (startObj >= 0) start = startObj + 1
  else {
    const trimmed = text.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) return JSON.parse(trimmed)
    throw new Error('npm pack --json produced no JSON')
  }
  return JSON.parse(text.slice(start))
}

/**
 * @param {string} pkgRoot
 * @returns {string[]}
 */
export function npmPackDryRunFiles(pkgRoot) {
  const result = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel', 'silent'],
    {
      cwd: pkgRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim() || `exit ${result.status}`
    throw new Error(`npm pack --dry-run failed in ${pkgRoot}: ${err}`)
  }
  return packFilesFromNpmJson(result.stdout || '')
}

/**
 * @typedef {{
 *   name: string,
 *   ok: boolean,
 *   skipped?: string,
 *   needed?: string[],
 *   missing?: string[],
 *   unresolved?: { from: string, spec: string }[],
 *   error?: string,
 * }} PluginFilesCheck
 */

/**
 * @param {string} pkgRoot
 * @param {{ packFiles?: string[] }} [opts]
 * @returns {PluginFilesCheck}
 */
export function checkPlugin(pkgRoot, opts = {}) {
  const pkgFile = join(pkgRoot, 'package.json')
  if (!existsSync(pkgFile)) {
    return { name: pkgRoot, ok: false, error: 'package.json missing' }
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const name = typeof pkg.name === 'string' ? pkg.name : pkgRoot
  const entry = resolveMainEntry(pkg, pkgRoot)
  if (!entry) {
    return { name, ok: true, skipped: 'no resolvable main/exports entry' }
  }
  const { files: needed, unresolved } = collectRelativeImportClosure(entry, pkgRoot)
  if (unresolved.length > 0) {
    return { name, ok: false, needed, unresolved }
  }
  let packFiles
  try {
    packFiles = opts.packFiles ?? npmPackDryRunFiles(pkgRoot)
  } catch (error) {
    return { name, ok: false, needed, error: error instanceof Error ? error.message : String(error) }
  }
  const missing = missingFromPack(needed, packFiles)
  return { name, ok: missing.length === 0, needed, missing }
}

/**
 * @param {string} pluginsRoot
 * @returns {string[]}
 */
export function listPluginDirs(pluginsRoot) {
  if (!existsSync(pluginsRoot)) return []
  return readdirSync(pluginsRoot)
    .map((name) => join(pluginsRoot, name))
    .filter((dir) => existsSync(join(dir, 'package.json')) && statSync(dir).isDirectory())
    .sort()
}

function printResult(result) {
  if (result.skipped) {
    console.log(`· ${result.name} 跳过（${result.skipped}）`)
    return
  }
  if (result.ok) {
    const count = result.needed ? result.needed.length : 0
    console.log(`✓ ${result.name}  Host 闭包 ${count} 个文件均在 npm pack 集合内`)
    return
  }
  if (result.error) {
    console.log(`✗ ${result.name}  ${result.error}`)
    return
  }
  if (result.unresolved && result.unresolved.length > 0) {
    const detail = result.unresolved.map((row) => `${row.from} → ${row.spec}`).join(', ')
    console.log(`✗ ${result.name}  相对 import 无法解析: ${detail}`)
    return
  }
  const missing = (result.missing || []).join(', ')
  console.log(`✗ ${result.name}  npm pack 缺少 Host 闭包: ${missing}`)
  console.log(`  → 把 Host 源码目录列入 package.json files（例如 "src"），勿只列 src/index.js`)
}

function parseTargets(argv, pluginsRoot) {
  const rest = argv.filter((arg) => arg !== '--')
  if (rest.length === 0) return listPluginDirs(pluginsRoot)
  return rest.map((arg) => {
    if (isAbsolute(arg)) return arg
    const asPlugin = join(pluginsRoot, arg)
    if (existsSync(join(asPlugin, 'package.json'))) return asPlugin
    return resolve(process.cwd(), arg)
  })
}

function isMain() {
  const self = fileURLToPath(import.meta.url)
  const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
  return self === invoked
}

if (isMain()) {
  const pluginsRoot = process.env.OMNIMUX_PLUGINS_DIR
    ? resolve(process.env.OMNIMUX_PLUGINS_DIR)
    : defaultPluginsRoot
  const targets = parseTargets(process.argv.slice(2), pluginsRoot)
  if (targets.length === 0) {
    console.error(`✗ 未找到插件目录: ${pluginsRoot}`)
    process.exit(1)
  }
  let failed = 0
  for (const dir of targets) {
    const result = checkPlugin(dir)
    printResult(result)
    if (!result.ok) failed += 1
  }
  if (failed > 0) {
    console.error(`✗ ${failed} 个插件 files 未覆盖 Host 相对 import 闭包`)
    process.exit(1)
  }
}
