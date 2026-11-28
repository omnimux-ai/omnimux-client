#!/usr/bin/env node
/**
 * Runs every workspace package's `test` script the same way locally and in CI, and fails on
 * anything short of a clean pass.
 *
 * A package passes only when its test command exits 0, reports at least one test, its TAP
 * output contains no `not ok` line and no cancelled test, and every skip is accounted for.
 * The `not ok` scan matters because a suite that throws while collecting can print `not ok`
 * while node:test still exits 0. Environment skips are explicit-marker only; design skips
 * remain allowed but are printed in the package status line. Vitest's default reporter and
 * `--reporter=tap` carry no per-case skip reason, so both are parsed into `vitest` and any
 * vitest skip/todo is fail-closed as `vitest-unclassified`.
 *
 * Packages run without proxy variables so a test that silently depends on a reachable proxy
 * fails locally the same way it fails on a clean CI runner. HOME is left alone: headless Chrome
 * on macOS aborts when HOME points at an empty directory, and the CI runner already has a clean
 * HOME of its own. Each package instead gets its own throwaway DSH_HOME so code paths that
 * resolve hubHomeDir() (media task ledger, auth store, plugin manage routes, …) can never
 * touch the developer machine's real ~/.dsh.
 *
 * Sharding (CI runs one shard per parallel job): `--shard <name>` or env `OMNIMUX_TEST_SHARD`.
 * Named shards list their packages explicitly; `rest` takes every package no named shard lists,
 * so a newly added package always runs somewhere. A listed package that no longer exists fails
 * the run instead of silently shrinking coverage.
 *
 * Usage: node scripts/run-workspace-tests.mjs [--json <file>] [--logs <dir>] [--shard <name>] [package-name ...]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_DIRS = ['plugins', 'packages']
const PROXY_VARIABLES = [
  'http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY',
]

/** @typedef {{ name: string, dir: string, command: string }} WorkspacePackage */

/**
 * Packages pinned to their own CI job, balanced by measured duration (merge_group run
 * 40513342576: omnimux 126s, inspiration 95s, workflow 60s + market 43s). Everything else is `rest`.
 */
export const TEST_SHARDS = Object.freeze({
  hub: Object.freeze(['omnimux']),
  inspiration: Object.freeze(['omnimux-inspiration']),
  'workflow-market': Object.freeze(['omnimux-workflow', 'omnimux-market']),
})
export const REST_SHARD = 'rest'
export const SHARD_NAMES = Object.freeze([...Object.keys(TEST_SHARDS), REST_SHARD])

/**
 * @param {WorkspacePackage[]} packages
 * @param {string} shard
 * @returns {WorkspacePackage[]}
 */
export function selectShard(packages, shard) {
  if (!SHARD_NAMES.includes(shard)) throw new Error(`unknown shard "${shard}" (expected one of: ${SHARD_NAMES.join(', ')})`)
  const names = new Set(packages.map((pkg) => pkg.name))
  const pinned = Object.values(TEST_SHARDS).flat()
  const missing = pinned.filter((name) => !names.has(name))
  if (missing.length) throw new Error(`shard table lists missing package(s): ${missing.join(', ')}`)
  if (shard === REST_SHARD) return packages.filter((pkg) => !pinned.includes(pkg.name))
  return packages.filter((pkg) => TEST_SHARDS[shard].includes(pkg.name))
}
/** @typedef {{ location: string, name: string, error: string }} TestFailure */
/** @typedef {{ name: string, reason: string }} SkippedCase */
/**
 * Vitest's default (non-TAP) reporter prints a human-readable summary such as
 * `Tests  1 passed | 1 skipped (2)` instead of node:test's `# tests` counters.
 * @typedef {{
 *   found: boolean, passed: number, failed: number, expectedFail: number,
 *   skipped: number, pending: number, total: number, malformed: string[],
 * }} VitestSummary
 */
/**
 * @typedef {{
 *   tests: number, pass: number, fail: number, cancelled: number, skipped: number,
 *   notOk: number, failures: TestFailure[], skippedCases: SkippedCase[],
 *   skippedSuites: SkippedCase[], vitest: VitestSummary,
 * }} TapSummary
 */

/** @returns {WorkspacePackage[]} */
export function discoverPackages(root = repoRoot) {
  const found = []
  for (const group of WORKSPACE_DIRS) {
    const base = join(root, group)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(base, entry.name)
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const command = manifest.scripts?.test
      if (typeof command === 'string' && command.trim()) found.push({ name: manifest.name || entry.name, dir, command })
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function sumCounter(text, key) {
  let total = 0
  for (const match of text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))) total += Number(match[1])
  return total
}

