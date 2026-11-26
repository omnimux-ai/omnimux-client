import React, { useEffect, useRef, useState } from 'react'
import { Button, IconButton, IconEditOutline16, IconLoadingOutline16, IconTrashOutline16 } from 'dsh-ui-kit'
import { ProjectCover } from './ProjectCover.jsx'

function formatPageDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

function ProjectPageCard({ page, active, busy = false, onOpenPage, onRenamePage, onDeletePage, t }) {
  const [menu, setMenu] = useState(false)
  const root = useRef(null)

  useEffect(() => {
    if (!menu) return undefined
    root.current?.querySelector('[role="menuitem"]')?.focus()
    const outside = (event) => { if (!root.current?.contains(event.target)) setMenu(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])

  const dateStr = formatPageDate(page.updatedAt || page.createdAt)

  const requestOpen = () => {
    if (busy) return
    onOpenPage(page)
  }

  const closeMenu = () => {
    setMenu(false)
    root.current?.querySelector('[aria-haspopup="menu"]')?.focus()
  }

  return (
    <div
      ref={root}
      className={`omnimux-page-card omnimux-workflow-card ${active ? 'omnimux-page-card--active' : ''}${busy ? ' omnimux-page-card--opening' : ''}`}
      data-menu-open={menu ? 'true' : undefined}
      onClick={requestOpen}
      aria-busy={busy ? 'true' : undefined}
      title={busy ? undefined : `${t?.('projects.open') || '打开创作页'}：${page.title}`}
    >
      <div className="omnimux-page-card-cover">
        <Button
          variant="ghost"
          className="omnimux-page-open"
          aria-label={`${t?.('projects.open') || '打开'} ${page.title}`}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            requestOpen()
          }}
        >
          <ProjectCover cover={page.cover} />
        </Button>
      </div>

      <div className="omnimux-page-card-info">
        <div className="omnimux-page-card-title" title={page.title}>
          {page.title}
        </div>
        <div className="omnimux-page-card-meta">
          <span className="omnimux-page-card-date">{dateStr}</span>
        </div>
      </div>

      {busy ? (
        <div
          className="omnimux-page-card-opening"
          role="status"
          onClick={(event) => event.stopPropagation()}
        >
          <IconLoadingOutline16 size={16} />
          <span>{t?.('projects.opening') || '打开中'}</span>
        </div>
      ) : null}

      <div
        className="omnimux-workflow-card-actions omnimux-page-card-actions"
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton
          variant="ghost"
          className="omnimux-page-more"
          aria-label={t?.('projects.more') || '更多操作'}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={(e) => {
            e.stopPropagation()
            setMenu(!menu)
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </IconButton>
      </div>

      {menu && (
        <div
          className="omnimux-folder-menu omnimux-page-card-menu"
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); closeMenu() }
            if (event.key === 'Tab') setMenu(false)
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')]
              const index = items.indexOf(document.activeElement)
              items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus()
            }
          }}
        >
          <Button
            variant="ghost"
            role="menuitem"
            leadingIcon={<IconEditOutline16 size={16} />}
            onClick={() => {
              closeMenu()
              onRenamePage(page)
            }}
          >
            {t?.('projects.rename') || '重命名'}
          </Button>
          <Button
            variant="ghost"
            role="menuitem"
            className="omnimux-folder-menu-item--danger"
            data-danger="true"
            leadingIcon={<IconTrashOutline16 size={16} />}
            onClick={() => {
              closeMenu()
              onDeletePage(page)
            }}
          >
            {t?.('projects.deletePage') || '删除'}
          </Button>
        </div>
      )}
    </div>
  )
}

export function ProjectPagesTab({
  pages = [],
  activePageId,
  openingPageId = null,
  loading = false,
  onOpenPage,
  onRenamePage,
  onDeletePage,
  t,
}) {
  const hasPages = Array.isArray(pages) && pages.length > 0
  if (loading && !hasPages) {
    return (
      <div className="omnimux-project-pages-tab" aria-busy="true">
        <div className="omnimux-pages-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="omnimux-page-card omnimux-page-card--skeleton" aria-hidden="true">
              <div className="omnimux-page-card-cover omnimux-skeleton-block" />
              <div className="omnimux-page-card-info">
                <div className="omnimux-skeleton-line omnimux-skeleton-line--title" />
                <div className="omnimux-skeleton-line omnimux-skeleton-line--meta" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const displayPages = hasPages ? pages : [
    { id: 'page-default', title: '创作页 1', canvasWorkspaceId: 'ws_default' },
  ]

  return (
    <div className="omnimux-project-pages-tab">
      <div className="omnimux-pages-grid">
        {displayPages.map((page) => (
          <ProjectPageCard
            key={page.id}
            page={page}
            active={page.id === activePageId}
            busy={openingPageId !== null && page.id === openingPageId}
            onOpenPage={onOpenPage}
            onRenamePage={onRenamePage}
            onDeletePage={onDeletePage}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}
