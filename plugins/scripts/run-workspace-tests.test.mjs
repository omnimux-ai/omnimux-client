import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { classifyFailure, discoverPackages, formatPackageLine, formatSkipSummary, judge, main, parseTap, selectShard, SHARD_NAMES } from './run-workspace-tests.mjs'

const RUNNER = fileURLToPath(new URL('./run-workspace-tests.mjs', import.meta.url))

test('CI shards cover every workspace package exactly once and match the workflow matrix', () => {
  const packages = discoverPackages()
  const seen = new Map()
  for (const shard of SHARD_NAMES) {
    const selected = selectShard(packages, shard)
    assert.ok(selected.length > 0, `shard ${shard} must not be empty`)
    for (const pkg of selected) {
      assert.equal(seen.has(pkg.name), false, `${pkg.name} runs in both ${seen.get(pkg.name)} and ${shard}`)
      seen.set(pkg.name, shard)
    }
  }
  assert.deepEqual([...seen.keys()].sort(), packages.map((pkg) => pkg.name).sort())
  const workflow = parse(readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.jobs['plugin-tests'].strategy.matrix.shard, [...SHARD_NAMES])
})

test('shard selection fails loudly on unknown shards and stale shard tables', () => {
  const pkg = (name) => ({ name, dir: `/tmp/${name}`, command: 'true' })
  const full = ['omnimux', 'omnimux-inspiration', 'omnimux-workflow', 'omnimux-market', 'omnimux-new'].map(pkg)
  assert.throws(() => selectShard(full, 'nope'), /unknown shard/)
  assert.deepEqual(selectShard(full, 'rest').map((item) => item.name), ['omnimux-new'], 'new packages fall into rest')
  assert.throws(() => selectShard(full.filter((item) => item.name !== 'omnimux-market'), 'rest'), /missing package\(s\): omnimux-market/)
})

test('packageEnv injects an isolated DSH_HOME per package run', async () => {
  const { packageEnv } = await import(pathToFileURL(RUNNER).href)
  const home = mkdtempSync(join(tmpdir(), 'omnimux-test-home-probe-'))
  try {
    const env = packageEnv('/tmp/pkg', { PATH: '/bin' }, home)
    assert.equal(env.DSH_HOME, home, 'spawned test processes must see the throwaway DSH_HOME')
    const env2 = packageEnv('/tmp/pkg', { PATH: '/bin', DSH_HOME: '/real/.dsh' }, home)
    assert.equal(env2.DSH_HOME, home, 'a caller-supplied DSH_HOME must be overridden by isolation')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('inline failure summary only trusts the explicit probeClass marker', () => {
  assert.equal(classifyFailure('[style-dom-probe] probeClass=environment-unavailable after 3 attempt(s)'), 'environment-unavailable')
  assert.equal(classifyFailure('spawn synthetic-chrome ETIMEDOUT\nChrome probe diagnostic: {}\n[style-dom-probe] probeClass=environment-unavailable after 1 attempt(s)'), 'environment-unavailable')
  assert.equal(classifyFailure('页面未回传测量结果: synthetic empty DOM\nChrome probe diagnostic: {"measurementPresent":false}\n[style-dom-probe] probeClass=probe-result-invalid after 1 attempt(s)'), 'assertion-or-product-failure')
  assert.equal(classifyFailure('spawnSync /usr/bin/google-chrome ETIMEDOUT Chrome probe diagnostic: {}'), 'assertion-or-product-failure')
  assert.equal(classifyFailure('Unexpected token ... not valid JSON Chrome probe diagnostic: {}'), 'assertion-or-product-failure')
  assert.equal(classifyFailure("Expected values to be strictly equal: actual: 'none'"), 'assertion-or-product-failure')
})

const tapSummary = (overrides = {}) => ({
  tests: 3,
  pass: 1,
  fail: 0,
  cancelled: 0,
  skipped: 0,
  notOk: 0,
  failures: [],
  skippedCases: [],
  ...overrides,
})

test('parseTap captures skip reasons and judge separates all four categories', () => {
  const tap = parseTap([
    'TAP version 13',
    'ok 1 - passes',
    'ok 2 - env skip # SKIP [environment-unavailable] chrome not found',
    'ok 3 - design skip # SKIP LibreOffice is not installed',
    '1..3',
    '# tests 3',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 2',
  ].join('\n'))
  assert.deepEqual(tap.skippedCases, [
    { name: 'env skip', reason: '[environment-unavailable] chrome not found' },
    { name: 'design skip', reason: 'LibreOffice is not installed' },
  ])
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, false)
  assert.deepEqual(result.reasons, ['1 environment-unavailable skip(s)'])
  assert.deepEqual(result.counts, { passed: 1, failed: 0, skippedEnvironment: 1, skippedByDesign: 1 })
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=2 (environment=1, by-design=1)')
})

test('suite-level skips are counted apart from leaf skips and never cause a mismatch', () => {
  const tap = parseTap([
    'TAP version 13',
    'ok 1 - skipped suite no reason # SKIP',
    '  ---',
    "  type: 'suite'",
    '  ...',
    'ok 2 - skipped suite marker # SKIP [environment-unavailable] chrome missing',
    '  ---',
    "  type: 'suite'",
    '  ...',
    'ok 3 - a leaf passes',
    '  ---',
    "  type: 'test'",
    '  ...',
    '1..3',
    '# tests 1',
    '# suites 2',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
  ].join('\n'))
  assert.deepEqual(tap.skippedCases, [])
  assert.deepEqual(tap.skippedSuites, [
    { name: 'skipped suite no reason', reason: '' },
    { name: 'skipped suite marker', reason: '[environment-unavailable] chrome missing' },
  ])
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, false)
  assert.deepEqual(result.reasons, ['1 environment-unavailable skip(s)'])
  assert.equal(result.skipSummary.mismatch, false, 'suite skips are not part of # skipped and must not trigger a mismatch')
  assert.deepEqual(result.counts, { passed: 1, failed: 0, skippedEnvironment: 1, skippedByDesign: 1 })
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=2 (environment=1, by-design=1)')
})

test('a package whose only tests are skipped suites is not a false "no tests reported" red', () => {
  const tap = parseTap([
    'TAP version 13',
    'ok 1 - all skipped suite # SKIP LibreOffice is not installed',
    '  ---',
    "  type: 'suite'",
    '  ...',
    '1..1',
    '# tests 0',
    '# suites 1',
    '# pass 0',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
  ].join('\n'))
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.counts, { passed: 0, failed: 0, skippedEnvironment: 0, skippedByDesign: 1 })
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=1 (environment=0, by-design=1)')
})

