import { Button } from 'dsh-ui-kit'

export function desktopBridge() {
  const api = window.dshDesktop
  return api && typeof api.restartHost === 'function' ? api : undefined
}

/**
 * @param {string} template locale sentence with `{title}` placeholders
 * @param {Record<string, unknown>} vars
 */
export function fmt(template, vars) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
}

export function AppMark({ id }) {
  if (id === 'accounts') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.4 13c.6-2.4 2.3-3.6 4.6-3.6s4 1.2 4.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function matches(app, query) {
  if (query.length === 0) return true
  const hay = [app.title, app.summary, app.id, app.spec?.name]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  return hay.includes(query)
}

/**
 * Device-login gate shown when opening an identity app while signed out.
 * Distinct from the shell-wide LoginGate overlay.
 * @param {{
 *   t: (key: string) => string,
 *   auth: ReturnType<typeof useOmnimuxAuth>,
 *   onCancel: () => void,
 * }} props
 */
export function PluginLoginPanel({ t, auth, onCancel }) {
  const state = auth.state
  const idle = state.phase === 'need-login' || state.phase === 'denied' || state.phase === 'expired' || state.phase === 'error'
  return (
    <div className="omnimux-plugins-gate">
      <p className="omnimux-plugins-muted">{t('plugins.needLogin')}</p>
      {state.phase === 'waiting' ? (
        <div className="omnimux-plugins-gate-waiting">
          <p className="omnimux-plugins-muted">{t('plugins.waiting')}</p>
          {typeof state.user_code === 'string' && state.user_code ? (
            <p className="omnimux-plugins-gate-code">{state.user_code}</p>
          ) : null}
          {typeof state.verification_url === 'string' && state.verification_url ? (
            <Button variant="primary" onClick={() => { auth.openUrl(state.verification_url) }}>
              {t('plugins.open')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.phase === 'denied' ? <p className="omnimux-plugins-error">{t('plugins.denied')}</p> : null}
      {state.phase === 'expired' ? <p className="omnimux-plugins-error">{t('plugins.expired')}</p> : null}
      {state.phase === 'error' ? <p className="omnimux-plugins-error">{state.detail || t('plugins.error')}</p> : null}
      {idle ? (
        <Button variant="primary" onClick={() => { void auth.beginLogin() }}>
          {t('plugins.login')}
        </Button>
      ) : null}
      <Button variant="ghost" onClick={onCancel}>
        {t('plugins.cancel')}
      </Button>
    </div>
  )
}
