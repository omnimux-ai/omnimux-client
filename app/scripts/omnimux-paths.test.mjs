/**
 * Path-resolution regression tests for the migration off the retired sibling
 * product tree: `omnimux.mjs path` and `build-plugin-index.mjs` must resolve the
 * in-repo plugin workspace (`<repo>/plugins`) by default, never an external tree.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const repoRoot = resolve(appDir, '..')

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function cleanEnv() {
  const env = { ...process.env }
  delete env.OMNIMUX_PRODUCT_DIR
  delete env.OMNIMUX_PLUGINS_DIR
  return env
}

function run(script, args) {
  return spawnSync(process.execPath, [join('scripts', script), ...args], {
    cwd: appDir,
    env: cleanEnv(),
    encoding: 'utf8',
  })
}

test('omnimux.mjs path defaults to the in-repo plugins workspace', () => {
  const result = run('omnimux.mjs', ['path'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`^product: ${escapeRegExp(repoRoot)}/plugins$`, 'mu'))
  assert.match(result.stdout, new RegExp(`^plugins: ${escapeRegExp(repoRoot)}/plugins/plugins$`, 'mu'))
})

test('build-plugin-index.mjs prefers the in-repo plugins workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-index-'))
  const out = join(dir, 'dsh-index.json')
  try {
    const generated = run('build-plugin-index.mjs', ['--offline', '--out', out])
    assert.equal(generated.status, 0, generated.stderr)
    assert.match(generated.stdout, new RegExp(`from ${escapeRegExp(repoRoot)}/plugins/plugins`))

    // The installed node_modules copy can lag behind the source workspace. The
    // index must publish the in-repo source version even when an older copy exists.
    const repoVersion = JSON.parse(
      readFileSync(join(repoRoot, 'plugins', 'plugins', 'omnimux', 'package.json'), 'utf8'),
    ).version
    const nodeModulesManifest = join(appDir, 'dsh-desktop-next', 'node_modules', 'omnimux', 'package.json')
    const nodeModulesVersion = existsSync(nodeModulesManifest)
      ? JSON.parse(readFileSync(nodeModulesManifest, 'utf8')).version
      : null
    const generatedIndex = JSON.parse(readFileSync(out, 'utf8'))
    const omnimuxEntry = generatedIndex.plugins.find(plugin => plugin.name === 'omnimux')
    assert.ok(omnimuxEntry, 'generated index must contain omnimux')
    assert.equal(omnimuxEntry.versions[0].version, repoVersion,
      'must publish the in-repo source version, not the installed node_modules copy')
    if (nodeModulesVersion !== null && nodeModulesVersion !== repoVersion) {
      assert.notEqual(omnimuxEntry.versions[0].version, nodeModulesVersion)
    }

    const checked = run('build-plugin-index.mjs', ['--check', '--offline', '--out', out])
    assert.equal(checked.status, 0, checked.stderr)
    assert.match(checked.stdout, /plugin index is current: \d+ plugins/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
