import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESCRIBED_PLUGINS } from './build-plugin-index.mjs'
import { marketablePlugins } from './plugin-tiers.mjs'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const preflightGuide = 'See AGENTS.md#release-preflight for the release preflight.'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function expectedPackages() {
  const described = new Set(DESCRIBED_PLUGINS.map(plugin => plugin.dir))
  const expected = new Map()
  for (const dir of marketablePlugins()) {
    if (!described.has(dir)) continue
    const manifest = readJson(join(appRoot, '..', 'plugins', 'plugins', dir, 'package.json'))
    if (!manifest.name || !manifest.version || manifest.private === true) {
      throw new Error(`invalid marketable plugin manifest: ${dir}`)
    }
    if (expected.has(manifest.name)) throw new Error(`duplicate plugin manifest name: ${manifest.name}`)
    expected.set(manifest.name, manifest.version)
  }
  return expected
}

export function compareIndexPackages(expected, index) {
  if (!Array.isArray(index?.plugins)) return ['index has no plugins array']
  const differences = []
  const seen = new Set()
  for (const plugin of index.plugins) {
    const { name, versions } = plugin
    const actual = Array.isArray(versions) ? versions.map(row => row.version) : []
    if (seen.has(name)) differences.push(`duplicate ${name}`)
    seen.add(name)
    if (!expected.has(name)) {
      differences.push(`extra ${name}@${actual.join(',') || '(none)'}`)
    } else if (actual.length !== 1 || actual[0] !== expected.get(name)) {
      differences.push(`${name}: expected ${expected.get(name)}, found ${actual.join(',') || '(none)'}`)
    }
  }
  for (const [name, version] of expected) {
    if (!seen.has(name)) differences.push(`missing ${name}@${version}`)
  }
  return differences
}

function main() {
  const path = process.argv[2] ?? join(appRoot, 'dist', 'dsh-index.json')
  const expected = expectedPackages()
  const differences = compareIndexPackages(expected, readJson(path))
  if (differences.length > 0) throw new Error(`plugin index differs from preview manifests:\n  ${differences.join('\n  ')}`)
  console.log(`Plugin index matches ${expected.size} preview manifests.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`${error.message}\n${preflightGuide}`)
    process.exitCode = 1
  }
}