function stripAnsi(text) {
  // Vitest colors counts when it thinks it is on a TTY; strip escapes so the
  // summary parses the same locally and on a piped CI runner.
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

/**
 * Parses Vitest's default reporter summary. `omnimux-browser` runs
 * `vitest run` before a node:test command, and Vitest does not honor
 * `NODE_OPTIONS=--test-reporter=tap`, so without this its skipped tests are
 * invisible to the TAP parser and could pass silently. Several summaries may
 * be concatenated (vitest + extension vitest), so counts are summed.
 * @param {string} text
 * @returns {VitestSummary}
 */
export function parseVitestSummary(text) {
  const result = { found: false, passed: 0, failed: 0, expectedFail: 0, skipped: 0, pending: 0, total: 0, malformed: [] }
  for (const raw of stripAnsi(text).split('\n')) {
    // Vitest right-aligns the label, e.g. `      Tests  1 passed | 1 skipped (2)`.
    const match = /^\s*Tests\s{2,}(.+)$/.exec(raw.trimEnd())
    if (!match) continue
    result.found = true
    const body = match[1].trim()
    if (/^no tests$/i.test(body)) continue
    const declared = /\((\d+)\)\s*$/.exec(body)
    const statuses = declared ? body.slice(0, declared.index).trim() : body
    const parsed = { passed: 0, failed: 0, expectedFail: 0, skipped: 0, pending: 0 }
    let segments = 0
    let counted = 0
    for (const part of statuses.split('|')) {
      const segment = part.trim()
      if (!segment) continue
      const counts = /^(\d+)\s+(passed|failed|expected fail|skipped|todo)$/i.exec(segment)
      if (!counts) {
        segments = -1
        break
      }
      segments += 1
      const count = Number(counts[1])
      counted += count
      const kind = counts[2].toLowerCase().replace(' ', '')
      parsed[kind === 'expectedfail' ? 'expectedFail' : kind === 'todo' ? 'pending' : kind] += count
    }
    if (segments <= 0) {
      result.malformed.push(body)
      continue
    }
    for (const [kind, count] of Object.entries(parsed)) result[kind] += count
    if (!declared || Number(declared[1]) !== counted) result.malformed.push(body)
  }
  result.total = result.passed + result.failed + result.expectedFail + result.skipped + result.pending
  return result
}

const VITEST_TAP_OPENER_RE = /^( *)(not ok|ok) \d+ - (.*)\{\s*$/
const VITEST_TAP_NEXT_CHILD_RE = /^\s*(?:1\.\.\d+|(?:not )?ok \d+ - )/
const VITEST_TAP_DIRECTIVE_BEFORE_BRACE_RE = /(?:^|\s)(?<!\\)#\s*(?:time=\S+|SKIP|TODO)\b/i

function extractVitestTapBodyDirective(body) {
  const commentIndex = body.search(/(?:^|\s)(?<!\\)#/)
  const name = (commentIndex >= 0 ? body.slice(0, commentIndex) : body).trim()
  const comment = commentIndex >= 0 ? body.slice(commentIndex) : ''
  let directive = ''
  if (/(?:^|\s)(?<!\\)#\s*SKIP(?:\s+.*)?$/i.test(comment)) directive = 'skip'
  else if (/(?:^|\s)(?<!\\)#\s*TODO(?:\s+.*)?$/i.test(comment)) directive = 'todo'
  return { name, directive }
}

function finalizeVitestTapFailure(pending) {
  let location = ''
  let error = ''
  for (const raw of pending.yamlLines) {
    const trimmed = raw.trim()
    const locHit = /^(?:at|location):\s*(?:'([^']*)'|"([^"]*)"|(.+))$/.exec(trimmed)
    if (locHit && !location) {
      location = (locHit[1] ?? locHit[2] ?? locHit[3] ?? '').trim()
      continue
    }
    const msgHit = /^(?:message|error):\s*(?:'([^']*)'|"([^"]*)")$/.exec(trimmed)
    if (msgHit && !error) error = (msgHit[1] ?? msgHit[2] ?? '').trim()
  }
  return { location, name: pending.name, error }
}

/**
 * Parses Vitest `--reporter=tap` brace-delimited subtest blocks (`ok|not ok N - ... { ... }`).
 * Unlike `node:test`, Vitest TAP omits `# tests` / `# skipped` counter comments, so without this
 * its `# SKIP` lines look like unaccounted `node:test` skips (`skip count mismatch`) and its
 * `# TODO` lines are silently ignored. Every Vitest TAP skip/todo is counted into `vitest` so
 * `judge()` keeps failing closed as `vitest-unclassified`.
 * @param {string} text
 * @returns {{ summary: VitestSummary, failures: TestFailure[], lineIndices: Set<number> }}
 */
export function parseVitestTap(text) {
  const lines = stripAnsi(text).replace(/\r\n?/g, '\n').split('\n')
  /** @type {VitestSummary} */
  const summary = { found: false, passed: 0, failed: 0, expectedFail: 0, skipped: 0, pending: 0, total: 0, malformed: [] }
  /** @type {TestFailure[]} */
  const failures = []
  /** @type {Set<number>} */
  const lineIndices = new Set()
  /** @type {{ indent: number, directive: string, leafCount: number }[]} */
  const stack = []
  let inYaml = false
  let yamlIndent = -1
  /** @type {{ name: string, yamlLines: string[], expectYaml: boolean } | null} */
  let pendingFailure = null

  const flushPendingFailure = () => {
    if (!pendingFailure) return
    failures.push(finalizeVitestTapFailure(pendingFailure))
    pendingFailure = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (stack.length === 0) {
      const open = VITEST_TAP_OPENER_RE.exec(line)
      if (!open) continue
      const indent = open[1].length
      const { directive } = extractVitestTapBodyDirective(open[3])
      let looksLikeSubtest = VITEST_TAP_DIRECTIVE_BEFORE_BRACE_RE.test(open[3])
      if (!looksLikeSubtest) {
        for (let k = i + 1; k < lines.length; k++) {
          if (!lines[k].trim()) continue
          const nextIndent = /^( *)/.exec(lines[k])[1].length
          looksLikeSubtest = nextIndent > indent && VITEST_TAP_NEXT_CHILD_RE.test(lines[k])
          break
        }
      }
      if (!looksLikeSubtest) continue
      summary.found = true
      lineIndices.add(i)
      stack.push({ indent, directive, leafCount: 0 })
      continue
    }

    lineIndices.add(i)
    if (inYaml) {
      const endYaml = /^( *)\.\.\.\s*$/.exec(line)
      if (endYaml && endYaml[1].length === yamlIndent) {
        inYaml = false
        yamlIndent = -1
        flushPendingFailure()
      } else if (pendingFailure) {
        pendingFailure.yamlLines.push(line)
      }
      continue
    }

    const startYaml = /^( *)---\s*$/.exec(line)
    if (startYaml) {
      inYaml = true
      yamlIndent = startYaml[1].length
      continue
    }

    if (pendingFailure) flushPendingFailure()

    const closeMatch = /^( *)\}\s*$/.exec(line)
    if (closeMatch && closeMatch[1].length === stack[stack.length - 1].indent) {
      const frame = stack.pop()
      if (frame.leafCount === 0) {
        if (frame.directive === 'skip') summary.skipped += 1
        else if (frame.directive === 'todo') summary.pending += 1
      }
      if (stack.length > 0) stack[stack.length - 1].leafCount += frame.leafCount
      continue
    }

    const nestedOpen = VITEST_TAP_OPENER_RE.exec(line)
    if (nestedOpen) {
      const { directive } = extractVitestTapBodyDirective(nestedOpen[3])
      stack.push({ indent: nestedOpen[1].length, directive, leafCount: 0 })
      continue
    }

    const leaf = /^( *)(not ok|ok) \d+ - (.*)$/.exec(line)
    if (leaf) {
      stack[stack.length - 1].leafCount += 1
      const { name, directive } = extractVitestTapBodyDirective(leaf[3])
      if (directive === 'skip') summary.skipped += 1
      else if (directive === 'todo') summary.pending += 1
      else if (leaf[2] === 'not ok') {
        summary.failed += 1
        pendingFailure = { name, yamlLines: [], expectYaml: true }
      } else {
        summary.passed += 1
      }
    }
  }

  flushPendingFailure()
  if (stack.length > 0) summary.malformed.push('unclosed vitest TAP block')
  summary.total = summary.passed + summary.failed + summary.expectedFail + summary.skipped + summary.pending
  return { summary, failures, lineIndices }
}

/**
 * Combines Vitest default-reporter summaries with Vitest `--reporter=tap` counts.
 * @param {VitestSummary} summary
 * @param {VitestSummary} tapSummary
 * @returns {VitestSummary}
 */
function mergeVitestSummaries(summary, tapSummary) {
  if (!tapSummary.found) return summary
  if (!summary.found) return tapSummary
  const passed = summary.passed + tapSummary.passed
  const failed = summary.failed + tapSummary.failed
  const expectedFail = summary.expectedFail + tapSummary.expectedFail
  const skipped = summary.skipped + tapSummary.skipped
  const pending = summary.pending + tapSummary.pending
  return {
    found: true,
    passed,
    failed,
    expectedFail,
    skipped,
    pending,
    total: passed + failed + expectedFail + skipped + pending,
    malformed: [...summary.malformed, ...tapSummary.malformed],
  }
}

/**
 * Parses node:test and Vitest TAP output. Several runs may be concatenated (one per spawned test
 * command), so counters are summed. Only leaf failures are listed; parents that failed because
 * a subtest failed are counted but not repeated.
 * @param {string} text
 * @returns {TapSummary}
 */
export function parseTap(text) {
  const lines = text.split('\n')
  const vitestTap = parseVitestTap(text)
  /** @type {TestFailure[]} */
  const failures = [...vitestTap.failures]
  /** @type {SkippedCase[]} */
  const skippedCases = []
  /** @type {SkippedCase[]} */
  const skippedSuites = []
  let notOk = 0
  for (let i = 0; i < lines.length; i++) {
    if (vitestTap.lineIndices.has(i)) continue
    // node:test emits skipped tests as `ok N - name # SKIP reason`. Keep the
    // reason intact: it is the only thing judge() may use to distinguish an
    // explicit environment skip from a design/by-design skip.
    //
    // A `describe.skip` suite prints the same `ok … # SKIP` line but tags its
    // YAML block `type: 'suite'`. Node's `# tests` / `# skipped` counters count
    // only leaf tests, so a suite-level skip must be tracked apart from
    // `skippedCases`: otherwise it looks like an unaccounted skip (mismatch)
    // and a package whose tests all live in skipped suites looks like it
    // reported no tests.
    const skipped = /^\s*ok \d+ - (.*?)\s+#\s*SKIP(?:\s+(.*))?$/i.exec(lines[i])
    if (!skipped) continue
    let type = 'test'
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\.\.\.\s*$/.test(lines[j])) break
      // The TAP YAML block is indented; the first flush-left line ends it.
      if (!/^\s/.test(lines[j])) break
      const hit = /^\s*type:\s*'?([^'\s]+)'?\s*$/.exec(lines[j])
      if (hit) {
        type = hit[1]
        break
      }
    }
    const entry = { name: skipped[1], reason: (skipped[2] ?? '').trim() }
    if (type === 'suite') skippedSuites.push(entry)
    else skippedCases.push(entry)
  }
  for (let i = 0; i < lines.length; i++) {
    if (vitestTap.lineIndices.has(i)) continue
    const head = /^\s*not ok \d+ - (.*)$/.exec(lines[i])
    if (!head) continue
    notOk++
    const block = []
    for (let j = i + 1; j < lines.length && !/^\s*\.\.\.\s*$/.test(lines[j]); j++) block.push(lines[j])
    const body = block.join('\n')
    if (/failureType: 'subtestsFailed'/.test(body)) continue
    const location = /location: '([^']+)'/.exec(body)?.[1] ?? ''
    const inline = /error: '([^']*)'/.exec(body) ?? /error: "([^"]*)"/.exec(body)
    let error = inline?.[1] ?? ''
    if (!inline) {
      const start = block.findIndex((line) => /^\s*error: \|-?\s*$/.test(line))
      if (start >= 0) error = block.slice(start + 1, start + 4).map((line) => line.trim()).join(' ')
    }
    failures.push({ location, name: head[1], error })
  }
  return {
    tests: sumCounter(text, 'tests'),
    pass: sumCounter(text, 'pass'),
    fail: sumCounter(text, 'fail'),
    cancelled: sumCounter(text, 'cancelled'),
    skipped: sumCounter(text, 'skipped'),
    notOk,
    failures,
    skippedCases,
    skippedSuites,
    vitest: mergeVitestSummaries(parseVitestSummary(text), vitestTap.summary),
  }
}

