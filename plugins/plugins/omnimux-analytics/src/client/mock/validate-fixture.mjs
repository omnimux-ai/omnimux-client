#!/usr/bin/env node
/**
 * Phase-1 contract self-check for dashboard-fixture.json
 * Run: node src/client/mock/validate-fixture.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(__dirname, 'dashboard-fixture.json'), 'utf8'))

const METRIC_KEYS = [
  'likes',
  'comments',
  'shares',
  'saves',
  'views',
  'impressions',
  'reach',
  'clicks',
  'er',
]

const errors = []

function assert(cond, msg) {
  if (!cond) errors.push(msg)
}

assert(fixture.meta?.schemaVersion === '1.0.0', 'meta.schemaVersion must be 1.0.0')
assert(fixture.kpi?.bestPost?.postId, 'kpi.bestPost required in happy-path fixture')
assert(fixture.engagementOverTime?.series?.length === 9, 'engagementOverTime.series must have 9 metrics')
assert(
  fixture.engagementOverTime.series.every((s, i) => s.key === METRIC_KEYS[i]),
  'engagementOverTime.series order must match METRIC_KEYS',
)

const bucketLen = fixture.engagementOverTime.buckets.length
for (const s of fixture.engagementOverTime.series) {
  assert(s.points.length === bucketLen, `series ${s.key} points length != buckets`)
  if (s.key === 'er') {
    assert(
      s.points.every((p) => p == null || (p >= 0 && p <= 1)),
      'er.points must be ratios in [0,1]',
    )
  }
}

assert(fixture.heatmap?.cells?.length === 168, 'heatmap.cells must be length 168')
for (let i = 0; i < 168; i++) {
  const c = fixture.heatmap.cells[i]
  const day = Math.floor(i / 24)
  const hour = i % 24
  assert(c.dayOfWeek === day && c.hour === hour, `cell[${i}] index mismatch`)
  assert([0, 1, 2, 3, 4].includes(c.level), `cell[${i}] invalid level`)
  assert(typeof c.score === 'number' && c.score >= 0, `cell[${i}] invalid score`)
}

assert(fixture.heatmap.recommended?.length === 3, 'recommended must be Top 3')
assert(Array.isArray(fixture.platformBreakdown) && fixture.platformBreakdown.length >= 1, 'platformBreakdown')
for (const row of fixture.platformBreakdown) {
  for (const k of ['saves', 'clicks', 'impressions', 'reach']) {
    assert(k in row, `platformBreakdown missing key ${k}`)
  }
}

assert(fixture.topPosts?.length >= 1, 'topPosts')
for (const p of fixture.topPosts) {
  assert('er' in p && (p.er == null || (p.er >= 0 && p.er <= 1)), `topPost ${p.postId} er must be ratio or null`)
}

assert(fixture.strategy?.accumulation?.windows?.length === 7, 'accumulation windows must be 7')
assert(
  fixture.strategy.cadence.series[0].erPercentPoints.every((v) => v == null || v > 0.05),
  'cadence erPercentPoints look like percent numbers (not ratios like 0.022)',
)

assert(fixture.emptyState === null, 'happy-path emptyState must be null')

if (errors.length) {
  console.error('❌ fixture contract failed:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}

console.log('✅ dashboard-fixture.json passes Phase-1 contract checks')
console.log(
  JSON.stringify(
    {
      series: fixture.engagementOverTime.series.length,
      heatmapCells: fixture.heatmap.cells.length,
      topPosts: fixture.topPosts.length,
      platformRows: fixture.platformBreakdown.length,
      accumulationWindows: fixture.strategy.accumulation.windows.length,
    },
    null,
    2,
  ),
)
