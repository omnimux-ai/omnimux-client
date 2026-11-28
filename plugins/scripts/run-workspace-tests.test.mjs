import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { classifyFailure, discoverPackages, formatPackageLine, formatSkipSummary, judge, main, parseTap, parseVitestSummary, selectShard, SHARD_NAMES } from './run-workspace-tests.mjs'

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
  skippedSuites: [],
  vitest: { found: false, passed: 0, failed: 0, expectedFail: 0, skipped: 0, pending: 0, total: 0, malformed: [] },
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

test('real node:test describe.skip output is parsed as a suite skip and does not fail the package', () => {
  // Verbatim `node --test --test-reporter=tap` output for a file containing
  // `describe.skip('all skipped', () => it(...))` plus one passing suite
  // (Node 25.8.0). Kept as captured bytes so the test pins Node's real
  // suite-skip shape: `ok N - name # SKIP`, YAML `type: 'suite'`, and
  // `# skipped 0` because the skipped suite does not count a leaf test.
  const tap = parseTap([
    'TAP version 13',
    '# Subtest: all skipped',
    'ok 1 - all skipped # SKIP',
    '  ---',
    '  duration_ms: 0.192667',
    "  type: 'suite'",
    '  ...',
    '# Subtest: runs',
    '    # Subtest: passes',
    '    ok 1 - passes',
    '      ---',
    '      duration_ms: 0.144167',
    "      type: 'test'",
    '      ...',
    '    1..1',
    'ok 2 - runs',
    '  ---',
    '  duration_ms: 0.277375',
    "  type: 'suite'",
    '  ...',
    '1..2',
    '# tests 1',
    '# suites 2',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
  ].join('\n'))
  assert.equal(tap.skippedCases.length, 0, 'a suite skip must never be counted as a leaf skip')
  assert.deepEqual(tap.skippedSuites.map((item) => item.name), ['all skipped'])
  assert.equal(tap.skipped, 0, 'node reports leaf skips only')
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, true, result.reasons.join('; '))
  assert.equal(result.skipSummary.mismatch, false)
  assert.deepEqual(result.counts, { passed: 1, failed: 0, skippedEnvironment: 0, skippedByDesign: 1 })
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=1 (environment=0, by-design=1)')
})

test('vitest default reporter summary is parsed so skipped tests are counted', () => {
  // Strings below are verbatim from vitest 4.1.12 default reporter output.
  assert.deepEqual(parseVitestSummary('      Tests  1 passed | 1 skipped (2)'), {
    found: true, passed: 1, failed: 0, expectedFail: 0, skipped: 1, pending: 0, total: 2, malformed: [],
  })
  assert.deepEqual(parseVitestSummary(' Tests  2 skipped (2)'), {
    found: true, passed: 0, failed: 0, expectedFail: 0, skipped: 2, pending: 0, total: 2, malformed: [],
  })
  assert.deepEqual(parseVitestSummary(' Tests  1 failed | 1 passed (2)'), {
    found: true, passed: 1, failed: 1, expectedFail: 0, skipped: 0, pending: 0, total: 2, malformed: [],
  })
  assert.deepEqual(parseVitestSummary(' Tests  1 passed | 1 todo (2)'), {
    found: true, passed: 1, failed: 0, expectedFail: 0, skipped: 0, pending: 1, total: 2, malformed: [],
  })
  // Real extension output: expected failures are reported separately and must not
  // be mistaken for skips or makes the declared total look short.
  assert.deepEqual(parseVitestSummary('      Tests  1795 passed | 1 expected fail (1796)'), {
    found: true, passed: 1795, failed: 0, expectedFail: 1, skipped: 0, pending: 0, total: 1796, malformed: [],
  })
  // ANSI colors from a TTY must not hide the counts.
  assert.deepEqual(parseVitestSummary(' \u001b[1mTests\u001b[22m  \u001b[32m1 passed\u001b[39m | \u001b[33m1 skipped\u001b[39m (2)'), {
    found: true, passed: 1, failed: 0, expectedFail: 0, skipped: 1, pending: 0, total: 2, malformed: [],
  })
  // Two vitest invocations concatenated (main suite + extension suite) sum.
  assert.deepEqual(parseVitestSummary(' Tests  3 passed (3)\n Tests  1 passed | 1 skipped (2)'), {
    found: true, passed: 4, failed: 0, expectedFail: 0, skipped: 1, pending: 0, total: 5, malformed: [],
  })
  // A `Test Files` line alone is not a Tests summary.
  assert.equal(parseVitestSummary(' Test Files  1 passed (1)').found, false)
  // An unrecognisable or arithmetically inconsistent summary is surfaced, never silently dropped.
  assert.deepEqual(parseVitestSummary(' Tests  1 passed | 1 mystery (2)').malformed, ['1 passed | 1 mystery (2)'])
  assert.deepEqual(parseVitestSummary(' Tests  1 passed (2)').malformed, ['1 passed (2)'])
})

