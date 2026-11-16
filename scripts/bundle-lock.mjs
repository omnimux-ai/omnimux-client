#!/usr/bin/env node
/**
 * Generate or verify `bundle.lock.json`: the 12 active OmniMux plugins the
 * desktop shell consumes, resolved from this repository (never from npm).
 *
 * Usage:
 *   node scripts/bundle-lock.mjs          # write bundle.lock.json
 *   node scripts/bundle-lock.mjs --check  # exit non-zero when the lock drifts
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(repoRoot, 'app', 'dsh-desktop-next')
const manifestPath = join(desktopDir, 'package.json')
const lockPath = join(repoRoot, 'bundle.lock.json')
const pluginsRoot = join(repoRoot, 'plugins', 'plugins')

const check = process.argv.includes('--check')

function fail(message) {
  console.error(`bundle-lock: ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function pluginSpecs() {
  const manifest = readJson(manifestPath)
  const specs = Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith('omnimux'))
  if (specs.length !== 12) fail(`expected 12 omnimux dependencies in ${relative(repoRoot, manifestPath)}, found ${specs.length}`)
  return specs.sort(([a], [b]) => a.localeCompare(b))
}

function resolvePluginPath(name, spec) {
  if (!spec.startsWith('link:') && !spec.startsWith('file:')) {
    fail(`${name} must use a local link:/file: spec, found ${JSON.stringify(spec)}`)
  }
  const target = resolve(desktopDir, spec.slice(spec.indexOf(':') + 1))
  const rel = relative(pluginsRoot, target)
  if (rel === '' || rel.startsWith('..') || rel.includes(`${sep}..${sep}`)) {
    fail(`${name} resolves outside plugins/plugins: ${target}`)
  }
  if (!existsSync(join(target, 'package.json'))) fail(`${name} has no package.json at ${relative(repoRoot, target)}`)
  return { target, rel: rel.split(sep).join('/') }
}

function gitTrackedFiles(directory) {
  const rel = relative(repoRoot, directory).split(sep).join('/')
  const result = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', rel], { encoding: 'buffer' })
  if (result.error || result.status !== 0) return undefined
  return result.stdout.toString('utf8').split('\0').filter(Boolean).sort()
}

function contentHash(directory) {
  const hash = createHash('sha256')
  const tracked = gitTrackedFiles(directory)
  const files = tracked ?? fail(`cannot list tracked files for ${relative(repoRoot, directory)}`)
  for (const file of files) {
    const path = join(repoRoot, file)
    const stats = lstatSync(path)
    hash.update(file)
    hash.update('\0')
    if (stats.isSymbolicLink()) {
      hash.update(`link:${readlinkSync(path)}`)
    } else if (stats.isDirectory()) {
      hash.update('directory')
    } else {
      hash.update(readFileSync(path))
    }
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function buildLock() {
  const plugins = pluginSpecs().map(([name, spec]) => {
    const { target, rel } = resolvePluginPath(name, spec)
    const manifest = readJson(join(target, 'package.json'))
    if (manifest.name !== name) fail(`${rel}: manifest name ${JSON.stringify(manifest.name)} does not match ${name}`)
    if (typeof manifest.version !== 'string' || manifest.version === '') fail(`${rel}: manifest has no version`)
    return {
      name,
      version: manifest.version,
      path: `plugins/plugins/${rel}`,
      spec,
      contentHash: contentHash(target),
    }
  })
  return {
    schemaVersion: 1,
    source: {
      repository: 'omnimux-ai/omnimux-client',
      pluginsRoot: 'plugins/plugins',
    },
    plugins,
  }
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

const generated = buildLock()
const serialized = canonical(generated)

if (check) {
  if (!existsSync(lockPath)) fail('bundle.lock.json is missing; run node scripts/bundle-lock.mjs')
  const actual = readFileSync(lockPath, 'utf8')
  if (actual !== serialized) {
    const current = JSON.parse(actual)
    const byName = new Map((current.plugins ?? []).map(plugin => [plugin.name, plugin]))
    for (const plugin of generated.plugins) {
      const before = byName.get(plugin.name)
      if (before === undefined) console.error(`  + ${plugin.name}@${plugin.version} (missing from lock)`)
      else if (JSON.stringify(before) !== JSON.stringify(plugin)) {
        console.error(`  ~ ${plugin.name}: ${before.version} -> ${plugin.version} (${before.contentHash ?? 'no-hash'} -> ${plugin.contentHash})`)
      }
    }
    for (const name of byName.keys()) {
      if (!generated.plugins.some(plugin => plugin.name === name)) console.error(`  - ${name} (not in the current dependency set)`)
    }
    fail('bundle.lock.json is stale; run node scripts/bundle-lock.mjs')
  }
  console.log(`bundle-lock: OK — ${generated.plugins.length} plugins match the repository`)
} else {
  writeFileSync(lockPath, serialized)
  console.log(`bundle-lock: wrote ${relative(repoRoot, lockPath)} (${generated.plugins.length} plugins)`)
}
