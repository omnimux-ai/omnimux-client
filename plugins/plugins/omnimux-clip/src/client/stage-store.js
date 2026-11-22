/**
 * Overlay / canvas-portal store. Sidebar clicks MUST NOT call `open()`.
 * They go through `window.__omnimuxWorkbench` (see workbench-store.js).
 * `set(true)` still claims `omnimux-clip` for leftover overlay / tests.
 *
 * @param {() => { claim: (id: string) => void, release: (id: string) => void, PRODUCT_STAGE_EVENT: string, readBox: () => { top: number, left: number, width: number, height: number } }} getStage
 */
import {
  OMNIMUX_CLIP_CLOSE,
  OMNIMUX_CLIP_PROGRESS,
  OMNIMUX_CLIP_SAVE,
  isCanvasClipBinding,
  isProgressClipEditorPayload,
  isSaveClipEditorPayload,
} from './clip-events.js'

const PRODUCT_STAGE_EVENT = 'dsh-product-stage'
const STAGE_ID = 'omnimux-clip'
const EMPTY_BOX = Object.freeze({ top: 0, left: 0, width: 0, height: 0 })

let globalActiveStageStore = null

export function getActiveClipStageStore() {
  return globalActiveStageStore
}

export function getActiveClipSession() {
  return globalActiveStageStore?.getSessionSnapshot() ?? null
}

