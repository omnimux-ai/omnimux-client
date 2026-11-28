#!/usr/bin/env node
/**
 * scripts/verify-plugin-boundaries.mjs
 *
 * Enforce architecture boundaries across OmniMux plugins:
 * 1. No cross-plugin private implementation imports (e.g. `../omnimux-assets/src/...`)
 * 2. Client code (`src/client/`) must not import Node.js native modules (`fs`, `child_process`, `net`, etc.)
 * 3. Verticals must not bypass public seams or import prohibited internal hubs
 * 4. Non-Hub plugins must not invoke DSH `ctx.llm` / `llm.stream` directly;
 *    background AI execution must go through Hub `headlessSkill` (or `textComplete` during migration).
 * 5. Non-Hub plugins must not call `execute` on a tool definition read from the
 *    registry (`ctx.tools.get` / `ctx.tools.executable`); a tool call is dispatched
 *    through `ctx.tools.execute` or consumed through a Hub seam.
 *    Contract: docs/contracts/headless-skill-execution.md
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname, relative, extname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const pluginsDir = resolve(repoRoot, 'plugins')

export const DEFAULT_CROSS_PLUGIN_BASELINE_PATH = resolve(here, 'plugin-boundaries-baseline.json')

const CROSS_PLUGIN_RELATIVE_RE = /(?:^|\/)\.\.\/(?:packages\/)?(omnimux(?:-[^/]+)?|dsh-[^/]+)\/(?:src|lib)\//
const CROSS_PLUGIN_PACKAGE_INTERNAL_RE = /^(?:@omnimux\/([^/]+)\/(?:internal|src|lib)(?:\/|$)|(omnimux(?:-[^/]+)?|dsh-[^/]+)\/(?:src|lib)\/)/

/**
 * Load the ratchet allowlist of pre-existing cross-plugin private imports.
 * Only removals are allowed; any new file or specifier fails CI immediately.
 * @param {string} [baselinePath]
 * @returns {Map<string, Set<string>>}
 */
export function loadCrossPluginBaseline(baselinePath = DEFAULT_CROSS_PLUGIN_BASELINE_PATH) {
  const map = new Map()
  if (!existsSync(baselinePath)) return map
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
  for (const [rel, specs] of Object.entries(entries)) {
    if (!Array.isArray(specs)) continue
    map.set(rel.replace(/\\/g, '/'), new Set(specs.map((item) => String(item))))
  }
  return map
}

let cachedDefaultBaseline = null
function getDefaultBaseline() {
  if (!cachedDefaultBaseline) {
    cachedDefaultBaseline = loadCrossPluginBaseline(DEFAULT_CROSS_PLUGIN_BASELINE_PATH)
  }
  return cachedDefaultBaseline
}

/**
 * Explicit read-only exceptions where a non-Hub plugin reads DSH model catalog metadata
 * (`listModels` / `resolveCallConfig`) without executing `llm.stream`.
 */
export const DIRECT_LLM_ACCESS_ALLOWLIST = new Set([
  'plugins/omnimux-browser/src/text-session-model.ts',
  // Reads model input capabilities (`resolveModelInfo`) to decide whether an image may also
  // enter model context; never starts a model call.
  'plugins/omnimux-viewer/src/display-file.ts',
])

/**
 * Ratchet allowlist for pre-existing tool-lookup closure wrappers outside #414 scope.
 * Only removals are permitted; any new file fails verify-plugin-boundaries immediately.
 */
export const LEGACY_TOOL_LOOKUP_CLOSURE_RATCHET = new Set([
  'plugins/omnimux-workflow/src/workflow/index.ts',
])

