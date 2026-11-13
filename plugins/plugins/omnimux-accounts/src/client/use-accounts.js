import { useCallback, useEffect, useRef, useState } from 'react'
import { disconnectAccount, listAccounts, patchAccount } from './api.js'

/** Connect-flow poll interval (ms). */
const WATCH_POLL_MS = 5000

/**
 * Session-lived list cache. Closing the first-level page used to unmount the
 * overlay (`return null`) and throw this hook away, so every sidebar click
 * restarted at `loading` and re-fetched. The page now stays mounted after the
 * first open; this module cache is the second net if the overlay itself is
 * remounted (slot rebuild / HMR).
 * @type {{ phase: 'loading' | 'ready' | 'need-login', accounts: Array<Record<string, unknown>> }}
 */
const sessionCache = { phase: 'loading', accounts: [] }

/**
 * Data hook for the Accounts app. Owns loading, the 401 → need-login phase
 * transition, optimistic metadata patches with rollback, disconnects, and
 * the connect-flow poller.
 * @returns {{
 *   phase: 'loading' | 'ready' | 'need-login',
 *   accounts: Array<Record<string, unknown>>,
 *   error: string,
 *   busy: string,
 *   refresh: () => Promise<boolean>,
 *   watchConnect: (platform: string, onChange: (row: Record<string, unknown> | null) => void) => () => void,
 *   patch: (id: string, body: { group?: string | null, agent_usable?: boolean }) => Promise<boolean>,
 *   disconnect: (id: string) => Promise<boolean>,
 * }}
 */
