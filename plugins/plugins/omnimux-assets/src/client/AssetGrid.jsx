import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  IconButton,
  MediaCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  createPortalSafe,
} from 'dsh-ui-kit'
import {
  AssetTypeIcon,
  CheckIcon,
  FileIcon,
  EyeIcon,
  ChatIcon,
  DotsIcon,
  RevealLocationIcon,
  CopyIcon,
  TrashIcon,
} from './icons.jsx'
import { previewUrl, revealAssetEntry } from './api.js'
import { pickCoverFile, addAssetToConversation, buildAssetPayload } from './add-to-chat.js'
import { isFolderAsset, resolveAssetMediaPreview } from './asset-routing.js'
import { useGridColumns } from './use-grid-columns.js'
import { MasonryGrid } from './masonry-grid.jsx'
import { coverRatioCache } from './ratio-cache.js'
import { formatDateTime, formatTimeAgo } from './format.js'
import {
  citeOf,
  defaultSortDirection,
  formatListDescription,
  selectRangeIds,
  sortAssetsBy,
  toggleAllVisibleIds,
  toggleAssetIdInSet,
} from './feed-helpers.js'

export const HOVER_PREVIEW_DELAY_MS = 200
const VIEWPORT_MARGIN = 12
const MENU_ESTIMATED_WIDTH = 164
const MENU_ESTIMATED_HEIGHT = 160
const PREVIEW_ESTIMATED_WIDTH = 356
const PREVIEW_ESTIMATED_HEIGHT = 380

/**
 * Build drag-and-drop transfer payloads for a local asset row:
 * - `application/json`: matches CanvasEditor (`{ type: 'omnimux-asset', asset }`)
 * - `application/x-omnimux-asset`: standard conversation attachment payload
 * - `text/plain`: `@type/name` citation for direct drop into chat composer
 * @param {any} asset
 * @param {string} [coverSrc]
 */
export function buildAssetDragData(asset, coverSrc = '') {
  const coverFile = pickCoverFile(asset)
  const files = Array.isArray(asset?.files) ? asset.files : []
  const firstFile = files[0] ?? null
  const realPath = String(coverFile?.real_path || firstFile?.real_path || asset?.real_path || '')
  const cite = citeOf(asset)
  return {
    json: JSON.stringify({
      type: 'omnimux-asset',
      asset: {
        id: asset?.id ?? '',
        name: asset?.name ?? '',
        type: asset?.type ?? 'custom',
        cite,
        previewUrl: coverSrc || '',
        real_path: realPath,
        files,
      },
    }),
    attachment: JSON.stringify(buildAssetPayload(asset) ?? {}),
    text: cite,
  }
}

/**
 * Clamp fixed-position popover coordinates within the active viewport.
 * @param {{ left: number, right: number, top: number, bottom: number }} anchorRect
 * @param {{ width: number, height: number, align?: 'end' | 'right-of', viewportW?: number, viewportH?: number }} opts
 */
export function computePopoverCoords(anchorRect, opts) {
  const vw = opts.viewportW ?? (typeof window !== 'undefined' ? window.innerWidth : 1280)
  const vh = opts.viewportH ?? (typeof window !== 'undefined' ? window.innerHeight : 800)
  const width = opts.width
  const height = opts.height
  let left = VIEWPORT_MARGIN
  let top = VIEWPORT_MARGIN

  if (opts.align === 'right-of') {
    const rightSpace = vw - anchorRect.right - VIEWPORT_MARGIN
    left = rightSpace >= width + 12
      ? anchorRect.right + 12
      : Math.max(VIEWPORT_MARGIN, anchorRect.left - width - 12)
    top = Math.max(VIEWPORT_MARGIN, Math.min(vh - height - VIEWPORT_MARGIN, anchorRect.top - 24))
  } else {
    left = Math.max(VIEWPORT_MARGIN, Math.min(vw - width - VIEWPORT_MARGIN, anchorRect.right - width))
    const belowTop = anchorRect.bottom + 4
    const aboveTop = anchorRect.top - height - 4
    top = belowTop + height + VIEWPORT_MARGIN <= vh
      ? belowTop
      : Math.max(VIEWPORT_MARGIN, aboveTop)
  }
  return { left: Math.round(left), top: Math.round(top) }
}

/**
 * @param {{
 *   asset: any,
 *   t: (key: string) => string,
 *   selected?: boolean,
 *   onToggleSelect?: (asset: any) => void,
 *   onOpen: (asset: any) => void,
 *   onPreview?: (item: any) => void,
 *   onAddToConversation?: (asset: any) => void,
 *   missing?: boolean,
 * }} props
 */
