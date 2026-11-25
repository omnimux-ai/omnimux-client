import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Badge,
  Button,
  IconButton,
  IconEllipsisOutline16,
  IconTrashOutline16,
  MediaCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from 'dsh-ui-kit'
import {
  CheckIcon,
  DocIcon,
  FileIcon,
  FolderIcon,
  EyeIcon,
  ChatIcon,
  PlayIcon,
  RevealLocationIcon,
} from './icons.jsx'
import { previewUrl, revealAssetEntry } from './api.js'
import { pickCoverFile, isVideoFile, addAssetToConversation } from './add-to-chat.js'
import { isFolderAsset, resolveAssetMediaPreview } from './asset-routing.js'
import { formatTimeAgo } from './format.js'

const PROGRESS_RING_RADIUS = 16
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS

/**
 * Pick the first video file on an asset when no image cover exists.
 * @param {any} asset
 * @returns {any | null}
 */
function pickVideoFile(asset) {
  if (!asset) return null
  if (isVideoFile(asset.cover)) return asset.cover
  const files = Array.isArray(asset.files) ? asset.files : []
  return files.find(isVideoFile) ?? null
}

/**
 * Resolve optional upload progress percentage [0, 100) for uploading assets.
 * @param {any} asset
 * @returns {number | null}
 */
function resolveUploadProgress(asset) {
  const raw = asset?.uploadProgress ?? asset?.progress
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw < 0 || raw >= 100) return null
  return Math.min(99, Math.round(raw))
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
 *   onRemove?: (asset: any) => void,
 *   onError?: (message: string) => void,
 *   missing?: boolean,
 * }} props
 */
