import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { NextUpdateSettings } from '../src/client/updates.tsx'
import { DEFAULT_PREFERENCES, type DesktopState } from '../src/desktop-contract.ts'
import type { UpdateArtifactRequest, UpdateHttpRequest as UpdateRequest } from '../src/omnimux-updater/types.ts'
import { NextUpdates, type NextUpdateOptions } from '../src/updates.ts'
import { updateDownloadDirectory } from '../src/update-downloads.ts'
import { isWindowsPortableCopy } from '../src/update-portable.ts'
import { manualUpdate, manualUpdateHint, releaseNotesUrl, updateAction, updateLabel, type NextUpdateState } from '../src/update-state.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => createElement('button', props, children as never),
}))

const roots: string[] = []
const owners: NextUpdates[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.useRealTimers()
})

function makeDmgArtifact(): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.alloc(1024)
  bytes.write('koly', 512)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function makeExeArtifact(): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.alloc(1024)
  bytes.write('MZ', 0, 'latin1')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.write('PE\0\0', 64, 'latin1')
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function makeManifestV2(version: string, channel: 'stable' | 'beta', dmg: { bytes: Buffer; sha256: string }, exe: { bytes: Buffer; sha256: string }) {
  return {
    schemaVersion: 2,
    product: 'omnimux',
    channel,
    version,
    publishedAt: '2026-11-26T00:00:00.000Z',
    urgency: 'normal',
    rollout: { percentage: 100, salt: `${version}-${channel}` },
    releaseNotesUrl: `https://github.com/omnimux-ai/omnimux-client/releases/tag/v${version}`,
    notes: { zh: ['修复内置更新'], en: ['Fix in-app updater'] },
    artifacts: {
      'darwin-arm64': {
        url: `https://dl.omnimux.ai/releases/v${version}/OmniMux-${version}-arm64.dmg`,
        sha256: dmg.sha256,
        size: dmg.bytes.byteLength,
      },
      'darwin-x64': {
        url: `https://dl.omnimux.ai/releases/v${version}/OmniMux-${version}-x64.dmg`,
        sha256: dmg.sha256,
        size: dmg.bytes.byteLength,
      },
      'win32-x64': {
        url: `https://dl.omnimux.ai/releases/v${version}/OmniMux-${version}-x64-Setup.exe`,
        sha256: exe.sha256,
        size: exe.bytes.byteLength,
      },
    },
  }
}

async function fixture(overrides: Partial<NextUpdateOptions> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'next-updates-test-')); roots.push(home)
  const dmg = makeDmgArtifact()
  const exe = makeExeArtifact()
  const channel = overrides.channel ?? 'stable'
  const targetVersion = channel === 'beta' ? '2.0.26-beta.1' : '2.0.26'
  const request = vi.fn<UpdateRequest>(async url => {
    if (url.includes('/api/desktop/v2/')) {
      return Response.json(makeManifestV2(targetVersion, channel, dmg, exe))
    }
    return new Response('', { status: 404 })
  })
  const artifactRequest = vi.fn<UpdateArtifactRequest>(async url => {
    const payload = url.endsWith('.exe') ? exe.bytes : dmg.bytes
    return {
      response: new Response(new Uint8Array(payload), { headers: { 'content-length': String(payload.byteLength) } }),
      finalUrl: url,
    }
  })
  const options: NextUpdateOptions = {
    userData: home,
    version: channel === 'beta' ? '2.0.25-beta.1' : '2.0.25',
    platform: 'darwin',
    packaged: true,
    channel,
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    preflight: async () => {},
    request,
    artifactRequest,
    prepare: vi.fn(async path => { expect(await readFile(path)).toEqual(dmg.bytes) }),
    install: vi.fn(async () => {}),
    changed: vi.fn(),
    log: vi.fn(),
    ...overrides,
  }
  const updates = new NextUpdates(options); owners.push(updates)
  return { updates, options, request, artifactRequest, dmg, exe }
}

it('checks stable channel by default without downloading; download waits for explicit install', async () => {
  const { updates, options, request } = await fixture()
  await updates.check()
  expect(updates.snapshot()).toMatchObject({ phase: 'available', version: '2.0.26', channel: 'stable' })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0]![0]).toBe('https://dl.omnimux.ai/api/desktop/v2/stable.json')
  await Promise.all([updates.download(), updates.download()])
  expect(updates.snapshot()).toMatchObject({ phase: 'ready', received: 1024, total: 1024 })
  expect(options.prepare).toHaveBeenCalledOnce()
  expect(options.install).not.toHaveBeenCalled()
  await updates.install()
  expect(options.install).toHaveBeenCalledOnce()
  expect(updates.snapshot().phase).toBe('installing')
})

