/**
 * Short-lived, session-bound Host media transfer tickets for Agent live edits.
 *
 * When `clip_edit` (`import_media` or `relink_media`) authorizes a `MediaHandleV1`
 * on the Host via `mediaResolver`, the Host mints an opaque transfer token bound to
 * the target session and project. The live editor fetches verified bytes from
 * `GET /omnimux-clip/api/media-transfer/:token` — never seeing host absolute paths.
 */
import { randomBytes } from 'node:crypto'
import { ClipDomainError } from '../errors.js'

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/u
const DEFAULT_TTL_MS = 120_000
const DEFAULT_MAX_ENTRIES = 256

export function createMediaTransferRegistry({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
} = {}) {
  const tickets = new Map()

  function sweep() {
    const current = now()
    for (const [token, entry] of tickets) {
      if (entry.expiresAt <= current) tickets.delete(token)
    }
    while (tickets.size > maxEntries) {
      const oldest = tickets.keys().next().value
      if (oldest === undefined) break
      tickets.delete(oldest)
    }
  }

  function mint({ handle, sha256, mimeType, size, displayName, sessionId, projectId, binding }) {
    sweep()
    const token = randomBytes(32).toString('base64url')
    tickets.set(token, {
      token,
      handle,
      sha256,
      mimeType,
      size,
      displayName,
      sessionId,
      projectId,
      binding,
      expiresAt: now() + ttlMs,
    })
    return {
      token,
      transferUrl: `/omnimux-clip/api/media-transfer/${token}`,
    }
  }

  function resolve({ token, sessionId }) {
    sweep()
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      throw ClipDomainError.pathDenied('Invalid media transfer token.')
    }
    const entry = tickets.get(token)
    if (!entry || entry.expiresAt <= now()) {
      tickets.delete(token)
      throw ClipDomainError.pathDenied('Media transfer authorization has expired.')
    }
    if (entry.sessionId && sessionId !== entry.sessionId) {
      throw ClipDomainError.pathDenied('Media transfer belongs to another conversation session.')
    }
    return entry
  }

  function clear() {
    tickets.clear()
  }

  return { mint, resolve, clear }
}
