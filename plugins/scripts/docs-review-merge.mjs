#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const SHA = /^[a-f0-9]{40}$/
const POLL_MS = 15_000
const QUERY = `query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    nameWithOwner
    pullRequest(number:$number) {
      id number url state isDraft isMergeQueueEnabled isInMergeQueue
      headRefName headRefOid headRepository { nameWithOwner }
      baseRefName baseRef { target { oid } branchProtectionRule { requiredStatusCheckContexts } }
      autoMergeRequest { enabledAt }
      mergeQueueEntry { id baseCommit { oid } }
      mergedAt mergeCommit { oid tree { oid } parents(first:2) { nodes { oid } } }
    }
  }
}`
const ENQUEUE = `mutation($id:ID!,$head:GitObjectID!) {
  enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head}) { mergeQueueEntry { id } }
}`
const DEQUEUE = `mutation($id:ID!) {
  dequeuePullRequest(input:{id:$id}) { mergeQueueEntry { id } }
}`

export function parseArgs(args) {
  const options = { waitSeconds: 3600 }
  const names = { '--pr': 'pr', '--packet': 'packet', '--result': 'result', '--wait-seconds': 'waitSeconds' }
  const seen = new Set()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const name = names[flag]
    const value = args[i + 1]
    if (!Object.hasOwn(names, flag) || seen.has(name) || !value || value.startsWith('--')) {
      throw new Error('用法: docs-review-merge.mjs --pr <编号> --packet <评审包> --result <独立评审 JSON> [--wait-seconds <秒>]')
    }
    options[name] = value
    seen.add(name)
  }
  options.pr = Number(options.pr)
  options.waitSeconds = Number(options.waitSeconds)
  if (!Number.isSafeInteger(options.pr) || options.pr < 1 || !options.packet || !options.result) {
    throw new Error('必须提供 PR 编号、评审包和独立评审结果')
  }
  if (!Number.isSafeInteger(options.waitSeconds) || options.waitSeconds < 1 || options.waitSeconds > 86_400) {
    throw new Error('--wait-seconds 必须为 1 到 86400 的整数')
  }
  return options
}

function meaningful(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function repositoryPath(path) {
  return meaningful(path) && path.trim() === path && !/[:\\\r\n\0]/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..')
}

export function verifyReview(packet, result) {
  const header = packet.split(/^## /m, 1)[0]
  const base = header.match(/^- base：`[^`\r\n]+`（`([a-f0-9]{40})`）\r?$/m)?.[1]
  const head = header.match(/^- head：`([a-f0-9]{40})`\r?$/m)?.[1]
  const digest = createHash('sha256').update(packet).digest('hex')
  if (!base || !head || result?.baseSha !== base || result?.headSha !== head || result?.packetSha256 !== digest) {
    throw new Error('独立评审未绑定此评审包的 base/head 和 SHA-256')
  }
  if (result.verdict !== 'pass' || !Array.isArray(result.findings) || result.findings.some(finding => finding?.severity !== 'note')) {
    throw new Error('独立评审缺少有效通过结论或仍有阻断项')
  }
  const reviewed = result.reviewed
  if (!Array.isArray(reviewed) || !reviewed.length ||
      reviewed.some(item => !repositoryPath(item?.path) || !meaningful(item?.evidence))) {
    throw new Error('独立评审缺少核对路径及原始证据')
  }
  if (/^- 文档复核：必需\r?$/m.test(header)) {
    const docs = header.match(/^- 必核对文档：([^\r\n]+)\r?$/m)?.[1]
    const paths = docs ? [...docs.matchAll(/`([^`]+)`/g)].map(([, path]) => path) : []
    if (!paths.length || paths.some(path => !reviewed.some(item => item.path === path))) {
      throw new Error('独立评审缺少试点主文档的核对证据')
    }
  }
  return { base, head }
}

function command(cwd, run, program, args, allowedStatuses = [0]) {
  const result = run(program, args, { cwd, encoding: 'utf8', timeout: 60_000 })
  if (result.error) throw result.error
  if (!allowedStatuses.includes(result.status)) {
    throw new Error(result.stderr?.trim() || `${program} ${args[0]} 执行失败（${result.status}）`)
  }
  return result
}

function localCandidate(cwd, run, head) {
  const git = (...args) => command(cwd, run, 'git', args).stdout.trim()
  const root = realpathSync(git('rev-parse', '--show-toplevel'))
  const mainGit = realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir'))
  if (basename(mainGit) !== '.git' || dirname(root) !== resolve(dirname(mainGit), '.worktrees')) {
    throw new Error('请在仓库 .worktrees 下的任务工作树执行')
  }
  if (git('status', '--porcelain', '--untracked-files=normal') || git('rev-parse', '--verify', 'HEAD') !== head) {
    throw new Error('任务工作树必须干净，且 HEAD 必须与已评审提交一致')
  }
  const branch = git('symbolic-ref', '--short', 'HEAD')
  const origin = git('remote', 'get-url', 'origin')
  const repository = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+)\/?$/i)?.[1]?.replace(/\.git$/i, '')
  if (!repository) throw new Error('任务工作树 origin 必须指向明确的 GitHub 仓库')
  return { git, repository, branch }
}

