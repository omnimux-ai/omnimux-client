/**
 * Card open flow: login gate → dispatch → wait for the app to claim the
 * product stage. Pure orchestration so PluginsSection and the sidebar tabs
 * can share one attempt shape.
 */

import { canOpen, needsIdentity } from './app-actions.js'
import { openApp, waitForStageClaim } from './open-app.js'
import { upsertAppTab } from './api.js'

/**
 * DOM event telling the sidebar tab rows to re-fetch. Lives here (not in
 * app-tabs.js) so open-app-flow never imports app-tabs and app-tabs can
 * import the constant one-way without a cycle.
 */
export const TABS_CHANGED_EVENT = 'omnimux-app-tabs-changed'

/**
 * @param {Window | undefined} [target]
 */
export function notifyTabsChanged(target) {
  const scope = target ?? (typeof window === 'undefined' ? undefined : window)
  if (scope === undefined || typeof scope.dispatchEvent !== 'function') return
  if (typeof CustomEvent === 'undefined') return
  scope.dispatchEvent(new CustomEvent(TABS_CHANGED_EVENT))
}

/**
 * Record the open in the Host tab store. Best-effort: a failed upsert must
 * never disturb the open experience, and the rows refresh on the next event.
 * @param {string} id
 */
function recordTab(id) {
  upsertAppTab(id).then((result) => {
    if (result.ok) notifyTabsChanged()
  }).catch(() => {})
}

/**
 * @param {{ id?: unknown, state?: string, client?: boolean, capabilities?: unknown }} app
 * @param {{
 *   pendingRestart?: boolean,
 *   readStage?: () => string | undefined,
 *   isLoggedIn?: boolean,
 * }} [opts]
 * @returns {Promise<{ kind: 'opened' | 'restart' | 'login' }>}
 */
export async function attemptOpen(app, opts = {}) {
  const pendingRestart = opts.pendingRestart === true
  const readStage = opts.readStage ?? defaultReadStage
  const id = typeof app?.id === 'string' ? app.id : ''
  if (!canOpen(app, pendingRestart) || id === '') return { kind: 'restart' }
  if (needsIdentity(app) && opts.isLoggedIn !== true) return { kind: 'login' }
  openApp(id)
  const claimed = await waitForStageClaim(readStage)
  if (!claimed) return { kind: 'restart' }
  recordTab(id)
  return { kind: 'opened' }
}

/**
 * @returns {string | undefined}
 */
function defaultReadStage() {
  return typeof document === 'undefined' ? undefined : document.documentElement.dataset.dshProductStage
}
