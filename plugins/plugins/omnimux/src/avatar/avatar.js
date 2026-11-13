/** Deterministic profile avatar: blobatar over the OmniMux identity, with persisted overrides. */

import { randomUUID } from 'node:crypto'
import { blobatarUri } from 'blobatar/uri'

/** Preset hues offered by the avatar picker, in degrees. Mirrored in src/client/ProfileSection.jsx. */
export const HUES = [12, 90, 150, 210, 280, 320]

export const BACKGROUNDS = ['squircle', 'circle', 'square']

export const MAX_SEED = 64

/** Uploaded images cap the persisted document and the data URI the browser caches. */
export const MAX_UPLOAD_BYTES = 200 * 1024

/** Invalid avatar option values. Message is safe to surface to the browser. */
export class AvatarOptionsError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'AvatarOptionsError'
  }
}

/**
 * Validates a raw option object and returns only the accepted keys.
 * Unknown keys are dropped; invalid values throw AvatarOptionsError.
 * @param {unknown} raw
 * @returns {{ seed?: string, hue?: number, tone?: number, background?: string }}
 */
export function parseAvatarOptions(raw) {
  const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  /** @type {{ seed?: string, hue?: number, tone?: number, background?: string }} */
  const out = {}
  if (row.seed !== undefined) {
    if (typeof row.seed !== 'string') throw new AvatarOptionsError('seed must be a string')
    const seed = row.seed.trim()
    if (seed.length === 0 || seed.length > MAX_SEED) {
      throw new AvatarOptionsError(`seed must be 1-${MAX_SEED} characters`)
    }
    out.seed = seed
  }
  if (row.hue !== undefined) {
    if (typeof row.hue !== 'number' || !Number.isFinite(row.hue)) {
      throw new AvatarOptionsError('hue must be a number')
    }
    const hue = Math.round(row.hue)
    if (hue < 0 || hue > 360) throw new AvatarOptionsError('hue must be within 0-360')
    out.hue = hue
  }
  if (row.tone !== undefined) {
    if (typeof row.tone !== 'number' || !Number.isFinite(row.tone)) {
      throw new AvatarOptionsError('tone must be a number')
    }
    if (row.tone < 0 || row.tone >= 1) throw new AvatarOptionsError('tone must be within 0-1')
    out.tone = row.tone
  }
  if (row.background !== undefined) {
    if (typeof row.background !== 'string' || !BACKGROUNDS.includes(row.background)) {
      throw new AvatarOptionsError(`background must be one of ${BACKGROUNDS.join(', ')}`)
    }
    out.background = row.background
  }
  return out
}

/**
 * The seed rendered for a profile: a persisted override wins, otherwise the
 * username, otherwise the numeric id, otherwise a constant fallback. Every
 * profile that never customizes therefore renders the same avatar forever.
 * @param {{ username?: unknown, id?: unknown }} profile
 * @param {{ seed?: unknown }} [stored]
 */
export function avatarSeed(profile, stored = {}) {
  if (typeof stored.seed === 'string' && stored.seed) return stored.seed
  if (typeof profile?.username === 'string' && profile.username.trim()) return profile.username
  if (profile?.id != null && String(profile.id).trim()) return String(profile.id)
  return 'omnimux'
}

/**
 * Data URI for one avatar from validated options.
 * @param {string} seed
 * @param {{ hue?: number, tone?: number, background?: string }} [opts]
 */
export function renderAvatarUri(seed, opts = {}) {
  return blobatarUri(seed, {
    ...(opts.hue !== undefined ? { hue: opts.hue } : {}),
    ...(opts.tone !== undefined ? { tone: opts.tone } : {}),
    ...(opts.background !== undefined ? { background: opts.background } : {}),
  })
}

/**
 * The renderable option subset of a stored row.
 * @param {Record<string, unknown>} stored
 * @returns {{ hue?: number, tone?: number, background?: string }}
 */
export function buildAvatarOptions(stored) {
  /** @type {{ hue?: number, tone?: number, background?: string }} */
  const out = {}
  if (typeof stored.hue === 'number' && Number.isFinite(stored.hue)) out.hue = stored.hue
  if (typeof stored.tone === 'number' && Number.isFinite(stored.tone)) out.tone = stored.tone
  if (typeof stored.background === 'string' && BACKGROUNDS.includes(stored.background)) {
    out.background = stored.background
  }
  return out
}

/**
 * The public avatar view. A stored snapshot URI wins (bake-once: library
 * upgrades never move a customized avatar); the default is rendered fresh
 * from the deterministic seed.
 * @param {{ username?: unknown, id?: unknown }} profile
 * @param {Record<string, unknown>} [stored]
 */
export function buildAvatarView(profile, stored = {}) {
  const opts = buildAvatarOptions(stored)
  const seed = avatarSeed(profile, stored)
  const uri = typeof stored.snapshot_uri === 'string'
    ? stored.snapshot_uri
    : renderAvatarUri(seed, opts)
  return {
    uri,
    name: seed,
    opts,
    using_default: typeof stored.snapshot_uri !== 'string',
  }
}

/**
 * A fresh random seed for "换一个". The persisted seed is what makes the
 * rerolled avatar stable across reloads.
 */
export function newRandomSeed() {
  return randomUUID()
}

/**
 * Validates an uploaded avatar image. Accepts a base64 data URI for a raster
 * image type; rejects anything else. SVG is excluded: an uploaded SVG is a
 * document that can carry script, while the generated blobatar URI is ours.
 * @param {unknown} raw
 * @returns {string} the data URI
 */
export function parseAvatarUpload(raw) {
  if (typeof raw !== 'string') throw new AvatarOptionsError('upload must be a data URI string')
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!match) throw new AvatarOptionsError('upload must be a png/jpeg/webp/gif base64 data URI')
  const bytes = Buffer.byteLength(match[2], 'base64')
  if (bytes === 0) throw new AvatarOptionsError('upload is empty')
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new AvatarOptionsError(`upload must be under ${Math.floor(MAX_UPLOAD_BYTES / 1024)}KB`)
  }
  return raw
}
