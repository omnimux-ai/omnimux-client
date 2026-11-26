import { randomUUID } from 'node:crypto'
import { subscriptionSpecFor } from './cli-credential-import.js'

const ACTIVE_STATUSES = new Set(['starting', 'awaiting_user', 'exchanging'])
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000
const RETAIN_SETTLED_MS = 5 * 60 * 1000
const INITIAL_WAIT_MS = 400
const CANCEL_WAIT_MS = 1000

function sanitizeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || 'OAuth sign-in failed')
  // Never echo bearer tokens, access/refresh tokens, or sk-* secrets into UI state.
  if (/(?:access_token|refresh_token|bearer\s+[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9_-]{8,})/i.test(raw)) {
    return 'OAuth 授权失败，请重试'
  }
  return raw.slice(0, 240)
}

function publicViewOf(attempt) {
  if (!attempt) return null
  return {
    attemptId: attempt.attemptId,
    agentId: attempt.agentId,
    providerId: attempt.providerId,
    mode: attempt.mode,
    status: attempt.status,
    notice: attempt.notice ? { ...attempt.notice } : null,
    pendingPrompt: attempt.pendingPrompt
      ? {
          promptId: attempt.pendingPrompt.promptId,
          kind: attempt.pendingPrompt.kind,
          message: attempt.pendingPrompt.message,
          ...(attempt.pendingPrompt.placeholder ? { placeholder: attempt.pendingPrompt.placeholder } : {}),
        }
      : null,
    connected: attempt.connected === true,
    models: [...attempt.models],
    defaultModel: attempt.defaultModel,
    ...(attempt.error ? { error: attempt.error } : {}),
  }
}

/**
 * Bridge DSH's Host-side `ctx.authorization.begin()` callback API into a bounded
 * per-agent state machine that OmniMux's React surfaces can drive over local HTTP
 * + `hubEvents`.
 *
 * @param {{
 *   getAuthorization: () => any,
 *   hubEvents?: { emit?: (event: object) => void },
 *   onAuthorized?: (info: { agentId: string, providerId: string, model: string, setAsDefault: boolean }) => Promise<{ ok: boolean, models?: string[], defaultModel?: string, error?: string }>,
 *   attemptTimeoutMs?: number,
 *   initialWaitMs?: number,
 *   retainSettledMs?: number,
 * }} deps
 */
