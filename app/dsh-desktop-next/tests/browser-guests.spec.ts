import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, Session, WebContents } from 'electron'

type BeforeRequestHandler = (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void

const sessions = new Map<string, { beforeRequest?: BeforeRequestHandler }>()

vi.mock('electron', () => ({
  app: { isPackaged: true },
  session: {
    fromPartition: (partition: string) => {
      const record: { beforeRequest?: BeforeRequestHandler } = {}
      sessions.set(partition, record)
      return {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setDevicePermissionHandler: vi.fn(),
        setDisplayMediaRequestHandler: vi.fn(),
        on: vi.fn(),
        webRequest: {
          onBeforeRequest: (handler: BeforeRequestHandler) => { record.beforeRequest = handler },
        },
      } as unknown as Session
    },
  },
}))

const { DesktopBrowserGuests } = await import('../src/browser-guests.ts')

beforeEach(() => { sessions.clear() })

function createGuests(origins: readonly string[]) {
  const guests = new DesktopBrowserGuests(() => origins)
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: vi.fn(),
  }) as unknown as WebContents & EventEmitter
  const window = { webContents: owner } as unknown as BrowserWindow
  guests.bind(window, () => () => {})
  const { lease, partition } = guests.acquire(owner, 'workspace-1')
  const guest = Object.assign(new EventEmitter(), {
    getURL: () => `about:blank#${lease}`,
    isDestroyed: () => false,
    close: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }) as unknown as WebContents & EventEmitter
  owner.emit('did-attach-webview', {}, guest)
  guest.emit('dom-ready')
  const beforeRequest = sessions.get(partition)!.beforeRequest!
  const checkRequest = (url: string): boolean => {
    let cancelled = false
    beforeRequest({ url }, (response) => { cancelled = response.cancel })
    return cancelled
  }
  const checkNavigate = (url: string): boolean => {
    let prevented = false
    guest.emit('will-frame-navigate', { isMainFrame: true, url, preventDefault: () => { prevented = true } })
    return prevented
  }
  const checkRedirect = (url: string): boolean => {
    let prevented = false
    guest.emit('will-redirect', { preventDefault: () => { prevented = true } }, url, false, true)
    return prevented
  }
  return { checkRequest, checkNavigate, checkRedirect }
}

it('blocks loopback aliases, LAN HTTPS/WSS origins, and does not conflate port 443 with HTTP port 80 (issue #363)', () => {
  const { checkRequest, checkNavigate, checkRedirect } = createGuests([
    'http://127.0.0.1:1234',
    'https://192.168.1.20:5678',
    'https://10.0.0.20',
  ])

  for (const blocked of [
    'http://127.0.0.1:1234/api/state',
    'http://localhost.:1234/api/state',
    'http://sub.localhost:1234/api/state',
    'http://0.0.0.0:1234/api/state',
    'http://127.0.0.2:1234/api/state',
    'http://[::ffff:127.0.0.1]:1234/api/state',
    'https://192.168.1.20:5678/api/state',
    'https://10.0.0.20/api/state',
    'https://10.0.0.20:443/api/state',
  ]) {
    expect(checkRequest(blocked), `onBeforeRequest should block ${blocked}`).toBe(true)
    expect(checkNavigate(blocked), `will-frame-navigate should block ${blocked}`).toBe(true)
    expect(checkRedirect(blocked), `will-redirect should block ${blocked}`).toBe(true)
  }

  for (const blockedWs of [
    'ws://sub.localhost:1234/ws',
    'wss://192.168.1.20:5678/ws',
    'wss://10.0.0.20/ws',
  ]) {
    expect(checkRequest(blockedWs), `onBeforeRequest should block ${blockedWs}`).toBe(true)
  }

  // Default HTTPS port 443 on LAN host must NOT falsely block unrelated HTTP port 80 on localhost or external sites.
  for (const allowed of [
    'http://localhost/',
    'http://127.0.0.1:8080/preview',
    'https://example.com/docs',
  ]) {
    expect(checkRequest(allowed), `onBeforeRequest should allow ${allowed}`).toBe(false)
    expect(checkNavigate(allowed), `will-frame-navigate should allow ${allowed}`).toBe(false)
    expect(checkRedirect(allowed), `will-redirect should allow ${allowed}`).toBe(false)
  }
})