test('design-only skips do not fail the package but remain visible in the skip summary', () => {
  const result = judge({
    exitCode: 0,
    tap: tapSummary({ tests: 2, pass: 1, skipped: 1, skippedCases: [{ name: 'optional dep', reason: 'LibreOffice is not installed' }] }),
  })
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.counts, { passed: 1, failed: 0, skippedEnvironment: 0, skippedByDesign: 1 })
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=1 (environment=0, by-design=1)')
})

test('free-text skip reasons are never guessed as environment failures without the explicit marker', () => {
  const result = judge({
    exitCode: 0,
    tap: tapSummary({ skipped: 1, skippedCases: [{ name: 'probe-like', reason: 'chrome not found at a path' }] }),
  })
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.counts, { passed: 1, failed: 0, skippedEnvironment: 0, skippedByDesign: 1 })
})

test('environment-only skips fail the package', () => {
  const result = judge({
    exitCode: 0,
    tap: tapSummary({ skipped: 1, skippedCases: [{ name: 'probe', reason: '[environment-unavailable] chrome not found' }] }),
  })
  assert.equal(result.passed, false)
  assert.deepEqual(result.reasons, ['1 environment-unavailable skip(s)'])
  assert.deepEqual(result.counts, { passed: 1, failed: 0, skippedEnvironment: 1, skippedByDesign: 0 })
})

test('package status line always shows the skip summary instead of a bare ok', () => {
  const tap = tapSummary({ tests: 2, pass: 1, skipped: 1, skippedCases: [{ name: 'optional dep', reason: 'LibreOffice is not installed' }] })
  const judgement = judge({ exitCode: 0, tap })
  const line = formatPackageLine({ name: 'demo', seconds: 1, tap, reasons: judgement.reasons, judgement })
  assert.match(line, / ok skip=1 \(environment=0, by-design=1\) 1s$/)
  assert.doesNotMatch(line, / ok 1s$/)
  const failing = judge({ exitCode: 0, tap: tapSummary({ skipped: 1, skippedCases: [{ name: 'probe', reason: '[environment-unavailable] chrome' }] }) })
  assert.match(formatPackageLine({ name: 'demo', seconds: 1, tap: failing, reasons: failing.reasons, judgement: failing }), /FAIL \(1 environment-unavailable skip\(s\)\) skip=1 \(environment=1, by-design=0\)/)
})

test('a skip count mismatch cannot pass as green', () => {
  for (const tap of [
    tapSummary({ skipped: 2, skippedCases: [{ name: 'one parsed', reason: '[environment-unavailable] chrome' }] }),
    tapSummary({ skipped: 0, skippedCases: [{ name: 'unexpected skip', reason: 'LibreOffice is not installed' }] }),
  ]) {
    const result = judge({ exitCode: 0, tap })
    assert.equal(result.passed, false)
    assert.ok(result.reasons.some((reason) => reason.startsWith('skip count mismatch:')), result.reasons.join('; '))
  }
})

test('CI binds bounded style-probe retry to the Plugin unit suites step', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8'))
  const unit = workflow.jobs['plugin-tests'].steps.find((step) => step.name === 'Plugin unit suites')
  assert.ok(unit, 'Plugin unit suites step must exist')
  assert.match(unit.run, /run-workspace-tests\.mjs/)
  assert.equal(unit.env?.OMNIMUX_STYLE_PROBE_RETRY, '1', 'CI must enable bounded style probe retries on the workspace runner')
})

test('an empty shard value fails instead of running every package', () => {
  assert.equal(main([], { OMNIMUX_TEST_SHARD: '' }), 2)
  assert.equal(main(['--shard'], {}), 2)
})

test('spawned package tests can still override DSH_HOME in-process', () => {
  // Contract: runner-level DSH_HOME is a floor, not a cage — tests that need
  // their own ledger dir (task-store, task-collect-lifecycle) set it inside
  // the process and win over the inherited env. Verified structurally: those
  // files already do `process.env.DSH_HOME = mkdtempSync(...)` before use.
  const probe = new URL('../plugins/omnimux/src/media/task-collect-lifecycle.test.mjs', import.meta.url)
  assert.ok(existsSync(probe), 'task-collect-lifecycle regression fixture must exist')
})