export function useAccounts() {
  const [phase, setPhase] = useState(sessionCache.phase)
  const [accounts, setAccounts] = useState(sessionCache.accounts)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const accountsRef = useRef(sessionCache.accounts)
  /** @type {import('react').MutableRefObject<{ stop: () => void } | null>} */
  const watchRef = useRef(null)

  /**
   * Single funnel for account-list mutations so the ref mirror (used for
   * optimistic rollback and connect baselines) can never drift from state.
   * @param {Array<Record<string, unknown>>} next
   */
  const commitAccounts = useCallback((next) => {
    const rows = Array.isArray(next) ? next : []
    accountsRef.current = rows
    sessionCache.accounts = rows
    setAccounts(rows)
  }, [])

  /**
   * @param {{ ok: boolean, status: number, body: unknown }} result
   */
  const applyListResult = useCallback((result) => {
    if (result.status === 401) {
      sessionCache.phase = 'need-login'
      setPhase('need-login')
      commitAccounts([])
      return true
    }
    if (!result.ok) {
      setError(String((result.body && typeof result.body === 'object' && result.body.error) || `HTTP ${String(result.status)}`))
      sessionCache.phase = 'ready'
      setPhase('ready')
      return true
    }
    const body = result.body && typeof result.body === 'object' ? /** @type {Record<string, unknown>} */ (result.body) : {}
    setError('')
    commitAccounts(Array.isArray(body.accounts) ? body.accounts : [])
    sessionCache.phase = 'ready'
    setPhase('ready')
    return true
  }, [commitAccounts])

  const refresh = useCallback(() => {
    return listAccounts().then(applyListResult).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
      sessionCache.phase = 'ready'
      setPhase('ready')
      return true
    })
  }, [applyListResult])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Stops the current connect-flow poll, if any. Idempotent.
   */
  const stopWatch = useCallback(() => {
    const watch = watchRef.current
    watchRef.current = null
    if (watch) watch.stop()
  }, [])

  /**
   * Connect-flow poller: every WATCH_POLL_MS the account list is re-fetched
   * and compared against the snapshot taken when the watch starts. A new id
   * (any platform) or a higher row count for the target platform means the
   * authorization landed: the poll stops and `onChange` receives the new row
   * (null when only a platform count increase was observed). Re-entering
   * stops the previous watch; the hook's unmount stops it too, so a stray
   * timer can never outlive the modal.
   * @param {string} platform
   * @param {(row: Record<string, unknown> | null) => void} onChange
   * @returns {() => void} stop
   */
  const watchConnect = useCallback((platform, onChange) => {
    stopWatch()
    const key = String(platform || '').toLowerCase()
    const baselineIds = new Set(accountsRef.current.map((row) => String(row.id)))
    const baselineCount = accountsRef.current
      .filter((row) => String(row.platform || '').toLowerCase() === key)
      .length
    let stopped = false
    /** @type {number | ReturnType<typeof setTimeout>} */
    let timer = 0

    const stop = () => {
      if (stopped) return
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      if (watchRef.current && watchRef.current.stop === stop) watchRef.current = null
    }
    watchRef.current = { stop }

    const poll = async () => {
      if (stopped) return
      try {
        const result = await listAccounts()
        if (stopped) return
        if (result.ok && result.status === 200) {
          const body = result.body && typeof result.body === 'object' ? /** @type {Record<string, unknown>} */ (result.body) : {}
          const rows = Array.isArray(body.accounts) ? body.accounts : []
          /** @type {Record<string, unknown> | null} */
          let fresh = null
          let count = 0
          for (const row of rows) {
            if (String(row.platform || '').toLowerCase() === key) count += 1
            const id = String(row.id)
            if (!baselineIds.has(id) && fresh === null) fresh = row
          }
          if (fresh !== null || count > baselineCount) {
            stop()
            onChange(fresh)
            return
          }
        }
      } catch {
        // transient fetch failure — keep polling until stopped
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, WATCH_POLL_MS)
    }

    timer = setTimeout(() => { void poll() }, WATCH_POLL_MS)
    return stop
  }, [stopWatch])

  // Unmount: stop any running poll so no timer leaks past the component.
  useEffect(() => () => { stopWatch() }, [stopWatch])

  /**
   * Optimistic metadata patch; rolls the row back and surfaces an error if
   * the Host rejects it.
   * @param {string} id
   * @param {{ group?: string | null, agent_usable?: boolean }} body
   */
  const patch = useCallback((id, body) => {
    const key = String(id)
    const previous = accountsRef.current
    const target = previous.find((row) => String(row.id) === key)
    if (!target) return Promise.resolve(false)
    const optimistic = { ...target }
    if ('group' in body) {
      if (body.group === null || body.group === '') delete optimistic.group
      else optimistic.group = body.group
    }
    if (typeof body.agent_usable === 'boolean') optimistic.agent_usable = body.agent_usable
    commitAccounts(previous.map((row) => (String(row.id) === key ? optimistic : row)))
    return patchAccount(key, body).then((result) => {
      if (result.status === 401) {
        sessionCache.phase = 'need-login'
        setPhase('need-login')
        return false
      }
      if (!result.ok) {
        commitAccounts(previous)
        setError(String((result.body && typeof result.body === 'object' && result.body.error) || `HTTP ${String(result.status)}`))
        return false
      }
      const raw = result.body && typeof result.body === 'object' ? /** @type {Record<string, unknown>} */ (result.body) : {}
      const bodyRow = raw.account && typeof raw.account === 'object' ? /** @type {Record<string, unknown>} */ (raw.account) : null
      if (bodyRow) {
        commitAccounts(accountsRef.current.map((row) => (String(row.id) === key ? bodyRow : row)))
      }
      return true
    }).catch((caught) => {
      commitAccounts(previous)
      setError(caught instanceof Error ? caught.message : String(caught))
      return false
    })
  }, [commitAccounts])

  /**
   * @param {string} id
   */
  const disconnect = useCallback((id) => {
    const key = String(id)
    setBusy(key)
    setError('')
    return disconnectAccount(key).then((result) => {
      if (result.status === 401) {
        sessionCache.phase = 'need-login'
        setPhase('need-login')
        return false
      }
      if (!result.ok) {
        setError(String((result.body && typeof result.body === 'object' && result.body.error) || `HTTP ${String(result.status)}`))
        return false
      }
      commitAccounts(accountsRef.current.filter((row) => String(row.id) !== key))
      return true
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
      return false
    }).finally(() => {
      setBusy('')
    })
  }, [commitAccounts])

  return { phase, accounts, error, busy, refresh, watchConnect, patch, disconnect }
}
