/** Zero-dependency Ed25519 signature verification for OmniMux Update Manifest v2. */

import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { OmniMuxSignatureEnvelope } from './types.ts'

/** Fixed ASN.1 SPKI DER prefix for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/u
const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u

function decodeStrictBase64(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(value)) {
    throw new Error(`${label} must be valid canonical Base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new Error(`${label} is not canonical Base64`)
  }
  return bytes
}

export function importEd25519PublicKey(publicKeyBase64: string): KeyObject {
  const raw = decodeStrictBase64(publicKeyBase64.trim(), 'Ed25519 public key')
  if (raw.length !== 32) {
    throw new Error(`Ed25519 public key must decode to 32 bytes (received ${String(raw.length)})`)
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

export function parseSignatureEnvelope(value: unknown): OmniMuxSignatureEnvelope & { readonly signatureBytes: Buffer } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('signature envelope must be a JSON object')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new Error(`unsupported signature envelope schemaVersion: ${String(record.schemaVersion)}`)
  }
  if (record.algorithm !== 'ed25519') {
    throw new Error(`unsupported signature algorithm: ${String(record.algorithm)}`)
  }
  if (typeof record.keyId !== 'string' || !KEY_ID_PATTERN.test(record.keyId)) {
    throw new Error(`invalid signature keyId: ${String(record.keyId)}`)
  }
  const signatureBytes = decodeStrictBase64(record.signature, 'signature')
  if (signatureBytes.length !== 64) {
    throw new Error(`Ed25519 signature must decode to 64 bytes (received ${String(signatureBytes.length)})`)
  }
  if (typeof record.signedAt !== 'string' || Number.isNaN(Date.parse(record.signedAt))) {
    throw new Error('signature envelope signedAt must be a valid ISO timestamp')
  }
  return {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: record.keyId,
    signature: record.signature as string,
    signedAt: record.signedAt,
    signatureBytes,
  }
}

export type SignatureVerificationResult =
  | { readonly ok: true; readonly keyId: string }
  | { readonly ok: false; readonly reason: string }

/** Verify raw UTF-8 manifest bytes against an Ed25519 signature envelope and trusted keyring. */
export function verifyManifestSignature(
  rawBytes: Uint8Array,
  envelopeInput: unknown,
  publicKeys: Readonly<Record<string, string>>,
): SignatureVerificationResult {
  let envelope: OmniMuxSignatureEnvelope & { readonly signatureBytes: Buffer }
  try {
    envelope = parseSignatureEnvelope(envelopeInput)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  const publicKeyBase64 = Object.hasOwn(publicKeys, envelope.keyId) ? publicKeys[envelope.keyId] : undefined
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.trim().length === 0) {
    return { ok: false, reason: `unknown signing keyId ${JSON.stringify(envelope.keyId)}` }
  }
  try {
    const keyObject = importEd25519PublicKey(publicKeyBase64)
    const valid = verify(null, Buffer.from(rawBytes), keyObject, envelope.signatureBytes)
    return valid ? { ok: true, keyId: envelope.keyId } : { ok: false, reason: 'Ed25519 signature mismatch' }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
