import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyPreserveExisting,
  missingGroupRatios,
  parseArgs,
} from '../plugins/omnimux/scripts/catalog-snapshot.mjs'

const script = fileURLToPath(new URL('../plugins/omnimux/scripts/catalog-snapshot.mjs', import.meta.url))
const pluginsRoot = fileURLToPath(new URL('..', import.meta.url))
/** The PR base; its bundled snapshot still sells gemini-3.1-flash-lite-image. */
const BASE_WITH_DROPPED_MODEL = '2febd79e436eca7cc74d74892f9346b9b1b84565'

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

function runScriptAsync(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], options)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

test('--preserve-existing is opt-in and requires a git ref', () => {
  assert.equal(parseArgs([]).preserveExisting, null)
  assert.equal(parseArgs(['--check']).preserveExisting, null)
  assert.equal(parseArgs(['--preserve-existing', 'origin/main']).preserveExisting, 'origin/main')
  assert.throws(() => parseArgs(['--preserve-existing']), /requires a git ref/)
  assert.throws(() => parseArgs(['--preserve-existing', '--stdout']), /requires a git ref/)
})

test('generation refuses to combine --check with --preserve-existing', () => {
  const result = spawnSync(process.execPath, [script, '--check', '--preserve-existing', 'origin/main'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--preserve-existing only applies when generating/)
})

test('--baseline stays a --check-only flag', () => {
  const result = spawnSync(process.execPath, [script, '--baseline', BASE_WITH_DROPPED_MODEL], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--baseline only applies with --check/)
})

test('bare generation refuses an unpriced enableGroup before writing or printing', async () => {
  // /api/pricing publishes `default` as a line but forgets its group ratio.
  // A bare run must fail closed instead of writing a snapshot the picker cannot price.
  const payload = {
    data: [{
      model_name: 'fixture-model',
      enable_groups: ['default'],
      supported_endpoint_types: ['openai'],
      billing_mode: null,
      model_price: 1,
      quota_type: 1,
      contract: {},
    }],
    group_ratio: {},
    usable_group: {},
    auto_groups: [],
  }
  const server = createServer((request, response) => {
    assert.match(String(request.url), /\/api\/pricing$/)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const dir = mkdtempSync(join(tmpdir(), 'catalog-snapshot-bare-'))
  try {
    const url = `http://127.0.0.1:${port}/api/pricing`
    const write = await runScriptAsync(['--url', url, '--dir', dir], { cwd: pluginsRoot })
    assert.notEqual(write.status, 0)
    assert.match(write.stderr, /refusing to write: enableGroups without a group ratio: default/)
    assert.equal(existsSync(join(dir, 'pricing.json')), false)

    const print = await runScriptAsync(['--url', url, '--dir', dir, '--stdout'], { cwd: pluginsRoot })
    assert.notEqual(print.status, 0)
    assert.equal(print.stdout, '')
    assert.match(print.stderr, /refusing to write: enableGroups without a group ratio: default/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
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

test('carry-over never lets a baseline value leak into a group only live-only rows name', () => {
  const live = {
    source: 'pricing',
    groups: {
      ratio: { shared: 2 },
      usable: { shared: 'live shared' },
      auto: [],
    },
    models: [{ id: 'fresh', enableGroups: ['shared'] }],
  }
  const baseline = {
    groups: {
      ratio: { shared: 9 },
      usable: { shared: 'base shared' },
      auto: [],
    },
    models: [{ id: 'removed', enableGroups: ['shared'] }],
  }
  const merged = applyPreserveExisting(live, baseline)
  assert.deepEqual(merged.models.map((model) => model.id), ['fresh'])
  assert.equal(merged.groups.ratio.shared, 2)
  assert.equal(merged.groups.usable.shared, 'live shared')
})

test('missingGroupRatios reports enableGroups without a ratio entry and accepts a complete snapshot', () => {
  assert.deepEqual(missingGroupRatios(liveSnapshot()), [])
  const broken = liveSnapshot()
  broken.groups.ratio = { liveOnly: 1 }
  assert.deepEqual(missingGroupRatios(broken), ['legacy', 'shared'])
  // `auto` is the gateway routing meta-group, not a priced lane.
  assert.deepEqual(missingGroupRatios({ models: [{ id: 'x', enableGroups: ['auto'] }], groups: { ratio: {} } }), [])
})

test('--check --baseline reads the base snapshot and reports the deliberate model drop', () => {
  const result = spawnSync(process.execPath, [script, '--check', '--baseline', BASE_WITH_DROPPED_MODEL], {
    cwd: pluginsRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /1 on-sale model\(s\) disappeared/)
  assert.match(result.stderr, /gemini-3\.1-flash-lite-image/)
})
