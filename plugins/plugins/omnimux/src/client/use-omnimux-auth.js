import { useCallback, useEffect, useState } from 'react'
import { getStatus, logout, pollLogin, startLogin } from './api.js'

/**
 * @param {unknown} url
 */
export function openAuthUrl(url) {
  if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Reusable device-login flow controller, extracted so the unified gate
 * (`auth-gate.js`) can drive the same start → open → poll cycle that the
 * `useOmnimuxAuth` hook uses, without being a React hook. It is pure
 * orchestration: it reports phase transitions through `onState` and resolves
 * the login through `onSuccess(profile)`.
 *
 * @param {{
 *   onSuccess?: (profile: unknown) => void,
 *   onState?: (phase: 'starting' | 'waiting' | 'denied' | 'expired' | 'error', detail?: Record<string, unknown>) => void,
 * }} [opts]
 * @returns {{ start: () => void, stop: () => void, cancel: () => void }}
 */
export function runLogin(opts = {}) {
  const onSuccess = typeof opts.onSuccess === 'function' ? opts.onSuccess : () => {}
  const onState = typeof opts.onState === 'function' ? opts.onState : () => {}
  let timer = null
  let flowId = ''
  let cancelled = false

  function stop() {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  function schedulePoll(delaySec) {
    stop()
    const delay = Math.max(1, Number(delaySec) || 5) * 1000
    timer = window.setInterval(async () => {
      if (cancelled || flowId === '') return
      try {
        const result = await pollLogin(flowId)
        if (cancelled) return
        if (result.body?.logged_in) {
          onSuccess(result.body)
          stop()
          return
        }
        const kind = result.body?.kind
        if (kind === 'pending' || kind === 'slow_down') {
          if (result.body?.interval) schedulePoll(result.body.interval)
          return
        }
        // Any other kind / a 4xx is terminal.
        if (result.status === 403 || kind === 'denied') onState('denied', { detail: result.body?.error })
        else if (result.status === 410 || kind === 'expired') onState('expired', { detail: result.body?.error })
        else onState('error', { detail: result.body?.error || `HTTP ${String(result.status)}` })
        stop()
      } catch (error) {
        if (!cancelled) onState('error', { detail: error instanceof Error ? error.message : 'poll failed' })
        stop()
      }
    }, delay)
  }

  async function start() {
    if (cancelled) return
    onState('starting')
    try {
      const started = await startLogin()
      if (cancelled) return
      if (!started.ok || typeof started.body?.flow_id !== 'string' || !started.body.flow_id) {
        onState('error', { detail: started.body?.error || `HTTP ${String(started.status)}` })
        return
      }
      flowId = started.body.flow_id
      openAuthUrl(started.body.verification_url)
      onState('waiting', {
        flow_id: started.body.flow_id,
        user_code: started.body.user_code,
        verification_url: started.body.verification_url,
        interval: started.body.interval,
      })
      schedulePoll(started.body.interval)
    } catch (error) {
      if (!cancelled) onState('error', { detail: error instanceof Error ? error.message : 'login failed' })
    }
  }

  function cancel() {
    cancelled = true
    stop()
  }

  return { start, stop, cancel }
}

/**
 * Apply a status HTTP result to the local auth phase.
 * Live verify failures (non-401) must not force sign-out when a cached ready
 * profile is already on screen — that would flash "signed out" on transient
 * /self blips while the user still has a valid token.
 *
 * @param {{ ok?: boolean, status?: number, body?: any } | null | undefined} result
 * @param {{ hadReady?: boolean, verify?: boolean }} [opts]
 * @returns {'ready' | 'need-login' | 'keep'}
 */
export function decideAuthPhase(result, opts = {}) {
  const verify = opts.verify === true
  const hadReady = opts.hadReady === true
  const body = result && result.body
  if (body && body.logged_in === true) return 'ready'
  if (!verify) return 'need-login'
  // verify path: only a real token invalidation (or no prior ready row) signs out
  if (result && Number(result.status) === 401) return 'need-login'
  if (!hadReady) return 'need-login'
  return 'keep'
}

/**
 * Device-login session for Apps and Settings profile.
 * @param {{ verifyOnMount?: boolean }} [opts]
 */
export function useOmnimuxAuth(opts = {}) {
  const verifyOnMount = opts.verifyOnMount === true
  const [state, setState] = useState({ phase: 'checking' })

  useEffect(() => {
    let cancelled = false

    /**
     * Profile tab wants live quota: paint the disk/session cache first, then
     * hit `/self` via `verify=1` so each Settings → 个人资料 mount refreshes
     * balance without a full-page spinner or a false sign-out on network blips.
     */
    async function load() {
      if (!verifyOnMount) {
        try {
          const result = await getStatus(false)
          if (cancelled) return
          if (result.body?.logged_in) setState({ phase: 'ready', profile: result.body })
          else setState({ phase: 'need-login' })
        } catch {
          if (!cancelled) setState({ phase: 'need-login' })
        }
        return
      }

      let hadReady = false
      try {
        const cached = await getStatus(false)
        if (cancelled) return
        if (cached.body?.logged_in) {
          setState({ phase: 'ready', profile: cached.body })
          hadReady = true
        }
      } catch {
        // Host unreachable for the cache read; live verify is the next attempt.
      }

      try {
        const live = await getStatus(true)
        if (cancelled) return
        const decision = decideAuthPhase(live, { hadReady, verify: true })
        if (decision === 'ready') setState({ phase: 'ready', profile: live.body })
        else if (decision === 'need-login') setState({ phase: 'need-login' })
        // 'keep' → leave the cached ready row as-is
      } catch {
        if (!cancelled && !hadReady) setState({ phase: 'need-login' })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [verifyOnMount])

  useEffect(() => {
    if (state.phase !== 'waiting' || !state.flow_id) return undefined
    let cancelled = false
    const delay = Math.max(1, Number(state.interval) || 5) * 1000
    const timer = window.setInterval(() => {
      pollLogin(state.flow_id).then((result) => {
        if (cancelled) return
        if (result.body.logged_in) {
          setState({ phase: 'ready', profile: result.body })
          return
        }
        if (result.body.kind === 'pending' || result.body.kind === 'slow_down') {
          if (result.body.interval) setState((current) => ({ ...current, interval: result.body.interval }))
          return
        }
        if (result.status === 403 || result.body.kind === 'denied') setState({ phase: 'denied' })
        else if (result.status === 410 || result.body.kind === 'expired') setState({ phase: 'expired' })
        else setState({ phase: 'error', detail: result.body.error || `HTTP ${result.status}` })
      }).catch((error) => {
        if (!cancelled) setState({ phase: 'error', detail: error instanceof Error ? error.message : 'poll failed' })
      })
    }, delay)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.phase, state.flow_id, state.interval])

  async function beginLogin() {
    setState({ phase: 'starting' })
    try {
      const started = await startLogin()
      if (!started.ok || typeof started.body.flow_id !== 'string' || !started.body.flow_id) {
        setState({ phase: 'error', detail: started.body.error || `HTTP ${started.status}` })
        return
      }
      openAuthUrl(started.body.verification_url)
      setState({
        phase: 'waiting',
        flow_id: started.body.flow_id,
        user_code: started.body.user_code,
        verification_url: started.body.verification_url,
        interval: started.body.interval,
      })
    } catch (error) {
      setState({ phase: 'error', detail: error instanceof Error ? error.message : 'login failed' })
    }
  }

  function signOut() {
    return logout().then(() => {
      setState({ phase: 'need-login' })
    })
  }

  /**
   * Re-check profile status without remounting.
   * - Default `verify: false` keeps the gate resume path cheap.
   * - `verify: true` re-hits `/self` so quota/balance refresh after top-up or
   *   after the unified gate finishes a login the profile card did not own.
   * Kept stable so `useOmnimuxAuth` callers can depend on it.
   *
   * @param {{ verify?: boolean }} [opts]
   */
  const recheck = useCallback((opts = {}) => {
    const verify = opts.verify === true
    return getStatus(verify).then((result) => {
      if (result.body?.logged_in) {
        setState({ phase: 'ready', profile: result.body })
      } else if (decideAuthPhase(result, { hadReady: false, verify }) === 'need-login') {
        setState({ phase: 'need-login' })
      }
      return result
    }).catch(() => {
      if (!verify) setState({ phase: 'need-login' })
      return null
    })
  }, [])

  return { state, beginLogin, signOut, openUrl: openAuthUrl, recheck }
}