function AssetGridCard({ asset, t, selected, onToggleSelect, onOpen, onPreview, onAddToConversation, missing }) {
  const [broken, setBroken] = useState(false)
  const [added, setAdded] = useState(false)
  const timerRef = useRef(null)

  const coverFile = pickCoverFile(asset)

  useEffect(() => {
    setBroken(false)
  }, [asset?.id, coverFile?.id])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const src = coverFile && !broken ? previewUrl(asset.id, coverFile.id) : ''

  const handleTriggerAction = () => {
    if (isFolderAsset(asset)) {
      onOpen(asset)
    } else if (typeof onPreview === 'function') {
      onPreview(resolveAssetMediaPreview(asset))
    } else {
      onOpen(asset)
    }
  }

  const handleView = (event) => {
    event.stopPropagation()
    handleTriggerAction()
  }

  const handleAdd = (event) => {
    event.stopPropagation()
    if (added) return
    if (typeof onAddToConversation === 'function') {
      onAddToConversation(asset)
    } else {
      addAssetToConversation(asset)
    }
    setAdded(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setAdded(false)
    }, 1800)
  }

  const coverNode = (
    <div className="omnimux-assets-card-thumb">
      {onToggleSelect ? (
        <IconButton
          variant="ghost"
          size="xs"
          className="omnimux-assets-check"
          data-selected={selected ? 'true' : 'false'}
          aria-label={t('select.toggle')}
          aria-pressed={selected ? 'true' : 'false'}
          title=""
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelect(asset)
          }}
        >
          {selected ? <CheckIcon size={12} /> : <span />}
        </IconButton>
      ) : null}
      {src ? (
        <img
          src={src}
          className="omnimux-assets-card-media"
          alt=""
          width={9}
          height={16}
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              image.setAttribute('width', String(image.naturalWidth))
              image.setAttribute('height', String(image.naturalHeight))
              if (asset?.id) {
                coverRatioCache.set(asset.id, image.naturalWidth / image.naturalHeight)
              }
            }
          }}
          onError={() => setBroken(true)}
        />
      ) : (
        <FileIcon size={22} />
      )}
      <Badge size="sm" shape="capsule" className="omnimux-assets-badge">
        {t(`type.${asset.type}`)}
      </Badge>
      {missing ? <span className="omnimux-assets-missing">{t('card.missing')}</span> : null}
      <div className="omnimux-assets-card-overlay">
        <div className="omnimux-assets-card-overlay-actions">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="omnimux-assets-overlay-btn omnimux-assets-overlay-btn--secondary"
            aria-label={t('card.view')}
            leadingIcon={<EyeIcon size={14} />}
            onClick={handleView}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleView(event)
              }
            }}
          >
            <span className="omnimux-assets-overlay-label">{t('card.view')}</span>
          </Button>
          <Button
            type="button"
            variant="primary"
            size="xs"
            className="omnimux-assets-overlay-btn omnimux-assets-overlay-btn--primary"
            aria-label={added ? t('card.addedToConversation') : t('card.addToConversation')}
            disabled={added}
            leadingIcon={<ChatIcon size={14} />}
            onClick={handleAdd}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleAdd(event)
              }
            }}
          >
            <span className="omnimux-assets-overlay-label">
              {added ? t('card.addedToConversation') : t('card.addToConversation')}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )

  const timeText = formatTimeAgo(asset.created_at || asset.createdAt || asset.updated_at)
  const safeType = /^[a-zA-Z0-9_-]+$/.test(asset?.type ?? '') ? asset.type : null
  const typeClass = safeType ? `omnimux-assets-card--${safeType}` : 'omnimux-assets-card--custom'

  return (
    <MediaCard
      className={`omnimux-assets-focusable omnimux-assets-card ${typeClass}`.trim()}
      data-type={safeType ?? undefined}
      selected={selected}
      onClick={handleTriggerAction}
      aspectRatio="3:4"
      coverNode={coverNode}
      title={asset.name}
      subtitle={timeText || '—'}
    />
  )
}

/**
 * Accessible custom checkbox indicator matching dsh-ui-kit DataTable semantics.
 * @param {{
 *   checked: 'true' | 'false' | 'mixed',
 *   label: string,
 *   onToggle: (shiftKey: boolean) => void,
 *   className?: string,
 * }} props
 */
