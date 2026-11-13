import { CADENCE_BRACKET_LABEL, PLATFORM_LABEL } from '../constants.js'
import { formatPercentPoints, formatPercentTick } from '../format.js'
import { ChartPanel, LineChart } from './SvgChart.jsx'

const CADENCE_COLOR = {
  tiktok: 'var(--omnimux-analytics-cadence, var(--dsw-alias-brand-primary, #0ea5e9))',
  twitter: 'var(--omnimux-analytics-platform-twitter, var(--dsw-alias-brand-twitter, #1d9bf0))',
  youtube: 'var(--omnimux-analytics-platform-youtube, var(--dsw-alias-brand-youtube, #ff0000))',
  instagram: 'var(--omnimux-analytics-platform-instagram, var(--dsw-alias-brand-instagram, #e1306c))',
}

/**
 * Cadence (posts/week vs ER%) + 2–7d engagement accumulation curve.
 * Cadence values are percent-points already — never multiply by 100.
 */
export function StrategyCharts({ t, strategy, locale = 'zh-CN' }) {
  const cadence = strategy?.cadence
  const accumulation = strategy?.accumulation
  const brackets = Array.isArray(cadence?.brackets) ? cadence.brackets : []
  const cadenceLabels = brackets.map((key) => CADENCE_BRACKET_LABEL[key] ?? key)
  const cadenceSeries = (cadence?.series ?? []).map((item) => ({
    key: item.platform,
    label: PLATFORM_LABEL[item.platform] ?? item.platform,
    color: CADENCE_COLOR[item.platform] ?? 'currentColor',
    yAxis: 0,
    visible: true,
    points: item.erPercentPoints,
    format: formatPercentPoints,
  }))
  const windows = Array.isArray(accumulation?.windows) ? accumulation.windows : []
  const accLabels = windows.map((w) => (locale.startsWith('en') ? w.labelEn : w.labelZh))
  const accSeries = [{
    key: 'accumulation',
    label: t('charts.accumulationSeries'),
    color: 'var(--dsw-alias-label-primary, #0a0a0a)',
    yAxis: 0,
    visible: true,
    points: windows.map((w) => w.pct),
    format: (value) => `${value ?? '-'}%`,
  }]
  const optimal = Array.isArray(cadence?.optimal) ? cadence.optimal : []
  const milestones = accumulation?.milestones

  return (
    <section className="omnimux-analytics-grid-2" aria-label={t('charts.strategy')}>
      <ChartPanel
        title={t('charts.cadence')}
        subtitle={t('charts.cadenceSub')}
        footer={(
          <div className="omnimux-analytics-chips">
            <span className="omnimux-analytics-chips-label">{t('charts.optimal')}</span>
            {optimal.map((item) => (
              <span key={item.platform} className="omnimux-analytics-chip">
                <span className="omnimux-analytics-platform-dot" data-platform={item.platform} />
                {locale.startsWith('en') ? item.labelEn : item.labelZh}
              </span>
            ))}
          </div>
        )}
      >
        <LineChart
          labels={cadenceLabels}
          series={cadenceSeries}
          fillFirst
          yFormat={formatPercentTick}
        />
      </ChartPanel>
      <ChartPanel
        title={t('charts.accumulation')}
        subtitle={t('charts.accumulationSub')}
        footer={(
          <div className="omnimux-analytics-chips">
            {milestones?.halfLabelZh ? <span className="omnimux-analytics-chip">{locale.startsWith('en') ? t('charts.halfEn') : milestones.halfLabelZh}</span> : null}
            {milestones?.eightyLabelZh ? <span className="omnimux-analytics-chip">{locale.startsWith('en') ? t('charts.eightyEn') : milestones.eightyLabelZh}</span> : null}
          </div>
        )}
      >
        <LineChart
          labels={accLabels}
          series={accSeries}
          yFormat={formatPercentTick}
        />
      </ChartPanel>
    </section>
  )
}
