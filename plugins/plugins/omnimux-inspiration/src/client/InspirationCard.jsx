import { useEffect, useState } from 'react'
import { Button, IconButton } from 'dsh-ui-kit'
import { SocialPostCard } from 'dsh-ui-kit/social-card'
import { AlertTriangle, Check, Eye, Star } from 'lucide-react'
import { isUsableCoverSize, pickVideoSrc } from './api.js'
import { importErrorText, importPillLabel, importSettledNotice, isFailedRow, isImportingRow } from './import-status.js'
import { toSocialPostCardItem } from './inspiration-card.js'
import { InspirationCardMenu } from './InspirationCardMenu.jsx'
import { OrganicShimmerOverlay } from './OrganicShimmer.jsx'

const ICON_REPLICATE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V6a2 2 0 0 1 2-2h10" />
  </svg>
)

function stopCardEvent(event) {
  event.preventDefault()
  event.stopPropagation()
}

function isolateInnerCardKey(event) {
  event.stopPropagation()
  if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
}

/**
 * Library & feed card built on top of shared `SocialPostCard` (6 semantic archetypes).
 * Injects local multi-select checkbox, favorite pin star, failure badge, `⋯` overflow menu,
 * importing fluid shimmer overlay, hover Detail / Replicate buttons, and right-click context menu.
 */
