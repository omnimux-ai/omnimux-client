import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'
import { buildMetadata } from './build-release-metadata.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-release-metadata-'))
  roots.push(root)
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents)
  return root
}

const script = fileURLToPath(new URL('./build-release-metadata.mjs', import.meta.url))

const threePlatforms = {
  'OmniMux-2.0.24-arm64.dmg': 'arm64 bytes',
  'OmniMux-2.0.24-x64.dmg': 'x64 bytes',
  'OmniMux-2.0.24-x64-Setup.exe': 'windows bytes',
}

test('builds sha256 for all three platforms', () => {
  const dir = fixture(threePlatforms)
  const { metadata } = buildMetadata(dir, '2.0.24', 'stable')
  assert.equal(metadata.version, '2.0.24')
  assert.equal(metadata.channel, 'stable')
  assert.deepEqual(Object.keys(metadata.sha256).sort(), ['macArm64', 'macX64', 'windows'])
})

test('rejects a publish missing windows', () => {
  const dir = fixture({
    'OmniMux-2.0.24-arm64.dmg': 'arm64 bytes',
    'OmniMux-2.0.24-x64.dmg': 'x64 bytes',
  })
  assert.throws(() => buildMetadata(dir, '2.0.24', 'stable'), /missing required release artifact: windows/)
})

test('rejects an artifact whose filename does not match the release version', () => {
  const dir = fixture({
    'OmniMux-2.0.23-arm64.dmg': 'old arm64 bytes',
    'OmniMux-2.0.24-x64.dmg': 'x64 bytes',
    'OmniMux-2.0.24-x64-Setup.exe': 'windows bytes',
  })
  assert.throws(() => buildMetadata(dir, '2.0.24', 'stable'), /does not match release version/)
})

test('allows a partial set only when explicitly requested', () => {
  const dir = fixture({
    'OmniMux-2.0.24-arm64.dmg': 'arm64 bytes',
  })
  const { metadata } = buildMetadata(dir, '2.0.24', 'stable', ['mac-arm64'])
  const expected = createHash('sha256').update('arm64 bytes').digest('hex')
  assert.deepEqual(metadata.sha256, { macArm64: expected })
})

test('rejects a subset --require-platforms in publish mode', () => {
  const dir = fixture(threePlatforms)
  const result = spawnSync(process.execPath, [script, '--version', '2.0.24', '--dir', dir, '--require-platforms', 'mac-arm64'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must name exactly mac-arm64,mac-x64,windows/)
})

test('partial mode writes a partial manifest, never version-stable.json', () => {
  const dir = fixture({ 'OmniMux-2.0.24-arm64.dmg': 'arm64 bytes' })
  const result = spawnSync(process.execPath, [script, '--version', '2.0.24', '--dir', dir, '--partial', '--require-platforms', 'mac-arm64'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(dir, 'api', 'desktop', 'version-stable.json')), false)
  const partialPath = join(dir, 'api', 'desktop', 'version-stable-partial.json')
  assert.equal(existsSync(partialPath), true)
  const metadata = JSON.parse(readFileSync(partialPath, 'utf8'))
  assert.deepEqual(Object.keys(metadata.sha256), ['macArm64'])
})

