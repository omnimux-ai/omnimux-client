/** Single-brand OmniMux app icon contract: no upstream whale switcher, dark-mode swap, or classic assets. */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow } from 'electron'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_APP_ICONS, isDesktopAppIcon, normalizeDesktopAppIcon } from '../src/app-icon.ts'
import { desktopTranslate, NextDesktopSettings } from '../src/client/settings.tsx'
import { NextSettingsAdapter } from '../src/client/settings-adapter.ts'
import { DEFAULT_PREFERENCES, SAFE_MODE_PREFERENCES, type DesktopBridge, type DesktopState } from '../src/desktop-contract.ts'
import { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { appDockIcon, appTrayIcon, appWindowIcon, NativeDesktop } from '../src/native-desktop.ts'
import { Onboarding } from '../src/native-ui/onboarding.tsx'

const trays = vi.hoisted(() => [] as { images: string[] }[])
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useSyncExternalStore: <T>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T) =>
      actual.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot ?? getSnapshot),
  }
})
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: 'button',
  SegmentedTabs: ({ items }: { items?: { value: string; label?: unknown }[] }) =>
    createElement('div', { role: 'tablist' }, items?.map(item => createElement('span', { key: item.value }, item.label as never))),
  IconChevronDownOutlineRegular: 'svg',
  IconChevronRightOutlineRegular: 'svg',
  IconSettingsOutlineRegular: 'svg',
  Menu: ({ children }: { children?: unknown }) => createElement('div', null, children as never),
  Modal: 'dialog',
  StateDot: 'span',
  Switch: 'input',
  Tag: 'span',
  Toast: 'div',
}))
vi.mock('../src/native-ui/onboarding.css', () => ({}))
vi.mock('../../dsh-plugin-desktop/src/native-ui/components/ui/button.tsx', () => ({ Button: 'button' }))
vi.mock('../../dsh-plugin-desktop/src/native-ui/components/ui/switch.tsx', () => ({ Switch: 'input' }))
vi.mock('../../dsh-plugin-desktop/src/native-ui/components/ui/radio-group.tsx', () => ({ RadioGroup: 'div', RadioGroupItem: 'input' }))
vi.mock('../../dsh-plugin-desktop/src/native-ui/components/ui/alert.tsx', () => ({ Alert: 'div', AlertDescription: 'span' }))
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu() {} },
  Notification: class { static isSupported(): boolean { return false } },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: (path: string) => ({ path, isEmpty: () => false, setTemplateImage() {} }),
    createEmpty: () => ({ path: '', isEmpty: () => true }),
  },
  Tray: class {
    readonly images: string[]
    constructor(image: { path: string }) { this.images = [image.path]; trays.push(this) }
    setImage(image: { path: string }): void { this.images.push(image.path) }
    on(): void {}
    setToolTip(): void {}
    setTitle(): void {}
    setContextMenu(): void {}
    isDestroyed(): boolean { return false }
    destroy(): void {}
  },
}))

const root = fileURLToPath(new URL('..', import.meta.url))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const directories: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  Object.defineProperty(process, 'platform', platform)
  trays.length = 0
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const state = (): DesktopState => ({
  selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
  preferences: { ...DEFAULT_PREFERENCES }, features: { market: false, remoteControl: false },
  phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture', platform: process.platform,
  version: '0.1.0-dev.0', trayAvailable: true, notificationsAvailable: true,
  browserUrl: null, lan: null, checkpoint: null, logs: '',
})

it('offers only the single OmniMux default icon while normalizing retired classic preferences', () => {
  expect(DESKTOP_APP_ICONS).toEqual(['default'])
  expect(isDesktopAppIcon('default')).toBe(true)
  expect(isDesktopAppIcon('classic')).toBe(false)
  for (const value of ['Classic', 'whale-tail', '', null, undefined, 1]) {
    expect(isDesktopAppIcon(value)).toBe(false)
    expect(normalizeDesktopAppIcon(value)).toBeUndefined()
  }
  expect(normalizeDesktopAppIcon('default')).toBe('default')
  expect(normalizeDesktopAppIcon('classic')).toBe('default')
})