it('does not confuse an unpublished channel, invalid response or network failure with up to date', async () => {
  for (const response of [
    new Response('', { status: 400 }),
    new Response('', { status: 503 }),
    Response.json({ schemaVersion: 2, product: 'omnimux', channel: 'beta', version: '2.0.26-beta.1', publishedAt: '2026-11-26T00:00:00.000Z', urgency: 'normal', artifacts: {} }),
  ]) {
    const { updates } = await fixture({ request: async () => response })
    await updates.check()
    expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'service' })
  }
})

it('selects the CPU-specific immutable macOS DMG directly from Manifest v2', async () => {
  const { updates, artifactRequest } = await fixture({ arch: 'arm64' })
  await updates.download()
  expect(updates.snapshot().phase).toBe('ready')
  expect(artifactRequest.mock.calls[0]![0]).toBe('https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg')

  const intel = await fixture({ arch: 'x64' })
  await intel.updates.download()
  expect(intel.artifactRequest.mock.calls[0]![0]).toBe('https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-x64.dmg')
})

it('allows checks in development, but never downloads or replaces the development application', async () => {
  const { updates, options, request } = await fixture({ packaged: false })
  await updates.check()
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ installable: false, error: 'development', environment: 'source' })
  expect(request).toHaveBeenCalledOnce()
  expect(options.prepare).not.toHaveBeenCalled()
})

it('polls on Linux without installation UUID, notifies once and leaves download to the release page', async () => {
  const mac = await fixture()
  await mac.updates.check()
  expect(new Headers(mac.request.mock.calls[0]![1].headers).get('X-OmniMux-Installation-Id')).toMatch(/^[0-9a-f-]{36}$/)

  vi.useFakeTimers()
  const available = vi.fn()
  const { updates, options, request } = await fixture({ platform: 'linux', packaged: true, available })
  updates.start()
  await vi.advanceTimersByTimeAsync(30_000)
  await vi.waitFor(() => expect(updates.snapshot().phase).toBe('available'))
  expect(request).toHaveBeenCalledOnce()
  const headers = new Headers(request.mock.calls[0]![1].headers)
  expect(headers.get('X-OmniMux-Channel')).toBe('stable')
  expect(headers.has('X-OmniMux-Installation-Id')).toBe(false)
  expect(existsSync(join(options.userData, 'identity'))).toBe(false)
  expect(updates.snapshot()).toMatchObject({ version: '2.0.26', installable: false, environment: 'linux' })
  expect(available).toHaveBeenCalledExactlyOnceWith('2.0.26')
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'unsupported' })
  expect(request).toHaveBeenCalledOnce()
})

it('recognizes a packaged Windows copy without the uninstaller Setup writes beside it as portable', () => {
  const executable = 'D:\\Tools\\OmniMux\\OmniMux.exe'
  const probe = vi.fn((_path: string) => false)
  expect(isWindowsPortableCopy('win32', true, executable, probe)).toBe(true)
  expect(probe).toHaveBeenCalledExactlyOnceWith('D:\\Tools\\OmniMux\\Uninstall OmniMux.exe')
  const installed = 'C:\\Users\\user\\AppData\\Local\\Programs\\OmniMux\\OmniMux.EXE'
  expect(isWindowsPortableCopy('win32', true, installed, path => path === 'C:\\Users\\user\\AppData\\Local\\Programs\\OmniMux\\Uninstall OmniMux.exe')).toBe(false)
  for (const [platform, packaged] of [['win32', false], ['darwin', true], ['linux', true]] as const) {
    expect(isWindowsPortableCopy(platform, packaged, executable, probe)).toBe(false)
  }
  expect(probe).toHaveBeenCalledOnce()
})

it('leaves the update of a portable Windows copy to the release page, while sending installation UUID', async () => {
  const { updates, options, request, artifactRequest } = await fixture({ platform: 'win32', portable: true })
  expect(updates.snapshot()).toMatchObject({ phase: 'idle', installable: false, portable: true, environment: 'portable' })
  await updates.check()
  expect(updates.snapshot()).toMatchObject({ phase: 'available', version: '2.0.26', installable: false, portable: true })
  expect(manualUpdate(updates.snapshot(), 'win32')).toBe(true)
  expect(new Headers(request.mock.calls[0]![1].headers).get('X-OmniMux-Installation-Id')).toMatch(/^[0-9a-f-]{36}$/)
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'unsupported', portable: true })
  expect(artifactRequest).not.toHaveBeenCalled()
  expect(options.prepare).not.toHaveBeenCalled()
  const installed = await fixture({ platform: 'win32' })
  expect(installed.updates.snapshot()).toMatchObject({ phase: 'idle', installable: true, environment: 'production' })
  expect(manualUpdate(installed.updates.snapshot(), 'win32')).toBe(false)
  expect(manualUpdate({ phase: 'idle', installable: false }, 'linux')).toBe(true)
})

