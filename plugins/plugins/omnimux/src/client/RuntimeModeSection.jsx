import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, DropdownSelect, InputField } from 'dsh-ui-kit'
import { openAuthUrl, useOmnimuxAuth } from './use-omnimux-auth.js'
import { ScenarioSelection } from './ScenarioSelection.jsx'
import { ProviderConfigPanel } from './ProviderConfigPanel.jsx'
import { AgentBrandIcon } from './agent-brand-icons.jsx'
import {
  agentCardSubtitle,
  agentConnectionBadge,
  agentModelSource,
  agentScanUrl,
  agentUpdatesUrl,
  canImportCliAuth,
  countInstalledAgents,
  isAgentSelectable,
  shouldAutoRefresh,
} from './agent-live-view.js'

const ACTIVE_OAUTH_STATUSES = new Set(['starting', 'awaiting_user', 'exchanging'])

async function api(path, init) {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
  }
  return body
}

function formatAgentError(t, errorOrCode) {
  const code = errorOrCode instanceof Error ? errorOrCode.message : String(errorOrCode || '')
  switch (code) {
    case 'api-key-route-exists':
      return t('runtime.apiKeyRouteConflict')
    case 'keyring-or-external':
      return t('runtime.cliImportKeyringHint')
    case 'api-key-mode':
      return t('runtime.cliImportApiKeyHint')
    case 'expired':
      return t('runtime.cliImportExpired')
    case 'missing':
      return t('runtime.cliImportMissing')
    case 'credentials-unavailable':
      return t('runtime.credentialsUnavailable')
    case 'authorization-unavailable':
    case 'oauth-flow-unavailable':
      return t('runtime.oauthUnavailable')
    default:
      return code || t('runtime.error')
  }
}

function oauthMethodLabel(t, method, preferAltBrowser) {
  if (method === 'device_code' || method === 'device') return t('runtime.oauthDeviceCta')
  if (method === 'copy_code' || method === 'manual_code') return t('runtime.oauthManualCta')
  return preferAltBrowser ? t('runtime.oauthBrowserAltCta') : t('runtime.oauthBrowserCta')
}

/**
 * Re-architected OmniMux Models and Media Providers Section.
 * Dual-tab coexistence (Local CLI for text + Media Generation Providers),
 * topped with OmniMux Cloud status banner and grounded with global readiness indicator.
 *
 * @param {{
 *   t: (key: string, params?: Record<string, string>) => string,
 *   scope?: {
 *     getSnapshot: () => object,
 *     subscribe: (listener: () => void) => () => void,
 *     set: (field: string, value: unknown) => Promise<void>,
 *   },
 * }} props
 */
