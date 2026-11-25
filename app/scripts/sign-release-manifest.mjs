#!/usr/bin/env node
/**
 * Ed25519 signing and verification for OmniMux desktop update manifests (v2).
 *
 * Signs the exact raw UTF-8 bytes of `api/desktop/v2/<channel>.json` and writes
 * a sibling JSON envelope `api/desktop/v2/<channel>.json.sig`.
 *
 * Public keys are exchanged as raw 32-byte Base64 strings (converted to SPKI DER
 * at runtime) so public key constants stay compact and do not carry PEM headers.
 * Private keys are read exclusively from `OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY`
 * (accepting PEM, PKCS#8 DER Base64, or raw 32-byte Ed25519 seed Base64) and are
 * never accepted as CLI arguments.
 *
 * Usage:
 *   node scripts/sign-release-manifest.mjs keygen
 *   OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY=... node scripts/sign-release-manifest.mjs sign \
 *     --input ./release-assets/api/desktop/v2/stable.json \
 *     --out ./release-assets/api/desktop/v2/stable.json.sig \
 *     --key-id k1
 *   node scripts/sign-release-manifest.mjs verify \
 *     --input ./release-assets/api/desktop/v2/stable.json \
 *     --sig ./release-assets/api/desktop/v2/stable.json.sig \
 *     --public-key <base64-32-bytes>
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, sign, verify } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fixed ASN.1 SPKI DER prefix for a 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
/** Fixed ASN.1 PKCS#8 DER prefix for a 32-byte Ed25519 private seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/u
const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u

function decodeStrictBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(value)) {
    throw new Error(`${label} must be valid canonical Base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new Error(`${label} is not canonical Base64`)
  }
  return bytes
}

/** Generate a fresh Ed25519 key pair for signing OmniMux release manifests. */
export function generateEd25519KeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  if (!spkiDer.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX) || spkiDer.length !== 44) {
    throw new Error('unexpected Ed25519 SPKI DER length')
  }
  const pkcs8Der = privateKey.export({ type: 'pkcs8', format: 'der' })
  if (!pkcs8Der.subarray(0, ED25519_PKCS8_PREFIX.length).equals(ED25519_PKCS8_PREFIX) || pkcs8Der.length !== 48) {
    throw new Error('unexpected Ed25519 PKCS#8 DER length')
  }
  return {
    publicKeyBase64: spkiDer.subarray(ED25519_SPKI_PREFIX.length).toString('base64'),
    privateKeyBase64: pkcs8Der.toString('base64'),
    privateKeySeedBase64: pkcs8Der.subarray(ED25519_PKCS8_PREFIX.length).toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

/** Import a raw 32-byte Base64 Ed25519 public key into a Node KeyObject. */
export function importEd25519PublicKey(publicKeyBase64) {
  const raw = decodeStrictBase64(publicKeyBase64.trim(), 'Ed25519 public key')
  if (raw.length !== 32) {
    throw new Error(`Ed25519 public key must decode to 32 bytes (received ${String(raw.length)})`)
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

/**
 * Import an Ed25519 private key from PEM, PKCS#8 DER Base64 (48 bytes),
 * or raw 32-byte seed Base64.
 */
export function importEd25519PrivateKey(material) {
  if (typeof material !== 'string' || material.trim().length === 0) {
    throw new Error('OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY is required for manifest signing')
  }
  const trimmed = material.trim()
  let keyObject
  if (trimmed.startsWith('-----BEGIN')) {
    keyObject = createPrivateKey(trimmed)
  } else {
    const compact = trimmed.replace(/\s+/gu, '')
    const bytes = decodeStrictBase64(compact, 'Ed25519 private key')
    if (bytes.length === 32) {
      const der = Buffer.concat([ED25519_PKCS8_PREFIX, bytes])
      keyObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    } else if (bytes.length === 48) {
      keyObject = createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' })
    } else {
      throw new Error(`Ed25519 private key must be PEM, 48-byte PKCS#8 DER Base64, or 32-byte seed Base64 (received ${String(bytes.length)} bytes)`)
    }
  }
  if (keyObject.asymmetricKeyType !== 'ed25519') {
    throw new Error(`expected an ed25519 private key, received ${String(keyObject.asymmetricKeyType)}`)
  }
  return keyObject
}

/** Validate and normalize a parsed signature envelope JSON object. */
export function parseSignatureEnvelope(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('signature envelope must be a JSON object')
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported signature envelope schemaVersion: ${String(value.schemaVersion)}`)
  }
  if (value.algorithm !== 'ed25519') {
    throw new Error(`unsupported signature algorithm: ${String(value.algorithm)}`)
  }
  if (typeof value.keyId !== 'string' || !KEY_ID_PATTERN.test(value.keyId)) {
    throw new Error(`invalid signature keyId: ${String(value.keyId)}`)
  }
  const sigBytes = decodeStrictBase64(value.signature, 'signature')
  if (sigBytes.length !== 64) {
    throw new Error(`Ed25519 signature must decode to 64 bytes (received ${String(sigBytes.length)})`)
  }
  if (typeof value.signedAt !== 'string' || Number.isNaN(Date.parse(value.signedAt))) {
    throw new Error('signature envelope signedAt must be a valid ISO timestamp')
  }
  return {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId: value.keyId,
    signature: value.signature,
    signedAt: value.signedAt,
    signatureBytes: sigBytes,
  }
}

/** Sign raw manifest bytes and return the serializable signature envelope. */
export function signManifestBytes(rawBytes, { privateKey, keyId = 'k1', signedAt = new Date().toISOString() }) {
  if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`invalid signing keyId: ${JSON.stringify(keyId)}`)
  }
  const keyObject = privateKey instanceof KeyObject ? privateKey : importEd25519PrivateKey(privateKey)
  if (keyObject.type !== 'private' || keyObject.asymmetricKeyType !== 'ed25519') {
    throw new Error(`expected an ed25519 private key, received ${String(keyObject.type)}/${String(keyObject.asymmetricKeyType)}`)
  }
  const payload = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  const signature = sign(null, payload, keyObject).toString('base64')
  return {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId,
    signature,
    signedAt,
  }
}

/**
 * Verify raw manifest bytes against a signature envelope and either a single
 * public key Base64 string or a `{ [keyId]: publicKeyBase64 }` keyring.
 */
export function verifyManifestBytes(rawBytes, envelopeInput, publicKeys) {
  let envelope
  try {
    envelope = parseSignatureEnvelope(envelopeInput)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  let publicKeyBase64
  if (typeof publicKeys === 'string') {
    publicKeyBase64 = publicKeys
  } else if (typeof publicKeys === 'object' && publicKeys !== null && Object.hasOwn(publicKeys, envelope.keyId)) {
    publicKeyBase64 = publicKeys[envelope.keyId]
  }
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.trim().length === 0) {
    return { ok: false, reason: `unknown signing keyId ${JSON.stringify(envelope.keyId)}` }
  }
  try {
    const keyObject = importEd25519PublicKey(publicKeyBase64)
    const payload = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
    const valid = verify(null, payload, keyObject, envelope.signatureBytes)
    return valid ? { ok: true, keyId: envelope.keyId } : { ok: false, reason: 'Ed25519 signature verification failed' }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'keygen') {
    const pair = generateEd25519KeyPair()
    process.stdout.write(`${JSON.stringify({
      algorithm: 'ed25519',
      publicKeyBase64: pair.publicKeyBase64,
      privateKeyBase64: pair.privateKeyBase64,
    }, null, 2)}\n`)
    return
  }

  if (command === 'sign') {
    const input = argValue(args, '--input')
    if (!input) throw new Error('--input is required')
    const inputPath = resolve(input)
    const outPath = resolve(argValue(args, '--out') ?? `${inputPath}.sig`)
    const keyId = argValue(args, '--key-id') ?? process.env.OMNIMUX_UPDATE_SIGNING_KEY_ID ?? 'k1'
    const privateKey = process.env.OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY
    const raw = readFileSync(inputPath)
    const envelope = signManifestBytes(raw, { privateKey, keyId })
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`)
    process.stdout.write(`signed ${inputPath} -> ${outPath} (keyId=${envelope.keyId})\n`)
    return
  }

  if (command === 'verify') {
    const input = argValue(args, '--input')
    const sig = argValue(args, '--sig')
    const publicKey = argValue(args, '--public-key') ?? process.env.OMNIMUX_UPDATE_PUBLIC_KEY
    const expectedKeyId = argValue(args, '--key-id')
    if (!input || !sig || !publicKey) {
      throw new Error('--input, --sig, and --public-key (or OMNIMUX_UPDATE_PUBLIC_KEY) are required')
    }
    const raw = readFileSync(resolve(input))
    const envelope = JSON.parse(readFileSync(resolve(sig), 'utf8'))
    const keyMap = expectedKeyId ? { [expectedKeyId]: publicKey } : publicKey
    const verdict = verifyManifestBytes(raw, envelope, keyMap)
    if (!verdict.ok) {
      throw new Error(`manifest signature verification failed: ${verdict.reason}`)
    }
    process.stdout.write(`verified ${resolve(input)} (keyId=${verdict.keyId})\n`)
    return
  }

  throw new Error('usage: sign-release-manifest.mjs <keygen|sign|verify> [options]')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