it('rechecks the selected version before downloading, and preserves preparation failures for retry', async () => {
  const { updates, options } = await fixture({ prepare: async () => { throw new Error('Signature mismatch') } })
  await updates.download()
  expect(updates.snapshot()).toMatchObject({ phase: 'error', error: 'prepare', errorCode: 'PREPARE_FAILED' })
  await updates.install()
  expect(options.install).not.toHaveBeenCalled()
  expect(updateAction(updates.snapshot())).toBe('download-update')
})

it('stops polling and aborts an active request on shutdown', async () => {
  const request = vi.fn<UpdateRequest>(async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
  const { updates } = await fixture({ request, packaged: false })
  const check = updates.check()
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  await updates.dispose()
  await check
  expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
})

it('shows progress and an actionable downloaded state in both languages', () => {
  expect(updateLabel({ phase: 'downloading', installable: true, received: 25, total: 100 }, 'zh-CN')).toContain('25%')
  expect(updateLabel({ phase: 'downloading', installable: true, received: 2 * 1048576 }, 'en')).toContain('2 MB')
  expect(updateAction({ phase: 'preparing', installable: true })).toBeUndefined()
  expect(updateAction({ phase: 'ready', installable: true })).toBe('install-update')
})

it('keeps Windows installers in the system temporary directory under omnimux-updates', () => {
  expect(updateDownloadDirectory('win32')).toBe(join(tmpdir(), 'omnimux-updates'))
  expect(updateDownloadDirectory('darwin')).toBeUndefined()
  expect(updateDownloadDirectory('linux')).toBeUndefined()
})

it('downloads into the configured directory and cleans leftover downloads in both current and legacy state dirs', async () => {
  const downloads = await mkdtemp(join(tmpdir(), 'next-update-downloads-')); roots.push(downloads)
  const { updates, options } = await fixture({
    platform: 'win32',
    downloads,
    prepare: vi.fn(async () => {}),
  })
  const state = join(options.userData, 'omnimux-updates')
  const legacyState = join(options.userData, 'next-updates')
  for (const directory of [join(state, 'download-earlier'), join(legacyState, 'download-old'), join(downloads, 'download-earlier'), join(downloads, 'unrelated')]) {
    await mkdir(directory, { recursive: true })
  }
  await updates.download()
  expect(updates.snapshot().phase).toBe('ready')
  const [path, , directory] = vi.mocked(options.prepare).mock.calls[0]!
  expect(dirname(directory)).toBe(downloads)
  expect(dirname(path)).toBe(directory)
  expect(existsSync(join(state, 'download-earlier'))).toBe(false)
  expect(existsSync(join(legacyState, 'download-old'))).toBe(false)
  expect(existsSync(join(downloads, 'download-earlier'))).toBe(false)
  expect(existsSync(join(downloads, 'unrelated'))).toBe(true)
  expect(existsSync(join(state, 'state.json'))).toBe(true)
})

it('notifies once per newly discovered background update version and persists notifiedVersion across restarts', async () => {
  let latestVersion = '2.0.26'
  const dmg = makeDmgArtifact()
  const exe = makeExeArtifact()
  const available = vi.fn()
  const { updates, options } = await fixture({
    available,
    request: async () => Response.json(makeManifestV2(latestVersion, 'stable', dmg, exe)),
  })
  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)
  expect(available).toHaveBeenCalledWith('2.0.26')

  await updates.check(true)
  expect(available).toHaveBeenCalledTimes(1)

  const secondAvailable = vi.fn()
  const restarted = new NextUpdates({ ...options, available: secondAvailable })
  owners.push(restarted)
  await restarted.check(true)
  expect(secondAvailable).not.toHaveBeenCalled()

  latestVersion = '2.0.27'
  await restarted.check(true)
  expect(secondAvailable).toHaveBeenCalledTimes(1)
  expect(secondAvailable).toHaveBeenCalledWith('2.0.27')
})

