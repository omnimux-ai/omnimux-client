import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'
import {
  generateEd25519KeyPair,
  signManifestBytes,
  verifyManifestBytes,
} from './sign-release-manifest.mjs'

const script = fileURLToPath(new URL('./sign-release-manifest.mjs', import.meta.url))
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-sign-manifest-'))
  roots.push(dir)
  return dir
}

test('signs and verifies raw manifest bytes across PEM, PKCS#8 Base64, and 32-byte seed Base64', () => {
  const pair = generateEd25519KeyPair()
  const payload = Buffer.from('{"schemaVersion":2,"version":"2.0.26"}\n', 'utf8')

  for (const material of [pair.privateKeyPem, pair.privateKeyBase64, pair.privateKeySeedBase64]) {
    const envelope = signManifestBytes(payload, { privateKey: material, keyId: 'k1' })
    const result = verifyManifestBytes(payload, envelope, { k1: pair.publicKeyBase64 })
    assert.deepEqual(result, { ok: true, keyId: 'k1' })
  }
})

test('rejects tampered bytes, wrong public keys, unknown keyId, and malformed envelopes', () => {
  const pairA = generateEd25519KeyPair()
  const pairB = generateEd25519KeyPair()
  const payload = Buffer.from('{"schemaVersion":2,"version":"2.0.26"}\n', 'utf8')
  const tampered = Buffer.from('{"schemaVersion":2,"version":"2.0.27"}\n', 'utf8')
  const envelope = signManifestBytes(payload, { privateKey: pairA.privateKeyBase64, keyId: 'k1' })

  assert.equal(verifyManifestBytes(tampered, envelope, { k1: pairA.publicKeyBase64 }).ok, false)
  assert.equal(verifyManifestBytes(payload, envelope, { k1: pairB.publicKeyBase64 }).ok, false)
  assert.equal(verifyManifestBytes(payload, envelope, { k2: pairA.publicKeyBase64 }).ok, false)
  assert.equal(verifyManifestBytes(payload, { ...envelope, algorithm: 'rsa' }, { k1: pairA.publicKeyBase64 }).ok, false)
  assert.equal(verifyManifestBytes(payload, { ...envelope, schemaVersion: 2 }, { k1: pairA.publicKeyBase64 }).ok, false)
  assert.equal(verifyManifestBytes(payload, { ...envelope, signature: Buffer.alloc(32).toString('base64') }, { k1: pairA.publicKeyBase64 }).ok, false)
})

test('CLI keygen -> sign -> verify round-trips and fails on tampering', () => {
  const keygen = spawnSync(process.execPath, [script, 'keygen'], { encoding: 'utf8' })
  assert.equal(keygen.status, 0, keygen.stderr)
  const keys = JSON.parse(keygen.stdout)
  assert.equal(Buffer.from(keys.publicKeyBase64, 'base64').length, 32)

  const dir = tempDir()
  const manifestPath = join(dir, 'stable.json')
  const sigPath = join(dir, 'stable.json.sig')
  writeFileSync(manifestPath, '{"schemaVersion":2,"version":"2.0.26"}\n')

  const signed = spawnSync(process.execPath, [script, 'sign', '--input', manifestPath, '--out', sigPath, '--key-id', 'k2'], {
    encoding: 'utf8',
    env: { ...process.env, OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY: keys.privateKeyBase64 },
  })
  assert.equal(signed.status, 0, signed.stderr)
  const envelope = JSON.parse(readFileSync(sigPath, 'utf8'))
  assert.equal(envelope.keyId, 'k2')

  const verified = spawnSync(process.execPath, [
    script, 'verify', '--input', manifestPath, '--sig', sigPath, '--public-key', keys.publicKeyBase64, '--key-id', 'k2',
  ], { encoding: 'utf8' })
  assert.equal(verified.status, 0, verified.stderr)

  writeFileSync(manifestPath, '{"schemaVersion":2,"version":"2.0.99"}\n')
  const failed = spawnSync(process.execPath, [
    script, 'verify', '--input', manifestPath, '--sig', sigPath, '--public-key', keys.publicKeyBase64, '--key-id', 'k2',
  ], { encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /verification failed/)
})
