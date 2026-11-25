import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import {
  ARGON2_PARAMS,
  HKDF_DOMAIN_FINGERPRINT,
  HKDF_DOMAIN_OSCRYPT,
  HKDF_DOMAIN_PROFILE,
  SEAL_INFO,
  SHARED_BUNDLE_PREFIX,
  VERIFY_CODE_PREFIX,
} from './constants.js'
import { PibrowseError } from './errors.js'

const WORKER_FILE = fileURLToPath(new URL('./argon2-worker.js', import.meta.url))

// Standard ASN.1 DER prefixes for raw 32-byte X25519 keys (RFC 8410).
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

const CHACHA_SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])

function rotl32(v, c) {
  return ((v << c) | (v >>> (32 - c))) >>> 0
}

function quarterRound(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) >>> 0
  s[d] = rotl32(s[d] ^ s[a], 16)
  s[c] = (s[c] + s[d]) >>> 0
  s[b] = rotl32(s[b] ^ s[c], 12)
  s[a] = (s[a] + s[b]) >>> 0
  s[d] = rotl32(s[d] ^ s[a], 8)
  s[c] = (s[c] + s[d]) >>> 0
  s[b] = rotl32(s[b] ^ s[c], 7)
}

/**
 * HChaCha20 key derivation function (draft-irtf-cfrg-xchacha §2.2).
 * @param {Buffer} key32
 * @param {Buffer} nonce16
 * @returns {Buffer} 32-byte subkey
 */
export function hchacha20(key32, nonce16) {
  if (!Buffer.isBuffer(key32) || key32.length !== 32) {
    throw new PibrowseError('invalid-input', 'HChaCha20 key must be 32 bytes')
  }
  if (!Buffer.isBuffer(nonce16) || nonce16.length !== 16) {
    throw new PibrowseError('invalid-input', 'HChaCha20 nonce must be 16 bytes')
  }
  const s = new Uint32Array(16)
  s[0] = CHACHA_SIGMA[0]
  s[1] = CHACHA_SIGMA[1]
  s[2] = CHACHA_SIGMA[2]
  s[3] = CHACHA_SIGMA[3]
  for (let i = 0; i < 8; i += 1) {
    s[4 + i] = key32.readUInt32LE(i * 4)
  }
  for (let i = 0; i < 4; i += 1) {
    s[12 + i] = nonce16.readUInt32LE(i * 4)
  }

  for (let i = 0; i < 10; i += 1) {
    quarterRound(s, 0, 4, 8, 12)
    quarterRound(s, 1, 5, 9, 13)
    quarterRound(s, 2, 6, 10, 14)
    quarterRound(s, 3, 7, 11, 15)
    quarterRound(s, 0, 5, 10, 15)
    quarterRound(s, 1, 6, 11, 12)
    quarterRound(s, 2, 7, 8, 13)
    quarterRound(s, 3, 4, 9, 14)
  }

  const out = Buffer.allocUnsafe(32)
  out.writeUInt32LE(s[0], 0)
  out.writeUInt32LE(s[1], 4)
  out.writeUInt32LE(s[2], 8)
  out.writeUInt32LE(s[3], 12)
  out.writeUInt32LE(s[12], 16)
  out.writeUInt32LE(s[13], 20)
  out.writeUInt32LE(s[14], 24)
  out.writeUInt32LE(s[15], 28)
  s.fill(0)
  return out
}

/**
 * XChaCha20-Poly1305 AEAD encrypt returning `nonce[24] || ciphertext || tag[16]`.
 * Wire-compatible with Rust `chacha20poly1305::XChaCha20Poly1305` in upstream `shared-rs/src/keys.rs`.
 *
 * @param {Buffer} key32
 * @param {Buffer | Uint8Array | string} plaintext
 * @param {{ nonce?: Buffer, aad?: Buffer }} [opts]
 * @returns {Buffer}
 */