function ListCheckbox({ checked, label, onToggle, className = '' }) {
  return (
    <span
      role="checkbox"
      tabIndex={0}
      aria-checked={checked}
      aria-label={label}
      data-checked={checked}
      className={`omnimux-assets-checkbox ${className}`.trim()}
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(Boolean(event.shiftKey))
      }}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          onToggle(Boolean(event.shiftKey))
        }
      }}
    >
      {checked === 'true' ? (
        <CheckIcon size={10} />
      ) : checked === 'mixed' ? (
        <span className="omnimux-assets-checkbox-minus" aria-hidden="true" />
      ) : null}
    </span>
  )
}

/**
 * @param {{
 *   asset: any,
 *   rowIndex: number,
 *   isActiveRow: boolean,
 *   t: (key: string) => string,
 *   selected?: boolean,
 *   canSelect?: boolean,
 *   menuOpen?: boolean,
 *   onRowCheck?: (asset: any, shiftKey: boolean) => void,
 *   onOpen: (asset: any) => void,
 *   onPreview?: (item: any) => void,
 *   onAddToConversation?: (asset: any) => void,
 *   onToggleMenu: (asset: any, triggerEl: HTMLElement) => void,
 *   onThumbEnter: (asset: any, src: string, rect: DOMRect) => void,
 *   onThumbLeave: (assetId: string) => void,
 *   onRowFocus: (assetId: string) => void,
 *   onRowNavigate: (rowIndex: number, direction: -1 | 1) => void,
 *   registerRowRef: (assetId: string, node: HTMLTableRowElement | null) => void,
 *   missing?: boolean,
 * }} props
 */
