/** Pure Apps-shelf action model: one fixed slot per card, menu for the rest. */

/**
 * The single primary control shown in a card's fixed action slot.
 * `installed` has no primary: destructive and open actions live in the overflow menu.
 * @param {string} state `available` | `installed` | `update`
 * @returns {'install' | 'update' | null}
 */
export function primaryActionFor(state) {
  if (state === 'available') return 'install'
  if (state === 'update') return 'update'
  return null
}

/**
 * Whether the overflow (`···`) button appears in the action slot.
 * @param {string} state
 */
export function hasOverflowMenu(state) {
  return state === 'installed' || state === 'update'
}

/**
 * Whether a card click or menu item may 打开 the app page: the app is
 * installed or one update away (`update` rows keep the pinned client on
 * disk, so the page still opens), ships a client, and no Host restart is
 * still pending.
 * @param {{ state?: string, client?: boolean }} app
 * @param {boolean} pendingRestart
 */
export function canOpen(app, pendingRestart) {
  const state = app?.state
  return (state === 'installed' || state === 'update') && app?.client === true && !pendingRestart
}

/**
 * Whether opening this app must pass the device-login gate first.
 * @param {{ capabilities?: unknown }} app
 */
export function needsIdentity(app) {
  return Array.isArray(app?.capabilities) && app.capabilities.includes('identity')
}