export function wrap(key32, plaintext, opts = {}) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(key32)
  if (key.length !== 32) {
    throw new PibrowseError('invalid-input', 'XChaCha20-Poly1305 key must be 32 bytes')
  }
  const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext)
  const nonce24 = opts.nonce ? Buffer.from(opts.nonce) : crypto.randomBytes(24)
  if (nonce24.length !== 24) {
    throw new PibrowseError('invalid-input', 'XChaCha20-Poly1305 nonce must be 24 bytes')
  }
  const subkey = hchacha20(key, nonce24.subarray(0, 16))
  const chachaNonce = Buffer.alloc(12)
  nonce24.copy(chachaNonce, 4, 16, 24)

  const cipher = crypto.createCipheriv('chacha20-poly1305', subkey, chachaNonce, {
    authTagLength: 16,
  })
  if (opts.aad && opts.aad.length > 0) {
    cipher.setAAD(opts.aad)
  }
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  subkey.fill(0)
  return Buffer.concat([nonce24, ct, tag])
}

/**
 * XChaCha20-Poly1305 AEAD decrypt from `nonce[24] || ciphertext || tag[16]`.
 *
 * @param {Buffer} key32
 * @param {Buffer | Uint8Array} blob
 * @param {{ aad?: Buffer }} [opts]
 * @returns {Buffer}
 */
