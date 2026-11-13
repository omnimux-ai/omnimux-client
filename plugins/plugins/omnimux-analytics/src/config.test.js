import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAnalyticsConfig, DEFAULT_PLUGIN_MAP } from './config.js'

test('unconfigured defaults to soft-disable and never throws', () => {
  const cfg = parseAnalyticsConfig(undefined)
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.websiteId, '')
  assert.equal(cfg.umamiUrl, 'https://analytics.omnimux.ai')
  assert.equal(cfg.hostname, 'omnimux-plugins')
  assert.equal(cfg.sampleRate, 1)
  assert.equal(cfg.flushIntervalMs, 5000)
  assert.equal(cfg.maxQueue, 500)
  assert.equal(cfg.trackSessions, true)
  assert.equal(cfg.trackSubCalls, false)
  assert.equal(cfg.toolEventName, 'tool-call')
  assert.deepEqual(cfg.pluginMap, DEFAULT_PLUGIN_MAP)
})

test('websiteId alone enables the plugin', () => {
  const cfg = parseAnalyticsConfig({ websiteId: 'w-1' })
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.websiteId, 'w-1')
})

test('explicit enabled=true without websiteId is a hard config error', () => {
  assert.throws(
    () => parseAnalyticsConfig({ enabled: true }),
    /websiteId is required when enabled is true/,
  )
})

test('explicit enabled=false without websiteId is accepted', () => {
  const cfg = parseAnalyticsConfig({ enabled: false })
  assert.equal(cfg.enabled, false)
})

test('explicit enabled=false with websiteId stays disabled', () => {
  const cfg = parseAnalyticsConfig({ enabled: false, websiteId: 'w-1' })
  assert.equal(cfg.enabled, false)
})

test('trailing slashes are trimmed from umamiUrl', () => {
  const cfg = parseAnalyticsConfig({ websiteId: 'w-1', umamiUrl: 'https://analytics.omnimux.ai/' })
  assert.equal(cfg.umamiUrl, 'https://analytics.omnimux.ai')
})

test('non-http umamiUrl is rejected', () => {
  assert.throws(
    () => parseAnalyticsConfig({ websiteId: 'w-1', umamiUrl: 'ftp://x' }),
    /umamiUrl must be an http\(s\) URL/,
  )
})

test('sampleRate clamps to [0, 1]', () => {
  assert.equal(parseAnalyticsConfig({ websiteId: 'w', sampleRate: 2 }).sampleRate, 1)
  assert.equal(parseAnalyticsConfig({ websiteId: 'w', sampleRate: -1 }).sampleRate, 0)
  assert.equal(parseAnalyticsConfig({ websiteId: 'w', sampleRate: 0.5 }).sampleRate, 0.5)
})

test('pluginMap merges over defaults and null removes a prefix', () => {
  const cfg = parseAnalyticsConfig({
    websiteId: 'w',
    pluginMap: { workflow_: 'my-workflow', video_: null, brand_new_: 'x' },
  })
  assert.equal(cfg.pluginMap.workflow_, 'my-workflow')
  assert.equal(cfg.pluginMap.video_, undefined)
  assert.equal(cfg.pluginMap.omnimux_, 'omnimux')
  assert.equal(cfg.pluginMap.brand_new_, 'x')
})

test('event names are configurable', () => {
  const cfg = parseAnalyticsConfig({
    websiteId: 'w',
    toolEventName: 'omni-tool',
    sessionEventName: 'omni-session',
    loadEventName: 'omni-load',
  })
  assert.equal(cfg.toolEventName, 'omni-tool')
  assert.equal(cfg.sessionEventName, 'omni-session')
  assert.equal(cfg.loadEventName, 'omni-load')
})
