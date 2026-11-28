import { OmnimuxError } from '../media/errors.js'

/** @typedef {'tiktok_direct' | 'zernio'} SocialProvider */

export const SOCIAL_SEAT_QUOTA_CODE = 'SOCIAL_SEAT_QUOTA'
export const SOCIAL_SEAT_CONFLICT_CODES = Object.freeze([
  'SOCIAL_SEAT_CAP',
  'SOCIAL_SEAT_EXPIRED',
  'SOCIAL_SEAT_RENEW_LIMIT',
  'SOCIAL_SEAT_SWAP_LIMIT',
])

/**
 * Extract structured numeric/code fields from a gateway seat error body.
 * @param {unknown} raw
 * @returns {{ code?: string, need_credits?: number, max_validity_days?: number }}
 */
export function extractSocialSeatDetails(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = /** @type {Record<string, unknown>} */ (raw)
  /** @type {{ code?: string, need_credits?: number, max_validity_days?: number }} */
  const details = {}
  if (typeof src.code === 'string' && src.code.trim() !== '') {
    details.code = src.code.trim()
  }
  if (typeof src.need_credits === 'number' && Number.isFinite(src.need_credits) && src.need_credits > 0) {
    details.need_credits = src.need_credits
  }
  if (typeof src.max_validity_days === 'number' && Number.isFinite(src.max_validity_days) && src.max_validity_days > 0) {
    details.max_validity_days = src.max_validity_days
  }
  return details
}

/**
 * Append a structured tail tag on tool-surface social seat errors so the DSH
 * tool harness (which serializes thrown errors to text) preserves the machine
 * error code and numeric details for downstream callers such as omnimux-publish.
 * @param {OmnimuxError} error
 * @returns {OmnimuxError}
 */
export function formatSocialSeatToolError(error) {
  const details = error.details && typeof error.details === 'object'
    ? /** @type {Record<string, unknown>} */ (error.details)
    : null
  const isConflict = SOCIAL_SEAT_CONFLICT_CODES.includes(error.code)
  const isSeatQuota = error.code === 'quota-exceeded' && details?.code === SOCIAL_SEAT_QUOTA_CODE
  if (!isConflict && !isSeatQuota) return error
  const seatCode = isSeatQuota ? SOCIAL_SEAT_QUOTA_CODE : error.code
  if (error.message.includes(`code=${seatCode}`)) return error
  const parts = [`code=${seatCode}`]
  if (typeof details?.need_credits === 'number' && Number.isFinite(details.need_credits) && details.need_credits > 0) {
    parts.push(`need_credits=${details.need_credits}`)
  }
  if (typeof details?.max_validity_days === 'number' && Number.isFinite(details.max_validity_days) && details.max_validity_days > 0) {
    parts.push(`max_validity_days=${details.max_validity_days}`)
  }
  return new OmnimuxError(error.code, `${error.message} [${parts.join(' ')}]`, {
    status: error.status,
    details: error.details,
  })
}

/** @param {unknown} value @returns {SocialProvider} */
export function requireSocialProvider(value) {
  if (value !== 'tiktok_direct' && value !== 'zernio') {
    throw new OmnimuxError('invalid-provider', 'provider must be tiktok_direct or zernio', { status: 400 })
  }
  return value
}

/** @param {Record<string, unknown>} row @param {SocialProvider} provider */
export function matchesSocialProvider(row, provider) {
  return row.provider === provider && (provider !== 'tiktok_direct' || row.platform === 'tiktok')
}

/** API errors may also arrive in an HTTP 200 envelope. @param {unknown} raw */
export function assertSocialSuccess(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.success === false) {
    if (raw.code === SOCIAL_SEAT_QUOTA_CODE) {
      throw new OmnimuxError(
        'quota-exceeded',
        String(raw.message || '当前操作需要更多额度，充值后即可继续使用 OmniMux。').trim(),
        { status: 402, details: { kind: 'quota-exceeded', ...extractSocialSeatDetails(raw) } },
      )
    }
    if (SOCIAL_SEAT_CONFLICT_CODES.includes(raw.code)) {
      throw new OmnimuxError(raw.code, String(raw.message || raw.code).trim(), {
        status: 409,
        details: extractSocialSeatDetails(raw),
      })
    }
    const code = ['invalid-provider', 'account-provider-mismatch', 'post-provider-mismatch'].includes(raw.code)
      ? raw.code : 'omnimux-request-failed'
    throw new OmnimuxError(code, String(raw.message || 'social request failed').trim(), {
      status: code === 'invalid-provider' ? 400 : code.endsWith('-mismatch') ? 409 : 502,
    })
  }
  return raw
}