export function createAgentOAuthManager(deps = {}) {
  const getAuthorization = typeof deps.getAuthorization === 'function' ? deps.getAuthorization : () => undefined
  const hubEvents = deps.hubEvents
  const onAuthorized = typeof deps.onAuthorized === 'function' ? deps.onAuthorized : async () => ({ ok: true, models: [], defaultModel: '' })
  const attemptTimeoutMs = Number.isFinite(deps.attemptTimeoutMs) ? deps.attemptTimeoutMs : ATTEMPT_TIMEOUT_MS
  const initialWaitMs = Number.isFinite(deps.initialWaitMs) ? deps.initialWaitMs : INITIAL_WAIT_MS
  const retainSettledMs = Number.isFinite(deps.retainSettledMs) ? deps.retainSettledMs : RETAIN_SETTLED_MS

  /** @type {Map<string, any>} */
  const byAttemptId = new Map()
  /** @type {Map<string, any>} */
  const latestByAgent = new Map()

  function emitUpdate(attempt) {
    try {
      hubEvents?.emit?.({ type: 'omnimux:agent-oauth:updated', payload: publicViewOf(attempt) })
    } catch (error) {
      console.warn('[omnimux] oauth hub event emit failed:', error instanceof Error ? error.message : String(error))
    }
  }

  function clearPrompt(attempt, rejectWith) {
    const pending = attempt.pendingPrompt
    if (!pending) return
    attempt.pendingPrompt = null
    if (pending.cleanupSignal) pending.cleanupSignal()
    if (rejectWith) pending.reject(rejectWith)
  }

  function scheduleCleanup(attempt) {
    if (attempt.timeoutTimer) {
      clearTimeout(attempt.timeoutTimer)
      attempt.timeoutTimer = null
    }
    if (attempt.cleanupTimer) clearTimeout(attempt.cleanupTimer)
    attempt.cleanupTimer = setTimeout(() => {
      byAttemptId.delete(attempt.attemptId)
      if (latestByAgent.get(attempt.agentId) === attempt) {
        latestByAgent.delete(attempt.agentId)
      }
    }, retainSettledMs)
    attempt.cleanupTimer.unref?.()
  }

  function notifyInitialReady(attempt) {
    if (attempt.resolveInitial) {
      const done = attempt.resolveInitial
      attempt.resolveInitial = null
      done()
    }
  }

  async function cancelAttempt(attempt) {
    if (!attempt || !ACTIVE_STATUSES.has(attempt.status)) return publicViewOf(attempt)
    attempt.cancelledByUser = true
    attempt.controller.abort()
    clearPrompt(attempt, Object.assign(new Error('OAuth cancelled'), { name: 'AbortError' }))
    try {
      getAuthorization()?.cancel?.(attempt.recordKey)
    } catch (error) {
      console.warn('[omnimux] oauth cancel propagation failed:', error instanceof Error ? error.message : String(error))
    }
    await Promise.race([
      attempt.settledPromise,
      new Promise((resolve) => setTimeout(resolve, CANCEL_WAIT_MS)),
    ])
    if (ACTIVE_STATUSES.has(attempt.status)) {
      attempt.status = 'cancelled'
      emitUpdate(attempt)
      scheduleCleanup(attempt)
    }
    return publicViewOf(attempt)
  }

  /**
   * Start an OAuth authorization attempt for one subscription agent.
   * @param {{ agentId: string, mode?: string, model?: string, setAsDefault?: boolean }} input
   */
  async function start(input) {
    const spec = subscriptionSpecFor(input?.agentId)
    if (!spec) return { ok: false, error: 'unsupported-agent' }

    const authorization = getAuthorization()
    if (!authorization || typeof authorization.begin !== 'function') {
      return { ok: false, error: 'authorization-unavailable' }
    }
    const flow = typeof authorization.describe === 'function'
      ? authorization.describe(spec.recordKey)
      : { methods: [{ id: 'oauth' }] }
    if (!flow || !Array.isArray(flow.methods) || !flow.methods.some((method) => method?.id === 'oauth')) {
      return { ok: false, error: 'oauth-flow-unavailable' }
    }

    const requestedMode = typeof input?.mode === 'string' && spec.oauthMethods.includes(input.mode)
      ? input.mode
      : spec.oauthMethods[0]
    const existing = latestByAgent.get(spec.agentId)
    if (existing && ACTIVE_STATUSES.has(existing.status)) {
      if (existing.mode === requestedMode) {
        return { ok: true, ...publicViewOf(existing) }
      }
      await cancelAttempt(existing)
    }

    const controller = new AbortController()
    let resolveInitial = null
    const initialReady = new Promise((resolve) => { resolveInitial = resolve })
    let resolveSettled = null
    const settledPromise = new Promise((resolve) => { resolveSettled = resolve })

    const attempt = {
      attemptId: randomUUID(),
      agentId: spec.agentId,
      providerId: spec.providerId,
      recordKey: spec.recordKey,
      mode: requestedMode,
      model: typeof input?.model === 'string' ? input.model.trim() : '',
      setAsDefault: input?.setAsDefault !== false,
      status: 'starting',
      notice: null,
      pendingPrompt: null,
      connected: false,
      models: [],
      defaultModel: '',
      error: '',
      cancelledByUser: false,
      controller,
      resolveInitial,
      settledPromise,
      timeoutTimer: null,
      cleanupTimer: null,
    }

    byAttemptId.set(attempt.attemptId, attempt)
    latestByAgent.set(spec.agentId, attempt)

    attempt.timeoutTimer = setTimeout(() => {
      if (!ACTIVE_STATUSES.has(attempt.status)) return
      attempt.error = 'OAuth 授权超时，请重试'
      attempt.controller.abort()
      clearPrompt(attempt, Object.assign(new Error('OAuth timed out'), { name: 'AbortError' }))
      try {
        getAuthorization()?.cancel?.(attempt.recordKey)
      } catch (error) {
        console.warn('[omnimux] oauth timeout cancel failed:', error instanceof Error ? error.message : String(error))
      }
    }, attemptTimeoutMs)
    attempt.timeoutTimer.unref?.()

    const interaction = {
      notify(notice) {
        if (!ACTIVE_STATUSES.has(attempt.status)) return
        const clean = {
          message: typeof notice?.message === 'string' ? notice.message : '',
          ...(typeof notice?.url === 'string' && /^https?:\/\//i.test(notice.url) ? { url: notice.url } : {}),
          ...(typeof notice?.code === 'string' && notice.code.trim() ? { code: notice.code.trim() } : {}),
        }
        attempt.notice = clean
        if (clean.url || clean.code) {
          attempt.status = 'awaiting_user'
          notifyInitialReady(attempt)
        }
        emitUpdate(attempt)
      },
      prompt(prompt) {
        if (!ACTIVE_STATUSES.has(attempt.status)) {
          return Promise.reject(Object.assign(new Error('attempt closed'), { name: 'AbortError' }))
        }
        // Automatically satisfy pi-ai's login-method selector using the mode the user clicked.
        if (prompt?.kind === 'select') {
          const options = Array.isArray(prompt.options) ? prompt.options : []
          const matched = options.find((opt) => opt?.id === attempt.mode)
            || options.find((opt) => opt?.id === spec.oauthMethods[0])
            || options[0]
          if (matched && typeof matched.id === 'string') {
            return Promise.resolve(matched.id)
          }
          return Promise.reject(new Error('no matching login method option'))
        }

        // Manual redirect URL / copy-code fallback prompt.
        return new Promise((resolve, reject) => {
          clearPrompt(attempt, Object.assign(new Error('prompt superseded'), { name: 'AbortError' }))
          const promptId = randomUUID()
          let cleanupSignal = null
          if (prompt?.signal) {
            const onAbort = () => {
              if (attempt.pendingPrompt?.promptId === promptId) {
                attempt.pendingPrompt = null
                emitUpdate(attempt)
              }
              // Non-declined abort error per DSH AuthorizationService contract:
              // lets the winning browser callback complete without treating withdrawal as refusal.
              reject(Object.assign(new Error('prompt withdrawn'), { name: 'AbortError' }))
            }
            if (prompt.signal.aborted) {
              onAbort()
              return
            }
            prompt.signal.addEventListener('abort', onAbort, { once: true })
            cleanupSignal = () => prompt.signal.removeEventListener('abort', onAbort)
          }
          attempt.pendingPrompt = {
            promptId,
            kind: prompt?.kind === 'secret' ? 'secret' : 'text',
            message: typeof prompt?.message === 'string' ? prompt.message : '',
            placeholder: typeof prompt?.placeholder === 'string' ? prompt.placeholder : '',
            resolve,
            reject,
            cleanupSignal,
          }
          attempt.status = 'awaiting_user'
          notifyInitialReady(attempt)
          emitUpdate(attempt)
        })
      },
    }

    ;(async () => {
      try {
        const outcome = await authorization.begin({
          key: spec.recordKey,
          method: 'oauth',
          interaction,
          signal: controller.signal,
        })
        clearPrompt(attempt, Object.assign(new Error('flow settled'), { name: 'AbortError' }))
        if (outcome?.status === 'authorized') {
          attempt.status = 'exchanging'
          emitUpdate(attempt)
          const activated = await onAuthorized({
            agentId: spec.agentId,
            providerId: spec.providerId,
            model: attempt.model,
            setAsDefault: attempt.setAsDefault,
          })
          if (!activated || activated.ok !== true) {
            attempt.status = 'failed'
            attempt.error = sanitizeErrorMessage(activated?.error || '路由激活失败')
          } else {
            attempt.status = 'authorized'
            attempt.connected = true
            attempt.models = Array.isArray(activated.models) ? activated.models : []
            attempt.defaultModel = typeof activated.defaultModel === 'string' ? activated.defaultModel : ''
          }
        } else {
          attempt.status = attempt.error ? 'failed' : 'cancelled'
        }
      } catch (error) {
        clearPrompt(attempt, Object.assign(new Error('flow failed'), { name: 'AbortError' }))
        if (attempt.cancelledByUser) {
          attempt.status = 'cancelled'
        } else {
          attempt.status = 'failed'
          attempt.error = attempt.error || sanitizeErrorMessage(error)
          console.warn('[omnimux] oauth flow failed:', attempt.agentId, attempt.error)
        }
      } finally {
        notifyInitialReady(attempt)
        emitUpdate(attempt)
        scheduleCleanup(attempt)
        resolveSettled?.()
      }
    })()

    await Promise.race([
      initialReady,
      new Promise((resolve) => setTimeout(resolve, initialWaitMs)),
    ])
    return { ok: true, ...publicViewOf(attempt) }
  }

  /** @param {{ attemptId?: string, agentId?: string }} query */
  function status(query = {}) {
    const byId = typeof query.attemptId === 'string' ? byAttemptId.get(query.attemptId.trim()) : null
    if (byId) return publicViewOf(byId)
    const byAgent = typeof query.agentId === 'string' ? latestByAgent.get(query.agentId.trim()) : null
    return publicViewOf(byAgent)
  }

  /** Submit a manual redirect URL / authorization code to the active prompt. */
  function submit({ attemptId, promptId, value }) {
    const attempt = typeof attemptId === 'string' ? byAttemptId.get(attemptId.trim()) : null
    if (!attempt || !ACTIVE_STATUSES.has(attempt.status)) {
      return { ok: false, error: 'attempt-not-found' }
    }
    const pending = attempt.pendingPrompt
    if (!pending || (promptId && pending.promptId !== promptId)) {
      return { ok: false, error: 'no-pending-prompt' }
    }
    const answer = typeof value === 'string' ? value.trim() : ''
    if (!answer) return { ok: false, error: 'empty-value' }

    attempt.pendingPrompt = null
    if (pending.cleanupSignal) pending.cleanupSignal()
    attempt.status = 'exchanging'
    emitUpdate(attempt)
    pending.resolve(answer)
    return { ok: true, ...publicViewOf(attempt) }
  }

  /** Cancel an in-flight OAuth attempt by attemptId or agentId. */
  async function cancel({ attemptId, agentId } = {}) {
    const attempt = (typeof attemptId === 'string' && byAttemptId.get(attemptId.trim()))
      || (typeof agentId === 'string' && latestByAgent.get(agentId.trim()))
      || null
    if (!attempt) return { ok: true, cancelled: false }
    const view = await cancelAttempt(attempt)
    return { ok: true, cancelled: true, ...view }
  }

  /** Cancel every active attempt on Host shutdown. */
  function dispose() {
    for (const attempt of byAttemptId.values()) {
      if (attempt.timeoutTimer) clearTimeout(attempt.timeoutTimer)
      if (attempt.cleanupTimer) clearTimeout(attempt.cleanupTimer)
      if (ACTIVE_STATUSES.has(attempt.status)) {
        attempt.cancelledByUser = true
        attempt.controller.abort()
        clearPrompt(attempt, Object.assign(new Error('disposed'), { name: 'AbortError' }))
        try {
          getAuthorization()?.cancel?.(attempt.recordKey)
        } catch (error) {
          console.warn('[omnimux] oauth dispose cancel failed:', error instanceof Error ? error.message : String(error))
        }
      }
    }
    byAttemptId.clear()
    latestByAgent.clear()
  }

  return { start, status, submit, cancel, dispose }
}
