/**
 * Official Composer bypass — copied from omnimux-market insertGesture,
 * but whole-field replace instead of caret insert.
 *
 * Replication only prefills the composer (set value + focus + caret at end).
 * The user decides when to send; this module never clicks the send button.
 *
 * Selector + contenteditable write path are copied (not imported) from hub
 * `composer-envelope.js`. Narrow contenteditable seats first; never a bare
 * `textarea` or bare `div[role=textbox]` (those hit library-page boxes).
 *
 * `document` is injected so node:test can drive a fake textarea / contenteditable.
 */

export const COMPOSER_SELECTOR = [
  '[data-composer-card] [contenteditable="true"]',
  '[data-composer-seat] [contenteditable="true"]',
  '[data-lexical-editor="true"]',
  '[data-composer-input="true"]',
  'div[role="textbox"][contenteditable="true"]',
  '[data-composer-card] textarea',
  '[data-composer-seat] textarea',
  'textarea[data-phase]',
  'textarea[placeholder]',
].join(', ')

export const SEND_SELECTOR = [
  'button[aria-label="发送消息"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send"]',
].join(', ')

/**
 * @param {unknown} field
 * @returns {boolean}
 */
function isContentEditableField(field) {
  if (!field || typeof field !== 'object') return false
  const el = /** @type {{ isContentEditable?: boolean, getAttribute?: Function, __lexicalEditor?: unknown }} */ (field)
  return Boolean(
    el.isContentEditable
    || el.getAttribute?.('contenteditable') === 'true'
    || el.__lexicalEditor,
  )
}

/**
 * @param {Document | { querySelector: Function } | null | undefined} doc
 * @returns {HTMLTextAreaElement | HTMLInputElement | HTMLElement | null}
 */
export function findComposer(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return null
  return doc.querySelector(COMPOSER_SELECTOR)
}

/**
 * Kept as a locator helper. Prefill never clicks this button.
 *
 * @param {Document | { querySelector: Function } | null | undefined} doc
 * @returns {HTMLButtonElement | null}
 */
export function findSendButton(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return null
  return doc.querySelector(SEND_SELECTOR)
}

/**
 * Read the live composer text. Contenteditable / Lexical uses innerText
 * then textContent; textarea / input uses value.
 *
 * @param {HTMLElement | HTMLTextAreaElement | HTMLInputElement | null | undefined} field
 * @returns {string}
 */
export function getComposerText(field) {
  if (!field) return ''
  if (isContentEditableField(field)) {
    const el = /** @type {{ innerText?: string, textContent?: string | null }} */ (field)
    return String(el.innerText ?? el.textContent ?? '')
  }
  return String(/** @type {{ value?: unknown }} */ (field).value ?? '')
}

/**
 * @param {HTMLElement | HTMLTextAreaElement | HTMLInputElement} field
 * @param {string} value
 * @returns {boolean}
 */
function composerWriteSucceeded(field, value) {
  return getComposerText(field) === value
}

/**
 * Confirm that a single accepted contenteditable command has committed its
 * complete replacement. This only observes the result; it never writes,
 * retries, or falls back after command acceptance.
 *
 * @param {HTMLElement | HTMLTextAreaElement | HTMLInputElement} field
 * @param {string} value
 * @param {{ timeoutMs: number, pollMs: number, now: () => number, sleep: (ms: number) => Promise<void> }} options
 * @returns {Promise<boolean>}
 */
async function waitForComposerCommit(field, value, options) {
  const started = options.now()
  while (true) {
    if (composerWriteSucceeded(field, value)) return true
    const elapsed = options.now() - started
    if (elapsed >= options.timeoutMs) return false
    await options.sleep(Math.min(options.pollMs, options.timeoutMs - elapsed))
  }
}

/**
 * @param {{
 *   document?: { execCommand?: Function },
 *   window?: { getSelection?: Function },
 * }} globals
 * @returns {{ execCommand: Function } | null}
 */
function resolveExecDocument(globals) {
  const injected = globals.document
  if (injected && typeof injected.execCommand === 'function') return injected
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    return document
  }
  return null
}

/**
 * Replace the composer value. Contenteditable / Lexical prefers
 * execCommand('insertText'); textarea uses the prototype setter + InputEvent
 * so React 18 controlled inputs pick it up. Direct `field.value =` is ignored.
 *
 * @param {HTMLTextAreaElement | HTMLInputElement | HTMLElement} field
 * @param {string} text
 * @param {{
 *   HTMLTextAreaElement?: Function,
 *   HTMLInputElement?: Function,
 *   InputEvent?: Function,
 *   Event?: Function,
 *   document?: { execCommand?: Function },
 *   window?: { getSelection?: Function },
 * }} [globals]
 * @returns {boolean}
 */
