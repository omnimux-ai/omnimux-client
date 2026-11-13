/**
 * Programmatic click of the official sidebar "新会话" control.
 * Aligns with conversation-box.js `shellNewSessionControl`. DOM click only.
 *
 * Collapsed rail: hub intercepts `button[class*=newSession]` (and the topbar
 * twin) and opens `#omnimux-sidebar-new-menu`. Real new-session happens only
 * after the "新建会话" menuitem click. This helper mirrors that gesture.
 */
export const NEW_SESSION_WAIT_MS = 1500
export const NEW_SESSION_POLL_MS = 50

/** Official `sessions` client service injected into this plugin at apply time. */
let officialSessions = null

/**
 * Bind the official public sessions service. This is scoped to the inspiration
 * client module; it is not an attachment-store fallback or a cross-plugin queue.
 * @param {unknown} sessions
 */
export function bindOfficialSessions(sessions) {
  officialSessions = sessions || null
}

const SESSION_MENU_RE = /新会话|新建会话|new session/i
const PROJECT_MENU_RE = /新建项目|create project|new project/i

function resolveDoc(doc) {
  if (doc) return doc
  return typeof document !== 'undefined' ? document : null
}

function isVisible(el) {
  if (!el) return false
  if (typeof el.getClientRects !== 'function') return true
  try {
    return el.getClientRects().length > 0
  } catch {
    return true
  }
}

function isTopbarNewSession(button) {
  if (!button) return false
  if (typeof button.getAttribute === 'function') {
    const value = button.getAttribute('data-omnimux-topbar-new-session')
    if (value != null && value !== 'false' && value !== '0') return true
  }
  if (typeof button.hasAttribute === 'function'
    && button.hasAttribute('data-omnimux-topbar-new-session')) {
    return true
  }
  if (typeof button.closest === 'function') {
    if (button.closest('[data-omnimux-topbar-new-session="1"]')) return true
    if (button.closest('[data-omnimux-topbar-new-session]')) return true
  }
  return false
}

function matchesOfficialNewSession(button) {
  if (!button || typeof button.getAttribute !== 'function') return false
  if (isTopbarNewSession(button)) return false
  if (typeof button.closest === 'function') {
    if (button.closest('#omnimux-sidebar-new-menu')) return false
    if (button.closest('[role="treeitem"]')) return false
  }
  if (String(button.className || '').includes('newSession')) return true
  const aria = String(button.getAttribute('aria-label') || '').trim()
  return /^(新建会话|新会话|New session)$/i.test(aria)
}

/**
 * @param {Document | { querySelectorAll?: Function, querySelector?: Function } | null | undefined} [doc]
 * @returns {HTMLElement | null}
 */
export function findNewSessionButton(doc) {
  const d = resolveDoc(doc)
  if (!d) return null
  const list = typeof d.querySelectorAll === 'function'
    ? Array.from(d.querySelectorAll('button'))
    : (typeof d.querySelector === 'function' ? [d.querySelector('button')].filter(Boolean) : [])
  const hits = list.filter((el) => matchesOfficialNewSession(el))
  if (hits.length === 0) return null
  const classHits = hits.filter((el) => String(el.className || '').includes('newSession'))
  const pool = classHits.length > 0 ? classHits : hits
  const visible = pool.find((el) => isVisible(el))
  return visible || pool[0]
}

/**
 * Resolve the official per-workspace new-session control only when it is
 * unambiguous. This preserves the official action while avoiding the generic
 * action's no-current/no-recent clear path in a single-workspace baseline.
 * @param {Document | { querySelectorAll?: Function, querySelector?: Function } | null | undefined} [doc]
 * @returns {HTMLElement | null}
 */
export function findSingleWorkspaceNewSessionButton(doc) {
  const d = resolveDoc(doc)
  if (!d || typeof d.querySelectorAll !== 'function') return null
  const matches = Array.from(d.querySelectorAll('button')).filter((button) => {
    if (!isVisible(button) || typeof button.getAttribute !== 'function') return false
    const aria = String(button.getAttribute('aria-label') || '').trim()
    return /^(在.+中新建会话|New session in .+)$/i.test(aria)
  })
  return matches.length === 1 ? matches[0] : null
}

function menuItemLabel(el) {
  if (!el) return ''
  const text = el.textContent
  if (text != null && String(text).trim()) return String(text).trim()
  if (typeof el.getAttribute === 'function') {
    return String(el.getAttribute('aria-label') || '').trim()
  }
  return ''
}

function isNewSessionMenuItem(el) {
  if (!el) return false
  const label = menuItemLabel(el)
  if (!label) return false
  if (PROJECT_MENU_RE.test(label)) return false
  return SESSION_MENU_RE.test(label)
}