export function unwrap(key32, blob, opts = {}) {
  const key = Buffer.isBuffer(key32) ? key32 : Buffer.from(key32)
  if (key.length !== 32) {
    throw new PibrowseError('invalid-input', 'XChaCha20-Poly1305 key must be 32 bytes')
  }
  const data = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
  if (data.length < 40) {
    throw new PibrowseError('invalid-input', 'Ciphertext too short for XChaCha20-Poly1305')
  }
  const nonce24 = data.subarray(0, 24)
  const tag = data.subarray(data.length - 16)
  const ct = data.subarray(24, data.length - 16)
  const subkey = hchacha20(key, nonce24.subarray(0, 16))
  const chachaNonce = Buffer.alloc(12)
  nonce24.copy(chachaNonce, 4, 16, 24)

  try {
    const decipher = crypto.createDecipheriv('chacha20-poly1305', subkey, chachaNonce, {
      authTagLength: 16,
    })
    if (opts.aad && opts.aad.length > 0) {
      decipher.setAAD(opts.aad)
    }
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch (err) {
    throw new PibrowseError(
      'unauthorized',
      `Decryption failed (wrong key or tampered ciphertext): ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    subkey.fill(0)
  }
}

/**
 * Derive 32-byte User Key (UK) via Argon2id v0x13 (`m=262144 KiB, t=3, p=1`).
 * Prefers Node's native async `crypto.argon2` (Node 24.7+/25) and transparently
 * falls back to `@noble/hashes/argon2` inside a Worker thread on Node 22 so
 * the Host main thread never blocks.
 *
 * @param {string | Buffer} password
 * @param {Buffer | Uint8Array | string} salt
 * @param {{ memoryKiB?: number, iterations?: number, parallelism?: number, dkLen?: number, forceWorker?: boolean }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function deriveUserKey(password, salt, opts = {}) {
  const passBuf = typeof password === 'string' ? Buffer.from(password, 'utf8') : Buffer.from(password)
  const saltBuf = typeof salt === 'string' ? Buffer.from(salt, 'base64') : Buffer.from(salt)
  try {
    if (saltBuf.length < 8) {
      throw new PibrowseError('invalid-input', 'Argon2id salt must be at least 8 bytes')
    }
    const memoryKiB = opts.memoryKiB ?? ARGON2_PARAMS.memoryKiB
    const iterations = opts.iterations ?? ARGON2_PARAMS.iterations
    const parallelism = opts.parallelism ?? ARGON2_PARAMS.parallelism
    const dkLen = opts.dkLen ?? ARGON2_PARAMS.dkLen

    if (!opts.forceWorker && typeof crypto.argon2 === 'function') {
      return await new Promise((resolve, reject) => {
        crypto.argon2(
          'argon2id',
          {
            message: passBuf,
            nonce: saltBuf,
            parallelism,
            tagLength: dkLen,
            memory: memoryKiB,
            passes: iterations,
          },
          (err, derivedKey) => {
            if (err) {
              reject(new PibrowseError('team-error', `Native Argon2id failed: ${err.message}`))
              return
            }
            resolve(Buffer.from(derivedKey))
          },
        )
      })
    }

    return await new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_FILE, {
        workerData: {
          password: passBuf,
          salt: saltBuf,
          memoryKiB,
          iterations,
          parallelism,
          dkLen,
        },
      })
      let settled = false
      worker.once('message', (msg) => {
        if (settled) return
        settled = true
        if (msg?.ok && msg.key) {
          resolve(Buffer.from(msg.key))
        } else {
          reject(new PibrowseError('team-error', `Argon2id worker failed: ${msg?.error || 'unknown error'}`))
        }
      })
      worker.once('error', (err) => {
        if (settled) return
        settled = true
        reject(new PibrowseError('team-error', `Argon2id worker error: ${err.message}`))
      })
      worker.once('exit', (code) => {
        if (settled) return
        settled = true
        reject(
          new PibrowseError(
            'team-error',
            `Argon2id worker exited unexpectedly with code ${code} before returning derived key`,
          ),
        )
      })
    })
  } finally {
    passBuf.fill(0)
  }
}

function x25519PrivateKeyObj(sk32) {
  const sk = Buffer.isBuffer(sk32) ? sk32 : Buffer.from(sk32)
  if (sk.length !== 32) {
    throw new PibrowseError('invalid-input', 'X25519 private key must be 32 bytes')
  }
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, sk]),
    format: 'der',
    type: 'pkcs8',
  })
}

function x25519PublicKeyObj(pk32) {
  const pk = Buffer.isBuffer(pk32) ? pk32 : Buffer.from(pk32)
  if (pk.length !== 32) {
    throw new PibrowseError('invalid-input', 'X25519 public key must be 32 bytes')
  }
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, pk]),
    format: 'der',
    type: 'spki',
  })
}

/**
 * Generate a fresh raw 32-byte X25519 keypair.
 * @returns {{ secretKey: Buffer, publicKey: Buffer }}
 */
export function newKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519')
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' })
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return {
    secretKey: Buffer.from(pkcs8.subarray(pkcs8.length - 32)),
    publicKey: Buffer.from(spki.subarray(spki.length - 32)),
  }
}

/**
 * Compute 32-byte X25519 public key from 32-byte secret key.
 * @param {Buffer | Uint8Array} secretKey32
 * @returns {Buffer}
 */
export function publicFromSecret(secretKey32) {
  const priv = x25519PrivateKeyObj(secretKey32)
  const spki = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' })
  return Buffer.from(spki.subarray(spki.length - 32))
}

function x25519SharedSecret(secretKey32, peerPublicKey32) {
  let shared
  try {
    shared = crypto.diffieHellman({
      privateKey: x25519PrivateKeyObj(secretKey32),
      publicKey: x25519PublicKeyObj(peerPublicKey32),
    })
  } catch (err) {
    throw new PibrowseError(
      'unauthorized',
      `Rejected invalid X25519 peer public key: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  // RFC 7748 §6.1: reject low-order / all-zero shared secret points.
  let nonZero = 0
  for (let i = 0; i < shared.length; i += 1) {
    nonZero |= shared[i]
  }
  if (nonZero === 0) {
    throw new PibrowseError('unauthorized', 'Rejected all-zero X25519 small-subgroup shared secret')
  }
  return shared
}

function hkdfSha256(ikm, salt, info, length) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length))
}

