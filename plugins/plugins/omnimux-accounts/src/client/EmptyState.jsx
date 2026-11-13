import { Button } from 'dsh-ui-kit'
import { PlatformChip } from './chips.jsx'
import { COMING_PLATFORMS, SUPPORTED_PLATFORMS } from './platforms.js'

/**
 * Zero-account empty state: illustration, title, one-line explanation, the
 * "connect first account" CTA, and the platform support list (supported vs
 * coming, both reusing PlatformChip).
 * @param {{
 *   t: (key: string) => string,
 *   onConnect: () => void,
 *   busy?: string,
 * }} props
 */
export function EmptyState({ t, onConnect, busy = '' }) {
  return (
    <div className="omnimux-accounts-empty">
      {/* Platform constellation: one hub account, orbiting platform nodes. */}
      <svg
        className="omnimux-accounts-empty-icon"
        viewBox="0 0 120 96"
        width="120"
        height="96"
        aria-hidden="true"
        focusable="false"
      >
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.9">
          <circle cx="60" cy="48" r="14" />
          <circle cx="60" cy="48" r="24" opacity="0.35" strokeDasharray="3 5" />
          <circle cx="60" cy="48" r="38" opacity="0.2" strokeDasharray="3 6" />
          <path d="M60 34 L26 16 M72 40 L96 24 M68 60 L98 76 M50 60 L22 78" opacity="0.55" />
        </g>
        <g fill="currentColor">
          <circle cx="60" cy="48" r="5" />
          <circle cx="26" cy="16" r="4" opacity="0.8" />
          <circle cx="96" cy="24" r="4" opacity="0.8" />
          <circle cx="98" cy="76" r="4" opacity="0.55" />
          <circle cx="22" cy="78" r="4" opacity="0.55" />
        </g>
      </svg>
      <h2 className="omnimux-accounts-empty-title">{t('empty.title')}</h2>
      <p className="omnimux-accounts-empty-text">{t('empty.description')}</p>
      <Button variant="primary" disabled={busy !== ''} onClick={onConnect}>
        {t('empty.cta')}
      </Button>
      <div className="omnimux-accounts-empty-platforms">
        <div className="omnimux-accounts-empty-group">
          <p className="omnimux-accounts-empty-grouptitle">{t('empty.supportedTitle')}</p>
          <div className="omnimux-accounts-chips">
            {SUPPORTED_PLATFORMS.map((id) => <PlatformChip key={id} platform={id} t={t} />)}
          </div>
        </div>
        <div className="omnimux-accounts-empty-group">
          <p className="omnimux-accounts-empty-grouptitle">{t('empty.comingTitle')}</p>
          <div className="omnimux-accounts-chips">
            {COMING_PLATFORMS.map((id) => (
              <span key={id} className="omnimux-accounts-empty-soonchip">
                <PlatformChip platform={id} t={t} />
                <span className="omnimux-accounts-platform-soon">{t('connect.comingSoon')}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
