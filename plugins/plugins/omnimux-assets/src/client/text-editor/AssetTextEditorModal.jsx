import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, IconButton, ModalDialog } from 'dsh-ui-kit'
import { calculateTextStats } from '../../text-files.js'
import { addMediaToConversation } from '../add-to-chat.js'
import {
  createAssetTextVersion,
  deleteAssetTextVersion,
  listAssetTextVersions,
  readAssetText,
  revealAssetEntry,
  revertAssetTextVersion,
  saveAssetText,
} from '../api.js'
import {
  AlertIcon,
  ChatIcon,
  CheckIcon,
  CloseIcon,
  DocIcon,
  HistoryIcon,
  RedoIcon,
  RevealLocationIcon,
  SaveIcon,
  SearchIcon,
  UndoIcon,
} from '../icons.jsx'
import { AssetCodeMirrorEditor } from './AssetCodeMirrorEditor.jsx'
import { AssetVersionDrawer } from './AssetVersionDrawer.jsx'
import { AssetVersionDiffModal } from './AssetVersionDiffModal.jsx'
import { injectAssetTextEditorStyles } from './styles.js'

const NARROW_VIEWPORT_PX = 900

function isNarrowViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= NARROW_VIEWPORT_PX
}

function mapLoadError(body, t) {
  const code = body?.error
  if (code === 'file-too-large') return t('textEditor.fileTooLarge')
  if (code === 'file-not-text') return t('textEditor.fileNotText')
  return body?.message || body?.error || t('textEditor.loadFailed')
}

/**
 * Canvas-equivalent text document editor modal for the Asset Library.
 * Supports Live Markdown WYSIWYG (for .md/.markdown/.mdx) and plain text editing,
 * CodeMirror native undo/redo, inline search, persistent version history & side-by-side
 * diff, ETag optimistic concurrency recovery, and 3-way unsaved close confirmation.
 */
