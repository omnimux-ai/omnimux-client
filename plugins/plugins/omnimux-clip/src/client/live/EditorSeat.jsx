import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from 'dsh-ui-kit'
import { useVisibleEditorPane } from '../hooks/useVisibleEditorPane.ts'
import { CANVAS_TAB, STUDIO_TAB } from './editor-session.js'
import './editor-seat.css'

const HIDDEN = Object.freeze({ phase: 'hidden' })
const noopSubscribe = () => () => {}
const hiddenSnapshot = () => HIDDEN
const EditorActionsContext = createContext({})

export function useEditorSeat(runtime, options) {
  const [id] = useState(() => crypto.randomUUID())
  const latest = useRef(options)
  useLayoutEffect(() => {
    latest.current = options
    runtime?.session.reconcile()
  })
  useLayoutEffect(() => runtime?.session.add({
    id,
    tabId: options.mode === 'canvas' ? CANVAS_TAB : STUDIO_TAB,
    mode: options.mode,
    isVisible: () => latest.current.isVisible(),
    isEditorMounted: () => latest.current.root?.current?.querySelector('.editor-shell .editor-workspace')?.getClientRects().length > 0,
    get tabInstanceId() { return latest.current.tabInstanceId },
    get sessionId() { return latest.current.sessionId },
    getCanvas: () => latest.current.canvas?.(),
    getCanvasAnchor: () => latest.current.canvasAnchor?.(),
    getStudioRequest: () => latest.current.studioRequest,
  }), [id, options.mode, runtime])
  const view = useSyncExternalStore(runtime?.session.subscribe ?? noopSubscribe, runtime?.session.getSnapshot ?? hiddenSnapshot)
  return view.id === id ? view : HIDDEN
}

export function useEditorInert(value) {
  return useCallback(node => {
    if (node) node.inert = Boolean(value)
  }, [value])
}

export function ClipEditorActions({ onExit, runtime, view, canvasImport, children }) {
  const compose = runtime?.compose ? () => runtime.compose(view.id) : undefined
  const canCompose = view.phase === 'editing' && !view.conflict && !view.ingesting && !view.resolving
  const media = runtime?.mediaHandoff
  const canBridgeMedia = Boolean(media && canCompose)
  const captureMediaEditor = useCallback(() => media?.captureEditor(view.id), [media, view.id])
  const openCanvasForMedia = useCallback(() => media?.openCanvas(view.id), [media, view.id])
  const returnedMedia = useSyncExternalStore(media?.subscribe ?? noopSubscribe,
    () => media?.getIncoming(view.id, view.mediaReturnId))
  const acknowledgeReturnedMedia = useCallback(id => media?.acknowledge(view.id, id), [media, view.id])
  return <EditorActionsContext.Provider value={{ onExit, compose, canCompose, canBridgeMedia,
    captureMediaEditor, openCanvasForMedia, returnedMedia, acknowledgeReturnedMedia, canvasImport }}>{children}</EditorActionsContext.Provider>
}

export function useClipEditorActions() {
  return useContext(EditorActionsContext)
}

export function EditorOpening({ view, runtime, t, onExit }) {
  const error = view.phase === 'error'
  return (
    <div className="omnimux-clip-opening" role={error ? 'alert' : 'status'}>
      <span>{t(error ? 'tab.openFailed' : 'tab.opening')}</span>
      {(error || view.ingesting) && <div className="omnimux-clip-opening-actions">
        {error && <Button type="button" variant="secondary" onClick={() => runtime.session.retry()}>{t('tab.retry')}</Button>}
        {onExit && (view.ingesting || view.canExit) && <Button type="button" variant="ghost" onClick={onExit}>{t('tab.exitEditor')}</Button>}
      </div>}
    </div>
  )
}

export function EditorSyncNotice({ t, runtime, view, showStatus = true }) {
  const [notice, setNotice] = useState(null)
  const pane = useVisibleEditorPane(notice?.parentElement ?? null)
  const style = pane?.clipped ? {
    insetInlineEnd: pane.rightInset + 12,
    insetBlockStart: pane.top + 48,
    maxInlineSize: Math.max(0, Math.min(420, pane.width - 24)),
    maxBlockSize: Math.max(0, pane.height - 60),
  } : undefined
  const blocked = view.phase === 'blocked'
  if (view.phase !== 'editing' && !blocked) return null
  const interruptedProject = blocked && view.title && <strong>{view.title}</strong>
  if (view.conflict) return (
    <aside ref={setNotice} style={style} className="omnimux-clip-sync-notice" data-clip-sync="conflict" aria-label={t('tab.conflictTitle')}>
      {interruptedProject}
      <strong>{t('tab.conflictTitle')}</strong>
      <div className="omnimux-clip-conflict-options">
        <Button variant="primary" type="button" disabled={view.resolving} onClick={() => void runtime.session.resolveConflict('local')}>{t('tab.keepLocal')}</Button>
        <Button variant="secondary" type="button" disabled={view.resolving} onClick={() => void runtime.session.resolveConflict('host')}>{t('tab.useSaved')}</Button>
        <Button variant="secondary" type="button" disabled={view.resolving} onClick={() => void runtime.session.resolveConflict('copy')}>{t('tab.saveCopy')}</Button>
      </div>
      {view.status === 'saveFailed' && <span role="status">{t('tab.saveFailed')}</span>}
      {view.status === 'offline' && <span role="status">{t('tab.offline')}</span>}
    </aside>
  )
  const status = blocked && view.resolving ? 'saving' : view.status
  if (!blocked && (!showStatus || !['offline', 'saveFailed'].includes(status))) return null
  return (
    <aside ref={setNotice} style={style} className="omnimux-clip-sync-notice" data-clip-sync={status}>
      {interruptedProject}
      <span role="status">{t(['offline', 'saveFailed'].includes(status) ? `tab.${status}` : 'tab.saving')}</span>
      {view.retryable && <Button variant="secondary" type="button" disabled={view.resolving} onClick={() => void runtime.session.retry()}>{t('tab.retry')}</Button>}
    </aside>
  )
}