/** @param {{ total: number, environment: number, byDesign: number, vitestUnclassified?: number }} skip */
export function formatSkipSummary(skip) {
  const extra = skip.vitestUnclassified > 0 ? `, vitest-unclassified=${skip.vitestUnclassified}` : ''
  return `skip=${skip.total} (environment=${skip.environment}, by-design=${skip.byDesign}${extra})`
}

/** Render the package status line; skips are always visible and never a bare `ok`. */
export function formatPackageLine(result) {
  const status = result.reasons.length ? `FAIL (${result.reasons.join(', ')})` : 'ok'
  const skipSummary = result.judgement.skipSummary.total > 0 || result.judgement.skipSummary.parsed > 0
    ? ` ${formatSkipSummary(result.judgement.skipSummary)}`
    : ''
  return `${result.name.padEnd(26)} tests=${String(result.tap.tests).padStart(5)} pass=${String(result.tap.pass).padStart(5)} fail=${result.tap.fail} cancelled=${result.tap.cancelled} ${status}${skipSummary} ${result.seconds}s`
}

/**
 * Classifies skip lines by explicit marker only. A skipped test without
 * `[environment-unavailable]` is by-design: free-text matching would turn
 * legitimate optional-dependency/platform skips into false red packages.
 *
 * Vitest's default reporter and `--reporter=tap` carry no per-case reason, so their
 * skipped/todo counts cannot be classified. They are fail-closed: an unlabelled Vitest skip
 * can never be shown as a passing package, because that is exactly the silent
 * hole this runner exists to close.
 * @param {{ exitCode: number | null, tap: TapSummary }} run
 * @returns {{
 *   passed: boolean,
 *   reasons: string[],
 *   counts: { passed: number, failed: number, skippedEnvironment: number, skippedByDesign: number },
 *   skipSummary: { total: number, parsed: number, environment: number, byDesign: number, mismatch: boolean, vitestUnclassified: number },
 * }}
 */
