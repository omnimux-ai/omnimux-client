import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mergeReviewedPr, parseArgs, verifyReview } from './docs-review-merge.mjs'

const otherwise = '1'.repeat(40)
const required = ['Static L0 QA & Tests', 'Desktop app check']
const success = required.map(name => ({ bucket: 'pass', name, state: 'SUCCESS' }))

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'omnimux-docs-review-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const repo = join(temp, 'repo')
  mkdirSync(repo)
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }

  git(repo, 'init', '--quiet', '-b', 'main')
  git(repo, 'config', 'user.name', 'Docs fixture')
  git(repo, 'config', 'user.email', 'fixture@example.test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/fixture/client.git')
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n')
  writeFileSync(join(repo, 'architecture.md'), 'old behavior\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '--quiet', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  const cwd = join(repo, '.worktrees', 'task')
  git(repo, 'worktree', 'add', '--quiet', '-b', 'codex/task', cwd)
  writeFileSync(join(cwd, 'architecture.md'), 'new behavior\n')
  git(cwd, 'add', 'architecture.md')
  git(cwd, 'commit', '--quiet', '-m', 'candidate')
  const head = git(cwd, 'rev-parse', 'HEAD')
  const tree = git(cwd, 'rev-parse', 'HEAD^{tree}')
  const packet = [
    '# 评审包 · codex/task',
    `- base：\`origin/main\`（\`${base}\`）`,
    `- head：\`${head}\``,
    '- 文档复核：必需',
    '- 必核对文档：`architecture.md`',
    '',
    '## 已提交差异',
    'fixture diff',
  ].join('\n')
  const review = {
    baseSha: base,
    headSha: head,
    packetSha256: createHash('sha256').update(packet).digest('hex'),
    verdict: 'pass',
    findings: [],
    reviewed: [{ path: 'architecture.md', evidence: 'Compared committed behavior and checked references' }],
  }
  const options = { pr: 123, packet: join(temp, 'packet.md'), result: join(temp, 'review.json'), waitSeconds: 60 }
  writeFileSync(options.packet, packet)
  function writeReview(value) {
    writeFileSync(options.result, JSON.stringify(value))
  }
  writeReview(review)

  const open = {
    id: 'task-pr',
    number: 123,
    url: 'https://github.com/fixture/client/pull/123',
    state: 'OPEN',
    headRepository: { nameWithOwner: 'fixture/client' },
    headRefName: 'codex/task',
    headRefOid: head,
    baseRefName: 'main',
    baseRef: { target: { oid: base }, branchProtectionRule: { requiredStatusCheckContexts: required } },
    isDraft: false,
    isMergeQueueEnabled: true,
    isInMergeQueue: false,
    mergeQueueEntry: null,
    autoMergeRequest: null,
  }
  const queued = {
    ...open,
    isInMergeQueue: true,
    mergeQueueEntry: { id: 'task-entry', baseCommit: { oid: base } },
  }
  const merged = {
    ...open,
    state: 'MERGED',
    mergedAt: '2026-01-01T00:00:00Z',
    mergeCommit: { oid: otherwise, tree: { oid: tree }, parents: { nodes: [{ oid: base }] } },
  }

  function fakeGitHub(reads, checkResults = [success]) {
    let time = 0
    const mutations = []
    const run = (program, args, commandOptions) => {
      if (program === 'git') return spawnSync(program, args, commandOptions)
      assert.equal(program, 'gh')
      const query = args.find(arg => arg.startsWith('query=')) ?? ''
      let response
      let status = 0
      if (query.includes('enqueuePullRequest(')) {
        assert.ok(args.includes('id=task-pr'))
        assert.match(query, /expectedHeadOid:\$head/)
        assert.ok(args.includes(`head=${head}`))
        mutations.push('enqueue')
        response = { data: { enqueuePullRequest: { mergeQueueEntry: { id: 'task-entry' } } } }
      } else if (query.includes('dequeuePullRequest(')) {
        assert.ok(args.includes('id=task-pr'))
        mutations.push('dequeue')
        response = { data: { dequeuePullRequest: { mergeQueueEntry: { id: 'task-entry' } } } }
      } else if (query.includes('repository(owner:')) {
        assert.ok(args.includes('number=123') && args.includes('owner=fixture') && args.includes('repo=client'))
        const snapshot = reads.length > 1 ? reads.shift() : reads[0]
        response = { data: { repository: { nameWithOwner: 'fixture/client', pullRequest: snapshot } } }
      } else {
        assert.deepEqual(args.slice(0, 6), ['pr', 'checks', '123', '--repo', 'github.com/fixture/client', '--required'])
        response = checkResults.length > 1 ? checkResults.shift() : checkResults[0]
        if (response.some(check => check.bucket === 'pending')) status = 8
      }
      return { status, stdout: JSON.stringify(response), stderr: '' }
    }
    return {
      mutations,
      dependencies: { cwd, run, now: () => time, sleep: async ms => { time += ms } },
    }
  }

  return { cwd, repo, options, packet, review, writeReview, base, head, tree, open, queued, merged, fakeGitHub }
}

test('requires explicit CLI arguments and a bounded wait', () => {
  assert.throws(() => parseArgs(['--pr', 'x', '--packet', 'p', '--result', 'r']), /PR 编号/)
  assert.throws(() => parseArgs(['--pr', '5', '--packet', 'p', '--result', 'r', '--wait-seconds', '0']), /整数/)
  assert.equal(parseArgs(['--pr', '5', '--packet', 'p', '--result', 'r']).waitSeconds, 3600)
})

