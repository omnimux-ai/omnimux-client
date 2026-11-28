import { OmnimuxError } from '../media/errors.js'
import { listFromPayload, pickAccount, pickRenewView, pickSeatsView } from './public-account.js'
import { assertSocialSuccess, matchesSocialProvider, requireSocialProvider } from './provider.js'

/**
 * @param {{ withPat: Function }} client
 * @param {{ provider?: unknown }} args
 */
export async function listAccounts(client, args = {}) {
  const provider = requireSocialProvider(args.provider)
  const raw = assertSocialSuccess(await client.withPat(`/api/social/v1/accounts?provider=${provider}`))
  if (!Array.isArray(raw) && !Array.isArray(raw?.accounts) && !Array.isArray(raw?.data?.accounts) && !Array.isArray(raw?.data) && !Array.isArray(raw?.data?.items)) {
    throw new OmnimuxError('omnimux-invalid-response', 'social account list is missing')
  }
  return { accounts: listFromPayload(raw).map(pickAccount).filter((row) => matchesSocialProvider(row, provider)) }
}

/**
 * @param {{ withPat: Function }} client
 * @param {{ provider?: unknown, platform?: string, redirect_url?: string }} args
 */
export async function connectAccount(client, args) {
  const provider = requireSocialProvider(args.provider)
  if (provider === 'tiktok_direct' && args.platform !== 'tiktok') {
    throw new OmnimuxError('invalid-provider', 'tiktok_direct only supports tiktok', { status: 400 })
  }
  return assertSocialSuccess(await client.withPat('/api/social/v1/connect', {
    method: 'POST',
    body: {
      provider,
      platform: args.platform,
      redirect_url: args.redirect_url,
    },
  }))
}

/**
 * @param {{ withPat: Function }} client
 * @param {{ id?: string, provider?: unknown }} args
 */
export async function disconnectAccount(client, args) {
  const provider = requireSocialProvider(args.provider)
  const id = encodeURIComponent(String(args.id || ''))
  const result = assertSocialSuccess(await client.withPat(`/api/social/v1/accounts/${id}?provider=${provider}`, { method: 'DELETE' }))
  if (!result || typeof result !== 'object' || result.success !== true) {
    const message = typeof result?.message === 'string' && result.message.trim()
      ? result.message.trim()
      : 'official disconnect failed'
    throw new OmnimuxError('omnimux-request-failed', message)
  }
  return result
}

/**
 * Fetch current social seat billing summary and vacant seats list.
 * @param {{ withPat: Function }} client
 */
export async function getSeats(client) {
  const raw = assertSocialSuccess(await client.withPat('/api/social/v1/seats'))
  const view = pickSeatsView(raw)
  if (!view) {
    throw new OmnimuxError('omnimux-invalid-response', 'social seats payload is invalid')
  }
  return view
}

/**
 * Manually renew (or activate) a connected account's seat by +30 days.
 * UI-Only route: never registered as an autonomous Agent tool.
 * @param {{ withPat: Function }} client
 * @param {{ id?: string | number, provider?: unknown }} args
 */
export async function renewAccountSeat(client, args = {}) {
  const provider = requireSocialProvider(args.provider)
  const rawId = typeof args.id === 'number' ? String(args.id) : String(args.id ?? '').trim()
  if (!rawId) {
    throw new OmnimuxError('invalid-account-id', 'account id is required', { status: 400 })
  }
  const id = encodeURIComponent(rawId)
  const raw = assertSocialSuccess(await client.withPat(`/api/social/v1/accounts/${id}/renew?provider=${provider}`, {
    method: 'POST',
    body: { provider },
  }))
  const view = pickRenewView(raw)
  if (!view) {
    throw new OmnimuxError('omnimux-invalid-response', 'social seat renew payload is invalid')
  }
  return view
}