function queryMenuItems(doc) {
  const d = resolveDoc(doc)
  if (!d) return []
  if (typeof d.querySelector === 'function') {
    const menu = d.querySelector('#omnimux-sidebar-new-menu')
    if (menu && typeof menu.querySelectorAll === 'function') {
      return Array.from(menu.querySelectorAll('[role="menuitem"]'))
    }
  }
  if (typeof d.querySelectorAll === 'function') {
    return Array.from(d.querySelectorAll('#omnimux-sidebar-new-menu [role="menuitem"]'))
  }
  return []
}

/**
 * Session row inside the collapsed-rail menu. Never the project item.
 * @param {Document | { querySelectorAll?: Function, querySelector?: Function } | null | undefined} [doc]
 * @returns {HTMLElement | null}
 */
export function findNewSessionMenuItem(doc) {
  return queryMenuItems(doc).find((el) => isNewSessionMenuItem(el)) || null
}

function clickIfPossible(el, beforeClick) {
  if (!el || typeof el.click !== 'function') return false
  if (typeof beforeClick === 'function') beforeClick()
  el.click()
  return true
}

function sessionSnapshot(sessions) {
  const list = sessions && sessions.list
  if (!list || typeof list.getSnapshot !== 'function') return null
  try {
    return list.getSnapshot()
  } catch {
    return null
  }
}

function resolvedOfficialTarget(sessions, beforeId) {
  const snapshot = sessionSnapshot(sessions)
  const sessionId = snapshot?.current
  if (!sessionId || typeof sessionId !== 'string') return null
  const summary = snapshot.byId?.[sessionId]
  // `blank` is the official SessionSummary lifecycle bit. It proves that this
  // selected target is a legal new-session result, including blank reuse.
  if (!summary || summary.blank !== true) return null
  return {
    ok: true,
    sessionId,
    reusedBlank: sessionId === beforeId,
  }
}

/**
 * Only `button.click()` / menuitem.click(). Never the sessions API.
 * Collapsed rail: click the already-open session menuitem, or click the
 * official `.newSession` then the session menuitem once the menu appears.
 * @param {{
 *   document?: unknown,
 *   window?: unknown,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   sessions?: { list?: { getSnapshot?: () => unknown, subscribe?: (listener: () => void) => (() => void) } },
 *   timeoutMs?: number,
 *   pollMs?: number,
 * }} [opts]
 * @returns {Promise<{ ok: true, sessionId: string, reusedBlank?: boolean } | { ok: false, error: 'newSessionFailed' }>}
 */
export async function clickOfficialNewSession(opts = {}) {
  const doc = resolveDoc(opts.document)
  const sessions = opts.sessions || officialSessions
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : NEW_SESSION_WAIT_MS
  const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : NEW_SESSION_POLL_MS
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const sleep = typeof opts.sleep === 'function'
    ? opts.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const list = sessions?.list
  if (!list || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') {
    return { ok: false, error: 'newSessionFailed' }
  }
  const beforeId = sessionSnapshot(sessions)?.current || ''
  const hasOfficialCurrent = Boolean(beforeId)
  let directActionPending = false
  let menuActionDispatched = false
  let observedTarget = null
  const unsubscribe = list.subscribe(() => {
    if (!directActionPending && !menuActionDispatched) return
    observedTarget = resolvedOfficialTarget(sessions, beforeId)
  })
  const dispatchMenu = (el) => clickIfPossible(el, () => { menuActionDispatched = true })
  const dispatchButton = (el) => clickIfPossible(el, () => { directActionPending = true })

  try {
    let clickedMenu = dispatchMenu(findNewSessionMenuItem(doc))
    if (!clickedMenu) {
      // The generic action clears selection when this L2 runtime has neither a
      // current session nor a projected recent workspace. Its single visible
      // workspace control is the official explicit-target action and therefore
      // the only reliable product-equivalent gesture for this baseline.
      const button = !hasOfficialCurrent
        ? (findSingleWorkspaceNewSessionButton(doc) || findNewSessionButton(doc))
        : findNewSessionButton(doc)
      if (!button || typeof button.click !== 'function') {
        return { ok: false, error: 'newSessionFailed' }
      }
      dispatchButton(button)
      // Menu may open synchronously (collapsed rail interceptor).
      const menuItem = findNewSessionMenuItem(doc)
      if (menuItem) {
        // The button was a menu opener, not the session action. Discard any
        // selection projection it observed and wait for the menuitem gesture.
        directActionPending = false
        observedTarget = null
        clickedMenu = dispatchMenu(menuItem)
      }
    }

    const started = now()
    while (now() - started < timeoutMs) {
      if (!clickedMenu) {
        const menuItem = findNewSessionMenuItem(doc)
        if (menuItem) {
          directActionPending = false
          observedTarget = null
          clickedMenu = dispatchMenu(menuItem)
        }
      }
      if (observedTarget) return observedTarget
      await sleep(pollMs)
    }
    return observedTarget || { ok: false, error: 'newSessionFailed' }
  } finally {
    try { unsubscribe() } catch { /* public-store cleanup */ }
  }
}
