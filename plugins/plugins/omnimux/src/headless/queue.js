import { randomUUID } from 'node:crypto'
import { OmnimuxError } from '../media/errors.js'

export const HEADLESS_SKILL_EVENT_TYPE = 'omnimux:headless-skill'

export const DEFAULT_CONCURRENCY = Object.freeze({
  video: 2,
  image: 4,
  text: 5,
})

const VALID_MODALITIES = new Set(['text', 'image', 'video'])
const DEFAULT_MAX_HISTORY = 100

/**
 * Infer concurrency lane from explicit modality or ordered media references.
 * @param {{ modality?: string, references?: Array<{ type?: string }> }} request
 * @returns {'text' | 'image' | 'video'}
 */
export function inferModality(request) {
  if (request?.modality !== undefined) {
    if (typeof request.modality !== 'string' || !VALID_MODALITIES.has(request.modality)) {
      throw new OmnimuxError(
        'headless-skill-invalid-request',
        `Unsupported modality "${String(request.modality)}"; expected text, image, or video`,
      )
    }
    return /** @type {'text' | 'image' | 'video'} */ (request.modality)
  }
  const refs = Array.isArray(request?.references) ? request.references : []
  if (refs.some((ref) => ref?.type === 'video')) return 'video'
  if (refs.some((ref) => ref?.type === 'image')) return 'image'
  return 'text'
}

/**
 * Build an idempotent deduplication key when caller supplies target identity and input fingerprint.
 * @param {{ ownerPlugin?: string, targetId?: string, skillName?: string, inputFingerprint?: string }} meta
 * @returns {string | null}
 */
export function buildDedupKey(meta) {
  if (!meta?.ownerPlugin || !meta?.targetId || !meta?.skillName || !meta?.inputFingerprint) {
    return null
  }
  return `${meta.ownerPlugin}::${meta.targetId}::${meta.skillName}::${meta.inputFingerprint}`
}

/**
 * Create a per-modality headless job scheduler with cancellation, dedup, and hubEvents broadcasting.
 * @param {{
 *   concurrency?: Partial<Record<'text' | 'image' | 'video', number>>,
 *   maxHistory?: number,
 *   hubEvents?: { emit?: (event: { type: string, payload: Record<string, unknown> }) => unknown },
 *   logger?: { warn?: (message: string, detail?: Record<string, unknown>) => void },
 * }} [options]
 */