/**
 * Seal a payload to an X25519 recipient public key:
 * `ephPub[32] || XChaCha20-Poly1305(HKDF-SHA256(DH, salt=ephPub||recipientPub, info="fury-seal-v1"), plaintext)`.
 * Matches `shared-rs/src/keys.rs::seal_to`.
 *
 * @param {Buffer | Uint8Array} recipientPublicKey32
 * @param {Buffer | Uint8Array} plaintext
 * @returns {Buffer}
 */
export function sealTo(recipientPublicKey32, plaintext) {
  const recipPub = Buffer.from(recipientPublicKey32)
  const eph = newKeypair()
  let shared = null
  let symKey = null
  try {
    shared = x25519SharedSecret(eph.secretKey, recipPub)
    const salt = Buffer.concat([eph.publicKey, recipPub])
    symKey = hkdfSha256(shared, salt, Buffer.from(SEAL_INFO, 'utf8'), 32)
    const wrapped = wrap(symKey, plaintext)
    return Buffer.concat([eph.publicKey, wrapped])
  } finally {
    eph.secretKey.fill(0)
    if (shared) shared.fill(0)
    if (symKey) symKey.fill(0)
  }
}

/**
 * Open a sealed payload produced by `sealTo`.
 * Matches `shared-rs/src/keys.rs::open_sealed`.
 *
 * @param {Buffer | Uint8Array} recipientSecretKey32
 * @param {Buffer | Uint8Array} blob
 * @returns {Buffer}
 */
export function openSealed(recipientSecretKey32, blob) {
  const data = Buffer.from(blob)
  if (data.length < 32 + 40) {
    throw new PibrowseError('invalid-input', 'Sealed ciphertext is too short')
  }
  const ephPub = data.subarray(0, 32)
  const body = data.subarray(32)
  const recipPub = publicFromSecret(recipientSecretKey32)
  const shared = x25519SharedSecret(recipientSecretKey32, ephPub)
  const salt = Buffer.concat([ephPub, recipPub])
  const symKey = hkdfSha256(shared, salt, Buffer.from(SEAL_INFO, 'utf8'), 32)
  try {
    return unwrap(symKey, body)
  } finally {
    shared.fill(0)
    symKey.fill(0)
  }
}

/**
 * Domain-separated HKDF-SHA256 subkey: `salt = empty`, `info = label + '\0' + id`.
 * Matches `shared-rs/src/keys.rs::subkey`.
 *
 * @param {Buffer | Uint8Array} rootKey32
 * @param {string} label
 * @param {string} id
 * @returns {Buffer}
 */
export function subkey(rootKey32, label, id) {
  const info = Buffer.from(`${label}\0${id}`, 'utf8')
  return hkdfSha256(Buffer.from(rootKey32), Buffer.alloc(0), info, 32)
}

export function profileKey(ork32, profileId) {
  return subkey(ork32, HKDF_DOMAIN_PROFILE, profileId)
}

export function osCryptKey(profileKey32, profileId) {
  return subkey(profileKey32, HKDF_DOMAIN_OSCRYPT, profileId)
}

/**
 * 16-hex-char fingerprint of an oscrypt / cookie key (`HKDF(info="fury-oscrypt-id-v1", len=8)`).
 * @param {Buffer | Uint8Array} key32
 * @returns {string}
 */
export function keyFingerprint(key32) {
  return hkdfSha256(Buffer.from(key32), Buffer.alloc(0), Buffer.from(HKDF_DOMAIN_FINGERPRINT, 'utf8'), 8).toString('hex')
}

/**
 * 8-digit out-of-band public-key verification code (`XXXX-XXXX`).
 * Matches `shared-rs/src/keys.rs::verify_code`:
 * `SHA-256("fury verify code v1\0" || publicKey32)` -> first 8 bytes big-endian u64 % 100_000_000.
 *
 * @param {string | Buffer | Uint8Array} publicKey
 * @returns {string}
 */
