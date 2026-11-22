import { notifyCanvasClose } from '../CanvasBridge.js'
import { createClipPersistence } from './persistence.js'
import { createEditorSession } from './editor-session.js'
import { createLiveChannel } from './live-channel.js'
import { nativeEditorState } from './native-state.ts'
import { runNativeCommand } from './run-command.ts'

export function createClipRuntime(window, stage) {
  const storage = createClipPersistence(window)
  const logError = error => console.warn('[Clip] Project operation failed.', error?.code ?? error?.name)
  let channel
  const session = createEditorSession({
    storage, native: nativeEditorState, document: window.document,
    workbench: () => window.__omnimuxWorkbench,
    onError: logError,
    onVisibility: () => channel?.changed({ immediate: true }),
    onRelease: owner => channel?.release(owner),
  })
  channel = createLiveChannel({ session, storage, native: nativeEditorState, execute: runNativeCommand, window })
  const stopStage = stage.subscribe(session.reconcile)
  const stopSession = session.subscribe(() => channel.changed())
  const refresh = () => {
    session.reconcile()
    channel.changed({ immediate: true })
  }
  window.document.addEventListener('visibilitychange', refresh)
  const online = () => channel.changed({ immediate: true })
  window.addEventListener('online', online)
  const stopWorkbench = window.__omnimuxWorkbench?.subscribe?.(session.reconcile)
  void channel.renew()
  return {
    session,
    compose: editorInstanceId => channel.compose(editorInstanceId),
    async closeCanvas(binding) {
      return session.closeCanvas(binding, () => {
        const active = stage.getSessionSnapshot()
        if (active?.source !== 'canvas' || active.projectId !== binding.projectId
          || active.workspaceId !== binding.workspaceId || active.nodeId !== binding.nodeId) return false
        return notifyCanvasClose(binding) && stage.getSessionSnapshot() !== active
      })
    },
    dispose() {
      window.document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', online)
      stopStage()
      stopSession()
      stopWorkbench?.()
      session.dispose()
      void session.getWaiting().finally(() => channel.dispose())
    },
  }
}