function AssetGridCard({
  asset,
  t,
  selected,
  onToggleSelect,
  onOpen,
  onPreview,
  onAddToConversation,
  onRemove,
  onError,
  missing,
}) {
  const [broken, setBroken] = useState(false)
  const [added, setAdded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const timerRef = useRef(null)

  const coverFile = pickCoverFile(asset)
  const videoFile = coverFile ? null : pickVideoFile(asset)
  const revealTarget = coverFile || videoFile || (Array.isArray(asset?.files) ? asset.files[0] : null)
  const uploadProgress = resolveUploadProgress(asset)

  useEffect(() => {
    setBroken(false)
  }, [asset?.id, coverFile?.id, videoFile?.id])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const imgSrc = coverFile && !broken ? previewUrl(asset.id, coverFile.id) : ''
  const videoSrc = !imgSrc && videoFile && !broken ? previewUrl(asset.id, videoFile.id) : ''

  const handleTriggerAction = useCallback(() => {
    if (isFolderAsset(asset)) {
      onOpen(asset)
    } else if (typeof onPreview === 'function') {
      onPreview(resolveAssetMediaPreview(asset))
    } else {
      onOpen(asset)
    }
  }, [asset, onOpen, onPreview])

  const triggerAdd = useCallback(() => {
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
  }, [added, asset, onAddToConversation])

  const handleAdd = useCallback((event) => {
    event?.stopPropagation()
    triggerAdd()
  }, [triggerAdd])

  const handleReveal = useCallback(async () => {
    if (!revealTarget?.id) return
    onError?.('')
    try {
      const result = await revealAssetEntry(asset.id, revealTarget.id, '')
      if (!result?.ok) {
        onError?.(t('browse.revealFailed'))
      }
    } catch {
      onError?.(t('browse.revealFailed'))
    }
  }, [asset?.id, onError, revealTarget?.id, t])

  const handleMenuToggle = useCallback((event) => {
    event.stopPropagation()
    setMenuOpen((prev) => !prev)
  }, [])

  const handleMenuClose = useCallback((event) => {
    event?.stopPropagation?.()
    setMenuOpen(false)
  }, [])

  const handleMenuSelect = useCallback((id) => {
    setMenuOpen(false)
    if (id === 'view') {
      if (typeof onOpen === 'function') onOpen(asset)
      else handleTriggerAction()
    } else if (id === 'add') {
      triggerAdd()
    } else if (id === 'reveal') {
      void handleReveal()
    } else if (id === 'remove') {
      onRemove?.(asset)
    }
  }, [asset, handleReveal, handleTriggerAction, onOpen, onRemove, triggerAdd])

  const menuItems = useMemo(() => {
    const items = [
      { id: 'view', label: t('card.view'), icon: <EyeIcon size={14} /> },
      {
        id: 'add',
        label: added ? t('card.addedToConversation') : t('card.addToConversation'),
        icon: added ? <CheckIcon size={14} /> : <ChatIcon size={14} />,
        disabled: added,
      },
    ]
    if (revealTarget?.id) {
      items.push({ id: 'reveal', label: t('browse.revealLocation'), icon: <RevealLocationIcon size={14} /> })
    }
    if (typeof onRemove === 'function') {
      items.push({ id: 'remove', label: t('mapping.remove'), icon: <IconTrashOutline16 size={14} />, danger: true })
    }
    return items
  }, [added, onRemove, revealTarget?.id, t])

  const stopNestedKey = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation()
    }
  }

  let visualNode
  if (uploadProgress !== null) {
    const dashOffset = PROGRESS_RING_CIRCUMFERENCE * (1 - uploadProgress / 100)
    visualNode = (
      <div className="omnimux-assets-card-progress" aria-label={`${uploadProgress}%`}>
        <div className="omnimux-assets-card-progress-ring">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <circle
              className="omnimux-assets-card-progress-track"
              cx="20"
              cy="20"
              r={PROGRESS_RING_RADIUS}
              fill="none"
              strokeWidth="3"
            />
            <circle
              className="omnimux-assets-card-progress-arc"
              cx="20"
              cy="20"
              r={PROGRESS_RING_RADIUS}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={PROGRESS_RING_CIRCUMFERENCE.toFixed(1)}
              strokeDashoffset={dashOffset.toFixed(1)}
            />
          </svg>
          <span className="omnimux-assets-card-progress-pct">{uploadProgress}%</span>
        </div>
      </div>
    )
  } else if (imgSrc) {
    visualNode = (
      <img
        src={imgSrc}
        className="omnimux-assets-card-media"
        alt=""
        onError={() => setBroken(true)}
      />
    )
  } else if (videoSrc) {
    visualNode = (
      <>
        <video
          src={videoSrc}
          muted
          playsInline
          preload="metadata"
          className="omnimux-assets-card-video"
          onError={() => setBroken(true)}
        />
        <span className="omnimux-assets-card-video-play" aria-hidden="true">
          <PlayIcon size={13} />
        </span>
      </>
    )
  } else {
    const FallbackIcon = isFolderAsset(asset)
      ? FolderIcon
      : asset?.type === 'knowledge'
        ? DocIcon
        : FileIcon
    visualNode = (
      <div className="omnimux-assets-card-placeholder" aria-hidden="true">
        <FallbackIcon size={22} />
      </div>
    )
  }

  const addLabel = added ? t('card.addedToConversation') : t('card.addToConversation')

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
          onKeyDown={stopNestedKey}
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelect(asset)
          }}
        >
          {selected ? <CheckIcon size={12} /> : <span />}
        </IconButton>
      ) : null}
      {visualNode}
      <div className="omnimux-assets-card-corner">
        <IconButton
          variant="ghost"
          size="xs"
          className="omnimux-assets-quick-add"
          data-added={added ? 'true' : 'false'}
          aria-label={addLabel}
          title={addLabel}
          disabled={added}
          onKeyDown={stopNestedKey}
          onClick={handleAdd}
        >
          {added ? <CheckIcon size={13} /> : <ChatIcon size={13} />}
        </IconButton>
        <Badge size="sm" shape="capsule" className="omnimux-assets-badge">
          {t(`type.${asset.type}`)}
        </Badge>
      </div>
      {missing ? <span className="omnimux-assets-missing">{t('card.missing')}</span> : null}
    </div>
  )

  const titleNode = (
    <div className="omnimux-assets-card-head">
      <span className="omnimux-assets-card-title" title={asset.name}>{asset.name}</span>
      <div
        className="omnimux-assets-card-more"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={stopNestedKey}
      >
        <Menu
          open={menuOpen}
          portal
          dense
          align="end"
          items={menuItems}
          onSelect={handleMenuSelect}
          onClose={handleMenuClose}
          anchor={(
            <IconButton
              variant="ghost"
              size="xs"
              className="omnimux-assets-card-more-btn"
              aria-label={t('card.actions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={handleMenuToggle}
            >
              <IconEllipsisOutline16 size={15} />
            </IconButton>
          )}
        />
      </div>
    </div>
  )

  const timeText = formatTimeAgo(asset.created_at || asset.createdAt || asset.updated_at)
  const safeType = /^[a-zA-Z0-9_-]+$/.test(asset?.type ?? '') ? asset.type : null
  const typeClass = safeType ? `omnimux-assets-card--${safeType}` : 'omnimux-assets-card--custom'

  return (
    <MediaCard
      className={`omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray ${typeClass}`.trim()}
      data-type={safeType ?? undefined}
      selected={selected}
      onClick={handleTriggerAction}
      coverNode={coverNode}
      title={titleNode}
      subtitle={timeText || '—'}
    />
  )
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
function AssetListRow({ asset, t, selected, onToggleSelect, onOpen, onPreview, onAddToConversation, missing }) {
  const [added, setAdded] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

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

  return (
    <TableRow
      selected={selected}
      className="omnimux-assets-list-row"
      onClick={handleTriggerAction}
    >
      <TableCell className="omnimux-assets-td-check" onClick={(e) => e.stopPropagation()}>
        {onToggleSelect ? (
          <IconButton
            variant="ghost"
            size="xs"
            aria-label={t('select.toggle')}
            aria-pressed={selected ? 'true' : 'false'}
            onClick={() => onToggleSelect(asset)}
          >
            {selected ? <CheckIcon size={12} /> : <span />}
          </IconButton>
        ) : null}
      </TableCell>
      <TableCell className="omnimux-assets-td-name">
        <div className="omnimux-assets-list-cell-name">
          <FileIcon size={16} />
          <span>{asset.name}</span>
        </div>
      </TableCell>
      <TableCell className="omnimux-assets-td-type">
        <Badge size="sm" shape="capsule" variant="neutral" className="omnimux-assets-badge omnimux-assets-list-badge">
          {t(`type.${asset.type}`)}
        </Badge>
      </TableCell>
      <TableCell className="omnimux-assets-td-desc">
        {asset.description || '—'}
      </TableCell>
      <TableCell className="omnimux-assets-td-files">
        {asset.files?.length ? `${asset.files.length} 个素材` : '无素材'}
        {missing ? <span className="omnimux-assets-missing omnimux-assets-list-missing">{t('card.missing')}</span> : null}
      </TableCell>
      <TableCell className="omnimux-assets-td-actions" onClick={(e) => e.stopPropagation()}>
        <div className="omnimux-assets-list-actions">
          <Button
            variant="ghost"
            size="xs"
            leadingIcon={<EyeIcon size={14} />}
            onClick={handleView}
          >
            {t('card.view')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            leadingIcon={<ChatIcon size={14} />}
            disabled={added}
            onClick={handleAdd}
          >
            {added ? t('card.addedToConversation') : t('card.addToConversation')}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
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
 *   viewMode?: 'grid' | 'list',
 *   onCopy?: (asset: any) => void,
 *   onRemove?: (asset: any) => void,
 *   onError?: (message: string) => void,
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
  onRemove,
  onError,
  selectedIds,
  onToggleSelect,
  viewMode = 'grid',
}) {
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
    return (
      <div className="omnimux-assets-list-wrap">
        <Table stickyHeader dense className="omnimux-assets-list-table">
          <TableHeader>
            <TableRow>
              <TableHead className="omnimux-assets-th-check" />
              <TableHead className="omnimux-assets-th-name">{t('detail.name')}</TableHead>
              <TableHead className="omnimux-assets-th-type">{t('detail.type')}</TableHead>
              <TableHead className="omnimux-assets-th-desc">{t('detail.description')}</TableHead>
              <TableHead className="omnimux-assets-th-files">{t('detail.files')}</TableHead>
              <TableHead className="omnimux-assets-th-actions">{t('card.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((asset) => {
              const selected = selectedIds?.has(asset.id)
              const missing = Number(asset.missing_file_count) > 0 && (!asset.files || asset.files.length === 0)
              return (
                <AssetListRow
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
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="omnimux-assets-local-grid">
      {assets.map((asset) => {
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
            onRemove={onRemove}
            onError={onError}
            missing={missing}
          />
        )
      })}
    </div>
  )
}
