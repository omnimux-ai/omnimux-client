import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  agentIdForSubscriptionProvider,
  decodeJwtPayload,
  inspectLocalCliCredential,
  readLocalCliOAuthGrant,
  subscriptionSpecFor,
} from './cli-credential-import.js'

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

function withTempHome(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimux-cli-import-'))
  try {
    return fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('subscriptionSpecFor & reverse mapping', () => {
  it('maps codex, claude, kimi and leaves qwen unsupported', () => {
    const codex = subscriptionSpecFor('codex')
    assert.equal(codex.providerId, 'openai-codex')
    assert.equal(codex.recordKey, 'llm-pi-ai/openai-codex')
    assert.equal(codex.profile.transport, 'sse')
    assert.deepEqual(codex.oauthMethods, ['browser', 'device_code'])

    assert.equal(subscriptionSpecFor('claude')?.providerId, 'anthropic')
    assert.equal(subscriptionSpecFor('kimi')?.providerId, 'kimi-coding')
    assert.equal(subscriptionSpecFor('qwen'), null)

    assert.equal(agentIdForSubscriptionProvider('openai-codex'), 'codex')
    assert.equal(agentIdForSubscriptionProvider('anthropic'), 'claude')
    assert.equal(agentIdForSubscriptionProvider('kimi-coding'), 'kimi')
    assert.equal(agentIdForSubscriptionProvider('omnimux'), '')
  })
})

describe('readLocalCliOAuthGrant · codex', () => {
  it('parses Codex auth.json with JWT exp and chatgpt_account_id claim fallback', () => withTempHome((home) => {
    const expSec = 1_900_000_000
    const accessToken = makeJwt({
      exp: expSec,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-from-jwt' },
    })
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: accessToken,
        refresh_token: 'rt-codex-sample',
      },
    }))

    const res = readLocalCliOAuthGrant('codex', { home, env: { HOME: home } })
    assert.equal(res.ok, true)
    assert.equal(res.source, 'file')
    assert.equal(res.expiresAt, expSec * 1000)
    assert.deepEqual(res.grant, {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: accessToken,
        refresh: 'rt-codex-sample',
        expires: expSec * 1000,
        accountId: 'acct-from-jwt',
      },
    })
  }))

  it('prefers explicit tokens.account_id and sets expires to 0 when exp is absent', () => withTempHome((home) => {
    const customDir = path.join(home, 'custom-codex')
    fs.mkdirSync(customDir, { recursive: true })
    fs.writeFileSync(path.join(customDir, 'auth.json'), JSON.stringify({
      tokens: {
        access_token: 'opaque-access-token',
        refresh_token: 'rt-codex-2',
        account_id: 'acct-explicit',
      },
    }))

    const res = readLocalCliOAuthGrant('codex', {
      home,
      env: { HOME: home, CODEX_HOME: customDir },
    })
    assert.equal(res.ok, true)
    assert.equal(res.grant.payload.accountId, 'acct-explicit')
    assert.equal(res.grant.payload.expires, 0)
  }))

  it('recognizes OPENAI_API_KEY mode without fabricating an OAuth grant', () => withTempHome((home) => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-user-key',
    }))

    const res = readLocalCliOAuthGrant('codex', { home, env: { HOME: home } })
    assert.deepEqual(res, { ok: false, reason: 'api-key-mode' })
  }))

  it('reports keyring-or-external when auth.json is absent on a signed-in machine', () => withTempHome((home) => {
    const signedIn = readLocalCliOAuthGrant('codex', { home, env: { HOME: home }, cliSignedIn: true })
    assert.deepEqual(signedIn, { ok: false, reason: 'keyring-or-external' })

    const signedOut = readLocalCliOAuthGrant('codex', { home, env: { HOME: home }, cliSignedIn: false })
    assert.deepEqual(signedOut, { ok: false, reason: 'missing' })
  }))

  it('rejects malformed JSON, symlinks escaping $HOME, and oversized files', () => withTempHome((home) => {
    const codexDir = path.join(home, '.codex')
    fs.mkdirSync(codexDir, { recursive: true })

    // 1. Malformed JSON
    fs.writeFileSync(path.join(codexDir, 'auth.json'), '{ broken json')
    assert.deepEqual(readLocalCliOAuthGrant('codex', { home, env: { HOME: home } }), { ok: false, reason: 'malformed' })

    // 2. Symlink pointing outside $HOME
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimux-outside-'))
    try {
      const outsideFile = path.join(outsideDir, 'secret.json')
      fs.writeFileSync(outsideFile, JSON.stringify({
        tokens: { access_token: 'tok', refresh_token: 'ref', account_id: 'acct' },
      }))
      fs.rmSync(path.join(codexDir, 'auth.json'))
      fs.symlinkSync(outsideFile, path.join(codexDir, 'auth.json'))
      assert.deepEqual(readLocalCliOAuthGrant('codex', { home, env: { HOME: home } }), { ok: false, reason: 'malformed' })
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }

    // 3. Oversized file (> 256 KiB)
    fs.rmSync(path.join(codexDir, 'auth.json'))
    fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({
      tokens: { access_token: 'x'.repeat(300 * 1024), refresh_token: 'r', account_id: 'a' },
    }))
    assert.deepEqual(readLocalCliOAuthGrant('codex', { home, env: { HOME: home } }), { ok: false, reason: 'malformed' })
  }))
})

