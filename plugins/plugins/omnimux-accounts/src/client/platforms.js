/**
 * Platform registry for the Accounts app. The list is a frontend constant for
 * now (design §7 待明确): when the site grows a platform-directory endpoint this
 * is the single point to swap. Official brand colors go through
 * `var(--dsw-platform-*, #hex)` so the theme can override them; the
 * neutral entries stay on dsw alias tokens.
 *
 * tone:
 *   solid  — dark brand color as the chip background, white label (TikTok / X)
 *   accent — brand color as the label on a 16% color-mix background
 */

export const SUPPORTED_PLATFORMS = Object.freeze(['tiktok', 'instagram', 'youtube'])

export const COMING_PLATFORMS = Object.freeze(['x', 'facebook'])

/** @typedef {{ id: string, color: string, tone: 'solid' | 'accent', coming: boolean }} PlatformInfo */

const NEUTRAL_COLOR = 'var(--dsw-alias-label-secondary, rgba(255,255,255,0.72))'

/** @type {Record<string, PlatformInfo>} */
const REGISTRY = {
  tiktok: { id: 'tiktok', color: 'var(--dsw-platform-tiktok, #2C2C2A)', tone: 'solid', coming: false },
  instagram: { id: 'instagram', color: 'var(--dsw-platform-instagram, #E1306C)', tone: 'accent', coming: false },
  youtube: { id: 'youtube', color: 'var(--dsw-platform-youtube, #FF0000)', tone: 'accent', coming: false },
  x: { id: 'x', color: 'var(--dsw-platform-x, #2C2C2A)', tone: 'solid', coming: true },
  facebook: { id: 'facebook', color: NEUTRAL_COLOR, tone: 'accent', coming: true },
}

/**
 * Registry lookup with a neutral fallback for platforms the site may return
 * but the registry does not know yet.
 * @param {unknown} platform
 * @returns {PlatformInfo}
 */
export function platformInfo(platform) {
  const id = typeof platform === 'string' ? platform.trim().toLowerCase() : ''
  return REGISTRY[id] ?? { id: id || 'unknown', color: NEUTRAL_COLOR, tone: 'accent', coming: false }
}
