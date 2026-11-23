import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, CopyButton, IconButton } from 'dsh-ui-kit'
import { Maximize2, Share, X } from 'lucide-react'
import { InspirationPostDetail } from './InspirationPostDetail.jsx'
import { createShareLink, getLocalInspiration, shareRequestPayload } from './api.js'
import { getInspirationPreviewData } from './inspiration-preview-data.js'
import { importErrorText, importSettledNotice, importStageLabel, isFailedRow, isImportingRow } from './import-status.js'
import { createImportPoller } from './import-poller.js'
import { detectPostVariant } from './post-detail.js'
import { decideSharePollOutcome, isShareRunning, shareErrorText, shareMediaNotice, shareSteps, shareUrlOf, shareValidityText } from './share-status.js'

/**
 * Non-blocking docked right inspector for browsing inspirations alongside the feed.
 * Adapts layout polymorphically via `InspirationPostDetail` (`mode="sidebar"`).
 *
 * @param {{
 *   row: Record<string, any> | null,
 *   t: (key: string) => string,
 *   onClose: () => void,
 *   onExpandModal?: () => void,
 *   onItemUpdated?: (item: Record<string, any>) => void,
 *   onReplicate?: (item: Record<string, any>) => Promise<any>,
 *   replicateBusy?: boolean,
 * }} props
 */
