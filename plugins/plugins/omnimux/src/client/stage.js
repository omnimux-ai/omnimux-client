/**
 * Product-stage global singleton for the first-level OmniMux pages.
 *
 * Installed on `window.__omnimuxStage` at module top-level so it exists as
 * soon as the hub client bundle is evaluated — before any vertical plugin's
 * `apply()` runs. Vertical plugins read it via `window.__omnimuxStage`
 * instead of shipping a copy or depending on cross-plugin client service
 * ordering. Only the hub owns the chrome style and the document click
 * listener; consumers only call claim/release.
 */
import {
  PRODUCT_STAGE_EVENT,
  claimProductStage,
  readConversationBox,
  releaseProductStage,
} from './conversation-box.js'

/** Global key the hub installs and vertical plugins read. */
export const STAGE_GLOBAL_KEY = '__omnimuxStage'

/**
 * Install the shared product-stage API on the window global. Idempotent: the
 * hub bundle is evaluated once per page, so this runs at most once.
 * @param {Window & { [STAGE_GLOBAL_KEY]?: unknown }} target
 * @returns {unknown} the installed singleton.
 */
export function installStageGlobal(target = window) {
  const existing = target[STAGE_GLOBAL_KEY]
  if (existing !== undefined) return existing
  const api = {
    claim: claimProductStage,
    release: releaseProductStage,
    PRODUCT_STAGE_EVENT,
    readBox: readConversationBox,
  }
  target[STAGE_GLOBAL_KEY] = api
  return api
}

installStageGlobal()