it('resolves every platform and theme to the OmniMux default icon set and omits upstream whale assets', () => {
  expect(appWindowIcon(root, 'darwin', 'default')).toBeUndefined()
  expect(appWindowIcon(root, 'darwin', 'default', true)).toBeUndefined()
  expect(appWindowIcon(root, 'win32', 'default', false)).toBe(join(root, 'build', 'app-icon.ico'))
  expect(appWindowIcon(root, 'win32', 'default', true)).toBe(join(root, 'build', 'app-icon.ico'))
  expect(appWindowIcon(root, 'linux', 'default', false)).toBe(join(root, 'build', 'app-icon.png'))
  expect(appWindowIcon(root, 'linux', 'default', true)).toBe(join(root, 'build', 'app-icon.png'))
  expect(appDockIcon(root, true, 'default')).toBeNull()
  expect(appDockIcon(root, false, 'default')).toBe(join(root, 'build', 'app-icon-mac.png'))
  expect(appTrayIcon(root, 'darwin', 'default')).toBe(join(root, 'assets', 'tray-iconTemplate.png'))
  expect(appTrayIcon(root, 'win32', 'default')).toBe(join(root, 'assets', 'tray-icon-blue.png'))
  expect(appTrayIcon(root, 'linux', 'default')).toBe(join(root, 'assets', 'tray-icon-blue.png'))

  // Every active OmniMux icon asset exists on disk.
  for (const target of ['win32', 'linux'] as const) expect(existsSync(appWindowIcon(root, target, 'default')!), `${target} frame`).toBe(true)
  for (const target of ['darwin', 'win32', 'linux'] as const) expect(existsSync(appTrayIcon(root, target, 'default')), `${target} tray`).toBe(true)
  expect(existsSync(appDockIcon(root, false, 'default')!), 'dev Dock').toBe(true)

  // Native code reads the copies unpacked beside the archive.
  const archive = join(tmpdir(), 'Resources', 'app.asar')
  expect(appTrayIcon(archive, 'linux', 'default')).toBe(join(`${archive}.unpacked`, 'assets', 'tray-icon-blue.png'))
  expect(appWindowIcon(archive, 'win32', 'default', true)).toBe(join(`${archive}.unpacked`, 'build', 'app-icon.ico'))

  // Retired upstream DeepSeek whale-tail / classic whale assets must remain absent from the tree.
  for (const retired of [
    'build/classic', 'assets/classic', 'build/app-icon-dark.ico', 'build/app-icon-dark.png',
    'build/app-icon-preview.png', 'build/app-icon-preview-dark.png',
  ]) {
    expect(existsSync(join(root, ...retired.split('/'))), `${retired} must be absent`).toBe(false)
  }
})

it('derives Linux hicolor icons from the OmniMux lavender ghost icon rather than upstream whale artwork', async () => {
  const { createRequire } = await import('node:module')
  const sharp = createRequire(join(root, '../dsh-plugin-desktop/package.json'))('sharp')
  const icon128 = await sharp(join(root, 'build', 'icons', '128x128.png')).raw().toBuffer({ resolveWithObject: true })
  expect([icon128.info.width, icon128.info.height]).toEqual([128, 128])
  // Sample an upper-left background tile pixel (24, 24) inside the rounded squircle: OmniMux lavender (#b8b7ff) vs upstream near-white/blue whale.
  const offset = (24 * icon128.info.width + 24) * icon128.info.channels
  const [r, g, b, a] = [icon128.data[offset]!, icon128.data[offset + 1]!, icon128.data[offset + 2]!, icon128.data[offset + 3]!]
  expect(a).toBeGreaterThan(240)
  expect(b).toBeGreaterThan(235)
  expect(r).toBeGreaterThan(165)
  expect(r).toBeLessThan(205)
  expect(g).toBeGreaterThan(165)
  expect(g).toBeLessThan(205)
  // Sample the center ghost body (64, 80): OmniMux charcoal (#121213), not blue whale stroke or light background.
  const center = (80 * icon128.info.width + 64) * icon128.info.channels
  expect(icon128.data[center]!).toBeLessThan(40)
  expect(icon128.data[center + 1]!).toBeLessThan(40)
  expect(icon128.data[center + 2]!).toBeLessThan(40)
})