export function createStageStore(getStage) {
  // Overlay is canvas-portal only. Do not restore a leftover product-stage
  // claim from localStorage — that chrome hides `[data-dsh-panel-host]`.
  let open = false

  /** @type {null | { source: 'canvas' | 'sidebar' | 'agent', workspaceId?: string, nodeId?: string, nodeTitle?: string, projectId?: string, draftSchema?: unknown, upstreamInputs?: unknown, mediaReturn?: unknown }} */
  let activeSession = null

  const listeners = new Set()
  // Legacy asynchronous progress callbacks carry only nodeId. Once a node id
  // has referred to two bindings, those callbacks cannot identify their origin.
  const seenBindings = new Map()
  // Zero-progress callbacks can repeat. Keep the render binding until the
  // upload starts, then track each request in its own lifetime.
  const pendingExports = new Map()
  const pendingUploads = new Set()

  function retireUpload(upload) {
    pendingUploads.delete(upload)
    const { nodeId } = upload.binding
    if (pendingExports.get(nodeId) === upload.binding) pendingExports.delete(nodeId)
  }

  function settleUpload(upload) {
    const { workspaceId, nodeId, projectId } = upload.binding
    // Set iteration is in request order. Once this result is applied, earlier
    // requests for the same binding can no longer change the canvas.
    for (const earlier of pendingUploads) {
      const binding = earlier.binding
      if (binding.workspaceId === workspaceId && binding.nodeId === nodeId && binding.projectId === projectId) {
        retireUpload(earlier)
      }
      if (earlier === upload) break
    }
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  const handleStageEvent = (event) => {
    const id = event instanceof CustomEvent ? event.detail?.id : undefined
    // 画布联动模式下与 omnimux-workflow 共存，不被工作流 Stage 声明关闭
    if (activeSession?.source === 'canvas') {
      if (id && id !== STAGE_ID && id !== 'omnimux-workflow') {
        open = false
        activeSession = null
        emit()
      }
      return
    }
    if (id !== STAGE_ID && open) {
      open = false
      activeSession = null
      emit()
    } else if (id === STAGE_ID && !open) {
      open = true
      emit()
    }
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(PRODUCT_STAGE_EVENT, handleStageEvent)
  }

  function readBox() {
    let stage
    try {
      stage = typeof getStage === 'function' ? getStage() : undefined
    } catch {
      return EMPTY_BOX
    }
    if (!stage || typeof stage.readBox !== 'function') return EMPTY_BOX
    let box
    try {
      box = stage.readBox()
    } catch {
      return EMPTY_BOX
    }
    if (!box || typeof box !== 'object') return EMPTY_BOX
    // 仅提取最小标量叶子字段，避免活数据泄漏
    const top = typeof box.top === 'number' ? box.top : 0
    const left = typeof box.left === 'number' ? box.left : 0
    const width = typeof box.width === 'number' ? box.width : 0
    const height = typeof box.height === 'number' ? box.height : 0
    return { top, left, width, height }
  }

  const store = {
    getSnapshot: () => open,
    getSessionSnapshot: () => activeSession,
    beginCanvasExportUpload(projectId) {
      // The legacy upload names only a project. A reused project ID must not
      // let the request borrow a different node or workspace's binding.
      const matches = [...pendingExports.values()].filter((binding) => binding.projectId === projectId)
      if (matches.length !== 1) return null
      const upload = { binding: matches[0], receipt: null }
      pendingUploads.add(upload)
      return (receipt) => {
        if (!pendingUploads.has(upload)) return
        if (receipt?.saved === true && receipt.id === projectId && typeof receipt.path === 'string'
          && receipt.path && typeof receipt.revision === 'string' && receipt.revision) {
          upload.receipt = receipt
        } else {
          retireUpload(upload)
        }
      }
    },
    resolveCanvasReply(type, payload) {
      const isProgress = type === OMNIMUX_CLIP_PROGRESS
      const isSave = type === OMNIMUX_CLIP_SAVE
      const output = isSave ? payload?.output : undefined
      const terminal = output != null || isProgress && ['completed', 'error', 'idle'].includes(payload?.status)
      // Timeline saves carry the host revision. The legacy motion callback
      // carries only the path, so it can use a single matching receipt.
      const uploads = output == null ? [] : [...pendingUploads].filter(({ binding, receipt }) =>
        receipt && binding.projectId === payload.projectId && receipt.path === output.videoPath
        && (output.revision === undefined || receipt.revision === output.revision))
      if (uploads.length > 1 || (output?.revision !== undefined && uploads.length !== 1)) return null
      const [upload] = uploads
      const pending = upload?.binding ?? (terminal ? pendingExports.get(payload.nodeId) : undefined)
      const session = open && activeSession?.source === 'canvas' ? activeSession : null
      const binding = pending ?? session
      if (!isCanvasClipBinding(binding) || payload?.nodeId !== binding.nodeId) return null
      if (payload.workspaceId !== undefined && payload.workspaceId !== binding.workspaceId) return null
      if ((pending || payload.projectId !== undefined) && payload.projectId !== binding.projectId) return null
      if (type !== OMNIMUX_CLIP_CLOSE && !isCanvasClipBinding(payload) && seenBindings.get(binding.nodeId) === null) return null

      const { workspaceId, nodeId, projectId } = binding
      const detail = { ...payload, workspaceId, nodeId, projectId }
      if (isSave && !isSaveClipEditorPayload(detail)) return null
      if (isProgress && !isProgressClipEditorPayload(detail)) return null
      if (isProgress && detail.status === 'rendering' && detail.renderProgress === 0) {
        const previous = pendingExports.get(nodeId)
        if (previous && (previous.workspaceId !== workspaceId || previous.projectId !== projectId)) return null
        pendingExports.set(nodeId, { workspaceId, nodeId, projectId })
      }
      if (upload) {
        detail.output = { ...output, revision: upload.receipt.revision }
        settleUpload(upload)
      } else if (pending) {
        pendingExports.delete(nodeId)
      }
      return detail
    },
    readBox,
    /**
     * @param {() => void} listener
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /**
     * @param {boolean} next
     */
    set(next) {
      if (activeSession?.source === 'canvas') {
        if (next === false) {
          open = false
          activeSession = null
          emit()
        } else {
          if (!open) {
            open = true
            emit()
          }
        }
        return
      }

      if (open === next) return
      open = next
      const stage = getStage()
      if (open) {
        if (stage && typeof stage.claim === 'function') stage.claim(STAGE_ID)
      } else {
        if (stage && typeof stage.release === 'function') stage.release(STAGE_ID)
        activeSession = null
      }
      emit()
    },
    /**
     * Open clip editor in canvas mode with node session.
     * @param {{ workspaceId: string, nodeId: string, nodeTitle?: string, projectId: string, draftSchema?: unknown, upstreamInputs?: unknown, mediaReturn?: unknown }} payload
     */
    openFromCanvas(payload) {
      if (!isCanvasClipBinding(payload)) return
      const { workspaceId, nodeId, projectId, nodeTitle, draftSchema, upstreamInputs, mediaReturn } = payload
      const bindingKey = `${workspaceId}/${projectId}`
      const previous = seenBindings.get(nodeId)
      seenBindings.set(nodeId, previous === undefined || previous === bindingKey ? bindingKey : null)
      activeSession = {
        source: 'canvas',
        workspaceId,
        nodeId,
        projectId,
        nodeTitle,
        draftSchema,
        upstreamInputs,
        ...(mediaReturn ? { mediaReturn } : {}),
      }
      open = true
      emit()
    },
    /**
     * Set or clear active session context without changing visibility.
     * @param {any} session
     */
    setSession(session) {
      activeSession = session
      emit()
    },
    /**
     * Overlay leftover / canvas-portal. Sidebar MUST NOT call this.
     */
    open() {
      this.set(true)
    },
    /**
     * Standard StageStore close method.
     */
    close() {
      this.set(false)
    },
    toggle() {
      this.set(!open)
    },
    /**
     * Unbind the product-stage listener and drop all subscribers.
     * Must be wired into the Cordis lifecycle via ctx.effect so the
     * plugin never leaks window listeners after unload.
     */
    dispose() {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener(PRODUCT_STAGE_EVENT, handleStageEvent)
      }
      listeners.clear()
      seenBindings.clear()
      pendingExports.clear()
      pendingUploads.clear()
      activeSession = null
      open = false
      if (globalActiveStageStore === store) {
        globalActiveStageStore = null
      }
      try {
        if (typeof window !== 'undefined' && window.__omnimuxClipStageStore === store) {
          delete window.__omnimuxClipStageStore
        }
      } catch {}
    },
  }

  globalActiveStageStore = store
  try {
    if (typeof window !== 'undefined') {
      window.__omnimuxClipStageStore = store
    }
  } catch {}

  return store
}