const DIRECT_LLM_STREAM_RE = /\b(?:ctx\s*\??\.\s*|subCtx\s*\??\.\s*)?llm\s*\??\.\s*stream\s*\(/
const DIRECT_LLM_ACCESS_RE = /\b(?:ctx|subCtx)\s*\??\.\s*llm\b|\b(?:ctx|subCtx)\s*\??\.\s*get(?:\?\.)?\(\s*['"]llm['"]\s*\)|\breadSeat\s*\([^,]+,\s*['"]llm['"]\s*\)/

/**
 * A tool registry expression: `tools`, `toolsService`, `toolRegistry`,
 * `toolsRegistry`, `ctx.tools`, `(ctx as any).tools`, `this.tools`, or the legacy
 * `ctx.get('tools')` seat lookup. Anchoring on these exact names keeps an
 * unrelated helper such as `myTools` out of the rule.
 */
const TOOL_REGISTRY_RECEIVER = String.raw`(?:(?:\(\s*(?:ctx|subCtx|this)\s+as\s+[^)]+\s*\)\s*\.\s*(?:tools|Tools|toolsService|toolRegistry|toolsRegistry))|\b(?:(?:[A-Za-z_$][\w$]*\s*\.\s*)*(?:tools|Tools|toolsService|toolRegistry|toolsRegistry)|(?:ctx|subCtx|this)\s*\.\s*get\s*\(\s*['"]tools['"]\s*\)))`

/** Optional call syntax on either the lookup or `execute`. */
const TOOL_LOOKUP_CALL = String.raw`(?:get|executable)\s*\??\.?\s*\([^()]*\)`
const EXECUTE_CALL = String.raw`\??\.\s*execute\s*\??\.?\s*\(`

/** `ctx.tools.get('name').execute(...)` — chained read and invoke. */
const TOOL_DEFINITION_CHAIN_RE = new RegExp(
  `${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}\\s*${EXECUTE_CALL}`,
)

/** `const tool = ctx.tools.get('name')` — the definition may be invoked later. */
const TOOL_DEFINITION_ASSIGN_RE = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}`,
  'g',
)

/** `const { execute } = ctx.tools.get('name')` — destructured execution body. */
const TOOL_DEFINITION_DESTRUCTURE_RE = new RegExp(
  `(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=[^;]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}`,
  'g',
)

/** `const getTool = (name) => ctx.tools?.get?.(name)` — local wrapper arrow/fn. */
const TOOL_LOOKUP_ARROW_WRAPPER_RE = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>[^\\n;]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}`,
  'g',
)

/** `const getTool = ctx.tools?.get` — bare method reference alias. */
const TOOL_LOOKUP_METHOD_ALIAS_RE = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;\\n]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*(?:get|executable)(?:\\s*;|$|\\n)`,
  'g',
)

/** `function resolveToolDefinition(...) { ... tools.get(...) }` */
const TOOL_LOOKUP_FN_WRAPPER_RE = new RegExp(
  `\\bfunction\\s+([A-Za-z_$][\\w$]*)\\s*\\([^)]*\\)\\s*\\{[^{}]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}[^{}]*\\}`,
  'g',
)

/** Inline closure in object property or call argument: `{ getTool: (n) => ctx.tools?.get?.(n) }` */
const INLINE_TOOL_LOOKUP_CLOSURE_RE = new RegExp(
  `[\\{\\(,]\\s*([A-Za-z_$][\\w$]*)\\s*:\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>[^\\n,;]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}`,
  'g',
)

/** Returned closure: `return (n) => ctx.tools?.get?.(n)` */
const RETURN_TOOL_LOOKUP_CLOSURE_RE = new RegExp(
  `\\breturn\\s+(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>[^\\n;]*${TOOL_REGISTRY_RECEIVER}\\s*\\??\\.\\s*${TOOL_LOOKUP_CALL}`,
  'g',
)

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectToolLookupWrappers(code) {
  const wrappers = new Set()
  for (const re of [TOOL_LOOKUP_ARROW_WRAPPER_RE, TOOL_LOOKUP_METHOD_ALIAS_RE, TOOL_LOOKUP_FN_WRAPPER_RE]) {
    re.lastIndex = 0
    for (const match of code.matchAll(re)) {
      if (match[1]) wrappers.add(match[1])
    }
  }
  return wrappers
}

function isWrapperExportedOrPassed(code, wrapperName) {
  const esc = escapeRegExp(wrapperName)
  // Exported at declaration site
  if (new RegExp(`\\bexport\\s+(?:const|let|var|function)\\s+${esc}\\b`).test(code)) return true
  if (new RegExp(`\\bexport\\s*\\{[^}]*\\b${esc}\\b[^}]*\\}`).test(code)) return true
  // Returned as a value: `return getTool` or `return { getTool }`
  if (new RegExp(`\\breturn\\s+${esc}\\s*(?:[;\\n}]|$)`).test(code)) return true
  if (new RegExp(`\\breturn\\s*\\{[^}]*\\b${esc}\\b(?![\\s?]*\\.\\s*\\(|\\s*\\()`).test(code)) return true
  // Passed in object literal `{ getTool }` or `{ prop: getTool }`
  if (new RegExp(`[\\{,]\\s*(?:[A-Za-z_$][\\w$]*\\s*:\\s*)?${esc}\\s*(?=[,\\}])`).test(code)) return true
  // Passed as function argument `fn(..., getTool, ...)` (not `getTool(...)`)
  if (new RegExp(`[\\(,]\\s*${esc}\\s*(?=[,\\)])`).test(code)) return true
  return false
}

/**
 * Detect wrapper closures / aliases around `ctx.tools.get` / `ctx.tools.executable`
 * that escape the local file (e.g. `const getTool = (n) => ctx.tools?.get?.(n); createPipeline({ getTool })`).
 * A purely local existence check helper that stays inside the same module and is never
 * invoked with `.execute()` remains allowed.
 * @param {string} code source with comments removed
 * @returns {string[]}
 */
export function findToolLookupClosureLeaks(code) {
  const leaks = []
  INLINE_TOOL_LOOKUP_CLOSURE_RE.lastIndex = 0
  for (const match of code.matchAll(INLINE_TOOL_LOOKUP_CLOSURE_RE)) {
    const label = match[1] ? `inline:${match[1]}` : 'inline-closure'
    if (!leaks.includes(label)) leaks.push(label)
  }
  RETURN_TOOL_LOOKUP_CLOSURE_RE.lastIndex = 0
  if (RETURN_TOOL_LOOKUP_CLOSURE_RE.test(code) && !leaks.includes('return-closure')) {
    leaks.push('return-closure')
  }
  for (const wrapper of collectToolLookupWrappers(code)) {
    if (isWrapperExportedOrPassed(code, wrapper) && !leaks.includes(wrapper)) {
      leaks.push(wrapper)
    }
  }
  return leaks
}

/**
 * Collect the identifiers a destructuring pattern binds for `execute`
 * (`{ execute }`, `{ execute: run }`, `{ execute = fallback }`).
 * @param {string} body
 * @returns {string[]}
 */
function destructuredNames(body) {
  const names = []
  for (const part of String(body).split(',')) {
    const [rawKey, ...rest] = part.split(':')
    if (rawKey.trim() !== 'execute') continue
    const target = (rest.length ? rest.join(':') : rawKey).split('=')[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(target)) names.push(target)
  }
  return names
}

/**
 * Find the identifiers (or `chained`) through which a runtime file invokes a
 * registered tool definition directly. Such a call skips pre-execute policy,
 * guards, approval and the result audit that `ctx.tools.execute` owns.
 * @param {string} code source with comments removed
 * @returns {string[]} one entry per detected invocation site
 */
export function findToolDefinitionInvokes(code) {
  const hits = []
  if (TOOL_DEFINITION_CHAIN_RE.test(code)) hits.push('chained')
  /** @type {Set<string>} */
  const memberIdentifiers = new Set()
  /** @type {Set<string>} */
  const bareIdentifiers = new Set()
  for (const match of code.matchAll(TOOL_DEFINITION_ASSIGN_RE)) {
    if (match[1]) memberIdentifiers.add(match[1])
  }
  for (const match of code.matchAll(TOOL_DEFINITION_DESTRUCTURE_RE)) {
    for (const name of destructuredNames(match[1] ?? '')) bareIdentifiers.add(name)
  }
  for (const wrapper of collectToolLookupWrappers(code)) {
    const esc = escapeRegExp(wrapper)
    if (new RegExp(`\\b${esc}\\s*\\??\\.?\\s*\\([^()]*\\)\\s*${EXECUTE_CALL}`).test(code)) {
      if (!hits.includes(`wrapper:${wrapper}`)) hits.push(`wrapper:${wrapper}`)
    }
    const assignRe = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;]*\\b${esc}\\s*\\??\\.?\\s*\\([^()]*\\)`, 'g')
    for (const match of code.matchAll(assignRe)) {
      if (match[1]) memberIdentifiers.add(match[1])
    }
    const destructRe = new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=[^;]*\\b${esc}\\s*\\??\\.?\\s*\\([^()]*\\)`, 'g')
    for (const match of code.matchAll(destructRe)) {
      for (const name of destructuredNames(match[1] ?? '')) bareIdentifiers.add(name)
    }
  }
  for (const identifier of memberIdentifiers) {
    if (hits.includes(identifier)) continue
    const escaped = escapeRegExp(identifier)
    if (new RegExp(`\\b${escaped}\\s*\\??\\.\\s*execute\\s*\\??\\.?\\s*\\(`).test(code)) hits.push(identifier)
  }
  for (const identifier of bareIdentifiers) {
    if (hits.includes(identifier)) continue
    const escaped = escapeRegExp(identifier)
    if (new RegExp(`\\b${escaped}\\s*\\??\\.?\\s*\\(`).test(code)) hits.push(identifier)
  }
  return hits
}

function isTestOrVendorFile(rel) {
  const posix = rel.replace(/\\/g, '/')
  return (
    posix.includes('.test.')
    || posix.includes('.spec.')
    || posix.includes('.fixture.')
    || posix.includes('/tests/')
    || posix.includes('/test/')
    || posix.includes('/__tests__/')
    || posix.includes('/test-support/')
    || posix.includes('/e2e/')
    || posix.includes('/openreel/')
  )
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Extract module specifiers from static `import`, `export ... from`,
 * CommonJS `require(...)`, and dynamic `import(...)` on comment-stripped source.
 * @param {string} codeOnly source with comments removed
 * @returns {string[]}
 */
export function extractModuleSpecifiers(codeOnly) {
  const specifiers = []
  const patterns = [
    /(?:^|[\n;{}])\s*import\s+['"]([^'"\n]+)['"]/g,
    /(?:^|[\n;{}])\s*(?:import|export)\b[^;'"`=]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(codeOnly)) !== null) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