test('vitest skipped/todo tests fail the package instead of passing silently', () => {
  const tap = tapSummary({
    tests: 5,
    pass: 5,
    vitest: { found: true, passed: 5, failed: 0, expectedFail: 0, skipped: 2, pending: 0, total: 7, malformed: [] },
  })
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((reason) => reason.includes('unclassified vitest skip(s)')), result.reasons.join('; '))
  assert.equal(result.skipSummary.vitestUnclassified, 2)
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=2 (environment=0, by-design=0, vitest-unclassified=2)')
  const line = formatPackageLine({ name: 'demo', seconds: 1, tap, reasons: result.reasons, judgement: result })
  assert.match(line, /FAIL .*vitest-unclassified=2/)
})

test('vitest failures and unreadable summaries are fail-closed even when the shell exits 0', () => {
  const failed = judge({
    exitCode: 0,
    tap: tapSummary({ vitest: { found: true, passed: 1, failed: 1, expectedFail: 0, skipped: 0, pending: 0, total: 2, malformed: [] } }),
  })
  assert.equal(failed.passed, false)
  assert.deepEqual(failed.reasons, ['1 vitest failure(s) not represented in TAP counters'])
  const malformed = judge({
    exitCode: 0,
    tap: tapSummary({ vitest: { found: true, passed: 0, failed: 0, expectedFail: 0, skipped: 0, pending: 0, total: 0, malformed: ['1 passed (2)'] } }),
  })
  assert.equal(malformed.passed, false)
  assert.deepEqual(malformed.reasons, ['vitest summary unreadable: 1 passed (2)'])
})

test('a passing vitest-only package is not a false "no tests reported" red', () => {
  const tap = tapSummary({
    tests: 0,
    pass: 0,
    vitest: { found: true, passed: 4, failed: 0, expectedFail: 0, skipped: 0, pending: 0, total: 4, malformed: [] },
  })
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, true, result.reasons.join('; '))
  assert.deepEqual(result.reasons, [])
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

test('real Vitest --reporter=tap nested # SKIP output is classified as vitest-unclassified without skip count mismatch', () => {
  // Verbatim capture from `omnimux-browser` `vitest run --config vitest.e2e.config.ts --reporter=tap`:
  // skipped suites open with `# SKIP {` (no `# time=`), leaf `# SKIP` items have no reason and
  // Vitest emits no `# skipped` summary counter.
  const raw = [
    'TAP version 13',
    '1..5',
    'ok 1 - tests/e2e/bridge-extension.e2e.spec.ts # time=2.14ms {',
    '    1..1',
    '    ok 1 - extension <-> migrated bridge smoke # time=0.96ms {',
    '        1..1',
    '        ok 1 - connects, negotiates caps, and initializes a Session through the private bridge protocol # time=0.79ms',
    '    }',
    '}',
    'ok 2 - tests/e2e/media-lit-transition.e2e.spec.ts # time=5.04ms {',
    '    1..2',
    '    ok 1 - the shelf shows only what is not already in the composer (\\#2114) # time=4.63ms {',
    '        1..2',
    '        ok 1 - filters the detected media by the attached ids # time=2.32ms',
    '        ok 2 - keeps the smaller chip and the hover-only remove control in the stylesheet # time=2.06ms',
    '    }',
    '    ok 2 - the chip measures 44px and reveals its remove control on hover (\\#2114) # SKIP {',
    '        1..1',
    '        ok 1 - matches the shipped stylesheet in a real browser # SKIP',
    '    }',
    '}',
    'ok 3 - tests/e2e/pairing-approval.e2e.spec.ts # SKIP {',
    '    1..1',
    '    ok 1 - one-click pairing (\\#2110) # SKIP {',
    '        1..1',
    '        ok 1 - pairs on one click, stores the token, and closes the approval tab # SKIP',
    '    }',
    '}',
    'ok 4 - tests/e2e/pairing-page.e2e.spec.ts # time=1298.18ms {',
    '    1..1',
    '    ok 1 - pairing page revision (\\#2116) # time=1297.64ms {',
    '        1..2',
    '        ok 1 - shows the request code with approve and cancel, and no input field # time=311.82ms',
    '        ok 2 - approving hands out the token once; cancelling never does # time=8.42ms',
    '    }',
    '}',
    'ok 5 - tests/e2e/pairing.e2e.spec.ts # SKIP {',
    '    1..1',
    '    ok 1 - pairing end to end (\\#2095) # SKIP {',
    '        1..2',
    '        ok 1 - pairs with the host code, persists the token, and connects # SKIP',
    '        ok 2 - refuses a web page origin # SKIP',
    '    }',
    '}',
  ].join('\n')

  const tap = parseTap(raw)
  assert.equal(tap.skipped, 0)
  assert.deepEqual(tap.skippedCases, [])
  assert.deepEqual(tap.skippedSuites, [])
  assert.deepEqual(tap.vitest, {
    found: true,
    passed: 5,
    failed: 0,
    expectedFail: 0,
    skipped: 4,
    pending: 0,
    total: 9,
    malformed: [],
  })

  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, false)
  assert.equal(result.skipSummary.mismatch, false)
  assert.equal(result.skipSummary.vitestUnclassified, 4)
  assert.equal(result.reasons.some((reason) => reason.includes('skip count mismatch')), false)
  assert.equal(result.reasons.some((reason) => reason.includes('unclassified vitest skip(s)')), true)
  assert.equal(formatSkipSummary(result.skipSummary), 'skip=4 (environment=0, by-design=0, vitest-unclassified=4)')
})

