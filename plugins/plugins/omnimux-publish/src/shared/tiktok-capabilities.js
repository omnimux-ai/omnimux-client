/**
 * Browser-safe TikTok account capability helpers shared by Host and Client.
 *
 * Gateway GET /api/social/v1/accounts returns:
 *   capabilities: { upload_draft: boolean, publish_direct: boolean }
 * Legacy gateways omit `capabilities`, which degrades safely to `legacy_unknown`.
 */
import { isObject } from './values.js'

/** @typedef {{ upload_draft?: boolean, publish_direct?: boolean, max_media_items?: number, max_images?: number }} AccountCapabilities */
/** @typedef {'draft_only' | 'direct' | 'no_publish_scope' | 'legacy_unknown'} AccountPublishMode */

/**
 * Whitelist-copy account publishing capabilities.
 * Returns undefined when absent or malformed so legacy responses stay distinguishable.
 * @param {unknown} raw
 * @returns {AccountCapabilities | undefined}
 */
export function pickAccountCapabilities(raw) {
  if (!isObject(raw)) return undefined
  /** @type {AccountCapabilities} */
  const out = {}
  if (typeof raw.upload_draft === 'boolean') out.upload_draft = raw.upload_draft
  if (typeof raw.publish_direct === 'boolean') out.publish_direct = raw.publish_direct
  if (typeof raw.max_media_items === 'number' && Number.isInteger(raw.max_media_items) && raw.max_media_items > 0) {
    out.max_media_items = raw.max_media_items
  }
  if (typeof raw.max_images === 'number' && Number.isInteger(raw.max_images) && raw.max_images > 0) {
    out.max_images = raw.max_images
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Read an explicit server-supplied per-post media item limit from account capabilities if present.
 * @param {Record<string, unknown> | null | undefined} account
 * @returns {number | undefined}
 */
export function accountMaxMediaItems(account) {
  const caps = account && isObject(account.capabilities) ? account.capabilities : null
  if (!caps) return undefined
  if (typeof caps.max_media_items === 'number' && Number.isInteger(caps.max_media_items) && caps.max_media_items > 0) {
    return caps.max_media_items
  }
  if (typeof caps.max_images === 'number' && Number.isInteger(caps.max_images) && caps.max_images > 0) {
    return caps.max_images
  }
  return undefined
}

/**
 * Derive publishing mode for one TikTok direct account.
 * - `publish_direct === true` -> `'direct'`
 * - `upload_draft === true && publish_direct !== true` -> `'draft_only'`
 * - explicit `{ upload_draft: false, publish_direct: false }` -> `'no_publish_scope'`
 * - missing/partial legacy `capabilities` -> `'legacy_unknown'`
 * @param {Record<string, unknown> | null | undefined} account
 * @returns {AccountPublishMode}
 */
export function accountPublishMode(account) {
  const caps = account && isObject(account.capabilities) ? account.capabilities : null
  if (!caps) return 'legacy_unknown'
  if (caps.publish_direct === true) return 'direct'
  if (caps.upload_draft === true) return 'draft_only'
  if (caps.upload_draft === false && caps.publish_direct === false) return 'no_publish_scope'
  return 'legacy_unknown'
}

/**
 * Derive aggregate publishing mode for the currently selected TikTok accounts.
 * - Any `no_publish_scope` -> `'no_publish_scope'` (fail-closed)
 * - Any `direct` -> `'direct'` (preserve Direct Post form & creator-info)
 * - Non-empty and every selected account is `draft_only` -> `'draft_only'` (zero creator-info)
 * - Otherwise (empty selection or legacy accounts missing capabilities) -> `'legacy_unknown'`
 * @param {Array<Record<string, unknown>> | null | undefined} accounts
 * @returns {AccountPublishMode}
 */
export function resolveSelectionPublishMode(accounts) {
  const rows = Array.isArray(accounts) ? accounts.filter(isObject) : []
  if (rows.length === 0) return 'legacy_unknown'
  const modes = rows.map(accountPublishMode)
  if (modes.includes('no_publish_scope')) return 'no_publish_scope'
  if (modes.includes('direct')) return 'direct'
  if (modes.every((mode) => mode === 'draft_only')) return 'draft_only'
  return 'legacy_unknown'
}
