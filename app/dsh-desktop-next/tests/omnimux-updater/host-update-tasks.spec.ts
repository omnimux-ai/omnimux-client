import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { hasDesktopActiveTasks, installDesktopUpdateTaskControl } from '../../src/host/update-tasks.ts'

it('detects running agents, queued inbox turns/steps, and running/stopping jobs', () => {
  const emptyJobs = { list: () => [] } as unknown as Context['jobs']
  expect(hasDesktopActiveTasks([], emptyJobs)).toBe(false)
  expect(hasDesktopActiveTasks([
    { id: 'a1', status: 'idle', inbox: { nextTurn: [], nextStep: [] } },
  ] as unknown as ReturnType<Context['agents']['list']>, emptyJobs)).toBe(false)

  expect(hasDesktopActiveTasks([
    { id: 'a1', status: 'running', inbox: { nextTurn: [], nextStep: [] } },
  ] as unknown as ReturnType<Context['agents']['list']>, emptyJobs)).toBe(true)

  expect(hasDesktopActiveTasks([
    { id: 'a1', status: 'idle', inbox: { nextTurn: ['hello'], nextStep: [] } },
  ] as unknown as ReturnType<Context['agents']['list']>, emptyJobs)).toBe(true)

  const busyJobs = {
    list: (agentId?: string) => agentId === undefined ? [{ status: 'running' }] : [],
  } as unknown as Context['jobs']
  expect(hasDesktopActiveTasks([], busyJobs)).toBe(true)
})

it('locks new HTTP requests with 503, drains in-flight requests, and restores on unlock', async () => {
  type Handler = (req: unknown, res: { writeHead: (code: number) => void; end: () => void }, next: () => Promise<void>) => Promise<void>
  let requestHandler: Handler | undefined
  let disposeEffect: (() => void) | undefined
  let active = false
  const fakeCtx = {
    effect: (fn: () => () => void) => { disposeEffect = fn() },
    on: (event: string, fn: Handler) => { if (event === 'connection/request') requestHandler = fn },
    get: (name: string) => {
      if (name === 'agents') return { list: () => active ? [{ id: 'a1', status: 'running', inbox: { nextTurn: [], nextStep: [] } }] : [] }
      if (name === 'jobs') return { list: () => [] }
      return undefined
    },
  } as unknown as Context

  const control = installDesktopUpdateTaskControl(fakeCtx)
  expect(await control('inspect')).toBe(false)
  active = true
  expect(await control('inspect')).toBe(true)
  active = false

  // Start an in-flight request before lock()
  let finishInFlight!: () => void
  const inFlightNext = () => new Promise<void>(resolve => { finishInFlight = resolve })
  const res1 = { writeHead: vi.fn(), end: vi.fn() }
  const inFlight = requestHandler!({}, res1, inFlightNext)

  const lockPromise = control('lock')
  // While locked, new requests immediately get 503.
  const res2 = { writeHead: vi.fn(), end: vi.fn() }
  const next2 = vi.fn(async () => {})
  await requestHandler!({}, res2, next2)
  expect(res2.writeHead).toHaveBeenCalledWith(503)
  expect(res2.end).toHaveBeenCalledOnce()
  expect(next2).not.toHaveBeenCalled()

  // Complete in-flight request -> lock resolves.
  finishInFlight()
  await inFlight
  expect(await lockPromise).toBe(false)

  // Unlock re-admits requests.
  expect(await control('unlock')).toBe(false)
  const res3 = { writeHead: vi.fn(), end: vi.fn() }
  const next3 = vi.fn(async () => {})
  await requestHandler!({}, res3, next3)
  expect(next3).toHaveBeenCalledOnce()
  expect(res3.writeHead).not.toHaveBeenCalled()

  // After Host dispose, control throws.
  disposeEffect?.()
  await expect(control('inspect')).rejects.toThrow(/stopping/)
})

it('still locks HTTP /api admission and drains pending requests when agents or jobs service is absent', async () => {
  type Handler = (req: unknown, res: { writeHead: (code: number) => void; end: () => void }, next: () => Promise<void>) => Promise<void>
  let requestHandler: Handler | undefined
  const fakeCtx = {
    effect: () => {},
    on: (event: string, fn: Handler) => { if (event === 'connection/request') requestHandler = fn },
    get: () => undefined,
  } as unknown as Context

  const control = installDesktopUpdateTaskControl(fakeCtx)
  let releaseInFlight!: () => void
  const inFlight = requestHandler!({}, { writeHead: vi.fn(), end: vi.fn() }, () => new Promise<void>(r => { releaseInFlight = r }))

  let lockSettled = false
  const lockPromise = control('lock').then(result => { lockSettled = true; return result })

  const rejectedRes = { writeHead: vi.fn(), end: vi.fn() }
  const nextBlocked = vi.fn(async () => {})
  await requestHandler!({}, rejectedRes, nextBlocked)
  expect(rejectedRes.writeHead).toHaveBeenCalledWith(503)
  expect(nextBlocked).not.toHaveBeenCalled()
  expect(lockSettled).toBe(false)

  releaseInFlight()
  await inFlight
  expect(await lockPromise).toBe(false)
})