export function createHeadlessJobManager(options = {}) {
  const limits = {
    video: Math.max(1, Number(options.concurrency?.video) || DEFAULT_CONCURRENCY.video),
    image: Math.max(1, Number(options.concurrency?.image) || DEFAULT_CONCURRENCY.image),
    text: Math.max(1, Number(options.concurrency?.text) || DEFAULT_CONCURRENCY.text),
  }
  const maxHistory = Math.max(10, Number(options.maxHistory) || DEFAULT_MAX_HISTORY)

  /** @type {Record<'text' | 'image' | 'video', number>} */
  const runningCount = { video: 0, image: 0, text: 0 }
  /** @type {Record<'text' | 'image' | 'video', Array<() => void>>} */
  const queues = { video: [], image: [], text: [] }
  /** @type {Map<string, any>} */
  const jobs = new Map()
  /** @type {Map<string, Promise<any>>} */
  const inflightByDedup = new Map()
  let disposed = false

  function snapshotOf(entry) {
    return Object.freeze({
      jobId: entry.jobId,
      ownerPlugin: entry.ownerPlugin,
      targetId: entry.targetId,
      label: entry.label,
      skillName: entry.skillName,
      modality: entry.modality,
      status: entry.status,
      stage: entry.stage,
      model: entry.model,
      inputFingerprint: entry.inputFingerprint,
      createdAt: entry.createdAt,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      errorCode: entry.errorCode,
      error: entry.error,
    })
  }

  function emitJob(entry) {
    const hubEvents = options.hubEvents
    if (!hubEvents || typeof hubEvents.emit !== 'function') return
    try {
      hubEvents.emit({ type: HEADLESS_SKILL_EVENT_TYPE, payload: snapshotOf(entry) })
    } catch (error) {
      options.logger?.warn?.('omnimux: headlessSkill event emit failed', {
        jobId: entry.jobId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function pruneHistory() {
    if (jobs.size <= maxHistory) return
    for (const [id, entry] of jobs) {
      if (jobs.size <= maxHistory) break
      if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'cancelled') {
        jobs.delete(id)
      }
    }
  }

  function pump(modality) {
    while (runningCount[modality] < limits[modality] && queues[modality].length > 0) {
      const next = queues[modality].shift()
      if (next) next()
    }
  }

  /**
   * Enqueue one headless execution with per-modality concurrency and lifecycle tracking.
   * @template T
   * @param {{
   *   skillName: string,
   *   modality: 'text' | 'image' | 'video',
   *   label?: string,
   *   ownerPlugin?: string,
   *   targetId?: string,
   *   inputFingerprint?: string,
   *   signal?: AbortSignal,
   * }} meta
   * @param {(handle: {
   *   jobId: string,
   *   signal: AbortSignal,
   *   update: (patch: { status?: string, stage?: string, model?: string }) => void,
   * }) => Promise<T>} runner
   * @returns {Promise<T>}
   */
  function enqueue(meta, runner) {
    if (disposed) {
      return Promise.reject(new OmnimuxError('headless-skill-cancelled', 'headlessSkill manager is disposed'))
    }

    const dedupKey = buildDedupKey(meta)
    if (dedupKey && inflightByDedup.has(dedupKey)) {
      return inflightByDedup.get(dedupKey)
    }

    const jobId = `hs_${randomUUID().slice(0, 12)}`
    const controller = new AbortController()
    const entry = {
      jobId,
      ownerPlugin: meta.ownerPlugin || '',
      targetId: meta.targetId || '',
      label: meta.label || meta.skillName,
      skillName: meta.skillName,
      modality: meta.modality,
      status: 'queued',
      stage: 'queued',
      model: '',
      inputFingerprint: meta.inputFingerprint || '',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      error: null,
      controller,
      cancelQueue: null,
    }

    jobs.set(jobId, entry)
    pruneHistory()
    emitJob(entry)

    const onExternalAbort = () => {
      cancel(jobId, 'caller aborted')
    }
    if (meta.signal) {
      if (meta.signal.aborted) {
        entry.status = 'cancelled'
        entry.stage = 'cancelled'
        entry.finishedAt = new Date().toISOString()
        entry.errorCode = 'headless-skill-cancelled'
        entry.error = 'Task cancelled before start'
        emitJob(entry)
        return Promise.reject(new OmnimuxError('headless-skill-cancelled', entry.error))
      }
      meta.signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    const promise = new Promise((resolve, reject) => {
      const start = () => {
        entry.cancelQueue = null
        if (controller.signal.aborted) {
          reject(new OmnimuxError('headless-skill-cancelled', entry.error || 'Task cancelled'))
          return
        }
        runningCount[meta.modality] += 1
        entry.status = 'running'
        entry.stage = 'running'
        entry.startedAt = new Date().toISOString()
        emitJob(entry)

        const update = (patch) => {
          if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'cancelled') return
          if (patch.status) entry.status = patch.status
          if (patch.stage) entry.stage = patch.stage
          if (patch.model) entry.model = patch.model
          emitJob(entry)
        }

        Promise.resolve()
          .then(() => runner({ jobId, signal: controller.signal, update }))
          .then((result) => {
            entry.status = 'done'
            entry.stage = 'done'
            if (result && typeof result === 'object' && typeof result.model === 'string' && result.model) {
              entry.model = result.model
            }
            entry.finishedAt = new Date().toISOString()
            emitJob(entry)
            resolve(result)
          })
          .catch((error) => {
            const isCancelled = controller.signal.aborted
              || (error instanceof OmnimuxError && error.code === 'headless-skill-cancelled')
              || error?.name === 'AbortError'
              || error?.code === 'ABORT_ERR'
            const finalError = isCancelled && !(error instanceof OmnimuxError)
              ? new OmnimuxError('headless-skill-cancelled', entry.error || 'Task cancelled')
              : error
            entry.status = isCancelled ? 'cancelled' : 'failed'
            entry.stage = entry.status
            entry.finishedAt = new Date().toISOString()
            entry.errorCode = finalError instanceof OmnimuxError ? finalError.code : 'headless-skill-failed'
            entry.error = finalError instanceof Error ? finalError.message : String(finalError)
            emitJob(entry)
            reject(finalError)
          })
          .finally(() => {
            runningCount[meta.modality] = Math.max(0, runningCount[meta.modality] - 1)
            meta.signal?.removeEventListener('abort', onExternalAbort)
            if (dedupKey && inflightByDedup.get(dedupKey) === promise) {
              inflightByDedup.delete(dedupKey)
            }
            pump(meta.modality)
          })
      }

      entry.cancelQueue = (reason) => {
        const idx = queues[meta.modality].indexOf(start)
        if (idx !== -1) queues[meta.modality].splice(idx, 1)
        entry.cancelQueue = null
        entry.status = 'cancelled'
        entry.stage = 'cancelled'
        entry.finishedAt = new Date().toISOString()
        entry.errorCode = 'headless-skill-cancelled'
        entry.error = reason || 'Task cancelled'
        emitJob(entry)
        meta.signal?.removeEventListener('abort', onExternalAbort)
        if (dedupKey && inflightByDedup.get(dedupKey) === promise) {
          inflightByDedup.delete(dedupKey)
        }
        reject(new OmnimuxError('headless-skill-cancelled', entry.error))
      }

      queues[meta.modality].push(start)
      pump(meta.modality)
    })

    if (dedupKey) {
      inflightByDedup.set(dedupKey, promise)
    }
    return promise
  }

  /**
   * Cancel a queued or running headless job.
   * @param {string} jobId
   * @param {string} [reason]
   * @returns {boolean}
   */
  function cancel(jobId, reason = 'Task cancelled') {
    const entry = jobs.get(jobId)
    if (!entry) return false
    if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'cancelled') return false
    entry.error = reason
    if (typeof entry.cancelQueue === 'function') {
      entry.cancelQueue(reason)
      return true
    }
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new OmnimuxError('headless-skill-cancelled', reason))
    }
    return true
  }

  /**
   * @param {{ ownerPlugin?: string, targetId?: string, status?: string }} [filter]
   */
  function listJobs(filter = {}) {
    const result = []
    for (const entry of jobs.values()) {
      if (filter.ownerPlugin && entry.ownerPlugin !== filter.ownerPlugin) continue
      if (filter.targetId && entry.targetId !== filter.targetId) continue
      if (filter.status && entry.status !== filter.status) continue
      result.push(snapshotOf(entry))
    }
    return result.reverse()
  }

  function getJob(jobId) {
    const entry = jobs.get(jobId)
    return entry ? snapshotOf(entry) : null
  }

  function dispose() {
    disposed = true
    for (const entry of jobs.values()) {
      if (entry.status === 'queued' || entry.status === 'running' || entry.status === 'repairing') {
        cancel(entry.jobId, 'headlessSkill service disposed')
      }
    }
    inflightByDedup.clear()
  }

  return {
    enqueue,
    cancel,
    listJobs,
    getJob,
    dispose,
    limits: Object.freeze({ ...limits }),
  }
}
