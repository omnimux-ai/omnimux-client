import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./verify-version.mjs', import.meta.url))
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('accepts a --tag that matches the shipped dsh-desktop-next version', () => {
  const result = run(['--tag', `v${version}`])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`版本一致: ${version.replaceAll('.', '\\.')}`))
})

test('rejects a --tag that does not match the shipped version', () => {
  const result = run(['--tag', 'v9.9.9'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /发布 tag 与版本不一致/)
})
