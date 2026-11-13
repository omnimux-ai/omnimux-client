import { useState } from 'react'
import { ensureHeatmapCells } from '../query.js'
import { ChartPanel } from './SvgChart.jsx'

function cellTitle(dayLabel, cell) {
  const hour = String(cell.hour).padStart(2, '0')
  return `${dayLabel} ${hour}:00 · ${cell.score}`
}

/**
 * 7×24 five-level heatmap (168 cells) with hover tooltip and Top-3 chips.
 */
export function HeatmapChart({ t, heatmap, locale = 'zh-CN' }) {
  const dayLabels = locale.startsWith('en')
    ? (heatmap?.dayLabelsEn ?? [])
    : (heatmap?.dayLabelsZh ?? [])
  const cells = ensureHeatmapCells(heatmap?.cells, heatmap?.maxScore ?? 0)
  const recommended = Array.isArray(heatmap?.recommended) ? heatmap.recommended : []
  const [hover, setHover] = useState(null)

  return (
    <ChartPanel
      title={t('charts.heatmap')}
      subtitle={t('charts.heatmapSub')}
      legend={(
        <div className="omnimux-analytics-heatmap-legend" aria-hidden="true">
          <span>{t('charts.low')}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="omnimux-analytics-heatcell" data-level={String(level)} />
          ))}
          <span>{t('charts.high')}</span>
        </div>
      )}
      footer={(
        <div className="omnimux-analytics-chips">
          <span className="omnimux-analytics-chips-label">{t('charts.recommended')}</span>
          {recommended.map((slot) => (
            <span key={`${slot.dayOfWeek}-${slot.hour}`} className="omnimux-analytics-chip is-highlight">
              {locale.startsWith('en') ? slot.labelEn : slot.labelZh}
            </span>
          ))}
        </div>
      )}
    >
      <div className="omnimux-analytics-heatmap" role="grid" aria-label={t('charts.heatmap')}>
        {dayLabels.map((label, day) => (
          <div key={label} className="omnimux-analytics-heatmap-row" role="row">
            <span className="omnimux-analytics-heatmap-label">{label}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = cells[day * 24 + hour]
              return (
                <span
                  key={`${day}-${hour}`}
                  role="gridcell"
                  className="omnimux-analytics-heatcell"
                  data-level={String(cell.level ?? 0)}
                  title={cellTitle(label, cell)}
                  onMouseEnter={() => setHover({ label, cell })}
                  onMouseLeave={() => setHover(null)}
                />
              )
            })}
          </div>
        ))}
        {hover ? (
          <div className="omnimux-analytics-heatmap-tip" role="tooltip">
            {cellTitle(hover.label, hover.cell)}
          </div>
        ) : null}
      </div>
    </ChartPanel>
  )
}
