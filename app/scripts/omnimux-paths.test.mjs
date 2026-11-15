/**
 * Path-resolution regression tests for the migration off the retired sibling
 * product tree: `omnimux.mjs path` and `build-plugin-index.mjs` must resolve the
 * in-repo plugin workspace (`<repo>/plugins`) by default, never an external tree.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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
    const checked = run('build-plugin-index.mjs', ['--check', '--offline', '--out', out])
    assert.equal(checked.status, 0, checked.stderr)
    assert.match(checked.stdout, /plugin index is current: \d+ plugins/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
