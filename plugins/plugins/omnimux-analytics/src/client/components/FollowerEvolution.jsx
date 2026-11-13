import { PLATFORM_LABEL } from '../constants.js'
import { formatCount } from '../format.js'
import { ChartPanel, LineChart } from './SvgChart.jsx'

const PLATFORM_COLOR = {
  tiktok: 'var(--omnimux-analytics-platform-tiktok, var(--dsw-alias-label-primary, #0a0a0a))',
  twitter: 'var(--omnimux-analytics-platform-twitter, var(--dsw-alias-brand-twitter, #1d9bf0))',
  youtube: 'var(--omnimux-analytics-platform-youtube, var(--dsw-alias-brand-youtube, #ff0000))',
  instagram: 'var(--omnimux-analytics-platform-instagram, var(--dsw-alias-brand-instagram, #e1306c))',
}

/**
 * Multi-line follower evolution. KPI totalFollowers is the source of truth
 * for the panel meta; the chart uses the snapshot timeline.
 */
export function FollowerEvolution({ t, block }) {
  const timeline = Array.isArray(block?.timeline) ? block.timeline : []
  const platforms = Array.isArray(block?.platforms) ? block.platforms : []
  const labels = timeline.map((point) => point.label)
  const series = platforms.map((platform) => ({
    key: platform,
    label: PLATFORM_LABEL[platform] ?? platform,
    color: PLATFORM_COLOR[platform] ?? 'currentColor',
    yAxis: 0,
    visible: true,
    points: timeline.map((point) => point.breakdown?.[platform] ?? null),
  }))
  const countLabel = t('charts.authorizedCount').replace('{n}', String(platforms.length))

  return (
    <ChartPanel
      title={t('charts.followers')}
      subtitle={countLabel}
      meta={(
        <>
          <strong>{formatCount(block?.totalFollowers)}</strong>
          <span>{t('charts.followersUnit')}</span>
        </>
      )}
    >
      <LineChart labels={labels} series={series} />
    </ChartPanel>
  )
}
