import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ANALYTICS_USER_AGENT,
  DesktopAnalyticsClient,
  extractStartupAnalyticsFromSummary,
  FIRST_RUN_REPORTED_RELATIVE_PATH,
} from '../src/desktop-analytics.ts'
import { getOrCreateDesktopInstallationIdentity } from '../src/desktop-installation-id.ts'
import type { DesktopLifecycleSummary } from '../src/lifecycle-events.ts'

const DESTINATION = {
  endpoint: 'http://localhost:8077/api/send',
  websiteId: '11111111-2222-4333-8444-555555555555',
}
const LAUNCH = { appVersion: '2.0.25', platform: 'darwin' as const, osVersion: '26.1.0' }
const roots: string[] = []

function tempUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-analytics-test-'))
  roots.push(dir)
  return dir
}

beforeEach(() => {
  vi.stubEnv('OMNIMUX_ANALYTICS_ENDPOINT', undefined)
  vi.stubEnv('OMNIMUX_ANALYTICS_WEBSITE_ID', undefined)
  vi.stubEnv('OMNIMUX_ANALYTICS_DISABLED', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {}
  }
})

describe('DesktopAnalyticsClient', () => {
  it('preserves the app-startup schema and uses the collector configured through the environment', async () => {
    vi.stubEnv('OMNIMUX_ANALYTICS_ENDPOINT', DESTINATION.endpoint)
    vi.stubEnv('OMNIMUX_ANALYTICS_WEBSITE_ID', DESTINATION.websiteId)
    const root = tempUserData()
    const captured: Array<{ url: string; init: RequestInit }> = []
    const request = vi.fn(async (url: string, init: RequestInit) => {
      captured.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const client = new DesktopAnalyticsClient({
      userDataDir: root,
      request,
    })

    await client.reportStartup({
      appVersion: '2.0.9',
      platform: 'darwin',
      arch: 'arm64',
      totalDurationMs: 1234,
      finalStage: 'health-commit',
      rendererStatus: 'healthy',
      electronReadyMs: 100,
      hostBootMs: 500,
    })

    expect(request).toHaveBeenCalledTimes(1)
    const firstCall = captured[0]!
    expect(firstCall.url).toBe(DESTINATION.endpoint)
    const headers = firstCall.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['User-Agent']).toBe(DEFAULT_ANALYTICS_USER_AGENT)
    expect(headers['x-umami-website-id']).toBe(DESTINATION.websiteId)
    expect(headers['x-umami-hostname']).toBe('omnimux-desktop')

    const parsedBody = JSON.parse(firstCall.init.body as string)
    expect(parsedBody).toEqual({
      type: 'event',
      payload: {
        website: DESTINATION.websiteId,
        hostname: 'omnimux-desktop',
        url: 'omnimux://desktop',
        name: 'app-startup',
        data: {
          appVersion: '2.0.9',
          platform: 'darwin',
          arch: 'arm64',
          finalStage: 'health-commit',
          rendererStatus: 'healthy',
          totalDurationMs: 1234,
          electronReadyMs: 100,
          hostBootMs: 500,
        },
      },
    })
  })

  it('persists the claim before sending and keeps the exact schema and device ID across restarts and upgrades', async () => {
    const userDataDir = tempUserData()
    const identity = await getOrCreateDesktopInstallationIdentity(userDataDir)
    const marker = join(userDataDir, FIRST_RUN_REPORTED_RELATIVE_PATH)
    const markersAtSend: string[] = []
    const request = vi.fn(async (_url: string, _init: RequestInit) => {
      markersAtSend.push(readFileSync(marker, 'utf8'))
      return new Response(null, { status: 204 })
    })
    const client = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request })
    expect(existsSync(marker)).toBe(false)
    expect(request).not.toHaveBeenCalled()
    const metadata = { ...LAUNCH, filePath: userDataDir, prompt: 'test prompt', content: 'test content', credential: 'test credential' }
    await Promise.all([client.reportLaunch(identity, metadata), client.reportLaunch(identity, metadata)])
    expect(request).toHaveBeenCalledTimes(1)
    expect(markersAtSend).toEqual(['1\n'])
    if (process.platform !== 'win32') expect(statSync(marker).mode & 0o777).toBe(0o600)
    const first = request.mock.calls[0]![1]
    expect(first).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'manual' })
    expect(JSON.parse(first.body as string)).toEqual({
      type: 'event',
      payload: {
        website: DESTINATION.websiteId,
        hostname: 'omnimux-desktop',
        url: 'omnimux://desktop',
        name: 'desktop_app_launch',
        data: { is_first_launch: true, app_version: '2.0.25', os: 'darwin', os_version: '26.1.0', device_id: identity.id },
      },
    })

    for (const appVersion of ['2.0.25', '2.0.26']) {
      const later = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request })
      await later.reportLaunch(await getOrCreateDesktopInstallationIdentity(userDataDir), { ...LAUNCH, appVersion })
      expect(JSON.parse(request.mock.lastCall![1].body as string).payload.data).toEqual({
        is_first_launch: false, app_version: appVersion, os: 'darwin', os_version: '26.1.0', device_id: identity.id,
      })
    }
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('honors an existing first-run marker even when the old installation ID was missing', async () => {
    const userDataDir = tempUserData()
    const identity = await getOrCreateDesktopInstallationIdentity(userDataDir)
    const marker = join(userDataDir, FIRST_RUN_REPORTED_RELATIVE_PATH)
    const original = '2026-01-01T00:00:00.000Z\n'
    writeFileSync(marker, original, { mode: 0o600 })
    const request = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }))
    const client = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request })

    await client.reportLaunch(identity, LAUNCH)

    expect(readFileSync(marker, 'utf8')).toBe(original)
    expect(JSON.parse(request.mock.calls[0]![1].body as string).payload.data.is_first_launch).toBe(false)
  })

  it('does not send a first launch when its local claim cannot be stored', async () => {
    const userDataDir = tempUserData()
    const identity = await getOrCreateDesktopInstallationIdentity(userDataDir)
    const unavailableUserDataDir = tempUserData()
    const request = vi.fn(async () => new Response(null, { status: 204 }))
    const logger = { info: vi.fn(), error: vi.fn() }
    const client = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir: unavailableUserDataDir, request, logger })

    await expect(client.reportLaunch(identity, LAUNCH)).resolves.toBeUndefined()

    expect(request).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('desktop-analytics: desktop_app_launch failed (reason=first-launch-marker)')
  })

  it('reports session exit and measures elapsed duration', async () => {
    const root = tempUserData()
    const captured: Array<{ url: string; init: RequestInit }> = []
    const request = vi.fn(async (url: string, init: RequestInit) => {
      captured.push({ url, init })
      return new Response('{}', { status: 200 })
    })

    let monotonic = 1000
    const client = new DesktopAnalyticsClient({
      ...DESTINATION,
      userDataDir: root,
      request,
      monotonicNow: () => monotonic,
    })

    monotonic = 7500 // 6500ms elapsed
    await client.reportSessionExit({
      appVersion: '2.0.9',
      platform: 'darwin',
      arch: 'arm64',
    })

    expect(request).toHaveBeenCalledTimes(1)
    const firstCall = captured[0]!
    const parsedBody = JSON.parse(firstCall.init.body as string)
    expect(parsedBody.payload.name).toBe('app-session')
    expect(parsedBody.payload.data).toEqual({
      durationMs: 6500,
      cleanExit: true,
      appVersion: '2.0.9',
      platform: 'darwin',
      arch: 'arm64',
    })

    // Calling exit a second time is guarded
    await client.reportSessionExit({
      appVersion: '2.0.9',
      platform: 'darwin',
      arch: 'arm64',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('heartbeat periodic reporting works and stops cleanly', async () => {
    vi.useFakeTimers()
    try {
      const root = tempUserData()
      const request = vi.fn(async () => new Response('{}', { status: 200 }))
      let monotonic = 10_000

      const client = new DesktopAnalyticsClient({
        ...DESTINATION,
        userDataDir: root,
        request,
        monotonicNow: () => monotonic,
      })

      client.startHeartbeat({ appVersion: '2.0.9', platform: 'darwin', arch: 'arm64' }, 1000)

      monotonic += 1000
      vi.advanceTimersByTime(1000)
      expect(request).toHaveBeenCalledTimes(1)

      monotonic += 1000
      vi.advanceTimersByTime(1000)
      expect(request).toHaveBeenCalledTimes(2)

      client.stopHeartbeat()
      monotonic += 1000
      vi.advanceTimersByTime(1000)
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([undefined, 503, 302])('logs a failed first launch (status %s) without retry, data leakage or backfill', async status => {
    const userDataDir = tempUserData()
    const identity = await getOrCreateDesktopInstallationIdentity(userDataDir)
    const marker = join(userDataDir, FIRST_RUN_REPORTED_RELATIVE_PATH)
    const logger = { info: vi.fn(), error: vi.fn() }
    const markersAtSend: boolean[] = []
    const request = vi.fn(async (_url: string, _init: RequestInit) => {
      markersAtSend.push(existsSync(marker))
      if (status === undefined) throw new Error('private request details')
      return new Response(null, { status })
    })
    const client = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request, logger })

    await expect(client.reportLaunch(identity, LAUNCH)).resolves.toBeUndefined()
    await client.reportLaunch(identity, LAUNCH)
    expect(request).toHaveBeenCalledTimes(1)
    expect(markersAtSend).toEqual([true])
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(
      status === undefined
        ? /^desktop-analytics: desktop_app_launch failed \(reason=network durationMs=\d+\)$/u
        : new RegExp(`^desktop-analytics: desktop_app_launch failed \\(reason=http status=${status} durationMs=\\d+\\)$`, 'u'),
    ))

    const restored = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }))
    const later = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request: restored })
    await later.reportLaunch(await getOrCreateDesktopInstallationIdentity(userDataDir), LAUNCH)
    expect(restored).toHaveBeenCalledTimes(1)
    expect(JSON.parse(restored.mock.calls[0]![1].body as string).payload.data).toMatchObject({
      is_first_launch: false, device_id: identity.id,
    })
  })

  it('aborts a pending launch request at 3 seconds independently of the legacy event timeout', async () => {
    const userDataDir = tempUserData()
    const identity = await getOrCreateDesktopInstallationIdentity(userDataDir)
    const logger = { info: vi.fn(), error: vi.fn() }
    const networkStarted = Promise.withResolvers<AbortSignal>()
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      networkStarted.resolve(signal)
    }))
    vi.useFakeTimers()
    const client = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request, logger, timeoutMs: 6000 })
    const completion = client.reportLaunch(identity, LAUNCH)
    const signal = await networkStarted.promise

    await vi.advanceTimersByTimeAsync(2999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(completion).resolves.toBeUndefined()
    expect(signal.aborted).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('desktop_app_launch failed (reason=timeout'))
  })

  it.each(['1', 'true'])('honors the environment opt-out %s and still persists the launch claim', async disabled => {
    vi.stubEnv('OMNIMUX_ANALYTICS_DISABLED', disabled)
    const userDataDir = tempUserData()
    const identity = await getOrCreateDesktopInstallationIdentity(userDataDir)
    const request = vi.fn(async () => new Response(null, { status: 204 }))
    const client = new DesktopAnalyticsClient({ ...DESTINATION, userDataDir, request })

    await client.reportLaunch(identity, LAUNCH)
    await client.reportStartup({ appVersion: '2.0.9', platform: 'darwin', arch: 'arm64' })
    await client.reportSessionExit({ appVersion: '2.0.9', platform: 'darwin', arch: 'arm64' })

    expect(request).not.toHaveBeenCalled()
    expect(existsSync(join(userDataDir, FIRST_RUN_REPORTED_RELATIVE_PATH))).toBe(true)
  })

  it.each([
    {},
    { endpoint: DESTINATION.endpoint },
    { websiteId: DESTINATION.websiteId },
    { ...DESTINATION, endpoint: 'data:text/plain,fixture' },
  ])('requires a complete, valid collector configuration (%j)', async destination => {
    const userDataDir = tempUserData()
    const request = vi.fn(async () => new Response(null, { status: 204 }))
    const client = new DesktopAnalyticsClient({ ...destination, userDataDir, request })

    await client.reportLaunch(await getOrCreateDesktopInstallationIdentity(userDataDir), LAUNCH)
    await client.reportStartup({ appVersion: '2.0.9', platform: 'darwin', arch: 'arm64' })
    await client.reportSessionExit({ appVersion: '2.0.9', platform: 'darwin', arch: 'arm64' })

    expect(request).not.toHaveBeenCalled()
  })

  it('extractStartupAnalyticsFromSummary extracts stages and metadata properly', () => {
    const summary: DesktopLifecycleSummary = {
      schemaVersion: 1,
      eventCount: 10,
      parseErrorCount: 0,
      finalOutcome: 'completed',
      finalStage: 'health-commit',
      rendererStatus: 'healthy',
      totalDurationMs: 1420.5,
      stages: [
        { stageId: 'electron-ready', status: 'completed', durationMs: 120 },
        { stageId: 'host-boot', status: 'completed', durationMs: 650 },
        { stageId: 'renderer-startup', status: 'completed', durationMs: 400 },
      ],
    }

    const data = extractStartupAnalyticsFromSummary(summary, {
      appVersion: '2.0.9',
      platform: 'darwin',
      arch: 'arm64',
    })

    expect(data).toEqual({
      appVersion: '2.0.9',
      platform: 'darwin',
      arch: 'arm64',
      finalStage: 'health-commit',
      rendererStatus: 'healthy',
      totalDurationMs: 1420.5,
      electronReadyMs: 120,
      shellEnvironmentMs: undefined,
      runtimeBootstrapMs: undefined,
      profileSelectionMs: undefined,
      profileCompositionMs: undefined,
      hostBootMs: 650,
      rendererStartupMs: 400,
      healthCommitMs: undefined,
      stages: {
        'electron-ready': 120,
        'host-boot': 650,
        'renderer-startup': 400,
      },
    })
  })
})
