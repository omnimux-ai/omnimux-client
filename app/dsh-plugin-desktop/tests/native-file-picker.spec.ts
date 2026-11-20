import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createNativeFilePicker } from '../src/native-file-picker.ts'

function fixture() {
  const owner = { isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true) }
  const renderer = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    mainFrame: { detached: false },
  })
  const show = vi.fn(async (_owner: BrowserWindow, _options: OpenDialogOptions): Promise<OpenDialogReturnValue> => (
    { canceled: true, filePaths: [] }
  ))
  const open = createNativeFilePicker(show)
  const pick = (request: unknown) => open(owner as unknown as BrowserWindow, renderer as unknown as WebContents, request)
  return { owner, renderer, show, pick }
}

describe('native product file picker', () => {
  it('passes the exact owner, prompt, and filters without reordering the selected paths', async () => {
    const { owner, show, pick } = fixture()
    const filePaths = [resolve('素材 目录/第二张.png'), resolve('第一张.jpg')]
    show.mockResolvedValue({ canceled: false, filePaths })
    await expect(pick({ kind: 'file', prompt: '导入素材', extensions: ['png', 'jpg'] }))
      .resolves.toEqual({ ok: true, path: filePaths[0], paths: filePaths })
    expect(show).toHaveBeenCalledExactlyOnceWith(owner, {
      [process.platform === 'darwin' ? 'message' : 'title']: '导入素材',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'png, jpg', extensions: ['png', 'jpg'] }],
    })
  })

  it('opens a single directory chooser and returns empty paths on cancel', async () => {
    const { owner, show, pick } = fixture()
    await expect(pick({ kind: 'directory', multiple: false })).resolves.toEqual({ ok: true, path: null, paths: [] })
    expect(show).toHaveBeenCalledExactlyOnceWith(owner, { properties: ['openDirectory'] })
  })

  it('rejects directory filters, malformed values, and shell-only options', async () => {
    const { show, pick } = fixture()
    for (const input of [
      null, [], { kind: 'save' }, { kind: 'file', multiple: 2 }, { kind: 'file', defaultPath: '/tmp' },
      { kind: 'file', extensions: ['.png'] }, { kind: 'file', extensions: Array(65).fill('png') },
      { kind: 'file', extensions: Array(1) },
      { kind: 'directory', extensions: ['png'] }, { kind: 'file', prompt: 'a'.repeat(201) },
    ]) {
      await expect(pick(input)).resolves.toEqual({ ok: false, error: 'picker-invalid-request' })
    }
    expect(show).not.toHaveBeenCalled()
  })

  it('rejects repeat requests while the same window owns a picker, then allows reopening', async () => {
    const { show, pick } = fixture()
    const native = Promise.withResolvers<OpenDialogReturnValue>()
    show.mockReturnValueOnce(native.promise)
    const pending = pick({ kind: 'file' })
    await expect(pick({ kind: 'directory' })).resolves.toEqual({ ok: false, error: 'picker-busy' })
    expect(show).toHaveBeenCalledTimes(1)

    native.resolve({ canceled: true, filePaths: [] })
    await pending
    await expect(pick({ kind: 'directory' })).resolves.toMatchObject({ ok: true })
    expect(show).toHaveBeenCalledTimes(2)
  })

  it('rejects a background or closed owner', async () => {
    const { owner, renderer, show, pick } = fixture()
    owner.isFocused.mockReturnValueOnce(false)
    await expect(pick({ kind: 'file' })).resolves.toEqual({ ok: false, error: 'picker-unavailable' })
    renderer.isFocused.mockReturnValueOnce(false)
    await expect(pick({ kind: 'directory' })).resolves.toEqual({ ok: false, error: 'picker-unavailable' })
    owner.isDestroyed.mockReturnValueOnce(true)
    await expect(pick({ kind: 'file' })).resolves.toEqual({ ok: false, error: 'picker-unavailable' })
    expect(show).not.toHaveBeenCalled()
  })

  it('discards a selected path once the application document is replaced', async () => {
    const { renderer, show, pick } = fixture()
    const native = Promise.withResolvers<OpenDialogReturnValue>()
    show.mockReturnValueOnce(native.promise)
    const pending = pick({ kind: 'file' })
    renderer.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    native.resolve({ canceled: false, filePaths: [resolve('画布.png')] })
    await expect(pending).resolves.toEqual({ ok: false, error: 'picker-unavailable' })
    expect(renderer.listenerCount('did-start-navigation')).toBe(0)
    expect(renderer.listenerCount('render-process-gone')).toBe(0)
  })

  it('reports native errors and unexpected empty selections separately from cancellation', async () => {
    const { show, pick } = fixture()
    show.mockRejectedValueOnce(new Error('native failure'))
    await expect(pick({ kind: 'file' })).resolves.toEqual({ ok: false, error: 'picker-failed' })
    show.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    await expect(pick({ kind: 'file' })).resolves.toEqual({ ok: false, error: 'picker-failed' })
    show.mockResolvedValueOnce({ canceled: false, filePaths: ['relative.png'] })
    await expect(pick({ kind: 'file' })).resolves.toEqual({ ok: false, error: 'picker-failed' })
    await expect(pick({ kind: 'file' })).resolves.toEqual({ ok: true, path: null, paths: [] })
  })
})
