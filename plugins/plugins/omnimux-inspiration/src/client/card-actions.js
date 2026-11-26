/**
 * Menu actions for inspiration library/feed cards (PR 1 unified 10-item menu + `⋯` overflow contract).
 *
 * Pure JS (no JSX) so unit tests run directly in Node without a JSX transform; UI wrappers map
 * `iconKey` to Lucide icons and feed entries directly into host `@deepseek-ai/dsh-client-ui-primitives` `Menu`.
 */

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(asText(url))
}

/**
 * Copy a URL to the clipboard with a `textarea` fallback when Clipboard API is blocked/absent.
 * Lives only in `card-actions.js` so overlay CTA components stay isolated from clipboard calls.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function copyCardLink(url) {
  const target = asText(url)
  if (!target) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(target)
      return true
    }
  } catch (err) {
    console.debug?.('[omnimux-inspiration] navigator.clipboard.writeText failed, falling back:', err?.message || err)
  }
  if (typeof document === 'undefined' || !document.body) return false
  const textarea = document.createElement('textarea')
  textarea.value = target
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  let copied = false
  try {
    copied = Boolean(document.execCommand?.('copy'))
  } catch (err) {
    console.debug?.('[omnimux-inspiration] document.execCommand copy failed:', err?.message || err)
    copied = false
  } finally {
    textarea.remove()
  }
  return copied
}

/**
 * Build host-`Menu`-ready grouped entries plus a flat dispatch map (`run(id)`).
 * Submenu items (collections) execute cleanly when `onSelect(id)` is fired by host `Menu`.
 *
 * @param {{
 *   t?: (key: string) => string,
 *   local?: boolean,
 *   inCollection?: boolean,
 *   sourceUrl?: string,
 *   isFavorite?: boolean,
 *   importing?: boolean,
 *   itemId?: string,
 *   collections?: Array<{ id: string | number, title?: string, item_ids?: Array<string | number> }>,
 *   onToggleFavorite?: () => void,
 *   onShare?: () => void,
 *   onOpenDetail?: () => void,
 *   onOpenSidebar?: () => void,
 *   onAddToConversation?: () => void,
 *   onAiDeconstruct?: () => void,
 *   onOpenOriginal?: () => void,
 *   onCopyLink?: () => void,
 *   onReplicate?: () => void,
 *   onAddToCollection?: (collection: any) => void,
 *   onCreateCollection?: () => void,
 *   onRemoveFromCollection?: () => void,
 *   onDelete?: () => void,
 * }} io
 * @returns {{ entries: Array<Record<string, any>>, run: (id: string) => boolean }}
 */