/**
 * Resolve whether a specifier is a forbidden cross-plugin private import.
 * @param {{ specifier: string, plugin: string, isTestOrVendor: boolean }} input
 * @returns {boolean}
 */
function isCrossPluginPrivateImport({ specifier, plugin, isTestOrVendor }) {
  const relMatch = CROSS_PLUGIN_RELATIVE_RE.exec(specifier)
  if (relMatch) {
    const targetPlugin = relMatch[1]
    if (targetPlugin === plugin) return false
    // Test files may import Hub modules directly to verify against real contracts (LESSONS.md).
    if (targetPlugin === 'omnimux' && isTestOrVendor) return false
    return true
  }
  const pkgMatch = CROSS_PLUGIN_PACKAGE_INTERNAL_RE.exec(specifier)
  if (pkgMatch) {
    const targetPlugin = pkgMatch[2] || (pkgMatch[1] === 'hub' ? 'omnimux' : pkgMatch[1])
    if (targetPlugin === plugin) return false
    if (targetPlugin === 'omnimux' && isTestOrVendor) return false
    return true
  }
  return false
}

const NODE_NATIVE_MODULES = new Set([
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'child_process', 'node:child_process',
  'path', 'node:path',
  'os', 'node:os',
  'net', 'node:net',
  'http', 'node:http',
  'https', 'node:https',
  'crypto', 'node:crypto',
  'cluster', 'node:cluster',
  'worker_threads', 'node:worker_threads',
])

