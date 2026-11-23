import { useCallback, useRef } from 'react'
import { Badge, Button, IconButton } from 'dsh-ui-kit'
import { Check, FileText, Film, Folder, Image as ImageIcon, Layers, Play } from 'lucide-react'
import { pickCoverSrc } from './api.js'
import { buildCardMenuItems } from './card-actions.js'
import { formatPlatformName } from './feed-helpers.js'
import { importErrorText, importSettledNotice, isFailedRow, isImportingRow } from './import-status.js'
import { InspirationCardMenu } from './InspirationCardMenu.jsx'
import { InspirationCollectionMenu } from './InspirationCollectionMenu.jsx'
import { detectPostVariant, getPostBody, hasRunningAnalysis } from './post-detail.js'
import { formatCount, formatRelativeTime, rivalLocaleOf } from './rival-format.js'

const ICON_REPLICATE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V6a2 2 0 0 1 2-2h10" />
  </svg>
)

function hasCompletedAnalysis(row) {
  if (!row || typeof row !== 'object') return false
  if (row.analysis_results && typeof row.analysis_results === 'object') {
    if (Object.values(row.analysis_results).some((entry) => entry?.status === 'done' && entry?.result)) {
      return true
    }
  }
  return Boolean(row.deconstruction || row.analysis)
}

function variantIcon(variant) {
  if (variant === 'video') return <Film size={16} aria-hidden="true" />
  if (variant === 'carousel') return <Layers size={16} aria-hidden="true" />
  if (variant === 'image') return <ImageIcon size={16} aria-hidden="true" />
  return <FileText size={16} aria-hidden="true" />
}

/**
 * Compact scannable list view for inspirations and collections.
 * Designed for high-frequency browsing paired with the docked right detail sidebar.
 */