export function RuntimeModeSection({ t, scope }) {
  const snapshot = useSyncExternalStore(
    (listener) => {
      if (!scope || typeof scope.subscribe !== 'function') return () => {}
      return scope.subscribe(listener)
    },
    () => (scope && typeof scope.getSnapshot === 'function'
      ? scope.getSnapshot()
      : { status: 'unavailable', value: undefined, writable: false }),
  )
  const value = snapshot && typeof snapshot.value === 'object' && snapshot.value ? snapshot.value : {}

  const [activeTab, setActiveTab] = useState('cli')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Official Cloud Auth integration via standard useOmnimuxAuth hook
  const auth = useOmnimuxAuth({ t })
  const cloudLogged = auth.state.phase === 'ready'
  const cloudUser = auth.state.profile?.display_name || auth.state.profile?.username || ''

  let bannerDesc = t('runtime.cloudHint')
  if (cloudLogged) {
    bannerDesc = cloudUser ? `${cloudUser} - ${t('runtime.cloudLoggedHint')}` : t('runtime.cloudLoggedHint')
  }

  const handleCloudAction = useCallback(() => {
    if (cloudLogged) {
      void auth.signOut()
    } else {
      void auth.beginLogin()
    }
  }, [cloudLogged, auth])

  return (
    <div className="omx-runtime-section">
      <div className={`omx-cloud-banner ${cloudLogged ? 'logged' : ''}`}>
        <div className="omx-banner-content">
          <strong>{cloudLogged ? t('runtime.cloudLoggedTitle') : t('runtime.cloudTitle')}</strong>
          <p>{bannerDesc}</p>
        </div>
        <Button variant="secondary" className="omx-banner-btn" onClick={handleCloudAction}>
          {cloudLogged ? t('runtime.logout') : t('runtime.loginOrRegister')}
        </Button>
      </div>

      <ScenarioSelection t={t} scope={scope} value={value} busy={busy} setBusy={setBusy} setError={setError} />
      <div className="omx-segmented-tabs" role="tablist">
        <Button
          variant="ghost"
          role="tab"
          aria-selected={activeTab === 'cli'}
          disabled={busy}
          className={`omx-tab-btn ${activeTab === 'cli' ? 'active' : ''}`}
          onClick={() => { setActiveTab('cli'); setError(''); setNotice('') }}
        >
          {t('runtime.tabCli')}
        </Button>
        <Button
          variant="ghost"
          role="tab"
          aria-selected={activeTab === 'media'}
          disabled={busy}
          className={`omx-tab-btn ${activeTab === 'media' ? 'active' : ''}`}
          onClick={() => { setActiveTab('media'); setError(''); setNotice('') }}
        >
          {t('runtime.tabMedia')}
        </Button>
      </div>

      <div hidden={activeTab !== 'cli'}>
        <AgentPanel
          t={t}
          scope={scope}
          value={value}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          notice={notice}
          setNotice={setNotice}
          active={activeTab === 'cli'}
        />
      </div>

      <div hidden={activeTab !== 'media'}>
        <ProviderConfigPanel
          t={t}
          scope={scope}
          value={value}
          busy={busy}
          setBusy={setBusy}
          error={error}
          setError={setError}
          notice={notice}
          setNotice={setNotice}
        />
      </div>

      {error ? <p className="omnimux-models-card__error" role="status">{error}</p> : null}
      {notice ? <p className="omnimux-models-card__desc" role="status">{notice}</p> : null}
    </div>
  )
}

/**
 * CLI Agents discovery and detail configuration panel
 */