export function judge({ exitCode, tap }) {
  const skippedCases = Array.isArray(tap.skippedCases) ? tap.skippedCases : []
  const skippedSuites = Array.isArray(tap.skippedSuites) ? tap.skippedSuites : []
  const allSkipped = [...skippedCases, ...skippedSuites]
  const skippedEnvironment = allSkipped.filter((item) => String(item.reason || '').includes('[environment-unavailable]')).length
  const skippedByDesign = allSkipped.length - skippedEnvironment
  const vitest = tap.vitest && tap.vitest.found ? tap.vitest : null
  const vitestUnclassified = vitest ? (Number(vitest.skipped) || 0) + (Number(vitest.pending) || 0) : 0
  const vitestFailed = vitest ? (Number(vitest.failed) || 0) : 0
  const vitestTests = vitest
    ? (Number(vitest.passed) || 0) + vitestFailed + (Number(vitest.expectedFail) || 0) + vitestUnclassified
    : 0
  // `# skipped` only counts leaf tests; suite-level skips are not part of it.
  const skippedMismatch = tap.skipped !== skippedCases.length
  const reasons = []
  if (exitCode !== 0) reasons.push(`exit code ${exitCode}`)
  // A package whose only test points are skipped suites or Vitest-only runs has
  // `# tests 0` but did report tests; it must not read as "no tests".
  if (tap.tests === 0 && allSkipped.length === 0 && vitestTests === 0) reasons.push('no tests reported')
  if (tap.notOk > 0) reasons.push(`${tap.notOk} not ok line(s)`)
  if (tap.cancelled > 0) reasons.push(`${tap.cancelled} cancelled`)
  if (skippedEnvironment > 0) reasons.push(`${skippedEnvironment} environment-unavailable skip(s)`)
  // Vitest output carries no explicit environment marker, so every Vitest
  // skip/todo is treated as unclassified and fails the package (fail-closed).
  if (vitestUnclassified > 0) reasons.push(`${vitestUnclassified} unclassified vitest skip(s) (vitest reporter carries no reason)`)
  if (vitestFailed > 0) reasons.push(`${vitestFailed} vitest failure(s) not represented in TAP counters`)
  if (vitest && Array.isArray(vitest.malformed) && vitest.malformed.length > 0) {
    reasons.push(`vitest summary unreadable: ${vitest.malformed[0]}`)
  }
  if (skippedMismatch) reasons.push(`skip count mismatch: summary=${tap.skipped} parsed=${skippedCases.length}`)
  return {
    passed: reasons.length === 0,
    reasons,
    counts: {
      passed: tap.pass,
      failed: tap.fail,
      skippedEnvironment,
      skippedByDesign,
    },
    skipSummary: {
      total: (Number(tap.skipped) || 0) + skippedSuites.length + vitestUnclassified,
      parsed: allSkipped.length + vitestUnclassified,
      environment: skippedEnvironment,
      byDesign: skippedByDesign,
      mismatch: skippedMismatch,
      vitestUnclassified,
    },
  }
}

