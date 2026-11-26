import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { changedFilesFromGit } from './auto-qa-gate.mjs'
import { BASE_BRANCH, PipelineError, readJsonFile, repoRoot, runCommand } from './auto-pipeline-runtime.mjs'

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss', '.html'])
const TEST_FILE_RE = /(?:^|[./\\])[^/\\]*\.(?:test|spec)\.[^/\\]+$/
const WORKSPACE_INPUT = /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|plugins\/(?:package\.json|(?:plugins|packages)\/[^/]+\/package\.json|plugins\/omnimux-browser\/extension\/package\.json))$/

function workspacePackageDirectories(root) {
  const workspace = join(root, 'plugins')
  const candidates = [root, workspace, join(workspace, 'plugins', 'omnimux-browser', 'extension')]
  for (const name of ['plugins', 'packages']) {
    const directory = join(workspace, name)
    if (!existsSync(directory)) continue
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (!item.name.startsWith('.') && (item.isDirectory() || item.isSymbolicLink())) candidates.push(join(directory, item.name))
    }
  }
  return candidates.filter(directory => existsSync(join(directory, 'package.json')))
}

function workspaceDependenciesPresent(root, packages) {
  const installedLock = join(root, 'node_modules', '.pnpm', 'lock.yaml')
  if (!statSync(join(root, 'node_modules', '.modules.yaml'), { throwIfNoEntry: false })?.isFile() ||
      !statSync(installedLock, { throwIfNoEntry: false })?.isFile() ||
      !readFileSync(installedLock).equals(readFileSync(join(root, 'pnpm-lock.yaml')))) return false
  return packages.every(directory => {
    const manifest = readJsonFile(join(directory, 'package.json'))
    if (!manifest) return false
    const direct = { ...manifest.dependencies, ...manifest.devDependencies }
    return Object.keys(direct).every(name => Object.hasOwn(manifest.optionalDependencies || {}, name) ||
      statSync(join(directory, 'node_modules', name), { throwIfNoEntry: false })?.isDirectory())
  })
}

export function ensureWorkspaceDependencies(root, changedFiles) {
  const packages = workspacePackageDirectories(root)
  if (!changedFiles.some(file => WORKSPACE_INPUT.test(file)) && workspaceDependenciesPresent(root, packages)) return

  const installPaths = [join(root, 'node_modules', '.pnpm'), join(root, 'node_modules', '.modules.yaml')]
  for (const directory of new Set([root, ...packages])) {
    if (realpathSync(directory) !== directory) throw new PipelineError('无法安装到通过软链接复用的工作区包，请使用独立依赖工作树')
    installPaths.push(join(directory, 'node_modules'))
  }
  if (installPaths.some(path => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())) {
    throw new PipelineError('无法安装到共享依赖软链接，请使用独立依赖工作树')
  }
  runCommand('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: root })
  if (!workspaceDependenciesPresent(root, packages)) throw new PipelineError('工作树依赖安装后仍不完整或与锁文件不一致')
}
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
    runCommand('bash', [join(repoRoot, 'scripts', 'sync-to-app.sh'), plugin], { cwd: repoRoot, env: { OMNIMUX_MERGE_CONFIRMED: '1' } })
  }
  runCommand('bash', [join(repoRoot, 'scripts', 'worktree.sh'), 'remove', basename(wt.wtDir), '--pr', String(pr.number)], {
    cwd: repoRoot, env: { OMNIMUX_MERGE_CONFIRMED: '1' },
  })
}
