import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from 'dsh-ui-kit'
import { useOmnimuxAuth } from './use-omnimux-auth.js'
import { AgentPanel } from './RuntimeModeSection.jsx'
import { TextKeyPanel } from './TextKeyPanel.jsx'
import { hasAnyChannelChoice } from './runtime-guide-view.js'
import { injectHubStyles } from './styles.js'

const UNAVAILABLE_SNAPSHOT = Object.freeze({ status: 'unavailable', value: undefined })

/** Read the omnimux settings snapshot without inventing a fresh fallback object. */
function useSettingsSnapshot(scope) {
  return useSyncExternalStore(
    (listener) => {
      if (!scope || typeof scope.subscribe !== 'function') return () => {}
      return scope.subscribe(listener)
    },
    () => (scope && typeof scope.getSnapshot === 'function'
      ? scope.getSnapshot()
      : UNAVAILABLE_SNAPSHOT),
  )
}

/**
 * First-run runtime chooser rendered inside the native onboarding surface.
 *
 * The desktop host owns the surface and its inert/opacity lifecycle; this
 * component only renders the one page and closes it after a successful mode
 * write. Official, local-agent and BYOK details reuse the settings components
 * so validation, API calls and error mapping stay single-sourced.
 */
export function NativeRuntimeSetup({
  t,
  scope,
  accountStatus,
  openLogin,
  renderSurface,
  renderNavigation,
}) {
  const snapshot = useSettingsSnapshot(scope)
  const value = snapshot && typeof snapshot.value === 'object' && snapshot.value ? snapshot.value : {}
  const ready = snapshot && typeof snapshot === 'object'
    ? snapshot.status === 'ready' || (!('status' in snapshot) && snapshot.value !== undefined)
    : false
  const auth = useOmnimuxAuth({ t })
  const [mode, setMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [completed, setCompleted] = useState(false)
  const finishing = useRef(false)

  useEffect(() => { injectHubStyles() }, [])

  const finish = useCallback(async (nextMode) => {
    if (finishing.current) return
    finishing.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/omnimux/runtime/mode', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
      }
      setCompleted(true)
    } catch (caught) {
      finishing.current = false
      setBusy(false)
      setError(caught instanceof Error ? caught.message : t('runtime.error'))
    }
  }, [t])

  const loginOfficial = useCallback(() => {
    if (busy) return
    setError('')
    setBusy(true)
    const gate = typeof window !== 'undefined' ? /** @type {any} */ (window).__omnimuxAuth : undefined
    if (gate && typeof gate.ensureLogin === 'function') {
      void gate.ensureLogin({
        kind: 'explicit',
        reason: 'runtime-only',
        onSuccess: () => { void auth.recheck(); void finish('official') },
        onCancel: () => { setBusy(false) },
        onError: () => { setBusy(false); setError(t('runtime.error')) },
      }).catch(() => { setBusy(false); setError(t('runtime.error')) })
      return
    }
    // Stock hosts without the OmniMux gate still expose their account action.
    if (typeof openLogin === 'function') openLogin()
    setBusy(false)
  }, [auth, busy, finish, openLogin, t])

  if (!ready || dismissed || completed || hasAnyChannelChoice(value)) return null

  const loggedIn = auth.state.phase === 'ready' || accountStatus === 'credential-stored'
  const card = (id, title, hint) => (
    <Button
      key={id}
      variant="ghost"
      className={`omnimux-native-runtime-card ${mode === id ? 'is-selected' : ''}`}
      aria-pressed={mode === id}
      disabled={busy}
      onClick={() => { if (!busy) { setMode(id); setError(''); setNotice('') } }}
    >
      <span className="omnimux-native-runtime-card-title">{title}</span>
      <span className="omnimux-native-runtime-card-hint">{hint}</span>
    </Button>
  )

  return renderSurface(
    <div className="omnimux-native-runtime-page" data-omnimux-native-runtime="">
      <header className="omnimux-native-runtime-header">
        <h1>{t('runtime.title')}</h1>
        <p>{t('runtime.hint')}</p>
      </header>

      <div className="omnimux-native-runtime-cards" role="radiogroup" aria-label={t('runtime.title')}>
        {card('official', t('runtime.official'), t('runtime.officialHint'))}
        {card('agent', t('runtime.agent'), t('runtime.agentHint'))}
        {card('key', t('runtime.key'), t('runtime.keyHint'))}
      </div>

      {mode === 'official' ? (
        <section className="omnimux-native-runtime-detail" aria-live="polite">
          <Button
            variant="primary"
            disabled={busy}
            onClick={loggedIn ? () => { void finish('official') } : loginOfficial}
          >
            {loggedIn ? t('runtime.officialContinueLogged') : t('runtime.officialCta')}
          </Button>
        </section>
      ) : null}

      {mode === 'agent' ? (
        <section className="omnimux-native-runtime-detail">
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
            active={true}
            showEmptyState={true}
            onVerified={() => { void finish('agent') }}
          />
        </section>
      ) : null}

      {mode === 'key' ? (
        <section className="omnimux-native-runtime-detail">
          <TextKeyPanel
            t={t}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            notice={notice}
            setNotice={setNotice}
            bindScenarios={['text']}
            onVerified={() => { void finish('key') }}
          />
        </section>
      ) : null}

      {error ? <p className="omnimux-native-runtime-error" role="alert">{error}</p> : null}

      {typeof renderNavigation === 'function'
        ? renderNavigation({ busy, onSkip: () => { if (!busy) setDismissed(true) } })
        : (
          <footer className="omnimux-native-runtime-footer">
            <Button
              variant="ghost"
              className="omnimux-native-runtime-skip"
              disabled={busy}
              onClick={() => { if (!busy) setDismissed(true) }}
            >
              {t('runtime.skip')}
            </Button>
          </footer>
        )}
    </div>,
  )
}
