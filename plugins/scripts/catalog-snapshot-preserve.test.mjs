import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyPreserveExisting,
  missingGroupRatios,
  parseArgs,
} from '../plugins/omnimux/scripts/catalog-snapshot.mjs'

const script = fileURLToPath(new URL('../plugins/omnimux/scripts/catalog-snapshot.mjs', import.meta.url))

/** A live-normalized snapshot: two rows, one of which also exists in the baseline. */
function liveSnapshot() {
  return {
    schemaVersion: 1,
    source: 'pricing',
    generatedAt: '2026-11-17T00:00:00.000Z',
    groups: {
      ratio: { shared: 2, legacy: 4, liveOnly: 1, unreferencedLive: 5 },
      usable: { shared: 'live shared', liveOnly: 'live only' },
      auto: ['shared'],
    },
    defaults: { chat: 'kept' },
    coverage: { models: 2, channels: null, limitations: [] },
    models: [
      { id: 'kept', enableGroups: ['legacy', 'shared'], billing: { modelPrice: 2 }, contract: { contractVersion: 'live' } },
      { id: 'fresh', enableGroups: ['liveOnly'], billing: { modelPrice: 4 }, contract: { contractVersion: 'live' } },
    ],
  }
}

function baselineSnapshot() {
  return {
    schemaVersion: 1,
    source: 'pricing',
    generatedAt: '2026-11-01T00:00:00.000Z',
    groups: {
      ratio: { legacy: 3, shared: 9, goneOnly: 7 },
      usable: { legacy: 'legacy label', shared: 'base shared' },
      auto: ['legacy', 'shared'],
    },
    models: [
      { id: 'kept', enableGroups: ['legacy', 'shared'], billing: { modelPrice: 1 }, contract: { contractVersion: 'base' } },
      { id: 'removed', enableGroups: ['goneOnly'], billing: { modelPrice: 8 }, contract: { contractVersion: 'base' } },
    ],
  }
}

test('--preserve-existing is opt-in and requires a git ref', () => {
  assert.equal(parseArgs([]).preserveExisting, null)
  assert.equal(parseArgs(['--check']).preserveExisting, null)
  assert.equal(parseArgs(['--preserve-existing', 'origin/main']).preserveExisting, 'origin/main')
  assert.throws(() => parseArgs(['--preserve-existing']), /requires a git ref/)
  assert.throws(() => parseArgs(['--preserve-existing', '--stdout']), /requires a git ref/)
})

test('generation refuses to combine --check with --preserve-existing before touching the network', () => {
  const result = spawnSync(process.execPath, [script, '--check', '--preserve-existing', 'origin/main'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--preserve-existing only applies when generating/)
})

test('carry-over keeps baseline rows for live models and leaves membership to the live response', () => {
  const live = liveSnapshot()
  const merged = applyPreserveExisting(live, baselineSnapshot())

  // Membership is the live response's: the baseline-only row is gone, the live-only row stays.
  assert.deepEqual(merged.models.map((model) => model.id), ['kept', 'fresh'])
  // Rows that exist on both sides keep the baseline payload verbatim…
  assert.deepEqual(merged.models[0], baselineSnapshot().models[0])
  // …and rows only the live response sells keep the live payload.
  assert.deepEqual(merged.models[1], live.models[1])
  // Top-level metadata and untouched groups stay live.
  assert.equal(merged.generatedAt, live.generatedAt)
  assert.equal(merged.source, 'pricing')
  assert.deepEqual(merged.defaults, live.defaults)
  assert.equal(merged.groups.ratio.liveOnly, 1)
  assert.equal(merged.groups.ratio.unreferencedLive, 5)
  assert.deepEqual(merged.groups.auto, ['shared'])

  // A carried-over row may name a group the live response dropped; its baseline ratio
  // and label come back so the row is still priceable.
  assert.equal(merged.groups.ratio.legacy, 3)
  assert.equal(merged.groups.usable.legacy, 'legacy label')
  // Groups named by a carried-over row prefer the baseline value, keeping old line prices.
  assert.equal(merged.groups.ratio.shared, 9)
  assert.equal(merged.groups.usable.shared, 'base shared')
  // Baseline-only groups no live row names are not resurrected.
  assert.equal('goneOnly' in merged.groups.ratio, false)

  assert.deepEqual(missingGroupRatios(merged), [])
})

test('missingGroupRatios reports enableGroups without a ratio entry and accepts a complete snapshot', () => {
  assert.deepEqual(missingGroupRatios(liveSnapshot()), [])
  const broken = liveSnapshot()
  broken.groups.ratio = { liveOnly: 1 }
  assert.deepEqual(missingGroupRatios(broken), ['legacy', 'shared'])
  // `auto` is the gateway routing meta-group, not a priced lane.
  assert.deepEqual(missingGroupRatios({ models: [{ id: 'x', enableGroups: ['auto'] }], groups: { ratio: {} } }), [])
})
