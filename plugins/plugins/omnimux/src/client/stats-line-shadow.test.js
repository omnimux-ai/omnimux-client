import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMPOSER_DOCK_SLOT,
  STATS_LINE_SLOT_ID,
  STATS_LINE_SHADOW_PRIORITY,
  StatsLineShadow,
  installStatsLineShadow,
} from './stats-line-shadow.js'

function fakeSlots() {
  /** @type {Array<{ name: string, options: object, component: unknown }>} */
  const entries = []
  return {
    entries,
    lastInject: null,
    inject(name, callback) {
      this.lastInject = name
      callback()
    },
    register(options, component) {
      entries.push({ name: options.name, options, component })
      return () => {}
    },
  }
}

describe('stats-line-shadow', () => {
  it('exports expected constants', () => {
    assert.equal(COMPOSER_DOCK_SLOT, 'conversation.composer.dock')
    assert.equal(STATS_LINE_SLOT_ID, 'stats')
    assert.equal(STATS_LINE_SHADOW_PRIORITY, -10)
  })

  it('StatsLineShadow component renders null', () => {
    assert.equal(StatsLineShadow(), null)
  })

  it('installStatsLineShadow registers shadow occupant in conversation.composer.dock', () => {
    const slots = fakeSlots()
    installStatsLineShadow({ slots })

    assert.equal(slots.lastInject, COMPOSER_DOCK_SLOT)
    assert.equal(slots.entries.length, 1)

    const entry = slots.entries[0]
    assert.equal(entry.name, COMPOSER_DOCK_SLOT)
    assert.equal(entry.options.name, COMPOSER_DOCK_SLOT)
    assert.equal(entry.options.id, STATS_LINE_SLOT_ID)
    assert.equal(entry.options.priority, STATS_LINE_SHADOW_PRIORITY)
    assert.equal(entry.component, StatsLineShadow)
  })

  it('installStatsLineShadow handles missing or invalid slots gracefully', () => {
    // null or undefined ctx
    assert.doesNotThrow(() => installStatsLineShadow(null))
    assert.doesNotThrow(() => installStatsLineShadow(undefined))
    assert.doesNotThrow(() => installStatsLineShadow({}))

    // missing register
    assert.doesNotThrow(() => installStatsLineShadow({ slots: { inject() {} } }))

    // missing inject
    assert.doesNotThrow(() => installStatsLineShadow({ slots: { register() {} } }))
  })
})
