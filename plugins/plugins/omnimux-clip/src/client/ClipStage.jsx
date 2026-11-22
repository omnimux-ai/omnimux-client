import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from 'dsh-ui-kit'
import { useHostLocale } from './useHostLocale.js'
import { createPortal } from 'react-dom'
import OpenReelApp from './openreel/web/App.tsx'
import { ClipEditorActions, EditorOpening, EditorSyncNotice, useEditorInert, useEditorSeat } from './live/EditorSeat.jsx'
import { injectClipStyles } from './styles.js'
import { computeHeaderPadLeft, computeStandaloneBox, readHostSidebarInset } from './stage-box.js'
import { useCanvasIngestion } from './hooks/useCanvasIngestion.ts'
import { findCanvasHost } from './findCanvasHost.js'
import './openreel/web/index.css'
import './theme/dsw-map.css'

class ClipErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[omnimux-clip] render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: 'var(--dsw-alias-label-primary, #ffffff)', background: 'var(--dsw-alias-bg-base, #111113)', height: '100%', boxSizing: 'border-box' }} /* exempt-ui02: 错误边界兜底容器 */>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: 'var(--dsw-alias-label-danger)' }} /* exempt-ui02: 错误标题 */>剪辑器加载遇到异常</h3>
          <pre style={{ fontSize: 12, padding: 12, borderRadius: 6, background: 'var(--dsw-alias-bg-mask-1)', overflow: 'auto', whiteSpace: 'pre-wrap' }} /* exempt-ui02: 错误调用栈代码块 */>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
          <button /* exempt-ui01: 错误边界重试按钮 */
            type="button"
            style={{ marginTop: 12, padding: '8px 16px', background: 'var(--dsw-alias-button-primary-fill, #ffffff)', color: 'var(--dsw-alias-label-primary-foreground, #111113)', border: 'none', borderRadius: 8, cursor: 'pointer' }} /* exempt-ui02 */
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重试加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * OmniMux Clip first-level stage page on the shell.overlay seat.
 * After first open, keep the subtree with display:none — never `if (!open) return null`.
 * Supports both standalone mode (from sidebar) and canvas mode (from workflow node).
 *
 * In canvas mode (`session.source === 'canvas'`), the editor is portaled into the
 * visible `[data-omnimux-canvas-tab]` host and laid out with `position:absolute; inset:0`.
 * It must not guess overlay coordinates or occupy the conversation column.
 *
 * @param {{
 *   t: (key: string) => string,
 *   stage: {
 *     getSnapshot: () => boolean,
 *     getSessionSnapshot: () => any,
 *     subscribe: Function,
 *     set: Function,
 *     readBox: Function
 *   },
 * }} props
 */
