import { join } from 'node:path'
import { BASE_BRANCH, PipelineError, REPO, readJsonText, repoRoot, runCommand, writeEvidence } from './auto-pipeline-runtime.mjs'
import { statusPorcelain } from './auto-pipeline-worktree.mjs'
import { DOCS_IMPACT_END, DOCS_IMPACT_START, wrapDocsImpact } from './docs-impact.mjs'

const STATUS_LABELS = [
  'status:triage', 'status:planning', 'status:ready-to-run', 'status:pipeline-running', 'status:in-progress',
  'status:qa-review', 'status:ready-for-boss', 'status:auto-merge-pending', 'status:auto-merged', 'status:blocked',
]
export function transitionIssue(issueId, target, options, extraAdd = [], extraRemove = []) {
  const remove = STATUS_LABELS.filter(label => label !== target).concat(extraRemove)
  const add = target ? [target, ...extraAdd] : extraAdd
  if (options.dryRun) {
    process.stdout.write(`[dry-run] Issue #${issueId} add=${add.join(',')} remove=${remove.join(',')}\n`)
    return
  }
  const args = ['issue', 'edit', String(issueId), '--repo', REPO]
  for (const label of add) args.push('--add-label', label)
  for (const label of remove) args.push('--remove-label', label)
  const execCommand = options.execCommand || runCommand
  execCommand('gh', args, { cwd: repoRoot })
}
export function commitAndPush(wtDir, plugin, title, issueId, branch, options) {
  if (options.dryRun) {
    process.stdout.write(`· [dry-run] commit/push branch=${branch}\n`)
    return { branch, committed: true }
  }
  if (statusPorcelain(wtDir)) {
    runCommand('git', ['add', '--all'], { cwd: wtDir })
    const staged = runCommand('git', ['diff', '--cached', '--quiet'], { cwd: wtDir, allowFailure: true })
    if (staged.status !== 1) throw new PipelineError('无法确认有效的 staged 变更')
    const type = /^(feat|fix|refactor|docs|chore)\b/i.exec(title)?.[1] || 'feat'
    const scope = plugin && plugin !== 'common' ? plugin : 'contracts'
    const summary = String(title).replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || `Issue #${issueId} delivery pipeline`
    runCommand('git', ['commit', '-m', `${type}(${scope}): ${summary} (#${issueId})`], { cwd: wtDir })
  } else if (!options.allowExistingChanges) {
    throw new PipelineError('没有可提交的变更')
  }
  runCommand('git', ['push', '-u', 'origin', branch], { cwd: wtDir })
  const headSha = runCommand('git', ['rev-parse', 'HEAD'], { cwd: wtDir }).stdout.trim()
  return { branch, headSha, committed: true }
}
function replaceDocsImpactSection(body, section) {
  const start = body.indexOf(DOCS_IMPACT_START)
  const end = body.indexOf(DOCS_IMPACT_END)
  if (start === -1 && end === -1) {
    if (/^## 文档影响[ 	]*$/m.test(body)) {
      throw new PipelineError('PR 中已有未标记的文档影响段落，请先为该段补齐边界标记')
    }
    return `${body}\n\n${section}\n`
  }
  if (start === -1 || end < start || start !== body.lastIndexOf(DOCS_IMPACT_START) || end !== body.lastIndexOf(DOCS_IMPACT_END)) {
    throw new PipelineError('PR 文档影响段落的边界标记不完整或重复')
  }
  return body.slice(0, start) + section + body.slice(end + DOCS_IMPACT_END.length)
}

