import { generateKeyPairSync, sign } from 'node:crypto'
import { expect, it } from 'vitest'
import { checkOmniMuxManifest, OmniMuxUpdateError, rolloutBucket } from '../../src/omnimux-updater/manifest.ts'
import { macUpdateArch } from '../../src/update-arch.ts'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const SHA_A = 'a'.repeat(64)

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  return {
    publicKeyBase64: spki.subarray(ED25519_SPKI_PREFIX.length).toString('base64'),
    privateKey,
  }
}

function makeSignedManifest(overrides: Record<string, unknown> = {}, keyId = 'k1') {
  const pair = makeKeyPair()
  const manifest = {
    schemaVersion: 2,
    product: 'omnimux',
    channel: 'stable',
    version: '2.0.26',
    publishedAt: '2026-11-26T00:00:00.000Z',
    urgency: 'normal',
    rollout: { percentage: 100, salt: '2.0.26-stable' },
    releaseNotesUrl: 'https://github.com/omnimux-ai/omnimux-client/releases/tag/v2.0.26',
    notes: { zh: ['修复更新器'], en: ['Fix updater'] },
    artifacts: {
      'darwin-arm64': {
        url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg',
        sha256: SHA_A,
        size: 120_000_000,
        minOsVersion: '13.0',
      },
      'darwin-x64': {
        url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-x64.dmg',
        sha256: SHA_A,
        size: 125_000_000,
        minOsVersion: '13.0',
      },
      'win32-x64': {
        url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-x64-Setup.exe',
        sha256: SHA_A,
        size: 110_000_000,
        minOsVersion: '10.0.19041',
      },
    },
    ...overrides,
  }
  const raw = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const sig = {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId,
    signature: sign(null, raw, pair.privateKey).toString('base64'),
    signedAt: '2026-11-26T00:00:00.000Z',
  }
  return { pair, raw, sig }
}

it('verifies signed Manifest v2 for stable 2.0.25 -> 2.0.26 and maps Rosetta x64 to darwin-arm64', async () => {
  const { pair, raw, sig } = makeSignedManifest()
  const request = async (url: string) => {
    if (url.endsWith('/stable.json')) return new Response(raw, { status: 200 })
    if (url.endsWith('/stable.json.sig')) return Response.json(sig)
    return new Response('', { status: 404 })
  }
  const arch = macUpdateArch('x64', true)
  expect(arch).toBe('arm64')

  const result = await checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch,
    osVersion: '14.5',
    manual: true,
    request,
    publicKeys: { k1: pair.publicKeyBase64 },
  })
  expect(result).toMatchObject({
    status: 'update-available',
    source: 'v2',
    latestVersion: '2.0.26',
    mandatory: false,
    target: 'darwin-arm64',
    artifact: { url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg' },
  })
})

it('rejects tampered signature and blocks downgrade to unsigned legacy v1 once keys are configured', async () => {
  const { pair, raw, sig } = makeSignedManifest()
  const tampered = Buffer.from(raw.toString('utf8').replace('2.0.26', '2.0.27'), 'utf8')

  await expect(checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    manual: true,
    publicKeys: { k1: pair.publicKeyBase64 },
    request: async url => url.endsWith('.sig') ? Response.json(sig) : new Response(tampered),
  })).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' })

  // When v2 returns 404 and keys are configured, must NOT fall back to unsigned v1.
  let v1Requested = false
  await expect(checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    manual: true,
    publicKeys: { k1: pair.publicKeyBase64 },
    request: async url => {
      if (url.includes('version-stable.json')) v1Requested = true
      return new Response('', { status: 404 })
    },
  })).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  expect(v1Requested).toBe(false)
})

it('falls back to legacy v1 on 404 only when no verification keys are configured yet', async () => {
  const result = await checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    manual: true,
    publicKeys: {},
    request: async url => {
      if (url.includes('/v2/stable.json')) return new Response('', { status: 404 })
      return Response.json({ version: '2.0.26', channel: 'stable', sha256: { macArm64: SHA_A } })
    },
  })
  expect(result).toMatchObject({
    status: 'update-available',
    source: 'v1-legacy',
    latestVersion: '2.0.26',
    artifact: { url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg', sha256: SHA_A },
  })
})

it('enforces minSupportedVersion mandatory floor, OS version gate, allowlist, and deterministic rollout', async () => {
  // 1. minSupportedVersion triggers mandatory even when urgency is normal.
  const floor = makeSignedManifest({ minSupportedVersion: '2.0.26', rollout: { percentage: 0, salt: 's' } })
  const mandatoryRes = await checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '14.0',
    installationId: 'install-1',
    manual: false,
    publicKeys: { k1: floor.pair.publicKeyBase64 },
    request: async url => url.endsWith('.sig') ? Response.json(floor.sig) : new Response(floor.raw),
  })
  expect(mandatoryRes.status).toBe('update-available')
  expect(mandatoryRes.mandatory).toBe(true)

  // 2. Old OS triggers UNSUPPORTED_OS.
  await expect(checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '12.7.5',
    manual: true,
    publicKeys: { k1: floor.pair.publicKeyBase64 },
    request: async url => url.endsWith('.sig') ? Response.json(floor.sig) : new Response(floor.raw),
  })).rejects.toMatchObject({ code: 'UNSUPPORTED_OS', detail: '13.0' })

  // 3. Background non-mandatory rollout defers out-of-bucket installs, while manual check bypasses rollout.
  const partial = makeSignedManifest({ rollout: { percentage: 10, salt: 'rollout-salt' } })
  let outsideId = 'outside-0'
  for (let i = 0; i < 500; i += 1) {
    const candidate = `install-${i}`
    if (rolloutBucket(candidate, 'rollout-salt') >= 10) { outsideId = candidate; break }
  }
  const bg = await checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    installationId: outsideId,
    manual: false,
    publicKeys: { k1: partial.pair.publicKeyBase64 },
    request: async url => url.endsWith('.sig') ? Response.json(partial.sig) : new Response(partial.raw),
  })
  expect(bg.status).toBe('up-to-date')
  expect(bg.deferredByRollout).toBe(true)

  const manual = await checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    installationId: outsideId,
    manual: true,
    publicKeys: { k1: partial.pair.publicKeyBase64 },
    request: async url => url.endsWith('.sig') ? Response.json(partial.sig) : new Response(partial.raw),
  })
  expect(manual.status).toBe('update-available')

  // 4. Rejects artifact host outside allowlist.
  const hostile = makeSignedManifest({
    artifacts: {
      'darwin-arm64': {
        url: 'https://evil.example/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg',
        sha256: SHA_A,
        size: 1024,
      },
    },
  })
  await expect(checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    manual: true,
    publicKeys: { k1: hostile.pair.publicKeyBase64 },
    request: async url => url.endsWith('.sig') ? Response.json(hostile.sig) : new Response(hostile.raw),
  })).rejects.toBeInstanceOf(OmniMuxUpdateError)

  // 5. Rejects invalid UTF-8 bytes in manifest body as MANIFEST_INVALID (not uncaught TypeError).
  await expect(checkOmniMuxManifest({
    currentVersion: '2.0.25',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    manual: true,
    publicKeys: {},
    request: async () => new Response(new Uint8Array([0xff, 0xfe, 0xfd]), { status: 200 }),
  })).rejects.toMatchObject({ code: 'MANIFEST_INVALID' })
})
