import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHARED_BUNDLE_PREFIX } from './constants.js'
import {
  deriveLaunchKeys,
  deriveUserKey,
  enrol,
  generateOrgKey,
  hchacha20,
  keyFingerprint,
  newKeypair,
  openProxyCredentials,
  openSealed,
  osCryptKey,
  profileKey,
  publicFromSecret,
  rewrapBundleKey,
  rewrapDataKey,
  sealProxyCredentials,
  sealTo,
  unlockOrgKey,
  unwrap,
  verifyCode,
  wrap,
  wrapCookieKey,
  wrapForMember,
} from './team-crypto.js'

test('hchacha20 matches RFC draft-irtf-cfrg-xchacha §2.2.1 test vector byte-for-byte', () => {
  const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex')
  const nonce = Buffer.from('000000090000004a0000000031415927', 'hex')
  const expected = '82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc'
  assert.equal(hchacha20(key, nonce).toString('hex'), expected)
})

test('XChaCha20-Poly1305 wrap/unwrap roundtrips and rejects tampered ciphertext or wrong key', () => {
  const key = generateOrgKey()
  const wrongKey = generateOrgKey()
  const pt = Buffer.from('fury-team-secret-payload')
  const blob = wrap(key, pt)
  assert.equal(blob.length, 24 + pt.length + 16)
  assert.deepEqual(unwrap(key, blob), pt)

  const tampered = Buffer.from(blob)
  tampered[tampered.length - 1] ^= 0x01
  assert.throws(() => unwrap(key, tampered), (err) => err.code === 'unauthorized')
  assert.throws(() => unwrap(wrongKey, blob), (err) => err.code === 'unauthorized')
})

test('deriveUserKey native Argon2id and worker_threads @noble/hashes fallback produce identical keys', async () => {
  const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
  const fastOpts = { memoryKiB: 1024, iterations: 1, parallelism: 1, dkLen: 32 }
  const nativeKey = await deriveUserKey('correct-horse-battery-staple', salt, fastOpts)
  const workerKey = await deriveUserKey('correct-horse-battery-staple', salt, {
    ...fastOpts,
    forceWorker: true,
  })
  assert.equal(nativeKey.length, 32)
  assert.equal(workerKey.length, 32)
  assert.equal(nativeKey.toString('hex'), workerKey.toString('hex'))
})

test('X25519 sealTo/openSealed roundtrips and rejects low-order all-zero public key', () => {
  const alice = newKeypair()
  assert.deepEqual(publicFromSecret(alice.secretKey), alice.publicKey)
  const msg = Buffer.from('org-root-key-32-bytes-material!!')
  const sealed = sealTo(alice.publicKey, msg)
  assert.deepEqual(openSealed(alice.secretKey, sealed), msg)

  const lowOrderZeroPub = Buffer.alloc(32, 0)
  assert.throws(() => sealTo(lowOrderZeroPub, msg), (err) => err.code === 'unauthorized')
})

test('full Team E2E key hierarchy: enrol, handover, proxy creds, bundle rewrap, and cookie key survival across ORK rotation', async () => {
  const fastKdf = { memoryKiB: 1024, iterations: 1, parallelism: 1, dkLen: 32 }
  const admin = await enrol('admin-passphrase', { createOrgKey: true, kdfOpts: fastKdf })
  const member = await enrol('member-passphrase', { createOrgKey: false, kdfOpts: fastKdf })

  assert.match(admin.verifyCode, /^\d{4}-\d{4}$/)
  assert.equal(verifyCode(member.publicKeyB64), member.verifyCode)

  // Admin wraps ORK for member after out-of-band verifyCode check
  const wrappedOrkForMember = wrapForMember(admin.orgKey, member.publicKeyB64)
  const memberUnlocked = await unlockOrgKey({
    password: 'member-passphrase',
    kdfSaltB64: member.kdfSaltB64,
    wrappedPrivateKeyB64: member.wrappedPrivateKeyB64,
    wrappedOrkB64: wrappedOrkForMember,
    kdfOpts: fastKdf,
  })
  assert.deepEqual(memberUnlocked.orgKey, admin.orgKey)

  // Proxy credentials sealed under DEK + ORK
  const sealedProxy = sealProxyCredentials(admin.orgKey, { username: 'u1', password: 'secret-proxy-password' })
  const openedProxy = openProxyCredentials(memberUnlocked.orgKey, sealedProxy.wrappedDekB64, sealedProxy.credentialsEncB64)
  assert.equal(openedProxy.password, 'secret-proxy-password')

  // Key derivation and ORK rotation preserving cookie_key so browser cookies stay valid
  const profileId = 'prof-uuid-001'
  const gen1Launch = deriveLaunchKeys({ orgKey: admin.orgKey, profileId })
  assert.equal(gen1Launch.profileKeyHex, profileKey(admin.orgKey, profileId).toString('hex'))
  assert.equal(gen1Launch.cookieKeyHex, osCryptKey(profileKey(admin.orgKey, profileId), profileId).toString('hex'))
  assert.match(keyFingerprint(Buffer.from(gen1Launch.cookieKeyHex, 'hex')), /^[a-f0-9]{16}$/)

  const wrappedCookieGen1 = wrapCookieKey(admin.orgKey, profileId)
  const bundleKeyGen1 = `${SHARED_BUNDLE_PREFIX}${wrap(admin.orgKey, generateOrgKey()).toString('base64')}`

  const newOrk = generateOrgKey()
  const wrappedCookieGen2 = rewrapDataKey(admin.orgKey, newOrk, wrappedCookieGen1)
  const rewrappedDek = rewrapDataKey(admin.orgKey, newOrk, sealedProxy.wrappedDekB64)
  const rewrappedBundle = rewrapBundleKey(admin.orgKey, newOrk, bundleKeyGen1)
  assert.ok(rewrappedBundle.startsWith(SHARED_BUNDLE_PREFIX))

  const gen2Launch = deriveLaunchKeys({
    orgKey: newOrk,
    profileId,
    wrappedCookieKeyB64: wrappedCookieGen2,
  })
  assert.notEqual(gen2Launch.profileKeyHex, gen1Launch.profileKeyHex, 'profile key rotates with ORK')
  assert.equal(gen2Launch.cookieKeyHex, gen1Launch.cookieKeyHex, 'cookie key must stay identical across ORK rotation')

  const reopenedAfterRotate = openProxyCredentials(newOrk, rewrappedDek, sealedProxy.credentialsEncB64)
  assert.equal(reopenedAfterRotate.password, 'secret-proxy-password')
})
