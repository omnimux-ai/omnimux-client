import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getOrCreateDesktopInstallationId } from '../../dsh-plugin-desktop/src/desktop-installation-id.ts'
import { DesktopLaunchAnalytics } from '../src/desktop-launch-analytics.ts'
import { DesktopDiagnostics } from '../src/diagnostics.ts'
import { NextProfiles } from '../src/profiles.ts'
import { NextRecovery } from '../src/recovery.ts'

const ENDPOINT = 'http://localhost:8077/api/send'
const WEBSITE_ID = '11111111-2222-4333-8444-555555555555'
const ENVIRONMENT = {
  OMNIMUX_ANALYTICS_ENDPOINT: ENDPOINT,
  OMNIMUX_ANALYTICS_WEBSITE_ID: WEBSITE_ID,
}
let root: string

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'next-launch-analytics-')) })
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

function launch(overrides: Partial<ConstructorParameters<typeof DesktopLaunchAnalytics>[0]> = {}) {
  const request = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }))
  const record = vi.fn()
  const analytics = new DesktopLaunchAnalytics({
    identityDirectory: join(root, 'install'),
    previousUserData: [],
    hadPreviousRun: false,
    appVersion: '2.0.24',
    platform: 'darwin',
    systemVersion: () => '26.0.1',
    environment: ENVIRONMENT,
    request,
    record,
    ...overrides,
  })
  return { analytics, request, record }
}

it('counts an installation once across application launches and version upgrades', async () => {
  const initial = launch()
  expect(initial.request).not.toHaveBeenCalled()
  await Promise.all([initial.analytics.reportReady(), initial.analytics.reportReady()])
  expect(initial.request).toHaveBeenCalledTimes(1)
  const [endpoint, request] = initial.request.mock.calls[0]!
  const first = JSON.parse(request.body as string)
  const id = first.payload.data.device_id
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  expect(endpoint).toBe(ENDPOINT)
  expect(request).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' })
  expect(first).toEqual({
    type: 'event',
    payload: {
      website: WEBSITE_ID,
      hostname: 'omnimux-desktop',
      url: 'omnimux://desktop',
      name: 'desktop_app_launch',
      data: { is_first_launch: true, app_version: '2.0.24', os: 'darwin', os_version: '26.0.1', device_id: id },
    },
  })

  for (const version of ['2.0.24', '2.0.25']) {
    const subsequent = launch({ appVersion: version })
    await subsequent.analytics.reportReady()
    expect(JSON.parse(subsequent.request.mock.calls[0]![1].body as string).payload.data).toEqual({
      is_first_launch: false, app_version: version, os: 'darwin', os_version: '26.0.1', device_id: id,
    })
  }
})

it('inherits an existing Next updater UUID before the older shell UUID', async () => {
  const nextUserData = join(root, 'electron-user-data')
  const legacyUserData = join(root, 'legacy')
  const nextId = await getOrCreateDesktopInstallationId(nextUserData)
  const legacyId = await getOrCreateDesktopInstallationId(legacyUserData)
  expect(nextId).not.toBe(legacyId)
  const next = launch({ previousUserData: [nextUserData, legacyUserData] })
  await next.analytics.reportReady()
  expect(JSON.parse(next.request.mock.calls[0]![1].body as string).payload.data).toMatchObject({
    device_id: nextId, is_first_launch: false,
  })
  const legacy = launch({ identityDirectory: join(root, 'other-install'), previousUserData: [join(root, 'absent'), legacyUserData] })
  await legacy.analytics.reportReady()
  expect(JSON.parse(legacy.request.mock.calls[0]![1].body as string).payload.data).toMatchObject({
    device_id: legacyId, is_first_launch: false,
  })
})

it('uses the previous Next run marker to recognize installs without an updater UUID', async () => {
  const previous = new DesktopDiagnostics(root)
  expect(previous.begin({})).toBe(false)
  previous.end(true)
  const candidate = new DesktopDiagnostics(root)
  const hadPreviousRun = candidate.begin({})
  expect(hadPreviousRun).toBe(true)
  candidate.end(true)
  const upgraded = launch({ hadPreviousRun })
  await upgraded.analytics.reportReady()
  expect(JSON.parse(upgraded.request.mock.calls[0]![1].body as string).payload.data.is_first_launch).toBe(false)
})

it('retains the installation identity after resetting the application home', async () => {
  const identityDirectory = join(root, 'electron-user-data', 'launch-analytics')
  const initial = launch({ identityDirectory })
  await initial.analytics.reportReady()
  const id = JSON.parse(initial.request.mock.calls[0]![1].body as string).payload.data.device_id
  new NextRecovery(new NextProfiles(root)).factoryReset()
  const reset = launch({ identityDirectory })
  await reset.analytics.reportReady()
  expect(JSON.parse(reset.request.mock.calls[0]![1].body as string).payload.data).toMatchObject({
    device_id: id, is_first_launch: false,
  })
})

it.each(['1', 'true'])('disables the configured collector when the opt-out is %s', async value => {
  const disabled = launch({ environment: { ...ENVIRONMENT, OMNIMUX_ANALYTICS_DISABLED: value } })
  await disabled.analytics.reportReady()
  expect(disabled.request).not.toHaveBeenCalled()
  const persisted = join(root, 'install', 'identity', 'installation-id')
  await vi.waitFor(() => access(persisted))
  const enabled = launch()
  await enabled.analytics.reportReady()
  expect(JSON.parse(enabled.request.mock.calls[0]![1].body as string).payload.data.is_first_launch).toBe(false)
})

it.each([{}, { OMNIMUX_ANALYTICS_ENDPOINT: ENDPOINT }, { OMNIMUX_ANALYTICS_WEBSITE_ID: WEBSITE_ID }])(
  'requires both collector settings and never falls back to a built-in site (%j)',
  async environment => {
    const { analytics, request } = launch({ environment })
    await analytics.reportReady()
    expect(request).not.toHaveBeenCalled()
    await vi.waitFor(() => access(join(root, 'install', 'identity', 'installation-id')))
  },
)

it('aborts a stalled request at 3 seconds and does not try again when the same window is ready', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  let enteredRequest!: () => void
  const entered = new Promise<void>(resolve => { enteredRequest = resolve })
  const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal!
    signal.addEventListener('abort', () => reject(signal!.reason), { once: true })
    enteredRequest()
  }))
  const { analytics, record } = launch({ request })
  const completion = analytics.reportReady()
  await entered
  await vi.advanceTimersByTimeAsync(2_999)
  expect(signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await completion
  await analytics.reportReady()
  expect(signal?.aborted).toBe(true)
  expect(request).toHaveBeenCalledTimes(1)
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({
    event: 'analytics.launch.failed', level: 'warn', fields: expect.objectContaining({ reason: 'timeout' }),
  }))
})

it.each(['network', 'http'])('logs %s failures without leaking request data or backfilling first launch', async reason => {
  const request = vi.fn(async () => {
    if (reason === 'network') throw new Error('sensitive endpoint details')
    return new Response(null, { status: 503 })
  })
  const offline = launch({ request })
  await offline.analytics.reportReady()
  await offline.analytics.reportReady()
  expect(request).toHaveBeenCalledTimes(1)
  expect(offline.record).toHaveBeenLastCalledWith({
    source: 'desktop', event: 'analytics.launch.failed', level: 'warn',
    fields: { reason, durationMs: expect.any(Number), ...(reason === 'http' ? { status: 503 } : {}) },
  })
  const later = launch()
  await later.analytics.reportReady()
  expect(JSON.parse(later.request.mock.calls[0]![1].body as string).payload.data.is_first_launch).toBe(false)
})