function AssetListRow({
  asset,
  rowIndex,
  isActiveRow,
  t,
  selected,
  canSelect,
  menuOpen,
  onRowCheck,
  onOpen,
  onPreview,
  onAddToConversation,
  onToggleMenu,
  onThumbEnter,
  onThumbLeave,
  onRowFocus,
  onRowNavigate,
  registerRowRef,
  missing,
}) {
  const [broken, setBroken] = useState(false)
  const [added, setAdded] = useState(false)
  const timerRef = useRef(null)

  const coverFile = pickCoverFile(asset)

  useEffect(() => {
    setBroken(false)
  }, [asset?.id, coverFile?.id])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const src = coverFile && !broken ? previewUrl(asset.id, coverFile.id) : ''
  const rawDescription = String(asset.description ?? '')
  const cleanDescription = formatListDescription(rawDescription)
  const fileCount = Array.isArray(asset.files) ? asset.files.length : 0
  const fileCountText = fileCount > 0
    ? t('list.filesCount').replace('{n}', String(fileCount))
    : t('list.filesEmpty')
  const timeRaw = asset.updated_at || asset.updatedAt || asset.created_at || asset.createdAt || ''
  const updatedText = formatTimeAgo(timeRaw) || '—'
  const updatedIso = typeof timeRaw === 'number' && Number.isFinite(timeRaw)
    ? new Date(timeRaw).toISOString()
    : timeRaw
  const updatedTitle = formatDateTime(updatedIso) || undefined

  const handleTriggerAction = () => {
    onThumbLeave(asset.id)
    if (isFolderAsset(asset)) {
      onOpen(asset)
    } else if (typeof onPreview === 'function') {
      onPreview(resolveAssetMediaPreview(asset))
    } else {
      onOpen(asset)
    }
  }

  const handleQuickPreview = () => {
    onThumbLeave(asset.id)
    if (typeof onPreview === 'function') {
      const target = resolveAssetMediaPreview(asset)
      const isPlayableMedia = Boolean(target.previewUrl && (target.kind === 'image' || target.kind === 'video'))
      if (isPlayableMedia || !isFolderAsset(asset)) {
        onPreview(target)
        return
      }
    }
    onOpen(asset)
  }

  const handleAdd = (event) => {
    event.stopPropagation()
    if (added) return
    if (typeof onAddToConversation === 'function') {
      onAddToConversation(asset)
    } else {
      addAssetToConversation(asset)
    }
    setAdded(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setAdded(false)
    }, 1800)
  }

  const handleDragStart = (event) => {
    onThumbLeave(asset.id)
    const dragData = buildAssetDragData(asset, src)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData('application/json', dragData.json)
      event.dataTransfer.setData('application/x-omnimux-asset', dragData.attachment)
      event.dataTransfer.setData('text/plain', dragData.text)
    }
  }

  const handleRowKeyDown = (event) => {
    if (event.isComposing || event.target !== event.currentTarget) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onRowNavigate(rowIndex, 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      onRowNavigate(rowIndex, -1)
    } else if (event.key === ' ') {
      event.preventDefault()
      handleQuickPreview()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onThumbLeave(asset.id)
      onOpen(asset)
    }
  }

  return (
    <TableRow
      ref={(node) => registerRowRef(asset.id, node)}
      selected={selected}
      tabIndex={isActiveRow ? 0 : -1}
      draggable
      data-asset-id={asset.id}
      data-menu-open={menuOpen ? 'true' : 'false'}
      className="omnimux-assets-list-row"
      onClick={handleTriggerAction}
      onFocus={() => onRowFocus(asset.id)}
      onKeyDown={handleRowKeyDown}
      onDragStart={handleDragStart}
    >
      <TableCell className="omnimux-assets-td-check" onClick={(event) => event.stopPropagation()}>
        {canSelect ? (
          <ListCheckbox
            checked={selected ? 'true' : 'false'}
            label={`${t('select.toggle')} ${asset.name || ''}`.trim()}
            onToggle={(shiftKey) => onRowCheck?.(asset, shiftKey)}
          />
        ) : null}
      </TableCell>
      <TableCell className="omnimux-assets-td-name">
        <div className="omnimux-assets-list-cell-name">
          <span
            className="omnimux-assets-list-thumb"
            data-has-cover={src ? 'true' : 'false'}
            data-asset-type={asset.type || 'custom'}
            onMouseEnter={(event) => {
              if (!src) return
              onThumbEnter(asset, src, event.currentTarget.getBoundingClientRect())
            }}
            onMouseLeave={() => onThumbLeave(asset.id)}
          >
            {src ? (
              <img
                src={src}
                className="omnimux-assets-list-thumb-img"
                alt=""
                onError={() => setBroken(true)}
              />
            ) : (
              <AssetTypeIcon type={asset.type} size={15} />
            )}
          </span>
          <span className="omnimux-assets-list-name-text" title={asset.name}>
            {asset.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="omnimux-assets-td-type">
        <Badge size="sm" shape="capsule" variant="neutral" className="omnimux-assets-badge omnimux-assets-list-badge">
          {t(`type.${asset.type}`)}
        </Badge>
      </TableCell>
      <TableCell
        className={`omnimux-assets-td-desc${cleanDescription ? '' : ' omnimux-assets-list-desc-muted'}`}
        title={rawDescription || undefined}
      >
        {cleanDescription || '—'}
      </TableCell>
      <TableCell align="right" className="omnimux-assets-td-files">
        <span className="omnimux-assets-list-files-inner">
          <span>{fileCountText}</span>
          {missing ? (
            <span className="omnimux-assets-list-missing" title={t('card.missing')}>
              <span className="omnimux-assets-list-missing-dot" aria-hidden="true" />
              {t('list.missingShort')}
            </span>
          ) : null}
        </span>
      </TableCell>
      <TableCell align="right" className="omnimux-assets-td-updated" title={updatedTitle}>
        <span className="omnimux-assets-list-updated-inner">{updatedText}</span>
      </TableCell>
      <TableCell align="right" className="omnimux-assets-td-actions" onClick={(event) => event.stopPropagation()}>
        <div className="omnimux-assets-list-actions">
          <Button
            type="button"
            variant="primary"
            size="xs"
            className="omnimux-assets-list-add-btn"
            data-added={added ? 'true' : 'false'}
            aria-label={added ? t('card.addedToConversation') : t('card.addToConversation')}
            leadingIcon={<ChatIcon size={13} />}
            disabled={added}
            onClick={handleAdd}
          >
            {added ? t('card.addedToConversation') : t('card.addToConversation')}
          </Button>
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            className="omnimux-assets-list-more-btn"
            aria-label={t('list.moreActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleMenu(asset, event.currentTarget)
            }}
          >
            <DotsIcon size={14} />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Portal overflow menu for list row secondary actions.
 * @param {{
 *   menuState: { asset: any, coords: { left: number, top: number }, triggerEl: HTMLElement | null },
 *   t: (key: string) => string,
 *   copiedId?: string,
 *   onClose: (restoreFocus?: boolean) => void,
 *   onOpen: (asset: any) => void,
 *   onReveal?: (asset: any) => void,
 *   onCopy?: (asset: any) => void,
 *   onRemove?: (asset: any) => void,
 * }} props
 */
function AssetListMoreMenu({ menuState, t, copiedId, onClose, onOpen, onReveal, onCopy, onRemove }) {
  const menuRef = useRef(null)
  const copyCloseTimerRef = useRef(null)
  const [localCopied, setLocalCopied] = useState(false)
  const { asset, coords } = menuState
  const firstFile = Array.isArray(asset?.files) ? asset.files[0] : null
  const missing = Number(asset?.missing_file_count) > 0 && (!asset?.files || asset.files.length === 0)
  const canReveal = Boolean(firstFile?.id && !missing)
  const isCopied = localCopied || Boolean(copiedId && copiedId === asset?.id)

  useEffect(() => {
    setLocalCopied(false)
    const firstItem = menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')
    firstItem?.focus?.()
    return () => {
      if (copyCloseTimerRef.current) {
        clearTimeout(copyCloseTimerRef.current)
        copyCloseTimerRef.current = null
      }
    }
  }, [asset?.id])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return
      if (menuState.triggerEl?.contains(event.target)) return
      onClose(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose(true)
      }
    }
    const handleScroll = () => onClose(false)
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [menuState.triggerEl, onClose])

  const handleMenuKeyDown = (event) => {
    if (event.key === 'Tab') {
      onClose(false)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const currentIdx = items.indexOf(document.activeElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + delta + items.length) % items.length
    items[nextIdx]?.focus?.()
  }

  const handleRevealClick = () => {
    onClose(true)
    if (!canReveal) return
    if (typeof onReveal === 'function') {
      Promise.resolve(onReveal(asset)).catch((err) => {
        console.warn('[omnimux-assets] reveal action failed:', err)
      })
    } else if (asset?.id && firstFile?.id) {
      Promise.resolve(revealAssetEntry(asset.id, firstFile.id, '')).catch((err) => {
        console.warn('[omnimux-assets] reveal fallback failed:', err)
      })
    }
  }

  const handleCopyClick = () => {
    if (typeof onCopy === 'function') {
      Promise.resolve(onCopy(asset)).catch((err) => {
        console.warn('[omnimux-assets] copy citation failed:', err)
      })
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      Promise.resolve(navigator.clipboard.writeText(citeOf(asset))).catch((err) => {
        console.warn('[omnimux-assets] clipboard write failed:', err)
      })
    }
    setLocalCopied(true)
    if (copyCloseTimerRef.current) clearTimeout(copyCloseTimerRef.current)
    copyCloseTimerRef.current = setTimeout(() => {
      copyCloseTimerRef.current = null
      onClose(true)
    }, 650)
  }

  const menuNode = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('list.moreActions')}
      className="omnimux-assets-list-more-menu"
      style={{ '--assets-menu-top': `${coords.top}px`, '--assets-menu-left': `${coords.left}px` }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleMenuKeyDown}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        role="menuitem"
        className="omnimux-assets-list-menu-item"
        leadingIcon={<EyeIcon size={14} />}
        onClick={() => {
          onClose(false)
          onOpen(asset)
        }}
      >
        {t('card.view')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        role="menuitem"
        className="omnimux-assets-list-menu-item"
        leadingIcon={<RevealLocationIcon size={14} />}
        disabled={!canReveal}
        onClick={handleRevealClick}
      >
        {t('browse.revealLocation')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        role="menuitem"
        className="omnimux-assets-list-menu-item"
        leadingIcon={<CopyIcon size={14} />}
        onClick={handleCopyClick}
      >
        {isCopied ? t('card.copied') : t('card.copyCite')}
      </Button>
      {typeof onRemove === 'function' ? (
        <>
          <div className="omnimux-assets-list-menu-sep" role="separator" />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            role="menuitem"
            className="omnimux-assets-list-menu-item omnimux-assets-list-menu-item--danger"
            leadingIcon={<TrashIcon size={14} />}
            onClick={() => {
              onClose(false)
              onRemove(asset)
            }}
          >
            {t('mapping.remove')}
          </Button>
        </>
      ) : null}
    </div>
  )

  return createPortalSafe(menuNode)
}

/**
 * Portal hover large-image preview popover for list thumbnails.
 * @param {{
 *   previewState: { asset: any, src: string, coords: { left: number, top: number } },
 *   t: (key: string) => string,
 * }} props
 */
function AssetListHoverPreview({ previewState, t }) {
  const { asset, src, coords } = previewState
  const node = (
    <div
      role="tooltip"
      className="omnimux-assets-list-preview-popover"
      style={{ '--assets-preview-top': `${coords.top}px`, '--assets-preview-left': `${coords.left}px` }}
    >
      <img src={src} alt="" className="omnimux-assets-list-preview-img" />
      <div className="omnimux-assets-list-preview-caption">
        <span className="omnimux-assets-list-preview-title">{asset.name}</span>
        <span className="omnimux-assets-list-preview-type">{t(`type.${asset.type}`)}</span>
      </div>
    </div>
  )
  return createPortalSafe(node)
}

/**
 * @param {{
 *   t: (key: string) => string,
 *   assets: any[],
 *   emptyLabel: string,
 *   emptyActionLabel?: string,
 *   showEmptyAction?: boolean,
 *   onEmptyAction?: () => void,
 *   onOpen: (asset: any) => void,
 *   onPreview?: (item: any) => void,
 *   onAddToConversation?: (asset: any) => void,
 *   selectedIds?: Set<string>,
 *   onToggleSelect?: (asset: any) => void,
 *   onSelectionChange?: (nextSet: Set<string>) => void,
 *   sortKey?: string,
 *   sortDirection?: 'asc' | 'desc',
 *   onSortChange?: (sortKey: string, sortDirection: 'asc' | 'desc') => void,
 *   viewMode?: 'grid' | 'list',
 *   onCopy?: (asset: any) => void,
 *   onRemove?: (asset: any) => void,
 *   onReveal?: (asset: any) => void,
 *   copiedId?: string,
 *   onBrowse?: (asset: any) => void,
 * }} props
 */
export function AssetGrid({
  t,
  assets,
  emptyLabel,
  emptyActionLabel,
  showEmptyAction = true,
  onEmptyAction,
  onOpen,
  onPreview,
  onAddToConversation,
  selectedIds,
  onToggleSelect,
  onSelectionChange,
  sortKey,
  sortDirection,
  onSortChange,
  viewMode = 'grid',
  onCopy,
  onRemove,
  onReveal,
  copiedId,
}) {
  // 与公共货架共用同一列数规则，两个货架在同一窗口下必须给出相同的列数。
  const [gridRef, gridColumns] = useGridColumns()
  const [localSort, setLocalSort] = useState({ key: 'updated_at', direction: 'desc' })
  const [activeRowId, setActiveRowId] = useState('')
  const [menuState, setMenuState] = useState(null)
  const [hoverPreview, setHoverPreview] = useState(null)

  const lastAnchorIdRef = useRef('')
  const hoverTimerRef = useRef(null)
  const hoverPreviewRef = useRef(null)
  const menuTriggerRef = useRef(null)
  const rowRefs = useRef(new Map())
  hoverPreviewRef.current = hoverPreview

  const isSortControlled = typeof onSortChange === 'function'
  const activeSortKey = isSortControlled ? (sortKey || 'updated_at') : localSort.key
  const activeSortDir = isSortControlled
    ? (sortDirection || defaultSortDirection(activeSortKey))
    : localSort.direction

  const displayAssets = useMemo(() => {
    if (viewMode !== 'list' || isSortControlled) return assets
    return sortAssetsBy(assets, activeSortKey, activeSortDir)
  }, [assets, viewMode, isSortControlled, activeSortKey, activeSortDir])

  const displaySignature = useMemo(
    () => displayAssets.map((row) => row?.id ?? '').join('\0'),
    [displayAssets],
  )

  const clearHoverPreview = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoverPreview(null)
  }, [])

  useEffect(() => clearHoverPreview, [clearHoverPreview])

  useEffect(() => {
    if (viewMode !== 'list') return undefined
    const dismissHover = () => {
      if (hoverTimerRef.current || hoverPreviewRef.current) clearHoverPreview()
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') dismissHover()
    }
    window.addEventListener('scroll', dismissHover, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('scroll', dismissHover, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [viewMode, clearHoverPreview])

  useEffect(() => {
    clearHoverPreview()
    menuTriggerRef.current = null
    setMenuState(null)
  }, [viewMode, displaySignature, clearHoverPreview])

  useEffect(() => {
    if (!selectedIds || selectedIds.size === 0) {
      lastAnchorIdRef.current = ''
    }
  }, [selectedIds])

  const closeMenu = useCallback((restoreFocus = false) => {
    const triggerEl = menuTriggerRef.current
    menuTriggerRef.current = null
    setMenuState(null)
    if (restoreFocus && triggerEl && triggerEl.isConnected && typeof triggerEl.focus === 'function') {
      triggerEl.focus()
    }
  }, [])

  const handleToggleMenu = useCallback((asset, triggerEl) => {
    clearHoverPreview()
    if (menuState && menuState.asset?.id === asset.id) {
      menuTriggerRef.current = null
      setMenuState(null)
      return
    }
    const rect = triggerEl.getBoundingClientRect()
    const coords = computePopoverCoords(rect, {
      width: MENU_ESTIMATED_WIDTH,
      height: MENU_ESTIMATED_HEIGHT,
      align: 'end',
    })
    menuTriggerRef.current = triggerEl
    setMenuState({ asset, coords, triggerEl })
  }, [clearHoverPreview, menuState])

  const handleThumbEnter = useCallback((asset, src, rect) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      const coords = computePopoverCoords(rect, {
        width: PREVIEW_ESTIMATED_WIDTH,
        height: PREVIEW_ESTIMATED_HEIGHT,
        align: 'right-of',
      })
      setHoverPreview({ asset, src, coords })
    }, HOVER_PREVIEW_DELAY_MS)
  }, [])

  const handleThumbLeave = useCallback((assetId) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoverPreview((prev) => (prev && (!assetId || prev.asset?.id === assetId) ? null : prev))
  }, [])

  const handleColumnSort = useCallback((colKey) => {
    const nextDir = activeSortKey === colKey
      ? (activeSortDir === 'asc' ? 'desc' : 'asc')
      : defaultSortDirection(colKey)
    if (isSortControlled) {
      onSortChange(colKey, nextDir)
    } else {
      setLocalSort({ key: colKey, direction: nextDir })
    }
  }, [activeSortKey, activeSortDir, isSortControlled, onSortChange])

  const applySelectionSet = useCallback((nextSet) => {
    if (typeof onSelectionChange === 'function') {
      onSelectionChange(nextSet)
      return
    }
    if (typeof onToggleSelect !== 'function') return
    const current = selectedIds || new Set()
    for (const asset of displayAssets) {
      const had = current.has(asset.id)
      const has = nextSet.has(asset.id)
      if (had !== has) onToggleSelect(asset)
    }
  }, [onSelectionChange, onToggleSelect, selectedIds, displayAssets])

  const handleSelectAll = useCallback(() => {
    const visibleIds = displayAssets.map((a) => a.id)
    const next = toggleAllVisibleIds(selectedIds || new Set(), visibleIds)
    if (next.size === 0) lastAnchorIdRef.current = ''
    applySelectionSet(next)
  }, [displayAssets, selectedIds, applySelectionSet])

  const handleRowCheck = useCallback((asset, shiftKey) => {
    const current = selectedIds || new Set()
    if (shiftKey && lastAnchorIdRef.current) {
      const orderedIds = displayAssets.map((a) => a.id)
      if (orderedIds.includes(lastAnchorIdRef.current)) {
        const next = selectRangeIds(current, orderedIds, lastAnchorIdRef.current, asset.id)
        applySelectionSet(next)
        return
      }
    }
    lastAnchorIdRef.current = asset.id
    if (typeof onSelectionChange === 'function') {
      onSelectionChange(toggleAssetIdInSet(current, asset.id))
    } else if (typeof onToggleSelect === 'function') {
      onToggleSelect(asset)
    }
  }, [selectedIds, displayAssets, applySelectionSet, onSelectionChange, onToggleSelect])

  const registerRowRef = useCallback((assetId, node) => {
    if (node) rowRefs.current.set(assetId, node)
    else rowRefs.current.delete(assetId)
  }, [])

  const handleRowNavigate = useCallback((currentIdx, delta) => {
    const nextIdx = currentIdx + delta
    if (nextIdx < 0 || nextIdx >= displayAssets.length) return
    const targetAsset = displayAssets[nextIdx]
    if (!targetAsset) return
    setActiveRowId(targetAsset.id)
    const rowEl = rowRefs.current.get(targetAsset.id)
    if (rowEl && typeof rowEl.focus === 'function') {
      rowEl.focus()
      rowEl.scrollIntoView?.({ block: 'nearest' })
    }
  }, [displayAssets])

  const canSelect = typeof onToggleSelect === 'function' || typeof onSelectionChange === 'function'

  if (assets.length === 0) {
    return (
      <div className="omnimux-assets-empty">
        <p>{emptyLabel}</p>
        {emptyActionLabel && onEmptyAction && showEmptyAction ? (
          <Button variant="primary" size="sm" onClick={onEmptyAction}>
            {emptyActionLabel}
          </Button>
        ) : null}
      </div>
    )
  }

  if (viewMode === 'list') {
    const selectedSet = selectedIds || new Set()
    const visibleSelectedCount = displayAssets.reduce((acc, row) => acc + (selectedSet.has(row.id) ? 1 : 0), 0)
    const headerChecked = visibleSelectedCount === 0
      ? 'false'
      : visibleSelectedCount === displayAssets.length
        ? 'true'
        : 'mixed'
    const resolvedActiveId = displayAssets.some((row) => row.id === activeRowId)
      ? activeRowId
      : (displayAssets[0]?.id ?? '')

    const sortHeadProps = (colKey, align = 'left') => ({
      align,
      sortable: true,
      sortDirection: activeSortKey === colKey ? activeSortDir : null,
      tabIndex: 0,
      'data-sort-key': colKey,
      onClick: () => handleColumnSort(colKey),
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleColumnSort(colKey)
        }
      },
    })

    return (
      <div className="omnimux-assets-list-wrap">
        <Table
          stickyHeader
          dense
          className="omnimux-assets-list-table"
          data-selecting={selectedSet.size > 0 ? 'true' : 'false'}
        >
          <TableHeader>
            <TableRow>
              <TableHead className="omnimux-assets-th-check">
                {canSelect ? (
                  <ListCheckbox
                    checked={headerChecked}
                    label={t('list.selectAll')}
                    onToggle={handleSelectAll}
                  />
                ) : null}
              </TableHead>
              <TableHead className="omnimux-assets-th-name" {...sortHeadProps('name', 'left')}>
                {t('detail.name')}
              </TableHead>
              <TableHead className="omnimux-assets-th-type" {...sortHeadProps('type', 'left')}>
                {t('detail.type')}
              </TableHead>
              <TableHead className="omnimux-assets-th-desc">
                {t('detail.description')}
              </TableHead>
              <TableHead className="omnimux-assets-th-files" {...sortHeadProps('files', 'right')}>
                {t('detail.files')}
              </TableHead>
              <TableHead className="omnimux-assets-th-updated" {...sortHeadProps('updated_at', 'right')}>
                {t('list.updatedAt')}
              </TableHead>
              <TableHead align="right" className="omnimux-assets-th-actions">
                {t('card.actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayAssets.map((asset, rowIndex) => {
              const selected = selectedSet.has(asset.id)
              const missing = Number(asset.missing_file_count) > 0 && (!asset.files || asset.files.length === 0)
              return (
                <AssetListRow
                  key={asset.id}
                  asset={asset}
                  rowIndex={rowIndex}
                  isActiveRow={asset.id === resolvedActiveId}
                  t={t}
                  selected={selected}
                  canSelect={canSelect}
                  menuOpen={menuState?.asset?.id === asset.id}
                  onRowCheck={handleRowCheck}
                  onOpen={onOpen}
                  onPreview={onPreview}
                  onAddToConversation={onAddToConversation}
                  onToggleMenu={handleToggleMenu}
                  onThumbEnter={handleThumbEnter}
                  onThumbLeave={handleThumbLeave}
                  onRowFocus={setActiveRowId}
                  onRowNavigate={handleRowNavigate}
                  registerRowRef={registerRowRef}
                  missing={missing}
                />
              )
            })}
          </TableBody>
        </Table>
        {menuState ? (
          <AssetListMoreMenu
            menuState={menuState}
            t={t}
            copiedId={copiedId}
            onClose={closeMenu}
            onOpen={onOpen}
            onReveal={onReveal}
            onCopy={onCopy}
            onRemove={onRemove}
          />
        ) : null}
        {hoverPreview ? (
          <AssetListHoverPreview previewState={hoverPreview} t={t} />
        ) : null}
      </div>
    )
  }

  return (
    <MasonryGrid
      gridRef={gridRef}
      columns={gridColumns}
      items={assets}
      getRatio={() => 3 / 4}
      renderItem={(asset) => {
        const missing = Number(asset.missing_file_count) > 0 && (!asset.files || asset.files.length === 0)
        const selected = selectedIds?.has(asset.id)
        return (
          <AssetGridCard
            key={asset.id}
            asset={asset}
            t={t}
            selected={selected}
            onToggleSelect={onToggleSelect}
            onOpen={onOpen}
            onPreview={onPreview}
            onAddToConversation={onAddToConversation}
            missing={missing}
          />
        )
      }}
    />
  )
}
