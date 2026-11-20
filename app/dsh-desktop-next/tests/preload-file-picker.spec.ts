import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DESKTOP_FILE_PICKER_CHANNEL, type NativeFilePickerBridge } from '../../dsh-plugin-desktop/src/native-file-picker-contract.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn<(name: string, api: unknown) => void>() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() },
}))

vi.mock('electron', () => electron)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.stubGlobal('window', { addEventListener: vi.fn() })
  vi.stubGlobal('document', { readyState: 'loading', documentElement: { dataset: {} } })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('exposes the file picker only on the product origin', async () => {
  vi.stubGlobal('location', new URL('dsh-app://shell/'))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled()
})

it('opens the shared picker channel only during user activation', async () => {
  const userActivation = { isActive: false }
  vi.stubGlobal('location', new URL('dsh-app://app/'))
  vi.stubGlobal('navigator', { userActivation })
  await import('../src/preload-app.ts')

  const [, api] = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')!
  const { filePicker } = api as { filePicker: NativeFilePickerBridge }
  expect(filePicker.version).toBe(1)
  const request = { kind: 'directory' as const, multiple: false }
  await expect(filePicker.open(request)).resolves.toEqual({ ok: false, error: 'picker-gesture-required' })
  expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled()

  userActivation.isActive = true
  const canceled = { ok: true, path: null, paths: [] }
  electron.ipcRenderer.invoke.mockResolvedValueOnce(canceled)
  await expect(filePicker.open(request)).resolves.toEqual(canceled)
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_FILE_PICKER_CHANNEL, request)
})