describe('readLocalCliOAuthGrant · kimi & claude', () => {
  it('picks the newest valid credential file in ~/.kimi-code/credentials', () => withTempHome((home) => {
    const dir = path.join(home, '.kimi-code', 'credentials')
    fs.mkdirSync(dir, { recursive: true })
    const older = path.join(dir, 'a-old.json')
    const newer = path.join(dir, 'b-new.json')
    fs.writeFileSync(older, JSON.stringify({ access_token: 'old-access', refresh_token: 'old-ref', expires_at: 1_700_000_000 }))
    fs.writeFileSync(newer, JSON.stringify({ access_token: 'new-access', refresh_token: 'new-ref', expires_at: 1_900_000_000 }))
    fs.utimesSync(older, new Date(1_700_000_000_000), new Date(1_700_000_000_000))
    fs.utimesSync(newer, new Date(1_800_000_000_000), new Date(1_800_000_000_000))

    const res = readLocalCliOAuthGrant('kimi', { home, env: { HOME: home } })
    assert.equal(res.ok, true)
    assert.equal(res.grant.payload.access, 'new-access')
    assert.equal(res.grant.payload.refresh, 'new-ref')
    assert.equal(res.grant.payload.expires, 1_900_000_000_000)
  }))

  it('reads Claude file credentials when present and falls back to keyring-or-external when absent on signed-in macOS', () => withTempHome((home) => {
    const missingSignedIn = readLocalCliOAuthGrant('claude', { home, env: { HOME: home }, cliSignedIn: true })
    assert.deepEqual(missingSignedIn, { ok: false, reason: 'keyring-or-external' })

    const dir = path.join(home, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({
      claudeAiOauth: {
        accessToken: 'claude-at',
        refreshToken: 'claude-rt',
        expiresAt: 1_950_000_000_000,
      },
    }))
    const res = readLocalCliOAuthGrant('claude', { home, env: { HOME: home }, cliSignedIn: true })
    assert.equal(res.ok, true)
    assert.deepEqual(res.grant, {
      kind: 'grant',
      payload: {
        type: 'oauth',
        access: 'claude-at',
        refresh: 'claude-rt',
        expires: 1_950_000_000_000,
      },
    })
  }))
})

describe('inspectLocalCliCredential · zero secret leakage', () => {
  it('never leaks access/refresh token values in inspection metadata', () => withTempHome((home) => {
    const SENTINEL = 'SENTINEL-DO-NOT-LEAK-9b4a7e2c'
    const access = makeJwt({
      exp: 1_900_000_000,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-safe' },
      sub: SENTINEL,
    })
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({
      tokens: {
        access_token: access,
        refresh_token: `${SENTINEL}-refresh`,
        account_id: 'acct-safe',
      },
    }))

    const info = inspectLocalCliCredential('codex', { home, env: { HOME: home } })
    assert.equal(info.supported, true)
    assert.equal(info.importable, true)
    assert.equal(info.source, 'file')
    const serialized = JSON.stringify(info)
    assert.equal(serialized.includes(SENTINEL), false)
    assert.equal(serialized.includes(access), false)
    assert.equal(serialized.includes('refresh_token'), false)
    assert.equal(decodeJwtPayload('not-a-jwt'), null)
  }))
})
