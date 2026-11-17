#!/usr/bin/env node
/**
 * Verify the desktop shell resolves the 13 OmniMux plugins from this repository
 * through `link:` entries, never from an npm tarball.
 *
 * Usage:
 *   node scripts/verify-app-local-plugins.mjs
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(repoRoot, 'app', 'dsh-desktop-next')
const pluginsRoot = join(repoRoot, 'plugins', 'plugins')

function fail(message) {
  console.error(`verify-app-local-plugins: ${message}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'))
const specs = Object.entries(manifest.dependencies ?? {})
  .filter(([name]) => name.startsWith('omnimux'))
  .sort(([a], [b]) => a.localeCompare(b))
if (specs.length !== 13) fail(`expected 13 omnimux dependencies, found ${specs.length}`)

let failed = 0
for (const [name, spec] of specs) {
  if (!spec.startsWith('link:')) {
    failed += 1
    console.error(`  !! ${name}: ${spec} is not a link: spec`)
    continue
  }
  const target = resolve(desktopDir, spec.slice('link:'.length))
  const targetRel = relative(pluginsRoot, target)
  if (targetRel === '' || targetRel.startsWith('..') || targetRel.includes(`${sep}..${sep}`)) {
    failed += 1
    console.error(`  !! ${name}: resolves outside plugins/plugins (${target})`)
    continue
  }
  const sourceManifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  const candidates = [join(desktopDir, 'node_modules', name), join(repoRoot, 'app', 'node_modules', name)]
  const installed = candidates.find(candidate => existsSync(candidate))
  if (installed === undefined) {
    failed += 1
    console.error(`  !! ${name}: not installed under app node_modules`)
    continue
  }
  if (!lstatSync(installed).isSymbolicLink()) {
    failed += 1
    console.error(`  !! ${name}: installed entry is not a symlink (npm tarball?)`)
    continue
  }
  const real = realpathSync(installed)
  if (real !== realpathSync(target)) {
    failed += 1
    console.error(`  !! ${name}: ${installed} -> ${real}, expected ${target}`)
    continue
  }
  const installedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  if (installedManifest.version !== sourceManifest.version) {
    failed += 1
    console.error(`  !! ${name}: version ${installedManifest.version} != source ${sourceManifest.version}`)
    continue
  }
  console.log(`  ok ${name}@${installedManifest.version} -> ${relative(repoRoot, real)}`)
}

if (failed > 0) fail(`${failed} plugin(s) do not resolve to this repository`)
console.log(`verify-app-local-plugins: OK — ${specs.length} plugins resolve to plugins/plugins`)