function findSourceFiles(dir) {
  const files = []
  if (!existsSync(dir)) return files

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'lib', '.git'].includes(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && ['.js', '.jsx', '.ts', '.tsx', '.mjs'].includes(extname(entry.name))) {
        files.push(full)
      }
    }
  }
  walk(dir)
  return files
}

export function checkSourceFileBoundaries({
  rel,
  plugin,
  content,
  file = rel,
  baseline = getDefaultBaseline(),
  collectCrossPluginHits = null,
}) {
  const posixRel = rel.replace(/\\/g, '/')
  const fileErrors = []
  const isClient = posixRel.includes('/src/client/') || posixRel.includes('/client/')
  const isTestOrVendor = isTestOrVendorFile(posixRel)
  const codeOnly = stripComments(content)
  const seenCrossPlugin = new Set()

  for (const specifier of extractModuleSpecifiers(codeOnly)) {
    // 1. Check for cross-plugin private imports (including `../omnimux/src/`, `export ... from`,
    //    dynamic `import()`, and package-internal paths) with a ratchet allowlist for legacy debt.
    if (isCrossPluginPrivateImport({ specifier, plugin, isTestOrVendor })) {
      if (!seenCrossPlugin.has(specifier)) {
        seenCrossPlugin.add(specifier)
        if (collectCrossPluginHits) {
          let fileSet = collectCrossPluginHits.get(posixRel)
          if (!fileSet) {
            fileSet = new Set()
            collectCrossPluginHits.set(posixRel, fileSet)
          }
          fileSet.add(specifier)
        }
        const allowedSpecs = baseline instanceof Map ? baseline.get(posixRel) : undefined
        if (!allowedSpecs || !allowedSpecs.has(specifier)) {
          fileErrors.push(`boundary violation in ${posixRel}: cross-plugin private import "${specifier}" is forbidden. Consume through public API or host seams.`)
        }
      }
    }

    // 2. Check for client-side Node native modules
    if (isClient && NODE_NATIVE_MODULES.has(specifier)) {
      // Allow in CLI scripts, mock fixtures validation, test files, or vendor build-time doc tools
      if (!posixRel.includes('.test.') && !posixRel.includes('.spec.') && !posixRel.includes('/tests/') && !content.startsWith('#!/usr/bin/env node') && !basename(file).startsWith('validate-') && !basename(file).endsWith('-cli.ts') && !basename(file).endsWith('-cli.js')) {
        fileErrors.push(`runtime purity violation in ${posixRel}: client code imports Node native module "${specifier}". Client bundles must be browser-safe.`)
      }
    }

    // 3. Check for vertical plugins importing forbidden hub internals
    if (plugin !== 'omnimux' && specifier.startsWith('@omnimux/hub/internal')) {
      fileErrors.push(`architecture violation in ${posixRel}: vertical plugins must not import hub internal module "${specifier}".`)
    }
  }

  // 4. Non-Hub runtime files must not call DSH ctx.llm / llm.stream directly.
  if (plugin !== 'omnimux' && !isTestOrVendor) {
    if (DIRECT_LLM_STREAM_RE.test(codeOnly)) {
      fileErrors.push(`headless execution boundary violation in ${posixRel}: non-Hub plugins must not call llm.stream directly. Use Hub ctx.get('headlessSkill') per docs/contracts/headless-skill-execution.md.`)
    } else if (!DIRECT_LLM_ACCESS_ALLOWLIST.has(posixRel) && DIRECT_LLM_ACCESS_RE.test(codeOnly)) {
      fileErrors.push(`headless execution boundary violation in ${posixRel}: non-Hub plugins must not access ctx.llm directly. Use Hub ctx.get('headlessSkill') per docs/contracts/headless-skill-execution.md.`)
    }
    // 5. A registry-read tool definition must not be executed in place or wrapped
    //    into an escaping lookup closure: dispatch through ctx.tools.execute
    //    (pipeline), or consume a Hub seam.
    const definitionInvokes = findToolDefinitionInvokes(codeOnly)
    if (definitionInvokes.length > 0) {
      fileErrors.push(`tool dispatch boundary violation in ${posixRel}: non-Hub plugins must not call execute() on a tool definition read from ctx.tools.get/executable (${definitionInvokes.join(', ')}). Consume a Hub seam or dispatch through ctx.tools.execute per docs/contracts/headless-skill-execution.md.`)
    }
    if (!LEGACY_TOOL_LOOKUP_CLOSURE_RATCHET.has(posixRel)) {
      const lookupLeaks = findToolLookupClosureLeaks(codeOnly)
      if (lookupLeaks.length > 0) {
        fileErrors.push(`tool dispatch boundary violation in ${posixRel}: non-Hub plugins must not wrap ctx.tools.get/executable into an escaping closure or alias (${lookupLeaks.join(', ')}). Dispatch through ctx.tools.execute or consume a Hub seam per docs/contracts/headless-skill-execution.md.`)
      }
    }
  }

  return fileErrors
}