export function InspirationDetailSidebar({
  row,
  t,
  onClose,
  onExpandModal,
  onItemUpdated,
  onReplicate,
  replicateBusy,
}) {
  const [item, setItem] = useState(row)
  const [showSharePopover, setShowSharePopover] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState(null)
  const sidebarRef = useRef(null)
  const shareTriggerRef = useRef(null)
  const sharePopoverRef = useRef(null)
  const applyItemRef = useRef(() => {})
  const currentItemRef = useRef({ id: '', isLocal: true, sourceUrl: '' })

  useEffect(() => {
    setItem(row)
  }, [row])

  const itemKey = item?.id == null ? '' : String(item.id)
  currentItemRef.current = {
    id: itemKey,
    isLocal: item?.is_local !== false,
    sourceUrl: String(item?.source_url || ''),
  }

  const isCurrentOrPromoted = (next) => {
    if (!next || typeof next !== 'object') return false
    const current = currentItemRef.current
    if (!current.id) return true
    if (next.id != null && String(next.id) === current.id) return true
    // Allow cloud-to-local promotion for the same post (id changes from cloud id to local insp_* id).
    if (current.isLocal === false && next.is_local !== false) {
      const nextUrl = String(next.source_url || '')
      if (!current.sourceUrl || !nextUrl || nextUrl === current.sourceUrl) return true
    }
    return false
  }

  useEffect(() => {
    setShowSharePopover(false)
    setShareError(null)
    setSharing(false)
  }, [itemKey])

  // Close share popover on Esc / outside click.
  useEffect(() => {
    if (!showSharePopover) return undefined
    const dismiss = (event) => {
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        setShowSharePopover(false)
        shareTriggerRef.current?.focus()
      } else if (!sharePopoverRef.current?.contains(event.target) && !shareTriggerRef.current?.contains(event.target)) {
        setShowSharePopover(false)
      }
    }
    window.addEventListener('keydown', dismiss, true)
    window.addEventListener('pointerdown', dismiss, true)
    return () => {
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('pointerdown', dismiss, true)
    }
  }, [showSharePopover])

  // Esc closes the docked inspector when no nested popover or drawer is open.
  useEffect(() => {
    if (!row) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (showSharePopover) return
      if (typeof document !== 'undefined' && document.querySelector('.omnimux-post-lightbox, .omnimux-post-creation-drawer')) return
      event.preventDefault()
      onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [row, showSharePopover, onClose])

  const sharePoller = useMemo(() => createImportPoller({
    interpret: decideSharePollOutcome,
    deps: {
      fetchItem: (id) => getLocalInspiration(id),
      onItem: (next) => applyItemRef.current(next),
      onSettled: (next) => applyItemRef.current(next),
      onFailed: (next) => applyItemRef.current(next),
    },
  }), [itemKey])

  useEffect(() => {
    sharePoller.start()
    return () => sharePoller.dispose()
  }, [sharePoller])

  const commitItem = (next) => {
    if (!isCurrentOrPromoted(next)) return
    currentItemRef.current = {
      id: next.id == null ? '' : String(next.id),
      isLocal: next.is_local !== false,
      sourceUrl: String(next.source_url || currentItemRef.current.sourceUrl || ''),
    }
    setItem(next)
    onItemUpdated?.(next)
  }

  useEffect(() => {
    applyItemRef.current = (next) => {
      if (!next || typeof next !== 'object') return
      // Share polling only applies to the exact local item id that initiated it.
      if (next.id != null && currentItemRef.current.id && String(next.id) !== currentItemRef.current.id) return
      setItem(next)
      onItemUpdated?.(next)
    }
  })

  useEffect(() => {
    if (item?.id && isShareRunning(item)) sharePoller.track(String(item.id))
  }, [item?.id, item?.share_status, sharePoller])

  const data = useMemo(() => getInspirationPreviewData(item), [item])
  const variant = useMemo(() => detectPostVariant(item), [item])
  const shareUrl = shareUrlOf(item)
  const shareRunning = isShareRunning(item)
  const shareStepsList = shareRunning ? shareSteps(item, t) : []
  const shareFailure = shareError || shareErrorText(item)
  const shareValidity = shareValidityText(item, t)
  const shareMediaWarning = shareMediaNotice(item, t)
  const importing = isImportingRow(item)
  const failed = isFailedRow(item)
  const settledNotice = importSettledNotice(item, t)
  const applyItem = commitItem

  const handleCreateShare = async () => {
    if (sharing || !data.safeItem.id) return
    const requestItemId = String(data.safeItem.id)
    setSharing(true)
    setShareError(null)
    try {
      const response = await createShareLink(data.safeItem.id, shareRequestPayload(data.safeItem))
      if (currentItemRef.current.id !== requestItemId) return
      const next = response.body?.data
      if (!response.ok) {
        setShareError(response.body?.error || t('modal.share.failed') || '创建失败')
        return
      }
      if (next) {
        applyItemRef.current(next)
        if (isShareRunning(next)) sharePoller.track(next.id)
      }
    } catch (error) {
      if (currentItemRef.current.id !== requestItemId) return
      setShareError(String(error?.message || error))
    } finally {
      if (currentItemRef.current.id === requestItemId) setSharing(false)
    }
  }

  if (!row || !item) return null

  const variantLabel = variant !== 'empty' ? t(`variant.${variant}`) : ''

  return (
    <aside
      ref={sidebarRef}
      className="omnimux-inspiration-detail-sidebar"
      aria-label={data.title}
      data-item-id={itemKey}
      data-post-variant={variant}
    >
      <div className="omnimux-inspiration-sidebar-header">
        <div className="omnimux-inspiration-sidebar-heading">
          {variantLabel ? <Badge size="xs" variant="neutral">{variantLabel}</Badge> : null}
          <h2 title={data.title}>{data.title}</h2>
          <CopyButton
            text={data.title}
            label=""
            copiedLabel=""
            title={t('modal.header.copy')}
            aria-label={t('modal.header.copy')}
            size="sm"
            variant="ghost"
            className="omnimux-inspiration-modal-copy is-icon-only"
          />
        </div>

        <div className="omnimux-inspiration-sidebar-actions">
          <div className="omnimux-inspiration-modal-header-actions">
            <IconButton
              size="sm"
              variant="ghost"
              ref={shareTriggerRef}
              className={`omnimux-inspiration-sidebar-action-btn ${showSharePopover ? 'is-active' : ''}`}
              onClick={() => setShowSharePopover((prev) => !prev)}
              title={t('modal.share.btn') || '分享'}
              aria-label={t('modal.share.btn') || '分享'}
              aria-expanded={showSharePopover}
            >
              <Share size={14} />
            </IconButton>

            {showSharePopover ? (
              <div ref={sharePopoverRef} className="omnimux-inspiration-share-popover" onClick={(e) => e.stopPropagation()}>
                <div className="omnimux-inspiration-share-popover-header">
                  <span className="omnimux-inspiration-share-popover-title">
                    {t('modal.share.title') || '分享灵感'}
                  </span>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    className="omnimux-inspiration-share-popover-close"
                    onClick={() => setShowSharePopover(false)}
                    aria-label={t('close') || '关闭'}
                  >
                    <X size={14} />
                  </IconButton>
                </div>

                {shareUrl ? (
                  <div className="omnimux-inspiration-share-result">
                    <div className="omnimux-inspiration-share-link-box">
                      <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        className="omnimux-inspiration-share-input"
                      />
                      <CopyButton
                        text={shareUrl}
                        label={t('modal.share.copy') || '复制'}
                        copiedLabel={t('modal.share.copied') || '已复制'}
                        size="sm"
                        variant="secondary"
                        className="omnimux-inspiration-share-copy-btn"
                      />
                    </div>
                    <div className="omnimux-inspiration-share-meta">
                      <span>{shareValidity}</span>
                      <span className="omnimux-inspiration-share-done">{t('modal.share.doneTag') || '已发布'}</span>
                    </div>
                    {shareMediaWarning ? (
                      <div className="omnimux-inspiration-share-tip" role="status" data-share-notice="media-unavailable">
                        {shareMediaWarning}
                      </div>
                    ) : null}
                  </div>
                ) : shareRunning ? (
                  <div className="omnimux-inspiration-share-progress" role="status" aria-live="polite" aria-label={t('modal.share.progress') || '发布进度'}>
                    <ol className="omnimux-inspiration-share-steps">
                      {shareStepsList.map((step) => (
                        <li
                          key={step.id}
                          className={`omnimux-inspiration-share-step is-${step.state}`}
                          data-share-step={step.id}
                          data-share-state={step.state}
                          aria-current={step.state === 'active' ? 'step' : undefined}
                        >
                          <span className="omnimux-inspiration-share-step-dot" aria-hidden="true" />
                          <span className="omnimux-inspiration-share-step-label">{step.label}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div className="omnimux-inspiration-share-form">
                    <p className="omnimux-inspiration-share-hint">{t('modal.share.validityHint')}</p>

                    {shareFailure ? (
                      <div className="omnimux-inspiration-share-tip is-error" role="alert">
                        {shareFailure}
                      </div>
                    ) : null}

                    <Button
                      className="omnimux-inspiration-share-submit-btn"
                      variant="primary"
                      size="sm"
                      onClick={handleCreateShare}
                      loading={sharing}
                      disabled={sharing}
                    >
                      {sharing
                        ? (t('modal.share.creating') || '创建中…')
                        : shareFailure
                          ? (t('modal.share.retry') || '重新创建链接')
                          : (t('modal.share.create') || '创建链接')}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {typeof onExpandModal === 'function' ? (
            <IconButton
              size="sm"
              variant="ghost"
              className="omnimux-inspiration-sidebar-action-btn"
              onClick={onExpandModal}
              title={t('sidebar.expandModal')}
              aria-label={t('sidebar.expandModal')}
            >
              <Maximize2 size={14} />
            </IconButton>
          ) : null}

          <IconButton
            size="sm"
            variant="ghost"
            className="omnimux-inspiration-sidebar-action-btn"
            onClick={onClose}
            title={t('close')}
            aria-label={t('close')}
          >
            <X size={15} />
          </IconButton>
        </div>
      </div>

      <InspirationPostDetail
        key={String(item?.source_url || item?.id)}
        mode="sidebar"
        item={item}
        t={t}
        onClose={onClose}
        onItemUpdated={applyItem}
        onReplicate={onReplicate}
        replicateBusy={replicateBusy}
        notice={(
          <>
            {importing ? <p className="omnimux-inspiration-player-status">{importStageLabel(item, t)}</p> : null}
            {failed ? <p className="omnimux-inspiration-error-text" role="alert">{importErrorText(item, t) || t('add.status.failed')}</p> : null}
            {!failed && settledNotice ? <p className="omnimux-inspiration-player-status" role="status">{settledNotice}</p> : null}
          </>
        )}
      />
    </aside>
  )
}
