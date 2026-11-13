import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ANALYTICS_CSS, STYLES_ID } from './styles.js'
import { en, zh } from './locales.js'

describe('analytics styles tokens', () => {
  it('scopes every rule under the analytics prefix and names the style node', () => {
    assert.equal(STYLES_ID, 'omnimux-analytics-styles')
    assert.match(ANALYTICS_CSS, /\.omnimux-analytics-stage \{/)
    assert.match(ANALYTICS_CSS, /position:\s*relative;/)
    assert.equal(ANALYTICS_CSS.includes('style='), false)
  })

  it('wraps heatmap and metric colors in CSS variables with fallbacks', () => {
    assert.match(ANALYTICS_CSS, /--omnimux-analytics-heat-4: var\(--dsw-alias-chart-heat-4, #216e39\)/)
    assert.match(ANALYTICS_CSS, /--omnimux-analytics-metric-likes: var\(--dsw-alias-state-error-primary, #ef4444\)/)
    assert.match(ANALYTICS_CSS, /height: 44px/)
    assert.match(ANALYTICS_CSS, /width: 220px/)
  })
})

describe('locale dictionaries', () => {
  it('keeps zh/en key sets aligned for every surface string', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    assert.deepEqual(zhKeys, enKeys)
    for (const key of ['title', 'sync.now', 'kpi.er', 'charts.heatmap', 'table.postsTitle', 'empty.no_accounts.action']) {
      assert.ok(zh[key] && en[key], `missing ${key}`)
    }
  })
})
