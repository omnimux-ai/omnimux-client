/**
 * Empty-session hero brand-mark slot. Preferred path over the DOM overlay
 * `coverHeroFish` fallback: occupy the official single cell at a lower
 * priority so OmniMux wins the shadowing rank (lowest renders).
 */

import { configFromWindow } from '../brand/overlay.js'
import { DEFAULT_CONFIG, DEFAULT_LOGO_SVG } from '../brand/defaults.js'

/** Official conversation hero brand-mark slot. */
export const HERO_BRAND_SLOT = 'conversation.hero.brand.mark'

/**
 * Shadowing rank. Official `ui-brand-official` registers at default 0;
 * lowest priority renders for a single cell.
 */
export const HERO_BRAND_PRIORITY = -10

/** Occupant id so a second same-priority registration fails loudly. */
export const HERO_BRAND_ID = 'omnimux-hero-brand-mark'

/**
 * Size the hero mark to the host-supplied square edge.
 * @param {unknown} size Requested square edge in pixels.
 * @param {string | undefined} className Host CSS class (color / hover motion).
 * @returns {{ width: number, height: number, className: string | undefined }}
 */
export function heroMarkPresentation(size, className) {
  const px = typeof size === 'number' ? size : Number(size)
  const edge = Number.isFinite(px) && px > 0 ? px : 34
  return {
    width: edge,
    height: edge,
    className: typeof className === 'string' && className !== '' ? className : undefined,
  }
}

/**
 * Split an SVG document into viewBox + inner markup for the React occupant.
 * @param {string} markup SVG document.
 * @returns {{ viewBox: string, inner: string }}
 */
export function parseLogoSvg(markup) {
  if (typeof markup !== 'string' || !markup.includes('<svg')) {
    throw new Error('omnimux: hero mark logoSvg must contain an <svg> document')
  }
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(markup)?.[1] ?? '0 0 32 32'
  const open = markup.search(/<svg\b/i)
  const innerStart = markup.indexOf('>', open) + 1
  const close = markup.toLowerCase().lastIndexOf('</svg>')
  const inner = (close === -1 ? markup.slice(innerStart) : markup.slice(innerStart, close)).trim()
  return { viewBox, inner }
}

/**
 * Logo document used by the slot occupant (boot payload, else bundled mark).
 * @param {Window | undefined} [win]
 * @returns {string}
 */
export function resolveHeroLogoSvg(win) {
  const target = win ?? (typeof window === 'undefined' ? undefined : window)
  if (target) {
    const svg = configFromWindow(target).logoSvg
    if (typeof svg === 'string' && svg.includes('<svg')) return svg
  }
  return DEFAULT_CONFIG.logoSvg ?? DEFAULT_LOGO_SVG
}

/**
 * Register OmniMux as the blank-session hero mark occupant.
 * No-ops when `replaceHeroMark` is false so the config still opts out.
 * @param {{ slots?: { inject: Function, register: Function } }} ctx Client context.
 * @param {unknown} component React occupant (`HeroBrandMark`).
 * @param {{ replaceHeroMark?: boolean } | undefined} [config] Overlay config; boot payload when omitted.
 */
export function installHeroBrandSlot(ctx, component, config) {
  const replace = config?.replaceHeroMark ?? (
    typeof window === 'undefined' ? DEFAULT_CONFIG.replaceHeroMark : configFromWindow(window).replaceHeroMark
  )
  if (!replace) return
  if (typeof ctx?.slots?.inject !== 'function' || typeof ctx.slots.register !== 'function') return
  ctx.slots.inject(HERO_BRAND_SLOT, () => ctx.slots.register({
    name: HERO_BRAND_SLOT,
    id: HERO_BRAND_ID,
    priority: HERO_BRAND_PRIORITY,
  }, component))
}