function remoteClient(cwd, run, repository, number) {
  function gh(args, allowedStatuses) {
    return command(cwd, run, 'gh', args, allowedStatuses)
  }

  function graphql(query, bindings) {
    const args = ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`, ...bindings]
    return JSON.parse(gh(args).stdout).data
  }

  const [owner, repo] = repository.split('/')
  return {
    read() {
      const remote = graphql(QUERY, ['-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${number}`])?.repository
      const pr = remote?.pullRequest
      if (remote?.nameWithOwner?.toLowerCase() !== repository.toLowerCase() || pr?.number !== number || !pr.id) {
        throw new Error('无法确认任务 PR 和远端仓库身份')
      }
      return pr
    },
    checks(pr) {
      const required = pr.baseRef.branchProtectionRule?.requiredStatusCheckContexts
      if (!Array.isArray(required) || !required.includes('Static L0 QA & Tests')) {
        throw new Error('无法确认 OmniMux 基线的必需 CI 配置')
      }
      const result = gh(['pr', 'checks', String(number), '--repo', `github.com/${repository}`, '--required', '--json', 'bucket,name,state'], [0, 1, 8])
      if (result.status === 1 && !result.stdout.trim() && /^no (required )?checks reported\b/.test(result.stderr?.trim())) return false
      const checks = JSON.parse(result.stdout)
      if (!Array.isArray(checks) || checks.some(check => !['pass', 'pending'].includes(check?.bucket))) {
        throw new Error('必需 CI 缺失、失败或未显式通过')
      }
      const passed = new Set(checks.filter(check => check.bucket === 'pass').map(check => check.name))
      return result.status === 0 && checks.every(check => check.bucket === 'pass') && required.every(name => passed.has(name))
    },
    enqueue(prId, head) {
      return graphql(ENQUEUE, ['-f', `id=${prId}`, '-f', `head=${head}`])?.enqueuePullRequest?.mergeQueueEntry?.id
    },
    dequeue(prId) {
      return graphql(DEQUEUE, ['-f', `id=${prId}`])?.dequeuePullRequest?.mergeQueueEntry?.id
    },
  }
}

function candidateMismatch(pr, candidate, base, head) {
  if (pr.baseRefName !== 'main' || pr.headRefName !== candidate.branch ||
      pr.headRepository?.nameWithOwner?.toLowerCase() !== candidate.repository.toLowerCase() ||
      pr.headRefOid !== head || pr.baseRef?.target?.oid !== base) {
    return 'PR 的仓库、分支、base 或 head 已变化，须重新评审'
  }
  if (pr.state !== 'OPEN' || pr.isDraft !== false || pr.isMergeQueueEnabled !== true) {
    return 'PR 必须开放、可评审，且目标分支启用合并队列'
  }
  return ''
}

function requireReady(pr, candidate, base, head) {
  const mismatch = candidateMismatch(pr, candidate, base, head)
  if (mismatch) throw new Error(mismatch)
  if (pr.autoMergeRequest || pr.isInMergeQueue !== false || pr.mergeQueueEntry) {
    throw new Error('PR 已有合并请求或队列条目，须先核对该请求的归属和证据')
  }
}

