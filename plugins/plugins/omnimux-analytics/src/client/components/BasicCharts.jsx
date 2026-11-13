import { formatCount } from '../format.js'
import { BarChart, ChartPanel } from './SvgChart.jsx'

function totalLabel(t, total, unitKey) {
  return (
    <>
      <strong>{formatCount(total)}</strong>
      <span>{t(unitKey)}</span>
    </>
  )
}

/**
 * 2×2 bar grid: posts/likes × platform/time.
 */
export function BasicCharts({ t, basicCharts, timeRange = '30d' }) {
  const postsPlat = basicCharts?.postsPerPlatform ?? { labels: [], values: [], total: null }
  const postsTime = basicCharts?.postsOverTime ?? { buckets: [], total: null }
  const likesPlat = basicCharts?.likesPerPlatform ?? { labels: [], values: [], total: null }
  const likesTime = basicCharts?.likesOverTime ?? { buckets: [], total: null }
  const rangeLabel = t(`filter.range.${timeRange}`)

  return (
    <section className="omnimux-analytics-grid-2" aria-label={t('charts.basic')}>
      <ChartPanel
        title={t('charts.postsPlatform')}
        subtitle={t('charts.postsPlatformSub')}
        meta={totalLabel(t, postsPlat.total, 'charts.postsUnit')}
      >
        <BarChart labels={postsPlat.labels} values={postsPlat.values} />
      </ChartPanel>
      <ChartPanel
        title={t('charts.postsTime')}
        subtitle={t('charts.weekSlice').replace('{range}', rangeLabel)}
        meta={totalLabel(t, postsTime.total, 'charts.postsUnit')}
      >
        <BarChart
          labels={postsTime.buckets.map((b) => b.label)}
          values={postsTime.buckets.map((b) => b.value)}
        />
      </ChartPanel>
      <ChartPanel
        title={t('charts.likesPlatform')}
        subtitle={t('charts.likesPlatformSub')}
        meta={totalLabel(t, likesPlat.total, 'charts.likesUnit')}
      >
        <BarChart labels={likesPlat.labels} values={likesPlat.values} />
      </ChartPanel>
      <ChartPanel
        title={t('charts.likesTime')}
        subtitle={t('charts.weekSlice').replace('{range}', rangeLabel)}
        meta={totalLabel(t, likesTime.total, 'charts.likesUnit')}
      >
        <BarChart
          labels={likesTime.buckets.map((b) => b.label)}
          values={likesTime.buckets.map((b) => b.value)}
        />
      </ChartPanel>
    </section>
  )
}