/** Environment for one package run: TAP reporter, repo-local bins first, no proxy, isolated DSH_HOME. */
export function packageEnv(pkgDir, base = process.env, dshHome) {
  const env = { ...base }
  for (const key of PROXY_VARIABLES) delete env[key]
  delete env.OMNIMUX_TEST_SHARD
  env.NODE_OPTIONS = [base.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ')
  env.PATH = [join(pkgDir, 'node_modules', '.bin'), join(repoRoot, 'node_modules', '.bin'), base.PATH].filter(Boolean).join(delimiter)
  env.DSH_HOME = dshHome
  return env
}

/**
 * Inline TAP summaries used to lose the probe diagnostic because the first 200
 * characters only carried the spawn error. The probe now writes an explicit
 * `[style-dom-probe] probeClass=...` marker into every failure message; only
 * the explicit environment marker is trusted here. A bare "Chrome probe
 * diagnostic" line accompanies every probe failure (including assertion
 * failures), so matching that text would mislabel real product regressions as
 * runner outages.
 * @param {string} error
 */
export function classifyFailure(error) {
  const text = String(error || '')
  if (text.includes('[style-dom-probe] probeClass=environment-unavailable')) {
    return 'environment-unavailable'
  }
  return 'assertion-or-product-failure'
}

function runPackage(pkg, logsDir) {
  const started = Date.now()
  // Fresh per-package ledger home; a test may still override DSH_HOME inside its
  // own process, which always wins over the inherited environment.
  const dshHome = mkdtempSync(join(tmpdir(), 'omnimux-test-home-'))
  let output, exitCode, tap
  try {
    const result = spawnSync('bash', ['-c', pkg.command], {
      cwd: pkg.dir,
      env: packageEnv(pkg.dir, process.env, dshHome),
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    })
    output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    tap = parseTap(output)
    exitCode = result.error ? -1 : result.status
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
  if (logsDir) writeFileSync(join(logsDir, `${pkg.name.replaceAll('/', '__')}.log`), output)
  const judgement = judge({ exitCode, tap })
  return { name: pkg.name, exitCode, seconds: Math.round((Date.now() - started) / 1000), tap, reasons: judgement.reasons, judgement }
}

function parseArgs(argv, env) {
  // An explicitly set but empty shard is a misconfiguration, not "run everything".
  const options = { json: '', logs: '', shard: Object.hasOwn(env, 'OMNIMUX_TEST_SHARD') ? env.OMNIMUX_TEST_SHARD : null, only: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') options.json = argv[++i]
    else if (argv[i] === '--logs') options.logs = argv[++i]
    else if (argv[i] === '--shard') options.shard = argv[++i] ?? ''
    else options.only.push(argv[i])
  }
  return options
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env)
  let packages = discoverPackages()
  if (options.shard !== null) {
    if (options.only.length) {
      console.error('--shard cannot be combined with explicit package names')
      return 2
    }
    try {
      packages = selectShard(packages, options.shard)
    } catch (error) {
      console.error(error.message)
      return 2
    }
    console.log(`shard ${options.shard}: ${packages.map((pkg) => pkg.name).join(', ')}`)
  }
  if (!packages.length) {
    console.error('no packages selected')
    return 2
  }
  if (options.only.length) {
    const unknown = options.only.filter((name) => !packages.some((pkg) => pkg.name === name))
    if (unknown.length) {
      console.error(`unknown package(s): ${unknown.join(', ')}`)
      return 2
    }
    packages = packages.filter((pkg) => options.only.includes(pkg.name))
  }
  if (options.logs) mkdirSync(options.logs, { recursive: true })

  const results = []
  for (const pkg of packages) {
    const result = runPackage(pkg, options.logs)
    results.push(result)
    console.log(formatPackageLine(result))
    for (const failure of result.tap.failures.slice(0, 50)) {
      const kind = classifyFailure(failure.error)
      console.log(`    ✖ [${kind}] ${failure.location || '(no location)'} — ${failure.name}${failure.error ? ` — ${failure.error.slice(0, 200)}` : ''}`)
    }
  }
  if (options.json) writeFileSync(options.json, `${JSON.stringify(results, null, 2)}\n`)

  const failed = results.filter((result) => result.reasons.length)
  console.log(`\n${results.length - failed.length}/${results.length} package(s) passed`)
  return failed.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main()
}
