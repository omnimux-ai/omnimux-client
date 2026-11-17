#!/usr/bin/env node
/**
 * Verify a prepared desktop payload carries this repository's product plugins.
 *
 * The Next shell copies the 13 `omnimux*` bundles from `plugins/plugins/*` (through the
 * `link:` specs in `app/dsh-desktop-next/package.json`) when it materializes
 * `app/dsh-desktop-next/.desktop-build/payload`. This check reads that payload and
 * proves each package is the local one: the version and main-entry bytes match the
 * checkout, no entry is a symbolic link, and `files` exclusions stayed excluded.
 *
 * Usage:
 *   node scripts/verify-packaged-plugins.mjs [--payload <dir>] [--lock <file>]
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    payload: { type: 'string' },
    lock: { type: 'string' },
  },
  allowPositionals: false,
})

const payloadRoot = resolve(values.payload ?? join(repoRoot, 'app', 'dsh-desktop-next', '.desktop-build', 'payload'))
const lockPath = resolve(values.lock ?? join(repoRoot, 'bundle.lock.json'))

function fail(message) {
  console.error(`verify-packaged-plugins: ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

if (!existsSync(payloadRoot)) fail(`no prepared payload at ${payloadRoot}; run the packaging prebuild first`)
if (!existsSync(lockPath)) fail(`no bundle lock at ${lockPath}; run node scripts/bundle-lock.mjs`)
const lock = readJson(lockPath)
const plugins = lock.plugins
if (!Array.isArray(plugins) || plugins.length !== 13) fail(`bundle lock must list 13 plugins, found ${plugins?.length ?? 0}`)

const modules = join(payloadRoot, 'node_modules')
if (!existsSync(modules)) fail(`payload has no node_modules: ${modules}`)

const problems = []
for (const plugin of plugins) {
  const packagedDir = join(modules, plugin.name)
  const localDir = join(repoRoot, ...plugin.path.split('/'))
  if (!existsSync(join(packagedDir, 'package.json'))) {
    problems.push(`${plugin.name}: missing from the payload`)
    continue
  }
  if (lstatSync(packagedDir).isSymbolicLink()) problems.push(`${plugin.name}: payload entry is a symbolic link`)
  const packaged = readJson(join(packagedDir, 'package.json'))
  const local = readJson(join(localDir, 'package.json'))
  if (packaged.name !== plugin.name) problems.push(`${plugin.name}: packaged manifest names ${String(packaged.name)}`)
  if (packaged.version !== plugin.version) problems.push(`${plugin.name}: payload ${String(packaged.version)} != lock ${plugin.version}`)
  if (local.version !== plugin.version) problems.push(`${plugin.name}: lock ${plugin.version} != checkout ${String(local.version)}`)
  const main = local.main
  if (typeof main !== 'string' || main === '') {
    problems.push(`${plugin.name}: checkout manifest has no main entry`)
    continue
  }
  if (!existsSync(join(packagedDir, main))) {
    problems.push(`${plugin.name}: payload is missing main entry ${main}`)
    continue
  }
  if (!existsSync(join(localDir, main))) {
    problems.push(`${plugin.name}: checkout is missing built main entry ${main}; run the plugin build`)
    continue
  }
  if (digest(join(packagedDir, main)) !== digest(join(localDir, main))) {
    problems.push(`${plugin.name}: payload ${main} does not match the checkout`)
    continue
  }
  for (const pattern of local.files ?? []) {
    if (!pattern.startsWith('!')) continue
    const excluded = pattern.slice(1).replace(/^\.\//u, '')
    if (existsSync(join(packagedDir, excluded))) problems.push(`${plugin.name}: excluded path ${excluded} was packaged`)
  }
  console.log(`  ok ${plugin.name}@${plugin.version} (${main})`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ! ${problem}`)
  fail(`${problems.length} packaged plugin(s) do not match the repository`)
}
console.log(`verify-packaged-plugins: OK — ${plugins.length} plugins packaged from this repository (${payloadRoot})`)