export function setComposerValue(field, text, globals = {}) {
  if (!field) return false
  const value = String(text ?? '')

  if (isContentEditableField(field)) {
    const execDoc = resolveExecDocument(globals)
    if (execDoc) {
      try {
        field.focus?.()
        const win = globals.window ?? (typeof window !== 'undefined' ? window : undefined)
        const sel = win?.getSelection?.()
        if (sel && typeof sel.selectAllChildren === 'function') {
          sel.selectAllChildren(field)
        }
        // `execCommand` may report success before Lexical has reconciled the
        // DOM. A second direct write in that window becomes a duplicate once
        // Lexical applies the accepted command. Treat an accepted command as
        // the single write channel; only fall back when the command rejects.
        const accepted = execDoc.execCommand('insertText', false, value)
        if (accepted === true || composerWriteSucceeded(field, value)) return true
      } catch {
        // fall through to textContent
      }
    }
    field.textContent = value
    dispatchComposerInput(field, value, globals)
    field.focus?.()
    return composerWriteSucceeded(field, value)
  }

  const TextArea = globals.HTMLTextAreaElement ?? (typeof HTMLTextAreaElement === 'function' ? HTMLTextAreaElement : undefined)
  const InputEl = globals.HTMLInputElement ?? (typeof HTMLInputElement === 'function' ? HTMLInputElement : undefined)
  const proto = TextArea && field instanceof TextArea
    ? TextArea.prototype
    : InputEl && field instanceof InputEl
      ? InputEl.prototype
      : Object.getPrototypeOf(field)
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : undefined
  if (setter) setter.call(field, value)
  else field.value = value
  try {
    field.setSelectionRange?.(value.length, value.length)
  } catch {
    // some fake fields have no selection
  }
  dispatchComposerInput(field, value, globals)
  field.focus?.()
  return composerWriteSucceeded(field, value)
}

/**
 * @param {HTMLElement | HTMLTextAreaElement | HTMLInputElement} field
 * @param {string} value
 * @param {{ InputEvent?: Function, Event?: Function }} globals
 */
function dispatchComposerInput(field, value, globals) {
  const InputCtor = globals.InputEvent
    ?? (typeof InputEvent === 'function' ? InputEvent : undefined)
    ?? globals.Event
    ?? (typeof Event === 'function' ? Event : undefined)
  if (typeof InputCtor !== 'function' || typeof field.dispatchEvent !== 'function') return
  try {
    field.dispatchEvent(new InputCtor('input', { bubbles: true, inputType: 'insertText', data: value }))
  } catch {
    try {
      field.dispatchEvent(new InputCtor('input'))
    } catch {
      // some fake fields reject Event construction
    }
  }
}

/**
 * Wait for the composer, write `text`, focus the field and move the caret to
 * the end. Never locates or clicks the send button — the user submits.
 *
 * @param {string} text
 * @param {{
 *   document?: Document | { querySelector: Function },
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   commitTimeoutMs?: number,
 *   commitPollMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   HTMLTextAreaElement?: Function,
 *   HTMLInputElement?: Function,
 *   InputEvent?: Function,
 *   Event?: Function,
 *   window?: { getSelection?: Function },
 * }} [opts]
 * @returns {Promise<{ ok: true, via: 'prefill' } | { ok: false, error: string }>}
 */
export async function prefillReplicationPrompt(text, opts = {}) {
  const doc = opts.document ?? (typeof document !== 'undefined' ? document : null)
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 6000
  const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : 50
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const sleep = typeof opts.sleep === 'function'
    ? opts.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const commitTimeoutMs = Number.isFinite(opts.commitTimeoutMs) ? opts.commitTimeoutMs : 100
  const commitPollMs = Number.isFinite(opts.commitPollMs) ? opts.commitPollMs : 10

  const started = now()
  let field = findComposer(doc)
  while (!field && now() - started < timeoutMs) {
    await sleep(pollMs)
    field = findComposer(doc)
  }
  if (!field) return { ok: false, error: 'composer-missing' }

  const wrote = setComposerValue(field, text, opts)
  if (!wrote) {
    return { ok: false, error: 'composer-rejected' }
  }
  const committed = await waitForComposerCommit(field, String(text ?? ''), {
    timeoutMs: Math.max(0, commitTimeoutMs),
    pollMs: Math.max(1, commitPollMs),
    now,
    sleep,
  })
  if (!committed) {
    return { ok: false, error: 'composer-rejected' }
  }

  try {
    field.focus?.()
    const len = getComposerText(field).length
    field.setSelectionRange?.(len, len)
  } catch {
    // some fake fields have no selection
  }
  return { ok: true, via: 'prefill' }
}
