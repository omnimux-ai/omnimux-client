import { it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readState } from './pipeline-state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

function runPilotFixture(root) {
  const checkout = join(root, 'repo')
  const remote = join(root, 'remote.git')
  const tools = join(root, 'bin')
  const callLog = join(root, 'gh-calls.jsonl')
  const prFile = join(root, 'pr.json')
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  for (const path of [checkout, tools, join(checkout, 'plugins'), join(checkout, 'app', 'dsh-plugin-desktop', 'src')]) {
    mkdirSync(path, { recursive: true })
  }
  writeFileSync(join(checkout, '.gitignore'), '.worktrees/\nnode_modules/\n/.workbuddy/evidence/\n/plugins/.workbuddy/pipeline/\n')
  cpSync(here, join(checkout, 'plugins', 'scripts'), { recursive: true })
  if (existsSync(join(repoRoot, 'node_modules'))) symlinkSync(realpathSync(join(repoRoot, 'node_modules')), join(checkout, 'plugins', 'node_modules'))
  const source = 'app/dsh-plugin-desktop/src/native-file-picker.ts'
  writeFileSync(join(checkout, source), 'export const pickerResult = 1\n')
  git('init', '-b', 'main')
  git('config', 'user.email', 'fixture@example.com')
  git('config', 'user.name', 'Pilot fixture')
  git('add', '.gitignore', source, 'plugins/scripts')
  git('commit', '-m', 'base')
  git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'main')
  const base = git('rev-parse', 'HEAD')
  const branch = 'agent/governance-picker-pilot-issue-100'
  const worktree = join(checkout, '.worktrees', 'picker-pilot-100')
  const impactPath = join(worktree, '.workbuddy', 'evidence', 'issue-100', 'docs-impact.json')
  git('worktree', 'add', '-b', branch, worktree, base)
  if (existsSync(join(repoRoot, 'node_modules'))) symlinkSync(realpathSync(join(repoRoot, 'node_modules')), join(worktree, 'plugins', 'node_modules'))
  writeFileSync(join(worktree, source), 'export const pickerResult = 2\n')
  writeFileSync(join(tools, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  writeFileSync(join(tools, 'gh'), `#!${process.execPath}\n${String.raw`
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const args = process.argv.slice(2);
    const path = process.env.PILOT_PR_FILE;
    fs.appendFileSync(process.env.PILOT_GH_CALLS, JSON.stringify(args.slice(0, 2)) + '\n');
    const file = () => args[args.indexOf('--body-file') + 1];
    const head = () => cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const pr = () => ({ ...JSON.parse(fs.readFileSync(path, 'utf8')), headRefOid: head() });
    const write = (body) => fs.writeFileSync(path, JSON.stringify({ number: 101, url: 'https://github.com/example/workflow-fixture/pull/101', body, isCrossRepository: false }));
    switch (args.slice(0, 2).join(' ')) {
      case 'issue view': console.log(JSON.stringify({
        number: 100, title: 'fix: picker', body: '---\nrisk-tier: R2\npre-authorized: true\n---\nIssue fixture intent',
        labels: [{ name: 'status:ready-to-run' }, { name: 'risk:R2' }],
        comments: [{ author: { login: 'fixture-maintainer' }, body: '/auto-approve risk:R2' }],
        state: 'OPEN', url: 'https://github.com/example/workflow-fixture/issues/100'
      })); break;
      case 'issue edit': break;
      case 'pr list': console.log(JSON.stringify(fs.existsSync(path) ? [pr()] : [])); break;
      case 'pr create': write(fs.readFileSync(file(), 'utf8')); console.log('https://github.com/example/workflow-fixture/pull/101'); break;
      case 'pr view': console.log(JSON.stringify(pr())); break;
      case 'pr edit': if (args.includes('--body-file')) write(fs.readFileSync(file(), 'utf8')); break;
      default: process.exitCode = 90;
    }
  `}`, { mode: 0o700 })
  const run = (...args) => spawnSync(process.execPath, ['plugins/scripts/auto-pipeline.mjs', '100', '--topic', 'picker-pilot', '--allow-existing-changes', ...args], {
    cwd: checkout,
    env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, OMNIMUX_REPO: 'example/workflow-fixture', OMNIMUX_PIPELINE_MAINTAINERS: 'fixture-maintainer', OMNIMUX_IMPLEMENT_COMMAND: '', PILOT_PR_FILE: prFile, PILOT_GH_CALLS: callLog },
    encoding: 'utf8',
  })
  return { base, branch, checkout, git, impactPath, prFile, callLog, run, source, worktree }
}

