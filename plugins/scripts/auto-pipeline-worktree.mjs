import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { changedFilesFromGit } from './auto-qa-gate.mjs'
import { BASE_BRANCH, PipelineError, readJsonFile, repoRoot, runCommand } from './auto-pipeline-runtime.mjs'

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss', '.html'])
const TEST_FILE_RE = /(?:^|[./\\])[^/\\]*\.(?:test|spec)\.[^/\\]+$/
export function getPackageInfo(root, plugin) {
  const dir = !plugin || plugin === 'common' ? null : join(root, 'plugins', plugin)
  if (!dir || !existsSync(join(dir, 'package.json'))) return null
  const packageJson = readJsonFile(join(dir, 'package.json'))
  if (!packageJson) throw new PipelineError(`无法解析插件 package.json: ${dir}`)
  return { dir, packageJson }
}
export function currentBranch(root) {
  return runCommand('git', ['-C', root, 'branch', '--show-current']).stdout.trim()
}
export function baseSha(root, options) {
  if (options.dryRun) return 'dry-run-base'
  runCommand('git', ['-C', root, 'fetch', 'origin', BASE_BRANCH])
  const sha = runCommand('git', ['-C', root, 'rev-parse', `origin/${BASE_BRANCH}`]).stdout.trim()
  if (!sha) throw new PipelineError('无法解析 origin/main SHA')
  return sha
}
export function statusPorcelain(root) {
  return runCommand('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']).stdout.trim()
}
export function changedPaths(root, base, options) {
  if (options.dryRun) return []
  return changedFilesFromGit(root, base, { strict: true, includeRenameSources: true }).map(file => relative(root, file).replaceAll('\\', '/'))
}
export function hasCodeChanges(paths) {
  return paths.some(file => CODE_EXTENSIONS.has(extname(file)) && !TEST_FILE_RE.test(file))
}
export function pluginNamesFromChanges(paths) {
  return [...new Set(paths.map(file => /^plugins\/plugins\/([^/]+)\//.exec(file)?.[1]).filter(Boolean))]
}
export function ensureBranchAndWorktree(plugin, topic, issueId, options) {
  const scope = plugin && plugin !== 'common' ? plugin : 'governance'
  const expectedBranch = `agent/${scope}-${topic}-issue-${issueId}`
  const commonDir = runCommand('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
  const primaryRoot = realpathSync(dirname(commonDir))
  const worktreesDir = join(primaryRoot, '.worktrees')
  const wtDir = options.worktree || join(worktreesDir, `${topic}-${issueId}`)
  const task = basename(wtDir)
  if (dirname(wtDir) !== worktreesDir || !/^[a-z0-9][a-z0-9-]*$/.test(task)) {
    throw new PipelineError('流水线工作树必须位于仓库的 .worktrees/<task>')
  }
  if (existsSync(worktreesDir) && realpathSync(worktreesDir) !== worktreesDir) {
    throw new PipelineError('流水线工作树目录不能通过软链接移出仓库')
  }
  if (existsSync(wtDir)) {
    if (realpathSync(wtDir) !== wtDir) throw new PipelineError('流水线工作树不能是软链接')
  } else {
    runCommand('git', ['worktree', 'add', '-b', expectedBranch, wtDir, options.base], { cwd: primaryRoot })
  }
  if (!existsSync(join(wtDir, '.git'))) throw new PipelineError(`Worktree 未正确创建: ${wtDir}`)
  const worktreeCommonDir = runCommand('git', ['-C', wtDir, 'rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
  if (realpathSync(worktreeCommonDir) !== realpathSync(commonDir)) throw new PipelineError('流水线工作树不属于当前仓库')
  const actualBranch = currentBranch(wtDir)
  if (actualBranch !== expectedBranch) throw new PipelineError(`Worktree 分支不匹配：期望 ${expectedBranch}，实际 ${actualBranch}`)
  return { wtDir, expectedBranch }
}
export function runImplementation(wtDir, plugin, topic, issueId, options) {
  const before = options.dryRun ? '' : statusPorcelain(wtDir)
  if (options.implementationCommand) {
    runCommand('bash', ['-lc', options.implementationCommand], {
      cwd: wtDir, dryRun: options.dryRun,
      env: { DSH_PIPELINE: '1', OMNIMUX_ISSUE_ID: String(issueId), OMNIMUX_PLUGIN: plugin, OMNIMUX_TOPIC: topic, OMNIMUX_WORKTREE: wtDir, OMNIMUX_DOCS_IMPACT_PATH: options.docsImpactPath },
    })
  } else if (!options.allowExistingChanges && !options.dryRun) {
    throw new PipelineError('没有显式 implementation command，且未声明 --allow-existing-changes；拒绝猜测或执行 Issue 正文命令')
  }
  const after = options.dryRun ? 'dry-run changes' : statusPorcelain(wtDir)
  if (!options.dryRun && !after && !options.allowExistingChanges) throw new PipelineError('实施阶段没有产生任何工作树变更')
  return { before, after }
}
export function materializeAndCleanup(wt, plugin, topic, issueId, pr, options) {
  if (options.dryRun) {
    process.stdout.write('· [dry-run] 仅模拟合入确认后的物化与 Worktree 清理\n')
    return
  }
  const branch = currentBranch(repoRoot)
  if (branch !== BASE_BRANCH) throw new PipelineError(`收尾要求主仓在 ${BASE_BRANCH}，当前是 ${branch}`)
  if (statusPorcelain(repoRoot)) throw new PipelineError('主仓存在既有脏文件，拒绝 pull/物化/清理以保护现场')
  runCommand('git', ['-C', repoRoot, 'pull', '--ff-only', 'origin', BASE_BRANCH], { cwd: repoRoot })
  if (options.materialize && plugin && plugin !== 'common') {
    const wrapper = join(repoRoot, 'scripts', 'materialize-with-rollback.sh')
    const script = existsSync(wrapper) ? wrapper : join(repoRoot, 'scripts', 'sync-to-app.sh')
    runCommand('bash', [script, plugin], { cwd: repoRoot, env: { OMNIMUX_MERGE_CONFIRMED: '1' } })
  }
  runCommand('bash', [join(repoRoot, 'scripts', 'worktree.sh'), 'remove', basename(wt.wtDir), '--pr', String(pr.number)], {
    cwd: repoRoot, env: { OMNIMUX_MERGE_CONFIRMED: '1' },
  })
}
