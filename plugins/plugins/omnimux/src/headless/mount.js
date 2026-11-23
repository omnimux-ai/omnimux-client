import { createHeadlessJobManager } from './queue.js'
import { executeHeadlessSkill } from './execute.js'

/**
 * Mount the shared Hub `headlessSkill` seam (`ctx.provide('headlessSkill', api)`).
 *
 * Domain plugins consume this seam for background AI analysis, extraction, and
 * structured summarization instead of building private inference pipelines or
 * hijacking foreground chat sessions.
 *
 * @param {{
 *   provide?: (name: string, value: unknown) => void,
 *   get?: (name: string) => unknown,
 *   effect?: (factory: () => () => void, label?: string) => void,
 *   logger?: { warn?: (message: string, detail?: Record<string, unknown>) => void },
 * }} ctx
 * @param {{
 *   hubEvents?: { emit?: (event: { type: string, payload: Record<string, unknown> }) => unknown },
 *   textComplete?: { execute?: Function },
 *   skills?: { get?: Function },
 *   concurrency?: Partial<Record<'text' | 'image' | 'video', number>>,
 *   defaultTimeoutMs?: number,
 * }} [deps]
 */
export function mountHeadlessSkill(ctx, deps = {}) {
  const hubEvents = deps.hubEvents ?? ctx.get?.('hubEvents')
  const manager = createHeadlessJobManager({
    concurrency: deps.concurrency,
    hubEvents,
    logger: ctx.logger,
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => manager.dispose(), 'omnimux: headlessSkill manager')
  }

  const api = {
    run(request) {
      return executeHeadlessSkill(
        {
          skills: deps.skills ?? ctx.get?.('skills'),
          textComplete: deps.textComplete ?? ctx.get?.('textComplete'),
          manager,
          defaultTimeoutMs: deps.defaultTimeoutMs,
        },
        request,
      )
    },
    listJobs(filter) {
      return manager.listJobs(filter)
    },
    getJob(jobId) {
      return manager.getJob(jobId)
    },
    cancel(jobId, reason) {
      return manager.cancel(jobId, reason)
    },
  }

  if (typeof ctx.provide === 'function') {
    ctx.provide('headlessSkill', api)
  }

  return api
}
