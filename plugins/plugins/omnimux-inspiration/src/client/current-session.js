/**
 * Host-provided current-session read ports for the inspiration client.
 *
 * rc.3 removed `current` from the official `SessionListState` (ids / byId /
 * phase / projectionsBySession). Every inspiration flow that needs "the
 * session the user is looking at" must read one of the host-owned seams
 * instead of the retired list field.
 */

/** Host sentinels for "no session bound yet"; never a valid attachment target. */
const UNBOUND_SESSION_IDS = new Set(['default', '__none__', 'undefined', 'null'])

export function normalizeSessionId(value) {
  let id = ''
  if (typeof value === 'string') id = value.trim()
  else if (typeof value === 'number' && Number.isFinite(value)) id = String(value)
  return UNBOUND_SESSION_IDS.has(id) ? '' : id
}

function read(source) {
  try {
    return typeof source === 'function' ? source() : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the active conversation through the legal host read ports, in order:
 * workbench snapshot `sessionId` → workbench `getCurrentSessionId()` →
 * attachment store `getActiveSessionId()`. Read lazily on every call — the
 * shell's session can change between clicks.
 * @param {Window | undefined} windowObject
 * @returns {string}
 */
export function resolveCurrentSessionId(windowObject) {
  const workbench = windowObject?.__omnimuxWorkbench
  const fromSnapshot = normalizeSessionId(read(() => workbench?.getSnapshot?.())?.sessionId)
  if (fromSnapshot) return fromSnapshot
  const fromWorkbench = normalizeSessionId(read(() => workbench?.getCurrentSessionId?.()))
  if (fromWorkbench) return fromWorkbench
  return normalizeSessionId(read(() => windowObject?.__omnimuxAttachments?.getActiveSessionId?.()))
}
