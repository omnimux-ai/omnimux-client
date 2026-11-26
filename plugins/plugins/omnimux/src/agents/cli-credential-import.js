import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_CREDENTIAL_FILE_BYTES = 256 * 1024
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth'

/**
 * Single source of truth mapping OmniMux agent ids to DSH `llm-pi-ai` catalog
 * routes, `ctx.credentials` record keys, OAuth modes, and read-only local CLI
 * credential import descriptors.
 */
export const SUBSCRIPTION_PROVIDERS = Object.freeze({
  codex: Object.freeze({
    agentId: 'codex',
    providerId: 'openai-codex',
    recordKey: 'llm-pi-ai/openai-codex',
    displayName: 'Codex',
    oauthMethods: Object.freeze(['browser', 'device_code']),
    // Pin SSE transport to avoid pi-ai's 15s WebSocket handshake timeout under proxies.
    profile: Object.freeze({ displayName: 'Codex', transport: 'sse' }),
    preferredDefaultModels: Object.freeze(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5']),
    cliImportKind: 'codex-auth-json',
  }),
  claude: Object.freeze({
    agentId: 'claude',
    providerId: 'anthropic',
    recordKey: 'llm-pi-ai/anthropic',
    displayName: 'Claude',
    oauthMethods: Object.freeze(['browser', 'copy_code']),
    profile: Object.freeze({ displayName: 'Claude' }),
    preferredDefaultModels: Object.freeze(['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-sonnet-4-5']),
    cliImportKind: 'claude-credentials-json',
  }),
  kimi: Object.freeze({
    agentId: 'kimi',
    providerId: 'kimi-coding',
    recordKey: 'llm-pi-ai/kimi-coding',
    displayName: 'Kimi Code',
    oauthMethods: Object.freeze(['device_code']),
    profile: Object.freeze({ displayName: 'Kimi Code' }),
    preferredDefaultModels: Object.freeze(['k3', 'k3-256k', 'kimi-for-coding']),
    cliImportKind: 'kimi-credentials-dir',
  }),
})

/** @param {string} agentId */
export function subscriptionSpecFor(agentId) {
  const key = typeof agentId === 'string' ? agentId.trim().toLowerCase() : ''
  return Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PROVIDERS, key)
    ? SUBSCRIPTION_PROVIDERS[key]
    : null
}

/** @param {string} providerId */
export function agentIdForSubscriptionProvider(providerId) {
  const key = typeof providerId === 'string' ? providerId.trim().toLowerCase() : ''
  for (const spec of Object.values(SUBSCRIPTION_PROVIDERS)) {
    if (spec.providerId === key) return spec.agentId
  }
  return ''
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

/**
 * Decode a JWT payload segment without verifying signatures (used only to extract
 * non-secret `exp` and `chatgpt_account_id` metadata from a user's own local token).
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch (err) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] cli-import jwt decode failed:', err?.name || 'error')
    return null
  }
}

/**
 * Normalize an expiration value (epoch seconds, epoch ms, or ISO timestamp) to
 * epoch ms; returns 0 when absent or unparseable so pi-ai triggers a locked refresh.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeExpiresMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.floor(value * 1000) : Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim())
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e12 ? Math.floor(numeric * 1000) : Math.floor(numeric)
    }
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function canonicalPath(target, fsImpl) {
  try {
    return typeof fsImpl.realpathSync === 'function' ? fsImpl.realpathSync(target) : path.resolve(target)
  } catch (err) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] cli-import realpath failed:', err?.code || 'error')
    return ''
  }
}

function isWithinRoot(candidate, root) {
  if (!candidate || !root) return false
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Read a JSON object from an allowlisted path, enforcing regular-file checks,
 * symlink root containment, and size bounds.
 * @param {string} filePath
 * @param {string[]} allowedRoots
 * @param {typeof fs} fsImpl
 * @returns {{ status: 'ok', data: Record<string, unknown>, mtimeMs: number } | { status: 'missing' | 'rejected' | 'malformed' }}
 */
function readSafeJsonFile(filePath, allowedRoots, fsImpl) {
  let exists = false
  try {
    exists = fsImpl.existsSync(filePath)
  } catch (err) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] cli-import existsSync failed:', err?.code || 'error')
    exists = false
  }
  if (!exists) return { status: 'missing' }

  const resolvedFile = canonicalPath(filePath, fsImpl)
  const resolvedRoots = allowedRoots
    .map((root) => canonicalPath(root, fsImpl) || path.resolve(root))
    .filter(Boolean)
  if (!resolvedFile || !resolvedRoots.some((root) => isWithinRoot(resolvedFile, root))) {
    return { status: 'rejected' }
  }

  let stat = null
  try {
    stat = typeof fsImpl.statSync === 'function' ? fsImpl.statSync(resolvedFile) : null
  } catch (err) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] cli-import statSync failed:', err?.code || 'error')
    return { status: 'missing' }
  }
  if (stat) {
    if (typeof stat.isFile === 'function' && !stat.isFile()) return { status: 'rejected' }
    if (typeof stat.size === 'number' && stat.size > MAX_CREDENTIAL_FILE_BYTES) return { status: 'rejected' }
  }

  try {
    const raw = fsImpl.readFileSync(resolvedFile, 'utf8')
    const parsed = JSON.parse(String(raw || ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'malformed' }
    }
    return {
      status: 'ok',
      data: /** @type {Record<string, unknown>} */ (parsed),
      mtimeMs: typeof stat?.mtimeMs === 'number' ? stat.mtimeMs : 0,
    }
  } catch (err) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] cli-import json read failed:', err?.code || err?.name || 'error')
    return { status: 'malformed' }
  }
}

