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

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative, extname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const pluginsDir = resolve(repoRoot, 'plugins')

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

const DIRECT_LLM_STREAM_RE = /\b(?:ctx\s*\??\.\s*|subCtx\s*\??\.\s*)?llm\s*\??\.\s*stream\s*\(/
const DIRECT_LLM_ACCESS_RE = /\b(?:ctx|subCtx)\s*\??\.\s*llm\b|\b(?:ctx|subCtx)\s*\??\.\s*get(?:\?\.)?\(\s*['"]llm['"]\s*\)|\breadSeat\s*\([^,]+,\s*['"]llm['"]\s*\)/

/**
 * A tool registry expression: `tools`, `toolsService`, `toolRegistry`,
 * `toolsRegistry`, `ctx.tools`, `this.tools`, or the legacy
 * `ctx.get('tools')` seat lookup. Anchoring on these exact names keeps an
 * unrelated helper such as `myTools` out of the rule.
 */
const TOOL_REGISTRY_RECEIVER = String.raw`\b(?:(?:[A-Za-z_$][\w$]*\s*\.\s*)*(?:tools|Tools|toolsService|toolRegistry|toolsRegistry)|(?:ctx|subCtx|this)\s*\.\s*get\s*\(\s*['"]tools['"]\s*\))`

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
 *
 * Known limitation: a local wrapper that hides the registry read behind another
 * function name (for example `const getTool = (name) => tools.get(name)`) is
 * outside static reach and is tracked separately.
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
  for (const identifier of memberIdentifiers) {
    if (hits.includes(identifier)) continue
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\s*\\??\\.\\s*execute\\s*\\??\\.?\\s*\\(`).test(code)) hits.push(identifier)
  }
  for (const identifier of bareIdentifiers) {
    if (hits.includes(identifier)) continue
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\s*\\??\\.?\\s*\\(`).test(code)) hits.push(identifier)
  }
  return hits
}

function isTestOrVendorFile(rel) {
  const posix = rel.replace(/\\/g, '/')
  return (
    posix.includes('.test.')
    || posix.includes('.spec.')
    || posix.includes('/tests/')
    || posix.includes('/test/')
    || posix.includes('/__tests__/')
    || posix.includes('/e2e/')
    || posix.includes('/openreel/')
  )
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
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

export function checkSourceFileBoundaries({ rel, plugin, content, file = rel }) {
  const posixRel = rel.replace(/\\/g, '/')
  const fileErrors = []
  const isClient = posixRel.includes('/src/client/') || posixRel.includes('/client/')

  // Extract import/require statements
  const importRegex = /(?:import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
  let match

  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1] || match[2]
    if (!specifier) continue

    // 1. Check for cross-plugin private imports
    if (specifier.includes('../omnimux-') || specifier.includes('../../omnimux-') || specifier.includes('../dsh-') || specifier.includes('../../dsh-')) {
      if (specifier.includes('/src/') || specifier.includes('/lib/')) {
        fileErrors.push(`boundary violation in ${posixRel}: cross-plugin private import "${specifier}" is forbidden. Consume through public API or host seams.`)
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
  if (plugin !== 'omnimux' && !isTestOrVendorFile(posixRel)) {
    const codeOnly = stripComments(content)
    if (DIRECT_LLM_STREAM_RE.test(codeOnly)) {
      fileErrors.push(`headless execution boundary violation in ${posixRel}: non-Hub plugins must not call llm.stream directly. Use Hub ctx.get('headlessSkill') per docs/contracts/headless-skill-execution.md.`)
    } else if (!DIRECT_LLM_ACCESS_ALLOWLIST.has(posixRel) && DIRECT_LLM_ACCESS_RE.test(codeOnly)) {
      fileErrors.push(`headless execution boundary violation in ${posixRel}: non-Hub plugins must not access ctx.llm directly. Use Hub ctx.get('headlessSkill') per docs/contracts/headless-skill-execution.md.`)
    }
    // 5. A registry-read tool definition must not be executed in place: dispatch
    //    through ctx.tools.execute (pipeline), or consume a Hub seam.
    const definitionInvokes = findToolDefinitionInvokes(codeOnly)
    if (definitionInvokes.length > 0) {
      fileErrors.push(`tool dispatch boundary violation in ${posixRel}: non-Hub plugins must not call execute() on a tool definition read from ctx.tools.get/executable (${definitionInvokes.join(', ')}). Consume a Hub seam or dispatch through ctx.tools.execute per docs/contracts/headless-skill-execution.md.`)
    }
  }

  return fileErrors
}

function main() {
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
        errors.push(...checkSourceFileBoundaries({ rel, plugin, content, file }))
      }
    }
  }

  if (errors.length === 0) {
    console.log(`✅ verify-plugin-boundaries: ${scannedFiles} source file(s) across plugins verified for dependency and runtime boundaries.`)
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
