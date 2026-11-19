import { getStatus, getStatusGeneration, peekStatusCache } from './api-auth.js'
import { classifyQuotaFailure } from '../errors/quota-classifier.js'

export const VERIFY_TTL_MS = 30_000

const defaultNotify = (failure, context) => {
  const global = typeof window !== 'undefined' ? window.__omnimuxQuota : null
  if (global && typeof global.notify === 'function' && global.notify !== ensureQuota) global.notify(failure, context)
}

const defaultEnsureLogin = (options) => {
  const global = typeof window !== 'undefined' ? window.__omnimuxAuth : null
  if (global && typeof global.ensureLogin === 'function') return global.ensureLogin(options)
  options?.onCancel?.()
  return undefined
}

let impl = { getStatus, ensureLogin: defaultEnsureLogin, notify: defaultNotify }
let session

function currentSession() {
  const generation = getStatusGeneration()
  if (session?.generation !== generation) session = { generation, cached: null, inflight: null }
  return session
}

export function setQuotaPrecheckImpl(next = {}) {
  impl = { ...impl, ...next }
}

export function invalidatePositiveQuota() {
  const owner = currentSession()
  if (owner.cached?.quota_usd > 0) owner.cached = null
}

export function resetQuotaPrecheck() {
  session = undefined
  impl = { getStatus, ensureLogin: defaultEnsureLogin, notify: defaultNotify }
}

function authFailure(result) {
  return result?.status === 401 || result?.body?.logged_in === false || result?.body?.error === 'needs-omnimux'
}

function login() {
  if (typeof impl.ensureLogin !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; resolve() } }
    try {
      const result = impl.ensureLogin({ onSuccess: finish, onCancel: finish, kind: 'write', action: 'quota' })
      if (result && typeof result.then === 'function') result.then(finish, finish)
    } catch { finish() }
  })
}

export function ensureQuota(context = {}) {
  const owner = currentSession()
  const { cached, inflight } = owner
  const now = Date.now()
  if (inflight) return inflight
  const retryDenied = context.userInitiated === true && cached?.quota_usd <= 0
  if (cached && now - cached.at < VERIFY_TTL_MS && !retryDenied) {
    if (cached.quota_usd <= 0) {
      impl.notify({ status: 402, code: 'quota-exceeded', body: { error: 'quota-exceeded' } }, context)
      return Promise.resolve({ ok: false, reason: 'quota' })
    }
    return Promise.resolve({ ok: true })
  }
  owner.inflight = Promise.resolve().then(() => owner === currentSession() ? impl.getStatus(true) : undefined).then(async (result) => {
    if (owner !== currentSession()) {
      // A current status response can itself be the first observation of logout.
      // Every other obsolete receipt must stop its original action silently.
      if (result?.body && authFailure(result) && result.body === peekStatusCache()?.body) await login()
      return { ok: false, reason: 'auth' }
    }
    if (authFailure(result)) {
      await login()
      return { ok: false, reason: 'auth' }
    }
    const classified = classifyQuotaFailure(result || {})
    if (classified.kind === 'quota-exceeded') {
      invalidatePositiveQuota()
      impl.notify({ status: 402, code: 'quota-exceeded', body: { error: 'quota-exceeded' } }, context)
      return { ok: false, reason: 'quota' }
    }
    if (result?.ok && result.body?.logged_in === true && typeof result.body.quota_usd === 'number') {
      owner.cached = { at: Date.now(), quota_usd: result.body.quota_usd }
      if (result.body.quota_usd <= 0) {
        impl.notify({ status: 402, code: 'quota-exceeded', body: { error: 'quota-exceeded' } }, context)
        return { ok: false, reason: 'quota' }
      }
    }
    return { ok: true }
  }).catch((error) => {
    if (owner !== currentSession()) return { ok: false, reason: 'auth' }
    if (classifyQuotaFailure({ error }).kind === 'needs-omnimux') {
      return login().then(() => ({ ok: false, reason: 'auth' }))
    }
    return { ok: true }
  }).finally(() => { owner.inflight = null })
  return owner.inflight
}