const baseState: DesktopState = {
  selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
  features: { market: false, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
  phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture',
  platform: 'linux', version: '2.0.25', trayAvailable: true, notificationsAvailable: true,
  browserUrl: null, lan: null, checkpoint: null, logs: '',
  updates: { phase: 'idle', installable: false },
}

it('shows update status and controls on every platform, and sends Linux to the release page to download', () => {
  const render = (platform: string, updates: NextUpdateState) =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform, updates }, language: 'zh-CN', run: vi.fn() }))
  const linuxHtml = render('linux', { phase: 'idle', installable: false })
  expect(linuxHtml).toContain('应用更新')
  expect(linuxHtml).toMatch(/<button[^>]*>检查更新<\/button>/)
  expect(linuxHtml).not.toMatch(/<button[^>]*disabled/)
  expect(linuxHtml).toContain('Linux 版需要手动更新')
  const linuxAvailable = render('linux', { phase: 'available', version: '2.0.26', installable: false })
  expect(linuxAvailable).toContain('发现新版本 2.0.26')
  expect(linuxAvailable).toMatch(/<button[^>]*>前往下载<\/button>/)
  expect(linuxAvailable).not.toMatch(/<button[^>]*disabled/)

  const macHtml = render('darwin', { phase: 'idle', installable: false })
  expect(macHtml).toContain('应用更新')
  expect(macHtml).toContain('检查更新')
  expect(macHtml).not.toContain('Linux 版需要手动更新')
  expect(render('darwin', { phase: 'available', version: '2.0.26', installable: false })).toMatch(/<button[^>]*disabled=""[^>]*>下载更新<\/button>/)
})

it('sends a portable Windows copy to the release page with instructions for replacing its folder', () => {
  const render = (updates: NextUpdateState, language = 'zh-CN') =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform: 'win32', updates }, language, run: vi.fn() }))
  const portable: NextUpdateState = { phase: 'available', version: '2.0.26', installable: false, portable: true }
  const html = render(portable)
  expect(html).toContain('便携版需要手动更新')
  expect(html).toMatch(/<button[^>]*>前往下载<\/button>/)
  expect(html).not.toMatch(/<button[^>]*disabled/)
  expect(render(portable, 'en')).toContain(manualUpdateHint('en', true))
  expect(manualUpdateHint('en', true)).toContain('portable ZIP')
  const installed = render({ phase: 'available', version: '2.0.26', installable: true })
  expect(installed).toMatch(/<button[^>]*>下载更新<\/button>/)
  expect(installed).not.toContain('便携版需要手动更新')
})

it('names the OmniMux release notes page safely and encodes untrusted versions', () => {
  const releases = 'https://github.com/omnimux-ai/omnimux-client/releases'
  expect(releaseNotesUrl()).toBe(releases)
  for (const version of ['2.0.25', '2.0.26-beta.1']) expect(releaseNotesUrl(version)).toBe(`${releases}/tag/v${version}`)
  const hostile = new URL(releaseNotesUrl('9.9.9/../../x?y#z'))
  expect([hostile.search, hostile.hash]).toEqual(['', ''])
  expect(hostile.pathname).toMatch(/^\/omnimux-ai\/omnimux-client\/releases\/tag\/v[^/]+$/)
})

it('links the OmniMux release notes beside update controls in both languages', () => {
  const releases = 'https://github.com/omnimux-ai/omnimux-client/releases'
  const installed = baseState.version
  const current: NextUpdateState = { phase: 'current', version: '2.0.25', installable: true }
  const ready: NextUpdateState = { phase: 'ready', version: '2.0.26', installable: true }
  const render = (platform: string, language: string, updates: NextUpdateState) =>
    renderToStaticMarkup(createElement(NextUpdateSettings, { state: { ...baseState, platform, updates }, language, run: vi.fn() }))
  const cases: [string, string, NextUpdateState, string, string][] = [
    ['darwin', 'zh-CN', { phase: 'idle', installable: true }, '更新公告', `${releases}/tag/v${installed}`],
    ['darwin', 'zh-CN', { phase: 'error', error: 'service', installable: true }, '更新公告', `${releases}/tag/v${installed}`],
    ['darwin', 'zh-CN', current, '更新公告', `${releases}/tag/v${current.version}`],
    ['win32', 'en', ready, 'Release notes', `${releases}/tag/v${ready.version}`],
    ['linux', 'zh-CN', { ...ready, phase: 'available', installable: false }, '更新公告', `${releases}/tag/v${ready.version}`],
  ]
  for (const [platform, language, updates, label, href] of cases) {
    const anchor = render(platform, language, updates).match(/<a [^>]*>[^<]*<\/a>/)?.[0]
    expect(anchor).toContain(`href="${href}"`)
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toContain('rel="noopener noreferrer"')
    expect(anchor).toContain(`>${label}</a>`)
  }
})
