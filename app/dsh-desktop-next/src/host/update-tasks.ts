/** Desktop update admission lock and active task inspection for the shared Web Host. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-client-connection'

/**
 * Whether stopping the Host now would interrupt user work: a running agent
 * (including subagents or turns awaiting approval), queued inbox turns/steps,
 * or a running/stopping background job.
 */
export function hasDesktopActiveTasks(liveAgents: ReturnType<Context['agents']['list']>, jobs: Context['jobs']): boolean {
  return liveAgents.some(agent => agent.status === 'running'
    || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
    || [undefined, ...liveAgents].some(agent => jobs.list(agent?.id)
      .some(job => job.status === 'running' || job.status === 'stopping'))
}

/**
 * Register update admission control on the booted Desktop Host context.
 * `lock` refuses new HTTP `/api` requests with 503, drains admitted requests, and
 * rechecks live tasks before allowing an update restart.
 */
export function installDesktopUpdateTaskControl(ctx: Context): (action: 'inspect' | 'lock' | 'unlock') => Promise<boolean> {
  let locked = false
  let lockGeneration = 0
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  const pendingRequests = new Set<Promise<void>>()
  ctx.on('connection/request', async (_request, response, next) => {
    if (locked) {
      response.writeHead(503)
      response.end()
      return
    }
    const finished = Promise.withResolvers<void>()
    pendingRequests.add(finished.promise)
    try { await next() }
    finally { pendingRequests.delete(finished.promise); finished.resolve() }
  })
  return async (action) => {
    if (stopped) throw new Error('desktop update: Host is stopping')
    if (action === 'unlock') { locked = false; lockGeneration += 1 }
    if (action === 'lock') {
      locked = true
      const generation = ++lockGeneration
      await Promise.all(pendingRequests)
      if (stopped) throw new Error('desktop update: Host is stopping')
      if (generation !== lockGeneration) throw new Error('desktop update: admission lock was superseded')
    }
    const agents = ctx.get('agents')
    const jobs = ctx.get('jobs')
    if (agents === undefined || jobs === undefined) return false
    return hasDesktopActiveTasks(agents.list(), jobs)
  }
}