it('normalizes legacy classic preferences to default on startup and rejects classic writes', async () => {
  const runtime = async (prepare?: (home: string) => Promise<void>) => {
    const home = await mkdtemp(join(tmpdir(), 'next-app-icon-'))
    directories.push(home)
    await prepare?.(home)
    const onChange = vi.fn()
    const value = new NextDesktopRuntime({
      home, root: home, executable: process.execPath, addresses: () => ['127.0.0.1'],
      certificate: async () => { throw new Error('No LAN certificate in this test') },
      onFailure() {}, onChange, onRestart() {}, onTerminal() {}, onNotification() {},
    })
    return { runtime: value, home, onChange }
  }
  const { runtime: normal, home, onChange } = await runtime()
  normal.initialize()
  expect(normal.state().preferences.appIcon).toBe('default')
  normal.saveAppIcon('default')
  expect(normal.state().preferences.appIcon).toBe('default')
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(JSON.parse(readFileSync(join(home, 'desktop-preferences-extra.json'), 'utf8'))).toEqual({ appIcon: 'default' })
  expect(existsSync(join(home, 'desktop-preferences.json'))).toBe(false)
  for (const rejected of ['classic', 'whale-tail']) {
    expect(() => normal.saveAppIcon(rejected)).toThrow('Invalid app icon')
  }
  expect(onChange).toHaveBeenCalledTimes(1)
  await normal.close()

  // Existing machines that previously persisted `classic` must start cleanly on OmniMux `default` without a preference failure.
  const { runtime: legacy } = await runtime(home => writeFile(join(home, 'desktop-preferences-extra.json'), JSON.stringify({ appIcon: 'classic' })))
  legacy.initialize()
  expect(legacy.state().failureStage).not.toBe('runtime-bootstrap')
  expect(legacy.preferences.appIcon).toBe('default')
  await legacy.close()

  // Even when the main preference file is broken, legacy `classic` in extra preferences normalizes to `default`.
  const { runtime: broken } = await runtime(async home => {
    await writeFile(join(home, 'desktop-preferences.json'), '{broken')
    await writeFile(join(home, 'desktop-preferences-extra.json'), JSON.stringify({ appIcon: 'classic' }))
  })
  broken.initialize()
  expect(broken.state().failureStage).toBe('runtime-bootstrap')
  expect(broken.preferences.appIcon).toBe('default')
  await broken.close()

  const { runtime: safe } = await runtime(home => writeFile(join(home, 'desktop-preferences-extra.json'), JSON.stringify({ appIcon: 'classic' })))
  safe.safeMode = true
  safe.initialize()
  expect(SAFE_MODE_PREFERENCES.appIcon).toBe('default')
  expect(safe.preferences.appIcon).toBe('default')
  expect(() => safe.saveAppIcon('default')).toThrow('fixed in Safe Mode')
  await safe.close()
})

