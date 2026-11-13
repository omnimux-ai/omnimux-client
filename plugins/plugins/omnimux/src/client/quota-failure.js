import { DEFAULT_SITE, joinUrl } from '../auth/omnimux-auth.js'
export { hasQuotaEvidence, QUOTA_EXCEEDED_CODE } from '../errors/quota-classifier.js'
import { hasQuotaEvidence } from '../errors/quota-classifier.js'

/** OmniMux wallet path on the signed-in site. */
export const WALLET_PATH = '/wallet'

/**
 * Whether a turn failure is an exhausted-quota / pre-deduct miss.
 * Matches the gateway wording even when the harness stored the event as AUTH.
 * @param {unknown} failure
 */
export function isQuotaFailure(failure) {
  if (failure === null || typeof failure !== 'object') return false
  return hasQuotaEvidence(failure)
}

/**
 * Wallet URL for the signed-in OmniMux site.
 * @param {unknown} baseUrl profile.base_url or site override
 */
export function walletUrl(baseUrl) {
  const base = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_SITE
  return joinUrl(base, WALLET_PATH)
}

/**
 * Select the turn-tail chain entry only when this turn ended on a quota miss.
 * @param {{ turn?: { end?: { data?: { reason?: { kind?: string, error?: unknown } } } } }} owner
 * @returns {true | null}
 */
export function selectQuotaTurn(owner) {
  const end = owner?.turn?.end
  if (!end || end.data?.reason?.kind !== 'error') return null
  return isQuotaFailure(end.data.reason.error) ? true : null
}
