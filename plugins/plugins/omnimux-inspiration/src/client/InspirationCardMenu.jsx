import { useEffect, useMemo, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconButton } from 'dsh-ui-kit'
import { Ellipsis } from 'lucide-react'
import { hydrateCardMenuEntries } from './InspirationContextMenu.jsx'

/**
 * The card's `⋯` overflow menu.
 *
 * Accepts either the unified host `MenuEntry[]` (`entries` + `onSelect`) shared with right-click
 * context menus, or the legacy concise list (`items` with inline `run`) used by list view rows.
 */
export function InspirationCardMenu({ t, items, entries, onSelect, onOpenChange, disabled = false }) {
  const [open, setOpen] = useState(false)

  const setMenuOpen = (next) => {
    setOpen((prev) => {
      const value = typeof next === 'function' ? next(prev) : Boolean(next)
      if (value !== prev) onOpenChange?.(value)
      return value
    })
  }

  useEffect(() => {
    if (disabled && open) {
      setMenuOpen(false)
    }
  }, [disabled, open])

  const unifiedEntries = useMemo(() => (
    Array.isArray(entries) && entries.length > 0 ? hydrateCardMenuEntries(entries) : null
  ), [entries])

  const legacyActions = useMemo(() => (
    !unifiedEntries && Array.isArray(items)
      ? items.filter((item) => item && item.label && typeof item.run === 'function')
      : []
  ), [unifiedEntries, items])

  const menuItems = unifiedEntries || legacyActions.map(({ id, label }) => ({ id, label }))
  if (menuItems.length === 0) return null

  const effectiveOpen = open && !disabled

  return (
    <div
      className="omnimux-inspiration-card-menu omx-card-more-wrap"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Menu
        open={effectiveOpen}
        portal
        compact
        align="end"
        items={menuItems}
        listClassName="omx-card-context-menu"
        onClose={() => setMenuOpen(false)}
        onSelect={(id) => {
          setMenuOpen(false)
          if (unifiedEntries) {
            onSelect?.(id)
          } else {
            legacyActions.find((action) => action.id === id)?.run()
          }
        }}
        anchor={(
          <IconButton
            variant="ghost"
            size="xs"
            className="omnimux-inspiration-card-menu-trigger omx-card-more-trigger"
            aria-label={t('card.menu.more')}
            aria-haspopup="menu"
            aria-expanded={effectiveOpen}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation()
              }
            }}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </IconButton>
        )}
      />
    </div>
  )
}