for (const target of ['darwin', 'win32'] as const) {
  it(`keeps the single OmniMux icon in ${target === 'darwin' ? 'Dock' : 'window frames'} and tray across theme changes`, () => {
    Object.defineProperty(process, 'platform', { ...platform, value: target })
    const current = state()
    let dark = false
    const dock = { setIcon: vi.fn() }
    const open = { isDestroyed: () => false, setIcon: vi.fn() }
    const closed = { isDestroyed: () => true, setIcon: vi.fn() }
    const late = { isDestroyed: () => false, setIcon: vi.fn() }
    const warn = vi.fn()
    const installed = vi.fn()
    const native = new NativeDesktop({
      root, language: () => 'en', state: () => current, window: () => undefined, show() {}, run() {}, warn,
      appIcon: () => current.preferences.appIcon, dark: () => dark, packaged: true, windows: () => [open, closed] as unknown as BrowserWindow[],
      dock: () => target === 'darwin' ? dock : undefined, installed,
    })
    const tray = target === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png'
    native.createTray()
    expect(trays).toHaveLength(1)
    expect(trays[0]!.images).toEqual([join(root, 'assets', tray)])
    // Launch restores installed shortcuts/desktop entries once back to the packaged OmniMux default icon.
    expect(installed.mock.calls).toEqual([['default', false]])
    if (target === 'win32') expect(open.setIcon).toHaveBeenCalledExactlyOnceWith(join(root, 'build', 'app-icon.ico'))
    else expect(open.setIcon).not.toHaveBeenCalled()
    expect(closed.setIcon).not.toHaveBeenCalled()
    // Packaged macOS leaves the Dock to the bundle's compiled OmniMux Assets.car.
    expect(dock.setIcon).not.toHaveBeenCalled()
    open.setIcon.mockClear()

    // Switching system dark mode must never swap to any dark whale icon or re-trigger shortcut rewrites.
    dark = true
    native.appearanceChanged()
    expect(installed.mock.calls).toEqual([['default', false]])
    expect(open.setIcon).not.toHaveBeenCalled()
    expect(trays[0]!.images).toHaveLength(1)
    expect(dock.setIcon).not.toHaveBeenCalled()

    native.decorateWindow(late as unknown as BrowserWindow)
    if (target === 'win32') expect(late.setIcon).toHaveBeenCalledExactlyOnceWith(join(root, 'build', 'app-icon.ico'))
    else expect(late.setIcon).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    native.close()
  })
}

it('brands Desktop settings as OmniMux and hides the app icon switcher in both Settings and Onboarding', async () => {
  expect(desktopTranslate('zh-CN')('title')).toBe('OmniMux 设置')
  expect(desktopTranslate('en-US')('title')).toBe('OmniMux settings')

  const bridge: DesktopBridge = {
    state: async () => state(),
    browserLinks: async () => ({ localUrl: null, lanUrls: [] }),
    command: async () => {},
  }
  const adapter = new NextSettingsAdapter(bridge)
  await adapter.refresh()
  const settingsZh = renderToStaticMarkup(createElement(NextDesktopSettings, { adapter, language: 'zh-CN', onOpenPlugins: () => {} }))
  expect(settingsZh).toContain('OmniMux 设置')
  expect(settingsZh).toContain('窗口外观')
  expect(settingsZh).not.toContain('DSH NEXT 设置')
  expect(settingsZh).not.toContain('data-next-app-icon')
  expect(settingsZh).not.toContain('应用图标')

  const settingsEn = renderToStaticMarkup(createElement(NextDesktopSettings, { adapter, language: 'en-US', onOpenPlugins: () => {} }))
  expect(settingsEn).toContain('OmniMux settings')
  expect(settingsEn).toContain('Window appearance')
  expect(settingsEn).not.toContain('DSH NEXT settings')
  expect(settingsEn).not.toContain('data-next-app-icon')
  expect(settingsEn).not.toContain('App icon')

  vi.stubGlobal('window', { location: { search: '' } })
  const onboardingZh = renderToStaticMarkup(createElement(Onboarding, {
    state: {
      selected: 'desktop',
      features: { market: false, remoteControl: false },
      onboardingComputerUse: false,
      platform: 'darwin',
      preferences: { browserAccess: false, networkExposure: 'loopback', macosMaterial: 'transparent' },
    },
    locale: 'zh',
    bridge: { command: async () => {} },
  }))
  expect(onboardingZh).toContain('OmniMux')
  expect(onboardingZh).not.toContain('onboarding-app-icon')
  expect(onboardingZh).not.toContain('应用图标')
  expect(onboardingZh).not.toContain('经典')
})
