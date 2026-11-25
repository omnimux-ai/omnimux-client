import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopPreferenceStore } from '../../src/desktop-preferences.ts'
import { OmniMuxUpdateCoordinator } from '../../src/omnimux-updater/coordinator.ts'
import type { UpdateArtifactRequest, UpdateHttpRequest } from '../../src/omnimux-updater/types.ts'

const roots: string[] = []
const owners: OmniMuxUpdateCoordinator[] = []

afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function makeDmg() {
  const bytes = Buffer.alloc(1024)
  bytes.write('koly', 512)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function makeManifest(version: string, channel: 'stable' | 'beta', dmg: { bytes: Buffer; sha256: string }) {
  return {
    schemaVersion: 2,
    product: 'omnimux',
    channel,
    version,
    publishedAt: '2026-11-26T00:00:00.000Z',
    urgency: 'normal',
    rollout: { percentage: 100, salt: `${version}-${channel}` },
    releaseNotesUrl: `https://github.com/omnimux-ai/omnimux-client/releases/tag/v${version}`,
    notes: { zh: ['更新条目'], en: ['Update item'] },
    artifacts: {
      'darwin-arm64': {
        url: `https://dl.omnimux.ai/releases/v${version}/OmniMux-${version}-arm64.dmg`,
        sha256: dmg.sha256,
        size: dmg.bytes.byteLength,
      },
    },
  }
}

it('supports cancelling an in-progress download and returning cleanly to available', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-coord-cancel-')); roots.push(dir)
  const dmg = makeDmg()
  const request: UpdateHttpRequest = async () => Response.json(makeManifest('2.0.26', 'stable', dmg))
  const artifactRequest: UpdateArtifactRequest = async (url, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(dmg.bytes.subarray(0, 128))
        init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
      },
    })
    return { finalUrl: url, response: new Response(stream, { status: 200, headers: { 'content-length': '1024' } }) }
  }
  const coord = new OmniMuxUpdateCoordinator({
    version: '2.0.25',
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    environment: 'production',
    channel: 'stable',
    userData: dir,
    arch: 'arm64',
    preflight: async () => {},
    request,
    artifactRequest,
    changed: vi.fn(),
    log: vi.fn(),
    prepare: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  })
  owners.push(coord)

  const dl = coord.download()
  await vi.waitFor(() => expect(coord.snapshot().phase).toBe('downloading'))
  await coord.cancelDownload()
  await dl
  expect(coord.snapshot().phase).toBe('available')
})

it('handles user cancellation during install (active tasks warning) by staying ready', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-coord-active-')); roots.push(dir)
  const dmg = makeDmg()
  const install = vi.fn(async () => false)
  const coord = new OmniMuxUpdateCoordinator({
    version: '2.0.25',
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    environment: 'production',
    channel: 'stable',
    userData: dir,
    arch: 'arm64',
    preflight: async () => {},
    request: async () => Response.json(makeManifest('2.0.26', 'stable', dmg)),
    artifactRequest: async url => ({ finalUrl: url, response: new Response(dmg.bytes, { status: 200 }) }),
    changed: vi.fn(),
    log: vi.fn(),
    prepare: vi.fn(async () => {}),
    install,
  })
  owners.push(coord)

  await coord.download()
  expect(coord.snapshot().phase).toBe('ready')
  await coord.install()
  expect(install).toHaveBeenCalledOnce()
  expect(coord.snapshot().phase).toBe('ready')
})

it('records post-update notice on --updated launch when version advances and supports channel switching + downgrade-safe preference storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-coord-post-')); roots.push(dir)
  const dmg = makeDmg()

  // First launch on 2.0.25 persists lastLaunchedVersion.
  const first = new OmniMuxUpdateCoordinator({
    version: '2.0.25',
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    environment: 'production',
    userData: dir,
    arch: 'arm64',
    preflight: async () => {},
    request: async () => Response.json(makeManifest('2.0.26', 'stable', dmg)),
    artifactRequest: async url => ({ finalUrl: url, response: new Response(dmg.bytes) }),
    changed: vi.fn(),
    log: vi.fn(),
    prepare: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  })
  owners.push(first)
  expect(await first.observeLaunchArguments(['OmniMux'])).toBe(false)

  // Upgraded launch on 2.0.26 with --updated surfaces one-time notice.
  const upgraded = new OmniMuxUpdateCoordinator({
    version: '2.0.26',
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    environment: 'production',
    userData: dir,
    arch: 'arm64',
    preflight: async () => {},
    request: async url => {
      if (url.endsWith('/beta.json')) return Response.json(makeManifest('2.0.27-beta.1', 'beta', dmg))
      return Response.json(makeManifest('2.0.26', 'stable', dmg))
    },
    artifactRequest: async url => ({ finalUrl: url, response: new Response(dmg.bytes) }),
    changed: vi.fn(),
    log: vi.fn(),
    prepare: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  })
  owners.push(upgraded)
  expect(await upgraded.observeLaunchArguments(['OmniMux', '--updated'])).toBe(true)
  expect(upgraded.snapshot().justUpdatedFrom).toBe('2.0.25')
  upgraded.dismissPostUpdateNotice()
  expect(upgraded.snapshot().justUpdatedFrom).toBeUndefined()

  // Switching channel persists updateChannel ONLY to desktop-preferences-extra.json (downgrade-safe).
  const prefs = new DesktopPreferenceStore(dir)
  prefs.write({ ...prefs.read() })
  await upgraded.switchChannel('beta', ch => { prefs.writeExtra({ updateChannel: ch }) })
  expect(upgraded.snapshot()).toMatchObject({ channel: 'beta', phase: 'available', version: '2.0.27-beta.1' })
  const basePrefs = JSON.parse(await readFile(prefs.file, 'utf8')) as Record<string, unknown>
  const extraPrefs = JSON.parse(await readFile(prefs.extraFile, 'utf8')) as Record<string, unknown>
  expect('updateChannel' in basePrefs).toBe(false)
  expect(extraPrefs.updateChannel).toBe('beta')
})
