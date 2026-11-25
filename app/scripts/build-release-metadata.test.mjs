import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'
import { buildManifestV2, buildMetadata, parseReleaseNotesInput } from './build-release-metadata.mjs'
import { releaseUrls } from './cf-purge-cache.mjs'
import { generateEd25519KeyPair, verifyManifestBytes } from './sign-release-manifest.mjs'

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
  assert.equal(existsSync(join(dir, 'api', 'desktop', 'v2', 'stable.json')), false)
  const partialPath = join(dir, 'api', 'desktop', 'version-stable-partial.json')
  assert.equal(existsSync(partialPath), true)
  const metadata = JSON.parse(readFileSync(partialPath, 'utf8'))
  assert.deepEqual(Object.keys(metadata.sha256), ['macArm64'])
  const partialV2 = JSON.parse(readFileSync(join(dir, 'api', 'desktop', 'v2', 'stable-partial.json'), 'utf8'))
  assert.deepEqual(Object.keys(partialV2.artifacts), ['darwin-arm64'])
})

const threePlatformsV26 = {
  'OmniMux-2.0.26-arm64.dmg': 'arm64 bytes',
  'OmniMux-2.0.26-x64.dmg': 'x64 bytes',
  'OmniMux-2.0.26-x64-Setup.exe': 'windows bytes',
}

test('builds v2 immutable manifest for all three platforms', () => {
  const dir = fixture(threePlatformsV26)
  const { manifestV2 } = buildManifestV2(dir, {
    version: '2.0.26',
    channel: 'stable',
    minSupportedVersion: '2.0.20',
    rolloutPercentage: 25,
    notes: { zh: ['修复内置更新'], en: ['Fix in-app updater'] },
  })
  assert.equal(manifestV2.schemaVersion, 2)
  assert.equal(manifestV2.product, 'omnimux')
  assert.equal(manifestV2.minSupportedVersion, '2.0.20')
  assert.equal(manifestV2.urgency, 'normal')
  assert.deepEqual(manifestV2.rollout, { percentage: 25, salt: '2.0.26-stable' })
  assert.equal(manifestV2.releaseNotesUrl, 'https://github.com/omnimux-ai/omnimux-client/releases/tag/v2.0.26')
  assert.deepEqual(manifestV2.notes, { zh: ['修复内置更新'], en: ['Fix in-app updater'] })
  assert.equal(manifestV2.artifacts['darwin-arm64'].url, 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg')
  assert.equal(manifestV2.artifacts['darwin-arm64'].size, Buffer.byteLength('arm64 bytes'))
  assert.equal(manifestV2.artifacts['darwin-x64'].url, 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-x64.dmg')
  assert.equal(manifestV2.artifacts['win32-x64'].url, 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-x64-Setup.exe')
})

test('rejects invalid minSupportedVersion, urgency, or rolloutPercentage including blank strings', () => {
  const dir = fixture(threePlatformsV26)
  assert.throws(
    () => buildManifestV2(dir, { version: '2.0.26', channel: 'stable', minSupportedVersion: '2.0.27' }),
    /cannot be newer/,
  )
  for (const bad of ['', '   ', 'abc', -1, 101, 12.5]) {
    assert.throws(
      () => buildManifestV2(dir, { version: '2.0.26', channel: 'stable', rolloutPercentage: bad }),
      /rolloutPercentage must be an integer/,
    )
  }
  assert.throws(
    () => buildManifestV2(dir, { version: '2.0.26', channel: 'stable', urgency: 'urgent' }),
    /invalid urgency/,
  )
})

test('CLI dual-writes v1, v2, and Ed25519 signature envelope when private key is configured', () => {
  const dir = fixture(threePlatformsV26)
  const pair = generateEd25519KeyPair()
  const result = spawnSync(process.execPath, [
    script,
    '--version', '2.0.26',
    '--dir', dir,
    '--require-platforms', 'mac-arm64,mac-x64,windows',
    '--min-supported-version', '2.0.20',
    '--key-id', 'k1',
    '--require-signature',
  ], {
    encoding: 'utf8',
    env: { ...process.env, OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY: pair.privateKeyBase64 },
  })
  assert.equal(result.status, 0, result.stderr)

  const v1Path = join(dir, 'api', 'desktop', 'version-stable.json')
  const v2Path = join(dir, 'api', 'desktop', 'v2', 'stable.json')
  const sigPath = join(dir, 'api', 'desktop', 'v2', 'stable.json.sig')
  assert.equal(existsSync(v1Path), true)
  assert.equal(existsSync(v2Path), true)
  assert.equal(existsSync(sigPath), true)

  const rawV2 = readFileSync(v2Path)
  const envelope = JSON.parse(readFileSync(sigPath, 'utf8'))
  assert.deepEqual(verifyManifestBytes(rawV2, envelope, { k1: pair.publicKeyBase64 }), { ok: true, keyId: 'k1' })
})

test('CLI rejects --require-signature before writing manifests and cleans stale .sig when unsigned', () => {
  const dir = fixture(threePlatformsV26)
  const env = { ...process.env }
  delete env.OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY
  const failed = spawnSync(process.execPath, [
    script, '--version', '2.0.26', '--dir', dir, '--require-signature',
  ], { encoding: 'utf8', env })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY is required/)
  assert.equal(existsSync(join(dir, 'api', 'desktop', 'v2', 'stable.json')), false)

  // Write a stale .sig then run unsigned -> stale .sig must be removed
  const v2Dir = join(dir, 'api', 'desktop', 'v2')
  mkdirSync(v2Dir, { recursive: true })
  const staleSig = join(v2Dir, 'stable.json.sig')
  writeFileSync(staleSig, '{"stale":true}\n')
  const unsigned = spawnSync(process.execPath, [
    script, '--version', '2.0.26', '--dir', dir, '--rollout-percentage', '',
  ], { encoding: 'utf8', env })
  assert.equal(unsigned.status, 0, unsigned.stderr)
  assert.equal(existsSync(staleSig), false)
  const v2 = JSON.parse(readFileSync(join(v2Dir, 'stable.json'), 'utf8'))
  assert.equal(v2.rollout.percentage, 100)
})

test('parses bilingual markdown release notes and tolerates markdown starting with {', () => {
  const dir = fixture({
    'notes.md': [
      '## 更新亮点',
      '- 修复桌面端内置更新检查失败',
      '- 支持应用内查看更新说明',
      '## Highlights',
      '- Fix in-app desktop update checks',
      '- Show release notes inside the app',
    ].join('\n'),
    'brace-notes.md': [
      '{note}: preview release',
      '- 修复启动检查',
      '- Fix startup check',
    ].join('\n'),
  })
  assert.deepEqual(parseReleaseNotesInput({ notesFile: join(dir, 'notes.md') }), {
    zh: ['修复桌面端内置更新检查失败', '支持应用内查看更新说明'],
    en: ['Fix in-app desktop update checks', 'Show release notes inside the app'],
  })
  assert.deepEqual(parseReleaseNotesInput({ notesFile: join(dir, 'brace-notes.md') }), {
    zh: ['修复启动检查'],
    en: ['Fix startup check'],
  })
})

test('cf-purge-cache includes Manifest v2 JSON and signature URLs for all channels', () => {
  const urls = releaseUrls('2.0.26', 'https://dl.omnimux.ai')
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/v2/stable.json'))
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/v2/stable.json.sig'))
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/v2/beta.json'))
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/v2/beta.json.sig'))
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/v2/next.json'))
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/v2/next.json.sig'))
  assert.ok(urls.includes('https://dl.omnimux.ai/api/desktop/version-stable.json'))
})