export function buildCardMenuEntries(io = {}) {
  const translate = typeof io.t === 'function' ? io.t : (key) => key
  const local = Boolean(io.local)
  const inCollection = Boolean(io.inCollection)
  const importing = Boolean(io.importing)
  const hasSourceUrl = isHttpUrl(io.sourceUrl)
  const itemId = io.itemId == null ? '' : String(io.itemId)
  const collections = Array.isArray(io.collections) ? io.collections : []
  const handlers = new Map()
  const groups = []

  const addItem = (group, item, fn) => {
    if (typeof fn !== 'function') return
    handlers.set(item.id, fn)
    group.push(item)
  }

  // Group 1: Favorite + Share
  const group1 = []
  if (local) {
    addItem(
      group1,
      {
        id: 'favorite',
        label: translate(io.isFavorite ? 'card.menu.unfavorite' : 'card.menu.favorite'),
        iconKey: io.isFavorite ? 'star-filled' : 'star',
      },
      io.onToggleFavorite,
    )
  }
  addItem(
    group1,
    {
      id: 'share',
      label: translate('card.menu.share'),
      iconKey: 'share',
      disabled: importing,
    },
    io.onShare,
  )
  if (group1.length) groups.push(group1)

  // Group 2: Open / Side panel / Chat / AI Deconstruct / Replicate
  const group2 = []
  addItem(group2, { id: 'open-detail', label: translate('card.menu.openDetail'), iconKey: 'maximize' }, io.onOpenDetail)
  addItem(group2, { id: 'open-sidebar', label: translate('card.menu.openSidebar'), iconKey: 'sidebar' }, io.onOpenSidebar)
  addItem(group2, { id: 'add-to-conversation', label: translate('card.menu.addToConversation'), iconKey: 'chat' }, io.onAddToConversation)
  addItem(
    group2,
    { id: 'ai-deconstruct', label: translate('card.menu.aiDeconstruct'), iconKey: 'sparkles', disabled: importing },
    io.onAiDeconstruct,
  )
  addItem(
    group2,
    { id: 'replicate', label: translate('card.cta.try'), iconKey: 'replicate', disabled: importing },
    io.onReplicate,
  )
  if (group2.length) groups.push(group2)

  // Group 3: Links & Collections
  const group3 = []
  if (hasSourceUrl) {
    addItem(group3, { id: 'open-original', label: translate('card.menu.openOriginal'), iconKey: 'external-link' }, io.onOpenOriginal)
    addItem(group3, { id: 'copy-link', label: translate('card.menu.copyLink'), iconKey: 'link' }, io.onCopyLink)
  }
  if (local && !inCollection && (typeof io.onAddToCollection === 'function' || typeof io.onCreateCollection === 'function')) {
    const submenu = []
    for (const col of collections) {
      if (!col || col.id == null) continue
      const colId = String(col.id)
      const entryId = `collection:${colId}`
      const contains = Boolean(itemId) && Array.isArray(col.item_ids) && col.item_ids.some((id) => String(id) === itemId)
      submenu.push({
        id: entryId,
        label: String(col.title || colId),
        iconKey: 'folder',
        disabled: contains,
      })
      if (!contains && typeof io.onAddToCollection === 'function') {
        handlers.set(entryId, () => io.onAddToCollection(col))
      }
    }
    if (submenu.length > 0 && typeof io.onCreateCollection === 'function') {
      submenu.push({ type: 'separator', id: 'collection-submenu-sep' })
    }
    if (typeof io.onCreateCollection === 'function') {
      const createId = 'collection:new'
      submenu.push({
        id: createId,
        label: translate('collection.newFromCard'),
        iconKey: 'folder-plus',
      })
      handlers.set(createId, io.onCreateCollection)
    }
    if (submenu.length > 0) {
      group3.push({
        id: 'add-to-collection',
        label: translate('card.menu.addToCollection'),
        iconKey: 'folder-plus',
        submenu,
      })
    }
  }
  if (local && inCollection) {
    addItem(group3, { id: 'remove-from-collection', label: translate('collection.remove'), iconKey: 'folder-minus' }, io.onRemoveFromCollection)
  }
  if (group3.length) groups.push(group3)

  // Group 4: Destructive delete (local only)
  const group4 = []
  if (local) {
    addItem(group4, { id: 'delete', label: translate('card.menu.delete'), iconKey: 'trash', danger: true }, io.onDelete)
  }
  if (group4.length) groups.push(group4)

  const entries = []
  groups.forEach((group, idx) => {
    if (idx > 0) entries.push({ type: 'separator', id: `card-menu-sep-${idx}` })
    entries.push(...group)
  })

  return {
    entries,
    run(id) {
      const fn = handlers.get(id)
      if (typeof fn !== 'function') return false
      fn()
      return true
    },
  }
}

/**
 * Legacy concise overflow item list preserved for compact list-view menus and compatibility.
 */
export function buildCardMenuItems(io) {
  const translate = typeof io?.t === 'function' ? io.t : (key) => key
  const items = [{
    id: 'chat',
    label: translate('card.menu.addToConversation'),
    run: io.onAddToConversation,
  }]
  if (io.local && !io.inCollection) {
    items.push({ id: 'merge', label: translate('collection.merge'), run: io.onMerge })
  }
  if (io.local && io.inCollection) {
    items.push({ id: 'remove', label: translate('collection.remove'), run: io.onRemove })
  }
  if (io.local) {
    items.push({ id: 'delete', label: translate('card.menu.delete'), run: io.onDelete })
  }
  return items.filter((item) => typeof item.run === 'function')
}