export function verifyCode(publicKey) {
  const pk = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : Buffer.from(publicKey)
  if (pk.length !== 32) {
    throw new PibrowseError('invalid-input', 'Public key must be 32 bytes for verifyCode')
  }
  const digest = crypto
    .createHash('sha256')
    .update(Buffer.from(VERIFY_CODE_PREFIX, 'utf8'))
    .update(pk)
    .digest()
  const num = Number(digest.readBigUInt64BE(0) % 100_000_000n)
  const padded = String(num).padStart(8, '0')
  return `${padded.slice(0, 4)}-${padded.slice(4)}`
}

/**
 * Enrol a new member (generate salt + X25519 keypair + wrap private key under UK).
 * Optionally generates a new Org Root Key (ORK) when creating an org.
 *
 * @param {string} password
 * @param {{ createOrgKey?: boolean, kdfOpts?: object }} [opts]
 */
export async function enrol(password, opts = {}) {
  const salt = crypto.randomBytes(16)
  const userKey = await deriveUserKey(password, salt, opts.kdfOpts)
  const kp = newKeypair()
  try {
    const wrappedPrivateKey = wrap(userKey, kp.secretKey)
    const result = {
      kdfSaltB64: salt.toString('base64'),
      publicKeyB64: kp.publicKey.toString('base64'),
      wrappedPrivateKeyB64: wrappedPrivateKey.toString('base64'),
      verifyCode: verifyCode(kp.publicKey),
      secretKey: Buffer.from(kp.secretKey),
      orgKey: null,
      wrappedOrkB64: null,
    }
    if (opts.createOrgKey) {
      const ork = crypto.randomBytes(32)
      result.orgKey = ork
      result.wrappedOrkB64 = sealTo(kp.publicKey, ork).toString('base64')
    }
    return result
  } finally {
    userKey.fill(0)
    kp.secretKey.fill(0)
  }
}

/**
 * Unlock a member's private key and sealed Org Root Key (ORK) during login.
 *
 * @param {{ password: string, kdfSaltB64: string, wrappedPrivateKeyB64: string, wrappedOrkB64?: string | null, kdfOpts?: object }} params
 */
export async function unlockOrgKey(params) {
  const userKey = await deriveUserKey(params.password, Buffer.from(params.kdfSaltB64, 'base64'), params.kdfOpts)
  try {
    const secretKey = unwrap(userKey, Buffer.from(params.wrappedPrivateKeyB64, 'base64'))
    const publicKey = publicFromSecret(secretKey)
    let orgKey = null
    if (params.wrappedOrkB64) {
      orgKey = openSealed(secretKey, Buffer.from(params.wrappedOrkB64, 'base64'))
      if (orgKey.length !== 32) {
        throw new PibrowseError('team-error', 'Unsealed Org Root Key has unexpected byte length')
      }
    }
    return {
      secretKey,
      publicKey,
      publicKeyB64: publicKey.toString('base64'),
      verifyCode: verifyCode(publicKey),
      orgKey,
    }
  } finally {
    userKey.fill(0)
  }
}

/**
 * Seal the Org Root Key (ORK) to another member's X25519 public key for key handover.
 * @param {Buffer} orgKey32
 * @param {string} memberPublicKeyB64
 * @returns {string} base64 sealed blob
 */
export function wrapForMember(orgKey32, memberPublicKeyB64) {
  const pub = Buffer.from(memberPublicKeyB64, 'base64')
  return sealTo(pub, orgKey32).toString('base64')
}

/**
 * Seal proxy credentials JSON under a fresh random DEK, then wrap the DEK under ORK.
 * @param {Buffer} orgKey32
 * @param {Record<string, unknown>} credentialsObj
 */
export function sealProxyCredentials(orgKey32, credentialsObj) {
  const dek = crypto.randomBytes(32)
  try {
    const credentialsEnc = wrap(dek, Buffer.from(JSON.stringify(credentialsObj), 'utf8'))
    const wrappedDek = wrap(orgKey32, dek)
    return {
      wrappedDekB64: wrappedDek.toString('base64'),
      credentialsEncB64: credentialsEnc.toString('base64'),
    }
  } finally {
    dek.fill(0)
  }
}