function serializeBaseline(hitsMap) {
  const entries = {}
  for (const rel of [...hitsMap.keys()].sort()) {
    entries[rel] = [...hitsMap.get(rel)].sort()
  }
  return JSON.stringify(
    {
      schemaVersion: 1,
      description: 'Ratchet allowlist for pre-existing cross-plugin private imports (../omnimux/(src|lib)/ and re-exported cross-plugin private paths). Only removals are permitted; any new file or specifier fails verify-plugin-boundaries.',
      entries,
    },
    null,
    2,
  ) + '\n'
}

function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  const baseline = loadCrossPluginBaseline(DEFAULT_CROSS_PLUGIN_BASELINE_PATH)
  const crossPluginHits = new Map()
  const errors = []
  let scannedFiles = 0

  if (existsSync(pluginsDir)) {
    const pluginFolders = readdirSync(pluginsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)

    for (const plugin of pluginFolders) {
      const pluginRoot = join(pluginsDir, plugin)
      const sources = findSourceFiles(pluginRoot)

      for (const file of sources) {
        scannedFiles++
        const rel = relative(repoRoot, file)
        const content = readFileSync(file, 'utf8')
        errors.push(...checkSourceFileBoundaries({
          rel,
          plugin,
          content,
          file,
          baseline: updateBaseline ? new Map() : baseline,
          collectCrossPluginHits: crossPluginHits,
        }))
      }
    }
  }

  if (updateBaseline) {
    writeFileSync(DEFAULT_CROSS_PLUGIN_BASELINE_PATH, serializeBaseline(crossPluginHits), 'utf8')
    let totalImports = 0
    for (const set of crossPluginHits.values()) totalImports += set.size
    console.log(`📝 verify-plugin-boundaries: updated ratchet baseline (${crossPluginHits.size} files, ${totalImports} imports) at ${relative(repoRoot, DEFAULT_CROSS_PLUGIN_BASELINE_PATH)}`)
    process.exit(0)
  }

  if (errors.length === 0) {
    let activeRatchet = 0
    for (const set of crossPluginHits.values()) activeRatchet += set.size
    let baselineTotal = 0
    for (const set of baseline.values()) baselineTotal += set.size
    console.log(`✅ verify-plugin-boundaries: ${scannedFiles} source file(s) across plugins verified for dependency and runtime boundaries (ratcheted legacy cross-plugin imports: ${activeRatchet}/${baselineTotal}).`)
    process.exit(0)
  }

  console.error('❌ verify-plugin-boundaries: violations found:')
  for (const e of errors) {
    console.error(`  - ${e}`)
  }
  process.exit(1)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) main()
