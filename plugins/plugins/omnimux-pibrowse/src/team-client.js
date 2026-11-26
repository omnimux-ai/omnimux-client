import { readFile, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { PibrowseError, normalizeCoreLaunchError } from './errors.js'
import { writeJsonAtomic } from './config-store.js'
import { redactAny, redactLogLine, redactUrlCredentials } from './redact.js'
import {
  deriveLaunchKeys,
  enrol,
  generateOrgKey,
  openProxyCredentials,
  rewrapBundleKey,
  rewrapDataKey,
  sealProxyCredentials,
  unlockOrgKey,
  verifyCode,
  wrapCookieKey,
  wrapForMember,
} from './team-crypto.js'

/**
 * Normalize and validate a Team Server base URL (strip trailing slashes; require http/https).
 * @param {unknown} raw
 * @returns {string}
 */
export function normaliseServerUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PibrowseError('invalid-url', 'Team Server URL is required')
  }
  let parsed
  try {
    parsed = new URL(raw.trim())
  } catch (err) {
    throw new PibrowseError('invalid-url', `Invalid Team Server URL: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PibrowseError('invalid-url', 'Team Server URL must use http:// or https://')
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

/**
 * Self-hosted PiBrowse Team Server client (Phase 3 E2E encrypted sync).
 *
 * Security invariants:
 * - Session tokens, private keys, and Org Root Key (ORK) stay inside Host memory
 *   (or `0600` local `team-session.json` when user opts into remembering session/ORK).
 * - Never returned to UI HTTP responses or Agent tool outputs.
 * - Distributed lock failures or launch failures immediately attempt `/unlock`.
 * - Enforces monotonic `key_generation` anti-rollback per server URL.
 *
 * @param {{
 *   paths: ReturnType<import('./paths.js').resolvePibrowsePaths>,
 *   configStore: ReturnType<import('./config-store.js').createConfigStore>,
 *   ipcClient: ReturnType<import('./ipc-client.js').createIpcClient>,
 *   fetchImpl?: typeof fetch,
 *   kdfOpts?: object,
 *   logger?: { warn?: Function, info?: Function },
 * }} opts
 */
export function createTeamClient(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  /** @type {{ serverUrl: string | null, token: string | null, email: string | null, role: string | null, memberId: string | null, orgId: string | null, orgName: string | null, keyGeneration: number | null, publicKeyB64: string | null, verifyCode: string | null, secretKey: Buffer | null, orgKey: Buffer | null, kdfSaltB64: string | null, wrappedPrivateKeyB64: string | null, wrappedOrkB64: string | null }} */
  let session = {
    serverUrl: null,
    token: null,
    email: null,
    role: null,
    memberId: null,
    orgId: null,
    orgName: null,
    keyGeneration: null,
    publicKeyB64: null,
    verifyCode: null,
    secretKey: null,
    orgKey: null,
    kdfSaltB64: null,
    wrappedPrivateKeyB64: null,
    wrappedOrkB64: null,
  }
  let hydrated = false
  const activeLocks = new Map() // profileId -> { lockToken, expiresAt, serverUrl }

  function clearSecrets() {
    if (session.secretKey) session.secretKey.fill(0)
    if (session.orgKey) session.orgKey.fill(0)
    session = {
      serverUrl: null,
      token: null,
      email: null,
      role: null,
      memberId: null,
      orgId: null,
      orgName: null,
      keyGeneration: null,
      publicKeyB64: null,
      verifyCode: null,
      secretKey: null,
      orgKey: null,
      kdfSaltB64: null,
      wrappedPrivateKeyB64: null,
      wrappedOrkB64: null,
    }
    activeLocks.clear()
  }

  async function hydrateFromDisk() {
    if (hydrated) return
    hydrated = true
    let raw
    try {
      raw = await readFile(opts.paths.teamSessionFile, 'utf8')
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return
      }
      opts.logger?.warn?.('omnimux-pibrowse: failed reading team-session.json', {
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || !parsed.serverUrl || !parsed.token) return
      const cfg = await opts.configStore.load()
      session = {
        ...session,
        serverUrl: parsed.serverUrl,
        token: parsed.token,
        email: parsed.email || null,
        role: parsed.role || null,
        memberId: parsed.memberId || null,
        orgId: parsed.orgId || null,
        orgName: parsed.orgName || null,
        keyGeneration: typeof parsed.keyGeneration === 'number' ? parsed.keyGeneration : null,
        publicKeyB64: parsed.publicKeyB64 || null,
        verifyCode: parsed.verifyCode || (parsed.publicKeyB64 ? verifyCode(parsed.publicKeyB64) : null),
        kdfSaltB64: parsed.kdfSaltB64 || null,
        wrappedPrivateKeyB64: parsed.wrappedPrivateKeyB64 || null,
        wrappedOrkB64: parsed.wrappedOrkB64 || null,
        orgKey: cfg.rememberOrgKey && typeof parsed.orgKeyB64 === 'string'
          ? Buffer.from(parsed.orgKeyB64, 'base64')
          : null,
      }
    } catch (err) {
      opts.logger?.warn?.('omnimux-pibrowse: corrupt team-session.json ignored', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function persistSession(rememberOrgKey) {
    if (!session.serverUrl || !session.token) return
    const payload = {
      version: 1,
      serverUrl: session.serverUrl,
      token: session.token,
      email: session.email,
      role: session.role,
      memberId: session.memberId,
      orgId: session.orgId,
      orgName: session.orgName,
      keyGeneration: session.keyGeneration,
      publicKeyB64: session.publicKeyB64,
      verifyCode: session.verifyCode,
      kdfSaltB64: session.kdfSaltB64,
      wrappedPrivateKeyB64: session.wrappedPrivateKeyB64,
      wrappedOrkB64: session.wrappedOrkB64,
      ...(rememberOrgKey && session.orgKey ? { orgKeyB64: session.orgKey.toString('base64') } : {}),
    }
    await writeJsonAtomic(opts.paths.teamSessionFile, payload)
  }

  async function apiRequest(serverUrl, method, path, body, authToken) {
    if (typeof fetchImpl !== 'function') {
      throw new PibrowseError('team-offline', 'Global fetch is unavailable')
    }
    const url = `${normaliseServerUrl(serverUrl)}${path}`
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (authToken) headers.Authorization = `Bearer ${authToken}`

    let res
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (err) {
      throw new PibrowseError(
        'team-offline',
        `Cannot reach Team Server at ${serverUrl}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch (err) {
        if (!res.ok) {
          throw new PibrowseError('team-error', `Team Server HTTP ${res.status}: ${text.slice(0, 200)}`, {
            status: res.status,
          })
        }
        throw new PibrowseError('team-error', `Invalid JSON from Team Server: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || `Team Server responded with HTTP ${res.status}`
      const code =
        res.status === 401
          ? data?.totp_required ? 'totp-required' : 'unauthorized'
          : res.status === 403
            ? 'forbidden'
            : res.status === 404
              ? 'not-found'
              : res.status === 409
                ? 'profile-locked'
                : 'team-error'
      throw new PibrowseError(code, String(msg), {
        status: res.status,
        ...(data && typeof data === 'object' ? redactAny(data) : {}),
      })
    }
    return data
  }

  function requireSignedIn() {
    if (!session.serverUrl || !session.token) {
      throw new PibrowseError('unauthorized', 'Not signed in to a PiBrowse Team Server')
    }
  }

  function requireOrgKey() {
    requireSignedIn()
    if (!session.orgKey) {
      throw new PibrowseError(
        'team-locked',
        'Organization Root Key (ORK) is locked or pending admin handover. Unlock with password or complete key handover.',
      )
    }
  }

  async function getStatus() {
    await hydrateFromDisk()
    const cfg = await opts.configStore.load()
    return {
      configuredServerUrl: session.serverUrl || cfg.teamServerUrl || null,
      signedIn: Boolean(session.serverUrl && session.token),
      hasOrgKey: Boolean(session.orgKey),
      pendingHandover: Boolean(session.serverUrl && session.token && !session.orgKey && !session.wrappedOrkB64),
      email: session.email,
      role: session.role,
      memberId: session.memberId,
      orgId: session.orgId,
      orgName: session.orgName,
      keyGeneration: session.keyGeneration,
      verifyCode: session.verifyCode,
      rememberOrgKey: Boolean(cfg.rememberOrgKey),
      activeLocks: [...activeLocks.entries()].map(([profileId, info]) => ({
        profileId,
        expiresAt: info.expiresAt,
      })),
    }
  }

  async function probeServer(serverUrl) {
    const base = normaliseServerUrl(serverUrl)
    const info = await apiRequest(base, 'GET', '/v1/health')
    return {
      ok: true,
      serverUrl: base,
      health: redactAny(info),
    }
  }

  async function login({ serverUrl, email, password, totp, rememberOrgKey }) {
    await hydrateFromDisk()
    const base = normaliseServerUrl(serverUrl || (await opts.configStore.load()).teamServerUrl)
    if (!email || !password) {
      throw new PibrowseError('invalid-input', 'Email and password are required')
    }

    const res = await apiRequest(base, 'POST', '/v1/auth/login', {
      email: String(email).trim(),
      password: String(password),
      ...(totp ? { totp: String(totp).trim() } : {}),
    })

    if (res?.totp_required && res?.challenge_token) {
      if (!totp) {
        return {
          ok: false,
          totpRequired: true,
          message: 'TOTP verification code is required',
        }
      }
      const totpRes = await apiRequest(base, 'POST', '/v1/auth/login/totp', {
        challenge_token: res.challenge_token,
        code: String(totp).trim(),
      })
      return finishLogin(base, totpRes, password, rememberOrgKey)
    }

    return finishLogin(base, res, password, rememberOrgKey)
  }

  async function finishLogin(base, payload, password, rememberOrgKey) {
    const token = payload?.token || payload?.session_token
    if (!token) {
      throw new PibrowseError('team-error', 'Team Server login response omitted session token')
    }
    const rawKeyGen = payload.key_generation ?? payload.org?.key_generation ?? 1
    const keyGen = Number(rawKeyGen)
    await opts.configStore.assertAndRecordOrkGeneration(base, keyGen)

    let unlocked = null
    if (payload.kdf_salt && payload.wrapped_private_key) {
      unlocked = await unlockOrgKey({
        password,
        kdfSaltB64: payload.kdf_salt,
        wrappedPrivateKeyB64: payload.wrapped_private_key,
        wrappedOrkB64: payload.wrapped_ork || null,
        kdfOpts: opts.kdfOpts,
      })
    }

    clearSecrets()
    session = {
      serverUrl: base,
      token,
      email: payload.email || payload.member?.email || null,
      role: payload.role || payload.member?.role || 'member',
      memberId: payload.member_id || payload.member?.id || null,
      orgId: payload.org_id || payload.org?.id || null,
      orgName: payload.org_name || payload.org?.name || null,
      keyGeneration: keyGen,
      publicKeyB64: unlocked?.publicKeyB64 || payload.public_key || null,
      verifyCode: unlocked?.verifyCode || (payload.public_key ? verifyCode(payload.public_key) : null),
      secretKey: unlocked?.secretKey || null,
      orgKey: unlocked?.orgKey || null,
      kdfSaltB64: payload.kdf_salt || null,
      wrappedPrivateKeyB64: payload.wrapped_private_key || null,
      wrappedOrkB64: payload.wrapped_ork || null,
    }

    const remember = rememberOrgKey !== undefined
      ? Boolean(rememberOrgKey)
      : Boolean((await opts.configStore.load()).rememberOrgKey)
    await opts.configStore.update({
      teamServerUrl: base,
      rememberOrgKey: remember,
    })
    await persistSession(remember)
    return {
      ok: true,
      status: await getStatus(),
    }
  }

  async function signupWithInvite({ serverUrl, inviteToken, email, password, name }) {
    const base = normaliseServerUrl(serverUrl)
    if (!inviteToken || !email || !password) {
      throw new PibrowseError('invalid-input', 'inviteToken, email, and password are required')
    }
    const enrolled = await enrol(password, { createOrgKey: false, kdfOpts: opts.kdfOpts })
    try {
      const res = await apiRequest(base, 'POST', '/v1/auth/signup', {
        invite_token: String(inviteToken).trim(),
        email: String(email).trim(),
        password: String(password),
        ...(name ? { name: String(name).trim() } : {}),
        kdf_salt: enrolled.kdfSaltB64,
        public_key: enrolled.publicKeyB64,
        wrapped_private_key: enrolled.wrappedPrivateKeyB64,
      })
      clearSecrets()
      session = {
        serverUrl: base,
        token: res?.token || res?.session_token || null,
        email: String(email).trim(),
        role: res?.role || 'member',
        memberId: res?.member_id || res?.member?.id || null,
        orgId: res?.org_id || res?.org?.id || null,
        orgName: res?.org_name || res?.org?.name || null,
        keyGeneration: Number(res?.key_generation || 1),
        publicKeyB64: enrolled.publicKeyB64,
        verifyCode: enrolled.verifyCode,
        secretKey: Buffer.from(enrolled.secretKey),
        orgKey: null,
        kdfSaltB64: enrolled.kdfSaltB64,
        wrappedPrivateKeyB64: enrolled.wrappedPrivateKeyB64,
        wrappedOrkB64: null,
      }
      await opts.configStore.update({ teamServerUrl: base })
      if (session.token) await persistSession(false)
      return {
        ok: true,
        verifyCode: enrolled.verifyCode,
        status: await getStatus(),
      }
    } finally {
      enrolled.secretKey.fill(0)
    }
  }

  async function unlockSessionWithPassword(password) {
    await hydrateFromDisk()
    requireSignedIn()
    try {
      const me = await apiRequest(session.serverUrl, 'GET', '/v1/auth/me', undefined, session.token)
      if (me && typeof me === 'object') {
        session.kdfSaltB64 = me.kdf_salt || session.kdfSaltB64
        session.wrappedPrivateKeyB64 = me.wrapped_private_key || session.wrappedPrivateKeyB64
        if (me.wrapped_ork !== undefined) {
          session.wrappedOrkB64 = me.wrapped_ork
        }
        const meRawKeyGen = me.key_generation ?? me.org?.key_generation
        if (meRawKeyGen !== undefined && meRawKeyGen !== null) {
          const meKeyGen = Number(meRawKeyGen)
          await opts.configStore.assertAndRecordOrkGeneration(session.serverUrl, meKeyGen)
          session.keyGeneration = meKeyGen
        }
      }
    } catch (err) {
      if (
        err instanceof PibrowseError &&
        (err.code === 'unauthorized' || err.code === 'forbidden' || err.code === 'rollback-detected' || err.code === 'invalid-input')
      ) {
        throw err
      }
      opts.logger?.warn?.('omnimux-pibrowse: /v1/auth/me refresh failed during unlock, falling back to cached key material', {
        error: redactLogLine(err instanceof Error ? err.message : String(err)),
      })
    }
    if (!session.kdfSaltB64 || !session.wrappedPrivateKeyB64) {
      throw new PibrowseError('team-error', 'Account key material is unavailable from server')
    }
    const unlocked = await unlockOrgKey({
      password,
      kdfSaltB64: session.kdfSaltB64,
      wrappedPrivateKeyB64: session.wrappedPrivateKeyB64,
      wrappedOrkB64: session.wrappedOrkB64,
      kdfOpts: opts.kdfOpts,
    })
    if (session.secretKey) session.secretKey.fill(0)
    if (session.orgKey) session.orgKey.fill(0)
    session.secretKey = unlocked.secretKey
    session.orgKey = unlocked.orgKey
    session.publicKeyB64 = unlocked.publicKeyB64
    session.verifyCode = unlocked.verifyCode
    const cfg = await opts.configStore.load()
    await persistSession(Boolean(cfg.rememberOrgKey))
    return { ok: true, status: await getStatus() }
  }

  async function disconnect() {
    await hydrateFromDisk()
    if (session.serverUrl && session.token) {
      await apiRequest(session.serverUrl, 'POST', '/v1/auth/logout', {}, session.token).catch((err) => {
        opts.logger?.warn?.('omnimux-pibrowse: team logout request failed during disconnect', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    clearSecrets()
    await rm(opts.paths.teamSessionFile, { force: true }).catch((err) => {
      opts.logger?.warn?.('omnimux-pibrowse: failed removing team-session.json', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
    return { ok: true, status: await getStatus() }
  }

  async function listProjects() {
    await hydrateFromDisk()
    requireSignedIn()
    const data = await apiRequest(session.serverUrl, 'GET', '/v1/projects', undefined, session.token)
    return { ok: true, projects: redactAny(Array.isArray(data) ? data : data?.projects || []) }
  }

  async function createProject({ name, description }) {
    await hydrateFromDisk()
    requireSignedIn()
    if (!name || !String(name).trim()) {
      throw new PibrowseError('invalid-input', 'Project name is required')
    }
    const data = await apiRequest(
      session.serverUrl,
      'POST',
      '/v1/projects',
      { name: String(name).trim(), ...(description ? { description: String(description) } : {}) },
      session.token,
    )
    return { ok: true, project: redactAny(data) }
  }

  async function listProfiles(projectId) {
    await hydrateFromDisk()
    requireSignedIn()
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    const data = await apiRequest(session.serverUrl, 'GET', `/v1/profiles${query}`, undefined, session.token)
    return { ok: true, profiles: redactAny(Array.isArray(data) ? data : data?.profiles || []) }
  }

  async function listMembers() {
    await hydrateFromDisk()
    requireSignedIn()
    const data = await apiRequest(session.serverUrl, 'GET', '/v1/members', undefined, session.token)
    const members = (Array.isArray(data) ? data : data?.members || []).map((m) => ({
      ...redactAny(m),
      verifyCode: m?.public_key ? verifyCode(m.public_key) : null,
    }))
    return { ok: true, members }
  }

  async function handoverKey({ memberId, memberPublicKeyB64, expectedVerifyCode }) {
    await hydrateFromDisk()
    requireOrgKey()
    if (!memberId || !memberPublicKeyB64) {
      throw new PibrowseError('invalid-input', 'memberId and memberPublicKeyB64 are required')
    }
    if (typeof expectedVerifyCode !== 'string' || !expectedVerifyCode.trim()) {
      throw new PibrowseError(
        'invalid-input',
        'expectedVerifyCode is required to confirm out-of-band member public-key verification',
      )
    }
    const computedCode = verifyCode(memberPublicKeyB64)
    if (expectedVerifyCode.trim() !== computedCode) {
      throw new PibrowseError(
        'conflict',
        `Verify code mismatch: expected ${expectedVerifyCode.trim()}, computed ${computedCode}`,
      )
    }
    const wrappedOrk = wrapForMember(session.orgKey, memberPublicKeyB64)
    const data = await apiRequest(
      session.serverUrl,
      'POST',
      `/v1/members/${encodeURIComponent(memberId)}/key`,
      { wrapped_ork: wrappedOrk, key_generation: session.keyGeneration || 1 },
      session.token,
    )
    return { ok: true, verifyCode: computedCode, result: redactAny(data) }
  }

  async function rotateOrgKey() {
    await hydrateFromDisk()
    requireOrgKey()
    const oldOrk = Buffer.from(session.orgKey)
    const newOrk = generateOrgKey()
    try {
      const prep = await apiRequest(session.serverUrl, 'GET', '/v1/org/rotation-material', undefined, session.token)
      const members = Array.isArray(prep?.members) ? prep.members : []
      const proxies = Array.isArray(prep?.proxies) ? prep.proxies : []
      const profiles = Array.isArray(prep?.profiles) ? prep.profiles : []
      const bundles = Array.isArray(prep?.bundles) ? prep.bundles : []

      const cfgBefore = await opts.configStore.load()
      const seenGen = Number(cfgBefore.orkGenerationsByServer?.[session.serverUrl] || 0)
      const currentGen = Math.max(seenGen, Number(session.keyGeneration || 0))
      const rawNextGen = prep?.next_generation ?? currentGen + 1
      const nextGeneration = Number(rawNextGen)
      if (!Number.isInteger(nextGeneration) || nextGeneration <= currentGen) {
        throw new PibrowseError(
          'rollback-detected',
          `Refusing ORK rotation to non-advancing generation ${String(rawNextGen)} (current ${currentGen})`,
          { current: currentGen, received: rawNextGen, serverUrl: session.serverUrl },
        )
      }

      const memberKeys = members
        .filter((m) => m?.id && m?.public_key)
        .map((m) => ({
          member_id: m.id,
          wrapped_ork: wrapForMember(newOrk, m.public_key),
        }))
      const proxyDeks = proxies
        .filter((p) => p?.id && p?.wrapped_dek)
        .map((p) => ({
          proxy_id: p.id,
          wrapped_dek: rewrapDataKey(oldOrk, newOrk, p.wrapped_dek),
        }))
      const cookieKeys = profiles
        .filter((p) => p?.id)
        .map((p) => {
          const sourceWrapped = p.wrapped_cookie_key || wrapCookieKey(oldOrk, p.id)
          return {
            profile_id: p.id,
            wrapped_cookie_key: rewrapDataKey(oldOrk, newOrk, sourceWrapped),
          }
        })
      const bundleKeys = bundles
        .filter((b) => b?.id && typeof b?.bundle_key === 'string')
        .map((b) => ({
          bundle_id: b.id,
          bundle_key: rewrapBundleKey(oldOrk, newOrk, b.bundle_key),
        }))

      const res = await apiRequest(
        session.serverUrl,
        'POST',
        '/v1/org/rotate-key',
        {
          key_generation: nextGeneration,
          members: memberKeys,
          proxies: proxyDeks,
          profiles: cookieKeys,
          bundles: bundleKeys,
        },
        session.token,
      )

      const selfWrappedOrk =
        memberKeys.find((m) => session.memberId && m.member_id === session.memberId)?.wrapped_ork ||
        (session.publicKeyB64 ? wrapForMember(newOrk, session.publicKeyB64) : null)

      session.orgKey.fill(0)
      session.orgKey = Buffer.from(newOrk)
      session.keyGeneration = nextGeneration
      if (selfWrappedOrk) {
        session.wrappedOrkB64 = selfWrappedOrk
      }
      await opts.configStore.assertAndRecordOrkGeneration(session.serverUrl, nextGeneration)
      const cfg = await opts.configStore.load()
      await persistSession(Boolean(cfg.rememberOrgKey))
      return {
        ok: true,
        keyGeneration: nextGeneration,
        rewrappedMembers: memberKeys.length,
        rewrappedProxies: proxyDeks.length,
        rewrappedProfiles: cookieKeys.length,
        rewrappedBundles: bundleKeys.length,
        result: redactAny(res),
      }
    } finally {
      oldOrk.fill(0)
      newOrk.fill(0)
    }
  }

  /**
   * Acquire distributed lock for a team profile, verify anti-rollback key generation,
   * derive `profile_key` + `cookie_key` (and unseal proxy credentials if any),
   * and launch via local `fury-agent` IPC `profile.launch`.
   * Automatically releases the lock via `/unlock` if local launch fails.
   */
  async function launchTeamProfile({ profileId, force = false, cdp = false, background = false }) {
    await hydrateFromDisk()
    requireOrgKey()
    if (!profileId || !String(profileId).trim()) {
      throw new PibrowseError('invalid-input', 'profileId is required')
    }
    const cfg = await opts.configStore.load()
    const grant = await apiRequest(
      session.serverUrl,
      'POST',
      `/v1/profiles/${encodeURIComponent(profileId)}/lock`,
      {
        machine_id: cfg.machineId,
        machine_name: hostname(),
        force: Boolean(force),
      },
      session.token,
    )

    const lockToken = grant?.lock_token
    if (!lockToken) {
      throw new PibrowseError('team-error', 'Team Server lock response did not include lock_token')
    }

    const generation = Number(grant.key_generation ?? session.keyGeneration ?? 1)
    try {
      await opts.configStore.assertAndRecordOrkGeneration(session.serverUrl, generation)

      let profileSpec = grant.spec && typeof grant.spec === 'object' ? { ...grant.spec } : { id: profileId }
      if (grant.wrapped_dek && grant.credentials_enc) {
        const creds = openProxyCredentials(session.orgKey, grant.wrapped_dek, grant.credentials_enc)
        profileSpec = {
          ...profileSpec,
          proxy: {
            ...(profileSpec.proxy && typeof profileSpec.proxy === 'object' ? profileSpec.proxy : {}),
            ...creds,
          },
        }
      }

      const keys = deriveLaunchKeys({
        orgKey: session.orgKey,
        profileId,
        wrappedCookieKeyB64: grant.wrapped_cookie_key || null,
      })

      const launched = await opts.ipcClient.call('profile.launch', {
        id: profileId,
        server: {
          url: session.serverUrl,
          token: session.token,
        },
        lock_token: lockToken,
        profile: profileSpec,
        profile_key: keys.profileKeyHex,
        cookie_key: keys.cookieKeyHex,
        key_generation: generation,
        cdp: Boolean(cdp),
        background: Boolean(background),
      })

      activeLocks.set(profileId, {
        lockToken,
        expiresAt: grant.expires_at || null,
        serverUrl: session.serverUrl,
      })

      return {
        ok: true,
        profileId,
        keyGeneration: generation,
        expiresAt: grant.expires_at || null,
        launch: redactAny(launched),
      }
    } catch (err) {
      await apiRequest(
        session.serverUrl,
        'POST',
        `/v1/profiles/${encodeURIComponent(profileId)}/unlock`,
        { lock_token: lockToken },
        session.token,
      ).catch((unlockErr) => {
        opts.logger?.warn?.('omnimux-pibrowse: failed to release lock after launch failure', {
          profileId,
          error: unlockErr instanceof Error ? unlockErr.message : String(unlockErr),
        })
      })
      throw normalizeCoreLaunchError(err)
    }
  }

  async function stopTeamProfile({ profileId }) {
    await hydrateFromDisk()
    requireSignedIn()
    if (!profileId) throw new PibrowseError('invalid-input', 'profileId is required')
    const stopRes = await opts.ipcClient.call('profile.stop', { id: profileId }).catch((err) => {
      if (err instanceof PibrowseError && err.code === 'sidecar-offline') return null
      throw err
    })
    const lockInfo = activeLocks.get(profileId)
    if (lockInfo?.lockToken) {
      await apiRequest(
        session.serverUrl,
        'POST',
        `/v1/profiles/${encodeURIComponent(profileId)}/unlock`,
        { lock_token: lockInfo.lockToken },
        session.token,
      ).catch((err) => {
        opts.logger?.warn?.('omnimux-pibrowse: unlock after stop failed', {
          profileId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      activeLocks.delete(profileId)
    }
    return {
      ok: true,
      profileId,
      stopped: redactAny(stopRes),
    }
  }

  async function shareLocalProfile({ localProfileId, projectId, name }) {
    await hydrateFromDisk()
    requireOrgKey()
    if (!localProfileId) {
      throw new PibrowseError('invalid-input', 'localProfileId is required')
    }
    const allProfiles = await opts.ipcClient.call('profiles.list', {})
    const profileList = Array.isArray(allProfiles)
      ? allProfiles
      : Array.isArray(allProfiles?.profiles)
        ? allProfiles.profiles
        : []
    const localProfile = profileList.find((p) => p && p.id === localProfileId) || null
    if (!localProfile || typeof localProfile !== 'object') {
      throw new PibrowseError('not-found', `Local profile "${localProfileId}" not found`)
    }

    const spec = { ...localProfile }
    let sealedProxy = null
    if (spec.proxy && typeof spec.proxy === 'object') {
      const proxyObj = { ...spec.proxy }
      let inlineUser = null
      let inlinePass = null
      for (const urlField of ['url', 'endpoint', 'server']) {
        if (typeof proxyObj[urlField] === 'string' && proxyObj[urlField]) {
          const match = proxyObj[urlField].match(/^(?:https?|socks5h?|socks4a?):\/\/([^/\s:@]+):([^/\s@]+)@/i)
          if (match) {
            try {
              inlineUser = inlineUser || decodeURIComponent(match[1])
              inlinePass = inlinePass || decodeURIComponent(match[2])
            } catch {
              inlineUser = inlineUser || match[1]
              inlinePass = inlinePass || match[2]
            }
            proxyObj[urlField] = redactUrlCredentials(proxyObj[urlField])
          }
        }
      }
      const rawPassword = proxyObj.password || inlinePass || null
      const rawRotateUrl = proxyObj.rotate_url || proxyObj.rotateUrl || null
      if (rawPassword || rawRotateUrl) {
        sealedProxy = sealProxyCredentials(session.orgKey, {
          username: proxyObj.username || inlineUser || null,
          password: rawPassword,
          rotate_url: rawRotateUrl,
        })
      }
      proxyObj.password = null
      proxyObj.rotate_url = null
      if ('rotateUrl' in proxyObj) proxyObj.rotateUrl = null
      spec.proxy = proxyObj
    }

    const created = await apiRequest(
      session.serverUrl,
      'POST',
      '/v1/profiles',
      {
        name: name || spec.name || localProfileId,
        project_id: projectId || null,
        spec,
        wrapped_cookie_key: wrapCookieKey(session.orgKey, localProfileId),
        ...(sealedProxy
          ? {
              wrapped_dek: sealedProxy.wrappedDekB64,
              credentials_enc: sealedProxy.credentialsEncB64,
            }
          : {}),
      },
      session.token,
    )
    return {
      ok: true,
      profile: redactAny(created),
    }
  }

  async function listAuditLogs({ limit = 50, profileId } = {}) {
    await hydrateFromDisk()
    requireSignedIn()
    const params = new URLSearchParams()
    params.set('limit', String(Math.min(200, Math.max(1, Number(limit) || 50))))
    if (profileId) params.set('profile_id', String(profileId))
    const data = await apiRequest(session.serverUrl, 'GET', `/v1/audit?${params.toString()}`, undefined, session.token)
    return {
      ok: true,
      events: redactAny(Array.isArray(data) ? data : data?.events || []),
    }
  }

  async function dispose() {
    for (const [profileId, lock] of activeLocks.entries()) {
      if (session.serverUrl && session.token && lock?.lockToken) {
        await apiRequest(
          session.serverUrl,
          'POST',
          `/v1/profiles/${encodeURIComponent(profileId)}/unlock`,
          { lock_token: lock.lockToken },
          session.token,
        ).catch((err) => {
          opts.logger?.warn?.('omnimux-pibrowse: unlock during dispose failed', {
            profileId,
            error: redactLogLine(err instanceof Error ? err.message : String(err)),
          })
        })
      }
    }
    clearSecrets()
  }

  return {
    getStatus,
    probeServer,
    login,
    signupWithInvite,
    unlockSessionWithPassword,
    disconnect,
    listProjects,
    createProject,
    listProfiles,
    listMembers,
    handoverKey,
    rotateOrgKey,
    launchTeamProfile,
    stopTeamProfile,
    shareLocalProfile,
    listAuditLogs,
    dispose,
  }
}