export function InspirationListView({
  cards,
  t,
  tab,
  collectionId,
  activeId = '',
  selectedIds,
  selecting = false,
  replicateBusy = false,
  addingCollectionId = '',
  collectionBusy = false,
  onOpenCollection,
  onAddCollectionToSession,
  onRenameCollection,
  onToggleSelect,
  onSelect,
  onReplicate,
  onAddCardToSession,
  onMergeCard,
  onRemoveFromCollection,
  onDeleteCard,
}) {
  const listRef = useRef(null)
  const locale = rivalLocaleOf(t)

  const handleRowKeyNav = useCallback((event, onActivate) => {
    if (event.key === 'Enter' || event.key === ' ') {
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      onActivate()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...(listRef.current?.querySelectorAll('[data-list-focusable="true"]') || [])]
    const currentIndex = items.indexOf(event.currentTarget)
    if (currentIndex < 0) return
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(items.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1)
    if (nextIndex !== currentIndex) {
      event.preventDefault()
      items[nextIndex]?.focus()
    }
  }, [])

  return (
    <div ref={listRef} className="omnimux-inspiration-list" role="list" aria-label={t('feedView.list')}>
      {cards.map((descriptor) => {
        if (descriptor.card_type === 'collection') {
          const collection = descriptor.collection
          const count = Number(collection.item_count ?? collection.member_count ?? 0)
          const previewCover = collection.cover_urls?.[0] || collection.cover_url || ''
          const busy = addingCollectionId === String(collection.id)
          return (
            <div
              key={`collection-${collection.id}`}
              role="listitem"
              tabIndex={0}
              data-list-focusable="true"
              data-collection-id={String(collection.id)}
              className="omnimux-inspiration-list-row is-collection"
              onClick={() => onOpenCollection?.(collection)}
              onKeyDown={(event) => handleRowKeyNav(event, () => onOpenCollection?.(collection))}
            >
              <div className="omnimux-inspiration-list-thumb is-collection" aria-hidden="true">
                {previewCover ? <img src={previewCover} alt="" loading="lazy" decoding="async" /> : <Folder size={17} />}
              </div>

              <div className="omnimux-inspiration-list-main">
                <div className="omnimux-inspiration-list-title-row">
                  <Folder size={14} className="omnimux-inspiration-list-folder-icon" aria-hidden="true" />
                  <span className="omnimux-inspiration-list-title">{collection.title || t('collection.untitled')}</span>
                </div>
              </div>

              <div className="omnimux-inspiration-list-meta">
                <Badge size="xs" variant="neutral">
                  {t('list.collectionCount').replace('{n}', String(count))}
                </Badge>
              </div>

              <div className="omnimux-inspiration-list-actions" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  disabled={busy}
                  onClick={() => onAddCollectionToSession?.(collection)}
                >
                  {t('collection.addToSession')}
                </Button>
                <InspirationCollectionMenu
                  t={t}
                  disabled={collectionBusy}
                  onRename={() => onRenameCollection?.(collection)}
                />
              </div>
            </div>
          )
        }

        const row = descriptor.source_row
        const rowId = String(row.id)
        const isLocal = Boolean(row.is_local)
        const isSelected = Boolean(selectedIds?.has?.(row.id))
        const isActive = activeId !== '' && activeId === rowId
        const cover = descriptor.cover_key || pickCoverSrc(row)
        const variant = detectPostVariant(row)
        const title = String(row.title || row.source_url || row.id).trim()
        const rawBody = getPostBody(row).replace(/\s+/g, ' ').trim()
        const excerpt = rawBody && rawBody !== title ? rawBody : ''
        const platform = formatPlatformName(row.source_platform || (isLocal ? 'local' : 'tiktok'), t)
        const importing = isImportingRow(row)
        const failed = isFailedRow(row)
        const analyzing = hasRunningAnalysis(row)
        const analyzed = hasCompletedAnalysis(row)
        const failureReason = failed ? (importErrorText(row, t) || t('list.failed')) : importSettledNotice(row, t)
        const rawViews = descriptor.stats ? Number(descriptor.stats.views) : NaN
        const viewsText = Number.isFinite(rawViews) && rawViews >= 0
          ? t('card.meta.views').replace('{views}', formatCount(rawViews, locale))
          : ''
        const createdRaw = formatRelativeTime(row.created_at || row.posted_at, Date.now(), locale)
        const createdText = createdRaw === '--' ? '' : createdRaw
        const variantLabel = variant !== 'empty' ? t(`variant.${variant}`) : ''

        const activate = () => {
          if (selecting && isLocal && onToggleSelect) {
            onToggleSelect(row)
            return
          }
          onSelect?.(row)
        }

        return (
          <div
            key={`item-${rowId}`}
            role="listitem"
            tabIndex={0}
            data-list-focusable="true"
            data-inspiration-id={rowId}
            data-active={isActive ? 'true' : 'false'}
            aria-current={isActive ? 'true' : undefined}
            className={`omnimux-inspiration-list-row ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''} ${importing ? 'is-importing' : ''}`.trim()}
            onClick={activate}
            onKeyDown={(event) => handleRowKeyNav(event, activate)}
          >
            {selecting && isLocal && onToggleSelect ? (
              <IconButton
                size="xs"
                variant="ghost"
                className="omnimux-inspiration-list-check"
                data-selected={isSelected ? 'true' : 'false'}
                aria-label={t('select.toggle')}
                aria-pressed={isSelected ? 'true' : 'false'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSelect(row)
                }}
              >
                {isSelected ? <Check size={13} /> : <span />}
              </IconButton>
            ) : null}

            <div className={`omnimux-inspiration-list-thumb is-${variant}`} aria-hidden="true">
              {cover ? (
                <>
                  <img src={cover} alt="" loading="lazy" decoding="async" />
                  {variant === 'video' ? (
                    <span className="omnimux-inspiration-list-play">
                      <Play size={10} fill="currentColor" />
                    </span>
                  ) : null}
                </>
              ) : (
                variantIcon(variant)
              )}
            </div>

            <div className="omnimux-inspiration-list-main">
              <div className="omnimux-inspiration-list-title-row">
                <span className="omnimux-inspiration-list-title" title={title}>{title}</span>
              </div>
              {excerpt ? (
                <div className="omnimux-inspiration-list-excerpt" title={excerpt}>{excerpt}</div>
              ) : null}
            </div>

            <div className="omnimux-inspiration-list-meta">
              {importing ? (
                <span className="omnimux-inspiration-list-status is-busy" role="status">{t('list.importing')}</span>
              ) : failed ? (
                <span className="omnimux-inspiration-list-status is-failed" title={failureReason}>{t('list.failed')}</span>
              ) : analyzing ? (
                <span className="omnimux-inspiration-list-status is-busy">{t('list.analyzing')}</span>
              ) : analyzed ? (
                <span className="omnimux-inspiration-list-status is-done">{t('list.analyzed')}</span>
              ) : null}
              {variantLabel ? <span className="omnimux-inspiration-list-tag">{variantLabel}</span> : null}
              <span className="omnimux-inspiration-list-platform">{platform}</span>
              {viewsText ? <span className="omnimux-inspiration-list-views">{viewsText}</span> : null}
              {createdText ? <span className="omnimux-inspiration-list-time">{createdText}</span> : null}
            </div>

            <div className="omnimux-inspiration-list-actions" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={ICON_REPLICATE}
                disabled={Boolean(replicateBusy) || importing}
                aria-label={t('card.cta.tryFull')}
                onClick={() => onReplicate?.(row)}
              >
                {t('card.cta.try')}
              </Button>
              <InspirationCardMenu
                t={t}
                disabled={collectionBusy}
                items={buildCardMenuItems({
                  t,
                  local: tab === 'local',
                  inCollection: Boolean(collectionId),
                  onAddToConversation: () => onAddCardToSession?.(descriptor),
                  onMerge: () => onMergeCard?.(row),
                  onRemove: () => onRemoveFromCollection?.(row),
                  onDelete: () => onDeleteCard?.(row),
                })}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
