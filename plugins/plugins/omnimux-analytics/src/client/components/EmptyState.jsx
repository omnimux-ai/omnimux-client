import { Button } from 'dsh-ui-kit'

function actionLabel(t, hint) {
  if (hint?.action === 'open_accounts') return t('empty.no_accounts.action')
  if (hint?.action === 'reauth') return t('empty.auth_expired.action')
  if (hint?.action === 'retry') return t('retry')
  if (hint?.action === 'login') return t('login')
  return hint?.actionLabelZh || t('retry')
}

/**
 * Empty / exception placeholder. Loading is a different surface (see LoadingState).
 */
export function EmptyState({ t, hint, onAction }) {
  const code = hint?.code ?? 'no_accounts'
  return (
    <div className="omnimux-analytics-empty" data-code={code}>
      <svg className="omnimux-analytics-empty-icon" viewBox="0 0 120 96" width="120" height="96" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="18" y="22" width="84" height="56" rx="8" opacity="0.85" />
          <path d="M30 64 L48 46 L62 58 L78 38 L102 64" opacity="0.7" />
          <circle cx="40" cy="40" r="4" fill="currentColor" stroke="none" opacity="0.7" />
        </g>
      </svg>
      <h2 className="omnimux-analytics-empty-title">{t(`empty.${code}.title`)}</h2>
      <p className="omnimux-analytics-empty-text">{hint?.detail || t(`empty.${code}.description`)}</p>
      {hint?.action && onAction ? (
        <Button variant="primary" onClick={() => onAction(hint.action)}>
          {actionLabel(t, hint)}
        </Button>
      ) : null}
    </div>
  )
}

export function LoadingState({ t }) {
  return (
    <div className="omnimux-analytics-empty" data-code="loading">
      <p className="omnimux-analytics-empty-text">{t('loading')}</p>
    </div>
  )
}

export function InboxPlaceholder({ t }) {
  return (
    <section className="omnimux-analytics-panel omnimux-analytics-inbox">
      <h3 className="omnimux-analytics-panel-title">{t('inbox.title')}</h3>
      <p className="omnimux-analytics-panel-subtitle">{t('inbox.subtitle')}</p>
      <span className="omnimux-analytics-chip">{t('tab.inboxSoon')}</span>
    </section>
  )
}

export function Banner({ t, hint, onAction }) {
  if (!hint?.code) return null
  return (
    <div className="omnimux-analytics-banner" data-code={hint.code} role="status">
      <div className="omnimux-analytics-banner-copy">
        <span>{t(`empty.${hint.code}.title`)}</span>
        {hint.detail ? <span className="omnimux-analytics-banner-detail">{hint.detail}</span> : null}
      </div>
      {hint.action && onAction ? (
        <Button variant="outline" size="sm" onClick={() => onAction(hint.action)}>
          {actionLabel(t, hint)}
        </Button>
      ) : null}
    </div>
  )
}