/**
 * Parse OpenAI Codex CLI `auth.json` into a DSH `GrantRecord` matching pi-ai's
 * `openai-codex` OAuth credential shape (`{ type: 'oauth', access, refresh, expires, accountId }`).
 */
function readCodexGrant({ home, env, fsImpl, cliSignedIn }) {
  const codexHomeRaw = nonEmptyString(env?.CODEX_HOME)
  const codexDir = codexHomeRaw && path.isAbsolute(codexHomeRaw)
    ? codexHomeRaw
    : path.join(home, '.codex')
  const authPath = path.join(codexDir, 'auth.json')
  const allowedRoots = [home]
  if (codexHomeRaw && path.isAbsolute(codexHomeRaw)) allowedRoots.push(codexHomeRaw)

  const read = readSafeJsonFile(authPath, allowedRoots, fsImpl)
  if (read.status === 'missing') {
    return { ok: false, reason: cliSignedIn ? 'keyring-or-external' : 'missing' }
  }
  if (read.status !== 'ok') {
    return { ok: false, reason: 'malformed' }
  }

  const data = read.data
  const tokens = data.tokens && typeof data.tokens === 'object' && !Array.isArray(data.tokens)
    ? /** @type {Record<string, unknown>} */ (data.tokens)
    : data
  const access = nonEmptyString(tokens.access_token)
  const refresh = nonEmptyString(tokens.refresh_token)
  if (!access) {
    const apiKey = nonEmptyString(data.OPENAI_API_KEY) || nonEmptyString(data.api_key)
    const authMode = nonEmptyString(data.auth_mode).toLowerCase()
    if (apiKey || authMode === 'apikey' || authMode === 'api_key') {
      return { ok: false, reason: 'api-key-mode' }
    }
    return { ok: false, reason: cliSignedIn ? 'keyring-or-external' : 'malformed' }
  }
  if (!refresh) {
    return { ok: false, reason: 'malformed' }
  }

  const jwt = decodeJwtPayload(access)
  const authClaim = jwt && typeof jwt[OPENAI_AUTH_CLAIM] === 'object' && jwt[OPENAI_AUTH_CLAIM] !== null
    ? /** @type {Record<string, unknown>} */ (jwt[OPENAI_AUTH_CLAIM])
    : null
  const accountId = nonEmptyString(tokens.account_id)
    || nonEmptyString(data.account_id)
    || nonEmptyString(authClaim?.chatgpt_account_id)
  if (!accountId) {
    return { ok: false, reason: 'malformed' }
  }

  const expires = normalizeExpiresMs(jwt?.exp) || normalizeExpiresMs(tokens.expires_at ?? tokens.expires)
  return {
    ok: true,
    source: 'file',
    expiresAt: expires,
    grant: {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access,
        refresh,
        expires,
        accountId,
      },
    },
  }
}

/**
 * Parse Kimi Code CLI `~/.kimi-code/credentials/*.json` into a DSH `GrantRecord`
 * matching pi-ai's `kimi-coding` OAuth shape (`{ type: 'oauth', access, refresh, expires }`).
 */
function readKimiGrant({ home, fsImpl, cliSignedIn }) {
  const dir = path.join(home, '.kimi-code', 'credentials')
  let names = []
  try {
    names = fsImpl.readdirSync(dir)
      .filter((entry) => typeof entry === 'string' && entry.endsWith('.json'))
      .sort()
  } catch (err) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] cli-import kimi readdir failed:', err?.code || 'error')
    return { ok: false, reason: cliSignedIn ? 'keyring-or-external' : 'missing' }
  }
  if (names.length === 0) {
    return { ok: false, reason: cliSignedIn ? 'keyring-or-external' : 'missing' }
  }

  const candidates = []
  let sawMalformed = false
  for (const name of names) {
    const filePath = path.join(dir, name)
    const read = readSafeJsonFile(filePath, [home], fsImpl)
    if (read.status !== 'ok') {
      if (read.status === 'malformed' || read.status === 'rejected') sawMalformed = true
      continue
    }
    const access = nonEmptyString(read.data.access_token)
    const refresh = nonEmptyString(read.data.refresh_token)
    if (!access || !refresh) {
      sawMalformed = true
      continue
    }
    const expires = normalizeExpiresMs(read.data.expires_at ?? read.data.expires)
    candidates.push({
      mtimeMs: read.mtimeMs,
      expires,
      grant: {
        kind: 'grant',
        payload: {
          type: 'oauth',
          access,
          refresh,
          expires,
        },
      },
    })
  }
  if (candidates.length === 0) {
    return { ok: false, reason: sawMalformed ? 'malformed' : 'missing' }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.expires - left.expires)
  const best = candidates[0]
  return {
    ok: true,
    source: 'file',
    expiresAt: best.expires,
    grant: best.grant,
  }
}

