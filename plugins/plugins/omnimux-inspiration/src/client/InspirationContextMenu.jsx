import { useMemo } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Copy,
  ExternalLink,
  Folder,
  FolderMinus,
  FolderPlus,
  Link2,
  Maximize2,
  MessageSquarePlus,
  PanelRightOpen,
  Share2,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'

function iconForKey(iconKey) {
  switch (iconKey) {
    case 'star':
      return <Star size={16} aria-hidden="true" />
    case 'star-filled':
      return <Star size={16} fill="currentColor" aria-hidden="true" />
    case 'share':
      return <Share2 size={16} aria-hidden="true" />
    case 'maximize':
      return <Maximize2 size={16} aria-hidden="true" />
    case 'sidebar':
      return <PanelRightOpen size={16} aria-hidden="true" />
    case 'chat':
      return <MessageSquarePlus size={16} aria-hidden="true" />
    case 'sparkles':
      return <Sparkles size={16} aria-hidden="true" />
    case 'replicate':
      return <Copy size={16} aria-hidden="true" />
    case 'external-link':
      return <ExternalLink size={16} aria-hidden="true" />
    case 'link':
      return <Link2 size={16} aria-hidden="true" />
    case 'folder':
      return <Folder size={16} aria-hidden="true" />
    case 'folder-plus':
      return <FolderPlus size={16} aria-hidden="true" />
    case 'folder-minus':
      return <FolderMinus size={16} aria-hidden="true" />
    case 'trash':
      return <Trash2 size={16} aria-hidden="true" />
    default:
      return undefined
  }
}

/**
 * Convert pure `buildCardMenuEntries` entries into host `<Menu>` `MenuEntry[]`
 * with 16px Lucide icons and nested submenus.
 *
 * @param {Array<Record<string, any>>} entries
 * @returns {Array<Record<string, any>>}
 */
export function hydrateCardMenuEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries
    .filter(Boolean)
    .map((entry) => {
      if (entry.type === 'separator') {
        return { type: 'separator', id: entry.id }
      }
      const next = {
        id: entry.id,
        label: entry.label,
        ...(entry.iconKey ? { icon: iconForKey(entry.iconKey) } : {}),
        ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
        ...(entry.danger ? { danger: true } : {}),
        ...(entry.disabled ? { disabled: true } : {}),
      }
      if (Array.isArray(entry.submenu) && entry.submenu.length > 0) {
        next.submenu = hydrateCardMenuEntries(entry.submenu)
      }
      return next
    })
}

/**
 * Floating viewport-clamped context menu anchored at cursor `(x, y)` on card right-click.
 * Uses the host `<Menu contextual portal anchor={null} anchorPoint={point} />` primitive so
 * Esc/click-outside dismissal, ARIA roles, keyboard navigation, and submenus stay host-native.
 */
export function InspirationContextMenu({ open, point, entries, onSelect, onClose }) {
  const hydrated = useMemo(() => hydrateCardMenuEntries(entries), [entries])
  const visible = Boolean(open && point && hydrated.length > 0)

  if (!visible) return null

  return (
    <Menu
      open={visible}
      contextual
      portal
      anchor={null}
      anchorPoint={point}
      items={hydrated}
      listClassName="omx-card-context-menu"
      onSelect={(id) => {
        onClose?.()
        onSelect?.(id)
      }}
      onClose={onClose}
    />
  )
}