function AgentPanel({ t, scope, value, busy, setBusy, error, setError, notice, setNotice, onVerified, active, showEmptyState = false }) {
  const [agents, setAgents] = useState([])
  const [selectedAgent, setSelectedAgent] = useState(value.runtimeAgentId || '')
  const initialAgentModel = typeof value.runtimeAgentModel === 'string'
    ? value.runtimeAgentModel
    : ''
  const [agentModel, setAgentModel] = useState(initialAgentModel)
  const [testedId, setTestedId] = useState('')
  const [updates, setUpdates] = useState({})
  const [updatingId, setUpdatingId] = useState('')
  const [importingId, setImportingId] = useState('')
  const [disconnectingId, setDisconnectingId] = useState('')
  const [oauthAttempt, setOAuthAttempt] = useState(null)
  const [manualInput, setManualInput] = useState('')
  const [submittingManual, setSubmittingManual] = useState(false)
  const [copiedKind, setCopiedKind] = useState('')
  const lastAutoRefreshRef = useRef(0)
  const oauthPollRef = useRef(null)
  const openedUrlsRef = useRef(new Set())
  const aliveRef = useRef(true)

  const stopOAuthPoll = useCallback(() => {
    if (oauthPollRef.current !== null) {
      clearInterval(oauthPollRef.current)
      oauthPollRef.current = null
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      stopOAuthPoll()
    }
  }, [stopOAuthPoll])

  const openAttemptUrlOnce = useCallback((attempt) => {
    const url = attempt?.notice?.url
    if (!url || !attempt?.attemptId) return
    const key = `${attempt.attemptId}:${url}`
    if (openedUrlsRef.current.has(key)) return
    openedUrlsRef.current.add(key)
    openAuthUrl(url)
  }, [])

  const refreshAgents = useCallback(async (options = {}) => {
    try {
      const data = await api(agentScanUrl(options.refresh === true))
      if (!aliveRef.current) return []
      if (Array.isArray(data.agents)) {
        setAgents(data.agents)
        return data.agents
      }
    } catch {
      // best-effort
    }
    return []
  }, [])

  const refreshUpdates = useCallback(async (options = {}) => {
    try {
      const data = await api(agentUpdatesUrl(options.refresh === true))
      if (aliveRef.current && data && data.updates && typeof data.updates === 'object') {
        setUpdates(data.updates)
      }
    } catch {
      // best-effort：版本检查不可用时不得渲染任何版本状态
    }
  }, [])

  useEffect(() => {
    // The mount read counts as this panel's first refresh, so becoming the
    // visible tab right afterwards must not scan a second time.
    lastAutoRefreshRef.current = Date.now()
    void refreshAgents().then(() => refreshUpdates())
  }, [refreshAgents, refreshUpdates])

  /**
   * Re-read the panel after the user comes back to it. A scan costs a few
   * local process calls, so repeated focus events stay inside one 30s window
   * and a hidden document never triggers it.
   */
  const autoRefresh = useCallback(() => {
    const visibility = typeof document === 'undefined' ? 'visible' : document.visibilityState
    if (!shouldAutoRefresh(lastAutoRefreshRef.current, Date.now(), visibility)) return
    lastAutoRefreshRef.current = Date.now()
    void refreshAgents().then(() => refreshUpdates())
  }, [refreshAgents, refreshUpdates])

  useEffect(() => {
    if (active !== true) return
    autoRefresh()
  }, [active, autoRefresh])

  useEffect(() => {
    if (active !== true || typeof window === 'undefined') return undefined
    const onFocus = () => autoRefresh()
    const onVisibility = () => { if (document.visibilityState === 'visible') autoRefresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener?.('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener?.('visibilitychange', onVisibility)
    }
  }, [active, autoRefresh])

  // Hydrate an in-flight OAuth attempt when reopening settings for the selected agent.
  useEffect(() => {
    if (!selectedAgent) return
    const row = agents.find((item) => item && item.id === selectedAgent)
    const activeAttempt = row?.subscription?.activeOAuth
    if (activeAttempt && ACTIVE_OAUTH_STATUSES.has(activeAttempt.status)) {
      setOAuthAttempt((prev) => (prev && prev.attemptId === activeAttempt.attemptId ? prev : activeAttempt))
    }
  }, [agents, selectedAgent])

  const settleAuthorized = useCallback(async (agentId) => {
    if (typeof onVerified === 'function') {
      // Fire before any readback: saving binds runtimeAgentId and closes onboarding.
      onVerified(agentId)
    }
    if (scope && typeof scope.adoptRevision === 'function') {
      try {
        await scope.adoptRevision()
      } catch (err) {
        console.warn('[omnimux] adoptRevision failed after subscription auth:', err instanceof Error ? err.message : String(err))
      }
    }
    await refreshAgents({ refresh: true })
  }, [onVerified, refreshAgents, scope])

  // Poll OAuth status while an authorization attempt is active.
  useEffect(() => {
    stopOAuthPoll()
    if (!oauthAttempt || !oauthAttempt.attemptId || !ACTIVE_OAUTH_STATUSES.has(oauthAttempt.status)) {
      return undefined
    }
    let inFlight = false
    const attemptId = oauthAttempt.attemptId
    oauthPollRef.current = setInterval(() => {
      if (inFlight || !aliveRef.current) return
      inFlight = true
      api(`/omnimux/agents/oauth/status?attemptId=${encodeURIComponent(attemptId)}`).then((data) => {
        inFlight = false
        if (!aliveRef.current) return
        const next = data && data.attempt ? data.attempt : null
        if (!next) {
          stopOAuthPoll()
          setOAuthAttempt(null)
          return
        }
        openAttemptUrlOnce(next)
        if (next.status === 'authorized') {
          stopOAuthPoll()
          setOAuthAttempt(null)
          setManualInput('')
          setError('')
          setNotice('')
          void settleAuthorized(next.agentId)
          return
        }
        if (next.status === 'failed') {
          stopOAuthPoll()
          setOAuthAttempt(null)
          setError(formatAgentError(t, next.error || t('runtime.oauthFailed')))
          return
        }
        if (next.status === 'cancelled') {
          stopOAuthPoll()
          setOAuthAttempt(null)
          return
        }
        setOAuthAttempt(next)
      }).catch((err) => {
        inFlight = false
        console.warn('[omnimux] oauth status poll failed:', err instanceof Error ? err.message : String(err))
      })
    }, 1200)
    return () => stopOAuthPoll()
  }, [oauthAttempt?.attemptId, oauthAttempt?.status, openAttemptUrlOnce, setError, setNotice, settleAuthorized, stopOAuthPoll, t])

  const scanNow = useCallback(() => {
    void refreshAgents({ refresh: true }).then(() => refreshUpdates({ refresh: true }))
  }, [refreshAgents, refreshUpdates])

  const waitForSignedIn = async (id) => {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      try {
        const data = await api('/omnimux/agents')
        const list = Array.isArray(data.agents) ? data.agents : []
        setAgents(list)
        const row = list.find((item) => item && item.id === id)
        if (row && row.auth && row.auth.state === 'signed-in') return true
      } catch {
        // Poll best-effort; a transient scan failure must not abort login.
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    return false
  }

  const importCliAuth = async (target) => {
    if (busy || importingId || !target) return
    setImportingId(target.id)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api('/omnimux/agents/import-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: target.id,
          ...(agentModel ? { model: agentModel } : {}),
        }),
      })
      if (!res || res.ok !== true) {
        throw new Error((res && res.error) || t('runtime.cliImportMissing'))
      }
      await settleAuthorized(target.id)
    } catch (err) {
      console.warn('[omnimux] cli auth import failed:', err instanceof Error ? err.message : String(err))
      if (aliveRef.current) setError(formatAgentError(t, err))
    } finally {
      if (aliveRef.current) {
        setImportingId('')
        setBusy(false)
      }
    }
  }

  const startOAuth = async (target, mode) => {
    if (busy || !target) return
    setError('')
    setNotice('')
    setManualInput('')
    try {
      const res = await api('/omnimux/agents/oauth/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: target.id,
          ...(mode ? { mode } : {}),
          ...(agentModel ? { model: agentModel } : {}),
        }),
      })
      if (!res || res.ok !== true) {
        throw new Error((res && res.error) || t('runtime.oauthFailed'))
      }
      openAttemptUrlOnce(res)
      if (res.status === 'authorized') {
        setOAuthAttempt(null)
        await settleAuthorized(target.id)
        return
      }
      if (res.status === 'failed') {
        setOAuthAttempt(null)
        setError(formatAgentError(t, res.error || t('runtime.oauthFailed')))
        return
      }
      setOAuthAttempt(res)
    } catch (err) {
      console.warn('[omnimux] oauth start failed:', err instanceof Error ? err.message : String(err))
      if (aliveRef.current) setError(formatAgentError(t, err))
    }
  }

  const submitOAuthPrompt = async () => {
    if (!oauthAttempt?.attemptId || !oauthAttempt?.pendingPrompt?.promptId || submittingManual) return
    const trimmed = manualInput.trim()
    if (!trimmed) return
    setSubmittingManual(true)
    setError('')
    try {
      const res = await api('/omnimux/agents/oauth/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attemptId: oauthAttempt.attemptId,
          promptId: oauthAttempt.pendingPrompt.promptId,
          value: trimmed,
        }),
      })
      if (!res || res.ok !== true) {
        throw new Error((res && res.error) || t('runtime.oauthFailed'))
      }
      setManualInput('')
      if (res.status === 'authorized') {
        stopOAuthPoll()
        setOAuthAttempt(null)
        await settleAuthorized(res.agentId || oauthAttempt.agentId)
      } else {
        setOAuthAttempt(res)
      }
    } catch (err) {
      console.warn('[omnimux] oauth manual submit failed:', err instanceof Error ? err.message : String(err))
      if (aliveRef.current) setError(formatAgentError(t, err))
    } finally {
      if (aliveRef.current) setSubmittingManual(false)
    }
  }

  const cancelOAuth = async () => {
    if (!oauthAttempt) return
    stopOAuthPoll()
    const attemptId = oauthAttempt.attemptId
    const agentId = oauthAttempt.agentId
    setOAuthAttempt(null)
    setManualInput('')
    setError('')
    try {
      await api('/omnimux/agents/oauth/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId, id: agentId }),
      })
    } catch (err) {
      console.warn('[omnimux] oauth cancel failed:', err instanceof Error ? err.message : String(err))
    }
  }

  const disconnectAgent = async (target) => {
    if (busy || disconnectingId || !target) return
    setDisconnectingId(target.id)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api('/omnimux/agents/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: target.id }),
      })
      if (!res || res.ok !== true) {
        throw new Error((res && res.error) || t('runtime.error'))
      }
      if (oauthAttempt && oauthAttempt.agentId === target.id) {
        stopOAuthPoll()
        setOAuthAttempt(null)
      }
      await refreshAgents({ refresh: true })
    } catch (err) {
      console.warn('[omnimux] disconnect failed:', err instanceof Error ? err.message : String(err))
      if (aliveRef.current) setError(formatAgentError(t, err))
    } finally {
      if (aliveRef.current) {
        setDisconnectingId('')
        setBusy(false)
      }
    }
  }

  const copyText = async (text, kind) => {
    if (!text) return
    try {
      await navigator?.clipboard?.writeText?.(text)
      if (!aliveRef.current) return
      setCopiedKind(kind)
      setTimeout(() => {
        if (aliveRef.current) setCopiedKind((prev) => (prev === kind ? '' : prev))
      }, 1800)
    } catch (err) {
      console.warn('[omnimux] clipboard copy failed:', err instanceof Error ? err.message : String(err))
    }
  }

  const continueWithAgent = async () => {
    const agent = agents.find((item) => item && item.id === selectedAgent)
    const isConnectedSub = Boolean(agent?.subscription?.connected)
    if (busy || !agent || (!agent.installed && !isConnectedSub)) return
    setBusy(true)
    setError('')
    setNotice(t('runtime.testingConnection'))
    try {
      if (!isConnectedSub && selectedAuth && selectedAuth.state === 'signed-out' && selectedAuth.loginSupported === true) {
        const login = await api('/omnimux/agents/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: agent.id }),
        })
        if (!login || login.ok !== true || login.launched !== true) {
          throw new Error(t('runtime.cliLoginFail'))
        }
        setNotice(t(login.mode === 'background' ? 'runtime.cliLoginStarted' : 'runtime.cliLoginOpened'))
        const signedIn = await waitForSignedIn(agent.id)
        if (!signedIn) throw new Error(t('runtime.cliLoginTimeout'))
        setNotice(t('runtime.testingConnection'))
      }
      const checked = await api('/omnimux/agents/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: agent.id, checkOnly: true }),
      })
      if (!checked || checked.ok !== true) {
        throw new Error((checked && checked.error) || t('runtime.agentFail'))
      }
      const saved = await api('/omnimux/agents/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: agent.id,
          ...(agentModel ? { model: agentModel } : {}),
        }),
      })
      if (!saved || saved.ok !== true) {
        throw new Error((saved && saved.error) || t('runtime.agentFail'))
      }
      // The Host route above already wrote runtimeAgentId/runtimeAgentVerified
      // through settings.update, so adopt its new revision before staging the
      // companion model field; otherwise this page's later save would be fenced
      // to the pre-route revision and falsely conflict.
      if (scope && typeof scope.adoptRevision === 'function') await scope.adoptRevision()
      if (scope && typeof scope.set === 'function' && agentModel !== (value.runtimeAgentModel || '')) {
        const savedModel = await scope.set('runtimeAgentModel', agentModel)
        if (savedModel === false) throw new Error(t('runtime.error'))
      }
      setTestedId(agent.id)
      setNotice(isConnectedSub ? '' : t('runtime.agentChecked', { name: agent.name }))
      if (typeof onVerified === 'function') onVerified(agent.id)
    } catch (err) {
      setTestedId('')
      setError(formatAgentError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const updateAgent = async (event, agent) => {
    event.stopPropagation()
    if (busy || updatingId) return
    setUpdatingId(agent.id)
    setError('')
    setNotice('')
    try {
      const res = await api('/omnimux/agents/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: agent.id }),
      })
      if (res && res.ok) {
        await refreshAgents({ refresh: true })
        await refreshUpdates({ refresh: true })
        setNotice(t('runtime.cliUpdateDone'))
      } else {
        setError(t('runtime.cliUpdateFail'))
      }
    } catch {
      setError(t('runtime.cliUpdateFail'))
    } finally {
      setUpdatingId('')
    }
  }

  const handleModelChange = (nextModel) => {
    if (busy) return
    setAgentModel(nextModel)
    setTestedId('')
  }

  const installedCount = countInstalledAgents(agents)
  const selected = agents.find((item) => item && item.id === selectedAgent) || null
  const agent = selected
  const selectedAuth = selected && selected.auth && typeof selected.auth === 'object' ? selected.auth : null
  const selectedSub = selected && selected.subscription && typeof selected.subscription === 'object' ? selected.subscription : null
  const subSupported = Boolean(selectedSub && selectedSub.supported === true)
  const subConnected = Boolean(selectedSub && selectedSub.connected === true)
  const subOAuthMethods = Array.isArray(selectedSub?.oauthMethods) ? selectedSub.oauthMethods : []
  const subCanImport = canImportCliAuth(selected)
  const subImportReason = typeof selectedSub?.cliImport?.reason === 'string' ? selectedSub.cliImport.reason : ''
  const selectedOAuth = oauthAttempt && selected && oauthAttempt.agentId === selected.id && ACTIVE_OAUTH_STATUSES.has(oauthAttempt.status)
    ? oauthAttempt
    : null
  const selectedUpdate = selected && updates[selected.id] && typeof updates[selected.id] === 'object' ? updates[selected.id] : null
  const showSelectedUpdate = selectedUpdate !== null && selectedUpdate.state === 'available' && selectedUpdate.supported === true
  const updateVersion = selectedUpdate && typeof selectedUpdate.latest === 'string' ? selectedUpdate.latest : ''
  const showModelSelector = Boolean(selected && (selected.installed === true || subConnected))
  const showContinueFooter = Boolean(
    !selected
    || !subSupported
    || subConnected
    || (subOAuthMethods.length === 0 && !subCanImport && selected.installed === true),
  )
  const modelOptions = (() => {
    const agentModels = agent && Array.isArray(agent.models)
      ? selected.models.filter((model) => typeof model === 'string' && model.trim())
      : []
    const raw = [
      { value: '', label: t('runtime.cliDefaultSetting') },
      ...agentModels.map((model) => ({ value: model, label: model })),
      ...(agentModel && !agentModels.includes(agentModel) ? [{ value: agentModel, label: agentModel }] : []),
    ]
    const seen = new Set()
    return raw.filter((option) => {
      if (seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
  })()

  return (
    <div className="omx-agent-shell">
      <div className="omx-agent-head">
        <div>
          <h3 className="omx-agent-title">{t('runtime.cliPanelTitle')}</h3>
          <p className="omx-agent-subtitle">{t('runtime.cliHeader')}</p>
        </div>
        <div className="omx-agent-head-actions">
          <Button variant="secondary" disabled={busy} onClick={scanNow}>
            {t('runtime.scan')}
          </Button>
          <span className={`omx-agent-status ${busy ? 'busy' : ''}`} data-installed={String(installedCount)} data-known={String(agents.length)}>
            {busy
              ? t('runtime.testingConnection')
              : agents.length > 0
                ? t('runtime.cliCountInstalled', { installed: String(installedCount), known: String(agents.length) })
                : null}
          </span>
        </div>
      </div>

      {showEmptyState && agents.length === 0 ? (
        <p className="omx-agent-empty" role="status">{t('runtime.noAgents')}</p>
      ) : null}
      <div className="omx-agent-grid">
        {agents.map((row) => {
          const selectable = isAgentSelectable(row)
          const isSelected = selectedAgent === row.id
          const badge = agentConnectionBadge(t, row)
          return (
            <Button
              key={row.id}
              variant="ghost"
              className={`omx-agent-card ${isSelected ? 'selected' : ''} ${selectable ? '' : 'disabled'}`}
              disabled={!selectable}
              aria-pressed={isSelected ? 'true' : 'false'}
              onClick={() => {
                if (!selectable) return
                if (row.id !== selectedAgent) {
                  setAgentModel(row.id === value.runtimeAgentId ? (value.runtimeAgentModel || '') : '')
                }
                setSelectedAgent(row.id)
                setTestedId('')
                setError('')
                setNotice('')
              }}
            >
              <span className="omx-agent-icon" data-agent-icon={row.id} aria-hidden="true"><AgentBrandIcon id={row.id} name={row.name} /></span>
              <span className="omx-agent-card-copy">
                <span className="omx-agent-card-head">
                  <span className="omx-agent-name">{row.name}</span>
                  {badge ? <span className="omx-agent-badge" data-kind={badge.kind}>{badge.label}</span> : null}
                </span>
                <span className="omx-agent-version">
                  {agentCardSubtitle(t, row)}
                </span>
              </span>
            </Button>
          )
        })}
      </div>

      {selected ? (
        <div className="omx-agent-model-section">
          {subSupported && !subConnected && !selectedOAuth ? (
            <>
              {subImportReason === 'keyring-or-external' ? (
                <p className="omx-agent-warn" role="status">{t('runtime.cliImportKeyringHint')}</p>
              ) : null}
              {subImportReason === 'api-key-mode' ? (
                <p className="omx-agent-warn" role="status">{t('runtime.cliImportApiKeyHint')}</p>
              ) : null}
              <div className="omx-agent-detail-actions">
                {subCanImport ? (
                  <Button
                    variant="primary"
                    disabled={busy || importingId === selected.id}
                    onClick={() => { void importCliAuth(selected) }}
                  >
                    {importingId === selected.id
                      ? t('runtime.cliImporting')
                      : t('runtime.cliImportCta', { name: selected.name })}
                  </Button>
                ) : null}
                {subOAuthMethods.map((method, index) => (
                  <Button
                    key={method}
                    variant={!subCanImport && index === 0 ? 'primary' : 'secondary'}
                    disabled={busy}
                    onClick={() => { void startOAuth(selected, method) }}
                  >
                    {oauthMethodLabel(t, method, subCanImport && method === 'browser')}
                  </Button>
                ))}
              </div>
            </>
          ) : null}

          {selectedOAuth ? (
            <div className="omx-oauth-box" role="region" aria-live="polite" data-oauth-status={selectedOAuth.status}>
              <div className="omx-oauth-head">
                <span className="omx-oauth-status">
                  {selectedOAuth.status === 'exchanging'
                    ? t('runtime.oauthExchanging')
                    : selectedOAuth.notice?.code
                      ? t('runtime.oauthWaitingDevice')
                      : selectedOAuth.status === 'awaiting_user'
                        ? t('runtime.oauthWaitingBrowser')
                        : t('runtime.oauthStarting')}
                </span>
                <Button variant="ghost" onClick={() => { void cancelOAuth() }}>
                  {t('runtime.oauthCancel')}
                </Button>
              </div>
              {selectedOAuth.notice?.code ? (
                <div className="omx-device-code-row">
                  <code className="omx-device-code">{selectedOAuth.notice.code}</code>
                  <Button variant="secondary" onClick={() => { void copyText(selectedOAuth.notice.code, 'code') }}>
                    {copiedKind === 'code' ? t('runtime.oauthCopied') : t('runtime.oauthCopyCode')}
                  </Button>
                </div>
              ) : null}
              {selectedOAuth.notice?.url ? (
                <div className="omx-oauth-actions">
                  <Button variant="primary" onClick={() => openAuthUrl(selectedOAuth.notice.url)}>
                    {t('runtime.oauthOpenPage')}
                  </Button>
                  <Button variant="secondary" onClick={() => { void copyText(selectedOAuth.notice.url, 'url') }}>
                    {copiedKind === 'url' ? t('runtime.oauthCopied') : t('runtime.oauthCopyUrl')}
                  </Button>
                </div>
              ) : null}
              {selectedOAuth.pendingPrompt ? (
                <div className="omx-oauth-manual-row">
                  <InputField
                    id={`omx-oauth-manual-${selected.id}`}
                    aria-label={selectedOAuth.pendingPrompt.message || t('runtime.oauthManualPlaceholder')}
                    type={selectedOAuth.pendingPrompt.kind === 'secret' ? 'password' : 'text'}
                    value={manualInput}
                    placeholder={selectedOAuth.pendingPrompt.placeholder || t('runtime.oauthManualPlaceholder')}
                    disabled={submittingManual}
                    onChange={(event) => setManualInput(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={submittingManual || !manualInput.trim()}
                    onClick={() => { void submitOAuthPrompt() }}
                  >
                    {t('runtime.oauthManualSubmit')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {showModelSelector ? (
            <>
              <div className="omx-agent-model-label">
                <span>{t('runtime.modelLabel')}</span>
                <span className="omx-agent-model-target">{selected.name}</span>
                {agentModelSource(selected) ? (
                  <span className="omx-agent-source" data-source={agentModelSource(selected)}>
                    {t(agentModelSource(selected) === 'live' ? 'runtime.modelsLive' : 'runtime.modelsPreset')}
                  </span>
                ) : null}
              </div>
              {agentModelSource(selected) === 'preset' ? (
                <p className="omx-agent-source-hint">{t('runtime.modelsPresetHint')}</p>
              ) : null}
              <DropdownSelect
                id={`omx-agent-model-${selected.id}`}
                value={agentModel || ''}
                options={modelOptions}
                disabled={busy}
                onChange={handleModelChange}
              />
            </>
          ) : null}

          <div className="omx-agent-selected-actions">
            {subConnected && subOAuthMethods.length > 0 && !selectedOAuth ? (
              <Button variant="secondary" disabled={busy} onClick={() => { void startOAuth(selected, subOAuthMethods[0]) }}>
                {t('runtime.oauthReauthCta')}
              </Button>
            ) : null}
            {subConnected ? (
              <Button
                variant="ghost"
                disabled={busy || disconnectingId === selected.id}
                onClick={() => { void disconnectAgent(selected) }}
              >
                {disconnectingId === selected.id ? t('runtime.oauthDisconnecting') : t('runtime.oauthDisconnectCta')}
              </Button>
            ) : null}
            {showSelectedUpdate ? (
              <Button variant="ghost" disabled={busy || updatingId === selected.id} onClick={(event) => { void updateAgent(event, selected) }}>
                {updatingId === selected.id ? t('runtime.cliUpdating') : (updateVersion ? t('runtime.cliUpdateTo', { version: updateVersion }) : t('runtime.cliUpdate'))}
              </Button>
            ) : null}
            {testedId === selected.id ? <span className="omx-status-pass">{t('runtime.programChecked')}</span> : null}
          </div>
        </div>
      ) : null}

      {showContinueFooter ? (
        <div className="omx-agent-footer">
          <Button
            variant="primary"
            disabled={busy || !selected || (!selected.installed && !subConnected)}
            onClick={() => { void continueWithAgent() }}
          >
            {t('runtime.continue')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}


/** Existing settings export uses the single provider draft surface. */
function ByokPanel(props) {
  return <ProviderConfigPanel {...props} />
}

export { ByokPanel, AgentPanel }