/**
 * Parse Claude Code file-based `~/.claude/.credentials.json` (Linux / file store).
 * Never queries macOS Keychain; when absent on a signed-in machine, reports
 * `keyring-or-external` so callers route cleanly to in-app OAuth (Route 1).
 */
function readClaudeGrant({ home, fsImpl, cliSignedIn }) {
  const credPath = path.join(home, '.claude', '.credentials.json')
  const read = readSafeJsonFile(credPath, [home], fsImpl)
  if (read.status === 'missing') {
    return { ok: false, reason: cliSignedIn ? 'keyring-or-external' : 'missing' }
  }
  if (read.status !== 'ok') {
    return { ok: false, reason: 'malformed' }
  }
  const nested = read.data.claudeAiOauth && typeof read.data.claudeAiOauth === 'object' && !Array.isArray(read.data.claudeAiOauth)
    ? /** @type {Record<string, unknown>} */ (read.data.claudeAiOauth)
    : read.data
  const access = nonEmptyString(nested.accessToken ?? nested.access_token)
  const refresh = nonEmptyString(nested.refreshToken ?? nested.refresh_token)
  if (!access || !refresh) {
    return { ok: false, reason: cliSignedIn ? 'keyring-or-external' : 'malformed' }
  }
  const expires = normalizeExpiresMs(nested.expiresAt ?? nested.expires_at ?? nested.expires)
  return {
    ok: true,
    source: 'file',
    expiresAt: expires,
    grant: {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access,
        refresh,
        expires,
      },
    },
  }
}

/**
 * Host-internal read of a local CLI OAuth grant. Callers MUST write the grant
 * directly to `ctx.credentials.modifyRecord` and never return or log its payload.
 * @param {string} agentId
 * @param {{ home?: string, env?: Record<string, string|undefined>, fsImpl?: typeof fs, cliSignedIn?: boolean }} [options]
 * @returns {{ ok: true, grant: { kind: 'grant', payload: Record<string, unknown> }, source: 'file', expiresAt: number } | { ok: false, reason: string }}
 */
export function readLocalCliOAuthGrant(agentId, options = {}) {
  const spec = subscriptionSpecFor(agentId)
  if (!spec) return { ok: false, reason: 'unsupported' }
  const fsImpl = options.fsImpl || fs
  const env = options.env || process.env
  const home = options.home || env.HOME || os.homedir()
  const cliSignedIn = options.cliSignedIn === true

  if (spec.cliImportKind === 'codex-auth-json') {
    return readCodexGrant({ home, env, fsImpl, cliSignedIn })
  }
  if (spec.cliImportKind === 'kimi-credentials-dir') {
    return readKimiGrant({ home, fsImpl, cliSignedIn })
  }
  if (spec.cliImportKind === 'claude-credentials-json') {
    return readClaudeGrant({ home, fsImpl, cliSignedIn })
  }
  return { ok: false, reason: 'unsupported' }
}

/**
 * Public, secret-free inspection of whether a local CLI's credentials can be
 * imported via Route 2. Token values never leave `readLocalCliOAuthGrant`.
 * @param {string} agentId
 * @param {{ home?: string, env?: Record<string, string|undefined>, fsImpl?: typeof fs, cliSignedIn?: boolean }} [options]
 * @returns {{ supported: boolean, importable: boolean, source: 'file' | 'none', reason: string, expiresAt?: number }}
 */
export function inspectLocalCliCredential(agentId, options = {}) {
  const spec = subscriptionSpecFor(agentId)
  if (!spec) {
    return { supported: false, importable: false, source: 'none', reason: 'unsupported' }
  }
  const parsed = readLocalCliOAuthGrant(agentId, options)
  if (parsed.ok) {
    return {
      supported: true,
      importable: true,
      source: parsed.source,
      reason: 'file',
      ...(parsed.expiresAt > 0 ? { expiresAt: parsed.expiresAt } : {}),
    }
  }
  return {
    supported: true,
    importable: false,
    source: 'none',
    reason: parsed.reason,
  }
}
