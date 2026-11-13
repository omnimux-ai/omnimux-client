import { Button } from 'dsh-ui-kit'

/**
 * Overview strip: four clickable stat cards (connected / needs attention /
 * platforms / total). The "+ Connect" CTA is rendered separately by
 * AccountsSection above this strip — it is the page-level primary action,
 * not an overview element.
 * @param {{
 *   t: (key: string) => string,
 *   summary: { total: number, connected: number, needsAttention: number, platformCount: number },
 *   filters?: { query?: string, platform?: string, group?: string, status?: string, statusGroup?: string, overview?: string },
 *   onFilterClick: (filter: { status?: string, statusGroup?: string, platform?: string, overview?: string } | null) => void,
 *   busy?: string,
 * }} props
 */
export function OverviewBar({ t, summary, filters = {}, onFilterClick, busy = '' }) {
  const isTotalSelected = Boolean(
    !filters.query &&
    !filters.platform &&
    !filters.group &&
    !filters.status &&
    !filters.statusGroup &&
    !filters.overview,
  )

  const stats = [
    {
      key: 'connected',
      label: t('overview.connected'),
      value: summary.connected,
      tone: 'active',
      selected: filters.statusGroup === 'connected',
      filter: { status: '', statusGroup: 'connected', overview: '' },
    },
    {
      key: 'needsAttention',
      label: t('overview.needsAttention'),
      value: summary.needsAttention,
      tone: 'needsAttention',
      selected: filters.statusGroup === 'needsAttention',
      filter: { status: '', statusGroup: 'needsAttention', overview: '' },
    },
    {
      key: 'platforms',
      label: t('overview.platforms'),
      value: summary.platformCount,
      tone: 'platforms',
      selected: filters.overview === 'platforms',
      filter: { platform: '', overview: 'platforms' },
    },
    {
      key: 'total',
      label: t('overview.total'),
      value: summary.total,
      tone: 'total',
      selected: isTotalSelected,
      filter: null,
    },
  ]

  return (
    <div className="omnimux-accounts-overview" role="group" aria-label={t('title')}>
      {stats.map((stat) => (
        <Button
          key={stat.key}
          variant="secondary"
          className={`omnimux-accounts-stat omnimux-accounts-stat--${stat.key}`}
          aria-pressed={stat.selected}
          disabled={busy !== ''}
          onClick={() => { onFilterClick(stat.filter) }}
        >
          <span className="omnimux-accounts-stat-head">
            <span className={`omnimux-accounts-dot omnimux-accounts-dot--${stat.tone}`} aria-hidden="true" />
            <span className="omnimux-accounts-stat-label">{stat.label}</span>
          </span>
          <span className="omnimux-accounts-stat-value">{String(stat.value)}</span>
        </Button>
      ))}
    </div>
  )
}
