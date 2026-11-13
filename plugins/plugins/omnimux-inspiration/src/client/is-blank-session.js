/**
 * Blank-session heuristics copied from the market composer (do NOT import market).
 * `hasAnySession` is this package's stricter gate so a missing header is not
 * treated as a reusable blank chat.
 *
 * Welcome chrome (slogan, workspace switcher, composer placeholder) can make
 * `[data-conversation-scroll]` longer than 40 chars with no real turns. Treat
 * "no user/assistant message nodes" as blank so one-click replicate reuses it.
 */

function resolveDoc(doc, argsLength) {
  if (argsLength === 0) {
    return typeof document !== 'undefined' ? document : undefined
  }
  return doc
}

function resolveWindow(doc) {
  if (doc && doc.defaultView) return doc.defaultView
  if (typeof window !== 'undefined') return window
  return undefined
}

const MESSAGE_NODE_SELECTORS = [
  '[data-role="user"]',
  '[data-role="assistant"]',
  '[data-message-role]',
  '[data-turn-role]',
  '[data-message-id]',
  '[data-slot*="message"]',
]

function isComposerOrChrome(el) {
  if (!el) return true
  const tag = String(el.tagName || '').toLowerCase()
  if (tag === 'textarea' || tag === 'input' || tag === 'button') return true
  if (typeof el.closest === 'function') {
    try {
      if (el.closest('textarea, input, button')) return true
    } catch {
      return false
    }
  }
  return false
}

function queryAll(root, selector) {
  if (!root) return []
  if (typeof root.querySelectorAll === 'function') {
    try {
      return Array.from(root.querySelectorAll(selector))
    } catch {
      return []
    }
  }
  if (typeof root.querySelector === 'function') {
    try {
      const one = root.querySelector(selector)
      return one ? [one] : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Real user/assistant turns inside the conversation scroll region.
 * Composer, buttons, and workspace-switch copy must not count.
 * @param {{ querySelector?: Function, querySelectorAll?: Function } | null | undefined} scroll
 * @returns {boolean}
 */
function hasRealConversationMessages(scroll) {
  if (!scroll) return false
  for (const selector of MESSAGE_NODE_SELECTORS) {
    for (const hit of queryAll(scroll, selector)) {
      if (!isComposerOrChrome(hit)) return true
    }
  }
  return false
}

/**
 * Align with market composer.js. No document → true (SSR / unit tests).
 * Production is gated by `hasAnySession` first.
 * @param {Document | { querySelector?: Function } | null | undefined} [doc]
 * @returns {boolean}
 */
export function isBlankSession(doc) {
  const d = resolveDoc(doc, arguments.length)
  if (!d || typeof d.querySelector !== 'function') return true
  const header = d.querySelector('[data-slot="conversation.session.header"]')
  const title = (header && header.textContent) || ''
  if (/新会话|New session|Untitled/i.test(title)) return true
  const scroll = d.querySelector('[data-conversation-scroll]')
  if (!scroll) return true
  if (!hasRealConversationMessages(scroll)) return true
  return (scroll.textContent || '').trim().length < 40
}

/**
 * True when a real conversation exists (header, sidebar row, or active id).
 * Missing chrome + `default` active id → false (noSession).
 * @param {Document | { querySelector?: Function, defaultView?: object } | null | undefined} [doc]
 * @returns {boolean}
 */
export function hasAnySession(doc) {
  const d = resolveDoc(doc, arguments.length)
  if (d && typeof d.querySelector === 'function') {
    if (d.querySelector('[data-slot="conversation.session.header"]')) return true
    if (d.querySelector('[role="treeitem"]')) return true
  }
  const win = resolveWindow(d)
  const getter = win && win.__omnimuxAttachments && win.__omnimuxAttachments.getActiveSessionId
  const id = typeof getter === 'function' ? getter.call(win.__omnimuxAttachments) : ''
  return Boolean(id) && String(id) !== 'default'
}
