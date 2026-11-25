import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SHARED_BUNDLE_PREFIX } from './constants.js'
import { createConfigStore } from './config-store.js'
import { resolvePibrowsePaths } from './paths.js'
import { createTeamClient, normaliseServerUrl } from './team-client.js'
import {
  enrol,
  generateOrgKey,
  openProxyCredentials,
  sealProxyCredentials,
  verifyCode,
  wrap,
  wrapCookieKey,
} from './team-crypto.js'

const FAST_KDF = { memoryKiB: 1024, iterations: 1, parallelism: 1, dkLen: 32 }

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      resolve(raw ? JSON.parse(raw) : {})
    })
  })
}

test('normaliseServerUrl strips trailing slash and rejects non-http protocols', () => {
  assert.equal(normaliseServerUrl('https://team.example.com///'), 'https://team.example.com')
  assert.throws(() => normaliseServerUrl('ftp://team.example.com'), (err) => err.code === 'invalid-url')
  assert.throws(() => normaliseServerUrl('not-a-url'), (err) => err.code === 'invalid-url')
})

test('team-client full E2E flow: TOTP login, key handover, ORK rotation, distributed lock + unlock-on-fail, anti-rollback, and upload', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-team-'))
  const adminEnrolled = await enrol('admin-pass', { createOrgKey: true, kdfOpts: FAST_KDF })
  const memberEnrolled = await enrol('member-pass', { createOrgKey: false, kdfOpts: FAST_KDF })
  const sealedProxy = sealProxyCredentials(adminEnrolled.orgKey, { username: 'puser', password: 'proxy-secret-password' })
  const wrappedCookieGen1 = wrapCookieKey(adminEnrolled.orgKey, 'team-prof-1')
  const bundleKeyGen1 = `${SHARED_BUNDLE_PREFIX}${wrap(adminEnrolled.orgKey, generateOrgKey()).toString('base64')}`

  let keyGen = 1
  let forcedLockGen = null
  let forcedLoginGen = null
  let forcedRotateNextGen = null
  let rotatePostCount = 0
  let currentAdminWrappedOrk = adminEnrolled.wrappedOrkB64
  const unlockedTokens = []
  let rotatedPayload = null
  let uploadedProfilePayload = null
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const body = req.method === 'POST' ? await readBody(req) : {}
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return json(200, { status: 'ok', version: '0.5.5' })
    }
    if (req.method === 'POST' && url.pathname === '/v1/auth/login') {
      return json(200, { totp_required: true, challenge_token: 'chal-123' })
    }
    if (req.method === 'POST' && url.pathname === '/v1/auth/login/totp') {
      return json(200, {
        token: 'sess-secret-token-xyz',
        email: 'admin@example.com',
        role: 'admin',
        member_id: 'mem-admin',
        org_id: 'org-1',
        org_name: 'Ops Team',
        key_generation: forcedLoginGen ?? keyGen,
        kdf_salt: adminEnrolled.kdfSaltB64,
        public_key: adminEnrolled.publicKeyB64,
        wrapped_private_key: adminEnrolled.wrappedPrivateKeyB64,
        wrapped_ork: currentAdminWrappedOrk,
      })
    }
    if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
      return json(200, {
        email: 'admin@example.com',
        role: 'admin',
        member_id: 'mem-admin',
        key_generation: keyGen,
        kdf_salt: adminEnrolled.kdfSaltB64,
        public_key: adminEnrolled.publicKeyB64,
        wrapped_private_key: adminEnrolled.wrappedPrivateKeyB64,
        wrapped_ork: currentAdminWrappedOrk,
      })
    }
    if (req.method === 'GET' && url.pathname === '/v1/members') {
      return json(200, {
        members: [
          { id: 'mem-admin', email: 'admin@example.com', role: 'admin', public_key: adminEnrolled.publicKeyB64 },
          { id: 'mem-2', email: 'alice@example.com', role: 'member', public_key: memberEnrolled.publicKeyB64 },
        ],
      })
    }
    if (req.method === 'POST' && url.pathname === '/v1/members/mem-2/key') {
      return json(200, { handed_over: true })
    }
    if (req.method === 'GET' && url.pathname === '/v1/org/rotation-material') {
      return json(200, {
        next_generation: forcedRotateNextGen ?? keyGen + 1,
        members: [
          { id: 'mem-admin', public_key: adminEnrolled.publicKeyB64 },
          { id: 'mem-2', public_key: memberEnrolled.publicKeyB64 },
        ],
        proxies: [{ id: 'px-1', wrapped_dek: sealedProxy.wrappedDekB64 }],
        profiles: [{ id: 'team-prof-1', wrapped_cookie_key: wrappedCookieGen1 }],
        bundles: [{ id: 'b-1', bundle_key: bundleKeyGen1 }],
      })
    }
    if (req.method === 'POST' && url.pathname === '/v1/org/rotate-key') {
      rotatePostCount += 1
      rotatedPayload = body
      keyGen = body.key_generation
      const adminEntry = (body.members || []).find((m) => m.member_id === 'mem-admin')
      if (adminEntry?.wrapped_ork) currentAdminWrappedOrk = adminEntry.wrapped_ork
      return json(200, { rotated: true, key_generation: keyGen })
    }
    if (req.method === 'POST' && url.pathname === '/v1/profiles/team-prof-1/lock') {
      const currentDek = rotatedPayload?.proxies?.[0]?.wrapped_dek || sealedProxy.wrappedDekB64
      const currentCookie = rotatedPayload?.profiles?.[0]?.wrapped_cookie_key || wrappedCookieGen1
      return json(200, {
        lock_token: 'lock-tok-001',
        expires_at: '2026-11-26T00:00:00Z',
        key_generation: forcedLockGen ?? keyGen,
        spec: { id: 'team-prof-1', name: 'US-Store-Main', proxy: { scheme: 'socks5', host: 'proxy.example', port: 1080 } },
        wrapped_dek: currentDek,
        credentials_enc: sealedProxy.credentialsEncB64,
        wrapped_cookie_key: currentCookie,
      })
    }
    if (req.method === 'POST' && url.pathname === '/v1/profiles/team-prof-1/unlock') {
      unlockedTokens.push(body.lock_token)
      return json(200, { unlocked: true })
    }
    if (req.method === 'POST' && url.pathname === '/v1/profiles') {
      uploadedProfilePayload = body
      return json(200, { id: 'team-prof-uploaded', name: body.name })
    }
    if (req.method === 'GET' && url.pathname === '/v1/audit') {
      return json(200, { events: [{ id: 'ev-1', action: 'profile.lock', actor: 'admin@example.com' }] })
    }
    if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
      return json(200, { ok: true })
    }
    return json(404, { error: 'not-found' })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const ipcCalls = []
    let failNextLaunch = false
    const mockIpc = {
      async call(method, params) {
        ipcCalls.push({ method, params })
        if (method === 'profile.launch') {
          if (failNextLaunch) throw new Error('simulated Chromium crash')
          return { pid: 9999 }
        }
        if (method === 'profiles.list') {
          return {
            profiles: [{
              id: 'local-1',
              name: 'Local-Store-1',
              proxy: {
                scheme: 'http',
                host: '1.2.3.4',
                port: 8080,
                username: 'u',
                password: 'local-secret-password',
                url: 'socks5://u:inline-secret-pass@1.2.3.4:1080',
                rotateUrl: 'https://rotate.example/trigger?secret=rot-secret',
              },
            }],
          }
        }
        return { ok: true }
      },
    }

    const team = createTeamClient({
      paths,
      configStore,
      ipcClient: mockIpc,
      kdfOpts: FAST_KDF,
    })

    // 1. Health probe
    const probe = await team.probeServer(baseUrl)
    assert.equal(probe.ok, true)

    // 2. Login without TOTP -> challenges TOTP without leaking challenge_token
    const step1 = await team.login({ serverUrl: baseUrl, email: 'admin@example.com', password: 'admin-pass' })
    assert.equal(step1.totpRequired, true)
    assert.equal('challengeToken' in step1, false)
    assert.equal(JSON.stringify(step1).includes('chal-123'), false)

    // 2b. Invalid key_generation (e.g. -1 or 0) on login must be rejected unconditionally
    forcedLoginGen = -1
    await assert.rejects(
      () =>
        team.login({
          serverUrl: baseUrl,
          email: 'admin@example.com',
          password: 'admin-pass',
          totp: '123456',
        }),
      (err) => err.code === 'invalid-input',
    )
    forcedLoginGen = null

    // 3. Login with TOTP -> unlocks ORK and strips secrets from status
    const step2 = await team.login({
      serverUrl: baseUrl,
      email: 'admin@example.com',
      password: 'admin-pass',
      totp: '123456',
      rememberOrgKey: false,
    })
    assert.equal(step2.ok, true)
    assert.equal(step2.status.hasOrgKey, true)
    assert.equal(step2.status.verifyCode, adminEnrolled.verifyCode)
    assert.equal(JSON.stringify(step2).includes('sess-secret-token-xyz'), false)

    // 4. Key handover requires expectedVerifyCode and validates it strictly
    await assert.rejects(
      () =>
        team.handoverKey({
          memberId: 'mem-2',
          memberPublicKeyB64: memberEnrolled.publicKeyB64,
        }),
      (err) => err.code === 'invalid-input',
    )
    await assert.rejects(
      () =>
        team.handoverKey({
          memberId: 'mem-2',
          memberPublicKeyB64: memberEnrolled.publicKeyB64,
          expectedVerifyCode: '0000-0000',
        }),
      (err) => err.code === 'conflict',
    )
    const handover = await team.handoverKey({
      memberId: 'mem-2',
      memberPublicKeyB64: memberEnrolled.publicKeyB64,
      expectedVerifyCode: verifyCode(memberEnrolled.publicKeyB64),
    })
    assert.equal(handover.ok, true)

    // 5a. Rotation refuses non-advancing generation BEFORE POST /v1/org/rotate-key
    forcedRotateNextGen = 1
    await assert.rejects(
      () => team.rotateOrgKey(),
      (err) => err.code === 'rollback-detected',
    )
    assert.equal(rotatePostCount, 0)
    forcedRotateNextGen = null

    // 5b. Rotate org key (gen 1 -> gen 2) and persist updated wrappedOrkB64
    const rotated = await team.rotateOrgKey()
    assert.equal(rotated.keyGeneration, 2)
    assert.equal(rotatePostCount, 1)
    assert.equal(rotated.rewrappedMembers, 2)
    assert.equal(rotated.rewrappedProxies, 1)
    assert.equal(rotated.rewrappedBundles, 1)

    // 5c. Fresh client hydrating persisted session after rotation unlocks gen-2 ORK via /v1/auth/me
    const restartedTeam = createTeamClient({
      paths,
      configStore,
      ipcClient: mockIpc,
      kdfOpts: FAST_KDF,
    })
    const unlockedAfterRestart = await restartedTeam.unlockSessionWithPassword('admin-pass')
    assert.equal(unlockedAfterRestart.ok, true)
    assert.equal(unlockedAfterRestart.status.hasOrgKey, true)
    assert.equal(unlockedAfterRestart.status.keyGeneration, 2)
    await restartedTeam.dispose()

    // 6. Launch synced profile with distributed lock (gen 2) & verify proxy password decrypted for local agent
    const launched = await team.launchTeamProfile({ profileId: 'team-prof-1' })
    assert.equal(launched.ok, true)
    assert.equal(launched.keyGeneration, 2)
    const launchCall = ipcCalls.find((c) => c.method === 'profile.launch')
    assert.equal(launchCall.params.profile.proxy.password, 'proxy-secret-password')
    assert.equal(launchCall.params.lock_token, 'lock-tok-001')
    assert.equal(launchCall.params.profile_key.length, 64)
    assert.equal(launchCall.params.cookie_key.length, 64)

    // 7. Launch failure must immediately release lock via /unlock
    failNextLaunch = true
    await assert.rejects(() => team.launchTeamProfile({ profileId: 'team-prof-1' }), /simulated Chromium crash/)
    assert.ok(unlockedTokens.includes('lock-tok-001'))
    failNextLaunch = false

    // 8. Anti-rollback: server returning older key_generation 1 after seeing 2 must be rejected & unlocked
    forcedLockGen = 1
    await assert.rejects(
      () => team.launchTeamProfile({ profileId: 'team-prof-1' }),
      (err) => err.code === 'rollback-detected',
    )
    forcedLockGen = null

    // 9. Share local profile encrypts proxy credentials & strips inline URL creds/rotateUrl before sending to server
    const shared = await team.shareLocalProfile({ localProfileId: 'local-1', projectId: 'proj-1' })
    assert.equal(shared.ok, true)
    assert.equal(uploadedProfilePayload.spec.proxy.password, null)
    assert.equal(uploadedProfilePayload.spec.proxy.rotateUrl, null)
    assert.ok(uploadedProfilePayload.wrapped_dek && uploadedProfilePayload.credentials_enc)
    const serializedUpload = JSON.stringify(uploadedProfilePayload)
    assert.equal(serializedUpload.includes('local-secret-password'), false)
    assert.equal(serializedUpload.includes('inline-secret-pass'), false)
    assert.equal(serializedUpload.includes('rot-secret'), false)

    // 10. Audit logs + disconnect cleans up team-session.json
    const audit = await team.listAuditLogs({ limit: 10 })
    assert.equal(audit.events.length, 1)
    await team.disconnect()
    assert.equal((await team.getStatus()).signedIn, false)
    await assert.rejects(() => access(paths.teamSessionFile))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(tmp, { recursive: true, force: true })
  }
})