function verifyMerged(pr, base, head, tree, queueId) {
  const commit = pr.mergeCommit
  const parents = commit?.parents?.nodes
  if (pr.baseRefName !== 'main' || pr.headRefOid !== head || !pr.mergedAt || !SHA.test(commit?.oid) || commit.tree?.oid !== tree ||
      !Array.isArray(parents) || parents.length !== 1 || parents[0].oid !== base) {
    throw new Error('PR 已合入，但合入树、基线或 head 与评审证据不一致，须复核并按需修复')
  }
  return { pr: pr.number, url: pr.url, baseSha: base, headSha: head, queueId, mergedSha: commit.oid, mergedTree: tree, mergedAt: pr.mergedAt }
}

export async function mergeReviewedPr(options, deps = {}) {
  const { cwd = process.cwd(), run = spawnSync, now = Date.now, sleep = delay } = deps
  const packet = readFileSync(resolve(cwd, options.packet), 'utf8')
  const result = JSON.parse(readFileSync(resolve(cwd, options.result), 'utf8'))
  const { base, head } = verifyReview(packet, result)
  const candidate = localCandidate(cwd, run, head)
  const tree = candidate.git('merge-tree', '--write-tree', base, head)
  if (!SHA.test(tree)) throw new Error('无法取得已评审 base/head 的合并树')
  const remote = remoteClient(cwd, run, candidate.repository, options.pr)
  const deadline = now() + options.waitSeconds * 1000

  let pr = remote.read()
  requireReady(pr, candidate, base, head)
  const prId = pr.id
  while (!remote.checks(pr)) {
    if (now() >= deadline) throw new Error('等待必需 CI 超时，未请求入队')
    await sleep(Math.min(POLL_MS, deadline - now()))
    pr = remote.read()
    requireReady(pr, candidate, base, head)
  }
  if (now() >= deadline) throw new Error('等待必需 CI 超时，未请求入队')
  const checkedContexts = pr.baseRef.branchProtectionRule.requiredStatusCheckContexts
  pr = remote.read()
  requireReady(pr, candidate, base, head)
  if (pr.id !== prId) throw new Error('PR 身份已变化，未请求入队')
  const currentContexts = pr.baseRef.branchProtectionRule?.requiredStatusCheckContexts
  if (!currentContexts || currentContexts.length !== checkedContexts.length || !currentContexts.every(name => checkedContexts.includes(name))) {
    throw new Error('必需 CI 配置已变化，须重新核验')
  }
  localCandidate(cwd, run, head)
  if (now() >= deadline) throw new Error('等待必需 CI 超时，未请求入队')
  const queueId = remote.enqueue(prId, head)
  if (!queueId) throw new Error('GitHub 未返回入队凭证，须核对 PR 实际状态')

  for (;;) {
    pr = remote.read()
    if (pr.id !== prId) throw new Error('PR 身份已变化，须核对队列状态')
    if (pr.state === 'MERGED') return verifyMerged(pr, base, head, tree, queueId)
    if (!pr.isInMergeQueue || pr.mergeQueueEntry?.id !== queueId) {
      throw new Error('本次队列条目已失效，须核对 PR 状态并重新评审')
    }
    const mismatch = candidateMismatch(pr, candidate, base, head)
    const queueBase = pr.mergeQueueEntry.baseCommit?.oid
    const reason = mismatch || (queueBase && queueBase !== base ? '队列基线已变化，须重新评审' : '') ||
      (now() >= deadline ? '等待合并队列超时' : '')
    if (reason) {
      const removedId = remote.dequeue(prId)
      if (removedId !== queueId) throw new Error(`${reason}；GitHub 未确认移出本次队列条目，须核对 PR`)
      throw new Error(`${reason}；已移出本次队列条目`)
    }
    await sleep(Math.min(POLL_MS, deadline - now()))
  }
}

export async function main(args = process.argv.slice(2)) {
  try {
    const result = await mergeReviewedPr(parseArgs(args))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`[docs-review-merge] ${error.message}\n`)
    return 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main()
}
