import { classifyQuotaFailure, QUOTA_EXCEEDED_CODE } from '../errors/quota-classifier.js'
import { peekStatusCache } from './api-auth.js'
import { walletUrl as buildWalletUrl } from './quota-failure.js'
import { ensureQuota, invalidateQuotaVerify, resetQuotaPrecheck } from './quota-precheck.js'

export const QUOTA_GLOBAL_KEY = '__omnimuxQuota'
const DEFAULT_WALLET = 'https://omnimux.ai/wallet'
const COOLDOWN_MS = 2000
let state = Object.freeze({ phase: 'closed', failure: null, walletUrl: DEFAULT_WALLET, cooldownUntil: 0 })
const listeners = new Set()
let lastCorrelation = null

function emit() { for (const listener of [...listeners]) listener() }
function setState(next) { state = Object.freeze({ ...state, ...next }); emit() }
function currentWalletUrl() {
  const cache = peekStatusCache()
  const base = cache?.ok && cache.body?.logged_in === true && typeof cache.body.base_url === 'string' ? cache.body.base_url : ''
  return buildWalletUrl(base)
}

export function getSnapshot() { return state }
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
export function walletUrl() { return currentWalletUrl() }
export function notify(failure, context = {}) {
  const classified = classifyQuotaFailure({ ...(failure && typeof failure === 'object' ? failure : {}), error: failure, cause: failure })
  if (classified.kind !== 'quota-exceeded') return false
  const correlationId = typeof context.correlationId === 'string' ? context.correlationId : (failure?.correlationId || null)
  const now = Date.now()
  if (state.phase === 'open') return true
  if (now < state.cooldownUntil) return false
  if (correlationId && correlationId === lastCorrelation) return false
  lastCorrelation = correlationId
  setState({ phase: 'open', failure: { ...classified, code: QUOTA_EXCEEDED_CODE, ...context }, walletUrl: currentWalletUrl(), cooldownUntil: 0 })
  invalidateQuotaVerify()
  return true
}
export function openWallet() {
  if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(currentWalletUrl(), '_blank', 'noopener,noreferrer')
}
export function close() { setState({ phase: 'closed', failure: null, cooldownUntil: Date.now() + COOLDOWN_MS }) }

export function installQuotaGlobal(target) {
  if (!target) return undefined
  if (target[QUOTA_GLOBAL_KEY]) return target[QUOTA_GLOBAL_KEY]
  const api = { notify, subscribe, getSnapshot, walletUrl, openWallet, close, ensureQuota }
  Object.defineProperty(target, QUOTA_GLOBAL_KEY, { value: api, configurable: true })
  return api
}
export function resetQuotaGate() {
  lastCorrelation = null
  state = Object.freeze({ phase: 'closed', failure: null, walletUrl: DEFAULT_WALLET, cooldownUntil: 0 })
  resetQuotaPrecheck()
  emit()
}
installQuotaGlobal(typeof window !== 'undefined' ? window : undefined)
