import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { MergeView } from '@codemirror/merge'
import { Button, IconButton } from 'dsh-ui-kit'
import { CloseIcon, GitCompareIcon, RotateCcwIcon } from '../icons.jsx'
import { readAssetTextVersion } from '../api.js'
import { dshCodeMirrorTheme, dshMarkdownHighlighting } from './cmTheme.js'

/**
 * Side-by-side CodeMirror MergeView modal comparing a stored snapshot against
 * the current editor buffer. Loads the snapshot's UTF-8 body on demand.
 */
export function AssetVersionDiffModal(props) {
  const {
    snapshot,
    currentContent,
    assetId,
    fileId,
    subPath = '',
    isMarkdown = true,
    readOnly = false,
    reverting = false,
    onClose,
    onApplyVersion,
    t,
  } = props

  const mergeContainerRef = useRef(null)
  const mergeViewRef = useRef(null)
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])

  const snapshotId = snapshot?.id || ''
  const [snapshotContent, setSnapshotContent] = useState(null)
  const [loading, setLoading] = useState(Boolean(snapshotId))
  const [loadError, setLoadError] = useState('')
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!snapshotId || !assetId || !fileId) return undefined
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    setSnapshotContent(null)

    void readAssetTextVersion(assetId, fileId, subPath, snapshotId, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        if (!res.ok) {
          setLoadError(res.body?.message || res.body?.error || tRef.current('textEditor.diffLoadFailed'))
          setLoading(false)
          return
        }
        setSnapshotContent(res.content)
        setLoading(false)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        console.warn('[omnimux-assets] readAssetTextVersion failed:', error)
        setLoadError(tRef.current('textEditor.diffLoadFailed'))
        setLoading(false)
      })

    return () => controller.abort()
  }, [snapshotId, assetId, fileId, subPath, retryToken])

  useEffect(() => {
    if (!snapshot || snapshotContent === null || !mergeContainerRef.current) return undefined

    if (mergeViewRef.current) {
      mergeViewRef.current.destroy()
      mergeViewRef.current = null
    }

    const commonExtensions = [
      lineNumbers(),
      EditorView.lineWrapping,
      dshCodeMirrorTheme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ]
    if (isMarkdown) {
      commonExtensions.push(markdown(), dshMarkdownHighlighting)
    }

    try {
      mergeViewRef.current = new MergeView({
        a: {
          doc: snapshotContent,
          extensions: commonExtensions,
        },
        b: {
          doc: currentContent,
          extensions: commonExtensions,
        },
        parent: mergeContainerRef.current,
        orientation: 'a-b',
      })
    } catch (error) {
      console.error('[omnimux-assets] MergeView init failed:', error)
      setLoadError(tRef.current('textEditor.diffLoadFailed'))
    }

    return () => {
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy()
        mergeViewRef.current = null
      }
    }
  }, [snapshot, snapshotContent, currentContent, isMarkdown])

  const handleApply = useCallback(async () => {
    if (!snapshot || readOnly || reverting) return
    await onApplyVersion?.(snapshot.id)
  }, [snapshot, readOnly, reverting, onApplyVersion])

  if (!snapshot) return null

  const formattedTime = Number.isFinite(snapshot.timestamp)
    ? new Date(snapshot.timestamp).toLocaleString()
    : ''

  return (
    <div
      className="omnimux-ate-diff-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('textEditor.diffModalTitle')}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className="omnimux-ate-diff-modal" onClick={(event) => event.stopPropagation()}>
        <header className="omnimux-ate-diff-header">
          <div className="omnimux-ate-diff-title-group">
            <span className="omnimux-ate-diff-icon" aria-hidden="true">
              <GitCompareIcon size={17} />
            </span>
            <div>
              <div className="omnimux-ate-diff-heading">{t('textEditor.diffModalTitle')}</div>
              <div className="omnimux-ate-diff-sub">
                <span>{snapshot.name}</span>
                {formattedTime ? <span className="omnimux-ate-diff-time">{formattedTime}</span> : null}
              </div>
            </div>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            className="omnimux-ate-close-btn"
            aria-label={t('textEditor.close')}
            title={t('textEditor.close')}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </IconButton>
        </header>

        <div className="omnimux-ate-diff-columns">
          <div className="omnimux-ate-diff-col-label omnimux-ate-diff-col-label--old">
            {t('textEditor.diffOldLabel')}
          </div>
          <div className="omnimux-ate-diff-col-label">
            {t('textEditor.diffNewLabel')}
          </div>
        </div>

        <div className="omnimux-ate-diff-body">
          {loading ? (
            <div className="omnimux-ate-state-box">
              <span>{t('textEditor.diffLoading')}</span>
            </div>
          ) : loadError ? (
            <div className="omnimux-ate-state-box">
              <p className="omnimux-ate-state-error">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => setRetryToken((n) => n + 1)}>
                {t('textEditor.retry')}
              </Button>
            </div>
          ) : (
            <div ref={mergeContainerRef} className="omnimux-ate-cm-container" />
          )}
        </div>

        <footer className="omnimux-ate-diff-footer">
          <Button variant="outline" size="sm" disabled={reverting} onClick={onClose}>
            {t('textEditor.cancel')}
          </Button>
          {!readOnly ? (
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<RotateCcwIcon size={13} />}
              loading={reverting}
              disabled={loading || Boolean(loadError)}
              onClick={() => void handleApply()}
            >
              {t('textEditor.applyVersion')}
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}
