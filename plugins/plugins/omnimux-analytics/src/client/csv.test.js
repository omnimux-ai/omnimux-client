import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDashboardCsv } from './csv.js'
import fixture from './mock/dashboard-fixture.json' with { type: 'json' }

describe('buildDashboardCsv', () => {
  it('emits platform and top-post tables with dash fallbacks', () => {
    const csv = buildDashboardCsv(fixture)
    assert.match(csv, /# Platform Breakdown/)
    assert.match(csv, /TikTok,12,34,8,2,-,-,1.9K,-,-,2.28%/)
    assert.match(csv, /# Top Posts/)
    assert.match(csv, /Episode 1 Pilot/)
    assert.match(csv, /1.83%/)
  })

  it('returns headers only when the payload is empty', () => {
    const csv = buildDashboardCsv({ platformBreakdown: [], topPosts: [] })
    assert.match(csv, /平台/)
    assert.match(csv, /内容摘要/)
  })
})