test('passing Vitest --reporter=tap output passes judge and ignores escaped # SKIP in test titles', () => {
  const tap = parseTap([
    'TAP version 13',
    '1..1',
    'ok 1 - tests/unit.spec.ts # time=4.20ms {',
    '    1..2',
    '    ok 1 - parses titles with \\# SKIP literally # time=1.10ms',
    '    ok 2 - passes normally # time=0.50ms',
    '}',
  ].join('\n'))
  assert.deepEqual(tap.vitest, {
    found: true,
    passed: 2,
    failed: 0,
    expectedFail: 0,
    skipped: 0,
    pending: 0,
    total: 2,
    malformed: [],
  })
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, true, result.reasons.join('; '))
  assert.deepEqual(result.reasons, [])
})

test('Vitest --reporter=tap todos, leaf failures with YAML braces, and unclosed blocks all fail closed', () => {
  const todoTap = parseTap([
    'TAP version 13',
    '1..1',
    'ok 1 - tests/todo.spec.ts # TODO {',
    '    1..1',
    '    ok 1 - pending feature # TODO',
    '}',
  ].join('\n'))
  const todoJudge = judge({ exitCode: 0, tap: todoTap })
  assert.equal(todoJudge.passed, false)
  assert.equal(todoJudge.skipSummary.mismatch, false)
  assert.equal(todoJudge.skipSummary.vitestUnclassified, 1)

  const failTap = parseTap([
    'TAP version 13',
    '1..1',
    'not ok 1 - tests/fail.spec.ts # time=3.00ms {',
    '    1..1',
    '    not ok 1 - explodes # time=1.00ms',
    '        ---',
    '        error:',
    '            name: "AssertionError"',
    '            message: "expected } to match {"',
    '        at: "tests/fail.spec.ts:12:3"',
    '        ...',
    '}',
  ].join('\n'))
  assert.equal(failTap.vitest.failed, 1)
  assert.deepEqual(failTap.failures, [
    { location: 'tests/fail.spec.ts:12:3', name: 'explodes', error: 'expected } to match {' },
  ])
  const failJudge = judge({ exitCode: 0, tap: failTap })
  assert.equal(failJudge.passed, false)
  assert.equal(failJudge.reasons.some((reason) => reason.includes('vitest failure(s)')), true)

  const unclosedTap = parseTap([
    'TAP version 13',
    '1..1',
    'ok 1 - tests/truncated.spec.ts # time=1.00ms {',
    '    1..1',
    '    ok 1 - partial # time=0.20ms',
  ].join('\n'))
  assert.deepEqual(unclosedTap.vitest.malformed, ['unclosed vitest TAP block'])
  const unclosedJudge = judge({ exitCode: 0, tap: unclosedTap })
  assert.equal(unclosedJudge.passed, false)
  assert.equal(unclosedJudge.reasons.some((reason) => reason.includes('vitest summary unreadable')), true)
})

test('combined node:test TAP and Vitest --reporter=tap keep node:test skip accounting intact', () => {
  const tap = parseTap([
    'TAP version 13',
    '1..1',
    'ok 1 - tests/e2e/sample.e2e.spec.ts # SKIP {',
    '    1..1',
    '    ok 1 - skipped browser test # SKIP',
    '}',
    'TAP version 13',
    'ok 1 - node design skip # SKIP LibreOffice is not installed',
    '1..1',
    '# tests 1',
    '# pass 0',
    '# fail 0',
    '# cancelled 0',
    '# skipped 1',
  ].join('\n'))
  assert.deepEqual(tap.skippedCases, [{ name: 'node design skip', reason: 'LibreOffice is not installed' }])
  assert.equal(tap.skipped, 1)
  assert.equal(tap.vitest.skipped, 1)
  const result = judge({ exitCode: 0, tap })
  assert.equal(result.passed, false)
  assert.equal(result.skipSummary.mismatch, false)
  assert.equal(result.skipSummary.byDesign, 1)
  assert.equal(result.skipSummary.vitestUnclassified, 1)
  assert.equal(result.reasons.some((reason) => reason.includes('skip count mismatch')), false)
  assert.equal(result.reasons.some((reason) => reason.includes('1 unclassified vitest skip(s)')), true)
})
