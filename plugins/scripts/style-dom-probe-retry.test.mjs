import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { runStyleDomProbe } from './test-fixtures/style-dom-probe.mjs'

const input = { name: 'retry-probe', styles: '', html: '', measure: () => ({ ok: true }) }
const RESULT = '<html><head><title>RESULT:{"ok":true}</title></head></html>'

function timeoutError() {
  return Object.assign(new Error('spawn synthetic-chrome ETIMEDOUT'), { code: 'ETIMEDOUT' })
}

function makeSpawn(outcomes, onSpawn) {
  let index = 0
  return (binary, args, options) => {
    const current = outcomes[Math.min(index, outcomes.length - 1)]
    index += 1
    onSpawn?.(current, options)
    if (current.stdout) writeFileSync(options.stdio[1], current.stdout)
    if (current.stderr) writeFileSync(options.stdio[2], current.stderr)
    return {
      status: current.status ?? 0,
      signal: current.signal ?? null,
      error: current.error,
    }
  }
}

test('retries a timed-out Chrome once with 1s backoff and returns the second result', () => {
  const calls = []
  const sleeps = []
  const spawn = makeSpawn([
    { status: 0, signal: null, stdout: '', stderr: 'cold start', error: timeoutError() },
    { status: 0, signal: null, stdout: RESULT, stderr: '' },
  ], (outcome, options) => calls.push({ outcome, options }))

  const result = runStyleDomProbe(input, {
    retry: true,
    chromeBinary: 'synthetic-chrome',
    spawnSync: spawn,
    sleep: (ms) => sleeps.push(ms),
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [1000])
  assert.equal(calls[0].options.timeout, 15000)
  assert.equal(calls[1].options.timeout, 15000)
  assert.equal(calls[0].options.killSignal, 'SIGKILL')
})

test('caps retries at three attempts with 1s then 2s backoff', () => {
  const calls = []
  const sleeps = []
  const spawn = makeSpawn([{ status: 0, signal: null, stdout: '', stderr: 'cold start', error: timeoutError() }], () => calls.push(1))

  assert.throws(
    () => runStyleDomProbe(input, {
      retry: true,
      chromeBinary: 'synthetic-chrome',
      spawnSync: spawn,
      sleep: (ms) => sleeps.push(ms),
    }),
    (error) => {
      assert.equal(error.code, 'ETIMEDOUT')
      assert.equal(error.probeClass, 'environment-unavailable')
      assert.equal(error.probeAttempts.length, 3)
      assert.match(error.message, /environment-unavailable after 3 attempt\(s\)/)
      return true
    },
  )
  assert.equal(calls.length, 3)
  assert.deepEqual(sleeps, [1000, 2000])
})

test('stops before a second attempt when the total budget is exhausted', () => {
  const calls = []
  let clock = 0
  const spawn = makeSpawn([{ status: 0, signal: null, stdout: '', stderr: 'cold start', error: timeoutError() }], () => {
    calls.push(1)
    clock += 15000
  })

  assert.throws(
    () => runStyleDomProbe(input, {
      retry: true,
      chromeBinary: 'synthetic-chrome',
      spawnSync: spawn,
      now: () => clock,
      sleep: (ms) => { clock += ms },
      attemptTimeoutMs: 15000,
      totalBudgetMs: 16000,
      maxAttempts: 3,
    }),
    (error) => {
      assert.equal(error.code, 'ETIMEDOUT')
      assert.equal(error.probeAttempts.length, 1)
      assert.equal(error.diagnostic.timeoutMs, 15000)
      return true
    },
  )
  assert.equal(calls.length, 1)
})

test('quality gate stages plugin logs into the repo-root path consumed by upload-artifact', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8'))
  const plugin = workflow.jobs['plugin-tests']
  const stage = plugin.steps.find(step => step.name === 'Stage plugin test logs for artifact upload')
  assert.ok(stage, 'the log staging step must exist')
  assert.match(stage.run, /mkdir -p \.\.\/\.tmp/)
  assert.match(stage.run, /cp -R \.tmp\/ci-workspace-logs \.\.\/\.tmp\//)
  assert.match(stage.run, /cp \.tmp\/ci-workspace-summary\.json \.\.\/\.tmp\//)
  const upload = plugin.steps.find(step => step.name === 'Upload plugin test logs')
  assert.deepEqual(upload.with, { name: 'plugin-tests-${{ matrix.shard }}', path: '.tmp/ci-workspace-logs/\n.tmp/ci-workspace-summary.json\n', 'retention-days': 7, 'include-hidden-files': true })
})