test('enqueues only the reviewed head and reports the actual matching squash commit', async t => {
  const sample = fixture(t)
  const gh = sample.fakeGitHub([sample.open, sample.open, sample.open, sample.queued, sample.merged], [[{ bucket: 'pending', name: required[0] }], success])
  const completed = await mergeReviewedPr(sample.options, gh.dependencies)
  assert.deepEqual(gh.mutations, ['enqueue'])
  assert.equal(completed.baseSha, sample.base)
  assert.equal(completed.headSha, sample.head)
  assert.equal(completed.mergedSha, otherwise)
  assert.equal(completed.mergedTree, sample.tree)
})

test('rejects missing or stale proof, a blocking review and an omitted pilot primary doc', async t => {
  const sample = fixture(t)
  const gh = sample.fakeGitHub([sample.open])
  rmSync(sample.options.result)
  await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies), /ENOENT/)
  for (const [value, pattern] of [
    [{ packetSha256: '0'.repeat(64) }, /未绑定/],
    [{ headSha: otherwise }, /未绑定/],
    [{ verdict: 'block' }, /阻断/],
    [{ findings: [{ severity: 'block' }] }, /阻断/],
    [{ reviewed: [{ path: 'other.md', evidence: 'looked' }] }, /主文档/],
  ]) {
    sample.writeReview({ ...sample.review, ...value })
    await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies), pattern)
  }
  assert.deepEqual(gh.mutations, [])
})

test('requires proof for infrastructure reviews without a pilot document', t => {
  const sample = fixture(t)
  const packet = sample.packet.replace(/^- (文档复核|必核对文档)：.*\n/gm, '')
  const review = { ...sample.review, packetSha256: createHash('sha256').update(packet).digest('hex') }
  assert.deepEqual(verifyReview(packet, review), { base: sample.base, head: sample.head })
  assert.throws(() => verifyReview(packet, { ...review, reviewed: [] }), /核对路径/)
})

test('rejects the primary checkout or a dirty task tree', async t => {
  const sample = fixture(t)
  const gh = sample.fakeGitHub([sample.open])
  await assert.rejects(mergeReviewedPr(sample.options, { ...gh.dependencies, cwd: sample.repo }), /工作树执行/)
  writeFileSync(join(sample.cwd, 'dirty.txt'), 'uncommitted\n')
  await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies), /必须干净/)
  assert.deepEqual(gh.mutations, [])
})

test('rejects a draft, a no-queue target or a preexisting queue or auto-merge request untouched', async t => {
  const sample = fixture(t)
  for (const change of [
    { isDraft: true }, { isMergeQueueEnabled: false }, { baseRefName: 'other' },
    { headRefName: 'other-task' }, { headRepository: { nameWithOwner: 'other/client' } },
    { isInMergeQueue: true, mergeQueueEntry: { id: 'other-entry' } },
    { autoMergeRequest: { enabledAt: 'yesterday' } },
  ]) {
    const gh = sample.fakeGitHub([{ ...sample.open, ...change }])
    await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies))
    assert.deepEqual(gh.mutations, [])
  }
})

test('blocks a required CI failure or unknown status and times out incomplete CI without enqueueing', async t => {
  const sample = fixture(t)
  for (const checkResults of [
    [{ bucket: 'fail', name: required[0] }],
    [{ bucket: 'skipping', name: required[0] }],
    [{ bucket: 'pending', name: required[0] }],
    [{ bucket: 'pass', name: required[0] }],
  ]) {
    const gh = sample.fakeGitHub([sample.open], [checkResults])
    await assert.rejects(mergeReviewedPr({ ...sample.options, waitSeconds: 1 }, gh.dependencies), /必需 CI/)
    assert.deepEqual(gh.mutations, [])
  }
})

test('rechecks the current head and base after CI before queueing', async t => {
  const sample = fixture(t)
  for (const change of [
    { headRefOid: otherwise },
    { baseRef: { ...sample.open.baseRef, target: { oid: otherwise } } },
  ]) {
    const gh = sample.fakeGitHub([sample.open, { ...sample.open, ...change }])
    await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies), /重新评审/)
    assert.deepEqual(gh.mutations, [])
  }
})

test('dequeues only this invocation’s entry when the review or wait expires', async t => {
  const sample = fixture(t)
  const staleBase = { ...sample.queued, baseRef: { ...sample.open.baseRef, target: { oid: otherwise } } }
  const staleGroup = { ...sample.queued, mergeQueueEntry: { id: 'task-entry', baseCommit: { oid: otherwise } } }
  for (const [snapshot, expectation] of [[staleBase, /重新评审/], [staleGroup, /队列基线/], [sample.queued, /超时/]]) {
    const gh = sample.fakeGitHub([sample.open, sample.open, snapshot])
    await assert.rejects(mergeReviewedPr({ ...sample.options, waitSeconds: 1 }, gh.dependencies), expectation)
    assert.deepEqual(gh.mutations, ['enqueue', 'dequeue'])
  }

  const foreign = { ...staleBase, mergeQueueEntry: { id: 'different-entry' } }
  const gh = sample.fakeGitHub([sample.open, sample.open, foreign])
  await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies), /队列条目已失效/)
  assert.deepEqual(gh.mutations, ['enqueue'])
})

test('reports a merged but mismatching tree or squash parent as requiring repair', async t => {
  const sample = fixture(t)
  for (const changes of [{ tree: { oid: otherwise } }, { parents: { nodes: [{ oid: otherwise }] } }]) {
    const mismatched = { ...sample.merged, mergeCommit: { ...sample.merged.mergeCommit, ...changes } }
    const gh = sample.fakeGitHub([sample.open, sample.open, mismatched])
    await assert.rejects(mergeReviewedPr(sample.options, gh.dependencies), /已合入.*不一致/)
    assert.deepEqual(gh.mutations, ['enqueue'])
  }
})
