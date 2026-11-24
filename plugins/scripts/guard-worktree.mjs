#!/usr/bin/env node
/**
 * scripts/guard-worktree.mjs
 * dsh-hooks-plugin PreToolUse Guard for OmniMux DSH
 *
 * 全域版本控制守卫 (Default-Deny Primary Checkout Guard):
 * 主 checkout 默认拒绝整个仓库根目录的直接写入（包含已跟踪文件、任意现有或未来新增目录的未跟踪文件、
 * 以及 .tmp/ / .agent-reports/ / dist/ 等副产物），强制所有开发改动走独立 linked worktree 物理隔离。
 * 同时拦截对未推送提交具有毁灭性覆盖风险的 `git reset --hard` 操作与主检出修改性构建。
 *
 * 唯一放行白名单（主检出场景）：
 *   - 经 Git 元数据与注册表双向核实的独立 linked worktree 目录
 *   - 仓库外非 Git 路径（例如 /tmp/...）
 *   - 显式声明的本地协作运行态目录（当前仅 `.workbuddy/`，且已跟踪文件永不豁免）
 */

import { spawnSync } from 'node:child_process'
import { lstatSync, realpathSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const MAIN_PLUGINS_MARK = `${sep}omnimux-client${sep}plugins${sep}`

const EPHEMERAL_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-harness',
  '.tmp',
  '.cache',
  'coverage',
  '.pnpm-store',
])

const EPHEMERAL_BASENAMES = new Set(['.DS_Store'])
const EPHEMERAL_SUFFIXES = ['.log', '.tsbuildinfo']

/** 主检出唯一允许写入未跟踪本地运行态文件的目录白名单（已跟踪文件永不豁免）。 */
export const PRIMARY_RUNTIME_ALLOWLIST_PREFIXES = Object.freeze(['.workbuddy/'])

/** Resolve symlinks before classifying existing files or a new file's parent. */
function canonicalTarget(fullPath) {
  let ancestor = resolve(fullPath)
  const missing = []
  for (;;) {
    try {
      lstatSync(ancestor)
      return resolve(realpathSync(ancestor), ...missing)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      // A dangling symlink must not be mistaken for a missing directory.
      try {
        if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Dangling symlink')
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError
      }
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      missing.unshift(relative(parent, ancestor))
      ancestor = parent
    }
  }
}

function existingDirectory(fullPath) {
  let current = fullPath
  for (;;) {
    try {
      return lstatSync(current).isDirectory() ? current : dirname(current)
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(current) === current) throw error
      current = dirname(current)
    }
  }
}

/** Require reciprocal Git metadata and an exact worktree registry entry. */
export function isWorktreePath(fullPath) {
  if (!fullPath) return false
  try {
    const target = canonicalTarget(fullPath)
    const cwd = existingDirectory(target)
    const root = gitRoot(cwd)
    if (!root) return false
    const query = (args) => {
      const result = git(args, cwd)
      if (result.status !== 0 || result.error) throw new Error('Git metadata unavailable')
      return result.stdout.trim()
    }
    const top = realpathSync(root)
    // Git can skip malformed nested .git directories and discover an outer repo.
    for (let parent = cwd; parent !== top; parent = dirname(parent)) {
      if (dirname(parent) === parent) return false
      try {
        lstatSync(resolve(parent, '.git'))
        return false
      } catch (error) {
        if (error.code !== 'ENOENT') return false
      }
    }
    const gitDir = realpathSync(query(['rev-parse', '--absolute-git-dir']))
    const common = realpathSync(query(['rev-parse', '--path-format=absolute', '--git-common-dir']))
    if (gitDir === common || dirname(gitDir) !== resolve(common, 'worktrees')) return false
    const marker = resolve(top, '.git')
    if (!lstatSync(marker).isFile()) return false
    if (realpathSync(readFileSync(resolve(gitDir, 'gitdir'), 'utf8').trim()) !== marker) return false
    const pointer = readFileSync(marker, 'utf8').trim()
    if (!pointer.startsWith('gitdir: ') || realpathSync(resolve(top, pointer.slice(8))) !== gitDir) return false
    const registry = query(['worktree', 'list', '--porcelain', '-z'])
    return registry.split('\0\0').some((record) =>
      record.split('\0').some((field) => field === `worktree ${top}`))
  } catch {
    return false
  }
}

export function isMainRepoPluginPath(fullPath) {
  if (isWorktreePath(fullPath)) return false
  if (fullPath.includes(MAIN_PLUGINS_MARK)) return true
  const normalized = fullPath.replace(/\\/g, '/')
  return normalized.includes('/omnimux-client/plugins/') || normalized.startsWith('plugins/') || normalized.includes('/plugins/')
}

export function isEphemeralPath(fullPath) {
  const parts = fullPath.split(/[\\/]/).filter(Boolean)
  if (parts.some((part) => EPHEMERAL_DIR_NAMES.has(part))) return true
  const base = parts[parts.length - 1] || ''
  if (EPHEMERAL_BASENAMES.has(base)) return true
  return EPHEMERAL_SUFFIXES.some((suffix) => base.endsWith(suffix))
}

function repoRelativePath(fullPath, cwd) {
  let normalizedFullReal = String(fullPath || '').replace(/\\/g, '/')
  let targetDir = cwd
  try {
    if (normalizedFullReal.startsWith('/')) {
      normalizedFullReal = canonicalTarget(normalizedFullReal).replace(/\\/g, '/')
      targetDir = existingDirectory(normalizedFullReal)
    }
  } catch {
    // fallback to provided cwd
  }
  const root = gitRoot(targetDir) || gitRoot(cwd) || ''
  let normalizedRoot = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '')
  try {
    if (normalizedRoot && normalizedRoot.startsWith('/')) {
      normalizedRoot = realpathSync(normalizedRoot).replace(/\\/g, '/').replace(/\/+$/, '')
    }
  } catch {
    // keep raw root
  }
  if (normalizedRoot && normalizedFullReal.startsWith(normalizedRoot + '/')) {
    return normalizedFullReal.slice(normalizedRoot.length + 1)
  }
  if (normalizedFullReal.startsWith('/')) {
    const marker = '/omnimux-client/'
    const idx = normalizedFullReal.lastIndexOf(marker)
    if (idx !== -1) {
      return normalizedFullReal.slice(idx + marker.length)
    }
  }
  return null
}

export function isAllowedPrimaryRuntimePath(fullPath, cwd) {
  const rel = repoRelativePath(fullPath, cwd)
  if (!rel) return false
  const cleanRel = rel.replace(/\/+$/, '')
  return PRIMARY_RUNTIME_ALLOWLIST_PREFIXES.some((prefix) => {
    const clean = prefix.replace(/\/+$/, '')
    return cleanRel === clean || cleanRel.startsWith(clean + '/')
  })
}

// Precondition: fullPath is an absolute path (all callers pass toFullPath /
// canonicalTarget output). Relative inputs return false — resolve first.
export function isProtectedScope(fullPath, cwd) {
  const rel = repoRelativePath(fullPath, cwd)
  // 仓库外路径（如 ~/.agents/skills 或 /tmp）不受仓库 Default-Deny 约束
  if (!rel) return false
  // Default-Deny 整个主检出根目录，仅显式本地运行态白名单放行
  return !isAllowedPrimaryRuntimePath(fullPath, cwd)
}