export function ClipStage({ t, stage, locale, runtime }) {
  useHostLocale(locale)
  useEffect(() => {
    injectClipStyles()
  }, [])

  const open = useSyncExternalStore(
    stage ? (cb) => stage.subscribe(cb) : () => () => {},
    stage ? () => stage.getSnapshot() : () => false,
  )
  const activeSession = useSyncExternalStore(
    stage ? (cb) => stage.subscribe(cb) : () => () => {},
    stage ? () => stage.getSessionSnapshot() : () => null,
  )

  // Closing clears the active store session, but must not move the mounted
  // editor out of its portal or replay upstream ingestion on the next render.
  const lastSession = useRef(null)
  if (activeSession) lastSession.current = activeSession
  const session = activeSession ?? lastSession.current
  const isCanvasMode = session?.source === 'canvas'

  const [everOpened, setEverOpened] = useState(false)
  const [canvasHost, setCanvasHost] = useState(null)
  const [canvasHostVisible, setCanvasHostVisible] = useState(false)
  const [box, setBox] = useState(() => {
    if (typeof window !== 'undefined') {
      return {
        top: 0,
        left: 56,
        width: Math.max(320, window.innerWidth - 56),
        height: Math.max(240, window.innerHeight),
      }
    }
    return { top: 0, left: 0, width: 0, height: 0 }
  })

  useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  const stageRef = useRef(null)
  const visible = open && (!isCanvasMode || canvasHostVisible)
  const view = useEditorSeat(runtime, {
    mode: 'canvas', root: stageRef,
    isVisible: () => Boolean(visible && stageRef.current?.isConnected && stageRef.current.dataset.visible === 'true'
      && findCanvasHost(document, activeSession?.workspaceId) === stageRef.current.parentElement),
    canvas: () => stage?.getSessionSnapshot(),
    canvasAnchor: () => {
      const root = stageRef.current
      const active = stage?.getSessionSnapshot()
      if (!stage?.getSnapshot() || active?.source !== 'canvas' || !root?.isConnected) return null
      const data = root.dataset
      const host = root.parentElement
      return data.clipWorkspaceId === active.workspaceId && data.clipNodeId === active.nodeId
        && data.clipProjectId === active.projectId && host?.hasAttribute('data-omnimux-canvas-tab')
        && host.dataset.canvasWorkspaceId === active.workspaceId ? root : null
    },
  })
  const editorRootRef = useEditorInert(view.resolving || view.ingesting)
  const ownsCanvas = useCallback(() => {
    const owner = runtime?.session.getOwner()
    return Boolean(view.token && owner?.token === view.token && runtime.session.owns(owner))
  }, [runtime, view.token])
  const saveImported = useCallback(() => {
    if (ownsCanvas()) void runtime.session.finishIngestion()
  }, [runtime, ownsCanvas])
  useCanvasIngestion(activeSession, view.conflict ? undefined : view.token, ownsCanvas, saveImported)

  const closeCanvas = useCallback(() => {
    const target = stage?.getSessionSnapshot()
    if (!target || target.source !== 'canvas') return
    return runtime?.closeCanvas({ workspaceId: target.workspaceId, nodeId: target.nodeId, projectId: target.projectId })
  }, [stage, runtime])

  useLayoutEffect(() => {
    if (!open) return undefined

    const findBoundCanvasHost = () => findCanvasHost(document, session?.workspaceId)
    const update = () => {
      if (session?.source === 'canvas') {
        const host = findBoundCanvasHost()
        setCanvasHostVisible(Boolean(host))
        setCanvasHost((previous) => {
          // Switching Tabs can hide the owning canvas while it stays mounted.
          if (host) return host
          return previous?.isConnected && previous.dataset.canvasWorkspaceId === session.workspaceId ? previous : null
        })
        return
      }
      setCanvasHost(null)

      const read = stage?.readBox?.()
      const usableRead = read && read.width >= 50 && read.height >= 50 ? read : null
      setBox(computeStandaloneBox(
        usableRead,
        { width: window.innerWidth, height: window.innerHeight },
        readHostSidebarInset(document),
      ))
    }

    update()

    let retryTimer = 0
    if (session?.source === 'canvas' && !findBoundCanvasHost()) {
      let attempts = 0
      const retry = () => {
        attempts += 1
        update()
        if (!findBoundCanvasHost() && attempts < 40) {
          retryTimer = window.setTimeout(retry, 50)
        }
      }
      retryTimer = window.setTimeout(retry, 50)
    }

    const targets = [
      ...document.querySelectorAll('[data-omnimux-canvas-tab], .omnimux-workflow-canvas-tab'),
      document.querySelector('[data-conversation-scroll]'),
      document.querySelector('[data-slot="conversation"]')?.parentElement,
      document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]'),
    ].filter((el) => el instanceof HTMLElement)

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    for (const target of targets) {
      observer?.observe(target)
    }

    const canvasObserver = isCanvasMode && typeof MutationObserver === 'function' ? new MutationObserver(update) : null
    for (const target of targets) {
      if (target.hasAttribute('data-omnimux-canvas-tab')) {
        canvasObserver?.observe(target, { attributes: true, attributeFilter: ['data-visible', 'data-canvas-workspace-id'] })
      }
    }

    window.addEventListener('resize', update)
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer)
      observer?.disconnect()
      canvasObserver?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [isCanvasMode, open, stage, session])

  if (!stage) return null
  if (!open && !everOpened) return null

  const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent)
  const headerPadLeft = computeHeaderPadLeft({ isCanvasMode, boxLeft: box.left, isMac })
  const portalTarget = isCanvasMode ? canvasHost : null

  const stageNode = (
    <div
      role="region"
      aria-label={t ? t('tab.title') : '视频剪辑'}
      aria-hidden={visible ? undefined : 'true'}
      ref={stageRef}
      className="omnimux-clip-stage"
      data-visible={visible ? 'true' : 'false'}
      data-clip-mode={isCanvasMode ? 'canvas' : 'standalone'}
      data-clip-workspace-id={activeSession?.workspaceId}
      data-clip-node-id={activeSession?.nodeId}
      data-clip-project-id={activeSession?.projectId}
      style={isCanvasMode ? {
        display: open ? undefined : 'none',
        '--clip-header-pad-left': `${headerPadLeft}px`,
      } : {
        display: open ? undefined : 'none',
        '--stage-top': `${box.top}px`,
        '--stage-left': `${box.left}px`,
        '--stage-width': `${box.width}px`,
        '--stage-height': `${box.height}px`,
        '--clip-header-pad-left': `${headerPadLeft}px`,
      }}
    >
      <div className="omnimux-clip-stage-body openreel-studio-root">
        {runtime && visible && view.phase !== 'blocked' && (view.phase !== 'editing' || view.ingesting) && (
          <EditorOpening view={view} runtime={runtime} t={t} onExit={closeCanvas} />
        )}
        <div ref={editorRootRef} style={{ height: '100%', display: runtime && view.phase !== 'editing' ? 'none' : undefined,
          ...(view.ingesting ? { position: 'absolute', inset: 0, visibility: 'hidden' } : {}),
        }}>
          <ClipEditorActions onExit={runtime ? closeCanvas : null} runtime={runtime} view={view}>
            <ClipErrorBoundary>
              <OpenReelApp active={visible && (!runtime || view.phase === 'editing')} canvasMode={isCanvasMode} managed={Boolean(runtime)} />
            </ClipErrorBoundary>
          </ClipEditorActions>
        </div>
        {runtime && <EditorSyncNotice t={t} runtime={runtime} view={view} />}
      </div>
    </div>
  )

  if (isCanvasMode) {
    if (!portalTarget) return null
    return createPortal(stageNode, portalTarget)
  }
  return stageNode
}

export default ClipStage
