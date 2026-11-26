import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, IconButton, IconEditOutline16, IconTrashOutline16 } from 'dsh-ui-kit'
import { ProjectCover } from './ProjectCover.jsx'
import { injectFolderStyles } from './folderStyles.js'

function extractWorkspaceName(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return ''
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

function formatPageCount(count, t) {
  const template = t?.('projects.pageCount')
  if (typeof template === 'string' && template.includes('{count}')) {
    return template.replace('{count}', String(count))
  }
  return `${count} 页`
}

const POCKET_PATH = 'M1 199C1 171 20 150 48 150H142C171 150 185 163 191 187H467C494 187 515 208 515 237V330C515 356 495 377 467 377H49C22 377 1 356 1 330Z'

const POCKET_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 516 378" preserveAspectRatio="none"><path fill="white" d="${POCKET_PATH}"/></svg>`)}")`

const memo = typeof React.memo === 'function' ? React.memo : (component) => component

export const ProjectFolderCard = memo(function ProjectFolderCard({ project, onOpen, onRename, onRemove, onPurge, t }) {
  const glassId = `folder-glass-${useId().replace(/:/g, '')}`
  const [menu, setMenu] = useState(false)
  const root = useRef(null)
  useEffect(() => { injectFolderStyles() }, [])
  useEffect(() => {
    if (!menu) return undefined
    root.current?.querySelector('[role="menuitem"]')?.focus()
    const outside = (event) => { if (!root.current?.contains(event.target)) setMenu(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])

  const dateStr = formatDate(project.updatedAt)
  const pageCount = Array.isArray(project.pages) && project.pages.length > 0 ? project.pages.length : 1
  const workspaceLabel = project.bound
    ? (extractWorkspaceName(project.workspaceDir) || t('projects.bound'))
    : t('projects.independent')
  const closeMenu = () => { setMenu(false); root.current?.querySelector('[aria-haspopup="menu"]')?.focus() }
  const coverKey = project.cover
    ? JSON.stringify([project.cover.kind, project.cover.sourceRevision || project.cover.thumbnailUrl || project.cover.mediaUrl])
    : 'pending'

  return (
    <article
      ref={root}
      className="omnimux-folder"
      data-cover-kind={project.cover?.kind || 'empty'}
      data-menu-open={menu ? 'true' : undefined}
    >
      <Button variant="ghost" className="omnimux-folder-open" onClick={() => onOpen(project)} aria-label={project.title}>
        <span className="omnimux-folder-back" aria-hidden="true" />
        <span className="omnimux-folder-sheet omnimux-folder-sheet--rear" aria-hidden="true" />
        <ProjectCover
          key={coverKey}
          cover={project.cover}
          renderFrame={(content) => (
            <>
              <span className="omnimux-folder-sheet omnimux-folder-sheet--front">{content}</span>
              <svg className="omnimux-folder-glass-defs" width="0" height="0" aria-hidden="true" focusable="false">
                <defs>
                  <linearGradient id={`${glassId}-rim`} x1="0" y1="0" x2="0.7" y2="1">
                    <stop offset="0" stopColor="var(--dsw-alias-label-primary)" stopOpacity="0.2" />
                    <stop offset="0.48" stopColor="var(--dsw-alias-label-primary)" stopOpacity="0.04" />
                    <stop offset="1" stopColor="var(--dsw-alias-label-primary)" stopOpacity="0.1" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="omnimux-folder-pocket" style={{ '--stage-pocket-mask': POCKET_MASK }} aria-hidden="true">
                <span className="omnimux-folder-glass-shade" />
              </span>
            </>
          )}
        />
        <svg className="omnimux-folder-pocket-rim" viewBox="0 0 516 378" aria-hidden="true" focusable="false">
          <path d={POCKET_PATH} fill="none" stroke={`url(#${glassId}-rim)`} strokeWidth="1.25" />
        </svg>
        <span className="omnimux-folder-caption">
          <span className="omnimux-folder-name" title={project.title}>{project.title}</span>
          <span className="omnimux-folder-meta">
            {dateStr ? <span className="omnimux-folder-date">{dateStr}</span> : null}
            <span className="omnimux-folder-pages">{formatPageCount(pageCount, t)}</span>
          </span>
          <span className="omnimux-folder-workspace" title={project.workspaceDir || project.path || ''}>
            {workspaceLabel}
          </span>
        </span>
      </Button>
      <IconButton
        variant="ghost"
        className="omnimux-folder-more"
        aria-label={t('projects.more')}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </IconButton>
      {menu && (
        <div
          className="omnimux-folder-menu"
          role="menu"
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
          <Button variant="ghost" role="menuitem" leadingIcon={<IconEditOutline16 size={16} />} onClick={() => { closeMenu(); onRename(project) }}>
            {t('projects.rename')}
          </Button>
          <Button
            variant="ghost"
            role="menuitem"
            data-omnimux-folder-remove=""
            leadingIcon={<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 8h8" /></svg>}
            onClick={() => { closeMenu(); onRemove(project) }}
          >
            {t('projects.removeFromLibrary')}
          </Button>
          <Button
            variant="ghost"
            role="menuitem"
            className="omnimux-folder-menu-item--danger"
            data-danger="true"
            data-omnimux-folder-purge=""
            leadingIcon={<IconTrashOutline16 size={16} />}
            onClick={() => { closeMenu(); onPurge(project) }}
          >
            {t('projects.purge')}
          </Button>
        </div>
      )}
    </article>
  )
})