function git(args, cwd, preserveEnvironment = false) {
  const env = { ...process.env }
  if (!preserveEnvironment) {
    for (const key of Object.keys(env)) {
      if (key.startsWith('GIT_')) delete env[key]
    }
    // Discovery diagnostics are parsed only in this controlled locale.
    env.LC_ALL = 'C'
    env.LANGUAGE = 'C'
  }
  return spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function gitUnavailable(res) {
  return Boolean(res.error) || res.status === 128 || res.status == null
}

function gitRoot(cwd, preserveEnvironment = false) {
  const res = git(['rev-parse', '--show-toplevel'], cwd, preserveEnvironment)
  if (gitUnavailable(res) || res.status !== 0) return ''
  return String(res.stdout || '').trim()
}

export function isGitIgnored(fullPath, cwd) {
  const root = gitRoot(cwd) || cwd
  const res = git(['check-ignore', '-q', '--', fullPath], root)
  if (gitUnavailable(res)) return false
  return res.status === 0
}

/**
 * Confirm failed discovery is not hiding malformed or unreadable metadata.
 * @param {string} cwd Canonical existing target directory.
 * @returns {boolean} Whether every ancestor is free of Git markers.
 */
function hasNoGitMetadata(cwd) {
  for (let parent = cwd; ; parent = dirname(parent)) {
    try {
      lstatSync(resolve(parent, '.git'))
      return false
    } catch (error) {
      if (error.code !== 'ENOENT') return false
    }
    if (dirname(parent) === parent) return true
  }
}

/**
 * Classify Git state without treating a failed read as proof of tracking.
 * @param {string} fullPath Canonical target path.
 * @param {string} cwd Existing target directory.
 * @returns {'non-git-target'|'git-read-error'|'tracked-file'|'untracked-draft'}
 */
function gitFileState(fullPath, cwd) {
  const discovery = git(['rev-parse', '--show-toplevel'], cwd)
  if (discovery.error || discovery.status !== 0) {
    const notRepo = !discovery.error && discovery.status === 128 &&
      !String(discovery.stdout || '').trim() &&
      String(discovery.stderr || '').trim() === 'fatal: not a git repository (or any of the parent directories): .git'
    return notRepo && hasNoGitMetadata(cwd) ? 'non-git-target' : 'git-read-error'
  }
  const root = String(discovery.stdout || '').trim()
  if (!root) return 'git-read-error'
  const res = git(['ls-files', '--error-unmatch', '--', fullPath], root)
  if (res.error || ![0, 1].includes(res.status)) return 'git-read-error'
  return res.status === 0 ? 'tracked-file' : 'untracked-draft'
}

export function isGitTracked(fullPath, cwd) {
  const state = gitFileState(fullPath, cwd)
  // Keep the boolean API conservative for callers that cannot represent errors.
  return state === 'tracked-file' || state === 'git-read-error'
}

function toFullPath(filePath, cwd) {
  if (!filePath) return ''
  const home = homedirValue()
  const expanded = filePath === '~'
    ? home
    : filePath.startsWith('~/')
      ? join(home, filePath.slice(2))
      : filePath
  return expanded.startsWith('/') || isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

export function getUnpushedCommits(cwd) {
  const root = gitRoot(cwd, true) || cwd
  const res = git(['rev-list', 'origin/main..HEAD'], root, true)
  if (gitUnavailable(res) || res.status !== 0) return []
  return String(res.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function stripQuotedSpans(command) {
  return String(command)
    .replace(/\\"/g, '')
    .replace(/\\'/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
}

function commandSegments(command) {
  return stripQuotedSpans(command)
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function rawCommandSegments(command) {
  return String(command || '')
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Remove shell redirection tokens before argument classification so they are
 * never mistaken for command arguments (`pnpm install > log` is a dependency
 * restore, not `pnpm install log`).
 */
function stripShellRedirection(segment) {
  return String(segment || '')
    // descriptor duplication: 2>&1, 1>&2
    .replace(/(?:^|\s)\d*>&\d+(?=\s|$)/g, ' ')
    // file redirects: >file, >>file, 2>file, &>file, > "file with spaces"
    .replace(/(?:^|\s)(?:\d*>>?|&>)\s*(?:"[^"]*"|'[^']*'|[^\s;&|<>]+)/g, ' ')
    // input redirects: <file, <<<word
    .replace(/(?:^|\s)(?:<<<|<<|<)\s*(?:"[^"]*"|'[^']*'|[^\s;&|<>]+)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Flags whose next token is a value, not a positional/package argument. */
const VALUE_TAKING_FLAGS = new Set([
  '--filter', '-F', '--prefix', '-C', '--dir', '--registry', '--reporter',
  '--loglevel', '--depth', '--network-concurrency', '--store-dir',
  '--virtual-store-dir', '--modules-dir', '--config-dir', '--workspace-concurrency',
  '--use-node-version', '--fetch-retries', '--fetch-timeout',
  '--fetch-retry-mintimeout', '--fetch-retry-maxtimeout', '--child-concurrency',
])

/**
 * install 是否冻结了 lockfile。
 *
 * `--frozen-lockfile` 是 pnpm 与 yarn 的共同 flag，语义是「manifest 与 lockfile
 * 不匹配时失败退出，而不是改写 lockfile」——实测 pnpm 在 manifest 加依赖后
 * 带该 flag 会失败且 lockfile 哈希不变。`npm ci` 天然冻结，由调用方单独放行。
 *
 * @param {string[]} words 已解包、已去引号的完整命令词
 * @returns {boolean}
 */
export function isFrozenInstall(words) {
  return words.some((word) => {
    const value = String(word || '').toLowerCase()
    // --frozen-lockfile（pnpm / yarn v1）与 --immutable（Yarn 4 / Berry）。
    // =false / =0 等于关闭冻结，必须判为不冻结。
    if (value === '--frozen-lockfile' || value === '--immutable') return true
    if (value.startsWith('--frozen-lockfile=')) {
      const flagValue = value.slice('--frozen-lockfile='.length)
      return flagValue !== 'false' && flagValue !== '0'
    }
    if (value.startsWith('--immutable=')) {
      const flagValue = value.slice('--immutable='.length)
      return flagValue !== 'false' && flagValue !== '0'
    }
    // npm 的等价形态：--prefer-offline 不改 lockfile 但仍可能写，故不认；只认 ci 与冻结 flag。
    return false
  })
}

function positionalArgs(words) {
  const positional = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word.startsWith('-')) {
      if (VALUE_TAKING_FLAGS.has(word)) i += 1
      continue
    }
    positional.push(word)
  }
  return positional
}

/** Wrapper flags that consume the next token before the wrapped command starts. */
const WRAPPER_FLAGS_WITH_VALUE = new Set(['--package', '-p', '--with', '--node-options', '--registry', '--cache'])
const ENV_FLAGS_WITH_VALUE = new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])

function skipLeadingWrapperFlags(words) {
  let i = 0
  while (i < words.length) {
    const word = words[i]
    if (word === '--') {
      i += 1
      continue
    }
    if (!word.startsWith('-')) break
    i += WRAPPER_FLAGS_WITH_VALUE.has(word) ? 2 : 1
  }
  return words.slice(i)
}

function skipEnvWrapper(words) {
  let i = 0
  while (i < words.length) {
    const word = words[i]
    if (word === '--') {
      i += 1
      break
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      i += 1
      continue
    }
    if (word.startsWith('-')) {
      i += ENV_FLAGS_WITH_VALUE.has(word) ? 2 : 1
      continue
    }
    break
  }
  return words.slice(i)
}

/**
 * Unwrap `KEY=VAL`, `env`, `corepack`, `command`, `npx`, `pnpm exec|dlx`,
 * `npm exec`, `yarn exec|dlx`, `bunx` so the wrapped command is classified
 * with the same rules as a direct invocation. Bounded to 6 layers.
 */
function unwrapExecutionWrapper(words) {
  let current = words
  for (let depth = 0; depth < 6; depth += 1) {
    let envIdx = 0
    while (envIdx < current.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(current[envIdx])) {
      envIdx += 1
    }
    if (envIdx > 0) current = current.slice(envIdx)
    if (current.length === 0) break

    const head = commandBasename(current[0])
    const sub = (current[1] || '').toLowerCase()
    let rest = null
    if (head === 'env') {
      rest = skipEnvWrapper(current.slice(1))
    } else if (head === 'corepack' || head === 'command') {
      rest = skipLeadingWrapperFlags(current.slice(1))
    } else if (['npx', 'bunx'].includes(head)) {
      rest = skipLeadingWrapperFlags(current.slice(1))
    } else if (head === 'pnpm' && ['exec', 'dlx'].includes(sub)) {
      rest = skipLeadingWrapperFlags(current.slice(2))
    } else if (head === 'npm' && sub === 'exec') {
      rest = skipLeadingWrapperFlags(current.slice(2))
    } else if (head === 'yarn' && ['exec', 'dlx'].includes(sub)) {
      rest = skipLeadingWrapperFlags(current.slice(2))
    }
    if (!rest || rest.length === 0) break
    current = rest
  }
  return current
}

function looksLikeGitInvocation(segment) {
  return /(?:^|\s)git(?:\s|$)/i.test(segment)
}

/** 安全/只读类 git 子命令：整段放行，不进入写目标提取。 */
const GIT_SAFE_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote', 'fetch', 'pull',
  'ls-files', 'rev-parse', 'rev-list', 'describe', 'blame', 'shortlog',
  'config', 'help', 'version', 'reflog', 'worktree',
])

/** 会改工作树/历史的 git 子命令：主 checkout 上需拦截。 */
function classifyGitMutation(segment) {
  if (!looksLikeGitInvocation(segment)) return null
  const cleaned = String(segment)
    .replace(/^(\s*[a-zA-Z_][a-zA-Z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)+/, '')
    .trim()
  // strip git binary and global opts (-C/-c/--git-dir/--work-tree)
  let rest = cleaned.replace(/^(?:[^\s]*\/)?git\b/i, '').trim()
  rest = rest.replace(/^(?:(?:-C|--git-dir|--work-tree)(?:\s+(?:"[^"]*"|'[^']*'|\S+)|(?:=\S+))|-c\s+(?:"[^"]*"|'[^']*'|\S+)|--no-pager|--paginate)\s+/i, '')
  // repeatedly strip leading global options
  for (let i = 0; i < 8; i++) {
    const next = rest.replace(/^(?:(?:-C|--git-dir|--work-tree)(?:\s+(?:"[^"]*"|'[^']*'|\S+)|(?:=\S+))|-c\s+(?:"[^"]*"|'[^']*'|\S+)|--no-pager|--paginate)\s+/i, '')
    if (next === rest) break
    rest = next
  }
  const words = tokenizeCommandLine(rest)
  if (words.length === 0) return null
  const sub = words[0].toLowerCase()
  if (GIT_SAFE_SUBCOMMANDS.has(sub)) return null

  // push --force / -f
  if (sub === 'push' && words.some((w) => w === '--force' || w === '-f' || w.startsWith('--force='))) {
    return { kind: 'force-push', segment }
  }
  if (['apply', 'am', 'cherry-pick', 'rebase', 'revert'].includes(sub)) {
    return { kind: sub, segment }
  }
  if (sub === 'stash') {
    const action = (words[1] || '').toLowerCase()
    if (['pop', 'apply', 'drop', 'clear'].includes(action)) {
      return { kind: `stash-${action}`, segment }
    }
    return null
  }
  if (sub === 'checkout') {
    // branch switch / create stay allowed; path restore (`--` or trailing paths) is mutation
    if (words.includes('--') || words.some((w) => w.includes('stash@{'))) {
      return { kind: 'checkout-path', segment }
    }
    // `git checkout -f` already covered by destructive reset; keep path-less branch ops allowed
    return null
  }
  if (sub === 'restore') {
    // restore always mutates worktree/index when targeting paths; deny on main checkout
    return { kind: 'restore', segment }
  }
  return null
}

export function decideGitWorkingTreeMutation(command, cwd) {
  if (!command || typeof command !== 'string') return { decision: 'allow' }
  const sessionCwd = resolve(cwd || process.cwd())
  const rawTarget = resolveGitTargetPath(command, sessionCwd)
  for (const seg of commandSegments(command)) {
    if (!looksLikeGitInvocation(seg)) continue
    const mutation = classifyGitMutation(seg)
    if (!mutation) continue
    const target = rawTarget || resolveGitTargetPath(seg, sessionCwd) || sessionCwd
    if (isWorktreePath(target)) continue
    const root = gitRoot(target)
    if (root && isWorktreePath(root)) continue
    return {
      decision: 'deny',
      reason: 'forbidden-main-checkout-git-mutation',
      mutation: mutation.kind,
      target,
      segment: seg,
    }
  }
  return { decision: 'allow' }
}


export function isDestructiveResetCommand(command) {
  if (!command || typeof command !== 'string') return false
  return commandSegments(command).some((seg) => {
    if (!looksLikeGitInvocation(seg)) return false
    if (/\breset\b/i.test(seg) && /(?:^|\s)--hard\b/.test(seg)) return true
    if (/\bcheckout\b/i.test(seg) && /(?:^|\s)-f\b/.test(seg)) return true
    if (/\brestore\b/i.test(seg) && /--source=origin\/(?:main|master)\b/.test(seg)) return true
    if (/\bclean\b/i.test(seg) && /(?:^|\s)-[a-z]*[fx]\b/i.test(seg)) return true
    return false
  })
}

function tokenizeCommandLine(cmd) {
  const tokens = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\' && !inSingle) {
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) {
    tokens.push(current)
  }
  return tokens
}

export function extractCommandWriteTargets(command) {
  if (!command || typeof command !== 'string') return []
  const targets = []
  // 必须保留引号内载荷：node -e / python -c 的写路径全在引号里；
  // commandSegments() 会 stripQuotedSpans，导致解释器一句话写盘完全不可见。
  const segments = rawCommandSegments(command)

  for (const seg of segments) {
    // 拆分管道符 | (避免管道下游命令如 tee 漏检)，避开 || 逻辑或
    const subSegments = seg.split(/(?<!\|)\|(?!\|)/).map((s) => s.trim()).filter(Boolean)

    for (const sub of subSegments) {
      const cleaned = sub.replace(/^(\s*[a-zA-Z_][a-zA-Z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)+/, '').trim()
      if (!cleaned) continue

      // 安全 git 子命令整段跳过；变异 git 由 decideGitWorkingTreeMutation 单独判定
      if (looksLikeGitInvocation(cleaned) && !classifyGitMutation(cleaned)) {
        continue
      }
      if (looksLikeGitInvocation(cleaned)) {
        continue
      }

      // 提取重定向目标 > 或 >> (避开 2>&1 等描述符重定向)
      const redirectMatches = cleaned.matchAll(/(?:^|[^&>0-9])(?:>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/g)
      for (const m of redirectMatches) {
        const target = m[1] || m[2] || m[3]
        if (target && target !== '/dev/null') {
          targets.push(target)
        }
      }

      const words = tokenizeCommandLine(cleaned)
      if (words.length === 0) continue

      const verb = words[0].toLowerCase()

      if (['cp', 'mv', 'rsync', 'install'].includes(verb)) {
        let target = null
        for (let i = 1; i < words.length; i++) {
          const arg = words[i]
          if (arg === '-t' || arg === '--target-directory') {
            target = words[i + 1]
            break
          }
          if (arg.startsWith('--target-directory=')) {
            target = arg.slice('--target-directory='.length)
            break
          }
        }
        if (!target) {
          const nonOptions = words.slice(1).filter((w) => !w.startsWith('-'))
          if (nonOptions.length >= 2) {
            target = nonOptions[nonOptions.length - 1]
          }
        }
        if (target) {
          targets.push(target)
        }
      } else if (verb === 'tee') {
        const nonOptions = words.slice(1).filter((w) => !w.startsWith('-'))
        for (const f of nonOptions) {
          targets.push(f)
        }
      } else if (['mkdir', 'touch'].includes(verb)) {
        const optionArgs = verb === 'mkdir'
          ? new Set(['-m', '--mode'])
          : new Set(['-r', '--reference', '-t', '-d', '--date'])
        for (let i = 1; i < words.length; i++) {
          const w = words[i]
          if (w.startsWith('-')) {
            if (optionArgs.has(w)) i++
            continue
          }
          targets.push(w)
        }
      } else if (verb === 'sed' && words.some((w) => w === '-i' || w.startsWith('-i'))) {
        const nonOptions = words.slice(1).filter((w) => !w.startsWith('-'))
        if (nonOptions.length >= 1) {
          targets.push(nonOptions[nonOptions.length - 1])
        }
      } else if (verb === 'dd') {
        for (const w of words.slice(1)) {
          if (w.startsWith('of=')) {
            targets.push(w.slice(3))
          }
        }
      } else if (verb === 'ln') {
        const nonOptions = words.slice(1).filter((w) => !w.startsWith('-'))
        if (nonOptions.length >= 2) {
          targets.push(nonOptions[nonOptions.length - 1])
        } else if (nonOptions.length === 1) {
          targets.push(nonOptions[0])
        }
      } else if (verb === 'node' || verb.endsWith('/node')) {
        // node -e / --eval one-liners that embed writeFileSync('path'
        // tokenizeCommandLine strips outer quotes, so joined looks like:
        //   node -e require('fs').writeFileSync('path','x')
        // Do NOT use \b around -e (hyphen is non-word; \b fails between space and '-').
        const hasEval = words.some((w) => w === '-e' || w === '--eval' || w.startsWith('--eval='))
        const joined = words.join(' ')
        if (hasEval && /writeFileSync|appendFileSync|createWriteStream/.test(joined)) {
          for (const m of joined.matchAll(/(?:writeFileSync|appendFileSync|createWriteStream)\(\s*['"]([^'"]+)['"]/g)) {
            targets.push(m[1])
          }
        }
      } else if (verb === 'python' || verb === 'python3' || verb.endsWith('/python') || verb.endsWith('/python3')) {
        const hasC = words.some((w) => w === '-c')
        const joined = words.join(' ')
        if (hasC && /open\(/.test(joined)) {
          for (const m of joined.matchAll(/open\(\s*['"]([^'"]+)['"]\s*,\s*['"][^'"]*[wa+][^'"]*['"]/g)) {
            targets.push(m[1])
          }
        }
      } else if (verb === 'perl' && words.some((w) => w === '-i' || w.startsWith('-i'))) {
        const nonOptions = words.slice(1).filter((w) => !w.startsWith('-'))
        if (nonOptions.length >= 1) {
          targets.push(nonOptions[nonOptions.length - 1])
        }
      }
    }
  }

  return targets
}

export function isForbiddenMainCheckoutWriteTarget(targetPath, cwd) {
  if (!targetPath || typeof targetPath !== 'string') return false
  const cleanTarget = targetPath.trim().replace(/^['"]|['"]$/g, '').replace(/\/\*+$/, '')
  if (!cleanTarget || cleanTarget === '-' || cleanTarget === '/dev/null' || cleanTarget === '/dev/stdout' || cleanTarget === '/dev/stderr') {
    return false
  }
  const rawFull = toFullPath(cleanTarget, cwd)
  if (!rawFull) return false
  let fullPath = rawFull
  let targetDir = cwd
  try {
    fullPath = canonicalTarget(rawFull)
    targetDir = existingDirectory(fullPath)
  } catch {
    return true // fail closed on unresolvable symlinks/paths
  }
  if (isWorktreePath(fullPath)) return false

  const state = gitFileState(fullPath, targetDir)
  if (state === 'non-git-target') return false
  if (state === 'tracked-file' || state === 'git-read-error') return true
  return !isAllowedPrimaryRuntimePath(fullPath, targetDir)
}

const READONLY_INSPECTION_VERBS = new Set([
  'echo', 'printf', 'cat', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail',
  'less', 'more', 'which', 'type', 'stat', 'ls', 'wc', 'file', 'awk',
  'git', 'diff', 'cmp', 'readlink', 'realpath', 'dirname', 'basename',
  'test', '[', '[[', 'bat', 'nl',
])

const MATERIALIZATION_SCRIPT_RE = /(?:^|\/)(?:sync-to-app|sync-stable|materialize-with-rollback|sync-main)\.sh$/

function classifyMaterializationSegment(words) {
  if (!words || words.length === 0) return null
  const unwrapped = unwrapExecutionWrapper(words)
  if (unwrapped.length === 0) return null
  const verb = commandBasename(unwrapped[0])

  // 豁免纯只读/检视命令（如多行脚本里的 grep ... sync-to-app.sh 或 sed -n ... sync-to-app.sh）
  if (READONLY_INSPECTION_VERBS.has(verb)) return null
  if (verb === 'sed' && !unwrapped.slice(1).some((w) => w === '-i' || /^-[a-zA-Z]*i/.test(w))) return null

  const hasIsolated = unwrapped.some((w) => w === '--isolated')

  // 1. 直接执行物化脚本（./scripts/sync-to-app.sh 等）
  if (MATERIALIZATION_SCRIPT_RE.test(unwrapped[0])) {
    return { script: commandBasename(unwrapped[0]), isolated: hasIsolated && unwrapped[0].endsWith('sync-to-app.sh') }
  }

  // 2. 通过 shell 显式执行（bash scripts/sync-to-app.sh；豁免 bash -n 语法检查）
  if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.'].includes(verb)) {
    let i = 1
    let syntaxCheckOnly = false
    while (i < unwrapped.length && unwrapped[i].startsWith('-')) {
      const flag = unwrapped[i]
      if (flag === '--') {
        i += 1
        break
      }
      if (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(flag)) syntaxCheckOnly = true
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag) && unwrapped[i + 1]) {
        return classifyMaterializationCommand(unwrapped[i + 1])
      }
      i += 1
    }
    if (syntaxCheckOnly) return null
    const scriptArg = unwrapped[i] || ''
    if (MATERIALIZATION_SCRIPT_RE.test(scriptArg)) {
      return { script: commandBasename(scriptArg), isolated: hasIsolated && scriptArg.endsWith('sync-to-app.sh') }
    }
    return null
  }

  // 3. node scripts/omnimux.mjs sync 或 omnimux(.mjs) sync（豁免 node --test / *.test.* / vitest / jest）
  if (verb === 'node') {
    if (unwrapped.some((w) => w === '--test' || w === '--check' || w === '-c' || /\.test\.(?:mjs|js|ts)$/.test(w))) {
      return null
    }
    let i = 1
    while (i < unwrapped.length && unwrapped[i].startsWith('-')) {
      i += 1
    }
    const scriptArg = unwrapped[i] || ''
    const subArg = unwrapped[i + 1] || ''
    if (/(?:^|\/)omnimux(?:\.mjs)?$/.test(scriptArg) && subArg === 'sync') {
      return { script: 'omnimux.mjs sync', isolated: hasIsolated }
    }
    return null
  }

  if (verb === 'omnimux' || verb === 'omnimux.mjs') {
    if (unwrapped[1] === 'sync') {
      return { script: `${verb} sync`, isolated: hasIsolated }
    }
    return null
  }

  // 4. 包管理器入口：yarn omnimux:sync / pnpm sync / npm run omnimux:sync
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(verb)) {
    const parsed = parsePackageManagerScript(unwrapped)
    if (parsed && (parsed.script === 'omnimux:sync' || parsed.script === 'sync')) {
      return { script: `${verb} ${parsed.script}`, isolated: hasIsolated }
    }
  }

  return null
}

function classifyMaterializationCommand(command) {
  if (!command || typeof command !== 'string') return null
  const trimmed = command.trim()
  if (!trimmed) return null
  if (/\b(?:vitest|jest)\b/.test(trimmed)) return null

  const segments = rawCommandSegments(trimmed)
    .flatMap((seg) => seg.split(/(?<!\|)\|(?!\|)/).map((s) => s.trim()).filter(Boolean))

  let matched = null
  for (const seg of segments) {
    const words = tokenizeCommandLine(stripShellRedirection(seg)).map((w) => w.replace(/^['"]|['"]$/g, ''))
    const hit = classifyMaterializationSegment(words)
    if (!hit) continue
    if (!hit.isolated) return hit
    matched = hit
  }
  return matched
}

export function isMaterializationCommand(command) {
  return Boolean(classifyMaterializationCommand(command))
}

export function decideMaterializationCommand({ cwd }) {
  const resolvedCwd = resolve(cwd || process.cwd())

  // 1. 检查是否在 linked worktree 路径下
  if (isWorktreePath(resolvedCwd)) {
    return {
      decision: 'deny',
      reason: 'forbidden-worktree-materialization',
      cwd: resolvedCwd,
    }
  }

  // 检查 .git 是否是文件 (linked worktree 的典型底层标识)
  try {
    const gitPath = resolve(resolvedCwd, '.git')
    const stat = lstatSync(gitPath)
    if (stat.isFile()) {
      return {
        decision: 'deny',
        reason: 'forbidden-worktree-materialization',
        cwd: resolvedCwd,
      }
    }
  } catch {
    // ignore
  }

  // 2. 检查当前分支是否为 main
  const branchResult = spawnSync('git', ['-C', resolvedCwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const branch = (branchResult.stdout || '').trim()
  if (branch && branch !== 'main') {
    return {
      decision: 'deny',
      reason: 'forbidden-worktree-materialization',
      branch,
      cwd: resolvedCwd,
    }
  }

  // 3. 检查当前本地主分支是否落后于远程 origin/main
  const revList = spawnSync('git', ['-C', resolvedCwd, 'rev-list', '--count', 'HEAD..origin/main'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const behindCount = parseInt((revList.stdout || '').trim(), 10)
  if (!isNaN(behindCount) && behindCount > 0) {
    return {
      decision: 'deny',
      reason: 'forbidden-stale-main-materialization',
      behindCount,
      cwd: resolvedCwd,
    }
  }

  // 4. 检查当前本地主分支是否领先于远程 origin/main (未推送的本地合并或私有提交)
  const aheadList = spawnSync('git', ['-C', resolvedCwd, 'rev-list', '--count', 'origin/main..HEAD'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const aheadCount = parseInt((aheadList.stdout || '').trim(), 10)
  if (!isNaN(aheadCount) && aheadCount > 0) {
    return {
      decision: 'deny',
      reason: 'forbidden-diverged-main-materialization',
      aheadCount,
      cwd: resolvedCwd,
    }
  }

  return { decision: 'allow' }
}

/** 从命令段解析 `git -C <path>` 的真实目标仓库；无 -C 时返回 null。 */
export function resolveGitTargetPath(seg, cwd) {
  const m = /(?:^|\s)-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(seg)
  if (!m) return null
  const raw = (m[1] || m[2] || m[3] || '').trim()
  if (!raw) return null
  return isAbsolute(raw) ? raw : resolve(cwd, raw)
}

const GUARD_SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

/** Test hook: override the owning repository root; leave null to resolve from the script path. */
export let OWNER_REPO_ROOT = null

export function setOwnerRepoRoot(root) {
  OWNER_REPO_ROOT = root
}

/**
 * Repository that owns this guard script (the omnimux-client checkout that installed it).
 * For a linked worktree the script lives at <repo>/.worktrees/<task>/scripts/, so the
 * owning root is still the directory two levels above the script. Returns null when the
 * script is not inside a Git work tree — the main-branch gate then protects nothing.
 */
function guardOwnerRepoRoot() {
  if (OWNER_REPO_ROOT !== null) return OWNER_REPO_ROOT
  const scriptsParent = resolve(GUARD_SCRIPT_DIR, '..')
  const result = spawnSync('git', ['-C', scriptsParent, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (result.status !== 0 || result.error) return null
  const top = result.stdout.trim()
  if (!top) return null
  try {
    return realpathSync(top)
  } catch {
    return top
  }
}

/** Git top-level of the directory a command effectively runs in, or null when not in a repo. */
function commandTargetRepoRoot(target) {
  const result = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (result.status !== 0 || result.error) return null
  const top = result.stdout.trim()
  if (!top) return null
  try {
    return realpathSync(top)
  } catch {
    return top
  }
}

export function decideMainBranchGitOp(command, cwd, options = {}) {
  if (!command || typeof command !== 'string') return { decision: 'allow' }
  const sessionCwd = resolve(cwd || process.cwd())
  const rawOwnerRoot = options.ownerRoot !== undefined ? options.ownerRoot : guardOwnerRepoRoot()
  let ownerRoot = rawOwnerRoot
  if (typeof rawOwnerRoot === 'string' && rawOwnerRoot) {
    try {
      ownerRoot = realpathSync(rawOwnerRoot)
    } catch {
      ownerRoot = rawOwnerRoot
    }
  }
  // 在「未剥离引号」的原始命令上解析 -C；commandSegments() 会剥掉引号内容，
  // 只在剥离后的片段上查找会漏掉 `git -C "<path>"` 这种最常用的写法。
  const rawTarget = resolveGitTargetPath(command, sessionCwd)
  const rawSegments = rawCommandSegments(command)
  const segments = commandSegments(command)
  let effectiveCwd = sessionCwd
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    // cd 只改变后续命令段的执行目录，不改变显式 git -C 的目标；
    // 目标取自未剥离引号的原始段，commandSegments() 里引号内容已被抹掉。
    const rawSeg = rawSegments[i] || ''
    const cdMatch = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(rawSeg)
    if (cdMatch) {
      const targetDir = (cdMatch[1] || cdMatch[2] || cdMatch[3] || '').trim()
      if (targetDir) effectiveCwd = isAbsolute(targetDir) ? targetDir : resolve(effectiveCwd, targetDir)
      continue
    }
    if (!looksLikeGitInvocation(seg)) continue
    const isMerge = /(?:^|\s)merge\b/.test(seg)
    const isCommit = /(?:^|\s)commit\b/.test(seg)
    if (!isMerge && !isCommit) continue

    // 允许合法的远端快进同步：git merge origin/main 或 git merge --ff-only origin/main
    if (isMerge && (seg.includes('origin/main') || seg.includes('origin/master'))) {
      continue
    }

    // hook 收到的 cwd 是会话工作目录，不代表命令真正的执行目录；
    // 必须优先采用命令里显式声明的 -C 目标，其次是已生效的 cd 目录，最后才是会话 cwd。
    const target = rawTarget || resolveGitTargetPath(seg, effectiveCwd) || effectiveCwd
    if (isWorktreePath(target)) continue

    // 只保护本脚本所属仓库：目标目录不属于 omnimux-client 时不拦截外部仓的 main 操作。
    const targetRoot = commandTargetRepoRoot(target)
    if (!ownerRoot || targetRoot !== ownerRoot) continue

    const branchResult = spawnSync('git', ['-C', target, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
      encoding: 'utf8',
      timeout: 3000,
    })
    const branch = (branchResult.stdout || '').trim()
    if (branch === 'main') {
      if (isMerge) {
        return {
          decision: 'deny',
          reason: 'forbidden-main-branch-merge',
          cwd: target,
        }
      }
      if (isCommit) {
        return {
          decision: 'deny',
          reason: 'forbidden-main-branch-commit',
          cwd: target,
        }
      }
    }
  }
  return { decision: 'allow' }
}

const PM_DIR_FLAGS = new Set(['--dir', '-C', '--prefix'])
const PM_VALUE_FLAGS = new Set([
  ...VALUE_TAKING_FLAGS,
  '--workspace', '-w', '--cwd',
])
const BUILD_SCRIPT_RE = /^(?:build|compile|bundle|package)(?::.+)?$|^plugins:build$/i

function parsePackageManagerScript(effectiveWords) {
  if (!effectiveWords || effectiveWords.length < 2) return null
  let i = 1
  let targetDir = ''
  while (i < effectiveWords.length) {
    const w = effectiveWords[i]
    if (w === '--') break
    if (w.startsWith('-')) {
      const eq = w.indexOf('=')
      if (eq !== -1) {
        const flag = w.slice(0, eq)
        if (PM_DIR_FLAGS.has(flag)) targetDir = w.slice(eq + 1)
        i += 1
        continue
      }
      if (PM_DIR_FLAGS.has(w) && i + 1 < effectiveWords.length) {
        targetDir = effectiveWords[i + 1]
        i += 2
        continue
      }
      i += PM_VALUE_FLAGS.has(w) ? 2 : 1
      continue
    }
    break
  }
  if (i >= effectiveWords.length) return null
  const subcommand = effectiveWords[i].toLowerCase()
  const restAfterSub = effectiveWords.slice(i + 1)
  let script = subcommand
  if (subcommand === 'run' || subcommand === 'run-script') {
    let j = 0
    while (j < restAfterSub.length && restAfterSub[j].startsWith('-')) {
      j += PM_VALUE_FLAGS.has(restAfterSub[j]) ? 2 : 1
    }
    script = (restAfterSub[j] || '').toLowerCase()
  }
  return { subcommand, script, restAfterSub, targetDir }
}

export function decideMainCheckoutBuildCommand(command, cwd) {
  if (!command || typeof command !== 'string') return { decision: 'allow' }
  const sessionCwd = resolve(cwd || process.cwd())
  let currentCwd = sessionCwd
  // One synchronous decision shares a metadata snapshot only for the exact cwd.
  const worktreeByCwd = new Map()
  const isCwdWorktree = (dir) => {
    if (!worktreeByCwd.has(dir)) {
      let inWorktree = isWorktreePath(dir)
      if (!inWorktree) {
        const root = gitRoot(dir)
        inWorktree = Boolean(root && isWorktreePath(root))
      }
      worktreeByCwd.set(dir, inWorktree)
    }
    return worktreeByCwd.get(dir)
  }

  // 拆分管道：`pnpm install … | tail` 的下游命令不参与包管理器/构建判定。
  const segments = rawCommandSegments(command)
    .flatMap((seg) => seg.split(/(?<!\|)\|(?!\|)/).map((s) => s.trim()).filter(Boolean))
  for (const seg of segments) {
    const words = tokenizeCommandLine(stripShellRedirection(seg))
    if (words.length === 0) continue

    const verb = words[0].toLowerCase()
    if (verb === 'git' || verb.endsWith('/git')) continue

    // 0. 跨命令段追踪 cd 目标目录（如 cd .worktrees/task && pnpm build 合法放行）
    if (verb === 'cd') {
      const targetDir = words[1] ? words[1].replace(/^['"]|['"]$/g, '') : ''
      if (targetDir) {
        currentCwd = resolve(currentCwd, targetDir)
      }
      continue
    }

    // 若当前实际生效的工作目录处于 linked worktree 内，完全放行构建
    if (isCwdWorktree(currentCwd)) continue

    const cleanWords = words.map((w) => w.replace(/^['"]|['"]$/g, ''))

    // 包装执行器（KEY=VAL / env / corepack / npx / pnpm exec|dlx / npm exec / yarn dlx / bunx）先解包，
    // 再按被包装命令本身做构建/依赖恢复判定。
    const effectiveWords = unwrapExecutionWrapper(cleanWords)
    const effectiveVerb = commandBasename(effectiveWords[0])

    // 1. tsc（严密校验 --noEmit，杜绝 --noEmit=false 或 --noEmit false 等篡改穿透，包含 pnpm/yarn/npm exec 包装）
    const isTscInvocation =
      effectiveVerb === 'tsc' ||
      (effectiveVerb === 'npx' && effectiveWords[1] === 'tsc') ||
      (['pnpm', 'yarn', 'bun'].includes(effectiveVerb) && effectiveWords[1] === 'tsc') ||
      (effectiveVerb === 'npm' && effectiveWords[1] === 'exec' && effectiveWords.includes('tsc'))

    if (isTscInvocation) {
      let isNoEmit = false
      for (let i = 0; i < effectiveWords.length; i++) {
        const w = effectiveWords[i]
        if (w === '--noEmit') {
          const next = effectiveWords[i + 1]
          if (next !== 'false' && next !== '0') {
            isNoEmit = true
          }
        } else if (w.startsWith('--noEmit=')) {
          const val = w.slice('--noEmit='.length).toLowerCase()
          if (val !== 'false' && val !== '0') {
            isNoEmit = true
          }
        }
      }
      if (!isNoEmit) {
        return {
          decision: 'deny',
          reason: 'forbidden-main-checkout-build',
          command: seg,
        }
      }
    }

    // 2. build / build:* / compile / compile:* / bundle / bundle:* / package:* 禁止；
    //    冻结依赖恢复放行，manifest/lock 变更与未冻结 install 仍禁止。
    if (['pnpm', 'npm', 'yarn', 'bun'].includes(effectiveVerb)) {
      const parsed = parsePackageManagerScript(effectiveWords)
      if (!parsed) continue
      // 若通过 --dir / -C / --prefix 显式指向真实 linked worktree，放行
      if (parsed.targetDir && isCwdWorktree(resolve(currentCwd, parsed.targetDir))) {
        continue
      }
      const { subcommand, script, restAfterSub } = parsed
      if (BUILD_SCRIPT_RE.test(script)) {
        return {
          decision: 'deny',
          reason: 'forbidden-main-checkout-build',
          command: seg,
        }
      }
      // `pnpm add/remove/update…` 与带包名的安装会改 package.json/lock，仍拦截。
      const manifestMutation = ['add', 'remove', 'uninstall', 'update', 'up', 'upgrade', 'link', 'unlink', 'dedupe', 'prune', 'publish', 'pack']
      if (manifestMutation.includes(subcommand)) {
        return {
          decision: 'deny',
          reason: 'forbidden-main-checkout-build',
          command: seg,
        }
      }
      if (['install', 'i', 'ci'].includes(subcommand)) {
        // 依赖恢复（primary 维护 / node_modules 修复）：只允许无位置包名的
        // install/ci；带值 flag 的值不算位置参数，其余非 flag 参数按 add 语义保守拒绝。
        const positional = positionalArgs(restAfterSub)
        if (positional.length > 0) {
          return {
            decision: 'deny',
            reason: 'forbidden-main-checkout-build',
            command: seg,
          }
        }
        // 主检出的 install 必须冻结 lockfile：不带冻结 flag 时 pnpm 会按 manifest
        // 重写 pnpm-lock.yaml，这一步不经过 edit/write，因而绕开 tracked-file 保护
        // （实测：manifest 加一个依赖后 lockfile 哈希即变）。`ci` 天然冻结，跳过本判定。
        if (subcommand !== 'ci' && !isFrozenInstall(effectiveWords)) {
          return {
            decision: 'deny',
            reason: 'forbidden-main-checkout-unfrozen-install',
            command: seg,
            manager: effectiveVerb,
          }
        }
      }
    }

    // 3. direct vite build or esbuild
    if ((effectiveVerb === 'vite' && effectiveWords.includes('build')) || effectiveVerb === 'esbuild') {
      return {
        decision: 'deny',
        reason: 'forbidden-main-checkout-build',
        command: seg,
      }
    }
  }

  return { decision: 'allow' }
}

export function decideWorktreeAddCommand(command, cwd) {
  if (!command || typeof command !== 'string') return { decision: 'allow' }
  const segments = commandSegments(command)
  for (const seg of segments) {
    if (!looksLikeGitInvocation(seg)) continue
    if (/(?:^|\s)worktree\s+add\b/.test(seg)) {
      if (!seg.includes('origin/main')) {
        return {
          decision: 'deny',
          reason: 'forbidden-non-origin-worktree-add',
        }
      }
    }
  }
  return { decision: 'allow' }
}

/**
 * Roots whose unbounded recursive traversal stalls a session: the observed
 * incident `find "$HOME" -name "*insp_ad704927*"` ran to the 60s tool timeout
 * before being killed, and the preceding `glob` on the same root failed outright.
 */
const UNBOUNDED_SCAN_ROOTS = Object.freeze([
  '/',
  '/users',
  '/home',
  '/volumes',
  '/system',
  '/private',
  '/library',
  '/applications',
])

/** Tree-walking binaries; `ls` joins them only with an explicit recursive flag. */
const TREE_WALK_COMMANDS = new Set(['find', 'grep', 'egrep', 'rg', 'fd', 'fdfind', 'du'])

/** `find -maxdepth N` with N at or below this bound is a scoped search, not a sweep. */
const MAX_SCOPED_FIND_DEPTH = 4

function homedirValue() {
  return String(process.env.HOME || '').replace(/\/+$/, '')
}

/**
 * Resolve the literal path a scan would start from: expands `~` / `$HOME`,
 * trims trailing slashes. Returns '' for an empty token.
 */
export function normalizeScanTarget(rawPath, homeDir = homedirValue()) {
  const raw = String(rawPath ?? '').trim()
  if (!raw) return ''
  const home = String(homeDir || '').replace(/\/+$/, '')
  let value = raw
  if (value === '~' || value === '$HOME' || value === '${HOME}') {
    value = home || raw
  } else if (/^~\//.test(value)) {
    value = home ? `${home}${value.slice(1)}` : raw
  } else if (/^\$\{?HOME\}?(\/|$)/.test(value)) {
    value = home ? `${home}${value.replace(/^\$\{?HOME\}?/, '')}` : raw
  }
  const trimmed = value.replace(/\/+$/, '')
  return trimmed || '/'
}

/**
 * True when a path names a traversal root broad enough to stall the session:
 * the filesystem root, a top-level system directory, or the user's home.
 * Paths inside a project (`$HOME/Project/example/plugins`) stay allowed.
 */
export function isUnboundedScanRoot(rawPath, homeDir = homedirValue()) {
  const target = normalizeScanTarget(rawPath, homeDir)
  if (!target || target === '.') return false
  const lower = target.toLowerCase()
  if (UNBOUNDED_SCAN_ROOTS.includes(lower)) return true
  const home = String(homeDir || '').replace(/\/+$/, '')
  return Boolean(home) && lower === home.toLowerCase()
}

function commandBasename(token) {
  return String(token || '').split('/').pop().toLowerCase()
}

function hasScopedFindDepth(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-maxdepth' || token === '--maxdepth') {
      const next = Number(tokens[i + 1])
      if (Number.isFinite(next) && next <= MAX_SCOPED_FIND_DEPTH) return true
    }
    const inline = /^(?:-maxdepth|--maxdepth)=?(\d+)$/.exec(token)
    if (inline && Number(inline[1]) <= MAX_SCOPED_FIND_DEPTH) return true
  }
  return false
}

/**
 * Locate collection roots for one scan segment. Returns [] when the command is
 * not a tree walk, or when it is bounded (relative path, or scoped find depth).
 */
function scanRootsForSegment(tokens) {
  const binary = commandBasename(tokens[0])
  if (binary === 'find') {
    if (hasScopedFindDepth(tokens)) return []
    // find requires its path before any expression; a leading flag means cwd.
    const firstArg = tokens[1]
    return firstArg && !firstArg.startsWith('-') ? [firstArg] : []
  }
  if (binary === 'ls') {
    if (!tokens.some((t) => t === '-R' || t === '--recursive')) return []
    return tokens.slice(1).filter((t) => !t.startsWith('-'))
  }
  if (TREE_WALK_COMMANDS.has(binary)) {
    return tokens.slice(1).filter((t) => !t.startsWith('-'))
  }
  return []
}

/**
 * Detect an unbounded sweep in a shell command, including the `cd <home> &&
 * find .` shape where the root is armed by a preceding segment.
 *
 * @returns {{segment: string, binary: string, target: string} | null}
 */
export function findUnboundedScanSegment(command, homeDir = homedirValue()) {
  if (!command || typeof command !== 'string') return null
  let armedRoot = ''
  for (const segment of commandSegments(command)) {
    const tokens = tokenizeCommandLine(segment)
    if (tokens.length === 0) continue
    const binary = commandBasename(tokens[0])

    if (binary === 'cd') {
      const target = tokens[1]
      armedRoot = target && isUnboundedScanRoot(target, homeDir) ? normalizeScanTarget(target, homeDir) : ''
      continue
    }

    const roots = scanRootsForSegment(tokens)
    const walksTree = binary === 'find' || binary === 'ls' || TREE_WALK_COMMANDS.has(binary)
    if (!walksTree) {
      armedRoot = ''
      continue
    }

    // `find` without a path argument walks the current directory.
    const effective = roots.length > 0 ? roots : (binary === 'find' ? ['.'] : [])

    for (const candidate of effective) {
      if (isUnboundedScanRoot(candidate, homeDir)) {
        return { segment, binary, target: normalizeScanTarget(candidate, homeDir) }
      }
    }
    // `cd <home> && find .` — the sweep root is the directory just entered.
    if (armedRoot && effective.length > 0 && effective.every((root) => root === '.')) {
      return { segment, binary, target: armedRoot }
    }
    armedRoot = ''
  }
  return null
}

/**
 * Guard the dedicated `glob` / `grep` tools, whose `path` argument can name a
 * traversal root just as a shell command can. An omitted path stays inside the
 * session workspace and is always allowed.
 */
export function decideSearchTarget({ toolName, toolInput = {}, homeDir = homedirValue() } = {}) {
  const name = String(toolName || '').toLowerCase()
  if (name !== 'glob' && name !== 'grep') return { decision: 'allow' }
  const rawPath = String(toolInput.path ?? '').trim()
  if (!rawPath) return { decision: 'allow', reason: 'workspace-default' }
  if (!isUnboundedScanRoot(rawPath, homeDir)) return { decision: 'allow' }
  return {
    decision: 'deny',
    reason: 'forbidden-unbounded-scan',
    target: normalizeScanTarget(rawPath, homeDir),
    tool: name,
  }
}

export function decideBashCommand({ command, cwd, ownerRoot }) {
  if (!command || typeof command !== 'string') return { decision: 'allow' }

  if(command.includes('recover-media-build-3288.mjs')&&command.trim()!=='node scripts/recover-media-build-3288.mjs --apply')return {decision:'deny',reason:'scoped-media-build-recovery-invalid-command'}
  if(command.trim()==='node scripts/recover-media-build-3288.mjs --apply') {
    const root=dirname(dirname(fileURLToPath(import.meta.url)))
    const script='scripts/recover-media-build-3288.mjs'
    const committed=spawnSync('git',['-C',root,'show','HEAD:'+script],{timeout:3000})
    try {
      if(realpathSync(cwd||process.cwd())===realpathSync(root)&&realpathSync(resolve(root,script))===resolve(root,script)&&committed.status===0&&committed.stdout.equals(readFileSync(resolve(root,script))))return {decision:'allow',reason:'scoped-media-build-recovery'}
    } catch {}
    return {decision:'deny',reason:'scoped-media-build-recovery-identity-mismatch'}
  }

  // 1. 检查破坏性重置未推送提交
  if (isDestructiveResetCommand(command)) {
    const unpushed = getUnpushedCommits(cwd)
    if (unpushed.length > 0) {
      return {
        decision: 'deny',
        reason: 'unpushed-commits-at-risk',
        unpushedCount: unpushed.length,
        unpushedCommits: unpushed,
      }
    }
    return { decision: 'allow', reason: 'clean-upstream' }
  }

  // 2. 检查以家目录/根目录为起点的无界递归扫描（会造成 60s 超时假死）
  const unboundedScan = findUnboundedScanSegment(command)
  if (unboundedScan) {
    return {
      decision: 'deny',
      reason: 'forbidden-unbounded-scan',
      target: unboundedScan.target,
      binary: unboundedScan.binary,
      segment: unboundedScan.segment,
    }
  }

  // 3. 检查试图通过命令行拷贝/写入/移动到主 checkout 受保护目录
  const targets = extractCommandWriteTargets(command)
  for (const target of targets) {
    if (isForbiddenMainCheckoutWriteTarget(target, cwd)) {
      return {
        decision: 'deny',
        reason: 'forbidden-main-checkout-copy',
        target,
      }
    }
  }

  // 3.5. 检查主检出下执行修改性构建与编译命令（防编译器穿透与主目录变脏）
  const buildDecision = decideMainCheckoutBuildCommand(command, cwd)
  if (buildDecision.decision === 'deny') {
    return buildDecision
  }

  // 3.75. 检查主 checkout 上会改工作树的 git 变异子命令（apply/am/stash pop/checkout -- 等）
  const gitMutation = decideGitWorkingTreeMutation(command, cwd)
  if (gitMutation.decision === 'deny') {
    return gitMutation
  }

  // 4. 检查在主仓本地 main 分支上执行 git merge 或 git commit
  const mainBranchOps = decideMainBranchGitOp(command, cwd, { ownerRoot })
  if (mainBranchOps.decision === 'deny') {
    return mainBranchOps
  }

  // 5. 检查 git worktree add 是否显式绑定了 origin/main
  const wtAddDecision = decideWorktreeAddCommand(command, cwd)
  if (wtAddDecision.decision === 'deny') {
    return wtAddDecision
  }

  // 6. 检查多 Agent 物化覆盖风险（防冲刷物理硬门禁；--isolated 隔离物化自最新 origin/main 签出临时 worktree，放行）
  const matHit = classifyMaterializationCommand(command)
  if (matHit && !matHit.isolated) {
    const matDecision = decideMaterializationCommand({ cwd })
    if (matDecision.decision === 'deny') {
      return matDecision
    }
  }

  return { decision: 'allow' }
}

export function decideWrite({ filePath, cwd, toolName }) {
  // Normalize toolName to handle namespace e.g. "default_api:edit" -> "edit"
  const rawName = String(toolName || '').toLowerCase()
  const name = rawName.replace(/^.*:/, '')
  if (name !== 'edit' && name !== 'write') return { decision: 'allow' }

  let fullPath = toFullPath(String(filePath || '').trim(), cwd)
  if (!fullPath) return { decision: 'allow' }
  try {
    fullPath = canonicalTarget(fullPath)
    cwd = existingDirectory(fullPath)
  } catch {
    return { decision: 'deny', fullPath, reason: 'unresolved-target' }
  }

  // 1. 独立 Worktree 目录完全豁免放行
  if (isWorktreePath(fullPath)) {
    return { decision: 'allow', fullPath, reason: 'worktree-isolated' }
  }

  // 2. 判定 Git 归属与跟踪状态（仓库外非 Git 目标放行；Git 读取异常 fail-closed；已跟踪文件一律拦截）
  // Classification is not cross-workspace authorization; that remains external.
  const state = gitFileState(fullPath, cwd)
  if (state === 'non-git-target') {
    return { decision: 'allow', fullPath, reason: state }
  }
  if (state === 'tracked-file' || state === 'git-read-error') {
    return { decision: 'deny', fullPath, reason: state }
  }

  // 3. 主检出 Default-Deny 极小白名单：仅放行显式本地协作运行态目录（当前仅 .workbuddy/）
  if (isAllowedPrimaryRuntimePath(fullPath, cwd)) {
    return { decision: 'allow', fullPath, reason: 'primary-runtime-allowlist' }
  }

  // 4. 主检出根目录默认拒绝：拦截任意非白名单路径（含现有目录、未来新增目录与 .tmp/.agent-reports/dist 等）
  return { decision: 'deny', fullPath, reason: 'untracked-protected-scope' }
}

function decisionJson(hookEventName, decision, reason, extra = {}) {
  const output = {
    hookEventName,
    permissionDecision: decision,
  }
  if (decision === 'deny') {
    if (reason === 'unpushed-commits-at-risk') {
      output.permissionDecisionReason = [
        `🚫【DSH 核心安全阻断】拦截破坏性重置：检测到当前本地分支存在尚未推送到远端 origin/main 的提交（共 ${extra.unpushedCount || 0} 个）！`,
        '📌 事故防范守则：执行 git reset --hard 会导致这些未同步的本地工作成果被永久抹去（本会话曾出现同类事故）。',
        '👉 正确流程：',
        '  1. 若成果有效：请切换到工作分支推送远端（git push / 提 PR 合入 main）；',
        '  2. 若确需重置：请先执行备份命令（如 git tag backup/safety-$(date +%s)）后再安全处理。',
      ].join('\n')
    } else if (reason === 'git-read-error') {
      output.permissionDecisionReason = '🚫【OmniMux 仓库 Hook】Git 状态读取失败，无法确认目标的版本管理状态；保守拒绝写入。请检查 Git 可用性、仓库元数据与读取权限，不要绕过门禁。'
    } else if (reason === 'unresolved-target') {
      output.permissionDecisionReason = '🚫【OmniMux 仓库 Hook】目标路径无法安全解析；保守拒绝写入。请检查路径读取权限、符号链接及父目录。'
    } else if (reason === 'forbidden-unbounded-scan') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 仓库 Hook】严禁以用户家目录或系统根目录为起点做无界递归扫描！',
        `🎯 被拦截的目标：${extra.target || '未知路径'}${extra.binary ? `（${extra.binary}）` : ''}`,
        '📌 事故背景：对 $HOME 或 / 的全盘遍历会持续数十秒直至触发 60 秒工具超时被杀，界面表现为长时间“深度求索中”假死。',
        '👉 正确做法：',
        '  1. 灵感 / 资产引用：@inspiration/、@asset/ 是虚拟实体指针，原样传给 video_breakdown_analyze、video_analyze 等工具即可被中枢解析，不需要在本地磁盘查找物理文件；',
        '  2. 查找本地文件：把范围收敛到当前项目工作区内的具体子目录，不要从家目录或根目录起扫；',
        '  3. 确需限定深度时：find 请显式附加 -maxdepth（≤ 4）。',
      ].join('\n')
    } else if (reason === 'forbidden-main-checkout-copy') {
      output.permissionDecisionReason = [
        `🚫【OmniMux 仓库 Hook】严禁通过命令行向主目录核心受保护路径（${extra.target || '目标路径'}）复制、移动或写入文件！`,
        '📌 核心防线原则：主目录仅允许通过 Git 进行常规合并与同步最新代码，严禁通过 cp/mv/重定向越过版本管理篡改主干代码。',
        '👉 强制流程：主目录核心路径已被物理写保护。请暂停当前动作，向用户汇报当前阻断并等待用户下达工作区规划指示，严禁私自调用脚本绕行！',
      ].join('\n')
    } else if (reason === 'forbidden-worktree-materialization') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 多 Agent 防覆盖硬拦截】严禁在临时工作树 (Worktree) 或非主分支直接执行测试环境物化/刷新！',
        '📌 事故防范守则：多个工作流并发时，直接在临时工作区刷新开发环境会暴力覆盖其他并发任务已物化的正式成果，导致他人代码被顶替失效。',
        '👉 强制标准流程：',
        '  1. 当前功能在工作区开发并自测通过后，提交 PR 经由 Merge Queue 合入主分支；',
        '  2. 在主分支执行交付同步 (ship)，拉齐最新主干成果；',
        '  3. 统一切回主检出目录 (main 分支) 执行统一物化，确保增量合并更新，杜绝覆盖。',
      ].join('\n')
    } else if (reason === 'forbidden-stale-main-materialization') {
      output.permissionDecisionReason = [
        `🚫【OmniMux 多 Agent 防覆盖硬拦截】本地主分支落后于远程 origin/main（落后 ${extra.behindCount || 0} 个提交），严禁拿过时代码物化刷新！`,
        '📌 事故防范守则：远程主分支已被其他并发任务推进了新提交，若直接物化将导致测试环境版本倒退并冲掉他人刚合入的成果。',
        '👉 强制标准流程：',
        '  请先在主目录执行: git pull --ff-only origin main',
        '  将他人已合入的最新成果拉齐融合后，再执行物化，确保更新为增量叠加！',
      ].join('\n')
    } else if (reason === 'forbidden-diverged-main-materialization') {
      output.permissionDecisionReason = [
        `🚫【OmniMux 多 Agent 防覆盖硬拦截】本地主分支领先于远程 origin/main（存在 ${extra.aheadCount || 0} 个未推送的私有提交），严禁物化刷新！`,
        '📌 事故防范守则：本地主分支堆积了未在云端合入的私有提交，若直接物化将导致未经评审的半成品脏代码流入共享开发环境。',
        '👉 强制标准流程：',
        '  请保持本地 main 与 origin/main 严格 1:1 对齐 (0 ahead, 0 behind)，所有改动走 PR 合并后再执行物化！',
      ].join('\n')
    } else if (reason === 'forbidden-main-checkout-unfrozen-install') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 主检出硬隔离拦截】主检出的 install 必须冻结 lockfile，否则会静默改写 pnpm-lock.yaml。',
        `🎯 被拦截的命令：${extra.command || 'install 命令'}`,
        '📌 为什么：不带冻结 flag 的 install 会按 package.json 重写 lockfile，这一步不经过 edit/write，因而绕开 tracked-file 保护——主检出反复出现 lockfile 漂移就是这么来的。',
        '👉 正确做法（任选其一）：',
        `   1. 依赖维护加冻结 flag：${extra.manager === 'npm' ? 'npm ci' : `${extra.manager || 'pnpm'} install --frozen-lockfile`}`,
        '   2. 需要真正改动依赖时，切入专属 Worktree 再改；',
        '   3. 若确属 lockfile 已漂移需要修复，先在工作树里改好并合入，再回主检出同步。',
      ].join('\n')
    } else if (reason === 'forbidden-main-checkout-build') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 主检出硬隔离拦截】主目录除 .tmp/ 目录外严禁执行构建/编译/产物命令；会改 package.json 或 lock 的包管理变更同样禁止。',
        `🎯 被拦截的命令：${extra.command || '构建命令'}`,
        '📌 核心防线原则：主目录除 .tmp 外必须保持洁净，严禁在主检出运行 build/tsc 触发编译器副作用；依赖恢复（pnpm install / npm ci，无包名参数）已放行。',
        '👉 强制流程：构建请切入专属 Worktree；依赖维护（如 node_modules 元数据修复）可直接在主目录执行 pnpm install --frozen-lockfile。',
      ].join('\n')
    } else if (reason === 'forbidden-main-checkout-git-mutation') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 仓库 Hook】严禁在主 checkout 通过 git 变异子命令改写工作树！',
        `📌 被拦截操作：${extra.mutation || 'git mutation'}`,
        '👉 强制流程：请暂停当前动作，向用户汇报当前阻断并等待指示切入专属 Worktree；严禁私自绕行。',
      ].join('\n')
    } else if (reason === 'forbidden-main-branch-merge') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 多 Agent 隔离守卫】严禁在本地主干执行 git merge！',
        '📌 核心守则：本地 main 分支为纯只读镜像，严禁私自合并代码。所有特性分支必须推送到远端，通过 GitHub PR 经 CI 门禁全绿后统一合并入 origin/main。',
        '👉 正确流程：请在独立 Worktree 中开发，使用 gh pr create 提交合并请求。',
      ].join('\n')
    } else if (reason === 'forbidden-main-branch-commit') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 多 Agent 隔离守卫】严禁在本地主干直接执行 git commit！',
        '📌 核心守则：本地 main 分支为纯只读镜像，严禁直接提交代码。',
        '👉 强制流程：本地主干禁止直接提交代码。请向用户汇报当前阻断，并等待指示切入专属 Worktree 进行提交！',
      ].join('\n')
    } else if (reason === 'forbidden-non-origin-worktree-add') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 多 Agent 隔离守卫】新建工作树必须显式以 origin/main 为唯一起点！',
        '📌 核心守则：严禁基于本地旧状态或未推送分支签出工作树，防止将他人半成品脏代码引入新环境。',
        '👉 强制流程：新建工作树必须基于 origin/main。请检查命令入参，显式指定 origin/main 为起点！',
      ].join('\n')
    } else if (reason === 'untracked-protected-scope') {
      output.permissionDecisionReason = [
        '🚫【OmniMux 仓库 Hook】主 checkout 已启用根目录默认拒绝（Default-Deny），严禁直接新建非白名单文件！',
        `📌 核心防线原则：主目录仅白名单放行真实 linked worktree 与本地运行态目录（${PRIMARY_RUNTIME_ALLOWLIST_PREFIXES.join(', ')}），其余路径（含现有目录、未来新增目录与 .tmp/.agent-reports/dist 等）一律拒绝写入。`,
        '👉 强制流程：请暂停当前写入，在独立 linked worktree 或 /tmp 完成任务，严禁私自绕行！',
      ].join('\n')
    } else {
      output.permissionDecisionReason = [
        '🚫【OmniMux 仓库 Hook】严禁在主 checkout 直接修改任何已加入版本管理（Git Tracked）的文件！',
        '📌 核心防线原则：版本管理的文件一旦在主目录被修改，将面临未经审核的脏提交，或者在同步拉取时被覆盖/丢弃。',
        '👉 强制流程：主目录 Git 受控文件禁止直接写入。请暂停当前写入，向用户汇报当前阻断并等待用户明确指示，严禁私自调用脚本绕行！',
      ].join('\n')
    }
  }
  return { hookSpecificOutput: output }
}

function handle(rawInput) {
  const input = JSON.parse(rawInput || '{}')
  const hookEventName = input.hook_event_name || 'PreToolUse'
  const rawTool = String(input.tool_name || '').toLowerCase()
  const toolName = rawTool.replace(/^.*:/, '')
  const toolInput = input.tool_input || {}
  const cwd = String(input.cwd || process.cwd())

  if (toolName === 'bash') {
    const command = String(toolInput.command || '').trim()
    const workdir = typeof toolInput.workdir === 'string' && toolInput.workdir.trim()
      ? resolve(cwd, toolInput.workdir) : cwd
    const ownerRoot = typeof toolInput.ownerRoot === 'string' && toolInput.ownerRoot.trim()
      ? realpathSync(resolve(cwd, toolInput.ownerRoot)) : undefined
    const result = decideBashCommand({ command, cwd: workdir, ownerRoot })
    return decisionJson(hookEventName, result.decision, result.reason, result)
  }

  if (toolName === 'glob' || toolName === 'grep') {
    const result = decideSearchTarget({ toolName, toolInput })
    return decisionJson(hookEventName, result.decision, result.reason, result)
  }

  const filePath = String(toolInput.file_path || '').trim()
  const result = decideWrite({ filePath, cwd, toolName })
  return decisionJson(hookEventName, result.decision, result.reason, result)
}

function main() {
  let rawInput = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    rawInput += chunk
  })
  process.stdin.on('end', () => {
    try {
      process.stdout.write(JSON.stringify(handle(rawInput)) + '\n')
    } catch (err) {
      process.stderr.write(`[guard-worktree error] ${err.message}\n`)
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        }) + '\n',
      )
    }
  })
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) main()