export function findOrCreatePr(wtDir, branch, title, issueId, reports, risk, options, evidenceDir, { rows, headSha, channel }) {
  const section = wrapDocsImpact(rows)
  const body = [
    `Closes #${issueId}`, '', '## 变更说明', `- Issue: #${issueId}`, `- branch: \`${branch}\``,
    `- risk-tier: ${risk.tier}`, `- merge channel: ${channel === 'auto' && !options.noMerge ? 'auto only with verified Issue authorization' : 'coordinating Agent under task authorization'}`,
    '', section, '', '## 机器证据',
    `- L0 static checks: ${reports.qa.pass === true ? 'passed' : 'not verified'}`,
    `- Post-merge Dev: ${reports.dev.status} (${reports.dev.reason})`,
    `- Post-merge Dev ego-browser: ${reports.browser.status} (${reports.browser.reason})`,
    `- Integration gates: ${reports.integration.length} command(s) completed`, '', '## 合入规则',
    '- `qa:pass` 由 CI 聚合门禁写入；本流水线不自授予。',
    '- R0/R1 和文档评审试点由协调 Agent 核对任务授权及实际影响后继续。无人值守合入仅限机器预授权完整的 R2/R3。',
    '- 未确认 `MERGED` 前不物化；适用 Dev 验收仍 pending 时保留 Worktree，不声称交付成功。',
  ].join('\n')
  const bodyPath = join(evidenceDir, 'pr-body.md')
  if (options.dryRun) {
    process.stdout.write(`· [dry-run] PR body -> ${bodyPath}\n`)
    return { number: null, url: null, bodyPath }
  }
  const execCommand = options.execCommand || runCommand
  const repoOptions = { cwd: wtDir, quietOutput: true }
  const existingResult = execCommand('gh', ['pr', 'list', '--repo', REPO, '--base', BASE_BRANCH, '--head', branch, '--state', 'open', '--json', 'number,url,title,body,headRefOid,isCrossRepository'], repoOptions)
  const list = readJsonText(existingResult.stdout, null)
  if (!Array.isArray(list)) throw new PipelineError('无法解析开放 PR 清单')
  const sameRepository = list.filter(pr => pr.isCrossRepository === false)
  if (sameRepository.length > 1) throw new PipelineError('存在多个匹配当前任务分支和目标分支的 PR')
  const existing = sameRepository[0]
  if (existing) {
    if (!existing.number || existing.headRefOid !== headSha || typeof existing.body !== 'string') {
      throw new PipelineError('现有 PR 的提交或描述无法与当前任务匹配')
    }
    const updated = replaceDocsImpactSection(existing.body, section)
    writeEvidence(bodyPath, updated)
    if (updated !== existing.body) {
      execCommand('gh', ['pr', 'edit', String(existing.number), '--repo', REPO, '--body-file', bodyPath], repoOptions)
    }
    return { number: existing.number, url: existing.url, title: existing.title, bodyPath, reused: true }
  }
  writeEvidence(bodyPath, `${body}\n`)
  const created = execCommand('gh', ['pr', 'create', '--repo', REPO, '--base', BASE_BRANCH, '--head', branch, '--title', `${title} (#${issueId})`, '--body-file', bodyPath], { cwd: wtDir })
  const url = /(https?:\/\/[^\s]+\/pull\/\d+)/.exec(created.stdout)?.[1]
  if (!url) throw new PipelineError('gh pr create 未返回可解析 PR URL')
  const viewed = execCommand('gh', ['pr', 'view', url, '--repo', REPO, '--json', 'number,url,title,headRefOid'], repoOptions)
  const pr = readJsonText(viewed.stdout, null)
  if (!pr?.number || pr.headRefOid !== headSha) throw new PipelineError('新建 PR 的提交或编号无法与当前任务匹配')
  return { ...pr, bodyPath, reused: false }
}
export function labelPr(prNumber, risk, options) {
  if (options.dryRun || !prNumber) return
  const args = ['pr', 'edit', String(prNumber), '--repo', REPO]
  for (const label of ['status:qa-review', `risk:${risk.tier}`]) args.push('--add-label', label)
  runCommand('gh', args, { cwd: repoRoot })
}
function checkRollup(rollup) {
  const entries = Array.isArray(rollup) ? rollup : []
  const states = entries.map(entry => String(entry.conclusion || entry.state || entry.status || '').toUpperCase())
  const failures = states.filter(state => ['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(state))
  const pending = states.filter(state => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'REQUESTED', 'WAITING', ''].includes(state))
  return { hasChecks: entries.length > 0, pass: entries.length > 0 && failures.length === 0 && pending.length === 0, pending: pending.length > 0, failures }
}
function queryPr(prNumber, options) {
  if (options.dryRun) return { state: 'OPEN', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }
  const result = runCommand('gh', ['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'number,url,state,mergedAt,mergeCommit,statusCheckRollup,headRefName,baseRefName'], { cwd: repoRoot })
  return readJsonText(result.stdout, null)
}
export async function waitForCi(prNumber, options) {
  if (options.dryRun) return { pass: true, checks: { hasChecks: true, pass: true, pending: false, failures: [] } }
  const deadline = Date.now() + options.waitSeconds * 1000
  let last = null
  while (Date.now() <= deadline) {
    last = queryPr(prNumber, options)
    const checks = checkRollup(last?.statusCheckRollup)
    if (checks.pass) return { pass: true, checks }
    if (checks.failures.length > 0) throw new PipelineError(`PR required checks 失败: ${checks.failures.join(', ')}`, { checks })
    if (!checks.hasChecks && Date.now() + 15000 > deadline) break
    await new Promise(resolvePromise => setTimeout(resolvePromise, 15000))
  }
  throw new PipelineError('等待 CI required checks 超时或没有任何 check', { last })
}
export async function requestAndConfirmMerge(prNumber, headSha, options) {
  if (options.noMerge) throw new PipelineError('已通过 --no-merge 禁止合入；保留 PR，由协调 Agent 在指定范围内收尾')
  if (options.dryRun) return { state: 'MERGED', mergedAt: 'dry-run', mergeCommit: { oid: 'dry-run' } }
  if (!/^[a-f0-9]{40}$/.test(headSha || '')) throw new PipelineError('无法绑定当前任务的合并提交')
  const execCommand = options.execCommand || runCommand
  execCommand('gh', ['pr', 'merge', String(prNumber), '--repo', REPO, '--squash', '--auto', '--delete-branch', '--match-head-commit', headSha], { cwd: repoRoot })
  const deadline = Date.now() + options.waitSeconds * 1000
  let last = null
  while (Date.now() <= deadline) {
    last = queryPr(prNumber, options)
    if (String(last?.state).toUpperCase() === 'MERGED' && last.mergedAt && last.mergeCommit?.oid) return last
    if (String(last?.state).toUpperCase() === 'CLOSED') throw new PipelineError('PR 已关闭但未确认 MERGED', { last })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10000))
  }
  throw new PipelineError('已请求 auto-merge，但在超时时间内没有确认 MERGED', { last })
}
