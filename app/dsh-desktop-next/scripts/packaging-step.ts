/** Optional phase journal, following upstream Desktop's packaging-step.mjs event format. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Phase {
  readonly directory: string
  readonly stage: string
  readonly stageId: string
  readonly started: number
}

function record(phase: Phase, event: object): void {
  const arch = process.env.DSH_PACKAGING_ARCH
  appendFileSync(join(phase.directory, 'events.jsonl'), `${JSON.stringify({
    time: new Date().toISOString(), pid: process.pid, ...(arch === undefined ? {} : { arch }), stage: phase.stage, stageId: phase.stageId, ...event,
  })}\n`, { flush: true })
}

function start(stage: string): Phase | undefined {
  const directory = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  if (directory === undefined) return undefined
  mkdirSync(directory, { recursive: true })
  const phase = { directory, stage, stageId: randomUUID(), started: performance.now() }
  record(phase, { type: 'stage-start' })
  return phase
}

function end(phase: Phase, success: boolean): void {
  // Keep the journal credential-free: labels and outcomes only, never arguments, environments or errors.
  record(phase, { type: 'stage-end', elapsedMs: performance.now() - phase.started, success })
}

/** Measure synchronous work without changing the caller's return value or failure. */
export function packagingStepSync<T>(stage: string, action: () => T): T {
  const phase = start(stage)
  if (phase === undefined) return action()
  let result: T
  try { result = action() } catch (error) { end(phase, false); throw error }
  end(phase, true)
  return result
}

/** Measure asynchronous work through settlement; nested phases keep independent identifiers. */
export async function packagingStep<T>(stage: string, action: () => Promise<T>): Promise<T> {
  const phase = start(stage)
  if (phase === undefined) return action()
  let result: T
  try { result = await action() } catch (error) { end(phase, false); throw error }
  end(phase, true)
  return result
}

/** Cache counters are aggregated so journal I/O cannot dominate hot signing. */
export function packagingCacheSummary(stage: string, counts: { hits: number; misses: number; rejected: number; evicted: number }): void {
  const directory = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  if (directory === undefined) return
  mkdirSync(directory, { recursive: true })
  record({ directory, stage, stageId: randomUUID(), started: 0 }, {
    type: 'cache-summary', hits: counts.hits, misses: counts.misses, rejected: counts.rejected, evicted: counts.evicted,
  })
}

interface JournalEvent {
  readonly type: string
  readonly stage: string
  readonly stageId: string
  readonly arch?: string
  readonly elapsedMs?: number
  readonly success?: boolean
  readonly hits?: number
  readonly misses?: number
  readonly rejected?: number
  readonly evicted?: number
}

export function summarizePackagingJournal(file: string): object {
  const pending = new Map<string, JournalEvent>()
  const stages = new Map<string, { stage: string; arch?: string; completed: number; failed: number; elapsedMs: number }>()
  const caches: Array<{ stage: string; arch?: string; hits: number; misses: number; rejected: number; evicted: number }> = []
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []
  for (const line of lines) {
    if (line === '') continue
    const event = JSON.parse(line) as JournalEvent
    if (event.type === 'stage-start') pending.set(event.stageId, event)
    if (event.type === 'cache-summary') {
      caches.push({ stage: event.stage, arch: event.arch, hits: event.hits ?? 0, misses: event.misses ?? 0, rejected: event.rejected ?? 0, evicted: event.evicted ?? 0 })
    }
    if (event.type !== 'stage-end') continue
    pending.delete(event.stageId)
    const key = JSON.stringify([event.stage, event.arch])
    const summary = stages.get(key) ?? { stage: event.stage, arch: event.arch, completed: 0, failed: 0, elapsedMs: 0 }
    if (event.success === true) summary.completed++
    else summary.failed++
    summary.elapsedMs += event.elapsedMs ?? 0
    stages.set(key, summary)
  }
  return { stages: [...stages.values()], caches, incomplete: Array.from(pending.values(), ({ stage, arch }) => ({ stage, arch })) }
}