export function AssetTextEditorModal({ item, t, onClose, onSaved }) {
  useEffect(() => {
    injectAssetTextEditorStyles()
  }, [])

  const assetId = String(item?.assetId || item?.sourceAssetId || '')
  const fileId = String(item?.fileId || '')
  const subPath = String(item?.subPath || '')

  const editorRef = useRef(null)
  const requestGenRef = useRef(0)
  const addedTimerRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [editorSessionKey, setEditorSessionKey] = useState(0)

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [etag, setEtag] = useState('')
  const [editable, setEditable] = useState(true)
  const [isMarkdown, setIsMarkdown] = useState(Boolean(item?.markdown))
  const [fileName, setFileName] = useState(String(item?.title || ''))
  const [displayPath, setDisplayPath] = useState(String(item?.pathInfo || ''))
  const [fileExt, setFileExt] = useState(String(item?.extension || ''))

  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState(null)

  const [versions, setVersions] = useState([])
  const [versionBusy, setVersionBusy] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [diffSnapshot, setDiffSnapshot] = useState(null)
  const [drawerConfirmOpen, setDrawerConfirmOpen] = useState(false)
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false)
  const [addedToChat, setAddedToChat] = useState(false)

  useEffect(() => {
    return () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current)
    }
  }, [])

  // Load document content and snapshot metadata with generation guard + AbortController.
  useEffect(() => {
    if (!item || !assetId || !fileId) return undefined
    const controller = new AbortController()
    const gen = ++requestGenRef.current

    setLoading(true)
    setLoadError('')
    setSaveError('')
    setConflict(null)
    setUnsavedPromptOpen(false)
    setDiffSnapshot(null)
    setHistoryFlags({ canUndo: false, canRedo: false })

    void Promise.all([
      readAssetText(assetId, fileId, subPath, { signal: controller.signal }),
      listAssetTextVersions(assetId, fileId, subPath, { signal: controller.signal }).catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('[omnimux-assets] listAssetTextVersions failed:', error)
        }
        return { ok: false, body: {} }
      }),
    ])
      .then(([textRes, versionsRes]) => {
        if (controller.signal.aborted || requestGenRef.current !== gen) return
        if (!textRes.ok) {
          setLoadError(mapLoadError(textRes.body, t))
          setLoading(false)
          return
        }
        setContent(textRes.content)
        setSavedContent(textRes.content)
        setEtag(textRes.etag || '')
        setEditable(textRes.editable !== false)
        setIsMarkdown(textRes.isMarkdown === true)
        setFileName(textRes.name || String(item.title || ''))
        setDisplayPath(textRes.relativePath || String(item.pathInfo || ''))
        setFileExt((textRes.ext || String(item.extension || '')).replace(/^\./, '').toUpperCase())
        if (versionsRes?.ok && Array.isArray(versionsRes.body?.versions)) {
          setVersions(versionsRes.body.versions)
        } else {
          setVersions([])
        }
        setEditorSessionKey((n) => n + 1)
        setLoading(false)
      })
      .catch((error) => {
        if (controller.signal.aborted || requestGenRef.current !== gen) return
        console.warn('[omnimux-assets] readAssetText failed:', error)
        setLoadError(t('textEditor.loadFailed'))
        setLoading(false)
      })

    return () => controller.abort()
  }, [assetId, fileId, subPath, reloadNonce, item, t])

  const isDirty = !loading && !loadError && editable && content !== savedContent
  const stats = useMemo(() => calculateTextStats(content), [content])

  const refreshVersions = useCallback(async () => {
    if (!assetId || !fileId) return
    try {
      const res = await listAssetTextVersions(assetId, fileId, subPath)
      if (res.ok && Array.isArray(res.body?.versions)) {
        setVersions(res.body.versions)
      }
    } catch (error) {
      console.warn('[omnimux-assets] refreshVersions failed:', error)
    }
  }, [assetId, fileId, subPath])

  const handleSave = useCallback(async ({ force = false, closeAfter = false } = {}) => {
    if (!editable || saving || loading || loadError) return false
    setSaving(true)
    setSaveError('')
    try {
      const res = await saveAssetText(assetId, fileId, subPath, {
        content,
        expectedEtag: force ? undefined : (etag || undefined),
        force,
      })
      if (res.ok) {
        setSavedContent(content)
        if (typeof res.body?.etag === 'string') setEtag(res.body.etag)
        setConflict(null)
        setSaveError('')
        onSaved?.()
        if (closeAfter) {
          setUnsavedPromptOpen(false)
          onClose?.()
        }
        return true
      }
      if (res.status === 409 || res.body?.error === 'file-conflict') {
        setConflict({ currentEtag: res.body?.currentEtag || '' })
        setUnsavedPromptOpen(false)
        return false
      }
      setSaveError(res.body?.message || res.body?.error || t('textEditor.saveFailed'))
      setUnsavedPromptOpen(false)
      return false
    } catch (error) {
      console.warn('[omnimux-assets] saveAssetText failed:', error)
      setSaveError(t('textEditor.saveFailed'))
      setUnsavedPromptOpen(false)
      return false
    } finally {
      setSaving(false)
    }
  }, [editable, saving, loading, loadError, assetId, fileId, subPath, content, etag, onSaved, onClose, t])

  const handleReloadLatest = useCallback(() => {
    setConflict(null)
    setSaveError('')
    setReloadNonce((n) => n + 1)
  }, [])

  const requestClose = useCallback(() => {
    if (isDirty) {
      setUnsavedPromptOpen(true)
      return
    }
    onClose?.()
  }, [isDirty, onClose])

  const handleToggleDrawer = useCallback(() => {
    setIsDrawerOpen((prev) => {
      const next = !prev
      if (next && isNarrowViewport()) setIsSearchOpen(false)
      return next
    })
  }, [])

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      const next = !prev
      if (next && isNarrowViewport()) setIsDrawerOpen(false)
      return next
    })
  }, [])

  const handleCreateSnapshot = useCallback(async (name) => {
    if (!editable || versionBusy) return false
    setVersionBusy(true)
    setSaveError('')
    try {
      const res = await createAssetTextVersion(assetId, fileId, subPath, {
        name,
        content,
        source: 'manual',
      })
      if (!res.ok) {
        setSaveError(res.body?.message || res.body?.error || t('textEditor.saveFailed'))
        return false
      }
      await refreshVersions()
      return true
    } catch (error) {
      console.warn('[omnimux-assets] createAssetTextVersion failed:', error)
      setSaveError(t('textEditor.saveFailed'))
      return false
    } finally {
      setVersionBusy(false)
    }
  }, [editable, versionBusy, assetId, fileId, subPath, content, refreshVersions, t])

  const handleRevertSnapshot = useCallback(async (versionId) => {
    if (!editable || versionBusy || !versionId) return false
    setVersionBusy(true)
    setSaveError('')
    try {
      const res = await revertAssetTextVersion(assetId, fileId, subPath, {
        versionId,
        expectedEtag: etag || undefined,
        force: false,
      })
      if (!res.ok) {
        if (res.status === 409 || res.body?.error === 'file-conflict') {
          setConflict({ currentEtag: res.body?.currentEtag || '' })
          setDiffSnapshot(null)
          return false
        }
        setSaveError(res.body?.message || res.body?.error || t('textEditor.saveFailed'))
        return false
      }

      const fresh = await readAssetText(assetId, fileId, subPath)
      if (fresh.ok) {
        editorRef.current?.replaceDoc(fresh.content)
        setContent(fresh.content)
        setSavedContent(fresh.content)
        setEtag(fresh.etag || res.body?.etag || '')
      } else if (typeof res.body?.etag === 'string') {
        setEtag(res.body.etag)
      }
      setConflict(null)
      setDiffSnapshot(null)
      await refreshVersions()
      onSaved?.()
      return true
    } catch (error) {
      console.warn('[omnimux-assets] revertAssetTextVersion failed:', error)
      setSaveError(t('textEditor.saveFailed'))
      return false
    } finally {
      setVersionBusy(false)
    }
  }, [editable, versionBusy, assetId, fileId, subPath, etag, refreshVersions, onSaved, t])

  const handleDeleteSnapshot = useCallback(async (versionId) => {
    if (!editable || versionBusy || !versionId) return false
    setVersionBusy(true)
    setSaveError('')
    try {
      const res = await deleteAssetTextVersion(assetId, fileId, subPath, versionId)
      if (!res.ok) {
        setSaveError(res.body?.message || res.body?.error || t('error.generic'))
        return false
      }
      setVersions((prev) => prev.filter((v) => v.id !== versionId))
      setDiffSnapshot((prev) => (prev?.id === versionId ? null : prev))
      return true
    } catch (error) {
      console.warn('[omnimux-assets] deleteAssetTextVersion failed:', error)
      setSaveError(t('error.generic'))
      return false
    } finally {
      setVersionBusy(false)
    }
  }, [editable, versionBusy, assetId, fileId, subPath, t])

  const handleReveal = useCallback(async () => {
    if (!assetId || !fileId) return
    try {
      const res = await revealAssetEntry(assetId, fileId, subPath)
      if (!res.ok) setSaveError(t('browse.revealFailed'))
    } catch (error) {
      console.warn('[omnimux-assets] revealAssetEntry failed:', error)
      setSaveError(t('browse.revealFailed'))
    }
  }, [assetId, fileId, subPath, t])

  const handleAddToConversation = useCallback(() => {
    if (!item || addedToChat) return
    addMediaToConversation(item)
    setAddedToChat(true)
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current)
    addedTimerRef.current = setTimeout(() => {
      setAddedToChat(false)
    }, 1800)
  }, [item, addedToChat])

  // Layered keyboard shortcuts: Cmd/Ctrl+S, Cmd/Ctrl+F, and Escape precedence.
  useEffect(() => {
    if (!item) return undefined

    const onKeyDown = (event) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (mod && key === 's') {
        event.preventDefault()
        if (editable && !loading && !loadError && !diffSnapshot) {
          void handleSave()
        }
        return
      }

      if (mod && key === 'f') {
        event.preventDefault()
        if (!loading && !loadError && !diffSnapshot) {
          if (isSearchOpen) {
            editorRef.current?.focusSearch()
          } else {
            if (isNarrowViewport()) setIsDrawerOpen(false)
            setIsSearchOpen(true)
          }
        }
        return
      }

      if (event.key === 'Escape') {
        if (drawerConfirmOpen || unsavedPromptOpen) return
        event.preventDefault()
        if (diffSnapshot) {
          setDiffSnapshot(null)
          return
        }
        if (isSearchOpen) {
          setIsSearchOpen(false)
          editorRef.current?.focus()
          return
        }
        if (isDrawerOpen) {
          setIsDrawerOpen(false)
          return
        }
        requestClose()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    item,
    editable,
    loading,
    loadError,
    diffSnapshot,
    isSearchOpen,
    isDrawerOpen,
    drawerConfirmOpen,
    unsavedPromptOpen,
    handleSave,
    requestClose,
  ])

  if (!item) return null

  return (
    <>
    <div
      className="omnimux-ate-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={fileName || t('textEditor.dialogLabel')}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div className="omnimux-ate-modal" onClick={(event) => event.stopPropagation()}>
        <header className="omnimux-ate-topbar">
          <div className="omnimux-ate-topbar-left">
            <span className="omnimux-ate-doc-icon" aria-hidden="true">
              <DocIcon size={15} />
            </span>
            <h2 className="omnimux-ate-title" title={fileName}>
              {fileName}
            </h2>
            {fileExt ? (
              <span className="omnimux-ate-ext-badge">{fileExt}</span>
            ) : null}
            {!loading && !loadError && !editable ? (
              <Badge size="sm" variant="warning">{t('textEditor.readOnly')}</Badge>
            ) : null}
            {isDirty ? (
              <span
                className="omnimux-ate-dirty-dot"
                role="status"
                aria-label={t('textEditor.unsavedDot')}
                title={t('textEditor.unsavedDot')}
              />
            ) : null}
          </div>

          <div className="omnimux-ate-topbar-right">
            <IconButton
              variant="ghost"
              size="sm"
              className="omnimux-ate-tool-btn"
              aria-label={t('textEditor.undo')}
              title={t('textEditor.undo')}
              disabled={!editable || loading || Boolean(loadError) || !historyFlags.canUndo}
              onClick={() => editorRef.current?.undo()}
            >
              <UndoIcon size={15} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              className="omnimux-ate-tool-btn"
              aria-label={t('textEditor.redo')}
              title={t('textEditor.redo')}
              disabled={!editable || loading || Boolean(loadError) || !historyFlags.canRedo}
              onClick={() => editorRef.current?.redo()}
            >
              <RedoIcon size={15} />
            </IconButton>

            <div className="omnimux-ate-divider" aria-hidden="true" />

            <span className="omnimux-ate-tool-wrap">
              <IconButton
                variant="ghost"
                size="sm"
                className={`omnimux-ate-tool-btn${isDrawerOpen ? ' is-active' : ''}`}
                aria-label={t('textEditor.versionHistory')}
                title={t('textEditor.versionHistory')}
                aria-pressed={isDrawerOpen ? 'true' : 'false'}
                disabled={loading || Boolean(loadError)}
                onClick={handleToggleDrawer}
              >
                <HistoryIcon size={15} />
              </IconButton>
              {versions.length > 0 ? (
                <span className="omnimux-ate-history-dot" aria-hidden="true" />
              ) : null}
            </span>

            <IconButton
              variant="ghost"
              size="sm"
              className="omnimux-ate-tool-btn"
              aria-label={t('textEditor.save')}
              title={t('textEditor.save')}
              loading={saving}
              disabled={!editable || loading || Boolean(loadError)}
              onClick={() => void handleSave()}
            >
              <SaveIcon size={15} />
            </IconButton>

            <IconButton
              variant="ghost"
              size="sm"
              className={`omnimux-ate-tool-btn${isSearchOpen ? ' is-active' : ''}`}
              aria-label={t('textEditor.search')}
              title={t('textEditor.search')}
              aria-pressed={isSearchOpen ? 'true' : 'false'}
              disabled={loading || Boolean(loadError)}
              onClick={handleToggleSearch}
            >
              <SearchIcon size={15} />
            </IconButton>

            <IconButton
              variant="ghost"
              size="sm"
              className="omnimux-ate-tool-btn omnimux-ate-close-btn"
              aria-label={t('textEditor.close')}
              title={t('textEditor.close')}
              onClick={requestClose}
            >
              <CloseIcon size={15} />
            </IconButton>
          </div>
        </header>

        {conflict ? (
          <div className="omnimux-ate-alert-bar omnimux-ate-alert-bar--conflict" role="alert">
            <div className="omnimux-ate-alert-text">
              <AlertIcon size={14} />
              <span>{t('textEditor.conflictNotice')}</span>
            </div>
            <div className="omnimux-ate-alert-actions">
              <Button variant="outline" size="xs" disabled={saving} onClick={handleReloadLatest}>
                {t('textEditor.reloadDisk')}
              </Button>
              <Button
                variant="danger"
                size="xs"
                loading={saving}
                onClick={() => void handleSave({ force: true })}
              >
                {t('textEditor.forceSave')}
              </Button>
            </div>
          </div>
        ) : saveError ? (
          <div className="omnimux-ate-alert-bar omnimux-ate-alert-bar--error" role="alert">
            <div className="omnimux-ate-alert-text">
              <AlertIcon size={14} />
              <span>{saveError}</span>
            </div>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={t('textEditor.close')}
              onClick={() => setSaveError('')}
            >
              <CloseIcon size={12} />
            </IconButton>
          </div>
        ) : null}

        <main className="omnimux-ate-workspace">
          <section className="omnimux-ate-editor-pane">
            {loading ? (
              <div className="omnimux-ate-state-box">
                <span>{t('textEditor.loading')}</span>
              </div>
            ) : loadError ? (
              <div className="omnimux-ate-state-box">
                <p className="omnimux-ate-state-error">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
                  {t('textEditor.retry')}
                </Button>
              </div>
            ) : (
              <AssetCodeMirrorEditor
                key={`${assetId}:${fileId}:${subPath}:${editorSessionKey}`}
                ref={editorRef}
                value={content}
                onChange={setContent}
                isMarkdown={isMarkdown}
                readOnly={!editable}
                placeholder={t('textEditor.placeholder')}
                isSearchOpen={isSearchOpen}
                onSearchOpenChange={setIsSearchOpen}
                onHistoryChange={setHistoryFlags}
                t={t}
              />
            )}
          </section>

          <AssetVersionDrawer
            open={isDrawerOpen && !loading && !loadError}
            onClose={() => setIsDrawerOpen(false)}
            versions={versions}
            readOnly={!editable}
            busy={versionBusy}
            onCreateSnapshot={handleCreateSnapshot}
            onOpenDiff={setDiffSnapshot}
            onRevertSnapshot={handleRevertSnapshot}
            onDeleteSnapshot={handleDeleteSnapshot}
            onConfirmOpenChange={setDrawerConfirmOpen}
            t={t}
          />
        </main>

        <footer className="omnimux-ate-footer">
          <div className="omnimux-ate-footer-left">
            {displayPath ? (
              <span className="omnimux-ate-path" title={displayPath}>
                {displayPath}
              </span>
            ) : null}
            {!loading && !loadError ? (
              <div className="omnimux-ate-stats" data-testid="ate-stats">
                <span>{stats.wordCount} {t('textEditor.words')}</span>
                <span>{stats.charCount} {t('textEditor.chars')}</span>
                <span>{stats.lineCount} {t('textEditor.lines')}</span>
              </div>
            ) : null}
          </div>

          <div className="omnimux-ate-footer-actions">
            <IconButton
              variant="outline"
              size="sm"
              aria-label={t('browse.revealLocation')}
              title={t('browse.revealLocation')}
              onClick={() => void handleReveal()}
            >
              <RevealLocationIcon size={14} />
            </IconButton>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={addedToChat ? <CheckIcon size={14} /> : <ChatIcon size={14} />}
              disabled={addedToChat}
              onClick={handleAddToConversation}
            >
              {addedToChat ? t('modal.addedToConversation') : t('modal.addToConversation')}
            </Button>
          </div>
        </footer>
      </div>
    </div>

      {diffSnapshot ? (
        <AssetVersionDiffModal
          snapshot={diffSnapshot}
          currentContent={content}
          assetId={assetId}
          fileId={fileId}
          subPath={subPath}
          isMarkdown={isMarkdown}
          readOnly={!editable}
          reverting={versionBusy}
          onClose={() => setDiffSnapshot(null)}
          onApplyVersion={handleRevertSnapshot}
          t={t}
        />
      ) : null}

      {unsavedPromptOpen ? (
        <ModalDialog
          open
          size="sm"
          title={t('textEditor.unsavedTitle')}
          closeLabel={t('textEditor.cancel')}
          onClose={() => setUnsavedPromptOpen(false)}
          footer={(
            <div className="omnimux-ate-unsaved-footer">
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setUnsavedPromptOpen(false)}
              >
                {t('textEditor.cancel')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setUnsavedPromptOpen(false)
                  onClose?.()
                }}
              >
                {t('textEditor.discardAndClose')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                onClick={() => void handleSave({ closeAfter: true })}
              >
                {t('textEditor.saveAndClose')}
              </Button>
            </div>
          )}
        >
          <p>{t('textEditor.unsavedMessage')}</p>
        </ModalDialog>
      ) : null}
    </>
  )
}
