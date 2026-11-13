import { useMemo, useState } from 'react'
import { Button } from 'dsh-ui-kit'
import { chartPointsForMetric } from '../charts-math.js'
import { formatCount, formatEr, formatSignedCount } from '../format.js'
import { ChartPanel, LineChart } from './SvgChart.jsx'

function formatMetric(key, value) {
  if (key === 'er') return formatEr(value)
  return formatCount(value)
}

function formatDelta(delta) {
  if (delta == null || Number.isNaN(delta)) return ''
  // Prototype copy for the views pill: +199300% ↑. Keep a compact signed count
  // when the backend sends an absolute delta, not a ratio.
  if (Math.abs(delta) >= 10) return `${formatSignedCount(delta)}`
  return `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`
}

/**
 * Full-width composite line chart. Nine metric pills toggle series; the
 * dual Y-axis (counts vs views) redraws from the remaining visible set.
 */
export function EngagementChart({ t, block, locale = 'zh-CN' }) {
  const series = Array.isArray(block?.series) ? block.series : []
  const defaults = useMemo(() => {
    const seed = {}
    for (const item of series) seed[item.key] = item.defaultVisible !== false
    return seed
  }, [series])
  const [overrides, setOverrides] = useState({})

  const plotted = useMemo(() => series.map((item) => ({
    key: item.key,
    label: locale.startsWith('en') ? item.labelEn : item.labelZh,
    color: `var(--omnimux-analytics-metric-${item.key}, ${item.color})`,
    yAxis: item.yAxis,
    dashed: Boolean(item.dashed),
    visible: (overrides[item.key] ?? defaults[item.key]) !== false,
    points: chartPointsForMetric(item.key, item.points),
    format: (value) => (item.key === 'er' ? `${Number(value).toFixed(2)}%` : formatCount(value)),
  })), [series, overrides, defaults, locale])

  return (
    <ChartPanel
      wide
      title={t('charts.engagement')}
      subtitle={t('charts.engagementSub')}
      footer={(
        <div className="omnimux-analytics-pills" role="group" aria-label={t('charts.metrics')}>
          {series.map((item) => {
            const checked = (overrides[item.key] ?? defaults[item.key]) !== false
            const total = block?.totals?.[item.key]
            const delta = block?.deltas?.[item.key]
            return (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                size="xs"
                className={checked ? 'omnimux-analytics-pill is-on' : 'omnimux-analytics-pill'}
                aria-pressed={checked}
                onClick={() => {
                  setOverrides((prev) => ({ ...prev, [item.key]: !checked }))
                }}
              >
                <span
                  className="omnimux-analytics-pill-dot"
                  style={{ '--pill-color': `var(--omnimux-analytics-metric-${item.key}, ${item.color})` }}
                />
                <span className="omnimux-analytics-pill-label">
                  {locale.startsWith('en') ? item.labelEn : item.labelZh}
                </span>
                <strong>{formatMetric(item.key, total)}</strong>
                {delta != null ? <span className="omnimux-analytics-pill-delta">{formatDelta(delta)}</span> : null}
              </Button>
            )
          })}
        </div>
      )}
    >
      <LineChart
        dual
        labels={block?.labels ?? []}
        series={plotted}
        height={260}
        yFormat={(n) => formatCount(n)}
        y1Format={(n) => formatCount(n)}
      />
    </ChartPanel>
  )
}
