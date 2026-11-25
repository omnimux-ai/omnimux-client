import { generateKeyPairSync, sign } from 'node:crypto'
import { expect, it } from 'vitest'
import { parseSignatureEnvelope, verifyManifestSignature } from '../../src/omnimux-updater/signature.ts'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  return {
    publicKeyBase64: spki.subarray(ED25519_SPKI_PREFIX.length).toString('base64'),
    privateKey,
  }
}

it('verifies valid Ed25519 raw-byte signatures and selects keys strictly by keyId', () => {
  const k1 = makeKeyPair()
  const k2 = makeKeyPair()
  const payload = Buffer.from('{"schemaVersion":2,"version":"2.0.26"}\n', 'utf8')
  const envelope = {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: 'k2',
    signature: sign(null, payload, k2.privateKey).toString('base64'),
    signedAt: '2026-11-26T00:00:00.000Z',
  }

  expect(verifyManifestSignature(payload, envelope, { k1: k1.publicKeyBase64, k2: k2.publicKeyBase64 })).toEqual({ ok: true, keyId: 'k2' })
})

it('rejects tampered manifest bytes, unknown keyId, wrong key, prototype keys, and malformed envelopes', () => {
  const k1 = makeKeyPair()
  const k2 = makeKeyPair()
  const payload = Buffer.from('{"schemaVersion":2,"version":"2.0.26"}\n', 'utf8')
  const tampered = Buffer.from('{"schemaVersion":2,"version":"2.0.27"}\n', 'utf8')
  const validSig = sign(null, payload, k1.privateKey).toString('base64')
  const envelope = {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: 'k1',
    signature: validSig,
    signedAt: '2026-11-26T00:00:00.000Z',
  }

  expect(verifyManifestSignature(tampered, envelope, { k1: k1.publicKeyBase64 }).ok).toBe(false)
  expect(verifyManifestSignature(payload, envelope, { k1: k2.publicKeyBase64 }).ok).toBe(false)
  expect(verifyManifestSignature(payload, { ...envelope, keyId: 'k9' }, { k1: k1.publicKeyBase64 }).ok).toBe(false)
  expect(verifyManifestSignature(payload, { ...envelope, keyId: 'toString' }, { k1: k1.publicKeyBase64 }).ok).toBe(false)
  expect(verifyManifestSignature(payload, { ...envelope, algorithm: 'rsa' }, { k1: k1.publicKeyBase64 }).ok).toBe(false)
  expect(verifyManifestSignature(payload, { ...envelope, schemaVersion: 2 }, { k1: k1.publicKeyBase64 }).ok).toBe(false)
  expect(verifyManifestSignature(payload, { ...envelope, signature: Buffer.alloc(32).toString('base64') }, { k1: k1.publicKeyBase64 }).ok).toBe(false)
  expect(() => parseSignatureEnvelope(null)).toThrow()
})
