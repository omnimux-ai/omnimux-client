#!/usr/bin/env node
/**
 * scripts/verify-plugin-boundaries.mjs
 *
 * Enforce architecture boundaries across OmniMux plugins:
 * 1. No cross-plugin private implementation imports (e.g. `../omnimux-assets/src/...`)
 * 2. Client code (`src/client/`) must not import Node.js native modules (`fs`, `child_process`, `net`, etc.)
 * 3. Verticals must not bypass public seams or import prohibited internal hubs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const pluginsDir = resolve(repoRoot, 'plugins')

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
      const isClient = rel.includes('/src/client/') || rel.includes('/client/')

      // Extract import/require statements
      const importRegex = /(?:import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
      let match

      while ((match = importRegex.exec(content)) !== null) {
        const specifier = match[1] || match[2]
        if (!specifier) continue

        // 1. Check for cross-plugin private imports
        if (specifier.includes('../omnimux-') || specifier.includes('../../omnimux-') || specifier.includes('../dsh-') || specifier.includes('../../dsh-')) {
          if (specifier.includes('/src/') || specifier.includes('/lib/')) {
            errors.push(`boundary violation in ${rel}: cross-plugin private import "${specifier}" is forbidden. Consume through public API or host seams.`)
          }
        }

        // 2. Check for client-side Node native modules
        if (isClient && NODE_NATIVE_MODULES.has(specifier)) {
          // Allow in CLI scripts, mock fixtures validation, test files, or vendor build-time doc tools
          if (!rel.includes('.test.') && !rel.includes('.spec.') && !rel.includes('/tests/') && !content.startsWith('#!/usr/bin/env node') && !basename(file).startsWith('validate-') && !basename(file).endsWith('-cli.ts') && !basename(file).endsWith('-cli.js')) {
            errors.push(`runtime purity violation in ${rel}: client code imports Node native module "${specifier}". Client bundles must be browser-safe.`)
          }
        }

        // 3. Check for vertical plugins importing forbidden hub internals
        if (plugin !== 'omnimux' && specifier.startsWith('@omnimux/hub/internal')) {
          errors.push(`architecture violation in ${rel}: vertical plugins must not import hub internal module "${specifier}".`)
        }
      }
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
