import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { captureDesktopInputs, verifyDesktopAcceptance } from './verify-desktop-acceptance.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-ac-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const repo = join(directory, 'source')
  const evidence = join(directory, 'evidence')
  mkdirSync(repo)
  mkdirSync(evidence)
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  const commit = (path, content) => {
    writeFileSync(join(repo, path), content)
    git('add', path)
    git('commit', '-qm', path)
    return git('rev-parse', 'HEAD')
  }
  mkdirSync(join(repo, 'app'))
  const head = commit('app/shell.js', 'source')
  const artifact = (path, value) => {
    writeFileSync(join(evidence, path), value)
    return { path, sha256: createHash('sha256').update(value).digest('hex') }
  }
  const steps = ['two-images', 'add-video', 'disconnect-video']
  const required = { issue: 62, cases: [{ id: 'AC-3', steps, sameSubject: true }] }
  const report = {
    issue: 62,
    build: { ...captureDesktopInputs(repo, head), artifacts: [artifact('client.js', 'built client')] },
    cases: [{
      id: 'AC-3', verdict: 'pass',
      steps: steps.map((id, index) => ({
        id, subject: 'node-1', action: id, result: 'Selected mode ' + String(index),
        artifact: artifact(id + '.log', 'Observed mode ' + String(index)),
      })),
    }],
  }
  return { repo, directory: evidence, head, commit, required, report }
}

test('accepts the measured source revision and equivalent build inputs', async t => {
  const options = fixture(t)
  assert.equal((await verifyDesktopAcceptance(options)).status, 'verified')
  const equivalent = options.commit('README.md', 'unrelated documentation')
  assert.equal((await verifyDesktopAcceptance({ ...options, head: equivalent })).status, 'verified')
})

test('rejects changed inputs, an incorrect source digest and a modified build artifact', async t => {
  const options = fixture(t)
  const later = options.commit('app/shell.js', 'different source')
  options.report.build.inputsSha256 = '0'.repeat(64)
  writeFileSync(join(options.directory, 'client.js'), 'modified built client')
  const result = await verifyDesktopAcceptance({ ...options, head: later })
  assert.equal(result.status, 'failed')
  assert.match(result.errors.join('\n'), /recorded build inputs differ/)
  assert.match(result.errors.join('\n'), /build input mismatch/)
  assert.match(result.errors.join('\n'), /build artifact 1: artifact SHA-256 differs/)
})

test('rejects absent acceptance IDs, reordered steps and a rebuilt node', async t => {
  const options = fixture(t)
  options.required.cases.push({ id: 'AC-4', steps: ['reopen'] })
  const steps = options.report.cases[0].steps
  const firstStep = steps.shift()
  steps.splice(1, 0, firstStep)
  steps[2].subject = 'newly-rebuilt-node'
  delete steps[2].artifact
  const result = await verifyDesktopAcceptance(options)
  assert.equal(result.status, 'failed')
  assert.match(result.errors.join('\n'), /AC-3: expected ordered steps/)
  assert.match(result.errors.join('\n'), /AC-3\/disconnect-video: step did not use the same subject/)
  assert.match(result.errors.join('\n'), /AC-3\/disconnect-video: missing artifact/)
  assert.match(result.errors.join('\n'), /missing acceptance ID AC-4/)
})

test('does not read artifacts reached through a symlink', async t => {
  const options = fixture(t)
  const artifact = options.report.cases[0].steps[0].artifact
  symlinkSync(join(options.directory, artifact.path), join(options.directory, 'linked.log'))
  artifact.path = 'linked.log'
  const result = await verifyDesktopAcceptance(options)
  assert.equal(result.status, 'failed')
  assert.match(result.errors.join('\n'), /artifact is not in the evidence directory/)
})

test('keeps an explicitly authorized P0 case pending until its remaining steps pass', async t => {
  const options = fixture(t)
  options.report.cases[0].verdict = 'pending'
  options.report.cases[0].reason = 'Awaiting the isolated desktop run'
  options.report.cases[0].steps.length = 1
  assert.equal((await verifyDesktopAcceptance(options)).status, 'failed')
  options.required.emergency = { priority: 'P0', cases: ['AC-3'], authorization: 'maintainer approval reference' }
  const accepted = await verifyDesktopAcceptance(options)
  assert.equal(accepted.status, 'pending')
  assert.equal(accepted.pending[0].id, 'AC-3')

  options.report.cases[0].steps.length = 0
  delete options.report.build
  const unmeasured = await verifyDesktopAcceptance(options)
  assert.equal(unmeasured.status, 'pending')
  assert.equal(unmeasured.sourceCommit, null)
})