export function InspirationCard({
  descriptor,
  t,
  selected = false,
  active = false,
  selecting = false,
  replicateBusy = false,
  menuDisabled = false,
  menuEntries,
  onMenuSelect,
  onSelect,
  onToggleSelect,
  onToggleFavorite,
  onReplicate,
  onOpenContextMenu,
}) {
  const row = descriptor?.source_row || descriptor
  const socialItem = descriptor?.social_item || toSocialPostCardItem(row, t)
  const isLocal = Boolean(row?.is_local)
  const importing = isImportingRow(row)
  const failed = isFailedRow(row)
  const isFavorite = Boolean(row?.is_favorite)
  const videoSrc = pickVideoSrc(row)
  const coverUrl = socialItem.coverUrl || ''

  const [broken, setBroken] = useState(!coverUrl)
  const [fallbackTimeout, setFallbackTimeout] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setBroken(!coverUrl)
    setFallbackTimeout(false)
    setFrameReady(false)
  }, [coverUrl, videoSrc])

  const usesVideoFrame = broken && Boolean(videoSrc) && !fallbackTimeout
  useEffect(() => {
    if (!usesVideoFrame || frameReady) return undefined
    const timer = setTimeout(() => setFallbackTimeout(true), 2500)
    return () => clearTimeout(timer)
  }, [usesVideoFrame, frameReady])

  const statusPill = importPillLabel(row, t)
  const errorDetail = importSettledNotice(row, t) || importErrorText(row, t)
  const failureReason = failed || errorDetail ? (errorDetail || statusPill || t('add.status.failed')) : ''

  const handleCardClick = () => {
    if (selecting && isLocal && onToggleSelect) {
      onToggleSelect(row)
      return
    }
    onSelect?.(row)
  }

  const handleDetailClick = (event) => {
    stopCardEvent(event)
    onSelect?.(row)
  }

  const handleReplicateClick = (event) => {
    stopCardEvent(event)
    if (replicateBusy || importing) return
    onReplicate?.(row)
  }

  let coverNode
  let effectiveItem = socialItem
  let hideMedia = false
  if (importing) {
    if (!coverUrl) {
      effectiveItem = { ...socialItem, archetype: 'web-link', coverUrl: undefined }
    }
    coverNode = <div className="omx-card-media-placeholder" aria-hidden="true" />
  } else if (failed && !coverUrl && !usesVideoFrame) {
    // Collapse media-less failed imports onto a compact post card instead of an empty 4:5 fallback box.
    hideMedia = true
    effectiveItem = {
      ...socialItem,
      archetype: 'social-post',
      coverUrl: undefined,
      body: failureReason || socialItem.body || socialItem.title,
    }
  } else if (usesVideoFrame) {
    coverNode = (
      <video
        className="omx-card-cover-media"
        src={videoSrc}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onLoadedData={() => setFrameReady(true)}
        onError={() => {
          setFrameReady(false)
          setFallbackTimeout(true)
        }}
      />
    )
  } else if (!broken && coverUrl) {
    coverNode = (
      <img
        className="omx-card-cover-media"
        src={coverUrl}
        alt={socialItem.coverAlt || socialItem.title || ''}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        onLoad={(event) => {
          const node = event.currentTarget
          if (!isUsableCoverSize(node.naturalWidth, node.naturalHeight)) setBroken(true)
        }}
      />
    )
  } else if (coverUrl) {
    // Let SocialPostCard fall back to its clean platform mark when URL image fails/is unusable.
    effectiveItem = { ...socialItem, coverUrl: undefined }
  }

  const topLeftSlot = isLocal && onToggleSelect ? (
    <IconButton
      variant="ghost"
      size="xs"
      className="omx-card-check"
      data-selected={selected ? 'true' : 'false'}
      aria-label={t('select.toggle')}
      aria-pressed={selected ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation()
        onToggleSelect(row)
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        isolateInnerCardKey(event)
        if (event.key === 'Enter' || event.key === ' ') onToggleSelect(row)
      }}
    >
      {selected ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <span />}
    </IconButton>
  ) : null

  const hasPinnedTopRight = Boolean((isLocal && isFavorite) || failureReason)
  const topRightSlot = (
    <div className="omx-card-tr-group">
      {failureReason ? (
        <span
          className={`omx-card-failure ${failed ? 'is-failed' : 'is-settled'}`}
          role="img"
          title={failureReason}
          aria-label={failureReason}
        >
          <AlertTriangle size={13} aria-hidden="true" />
        </span>
      ) : null}
      {isLocal && typeof onToggleFavorite === 'function' ? (
        <IconButton
          variant="ghost"
          size="xs"
          className={`omx-card-fav ${isFavorite ? 'is-favorited' : ''}`}
          aria-label={t(isFavorite ? 'card.menu.unfavorite' : 'card.menu.favorite')}
          aria-pressed={isFavorite ? 'true' : 'false'}
          title={t(isFavorite ? 'card.menu.unfavorite' : 'card.menu.favorite')}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite(row)
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            isolateInnerCardKey(event)
            if (event.key === 'Enter' || event.key === ' ') onToggleFavorite(row)
          }}
        >
          <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </IconButton>
      ) : null}
      <InspirationCardMenu
        t={t}
        disabled={menuDisabled}
        entries={menuEntries}
        onSelect={onMenuSelect}
        onOpenChange={setMenuOpen}
      />
    </div>
  )

  const hoverActions = !selecting && !importing ? (
    <div className="omx-card-hover-cta">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="omx-card-act-btn is-secondary"
        aria-label={t('card.cta.detail')}
        leadingIcon={<Eye size={13} aria-hidden="true" />}
        onClick={handleDetailClick}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          isolateInnerCardKey(event)
          if (event.key === 'Enter' || event.key === ' ') handleDetailClick(event)
        }}
      >
        <span className="omx-card-act-label">{t('card.cta.detail')}</span>
      </Button>
      {typeof onReplicate === 'function' ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="omx-card-act-btn is-primary"
          aria-label={t('card.cta.tryFull')}
          aria-disabled={replicateBusy ? 'true' : 'false'}
          disabled={Boolean(replicateBusy)}
          leadingIcon={ICON_REPLICATE}
          onClick={handleReplicateClick}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            isolateInnerCardKey(event)
            if (event.key === 'Enter' || event.key === ' ') handleReplicateClick(event)
          }}
        >
          <span className="omx-card-act-label">{t('card.cta.try')}</span>
        </Button>
      ) : null}
    </div>
  ) : null

  const statusOverlay = importing ? (
    <div className="omx-card-importing-overlay" aria-hidden="true">
      <OrganicShimmerOverlay />
      {statusPill ? <span className="omx-card-progress" role="status">{statusPill}</span> : null}
    </div>
  ) : null

  const pinnedTopRightCount = (failureReason ? 1 : 0) + (isLocal && isFavorite ? 1 : 0)

  return (
    <SocialPostCard
      item={effectiveItem}
      density="default"
      selected={Boolean(selected)}
      active={Boolean(active)}
      loading={importing}
      menuOpen={menuOpen}
      hasPinnedTopRight={hasPinnedTopRight}
      pinnedTopRightCount={pinnedTopRightCount}
      topLeftSlot={topLeftSlot}
      topRightSlot={topRightSlot}
      hoverActions={hoverActions}
      statusOverlay={statusOverlay}
      coverNode={coverNode}
      hideMedia={hideMedia}
      className={`omx-inspiration-card ${descriptor?.landed ? 'is-landed' : ''}`.trim()}
      dataAttributes={{
        'data-inspiration-id': String(row?.id ?? ''),
        'data-favorite': isFavorite ? 'true' : undefined,
      }}
      onClick={handleCardClick}
      onContextMenu={onOpenContextMenu ? (event) => onOpenContextMenu(event, descriptor) : undefined}
    />
  )
}
