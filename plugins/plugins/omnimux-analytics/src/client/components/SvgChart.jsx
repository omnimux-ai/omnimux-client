import { areaPath, barLayout, CHART_PAD, DUAL_PAD, lineLayout, polylinePath, ticks } from '../charts-math.js'
import { formatAxisTick, formatCount } from '../format.js'

/**
 * Shared SVG chrome. Geometry lives in charts-math.js so tests do not
 * mount a DOM. Colors go through currentColor / CSS variables.
 */

function AxisLabels({ box, max, labels, labelXs, formatTick = formatAxisTick }) {
  const yTicks = ticks(max, 5)
  return (
    <>
      {yTicks.map((tick, index) => {
        const y = box.bottom - (max === 0 ? 0 : (tick / max) * box.height)
        return (
          <g key={`y-${index}-${tick}`}>
            <line className="omnimux-analytics-gridline" x1={box.x} x2={box.right} y1={y} y2={y} />
            <text className="omnimux-analytics-tick omnimux-analytics-tick-y" x={box.x - 6} y={y + 3}>
              {formatTick(tick)}
            </text>
          </g>
        )
      })}
      {labels.map((label, index) => {
        const x = labelXs?.[index]
          ?? (labels.length === 1
            ? box.x + box.width / 2
            : box.x + (box.width / Math.max(1, labels.length - 1)) * index)
        return (
          <text key={`x-${label}-${index}`} className="omnimux-analytics-tick omnimux-analytics-tick-x" x={x} y={box.bottom + 16}>
            {label}
          </text>
        )
      })}
    </>
  )
}

export function BarChart({ labels, values, width = 480, height = 200 }) {
  const { box, max, bars } = barLayout(values, width, height)
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="omnimux-analytics-svg" role="img">
      <AxisLabels box={box} max={max} labels={labels} labelXs={bars.map((bar) => bar.cx)} />
      {bars.map((bar, index) => (
        <rect
          key={`${labels[index] ?? index}`}
          className="omnimux-analytics-bar"
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx="3"
        >
          <title>{`${labels[index] ?? ''}: ${formatCount(bar.value)}`}</title>
        </rect>
      ))}
    </svg>
  )
}

export function LineChart({
  labels,
  series,
  width = 480,
  height = 220,
  dual = false,
  yFormat,
  y1Format,
  fillFirst = false,
}) {
  const pad = dual ? DUAL_PAD : CHART_PAD
  const leftSeries = series.filter((s) => (s.yAxis ?? 0) === 0 && s.visible !== false)
  const rightSeries = series.filter((s) => s.yAxis === 1 && s.visible !== false)
  const leftValues = leftSeries.flatMap((s) => s.points)
  const rightValues = rightSeries.flatMap((s) => s.points)
  const left = lineLayout(leftValues.length ? leftValues : [0], width, height, { pad })
  const right = lineLayout(rightValues.length ? rightValues : [0], width, height, { pad })
  const leftMax = leftSeries.length ? left.max : 1
  const rightMax = rightSeries.length ? right.max : 1

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="omnimux-analytics-svg" role="img">
      <AxisLabels box={left.box} max={leftMax} labels={labels} formatTick={yFormat ?? formatAxisTick} />
      {dual && rightSeries.length > 0 ? ticks(rightMax, 5).map((tick) => {
        const y = right.box.bottom - (rightMax === 0 ? 0 : (tick / rightMax) * right.box.height)
        return (
          <text key={`y1-${tick}`} className="omnimux-analytics-tick omnimux-analytics-tick-y1" x={right.box.right + 6} y={y + 3}>
            {(y1Format ?? formatCount)(tick)}
          </text>
        )
      }) : null}
      {series.map((item) => {
        if (item.visible === false) return null
        const axis = item.yAxis === 1 ? { max: rightMax, box: right.box } : { max: leftMax, box: left.box }
        const laid = lineLayout(item.points, width, height, { pad, max: axis.max })
        const d = polylinePath(laid.points)
        if (!d) return null
        return (
          <g key={item.key} className="omnimux-analytics-series" style={{ '--series-color': item.color }}>
            {fillFirst && item === series[0] ? (
              <path className="omnimux-analytics-area" d={areaPath(laid.points, laid.box.bottom)} />
            ) : null}
            <path
              className={item.dashed ? 'omnimux-analytics-line omnimux-analytics-line-dash' : 'omnimux-analytics-line'}
              d={d}
            />
            {laid.points.map((point, index) => (
              point.y == null ? null : (
                <circle key={`${item.key}-${index}`} className="omnimux-analytics-dot" cx={point.x} cy={point.y} r="2.5">
                  <title>{`${item.label}: ${labels[index]} ${item.format ? item.format(point.value) : formatCount(point.value)}`}</title>
                </circle>
              )
            ))}
          </g>
        )
      })}
    </svg>
  )
}

export function ChartPanel({ title, subtitle, meta, legend, footer, children, wide }) {
  return (
    <section className={wide ? 'omnimux-analytics-panel omnimux-analytics-panel-wide' : 'omnimux-analytics-panel'}>
      <header className="omnimux-analytics-panel-header">
        <div className="omnimux-analytics-panel-heading">
          <h3 className="omnimux-analytics-panel-title">{title}</h3>
          {subtitle ? <p className="omnimux-analytics-panel-subtitle">{subtitle}</p> : null}
        </div>
        {meta ? <div className="omnimux-analytics-panel-meta">{meta}</div> : null}
        {legend}
      </header>
      <div className="omnimux-analytics-chartbox">{children}</div>
      {footer}
    </section>
  )
}