/**
 * Open proxy credentials encrypted via `sealProxyCredentials`.
 * @param {Buffer} orgKey32
 * @param {string} wrappedDekB64
 * @param {string} credentialsEncB64
 */
export function openProxyCredentials(orgKey32, wrappedDekB64, credentialsEncB64) {
  const dek = unwrap(orgKey32, Buffer.from(wrappedDekB64, 'base64'))
  try {
    const raw = unwrap(dek, Buffer.from(credentialsEncB64, 'base64'))
    return JSON.parse(raw.toString('utf8'))
  } finally {
    dek.fill(0)
  }
}

/**
 * Re-wrap a DEK (or wrapped cookie key) from old ORK to new ORK during org key rotation.
 * @param {Buffer} oldOrk32
 * @param {Buffer} newOrk32
 * @param {string} wrappedKeyB64
 * @returns {string}
 */
export function rewrapDataKey(oldOrk32, newOrk32, wrappedKeyB64) {
  const rawKey = unwrap(oldOrk32, Buffer.from(wrappedKeyB64, 'base64'))
  try {
    return wrap(newOrk32, rawKey).toString('base64')
  } finally {
    rawKey.fill(0)
  }
}

/**
 * Re-wrap a shared bundle key string carrying the `fury:ork1:` prefix during rotation.
 * @param {Buffer} oldOrk32
 * @param {Buffer} newOrk32
 * @param {string} bundleKeyStr
 * @returns {string}
 */
export function rewrapBundleKey(oldOrk32, newOrk32, bundleKeyStr) {
  if (typeof bundleKeyStr !== 'string' || !bundleKeyStr.startsWith(SHARED_BUNDLE_PREFIX)) {
    throw new PibrowseError('invalid-input', `Bundle key must start with "${SHARED_BUNDLE_PREFIX}"`)
  }
  const b64 = bundleKeyStr.slice(SHARED_BUNDLE_PREFIX.length)
  const rewrapped = rewrapDataKey(oldOrk32, newOrk32, b64)
  return `${SHARED_BUNDLE_PREFIX}${rewrapped}`
}

/**
 * Derive hex-encoded `profile_key` and `cookie_key` for `fury-agent` IPC `profile.launch`.
 * When the server returns a `wrapped_cookie_key`, unwrap it under ORK so Chromium's
 * oscrypt key survives across org key rotations without invalidating browser cookies.
 *
 * @param {{ orgKey: Buffer, profileId: string, wrappedCookieKeyB64?: string | null }} params
 */
export function deriveLaunchKeys(params) {
  const pKey = profileKey(params.orgKey, params.profileId)
  let cKey
  if (params.wrappedCookieKeyB64) {
    cKey = unwrap(params.orgKey, Buffer.from(params.wrappedCookieKeyB64, 'base64'))
  } else {
    cKey = osCryptKey(pKey, params.profileId)
  }
  const result = {
    profileKeyHex: pKey.toString('hex'),
    cookieKeyHex: cKey.toString('hex'),
    cookieKeyFingerprint: keyFingerprint(cKey),
  }
  pKey.fill(0)
  cKey.fill(0)
  return result
}

/**
 * Wrap a profile's current cookie key under ORK (used on initial profile upload or rotation).
 * @param {Buffer} orgKey32
 * @param {string} profileId
 * @param {Buffer} [explicitCookieKey]
 * @returns {string} base64 wrapped cookie key
 */
export function wrapCookieKey(orgKey32, profileId, explicitCookieKey) {
  const cKey = explicitCookieKey
    ? Buffer.from(explicitCookieKey)
    : (() => {
        const pKey = profileKey(orgKey32, profileId)
        try {
          return osCryptKey(pKey, profileId)
        } finally {
          pKey.fill(0)
        }
      })()
  try {
    return wrap(orgKey32, cKey).toString('base64')
  } finally {
    cKey.fill(0)
  }
}

export function generateOrgKey() {
  return crypto.randomBytes(32)
}
