#!/usr/bin/env node
/**
 * Verify that every desktop-consumed OmniMux plugin has fresh build outputs.
 *
 * The shell consumes the plugin workspaces through `link:` entries, so the
 * packaged payload is assembled from the plugin directories in this repository.
 * Packaging must therefore build plugins before payload preparation; this
 * check makes a stale `lib/client.js` / `dist/index.js` a hard failure.
 *
 * Usage:
 *   node scripts/verify-plugin-builds.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(repoRoot, 'app', 'dsh-desktop-next')
const pluginsRoot = join(repoRoot, 'plugins', 'plugins')

function fail(message) {
  console.error(`verify-plugin-builds: ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function pluginSpecs() {
  const manifest = readJson(join(desktopDir, 'package.json'))
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name]) => name.startsWith('omnimux'))
    .sort(([a], [b]) => a.localeCompare(b))
}

function resolvePlugin(name, spec) {
  const target = resolve(desktopDir, spec.slice(spec.indexOf(':') + 1))
  const rel = relative(pluginsRoot, target)
  if (rel === '' || rel.startsWith('..') || rel.includes(`${sep}..${sep}`)) fail(`${name} resolves outside plugins/plugins`)
  return { target, rel }
}

function outputRequirements(manifest) {
  const outputs = new Set()
  const main = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//u, '') : undefined
  if (main !== undefined && !main.startsWith('src/')) outputs.add(main)
  for (const pattern of manifest.files ?? []) {
    const entry = pattern.replace(/^\.\//u, '')
    if (entry.startsWith('src/') || entry.startsWith('scripts/') || entry.endsWith('/') || !/\.(?:c|m)?js$/u.test(entry)) continue
    // Root build-time configs are inputs, not generated outputs; comparing
    // their checkout mtime against src/ falsely marks a clean build stale on
    // platforms where checkout timestamps differ (notably Windows).
    if (entry === 'tailwind.openreel.config.js') continue
    outputs.add(entry)
  }
  return [...outputs].sort()
}

function trackedSourceMtime(directory) {
  const rel = relative(repoRoot, directory).split(sep).join('/')
  const result = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', rel], { encoding: 'buffer' })
  if (result.error || result.status !== 0) return undefined
  let newest = 0
  for (const file of result.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const inner = file.slice(rel.length + 1)
    if (!(inner === 'package.json' || inner.startsWith('src/') || inner.startsWith('scripts/'))) continue
    const stats = statSync(join(repoRoot, file))
    if (stats.mtimeMs > newest) newest = stats.mtimeMs
  }
  return newest
}

let failed = 0
const specs = pluginSpecs()
if (specs.length !== 13) fail(`expected 13 omnimux dependencies, found ${specs.length}`)

for (const [name, spec] of specs) {
  const { target, rel } = resolvePlugin(name, spec)
  const manifest = readJson(join(target, 'package.json'))
  const outputs = outputRequirements(manifest)
  const main = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//u, '') : undefined
  if (main !== undefined && !existsSync(join(target, main))) fail(`${name}: main entry ${main} is missing`)
  const sourceMtime = trackedSourceMtime(target)
  const stale = []
  for (const output of outputs) {
    const path = join(target, output)
    if (!existsSync(path)) {
      stale.push(`${output} missing`)
      continue
    }
    if (sourceMtime !== undefined && statSync(path).mtimeMs < sourceMtime) stale.push(`${output} older than src/`)
  }
  if (stale.length > 0) {
    failed += 1
    console.error(`  !! ${name}@${manifest.version} (${rel}): ${stale.join(', ')}`)
  } else if (outputs.length === 0) {
    console.log(`  ok ${name}@${manifest.version} (${rel}): source-only (${main ?? 'no main'})`)
  } else {
    console.log(`  ok ${name}@${manifest.version} (${rel}): ${outputs.join(', ')}`)
  }
}

if (failed > 0) fail(`${failed} plugin(s) have missing or stale build outputs; run pnpm --dir plugins run build:all`)
console.log(`verify-plugin-builds: OK — ${specs.length} plugins have fresh build outputs`)
