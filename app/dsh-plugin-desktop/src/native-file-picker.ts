import { isAbsolute } from 'node:path'
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue, WebContents } from 'electron'
import type { NativeFilePickerRequest, NativeFilePickerResult } from './native-file-picker-contract.ts'

const REQUEST_KEYS = new Set(['kind', 'multiple', 'extensions', 'prompt'])

function parseOpenDialogOptions(raw: unknown): OpenDialogOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !REQUEST_KEYS.has(key))) return
  const { kind, multiple, extensions, prompt } = raw as Partial<Record<keyof NativeFilePickerRequest, unknown>>
  if (kind !== 'file' && kind !== 'directory') return
  if (multiple !== undefined && typeof multiple !== 'boolean') return
  if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 200 || prompt.includes('\0'))) return
  if (extensions !== undefined && (kind !== 'file' || !Array.isArray(extensions) || extensions.length > 64
    || Array.from(extensions).some(extension => typeof extension !== 'string' || !/^[a-z0-9]{1,12}$/.test(extension)))) return

  const properties: NonNullable<OpenDialogOptions['properties']> = [kind === 'directory' ? 'openDirectory' : 'openFile']
  if (multiple !== false) properties.push('multiSelections')
  const options: OpenDialogOptions = { properties }
  if (prompt) {
    if (process.platform === 'darwin') options.message = prompt
    else options.title = prompt
  }
  if (extensions?.length) options.filters = [{ name: extensions.join(', '), extensions }]
  return options
}

/** Each shell authenticates the sender before supplying its product window and renderer. */
export function createNativeFilePicker(
  showOpenDialog: (owner: BrowserWindow, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>,
): (
  owner: BrowserWindow,
  renderer: WebContents,
  request: unknown,
) => Promise<NativeFilePickerResult> {
  const pending = new WeakSet<BrowserWindow>()

  return async (owner, renderer, request) => {
    const options = parseOpenDialogOptions(request)
    if (!options) return { ok: false, error: 'picker-invalid-request' }
    if (pending.has(owner)) return { ok: false, error: 'picker-busy' }
    if (owner.isDestroyed() || renderer.isDestroyed() || !owner.isFocused() || !renderer.isFocused()) {
      return { ok: false, error: 'picker-unavailable' }
    }

    const frame = renderer.mainFrame
    let invalidated = false
    const invalidate = () => { invalidated = true }
    const onNavigation = (details: Electron.WebContentsDidStartNavigationEventParams): void => {
      if (details.isMainFrame && !details.isSameDocument) invalidate()
    }
    pending.add(owner)
    renderer.on('did-start-navigation', onNavigation)
    renderer.once('render-process-gone', invalidate)
    try {
      const { canceled, filePaths } = await showOpenDialog(owner, options)
      if (invalidated || owner.isDestroyed() || renderer.isDestroyed() || renderer.mainFrame !== frame || frame.detached) {
        return { ok: false, error: 'picker-unavailable' }
      }
      if (canceled) return { ok: true, path: null, paths: [] }
      const path = filePaths[0]
      if (!path || filePaths.some(selected => !isAbsolute(selected))) return { ok: false, error: 'picker-failed' }
      return { ok: true, path, paths: filePaths }
    } catch {
      return { ok: false, error: 'picker-failed' }
    } finally {
      pending.delete(owner)
      if (!renderer.isDestroyed()) {
        renderer.off('did-start-navigation', onNavigation)
        renderer.off('render-process-gone', invalidate)
      }
    }
  }
}