it('normal auto:run blocks pilot before push without an author record, then hands off without asking GitHub to merge', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pipeline-docs-review-')))
  try {
    const fixture = runPilotFixture(root)
    const { base, branch, checkout, git, impactPath, prFile, callLog, run, source, worktree } = fixture
    const missing = run('--manual')
    assert.equal(missing.status, 1, missing.stderr)
    assert.match(missing.stderr, /docs-impact\.json/)
    assert.equal(git('rev-parse', branch), base)
    assert.equal(git('ls-remote', '--heads', 'origin', branch), '')
    assert.equal(existsSync(prFile), false)

    const impact = [{
      subsystem: 'desktop-file-picker', document: 'app/docs/architecture.md', decision: 'unchanged',
      behavior: 'Fixture preserves the documented result format', evidence: 'Offline test fixture',
    }]
    writeFileSync(impactPath, JSON.stringify(impact))
    const published = run('--force-retry')
    assert.equal(published.status, 0, published.stderr || published.stdout)
    const state = readState(join(checkout, 'plugins'), '100')
    assert.equal(state.state, 'ready-for-agent')
    assert.equal(state.channel, 'agent')
    assert.equal(state.commit.headSha, git('rev-parse', branch))
    const committed = git('ls-tree', '-r', '--name-only', branch)
    assert.doesNotMatch(committed, /\.workbuddy\//)
    assert.equal(state.docsImpact.recordPath, impactPath)
    assert.deepEqual(state.docsImpact.subsystems, ['desktop-file-picker'])
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(state.docsImpact.issueSnapshotPath, 'utf8'))), ['number', 'title', 'body', 'url'])
    assert.doesNotMatch(published.stdout, /Issue fixture intent/)
    assert.match(state.handoff.nextAction, /independent review of the current base and head/)
    const initial = JSON.parse(readFileSync(prFile, 'utf8'))
    assert.match(initial.body, /## 文档影响[\s\S]*Offline test fixture/)

    const operatorNotes = '\n## Reviewer notes\n\nKeep this section verbatim.\n'
    writeFileSync(prFile, JSON.stringify({ ...initial, body: initial.body + operatorNotes }))
    writeFileSync(join(worktree, source), 'export const pickerResult = 3\n')
    impact[0].evidence = 'New candidate fixture'
    writeFileSync(impactPath, JSON.stringify(impact))
    const updated = run('--manual', '--force-retry')
    assert.equal(updated.status, 0, updated.stderr || updated.stdout)
    const current = readState(join(checkout, 'plugins'), '100')
    assert.equal(current.state, 'ready-for-agent')
    assert.equal(current.pr.reused, true)
    assert.notEqual(current.commit.headSha, state.commit.headSha)
    const finalBody = JSON.parse(readFileSync(prFile, 'utf8')).body
    assert.equal(finalBody, initial.body.replace('Offline test fixture', 'New candidate fixture') + operatorNotes)
    const calls = readFileSync(callLog, 'utf8').trim().split('\n').map(line => JSON.parse(line).join(' '))
    assert.equal(calls.filter(call => call === 'pr create').length, 1)
    assert.equal(calls.includes('pr merge'), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
