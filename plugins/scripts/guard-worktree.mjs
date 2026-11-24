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
import { accessSync, constants, lstatSync, realpathSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

function scanBalancedParen(input, openIdx) {
  let depth = 1
  let inSingle = false
  let inDouble = false
  let escaped = false
  let i = openIdx + 1
  while (i < input.length && depth > 0) {
    const ch = input[i]
    if (escaped) {
      escaped = false
      i += 1
      continue
    }
    if (ch === '\\' && !inSingle) {
      escaped = true
      i += 1
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      i += 1
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      i += 1
      continue
    }
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1) + 1
      continue
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) return i
      }
    }
    i += 1
  }
  return input.length - 1
}

function scanBacktick(input, openIdx) {
  let escaped = false
  for (let i = openIdx + 1; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '`') return i
  }
  return input.length - 1
}

/**
 * If `input[openIdx..]` starts a Bash arithmetic `(( ... ))` span (where the
 * inner `(` closes immediately before the outer `)`, distinguishing it from
 * nested subshells like `((pnpm build:all) && true)`), return the index of the
 * closing outer `)`. Otherwise return -1.
 */
function scanArithmeticDoubleParen(input, openIdx) {
  if (input[openIdx] !== '(' || input[openIdx + 1] !== '(') return -1
  const outerEnd = scanBalancedParen(input, openIdx)
  if (outerEnd >= input.length || input[outerEnd] !== ')') return -1
  const innerEnd = scanBalancedParen(input, openIdx + 1)
  return innerEnd === outerEnd - 1 && input[innerEnd] === ')' ? outerEnd : -1
}

const CMD_POS_KEYWORDS = new Set([
  'if', 'elif', 'while', 'until', 'then', 'do', 'else', '!', 'time',
])

/**
 * Determine whether `input[targetIdx]` sits at a Bash command position where
 * reserved words like `[[` or `case` are recognized (preventing argument-position
 * bypasses such as `: [[ ; echo pwn > README.md ; : ]]` or `FOO=1 [[ || ... ]]`).
 */
function isAtCommandPosition(input, targetIdx) {
  let atCmdPos = true
  let afterTime = false
  const caseStates = [] // stack of 'word' | 'pattern' | 'body'
  let i = 0

  while (i < targetIdx) {
    const ch = input[i]
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n' || ch === ';') {
      if (ch === ';' && (input[i + 1] === ';' || input[i + 1] === '&')) {
        if (caseStates.length > 0 && caseStates[caseStates.length - 1] === 'body') {
          caseStates[caseStates.length - 1] = 'pattern'
        }
        i += input[i + 1] === ';' && input[i + 2] === '&' ? 3 : 2
        atCmdPos = false
        afterTime = false
        continue
      }
      atCmdPos = true
      afterTime = false
      i += 1
      continue
    }
    if (ch === '#') {
      while (i < targetIdx && input[i] !== '\n') i += 1
      continue
    }
    if (ch === '&' || ch === '|') {
      if (ch === '&' && input[i + 1] === '>') {
        i += input[i + 2] === '>' ? 3 : 2
        atCmdPos = false
        afterTime = false
        continue
      }
      if (ch === '|' && input[i + 1] === '&') {
        i += 2
      } else if (input[i + 1] === ch) {
        i += 2
      } else {
        i += 1
      }
      if (ch === '|' && caseStates.length > 0 && caseStates[caseStates.length - 1] === 'pattern') {
        continue
      }
      atCmdPos = true
      afterTime = false
      continue
    }
    if (ch === '(') {
      if (caseStates.length > 0 && caseStates[caseStates.length - 1] === 'pattern') {
        i += 1
        continue
      }
      if (input[i + 1] === '(') {
        const arithEnd = scanArithmeticDoubleParen(input, i)
        if (arithEnd !== -1 && arithEnd < targetIdx) {
          i = arithEnd + 1
          atCmdPos = false
          afterTime = false
          continue
        }
      }
      atCmdPos = true
      afterTime = false
      i += 1
      continue
    }
    if (ch === ')') {
      if (caseStates.length > 0 && caseStates[caseStates.length - 1] === 'pattern') {
        caseStates[caseStates.length - 1] = 'body'
        atCmdPos = true
        afterTime = false
      } else {
        atCmdPos = false
        afterTime = false
      }
      i += 1
      continue
    }
    if (ch === '{' && atCmdPos && (i + 1 >= input.length || /\s/.test(input[i + 1]))) {
      atCmdPos = true
      afterTime = false
      i += 1
      continue
    }
    if (ch === '<' || ch === '>') {
      if (input[i + 1] === '(') {
        const end = scanBalancedParen(input, i + 1)
        i = end + 1
        atCmdPos = false
        afterTime = false
        continue
      }
      i += 1
      atCmdPos = false
      afterTime = false
      continue
    }

    let word = ''
    let hadQuotes = false
    let inS = false
    let inD = false
    let esc = false
    while (i < targetIdx) {
      const c = input[i]
      if (esc) {
        word += c
        hadQuotes = true
        esc = false
        i += 1
        continue
      }
      if (c === '\\' && !inS) {
        esc = true
        hadQuotes = true
        i += 1
        continue
      }
      if (c === "'" && !inD) {
        inS = !inS
        hadQuotes = true
        i += 1
        continue
      }
      if (c === '"' && !inS) {
        inD = !inD
        hadQuotes = true
        i += 1
        continue
      }
      if (!inS && c === '$' && input[i + 1] === '(') {
        const end = scanBalancedParen(input, i + 1)
        hadQuotes = true
        i = end + 1
        continue
      }
      if (!inS && !inD && (c === '<' || c === '>') && input[i + 1] === '(') {
        const end = scanBalancedParen(input, i + 1)
        hadQuotes = true
        i = end + 1
        continue
      }
      if (!inS && c === '`') {
        const end = scanBacktick(input, i)
        hadQuotes = true
        i = end + 1
        continue
      }
      if (!inS && !inD && c === '=' && input[i + 1] === '(') {
        const end = scanBalancedParen(input, i + 1)
        hadQuotes = true
        i = end + 1
        continue
      }
      if (!inS && !inD && /[\s;&|<>()]/.test(c)) {
        break
      }
      word += c
      i += 1
    }

    if (i > targetIdx) return false

    const topCase = caseStates.length > 0 ? caseStates[caseStates.length - 1] : null
    if (topCase === 'word') {
      if (!hadQuotes && word === 'in') {
        caseStates[caseStates.length - 1] = 'pattern'
      }
      atCmdPos = false
      afterTime = false
      continue
    }
    if (topCase === 'pattern') {
      if (!hadQuotes && word === 'esac') {
        caseStates.pop()
      }
      atCmdPos = false
      afterTime = false
      continue
    }
    if (atCmdPos && !hadQuotes) {
      if (word === 'case') {
        caseStates.push('word')
        atCmdPos = false
        afterTime = false
        continue
      }
      if (word === 'esac' && topCase === 'body') {
        caseStates.pop()
        atCmdPos = false
        afterTime = false
        continue
      }
      if (word === 'time') {
        atCmdPos = true
        afterTime = true
        continue
      }
      if (afterTime && word === '-p') {
        atCmdPos = true
        afterTime = false
        continue
      }
      if (CMD_POS_KEYWORDS.has(word)) {
        atCmdPos = true
        afterTime = false
        continue
      }
    }
    atCmdPos = false
    afterTime = false
  }
  return atCmdPos
}

/**
 * If `input[openIdx..]` starts a Bash conditional expression `[[ ... ]]`
 * strictly at command position, return the index of the second `]`.
 * Bail out on unquoted `;`, single `&`, or single `|` inside `[[ ... ]]`.
 * Otherwise return -1.
 */
function scanDoubleBracket(input, openIdx) {
  if (input[openIdx] !== '[' || input[openIdx + 1] !== '[') return -1
  if (openIdx > 0 && !/[\s;&|({!)]/.test(input[openIdx - 1])) return -1
  if (openIdx + 2 >= input.length || !/\s/.test(input[openIdx + 2])) return -1
  if (!isAtCommandPosition(input, openIdx)) return -1

  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = openIdx + 2; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(input, i)
      continue
    }
    if (!inSingle && !inDouble) {
      if (ch === ';') return -1
      if (ch === '&') {
        if (input[i + 1] === '&') {
          i += 1
          continue
        }
        return -1
      }
      if (ch === '|') {
        if (input[i + 1] === '|') {
          i += 1
          continue
        }
        return -1
      }
      if (ch === ']' && input[i + 1] === ']') {
        const prevOk = i > openIdx + 2 && /\s/.test(input[i - 1])
        const nextCh = input[i + 2] || ''
        const nextOk = nextCh === '' || /[\s;&|<>)]/.test(nextCh)
        if (prevOk && nextOk) return i + 1
      }
    }
  }
  return -1
}

function findCasePatternClose(text) {
  let inSingle = false
  let inDouble = false
  let escaped = false
  let start = 0
  if (text[0] === '(') start = 1
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1] || ''
    if (escaped) {
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
    if (!inSingle && ch === '$' && next === '(') {
      i = scanBalancedParen(text, i + 1)
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && next === '(') {
      i = scanBalancedParen(text, i + 1)
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(text, i)
      continue
    }
    if (!inSingle && !inDouble && '?*+@!'.includes(ch) && next === '(') {
      i = scanBalancedParen(text, i + 1)
      continue
    }
    if (!inSingle && !inDouble && ch === ')') {
      return i
    }
  }
  return -1
}

/**
 * Given `input` where `input.slice(caseIdx)` starts with `case <word> ...`,
 * return the index immediately after the unquoted `in` keyword, or -1 if absent.
 */
function findCaseHeaderEnd(input, caseIdx = 0) {
  let i = caseIdx + 4
  if (i >= input.length || !/\s/.test(input[i])) return -1
  while (i < input.length && /\s/.test(input[i])) i += 1
  if (i >= input.length) return -1

  // Skip the `<word>` token (respecting quotes and substitutions)
  let inSingle = false
  let inDouble = false
  let escaped = false
  while (i < input.length) {
    const ch = input[i]
    if (escaped) {
      escaped = false
      i += 1
      continue
    }
    if (ch === '\\' && !inSingle) {
      escaped = true
      i += 1
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      i += 1
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      i += 1
      continue
    }
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1) + 1
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1) + 1
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(input, i) + 1
      continue
    }
    if (!inSingle && !inDouble && /[\s;&|<>()]/.test(ch)) break
    i += 1
  }

  while (i < input.length && /\s/.test(input[i])) i += 1
  if (
    input.slice(i, i + 2) === 'in' &&
    (i + 2 === input.length || /[\s;&|<>()]/.test(input[i + 2]))
  ) {
    return i + 2
  }
  return -1
}

/**
 * Split a shell command into top-level statements while respecting quotes,
 * unquoted `#` comments, heredoc bodies (`<<EOF` / `<<-'EOF'`), and command /
 * process substitutions (`$(...)`, `` `...` ``, `<(...)`, `>(...)`).
 *
 * Heredoc bodies are attached to the declaring statement instead of being
 * emitted as executable statements (preventing `cat <<'EOF'\ncd wt\nEOF` from
 * poisoning cwd tracking while letting shell invocations inspect stdin scripts).
 */
function splitShellStatements(command) {
  const input = String(command || '')
  const statements = []
  let currentStmt = { raw: '', prevOp: '', nextOp: '', heredocs: [] }
  let inSingle = false
  let inDouble = false
  let escaped = false
  let inComment = false
  let endsWithPipe = false
  const pendingHeredocs = []

  const flush = (op) => {
    const trimmed = currentStmt.raw.trim()
    if (trimmed) {
      currentStmt.raw = trimmed
      currentStmt.nextOp = op
      statements.push(currentStmt)
      currentStmt = { raw: '', prevOp: op, nextOp: '', heredocs: [] }
    } else {
      currentStmt.raw = ''
      // Preserve significant prevOp ('&&', '||', ';;', ';', '&') across blank lines
      if (op && op !== '\n') {
        currentStmt.prevOp = op
      } else if (!currentStmt.prevOp) {
        currentStmt.prevOp = op
      }
    }
    endsWithPipe = false
  }

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    const next = input[i + 1] || ''
    const prev = i > 0 ? input[i - 1] : ''

    if (inComment) {
      if (ch === '\n') {
        inComment = false
        // Fall through to newline / heredoc handling
      } else {
        continue
      }
    }

    if (escaped) {
      currentStmt.raw += ch
      escaped = false
      endsWithPipe = false
      continue
    }
    if (ch === '\\' && !inSingle) {
      currentStmt.raw += ch
      escaped = true
      endsWithPipe = false
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      currentStmt.raw += ch
      endsWithPipe = false
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      currentStmt.raw += ch
      endsWithPipe = false
      continue
    }

    // Keep $(...), <(...), >(...), and `...` intact inside the enclosing statement
    if (!inSingle && ch === '$' && next === '(') {
      const end = scanBalancedParen(input, i + 1)
      currentStmt.raw += input.slice(i, end + 1)
      i = end
      endsWithPipe = false
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && next === '(') {
      const end = scanBalancedParen(input, i + 1)
      currentStmt.raw += input.slice(i, end + 1)
      i = end
      endsWithPipe = false
      continue
    }
    if (!inSingle && ch === '`') {
      const end = scanBacktick(input, i)
      currentStmt.raw += input.slice(i, end + 1)
      i = end
      endsWithPipe = false
      continue
    }

    if (!inSingle && !inDouble) {
      // Keep Bash arithmetic `(( ... ))` and `[[ ... ]]` intact so `;` / `&&` / `||` inside them never split statements
      const arithEnd = scanArithmeticDoubleParen(input, i)
      if (arithEnd !== -1) {
        currentStmt.raw += input.slice(i, arithEnd + 1)
        i = arithEnd
        endsWithPipe = false
        continue
      }
      const bracketEnd = scanDoubleBracket(input, i)
      if (bracketEnd !== -1) {
        currentStmt.raw += input.slice(i, bracketEnd + 1)
        i = bracketEnd
        endsWithPipe = false
        continue
      }
      if (ch === '#' && (i === 0 || /[\s;&|({\n]/.test(prev))) {
        inComment = true
        continue
      }
      // Record heredoc declaration (`<<` or `<<-`, excluding here-string `<<<`)
      if (ch === '<' && next === '<' && input[i + 2] !== '<') {
        let j = i + 2
        let stripTabs = false
        if (input[j] === '-') {
          stripTabs = true
          j += 1
        }
        while (j < input.length && (input[j] === ' ' || input[j] === '\t')) j += 1
        let delim = ''
        let dSingle = false
        let dDouble = false
        let dEscaped = false
        while (j < input.length) {
          const dc = input[j]
          if (dEscaped) {
            delim += dc
            dEscaped = false
            j += 1
            continue
          }
          if (dc === '\\' && !dSingle) {
            dEscaped = true
            j += 1
            continue
          }
          if (dc === "'" && !dDouble) {
            dSingle = !dSingle
            j += 1
            continue
          }
          if (dc === '"' && !dSingle) {
            dDouble = !dDouble
            j += 1
            continue
          }
          if (!dSingle && !dDouble && /[\s;&|<>()#]/.test(dc)) break
          delim += dc
          j += 1
        }
        if (delim) {
          pendingHeredocs.push({ delim, stripTabs, targetStmt: currentStmt })
        }
        currentStmt.raw += input.slice(i, j)
        i = j - 1
        endsWithPipe = false
        continue
      }

      if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
        flush(ch + next)
        i += 1
        continue
      }
      if (ch === '|' && prev !== '|' && prev !== '>' && next !== '|') {
        if (next === '&') {
          currentStmt.raw += '|&'
          i += 1
        } else {
          currentStmt.raw += '|'
        }
        endsWithPipe = true
        continue
      }
      if (ch === ';' && next === ';' && input[i + 2] === '&') {
        flush(';;')
        i += 2
        continue
      }
      if (ch === ';' && (next === ';' || next === '&')) {
        flush(';;')
        i += 1
        continue
      }
      if (ch === ';') {
        flush(';')
        continue
      }
      if (ch === '\n') {
        const continuePipe = endsWithPipe
        if (!continuePipe) {
          flush('\n')
        } else {
          currentStmt.raw += ' '
        }
        while (pendingHeredocs.length > 0 && i + 1 < input.length) {
          const hd = pendingHeredocs.shift()
          const bodyLines = []
          let pos = i + 1
          while (pos <= input.length) {
            const nl = input.indexOf('\n', pos)
            const rawLine = (nl === -1 ? input.slice(pos) : input.slice(pos, nl)).replace(/\r$/, '')
            const candidate = hd.stripTabs ? rawLine.replace(/^\t+/, '') : rawLine
            if (candidate === hd.delim) {
              pos = nl === -1 ? input.length : nl + 1
              break
            }
            bodyLines.push(rawLine)
            if (nl === -1) {
              pos = input.length
              break
            }
            pos = nl + 1
          }
          hd.targetStmt.heredocs.push(bodyLines.join('\n'))
          i = pos - 1
        }
        continue
      }
      // Single '&' background separator (avoid >&, &>, |&, &&)
      if (ch === '&' && prev !== '>' && prev !== '|' && next !== '>' && next !== '&') {
        flush('&')
        continue
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        currentStmt.raw += ch
        continue
      }
    }
    currentStmt.raw += ch
    endsWithPipe = false
  }
  flush('')
  return statements
}

function splitRawPipelineSegments(segment, { startsWithCasePattern = false } = {}) {
  const input = String(segment || '')
  const parts = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) parts.push(trimmed)
    current = ''
  }

  let startIdx = 0
  if (startsWithCasePattern) {
    while (startIdx < input.length && /\s/.test(input[startIdx])) startIdx += 1
    const rest = input.slice(startIdx)
    if (rest && !/^esac(?:\s|$|[<>|;&)])/.test(rest) && !rest.startsWith(')')) {
      const patEnd = findCasePatternClose(rest)
      if (patEnd > 0) {
        current += rest.slice(0, patEnd + 1)
        startIdx += patEnd + 1
      }
    }
  }

  for (let i = startIdx; i < input.length; i += 1) {
    const ch = input[i]
    const prev = i > 0 ? input[i - 1] : ''
    const next = input[i + 1] || ''
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\' && !inSingle) {
      current += ch
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      continue
    }
    if (!inSingle && ch === '$' && next === '(') {
      const end = scanBalancedParen(input, i + 1)
      current += input.slice(i, end + 1)
      i = end
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && next === '(') {
      const end = scanBalancedParen(input, i + 1)
      current += input.slice(i, end + 1)
      i = end
      continue
    }
    if (!inSingle && ch === '`') {
      const end = scanBacktick(input, i)
      current += input.slice(i, end + 1)
      i = end
      continue
    }
    if (!inSingle && !inDouble) {
      const arithEnd = scanArithmeticDoubleParen(input, i)
      if (arithEnd !== -1) {
        current += input.slice(i, arithEnd + 1)
        i = arithEnd
        continue
      }
      const bracketEnd = scanDoubleBracket(input, i)
      if (bracketEnd !== -1) {
        current += input.slice(i, bracketEnd + 1)
        i = bracketEnd
        continue
      }
      // Keep inline `case <word> in (a|b)` pattern alternation `|` from splitting as a pipeline
      if (
        ch === 'c' &&
        input.slice(i, i + 4) === 'case' &&
        (i === 0 || /[\s;&|({!]/.test(prev)) &&
        i + 4 < input.length &&
        /\s/.test(input[i + 4]) &&
        isAtCommandPosition(input, i)
      ) {
        const inEnd = findCaseHeaderEnd(input, i)
        if (inEnd !== -1) {
          let j = inEnd
          while (j < input.length && /\s/.test(input[j])) j += 1
          const afterIn = input.slice(j)
          if (afterIn && !/^esac(?:\s|$|[<>|;&)])/.test(afterIn) && !afterIn.startsWith(')')) {
            const patEnd = findCasePatternClose(afterIn)
            if (patEnd > 0) {
              current += input.slice(i, j + patEnd + 1)
              i = j + patEnd
              continue
            }
          }
          current += input.slice(i, inEnd)
          i = inEnd - 1
          continue
        }
      }
    }
    // Split on pipe '|' or '|&', avoiding '||', and avoiding noclobber '>|'
    if (!inSingle && !inDouble && ch === '|' && prev !== '|' && prev !== '>' && next !== '|') {
      flush()
      if (next === '&') i += 1
      continue
    }
    current += ch
  }
  flush()
  return parts
}

function extractCommandSubstitutions(segment) {
  const input = String(segment || '')
  const subs = []
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (inSingle) continue
    if (ch === '$' && input[i + 1] === '(') {
      const end = scanBalancedParen(input, i + 1)
      if (input[i + 2] === '(') {
        const arithInner = input.slice(i + 3, Math.max(i + 3, end - 1)).trim()
        if (arithInner) subs.push(...extractCommandSubstitutions(arithInner))
      } else {
        const inner = input.slice(i + 2, end).trim()
        if (inner) subs.push(inner)
      }
      i = end
      continue
    }
    if (!inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      const end = scanBalancedParen(input, i + 1)
      const inner = input.slice(i + 2, end).trim()
      if (inner) subs.push(inner)
      i = end
      continue
    }
    if (ch === '`') {
      const end = scanBacktick(input, i)
      const inner = input.slice(i + 1, end).replace(/\\([`$\\])/g, '$1').trim()
      if (inner) subs.push(inner)
      i = end
    }
  }
  return subs
}

function hasHeredocOperator(segment) {
  const input = String(segment || '')
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (inSingle || inDouble) continue
    if (ch === '<' && input[i + 1] === '<' && input[i + 2] !== '<') return true
  }
  return false
}

/**
 * Peel leading subshell/grouping/control-flow tokens ('(', '{', '!', function
 * headers, if/elif/then/else/while/until/for/do/case/fi/done/esac) and split
 * at unmatched unquoted ')' / '}' closers that close an active subshell or
 * brace group, preserving any post-closer redirection tails (e.g. `) > README.md`)
 * so callers evaluate them in the restored outer cwd.
 */
function isArithmeticDoubleParen(body) {
  return scanArithmeticDoubleParen(body, 0) !== -1
}

function parseSubshellStage(rawStage, activeSubshellDepth = 0, activeBraceDepth = 0, { expectCasePattern = false } = {}) {
  let body = String(rawStage || '').trim()
  let leadingOpenParens = 0
  let leadingOpenBraces = 0
  let opensFunctionBlock = false
  let opensPendingFunction = false
  let opensLoopBrace = false
  let opensControlBlock = ''
  let resetsControlBranch = false
  let closesControlBlock = false
  let isControlHeaderOnly = false
  let consumedCasePattern = false
  const strippedHeaders = []

  // When inside a `case ... in` block expecting a pattern (`pat)` or `(pat)`),
  // consume the pattern header first so its `)` never closes an enclosing subshell.
  if (expectCasePattern && body && !/^esac(?:\s|$|[<>|;&)])/.test(body) && !body.startsWith(')')) {
    const patEnd = findCasePatternClose(body)
    if (patEnd > 0) {
      strippedHeaders.push(body.slice(0, patEnd + 1))
      body = body.slice(patEnd + 1).trimStart()
      consumedCasePattern = true
    }
  }

  for (;;) {
    if (body.startsWith('(') && !isArithmeticDoubleParen(body)) {
      leadingOpenParens += 1
      body = body.slice(1).trimStart()
      continue
    }
    if (/^\{\s+/.test(body) || body === '{') {
      leadingOpenBraces += 1
      body = body.slice(1).trimStart()
      continue
    }
    if (/^!\s+/.test(body)) {
      body = body.slice(1).trimStart()
      continue
    }
    // Standalone Allman-style function header (`f()` / `my-fn()` / `function my-fn` followed by newline + `{`)
    if (/^(?:function\s+[^\s;&|<>()'"`{}$]+(?:\s*\(\s*\))?|[^\s;&|<>()'"`{}$]+\s*\(\s*\))$/.test(body)) {
      opensPendingFunction = true
      isControlHeaderOnly = true
      break
    }
    // Inline function declaration with `{`: `my-fn() { ...` or `function my-fn { ...`
    const funcBraceMatch = /^(?:function\s+)?[^\s;&|<>()'"`{}$]+\s*(?:\(\s*\))?\s*\{(?:\s+|$)/.exec(body)
    if (funcBraceMatch && (/^function\s+/.test(funcBraceMatch[0]) || /\(\s*\)/.test(funcBraceMatch[0]))) {
      opensFunctionBlock = true
      leadingOpenBraces += 1
      body = body.slice(funcBraceMatch[0].length).trimStart()
      continue
    }
    // Inline function declaration with subshell body: `my-fn() ( ... )`
    const funcParenMatch = /^(?:function\s+)?[^\s;&|<>()'"`{}$]+\s*(?:\(\s*\))?\s*\(/.exec(body)
    if (funcParenMatch && (/^function\s+/.test(funcParenMatch[0]) || /\(\s*\)/.test(funcParenMatch[0]))) {
      body = body.slice(funcParenMatch[0].length - 1).trimStart()
      continue
    }
    if (/^(?:fi|done|esac)(?:\s|$|[<>|;&)])/.test(body)) {
      closesControlBlock = true
      body = body.replace(/^(?:fi|done|esac)/, '').trimStart()
      continue
    }
    if (/^else(?:\s+|$)/.test(body)) {
      resetsControlBranch = true
      body = body.slice(4).trimStart()
      continue
    }
    if (/^elif\s+/.test(body)) {
      resetsControlBranch = true
      body = body.slice(4).trimStart()
      continue
    }
    if (/^(?:then|do)\s+/.test(body)) {
      body = body.replace(/^(?:then|do)\s+/, '').trimStart()
      continue
    }
    if (/^(?:if|while|until)\s+/.test(body)) {
      const kw = /^([a-z]+)/.exec(body)[1]
      opensControlBlock = kw
      body = body.slice(kw.length).trimStart()
      continue
    }
    if (/^for\s+\(\(/.test(body)) {
      const arithStart = body.indexOf('((')
      const arithEnd = scanArithmeticDoubleParen(body, arithStart)
      if (arithEnd !== -1) {
        const afterArith = body.slice(arithEnd + 1).trimStart()
        if (/^do(?:\s+|$)/.test(afterArith)) {
          opensControlBlock = 'loop'
          strippedHeaders.push(body.slice(0, arithEnd + 1))
          body = afterArith
          continue
        }
        if (/^\{(?:\s+|$)/.test(afterArith)) {
          opensLoopBrace = true
          strippedHeaders.push(body.slice(0, arithEnd + 1))
          body = afterArith
          continue
        }
      }
      opensControlBlock = 'loop'
      isControlHeaderOnly = true
      break
    }
    if (/^(?:for|select)\s+/.test(body)) {
      opensControlBlock = 'loop'
      isControlHeaderOnly = true
      break
    }
    if (/^case\s+/.test(body)) {
      opensControlBlock = 'case'
      const inEnd = findCaseHeaderEnd(body, 0)
      if (inEnd === -1) {
        isControlHeaderOnly = true
        break
      }
      const casePrefix = body.slice(0, inEnd)
      const afterIn = body.slice(inEnd).trim()
      if (!afterIn) {
        isControlHeaderOnly = true
        break
      }
      strippedHeaders.push(casePrefix)
      body = afterIn
      if (!/^esac(?:\s|$|[<>|;&)])/.test(body) && !body.startsWith(')')) {
        const patEnd = findCasePatternClose(body)
        if (patEnd > 0) {
          strippedHeaders.push(body.slice(0, patEnd + 1))
          body = body.slice(patEnd + 1).trimStart()
          consumedCasePattern = true
        }
      }
      continue
    }
    break
  }

  let inSingle = false
  let inDouble = false
  let escaped = false
  let localParenDepth = 0
  let localBraceDepth = 0
  let remainingSubshells = activeSubshellDepth + leadingOpenParens
  let remainingBraces = activeBraceDepth + leadingOpenBraces
  const boundaries = []

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    const prev = i > 0 ? body[i - 1] : ''
    const next = body[i + 1] || ''
    if (escaped) {
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
    if (!inSingle && ch === '$' && next === '(') {
      i = scanBalancedParen(body, i + 1)
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && next === '(') {
      i = scanBalancedParen(body, i + 1)
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(body, i)
      continue
    }
    if (inSingle || inDouble) continue

    const arithEnd = scanArithmeticDoubleParen(body, i)
    if (arithEnd !== -1) {
      i = arithEnd
      continue
    }
    const bracketEnd = scanDoubleBracket(body, i)
    if (bracketEnd !== -1) {
      i = bracketEnd
      continue
    }

    if (ch === '(') {
      localParenDepth += 1
    } else if (ch === ')') {
      if (localParenDepth > 0) {
        localParenDepth -= 1
      } else if (remainingSubshells > 0) {
        remainingSubshells -= 1
        boundaries.push({ kind: ')', index: i })
      }
    } else if (ch === '{' && (i === 0 || /[\s;&|(]/.test(prev)) && (next === '' || /\s/.test(next))) {
      localBraceDepth += 1
    } else if (ch === '}' && (i === 0 || /[\s;&|)]/.test(prev)) && (next === '' || /[\s;&|<>)]/.test(next))) {
      if (localBraceDepth > 0) {
        localBraceDepth -= 1
      } else if (remainingBraces > 0) {
        remainingBraces -= 1
        boundaries.push({ kind: '}', index: i })
      }
    }
  }

  let innerBody = body
  const closers = []
  if (boundaries.length > 0) {
    innerBody = body.slice(0, boundaries[0].index).trim()
    for (let k = 0; k < boundaries.length; k += 1) {
      const start = boundaries[k].index + 1
      const end = k + 1 < boundaries.length ? boundaries[k + 1].index : body.length
      closers.push({ kind: boundaries[k].kind, tail: body.slice(start, end).trim() })
    }
  }

  return {
    leadingOpenParens,
    leadingOpenBraces,
    opensFunctionBlock,
    opensPendingFunction,
    opensLoopBrace,
    opensControlBlock,
    resetsControlBranch,
    closesControlBlock,
    isControlHeaderOnly,
    consumedCasePattern,
    strippedHeaders,
    innerBody,
    closers,
  }
}

function extractOutputRedirectionTargets(segment) {
  const input = String(segment || '')
  const targets = []
  let inSingle = false
  let inDouble = false
  let escaped = false

  const readTargetToken = (startIdx) => {
    let i = startIdx
    while (i < input.length && /\s/.test(input[i])) i += 1
    let token = ''
    let tSingle = false
    let tDouble = false
    let tEscaped = false
    while (i < input.length) {
      const ch = input[i]
      if (tEscaped) {
        token += ch
        tEscaped = false
        i += 1
        continue
      }
      if (ch === '\\' && !tSingle) {
        tEscaped = true
        i += 1
        continue
      }
      if (ch === "'" && !tDouble) {
        tSingle = !tSingle
        i += 1
        continue
      }
      if (ch === '"' && !tSingle) {
        tDouble = !tDouble
        i += 1
        continue
      }
      if (!tSingle && !tDouble && /[\s;&|<>()]/.test(ch)) {
        break
      }
      token += ch
      i += 1
    }
    return { token, nextIdx: i }
  }

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(input, i)
      continue
    }
    if (inSingle || inDouble) continue

    const arithEnd = scanArithmeticDoubleParen(input, i)
    if (arithEnd !== -1) {
      i = arithEnd
      continue
    }
    const bracketEnd = scanDoubleBracket(input, i)
    if (bracketEnd !== -1) {
      i = bracketEnd
      continue
    }

    let opLen = 0
    if (ch === '&' && input[i + 1] === '>') {
      opLen = input[i + 2] === '>' ? 3 : 2
    } else if (ch === '<' && input[i + 1] === '>') {
      opLen = 2
    } else if (ch === '>') {
      const next = input[i + 1] || ''
      if (next === '&') {
        // Descriptor duplication/close: 2>&1, 2>& 1, >&2, 2>&-, 2>&1>/dev/null
        const rest = input.slice(i + 2)
        const fdDupMatch = /^\s*(?:\d+|-)(?=\s|$|[;&|)<>}])/.exec(rest)
        if (fdDupMatch) {
          i += 1 + fdDupMatch[0].length
          continue
        }
        // Bash shorthand >&file redirects both stdout & stderr to file
        opLen = 2
      } else if (next === '>' || next === '|') {
        opLen = 2
      } else {
        opLen = 1
      }
    }

    if (opLen > 0) {
      const { token, nextIdx } = readTargetToken(i + opLen)
      if (token && token !== '/dev/null' && token !== '/dev/stdout' && token !== '/dev/stderr' && token !== '-') {
        targets.push(token)
      }
      i = nextIdx - 1
    }
  }
  return targets
}

function extractInputRedirectionTargets(segment) {
  const input = String(segment || '')
  const targets = []
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(input, i)
      continue
    }
    if (inSingle || inDouble) continue

    const arithEnd = scanArithmeticDoubleParen(input, i)
    if (arithEnd !== -1) {
      i = arithEnd
      continue
    }
    const bracketEnd = scanDoubleBracket(input, i)
    if (bracketEnd !== -1) {
      i = bracketEnd
      continue
    }

    // Match `<` and read-write `<>` (excluding `<<`, `<<<`, `<&`, `<(`)
    if (ch === '<' && input[i + 1] !== '<' && input[i + 1] !== '&' && input[i + 1] !== '(' && input[i - 1] !== '<') {
      const opLen = input[i + 1] === '>' ? 2 : 1
      let j = i + opLen
      while (j < input.length && /\s/.test(input[j])) j += 1
      let token = ''
      let tSingle = false
      let tDouble = false
      let tEscaped = false
      while (j < input.length) {
        const c = input[j]
        if (tEscaped) {
          token += c
          tEscaped = false
          j += 1
          continue
        }
        if (c === '\\' && !tSingle) {
          tEscaped = true
          j += 1
          continue
        }
        if (c === "'" && !tDouble) {
          tSingle = !tSingle
          j += 1
          continue
        }
        if (c === '"' && !tSingle) {
          tDouble = !tDouble
          j += 1
          continue
        }
        if (!tSingle && !tDouble && (c === '<' || c === '>') && input[j + 1] === '(') {
          const end = scanBalancedParen(input, j + 1)
          token += input.slice(j, end + 1)
          j = end + 1
          continue
        }
        if (!tSingle && !tDouble && /[\s;&|<>()]/.test(c)) break
        token += c
        j += 1
      }
      if (token) targets.push(token)
      i = j - 1
    }
  }
  return targets
}

function extractHereStringPayloads(segment) {
  const input = String(segment || '')
  const payloads = []
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      i = scanBalancedParen(input, i + 1)
      continue
    }
    if (!inSingle && ch === '`') {
      i = scanBacktick(input, i)
      continue
    }
    if (inSingle || inDouble) continue

    if (ch === '<' && input[i + 1] === '<' && input[i + 2] === '<') {
      let j = i + 3
      while (j < input.length && /\s/.test(input[j])) j += 1
      let token = ''
      let tSingle = false
      let tDouble = false
      let tEscaped = false
      while (j < input.length) {
        const c = input[j]
        if (tEscaped) {
          token += c
          tEscaped = false
          j += 1
          continue
        }
        if (c === '\\' && !tSingle) {
          tEscaped = true
          j += 1
          continue
        }
        if (c === "'" && !tDouble) {
          tSingle = !tSingle
          j += 1
          continue
        }
        if (c === '"' && !tSingle) {
          tDouble = !tDouble
          j += 1
          continue
        }
        if (!tSingle && !tDouble && /[\s;&|<>()]/.test(c)) break
        token += c
        j += 1
      }
      if (token) payloads.push(token)
      i = j - 1
    }
  }
  return payloads
}

/**
 * Remove shell redirection tokens before argument classification so they are
 * never mistaken for command arguments (`pnpm install > log` is a dependency
 * restore, not `pnpm install log`).
 */
function stripShellRedirection(segment) {
  const input = String(segment || '')
  let out = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  const skipToken = (startIdx) => {
    let i = startIdx
    while (i < input.length && /\s/.test(input[i])) i += 1
    let tSingle = false
    let tDouble = false
    let tEscaped = false
    while (i < input.length) {
      const ch = input[i]
      if (tEscaped) {
        tEscaped = false
        i += 1
        continue
      }
      if (ch === '\\' && !tSingle) {
        tEscaped = true
        i += 1
        continue
      }
      if (ch === "'" && !tDouble) {
        tSingle = !tSingle
        i += 1
        continue
      }
      if (ch === '"' && !tSingle) {
        tDouble = !tDouble
        i += 1
        continue
      }
      if (!tSingle && !tDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
        i = scanBalancedParen(input, i + 1) + 1
        continue
      }
      if (!tSingle && !tDouble && /[\s;&|<>()]/.test(ch)) break
      i += 1
    }
    return i
  }

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\' && !inSingle) {
      out += ch
      escaped = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      out += ch
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      out += ch
      continue
    }
    if (!inSingle && ch === '$' && input[i + 1] === '(') {
      const end = scanBalancedParen(input, i + 1)
      out += input.slice(i, end + 1)
      i = end
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && input[i + 1] === '(') {
      const end = scanBalancedParen(input, i + 1)
      out += input.slice(i, end + 1)
      i = end
      continue
    }
    if (!inSingle && ch === '`') {
      const end = scanBacktick(input, i)
      out += input.slice(i, end + 1)
      i = end
      continue
    }
    if (!inSingle && !inDouble) {
      const arithEnd = scanArithmeticDoubleParen(input, i)
      if (arithEnd !== -1) {
        out += input.slice(i, arithEnd + 1)
        i = arithEnd
        continue
      }
      const bracketEnd = scanDoubleBracket(input, i)
      if (bracketEnd !== -1) {
        out += input.slice(i, bracketEnd + 1)
        i = bracketEnd
        continue
      }
      // Optional leading fd digits before > or < when preceded by boundary
      const fdMatch = /^(\d+)(<<<|<<-|<<|<>|>>|>\||>&|>|<)/.exec(input.slice(i))
      if (fdMatch && (i === 0 || /[\s;&|()<>]/.test(input[i - 1]))) {
        const opStart = i + fdMatch[1].length
        const op = fdMatch[2]
        out += ' '
        i = skipToken(opStart + op.length) - 1
        continue
      }
      if (ch === '&' && input[i + 1] === '>') {
        const opLen = input[i + 2] === '>' ? 3 : 2
        out += ' '
        i = skipToken(i + opLen) - 1
        continue
      }
      if (ch === '>' || ch === '<') {
        const rest = input.slice(i)
        const opMatch = /^(?:<<<|<<-|<<|<>|>>|>\||>&|&>>|&>|>|<)/.exec(rest)
        if (opMatch) {
          out += ' '
          i = skipToken(i + opMatch[0].length) - 1
          continue
        }
      }
    }
    out += ch
  }
  return out.trim()
}

function isAccessibleDirectory(dir) {
  try {
    const stat = statSync(dir)
    if (!stat.isDirectory()) return false
    accessSync(dir, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isProtectedPrimaryDirectory(dir, cache) {
  if (cache && cache.has(dir)) return cache.get(dir)
  let protectedDir = false
  if (!isWorktreePath(dir)) {
    const root = gitRoot(dir)
    if (root && !isWorktreePath(root)) {
      protectedDir = true
    }
  }
  if (cache) cache.set(dir, protectedDir)
  return protectedDir
}

function unwrapDirBuiltinWords(words) {
  let idx = 0
  while (idx < words.length) {
    const w = words[idx]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      idx += 1
      continue
    }
    if (w === 'builtin') {
      idx += 1
      if (words[idx] === '--') idx += 1
      continue
    }
    if (w === 'command') {
      let k = idx + 1
      let lookupOnly = false
      while (k < words.length) {
        const f = words[k]
        if (f === '--') {
          k += 1
          break
        }
        if (!f.startsWith('-')) break
        if (/^-[a-zA-Z]*[vV][a-zA-Z]*$/.test(f)) lookupOnly = true
        k += 1
      }
      if (lookupOnly) return []
      idx = k
      continue
    }
    break
  }
  return words.slice(idx)
}

function hasNoChdirFlag(args) {
  for (const w of args) {
    if (w === '--') break
    if (!w.startsWith('-')) continue
    if (w === '-n') return true
  }
  return false
}

/**
 * Unified shell command walker that safely tracks `cwd` across statements,
 * pipelines, subshells `( ... ) redir`, brace groups `{ ...; } redir`,
 * control blocks (`if`/`for`/`while`/`case`/functions), conditional `cd`
 * short-circuits (`false && cd <wt> || ...`, `true || cd <wt> && ...`,
 * `cd <wt> || ...`, `cd <wt> &`), `pushd`/`popd`, heredocs, and
 * `$(...)` / backtick / `<(...)` substitutions.
 */
function walkShellCommands(command, initialCwd, visitor, depth = 0, protectedCache = new Map()) {
  if (!command || typeof command !== 'string' || depth > 4) return undefined
  let currentCwd = resolve(initialCwd || process.cwd())
  let prevCwd = currentCwd
  const cwdStack = []
  const braceStack = []
  const blockStack = []
  const dirStack = []
  let conditionalRollback = null
  let lastCdRollback = null
  let justRanCd = false
  let pendingFunctionBody = false

  const applyCwdTransition = (nextCwd, nextPrevCwd, { prevOp, insideLeadingGroup }) => {
    const fromProtected = isProtectedPrimaryDirectory(currentCwd, protectedCache)
    const toProtected = isProtectedPrimaryDirectory(nextCwd, protectedCache)
    const effectivePrevOp = insideLeadingGroup ? '' : prevOp
    const isConditional = effectivePrevOp === '&&' || effectivePrevOp === '||' || blockStack.length > 0

    if (fromProtected && !toProtected) {
      // Never relax out of protected primary checkout on an `||` fallback directly
      // (Bash left-associativity: `true || cd wt && echo pwn > README.md` skips `cd`
      // and executes `echo pwn > README.md` in primary!).
      if (effectivePrevOp === '||') return
      // Only relax out of protected primary checkout if target is a real traversable directory.
      if (!isAccessibleDirectory(nextCwd)) return
      const prevState = { currentCwd, prevCwd }
      currentCwd = nextCwd
      prevCwd = nextPrevCwd
      if (isConditional) {
        conditionalRollback = conditionalRollback || prevState
      } else {
        lastCdRollback = prevState
        justRanCd = true
      }
    } else if (!fromProtected && toProtected) {
      // Tightening into protected primary checkout: always fail-closed (never rollback).
      currentCwd = nextCwd
      prevCwd = nextPrevCwd
      conditionalRollback = null
      lastCdRollback = null
    } else {
      const prevState = { currentCwd, prevCwd }
      currentCwd = nextCwd
      prevCwd = nextPrevCwd
      if (isConditional) {
        conditionalRollback = conditionalRollback || prevState
      } else {
        lastCdRollback = prevState
        justRanCd = true
      }
    }
  }

  for (const stmt of splitShellStatements(command)) {
    if (stmt.prevOp === ';;' && blockStack.length > 0 && blockStack[blockStack.length - 1].kind === 'case') {
      const caseFrame = blockStack[blockStack.length - 1]
      caseFrame.expectPattern = true
      if (isProtectedPrimaryDirectory(caseFrame.savedCwd, protectedCache) && !isProtectedPrimaryDirectory(currentCwd, protectedCache)) {
        currentCwd = caseFrame.savedCwd
        prevCwd = caseFrame.savedPrevCwd
      }
      conditionalRollback = null
    }

    let restoreAfterExitFallback = null
    if (conditionalRollback && stmt.prevOp !== '&&') {
      currentCwd = conditionalRollback.currentCwd
      prevCwd = conditionalRollback.prevCwd
      conditionalRollback = null
    } else if (justRanCd && lastCdRollback && stmt.prevOp === '||') {
      // Save the post-cd cwd so `cd <wt> || exit 1; <cmd>` legitimately restores `<wt>`
      // after a terminating `exit`/`return` fallback, while `cd <wt> || <cmd>` runs in primary.
      restoreAfterExitFallback = { currentCwd, prevCwd }
      currentCwd = lastCdRollback.currentCwd
      prevCwd = lastCdRollback.prevCwd
      lastCdRollback = null
    }
    justRanCd = false

    const stmtTopCaseFrame =
      blockStack.length > 0 && blockStack[blockStack.length - 1].kind === 'case'
        ? blockStack[blockStack.length - 1]
        : null
    const subSegments = splitRawPipelineSegments(stmt.raw, {
      startsWithCasePattern: Boolean(stmtTopCaseFrame && stmtTopCaseFrame.expectPattern),
    })
    if (visitor.onStatementStart) {
      visitor.onStatementStart({ stmt, subSegments, currentCwd })
    }

    let isTerminatingFallback = false

    for (let subIdx = 0; subIdx < subSegments.length; subIdx += 1) {
      const rawSub = subSegments[subIdx]
      const topCaseFrame =
        blockStack.length > 0 && blockStack[blockStack.length - 1].kind === 'case'
          ? blockStack[blockStack.length - 1]
          : null
      const parsed = parseSubshellStage(rawSub, cwdStack.length, braceStack.length, {
        expectCasePattern: Boolean(topCaseFrame && topCaseFrame.expectPattern),
      })
      if (parsed.consumedCasePattern && topCaseFrame) {
        topCaseFrame.expectPattern = false
      }

      if (parsed.closesControlBlock && blockStack.length > 0) {
        const frame = blockStack.pop()
        if (isProtectedPrimaryDirectory(frame.savedCwd, protectedCache) && !isProtectedPrimaryDirectory(currentCwd, protectedCache)) {
          currentCwd = frame.savedCwd
          prevCwd = frame.savedPrevCwd
        }
        conditionalRollback = null
      }
      if (parsed.resetsControlBranch && blockStack.length > 0) {
        const frame = blockStack[blockStack.length - 1]
        if (isProtectedPrimaryDirectory(frame.savedCwd, protectedCache) && !isProtectedPrimaryDirectory(currentCwd, protectedCache)) {
          currentCwd = frame.savedCwd
          prevCwd = frame.savedPrevCwd
        }
        conditionalRollback = null
      }
      if (parsed.opensControlBlock) {
        blockStack.push({
          kind: parsed.opensControlBlock,
          savedCwd: currentCwd,
          savedPrevCwd: prevCwd,
          expectPattern: parsed.opensControlBlock === 'case' && !parsed.consumedCasePattern,
        })
        pendingFunctionBody = false
      }
      if (parsed.opensPendingFunction) {
        pendingFunctionBody = true
      }

      for (let p = 0; p < parsed.leadingOpenParens; p += 1) {
        cwdStack.push({ currentCwd, prevCwd, conditionalRollback, lastCdRollback })
        conditionalRollback = null
        lastCdRollback = null
        pendingFunctionBody = false
      }
      for (let b = 0; b < parsed.leadingOpenBraces; b += 1) {
        const fromPendingFunc = b === 0 && pendingFunctionBody
        if (fromPendingFunc) pendingFunctionBody = false
        const conditionalGroup =
          b === 0 &&
          subIdx === 0 &&
          (stmt.prevOp === '&&' || stmt.prevOp === '||' || blockStack.length > 0)
        const isPipedOrBg = subSegments.length > 1 || stmt.nextOp === '&'
        braceStack.push({
          entryCwd: currentCwd,
          entryPrevCwd: prevCwd,
          restoreOnClose:
            (parsed.opensFunctionBlock && b === 0) ||
            (parsed.opensLoopBrace && b === 0) ||
            fromPendingFunc ||
            conditionalGroup ||
            isPipedOrBg,
        })
      }

      // Inspect $(...) / `...` / <(...) inside any stripped control/case/for headers
      if (depth < 4 && parsed.strippedHeaders.length > 0) {
        for (const header of parsed.strippedHeaders) {
          for (const subCmd of extractCommandSubstitutions(header)) {
            const subRes = walkShellCommands(subCmd, currentCwd, visitor, depth + 1, protectedCache)
            if (subRes !== undefined) return subRes
          }
        }
      }

      const stageBody = parsed.innerBody
      if (stageBody) {
        if (!parsed.opensPendingFunction) pendingFunctionBody = false
        // Inspect $(...) / `...` / <(...) / >(...) in an isolated subshell copy of currentCwd
        if (depth < 4) {
          for (const subCmd of extractCommandSubstitutions(stageBody)) {
            const subRes = walkShellCommands(subCmd, currentCwd, visitor, depth + 1, protectedCache)
            if (subRes !== undefined) return subRes
          }
        }

        const stageHeredocs =
          stmt.heredocs.length === 0
            ? []
            : subSegments.length === 1 || hasHeredocOperator(rawSub)
              ? stmt.heredocs
              : []
        const stageHereStrings = extractHereStringPayloads(rawSub)
        const stageStdinPayloads =
          stageHereStrings.length === 0
            ? stageHeredocs
            : stageHeredocs.length === 0
              ? stageHereStrings
              : [...stageHeredocs, ...stageHereStrings]

        if (!parsed.isControlHeaderOnly) {
          const stageWords = tokenizeCommandLine(stripShellRedirection(stageBody))
          const builtinWords = unwrapDirBuiltinWords(stageWords)
          const headVerb = builtinWords.length > 0 ? commandBasename(builtinWords[0]) : ''
          const isStandaloneDirOp =
            subSegments.length === 1 &&
            (headVerb === 'cd' || headVerb === 'pushd' || headVerb === 'popd')

          if (isStandaloneDirOp) {
            // Even on `cd`/`pushd`/`popd`, still inspect any redirections (`cd /tmp > README.md`)
            if (visitor.onCdStage) {
              const cdVisitRes = visitor.onCdStage({ rawStage: stageBody, currentCwd, stmt, depth })
              if (cdVisitRes !== undefined) return cdVisitRes
            }
            // Background `cd <dir> &` runs in a subshell and never changes parent cwd.
            if (stmt.nextOp !== '&') {
              const insideLeadingGroup = parsed.leadingOpenParens > 0 || parsed.leadingOpenBraces > 0
              if (headVerb === 'cd') {
                const updated = applyCdCommand(builtinWords, currentCwd, prevCwd)
                applyCwdTransition(updated.nextCwd, updated.nextPrevCwd, { prevOp: stmt.prevOp, insideLeadingGroup })
              } else if (headVerb === 'pushd') {
                const pushdArgs = builtinWords.slice(1)
                const noChdir = hasNoChdirFlag(pushdArgs)
                const targetArg = collectNonOptionArgs(pushdArgs).find((a) => !/^[+-]\d+$/.test(a))
                if (targetArg) {
                  const targetPath = toFullPath(targetArg, currentCwd)
                  if (noChdir) {
                    // `pushd -n <dir>` inserts `<dir>` at stack slot [1] while keeping cwd unchanged;
                    // a subsequent `popd` or 0-arg `pushd` will move into `<dir>`.
                    dirStack.push(targetPath)
                  } else {
                    dirStack.push(currentCwd)
                    applyCwdTransition(targetPath, currentCwd, { prevOp: stmt.prevOp, insideLeadingGroup })
                  }
                } else if (!noChdir && dirStack.length > 0) {
                  // 0-arg `pushd` swaps current cwd with top of dirStack
                  const top = dirStack.pop()
                  dirStack.push(currentCwd)
                  applyCwdTransition(top, currentCwd, { prevOp: stmt.prevOp, insideLeadingGroup })
                }
              } else if (headVerb === 'popd' && dirStack.length > 0) {
                const popped = dirStack.pop()
                if (!hasNoChdirFlag(builtinWords.slice(1))) {
                  applyCwdTransition(popped, currentCwd, { prevOp: stmt.prevOp, insideLeadingGroup })
                }
              }
            }
          } else {
            if (
              restoreAfterExitFallback &&
              subSegments.length === 1 &&
              parsed.leadingOpenParens === 0 &&
              parsed.closers.length === 0 &&
              (headVerb === 'exit' || headVerb === 'return')
            ) {
              isTerminatingFallback = true
            }
            const stageRes = visitor.onStage({
              rawStage: stageBody,
              currentCwd,
              prevCwd,
              subSegments,
              subIdx,
              isPipeline: subSegments.length > 1,
              heredocs: stageStdinPayloads,
              stmt,
              depth,
            })
            if (stageRes !== undefined) return stageRes
          }
        }
      }

      for (const closer of parsed.closers) {
        let tailCwd = currentCwd
        if (closer.kind === ')') {
          const restored = cwdStack.pop()
          if (restored) {
            currentCwd = restored.currentCwd
            prevCwd = restored.prevCwd
            conditionalRollback = restored.conditionalRollback
            lastCdRollback = restored.lastCdRollback
            justRanCd = false
            tailCwd = currentCwd
          }
        } else if (closer.kind === '}') {
          const frame = braceStack.pop()
          if (frame) {
            tailCwd = frame.entryCwd
            const mustRestore = frame.restoreOnClose || subSegments.length > 1 || stmt.nextOp === '&'
            if (
              mustRestore &&
              isProtectedPrimaryDirectory(frame.entryCwd, protectedCache) &&
              !isProtectedPrimaryDirectory(currentCwd, protectedCache)
            ) {
              currentCwd = frame.entryCwd
              prevCwd = frame.entryPrevCwd
              conditionalRollback = null
            }
          }
        }
        if (closer.tail) {
          if (depth < 4) {
            for (const subCmd of extractCommandSubstitutions(closer.tail)) {
              const subRes = walkShellCommands(subCmd, tailCwd, visitor, depth + 1, protectedCache)
              if (subRes !== undefined) return subRes
            }
          }
          if (visitor.onCloserTail) {
            const tailRes = visitor.onCloserTail({
              tail: closer.tail,
              cwd: tailCwd,
              subSegments,
              subIdx,
              stmt,
              depth,
            })
            if (tailRes !== undefined) return tailRes
          }
        }
      }
    }

    if (stmt.nextOp === ';;' && blockStack.length > 0 && blockStack[blockStack.length - 1].kind === 'case') {
      const caseFrame = blockStack[blockStack.length - 1]
      caseFrame.expectPattern = true
      if (isProtectedPrimaryDirectory(caseFrame.savedCwd, protectedCache) && !isProtectedPrimaryDirectory(currentCwd, protectedCache)) {
        currentCwd = caseFrame.savedCwd
        prevCwd = caseFrame.savedPrevCwd
      }
      conditionalRollback = null
    }

    if (restoreAfterExitFallback && isTerminatingFallback && stmt.nextOp !== '&&' && stmt.nextOp !== '||') {
      currentCwd = restoreAfterExitFallback.currentCwd
      prevCwd = restoreAfterExitFallback.prevCwd
    }
  }
  return undefined
}

/** Flags whose next token is a value, not a positional/package argument. Note: `-w` is boolean (`--workspace-root`) in pnpm and value-taking only in npm/npx. */
const VALUE_TAKING_FLAGS = new Set([
  '--filter', '-F', '--prefix', '-C', '--dir', '--cwd', '--workspace',
  '--registry', '--reporter', '--loglevel', '--depth', '--network-concurrency',
  '--store-dir', '--virtual-store-dir', '--modules-dir', '--config-dir',
  '--workspace-concurrency', '--use-node-version', '--fetch-retries',
  '--fetch-timeout', '--fetch-retry-mintimeout', '--fetch-retry-maxtimeout',
  '--child-concurrency',
])
const PM_DIR_FLAGS = new Set(['--dir', '-C', '--prefix', '--cwd'])

function isPmValueFlag(manager, flag) {
  if (flag === '-w') return manager === 'npm' || manager === 'npx'
  return PM_VALUE_FLAGS.has(flag)
}

function isWrapperValueFlag(manager, flag) {
  if (flag === '-w') return manager === 'npm' || manager === 'npx'
  return WRAPPER_FLAGS_WITH_VALUE.has(flag)
}

function applyCdCommand(words, currentCwd, prevCwd) {
  let i = 1
  while (i < words.length) {
    const w = words[i]
    if (w === '--') {
      i += 1
      break
    }
    if (w === '-L' || w === '-P' || w === '-e' || w === '-@') {
      i += 1
      continue
    }
    break
  }
  const rawArg = words[i]
  if (!rawArg) {
    const home = homedirValue()
    return { nextCwd: home || currentCwd, nextPrevCwd: currentCwd }
  }
  if (rawArg === '-') {
    return { nextCwd: prevCwd || currentCwd, nextPrevCwd: currentCwd }
  }
  return { nextCwd: toFullPath(rawArg, currentCwd), nextPrevCwd: currentCwd }
}

/**
 * install 是否冻结了 lockfile。
 *
 * 按具体包管理器语义判定，拒绝 manager-blind 绕过（如 `npm install --immutable` /
 * `npm install --frozen-lockfile` 会忽略无效 flag 并改写 package-lock.json）以及
 * 后置否定 flag 绕过（如 `--frozen-lockfile --no-frozen-lockfile` / `=false`）。
 * `npm ci` 天然冻结，由调用方单独放行。
 *
 * @param {string[]} words 已解包、已去引号的完整命令词
 * @param {string} [manager] 显式指定包管理器名称；缺省时由 words[0] 推断
 * @returns {boolean}
 */
export function isFrozenInstall(words, manager = '') {
  const list = Array.isArray(words) ? words : []
  const inferred = list.length > 0 && !String(list[0] || '').startsWith('-')
    ? commandBasename(list[0])
    : ''
  const pm = String(manager || inferred || '').toLowerCase()
  if (pm === 'npm') return false

  const allowFrozenLockfile = pm === '' || pm === 'pnpm' || pm === 'yarn' || pm === 'bun'
  const allowImmutable = pm === '' || pm === 'yarn'

  let frozen = false
  for (const raw of list) {
    const value = String(raw || '').toLowerCase()
    if (value === '--') break
    if (value === '--no-frozen-lockfile' || value === '--no-immutable') {
      return false
    }
    if (value === '--frozen-lockfile') {
      if (allowFrozenLockfile) frozen = true
      continue
    }
    if (value.startsWith('--frozen-lockfile=')) {
      const flagValue = value.slice('--frozen-lockfile='.length)
      if (flagValue === 'true' || flagValue === '1') {
        if (allowFrozenLockfile) frozen = true
      } else {
        return false
      }
      continue
    }
    if (value === '--immutable') {
      if (allowImmutable) frozen = true
      continue
    }
    if (value.startsWith('--immutable=')) {
      const flagValue = value.slice('--immutable='.length)
      if (flagValue === 'true' || flagValue === '1') {
        if (allowImmutable) frozen = true
      } else {
        return false
      }
      continue
    }
  }
  return frozen
}

function positionalArgs(words, manager = '') {
  const positional = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word === '--') break
    if (word.startsWith('-')) {
      if (VALUE_TAKING_FLAGS.has(word) || (word === '-w' && (manager === 'npm' || manager === 'npx'))) i += 1
      continue
    }
    positional.push(word)
  }
  return positional
}

/** Wrapper flags that consume the next token before the wrapped command starts. */
const WRAPPER_FLAGS_WITH_VALUE = new Set([
  '--package', '-p', '--with', '--node-options', '--registry', '--cache',
  '--workspace', '--prefix', '--userconfig',
])
const ENV_FLAGS_WITH_VALUE = new Set(['-u', '--unset', '-C', '--chdir'])
const SHELL_VALUE_FLAGS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file'])
const NODE_VALUE_FLAGS = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader',
  '-C', '--conditions', '--env-file', '--env-file-if-exists', '--input-type',
  '--redirect-warnings', '--diagnostic-dir', '--watch-path',
  '--test-name-pattern', '--test-reporter', '--test-reporter-destination',
  '--openssl-config', '--icu-data-dir', '--heapsnapshot-signal',
  '--cpu-prof-dir', '--cpu-prof-name', '--heap-prof-dir', '--heap-prof-name',
  '--title', '-e', '--eval', '-p', '--print',
])

function parsePnpmShellModeFlag(word) {
  if (word === '-c' || word === '--shell-mode' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word)) {
    return true
  }
  if (word === '--no-shell-mode') return false
  if (word.startsWith('--shell-mode=')) {
    const val = word.slice('--shell-mode='.length).trim().toLowerCase()
    if (val === 'false' || val === '0' || val === 'no' || val === 'off' || val === '') return false
    return true
  }
  return null
}

function skipLeadingWrapperFlags(words, { allowCallFlag = false, allowShellMode = false, initialShellMode = false, manager = '' } = {}) {
  let i = 0
  let shellMode = Boolean(initialShellMode)
  while (i < words.length) {
    const word = words[i]
    if (word === '--') {
      i += 1
      break
    }
    if (!word.startsWith('-')) break
    if (allowCallFlag) {
      if ((word === '-c' || word === '--call') && i + 1 < words.length) {
        return ['sh', '-c', words[i + 1]]
      }
      if (word.startsWith('--call=')) {
        return ['sh', '-c', word.slice('--call='.length)]
      }
      if (/^-[a-zA-Z]*c$/.test(word) && i + 1 < words.length) {
        return ['sh', '-c', words[i + 1]]
      }
    }
    if (allowShellMode) {
      const sm = parsePnpmShellModeFlag(word)
      if (sm !== null) {
        shellMode = sm
        i += 1
        continue
      }
    }
    i += isWrapperValueFlag(manager, word) ? 2 : 1
  }
  const rest = words.slice(i)
  if (shellMode && rest.length > 0) {
    return ['sh', '-c', rest.join(' ')]
  }
  return rest
}

function skipEnvWrapperWithMeta(words) {
  const queue = [...words]
  const envVars = new Set()
  const envMap = new Map()
  let targetDir = ''
  let idx = 0
  while (idx < queue.length) {
    const word = queue[idx]
    if (word === '--') {
      idx += 1
      break
    }
    const envMatch = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(word)
    if (envMatch) {
      envVars.add(envMatch[1])
      envMap.set(envMatch[1], envMatch[2])
      idx += 1
      continue
    }
    if ((word === '-u' || word === '--unset') && idx + 1 < queue.length) {
      envMap.delete(queue[idx + 1])
      idx += 2
      continue
    }
    if (word.startsWith('--unset=')) {
      envMap.delete(word.slice('--unset='.length))
      idx += 1
      continue
    }
    if (word === '-S' || word === '--split-string') {
      const payload = queue[idx + 1] || ''
      const splitTokens = tokenizeCommandLine(payload)
      queue.splice(idx, 2, ...splitTokens)
      continue
    }
    if (word.startsWith('--split-string=')) {
      const payload = word.slice('--split-string='.length)
      const splitTokens = tokenizeCommandLine(payload)
      queue.splice(idx, 1, ...splitTokens)
      continue
    }
    if (word.length > 2 && word.startsWith('-S')) {
      const payload = word.slice(2)
      const splitTokens = tokenizeCommandLine(payload)
      queue.splice(idx, 1, ...splitTokens)
      continue
    }
    if ((word === '-C' || word === '--chdir') && idx + 1 < queue.length) {
      targetDir = queue[idx + 1]
      idx += 2
      continue
    }
    if (word.startsWith('--chdir=')) {
      targetDir = word.slice('--chdir='.length)
      idx += 1
      continue
    }
    if (word.startsWith('-')) {
      idx += ENV_FLAGS_WITH_VALUE.has(word) ? 2 : 1
      continue
    }
    break
  }
  return { words: queue.slice(idx), envVars, envMap, targetDir }
}

function parseShellInvocation(words) {
  if (!words || words.length === 0) return null
  const verb = commandBasename(words[0])
  if (verb === 'source' || verb === '.') {
    let i = 1
    if (words[i] === '--') i += 1
    const arg = words[i] || ''
    const isProcSub = arg.startsWith('<(') && arg.endsWith(')')
    return {
      verb,
      syntaxCheckOnly: false,
      hasC: false,
      readStdin: false,
      inlineScript: '',
      scriptFile: isProcSub ? '' : arg,
      procSubCmd: isProcSub ? arg.slice(2, -1).trim() : '',
    }
  }
  if (!['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(verb)) return null

  const applyShellOption = (sign, rawOptName) => {
    const optVal = String(rawOptName || '').toLowerCase().replace(/_/g, '')
    if (optVal === 'noexec') return sign === '-'
    if (optVal === 'exec') return sign === '+'
    return null
  }

  let i = 1
  let syntaxCheckOnly = false
  let hasC = false
  let readStdin = false
  while (i < words.length) {
    const flag = words[i]
    if (flag === '--' || flag === '-') {
      i += 1
      break
    }
    if (!flag.startsWith('-') && !flag.startsWith('+')) break
    if (SHELL_VALUE_FLAGS.has(flag)) {
      if (flag === '-o' || flag === '+o') {
        const nextSyntax = applyShellOption(flag[0], words[i + 1])
        if (nextSyntax !== null) syntaxCheckOnly = nextSyntax
      }
      i += 2
      continue
    }
    if (flag.startsWith('--')) {
      const normLong = flag.slice(2).toLowerCase().replace(/_/g, '')
      if (normLong === 'noexec') syntaxCheckOnly = true
      if (normLong === 'exec') syntaxCheckOnly = false
      i += 1
      continue
    }
    const sign = flag[0]
    const letters = flag.slice(1)
    if (letters) {
      const oIdx = letters.indexOf('o')
      const OIdx = letters.indexOf('O')
      const optIdx = oIdx !== -1 && (OIdx === -1 || oIdx < OIdx) ? oIdx : OIdx
      const preLetters = optIdx !== -1 ? letters.slice(0, optIdx) : letters
      if (/^[a-zA-Z]*$/.test(preLetters)) {
        if (preLetters.includes('n')) syntaxCheckOnly = sign === '-'
        if (sign === '-' && preLetters.includes('c')) hasC = true
        if (sign === '-' && preLetters.includes('s')) readStdin = true
        if (optIdx !== -1) {
          const isLowerO = letters[optIdx] === 'o'
          const attachedOpt = letters.slice(optIdx + 1)
          if (attachedOpt) {
            if (isLowerO) {
              const nextSyntax = applyShellOption(sign, attachedOpt)
              if (nextSyntax !== null) syntaxCheckOnly = nextSyntax
            }
            i += 1
            continue
          }
          if (isLowerO) {
            const nextSyntax = applyShellOption(sign, words[i + 1])
            if (nextSyntax !== null) syntaxCheckOnly = nextSyntax
          }
          i += 2
          continue
        }
      }
    }
    i += 1
  }
  const arg = words[i] || ''
  const isProcSub = !hasC && !readStdin && arg.startsWith('<(') && arg.endsWith(')')
  // When `-s` is passed (without `-c`), shell reads commands from stdin and treats
  // trailing operands as positional parameters ($1..), NOT a script file.
  return {
    verb,
    syntaxCheckOnly,
    hasC,
    readStdin,
    inlineScript: hasC ? arg : '',
    scriptFile: hasC || readStdin || isProcSub ? '' : arg,
    procSubCmd: isProcSub ? arg.slice(2, -1).trim() : '',
  }
}

/**
 * Unwrap `KEY=VAL`, `env` (including `-S`/`-C`), `exec`, `builtin`, `nohup`,
 * `corepack`, `command`, `npx` (incl. `-c`/`--call`), `pnpm [--dir ...] [recursive|multi|m] exec|dlx`,
 * `npm [--prefix ...] exec` (incl. `-c`/`--call`),
 * `yarn [--cwd ...] [workspace <pkg> | workspaces foreach ...] exec|dlx`,
 * `bunx`/`bun x` while preserving extracted env keys and target directory overrides.
 * Bounded to 8 layers.
 */
function unwrapExecutionWrapperWithMeta(words) {
  let current = Array.isArray(words) ? words : []
  const envVars = new Set()
  const envMap = new Map()
  let targetDir = ''

  for (let depth = 0; depth < 8; depth += 1) {
    let envIdx = 0
    while (envIdx < current.length) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(current[envIdx])
      if (!m) break
      envVars.add(m[1])
      envMap.set(m[1], m[2])
      envIdx += 1
    }
    if (envIdx > 0) current = current.slice(envIdx)
    if (current.length === 0) break

    const head = commandBasename(current[0])
    let rest = null
    if (head === 'env') {
      const envMeta = skipEnvWrapperWithMeta(current.slice(1))
      for (const k of envMeta.envVars) envVars.add(k)
      for (const [k, v] of envMeta.envMap.entries()) envMap.set(k, v)
      if (envMeta.targetDir) targetDir = envMeta.targetDir
      rest = envMeta.words
    } else if (head === 'exec') {
      let i = 1
      while (i < current.length) {
        const w = current[i]
        if (w === '--') {
          i += 1
          break
        }
        if (!w.startsWith('-')) break
        if (w === '-a') {
          i += 2
          continue
        }
        i += 1
      }
      rest = current.slice(i)
    } else if (head === 'builtin' || head === 'nohup') {
      let i = 1
      if (current[i] === '--') i += 1
      rest = current.slice(i)
    } else if (head === 'corepack') {
      rest = skipLeadingWrapperFlags(current.slice(1))
    } else if (head === 'command') {
      let i = 1
      let lookupOnly = false
      while (i < current.length) {
        const w = current[i]
        if (w === '--') {
          i += 1
          break
        }
        if (!w.startsWith('-')) break
        if (/^-[a-zA-Z]*[vV][a-zA-Z]*$/.test(w)) lookupOnly = true
        i += 1
      }
      if (lookupOnly) break
      rest = current.slice(i)
    } else if (head === 'npx') {
      rest = skipLeadingWrapperFlags(current.slice(1), { allowCallFlag: true, manager: 'npx' })
    } else if (head === 'bunx') {
      rest = skipLeadingWrapperFlags(current.slice(1), { manager: 'bunx' })
    } else if (['pnpm', 'npm', 'yarn', 'bun'].includes(head)) {
      let i = 1
      let pmDir = ''
      let pnpmShellMode = false
      while (i < current.length) {
        const w = current[i]
        if (w === '--') break
        if (!w.startsWith('-')) break
        if (head === 'pnpm') {
          const sm = parsePnpmShellModeFlag(w)
          if (sm !== null) {
            pnpmShellMode = sm
            i += 1
            continue
          }
        }
        const eq = w.indexOf('=')
        if (eq !== -1) {
          const flag = w.slice(0, eq)
          if (PM_DIR_FLAGS.has(flag)) pmDir = w.slice(eq + 1)
          i += 1
          continue
        }
        if (PM_DIR_FLAGS.has(w) && i + 1 < current.length) {
          pmDir = current[i + 1]
          i += 2
          continue
        }
        i += isPmValueFlag(head, w) ? 2 : 1
      }
      let sub = (current[i] || '').toLowerCase()
      let afterSubIdx = i + 1
      if (head === 'pnpm' && ['recursive', 'multi', 'm'].includes(sub)) {
        let k = i + 1
        while (k < current.length) {
          const w = current[k]
          if (w === '--') break
          if (!w.startsWith('-')) break
          const sm = parsePnpmShellModeFlag(w)
          if (sm !== null) {
            pnpmShellMode = sm
            k += 1
            continue
          }
          const eq = w.indexOf('=')
          if (eq !== -1) {
            if (PM_DIR_FLAGS.has(w.slice(0, eq))) pmDir = w.slice(eq + 1)
            k += 1
            continue
          }
          if (PM_DIR_FLAGS.has(w) && k + 1 < current.length) {
            pmDir = current[k + 1]
            k += 2
            continue
          }
          k += isPmValueFlag(head, w) ? 2 : 1
        }
        sub = (current[k] || '').toLowerCase()
        afterSubIdx = k + 1
      }

      if (head === 'yarn' && sub === 'workspace' && i + 2 < current.length) {
        const wsSub = (current[i + 2] || '').toLowerCase()
        if (wsSub === 'exec' || wsSub === 'dlx') {
          if (pmDir) targetDir = pmDir
          rest = skipLeadingWrapperFlags(current.slice(i + 3), { manager: 'yarn' })
        }
      } else if (head === 'yarn' && sub === 'workspaces' && (current[i + 1] || '').toLowerCase() === 'foreach') {
        let k = i + 2
        while (k < current.length && current[k].startsWith('-')) {
          const w = current[k]
          if (w === '--since' && k + 1 < current.length) {
            const nextTok = current[k + 1].toLowerCase()
            if (
              nextTok.startsWith('-') ||
              ['run', 'exec', 'dlx', 'install'].includes(nextTok) ||
              BUILD_SCRIPT_RE.test(nextTok)
            ) {
              k += 1
              continue
            }
            k += 2
            continue
          }
          k += isPmValueFlag(head, w) ? 2 : 1
        }
        const feSub = (current[k] || '').toLowerCase()
        if (feSub === 'exec' || feSub === 'dlx') {
          if (pmDir) targetDir = pmDir
          rest = skipLeadingWrapperFlags(current.slice(k + 1), { manager: 'yarn' })
        }
      } else if (head === 'pnpm' && ['exec', 'dlx'].includes(sub)) {
        if (pmDir) targetDir = pmDir
        rest = skipLeadingWrapperFlags(current.slice(afterSubIdx), {
          allowShellMode: sub === 'exec',
          initialShellMode: sub === 'exec' && pnpmShellMode,
          manager: 'pnpm',
        })
      } else if (head === 'npm' && (sub === 'exec' || sub === 'x')) {
        if (pmDir) targetDir = pmDir
        rest = skipLeadingWrapperFlags(current.slice(afterSubIdx), { allowCallFlag: true, manager: 'npm' })
      } else if (
        (head === 'yarn' && ['exec', 'dlx'].includes(sub)) ||
        (head === 'bun' && ['x', 'exec', 'dlx'].includes(sub))
      ) {
        if (pmDir) targetDir = pmDir
        rest = skipLeadingWrapperFlags(current.slice(afterSubIdx), { manager: head })
      }
    }
    if (!rest || rest.length === 0) break
    current = rest
  }
  return { words: current, envVars, envMap, targetDir }
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

const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env',
])

function collectGitExportEnv(words, armedGitEnv) {
  if (!words || words.length === 0) return
  if (words[0] === 'export' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const start = words[0] === 'export' ? 1 : 0
    for (let i = start; i < words.length; i += 1) {
      const m = /^(GIT_DIR|GIT_WORK_TREE)=(.*)$/.exec(words[i])
      if (m) armedGitEnv.set(m[1], m[2])
    }
  } else if (words[0] === 'unset') {
    for (let i = 1; i < words.length; i += 1) {
      if (words[i] === 'GIT_DIR' || words[i] === 'GIT_WORK_TREE') {
        armedGitEnv.delete(words[i])
      }
    }
  }
}

function parseGitInvocation(effectiveWords, baseCwd, envMap = new Map()) {
  if (!effectiveWords || effectiveWords.length === 0) return null
  if (commandBasename(effectiveWords[0]) !== 'git') return null
  let cDir = baseCwd
  let explicitWorkTree = envMap && envMap.has('GIT_WORK_TREE') ? envMap.get('GIT_WORK_TREE') : ''
  let explicitGitDir = envMap && envMap.has('GIT_DIR') ? envMap.get('GIT_DIR') : ''
  let workTreeFromCli = false
  let gitDirFromCli = false

  let i = 1
  while (i < effectiveWords.length) {
    const w = effectiveWords[i]
    if (w === '--') {
      i += 1
      break
    }
    if (!w.startsWith('-')) break
    if (w === '-C' && i + 1 < effectiveWords.length) {
      cDir = toFullPath(effectiveWords[i + 1], cDir)
      i += 2
      continue
    }
    if (w.startsWith('-C') && w.length > 2) {
      cDir = toFullPath(w.slice(2), cDir)
      i += 1
      continue
    }
    if (w === '--work-tree' && i + 1 < effectiveWords.length) {
      explicitWorkTree = effectiveWords[i + 1]
      workTreeFromCli = true
      i += 2
      continue
    }
    if (w.startsWith('--work-tree=')) {
      explicitWorkTree = w.slice('--work-tree='.length)
      workTreeFromCli = true
      i += 1
      continue
    }
    if (w === '--git-dir' && i + 1 < effectiveWords.length) {
      explicitGitDir = effectiveWords[i + 1]
      gitDirFromCli = true
      i += 2
      continue
    }
    if (w.startsWith('--git-dir=')) {
      explicitGitDir = w.slice('--git-dir='.length)
      gitDirFromCli = true
      i += 1
      continue
    }
    if (GIT_GLOBAL_VALUE_FLAGS.has(w) && i + 1 < effectiveWords.length) {
      i += 2
      continue
    }
    i += 1
  }
  const sub = (effectiveWords[i] || '').toLowerCase()
  if (!sub) return null

  const targetDirSet = new Set()
  let resolvedGitDir = ''
  if (explicitWorkTree) {
    const wtBase = workTreeFromCli ? cDir : baseCwd
    targetDirSet.add(toFullPath(explicitWorkTree, wtBase))
    if (wtBase !== baseCwd && !explicitWorkTree.startsWith('/')) {
      targetDirSet.add(toFullPath(explicitWorkTree, baseCwd))
    }
  }
  if (explicitGitDir) {
    const gdBase = gitDirFromCli ? cDir : baseCwd
    resolvedGitDir = toFullPath(explicitGitDir, gdBase)
    targetDirSet.add(resolvedGitDir)
    if (basename(resolvedGitDir) === '.git') {
      targetDirSet.add(dirname(resolvedGitDir))
    }
  }
  // Unless BOTH git-dir AND work-tree are explicitly redirected away from cDir,
  // Git still discovers `.git` or operates on the working tree at cDir.
  if (!explicitGitDir || !explicitWorkTree) {
    targetDirSet.add(cDir)
  }

  const targetDirs = [...targetDirSet]
  return {
    sub,
    args: effectiveWords.slice(i + 1),
    targetDir: targetDirs[0],
    targetDirs,
    explicitGitDir: resolvedGitDir,
  }
}

/** 会改工作树/历史的 git 子命令：主 checkout 上需拦截。 */
function classifyGitMutationWords(gitInfo, segment) {
  if (!gitInfo) return null
  const { sub, args } = gitInfo
  if (GIT_SAFE_SUBCOMMANDS.has(sub)) return null

  // push --force / -f
  if (sub === 'push' && args.some((w) => w === '--force' || w === '-f' || w.startsWith('--force='))) {
    return { kind: 'force-push', segment }
  }
  if (['apply', 'am', 'cherry-pick', 'rebase', 'revert'].includes(sub)) {
    return { kind: sub, segment }
  }
  if (sub === 'reset' && args.some((w) => w === '--hard')) {
    const refs = collectNonOptionArgs(args)
    if (refs.length > 0 && !refs.every((r) => r === 'origin/main' || r === 'origin/master' || r === 'HEAD')) {
      return { kind: 'reset-hard', segment }
    }
  }
  if (sub === 'stash') {
    const action = (args[0] || '').toLowerCase()
    if (['pop', 'apply', 'drop', 'clear'].includes(action)) {
      return { kind: `stash-${action}`, segment }
    }
    return null
  }
  if (sub === 'checkout') {
    // branch switch / create stay allowed; path restore (`--` or stash) is mutation
    if (args.includes('--') || args.some((w) => w.includes('stash@{'))) {
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

export function decideGitWorkingTreeMutation(command, cwd, depth = 0) {
  if (!command || typeof command !== 'string' || depth > 4) return { decision: 'allow' }
  const sessionCwd = resolve(cwd || process.cwd())
  let upstreamStdinText = ''
  const armedGitEnv = new Map()
  const denied = walkShellCommands(command, sessionCwd, {
    onStatementStart() {
      upstreamStdinText = ''
    },
    onStage({ rawStage, currentCwd, isPipeline, heredocs }) {
      const words = tokenizeCommandLine(stripShellRedirection(rawStage))
      if (words.length === 0) return undefined
      if (!isPipeline) collectGitExportEnv(words, armedGitEnv)
      if (isPipeline) {
        const stdinText = extractUpstreamStdinScript(words, heredocs)
        if (stdinText) upstreamStdinText = stdinText
      }
      const { words: effectiveWords, envMap, targetDir: wrapperDir } = unwrapExecutionWrapperWithMeta(words)
      if (effectiveWords.length === 0) return undefined
      const effectiveCwd = wrapperDir ? resolve(currentCwd, wrapperDir) : currentCwd
      const verb = commandBasename(effectiveWords[0])

      if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.'].includes(verb)) {
        const shellMeta = parseShellInvocation(effectiveWords)
        if (shellMeta && !shellMeta.syntaxCheckOnly) {
          if (shellMeta.inlineScript) {
            const nested = decideGitWorkingTreeMutation(shellMeta.inlineScript, effectiveCwd, depth + 1)
            if (nested.decision === 'deny') return nested
          } else if (shellMeta.procSubCmd) {
            for (const body of extractProducerScriptsFromProcessSub(shellMeta.procSubCmd)) {
              const nested = decideGitWorkingTreeMutation(body, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
          } else if (!shellMeta.scriptFile) {
            for (const body of heredocs) {
              const nested = decideGitWorkingTreeMutation(body, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
            for (const body of extractProcessSubstitutionPayloads(rawStage).scripts) {
              const nested = decideGitWorkingTreeMutation(body, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
            if (isPipeline && upstreamStdinText) {
              const nested = decideGitWorkingTreeMutation(upstreamStdinText, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
          }
        }
        return undefined
      }

      const mergedEnv = new Map(armedGitEnv)
      for (const [k, v] of envMap.entries()) mergedEnv.set(k, v)
      const gitInfo = parseGitInvocation(effectiveWords, effectiveCwd, mergedEnv)
      if (!gitInfo) return undefined
      const mutation = classifyGitMutationWords(gitInfo, rawStage)
      if (!mutation) return undefined
      for (const target of gitInfo.targetDirs) {
        if (isWorktreePath(target)) continue
        const root = gitRoot(target)
        if (root && isWorktreePath(root)) continue
        return {
          decision: 'deny',
          reason: 'forbidden-main-checkout-git-mutation',
          mutation: mutation.kind,
          target,
          segment: rawStage,
        }
      }
      return undefined
    },
  }, depth)
  return denied || { decision: 'allow' }
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

function tokenizeCommandLine(cmd, { keepEmpty = false } = {}) {
  const tokens = []
  let current = ''
  let hasToken = false
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (escaped) {
      current += ch
      hasToken = true
      escaped = false
      continue
    }
    if (ch === '\\' && !inSingle) {
      escaped = true
      hasToken = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      hasToken = true
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      hasToken = true
      continue
    }
    if (!inSingle && !inDouble && (ch === '<' || ch === '>') && cmd[i + 1] === '(') {
      const end = scanBalancedParen(cmd, i + 1)
      current += cmd.slice(i, end + 1)
      hasToken = true
      i = end
      continue
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current || (keepEmpty && hasToken)) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += ch
    hasToken = true
  }
  if (current || (keepEmpty && hasToken)) {
    tokens.push(current)
  }
  return tokens
}

function collectNonOptionArgs(args, valueFlags = new Set()) {
  const out = []
  let afterEndOfOptions = false
  for (let i = 0; i < args.length; i++) {
    const w = args[i]
    if (!afterEndOfOptions && w === '--') {
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && w.startsWith('-') && w !== '-') {
      if (valueFlags.has(w)) i += 1
      continue
    }
    if (w) out.push(w)
  }
  return out
}

function findTargetDirectoryFlag(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') break
    if ((arg === '-t' || arg === '--target-directory') && i + 1 < args.length) {
      return args[i + 1]
    }
    if (arg.startsWith('--target-directory=')) {
      return arg.slice('--target-directory='.length)
    }
    if (/^-t.+/.test(arg)) {
      return arg.slice(2)
    }
    if (/^-[a-zA-Z]*t/.test(arg) && !arg.startsWith('--')) {
      const tIdx = arg.indexOf('t')
      if (tIdx + 1 < arg.length) return arg.slice(tIdx + 1)
      if (i + 1 < args.length) return args[i + 1]
    }
  }
  return null
}

function hasInstallDirectoryFlag(args) {
  const shortValueFlags = new Set(['-m', '-o', '-g', '-S', '-t', '-B'])
  const longValueFlags = new Set(['--mode', '--owner', '--group', '--suffix', '--target-directory'])
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i]
    if (w === '--') break
    if (!w.startsWith('-') || w === '-') continue
    if (w === '--directory') return true
    if (w.startsWith('--')) {
      if (longValueFlags.has(w)) i += 1
      continue
    }
    for (let k = 1; k < w.length; k += 1) {
      const opt = `-${w[k]}`
      if (shortValueFlags.has(opt)) {
        if (k === w.length - 1) i += 1
        break
      }
      if (w[k] === 'd') return true
    }
  }
  return false
}

function hasInPlaceFlag(args, valueFlags = new Set()) {
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i]
    if (w === '--') break
    if (!w.startsWith('-') || w === '-') continue
    if (w === '--in-place' || w.startsWith('--in-place=')) return true
    if (w.startsWith('--')) {
      if (valueFlags.has(w)) i += 1
      continue
    }
    for (let k = 1; k < w.length; k += 1) {
      const opt = `-${w[k]}`
      if (valueFlags.has(opt)) {
        // Attached value (e.g. `-Ilib`, `-es/i/j/`, `-Mstrict`) consumes rest of token;
        // standalone short value flag consumes the next argv token.
        if (k === w.length - 1) i += 1
        break
      }
      if (w[k] === 'i') return true
    }
  }
  return false
}

function extractSedInPlaceTargets(args, effectiveCwd) {
  let hasExplicitScript = false
  const nonOptions = []
  let afterEndOfOptions = false
  const longValueFlags = new Set(['--expression', '--file'])
  const shortValueFlags = new Set(['-e', '-f'])

  for (let i = 0; i < args.length; i += 1) {
    const w = args[i]
    if (!afterEndOfOptions && w === '--') {
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && w.startsWith('-') && w !== '-') {
      if (w.startsWith('--expression=') || w.startsWith('--file=')) {
        hasExplicitScript = true
        continue
      }
      if (longValueFlags.has(w)) {
        hasExplicitScript = true
        i += 1
        continue
      }
      if (w === '--in-place' || w.startsWith('--in-place=') || w.startsWith('--')) {
        continue
      }
      for (let k = 1; k < w.length; k += 1) {
        const opt = `-${w[k]}`
        if (shortValueFlags.has(opt)) {
          hasExplicitScript = true
          if (k === w.length - 1) i += 1
          break
        }
        if (opt === '-i') {
          if (k === w.length - 1) {
            const next = args[i + 1]
            if (next === '') {
              i += 1
            } else if (
              typeof next === 'string' &&
              /^\.[A-Za-z0-9_-]+$/.test(next) &&
              i + 2 < args.length &&
              (args[i + 2].startsWith('-') || args.length - (i + 2) >= 2)
            ) {
              const candidatePath = toFullPath(next, effectiveCwd)
              let existsAsFile = false
              try {
                existsAsFile = Boolean(candidatePath && statSync(candidatePath).isFile())
              } catch {
                existsAsFile = false
              }
              if (!existsAsFile) i += 1
            }
          }
          break
        }
      }
      continue
    }
    if (w) nonOptions.push(w)
  }

  if (nonOptions.length === 0) return []
  if (hasExplicitScript) return nonOptions
  return nonOptions.length >= 2 ? nonOptions.slice(1) : nonOptions
}

function extractPerlInPlaceTargets(args) {
  let hasExplicitCode = false
  const nonOptions = []
  let afterEndOfOptions = false
  const shortValueFlags = new Set(['-e', '-E', '-I', '-M', '-m', '-F'])

  for (let i = 0; i < args.length; i += 1) {
    const w = args[i]
    if (!afterEndOfOptions && w === '--') {
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && w.startsWith('-') && w !== '-') {
      if (w.startsWith('--')) continue
      for (let k = 1; k < w.length; k += 1) {
        const opt = `-${w[k]}`
        if (opt === '-e' || opt === '-E') hasExplicitCode = true
        if (shortValueFlags.has(opt)) {
          if (k === w.length - 1) i += 1
          break
        }
        if (opt === '-i') break
      }
      continue
    }
    if (w) nonOptions.push(w)
  }

  if (nonOptions.length === 0) return []
  if (hasExplicitCode) return nonOptions
  return nonOptions.length >= 2 ? nonOptions.slice(1) : nonOptions
}

function formatPrintfPayload(formatStr, args) {
  const fmt = String(formatStr || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
  if (!args || args.length === 0) return fmt
  const hasSpec = /%(?:%|[-+ #0]*\d*(?:\.\d+)?[a-zA-Z])/.test(fmt)
  if (!hasSpec) return fmt
  const out = []
  let argIdx = 0
  let guard = 0
  do {
    let consumed = false
    const rendered = fmt.replace(/%(%|[-+ #0]*\d*(?:\.\d+)?[a-zA-Z])/g, (_m, spec) => {
      if (spec === '%') return '%'
      consumed = true
      const val = argIdx < args.length ? args[argIdx] : ''
      argIdx += 1
      return val
    })
    out.push(rendered)
    if (!consumed) break
    guard += 1
  } while (argIdx < args.length && guard < 16)
  return out.join('')
}

function extractUpstreamStdinScript(words, heredocs = []) {
  if (!words || words.length === 0) return ''
  const { words: unwrapped } = unwrapExecutionWrapperWithMeta(words)
  if (unwrapped.length === 0) return ''
  const verb = commandBasename(unwrapped[0])
  if (verb === 'echo') {
    let i = 1
    while (i < unwrapped.length && /^-[neE]+$/.test(unwrapped[i])) i += 1
    return unwrapped.slice(i).join(' ')
  }
  if (verb === 'printf') {
    let i = 1
    if (unwrapped[i] === '--') i += 1
    if (unwrapped[i] === '-v') return ''
    const parts = unwrapped.slice(i)
    if (parts.length === 0) return ''
    return formatPrintfPayload(parts[0], parts.slice(1))
  }
  if (verb === 'cat' && heredocs.length > 0) {
    const fileArgs = collectNonOptionArgs(unwrapped.slice(1))
    if (fileArgs.length === 0 || fileArgs.every((a) => a === '-')) {
      return heredocs.join('\n')
    }
  }
  return ''
}

function extractProcessSubInfo(procSubCmd) {
  const scripts = []
  const materializationScripts = []
  if (!procSubCmd || typeof procSubCmd !== 'string') {
    return { scripts, materializationScripts }
  }
  for (const stmt of splitShellStatements(procSubCmd)) {
    for (const rawSub of splitRawPipelineSegments(stmt.raw)) {
      const inputRedirects = extractInputRedirectionTargets(rawSub)
      const words = tokenizeCommandLine(stripShellRedirection(rawSub))
      const hereStrings = extractHereStringPayloads(rawSub)
      const heredocs = hereStrings.length > 0 ? [...stmt.heredocs, ...hereStrings] : stmt.heredocs
      const produced = extractUpstreamStdinScript(words, heredocs)
      if (produced) scripts.push(produced)
      const matFromWords = words.find((w) => MATERIALIZATION_SCRIPT_RE.test(w))
      if (matFromWords) materializationScripts.push(matFromWords)
      const matFromRedir = inputRedirects.find((t) => MATERIALIZATION_SCRIPT_RE.test(t))
      if (matFromRedir) materializationScripts.push(matFromRedir)
    }
  }
  return { scripts, materializationScripts }
}

function extractProducerScriptsFromProcessSub(procSubCmd) {
  return extractProcessSubInfo(procSubCmd).scripts
}

function extractProcessSubstitutionPayloads(segment) {
  const input = String(segment || '')
  const scripts = []
  const materializationScripts = []
  let inSingle = false
  let inDouble = false
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
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
    if (!inSingle && !inDouble && ch === '<' && input[i + 1] === '(') {
      const end = scanBalancedParen(input, i + 1)
      const inner = input.slice(i + 2, end).trim()
      if (inner) {
        const info = extractProcessSubInfo(inner)
        scripts.push(...info.scripts)
        materializationScripts.push(...info.materializationScripts)
      }
      i = end
    }
  }
  return { scripts, materializationScripts }
}

function extractFindSearchRoots(args) {
  const roots = []
  let i = 0
  while (i < args.length) {
    const w = args[i]
    if (w === '-f' && i + 1 < args.length) {
      roots.push(args[i + 1])
      i += 2
      continue
    }
    if (/^-[HLPExXsd]+$/.test(w)) {
      i += 1
      continue
    }
    break
  }
  while (i < args.length) {
    const w = args[i]
    if (w === '--') {
      i += 1
      continue
    }
    if (w.startsWith('-') || w === '(' || w === '!' || w === ',') break
    roots.push(w)
    i += 1
  }
  return roots.length > 0 ? roots : ['.']
}

function hasNodeEvalFlag(args) {
  let i = 0
  while (i < args.length) {
    const w = args[i]
    if (w === '--') break
    if (!w.startsWith('-')) break
    if (
      w === '-e' || w === '--eval' || w.startsWith('--eval=') ||
      w === '-p' || w === '--print' || w.startsWith('--print=') ||
      /^-[a-zA-Z]*[ep][a-zA-Z]*$/.test(w)
    ) {
      return true
    }
    if (NODE_VALUE_FLAGS.has(w)) {
      i += 2
      continue
    }
    i += 1
  }
  return false
}

function hasPythonInlineCodeFlag(args) {
  const pyValueFlags = new Set(['-m', '-W', '-X', '--check-hash-based-pycs'])
  let i = 0
  while (i < args.length) {
    const w = args[i]
    if (w === '--') break
    if (!w.startsWith('-')) break
    if (w === '-c' || /^-[BEdhiIOqsSuvVx]*c/.test(w)) {
      return true
    }
    if (pyValueFlags.has(w)) {
      i += 2
      continue
    }
    i += 1
  }
  return false
}

export function extractCommandWriteTargetsWithCwd(command, cwd = process.cwd(), depth = 0) {
  if (!command || typeof command !== 'string' || depth > 4) return []
  const results = []
  let upstreamStdinText = ''

  walkShellCommands(command, cwd, {
    onStatementStart() {
      upstreamStdinText = ''
    },
    onCdStage({ rawStage, currentCwd }) {
      for (const target of extractOutputRedirectionTargets(rawStage)) {
        results.push({ target, cwd: currentCwd })
      }
    },
    onCloserTail({ tail, cwd: tailCwd }) {
      for (const target of extractOutputRedirectionTargets(tail)) {
        results.push({ target, cwd: tailCwd })
      }
    },
    onStage({ rawStage, currentCwd, isPipeline, heredocs }) {
      // 1. 优先提取一切输出重定向（包含 1>/2>/&>/&>>/>|/<> 以及 `git status > README.md`）
      for (const target of extractOutputRedirectionTargets(rawStage)) {
        results.push({ target, cwd: currentCwd })
      }

      const words = tokenizeCommandLine(stripShellRedirection(rawStage), { keepEmpty: true })
      if (words.length === 0) return undefined

      if (isPipeline) {
        const stdinText = extractUpstreamStdinScript(words, heredocs)
        if (stdinText) upstreamStdinText = stdinText
      }

      const { words: effectiveWords, targetDir } = unwrapExecutionWrapperWithMeta(words)
      if (effectiveWords.length === 0) return undefined
      const effectiveCwd = targetDir ? resolve(currentCwd, targetDir) : currentCwd
      const verb = commandBasename(effectiveWords[0])

      // 2. git 自身工作树变更由 decideGitWorkingTreeMutation 判定；其输出重定向已在步骤 1 提取完毕
      if (verb === 'git') return undefined

      // 3. 递归检视 bash/sh/zsh/source -c 内联命令、process substitution `<(...)`、heredoc 及 echo|bash 管道脚本
      if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.'].includes(verb)) {
        const shellMeta = parseShellInvocation(effectiveWords)
        if (shellMeta && !shellMeta.syntaxCheckOnly) {
          if (shellMeta.inlineScript) {
            results.push(...extractCommandWriteTargetsWithCwd(shellMeta.inlineScript, effectiveCwd, depth + 1))
          } else if (shellMeta.procSubCmd) {
            for (const body of extractProducerScriptsFromProcessSub(shellMeta.procSubCmd)) {
              results.push(...extractCommandWriteTargetsWithCwd(body, effectiveCwd, depth + 1))
            }
          } else if (!shellMeta.scriptFile) {
            for (const body of heredocs) {
              results.push(...extractCommandWriteTargetsWithCwd(body, effectiveCwd, depth + 1))
            }
            for (const body of extractProcessSubstitutionPayloads(rawStage).scripts) {
              results.push(...extractCommandWriteTargetsWithCwd(body, effectiveCwd, depth + 1))
            }
            if (isPipeline && upstreamStdinText) {
              results.push(...extractCommandWriteTargetsWithCwd(upstreamStdinText, effectiveCwd, depth + 1))
            }
          }
        }
        return undefined
      }

      const args = effectiveWords.slice(1)
      const pushTarget = (t) => {
        if (t) results.push({ target: t, cwd: effectiveCwd })
      }

      if (verb === 'cp' || verb === 'install') {
        const valueFlags = verb === 'install'
          ? new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-S', '--suffix', '-t', '--target-directory', '-B'])
          : new Set(['-S', '--suffix', '-t', '--target-directory'])
        if (verb === 'install' && hasInstallDirectoryFlag(args)) {
          for (const item of collectNonOptionArgs(args, valueFlags)) {
            pushTarget(item)
          }
        } else {
          const targetDirFlag = findTargetDirectoryFlag(args)
          if (targetDirFlag) {
            pushTarget(targetDirFlag)
          } else {
            const nonOptions = collectNonOptionArgs(args, valueFlags)
            if (nonOptions.length >= 2) {
              pushTarget(nonOptions[nonOptions.length - 1])
            }
          }
        }
      } else if (verb === 'rsync') {
        // rsync `-t` means `--times`, NOT `--target-directory`
        const nonOptions = collectNonOptionArgs(args, new Set(['-e', '--rsh', '--exclude', '--include', '--compare-dest', '--copy-dest', '--link-dest', '--backup-dir', '--suffix']))
        if (nonOptions.length >= 2) {
          pushTarget(nonOptions[nonOptions.length - 1])
        }
      } else if (verb === 'mv') {
        // mv 会同时修改/删除源路径与目标路径：例如 `mv README.md /tmp/out` 会删除主检出源码
        const valueFlags = new Set(['-S', '--suffix', '-t', '--target-directory'])
        const targetDirFlag = findTargetDirectoryFlag(args)
        if (targetDirFlag) pushTarget(targetDirFlag)
        for (const item of collectNonOptionArgs(args, valueFlags)) {
          pushTarget(item)
        }
      } else if (['rm', 'rmdir', 'unlink'].includes(verb)) {
        for (const item of collectNonOptionArgs(args)) {
          pushTarget(item)
        }
      } else if (verb === 'truncate') {
        for (const item of collectNonOptionArgs(args, new Set(['-s', '--size', '-r', '--reference']))) {
          pushTarget(item)
        }
      } else if (verb === 'tee') {
        for (const item of collectNonOptionArgs(args)) {
          pushTarget(item)
        }
      } else if (['mkdir', 'touch'].includes(verb)) {
        const optionArgs = verb === 'mkdir'
          ? new Set(['-m', '--mode'])
          : new Set(['-r', '--reference', '-t', '-d', '--date'])
        for (const item of collectNonOptionArgs(args, optionArgs)) {
          pushTarget(item)
        }
      } else if (verb === 'sed' && hasInPlaceFlag(args, new Set(['-e', '--expression', '-f', '--file']))) {
        for (const item of extractSedInPlaceTargets(args, effectiveCwd)) {
          pushTarget(item)
        }
      } else if (verb === 'dd') {
        for (const w of args) {
          if (w.startsWith('of=')) {
            pushTarget(w.slice(3))
          }
        }
      } else if (verb === 'ln') {
        const targetDirFlag = findTargetDirectoryFlag(args)
        if (targetDirFlag) {
          pushTarget(targetDirFlag)
        } else {
          const nonOptions = collectNonOptionArgs(args, new Set(['-S', '--suffix', '-t', '--target-directory']))
          if (nonOptions.length >= 2) {
            pushTarget(nonOptions[nonOptions.length - 1])
          } else if (nonOptions.length === 1) {
            // 1-arg `ln -s /tmp/src` creates `<effectiveCwd>/<basename(src)>`
            const stripped = nonOptions[0].replace(/\/+$/, '')
            const linkName = basename(stripped)
            pushTarget(linkName && linkName !== '.' && linkName !== '..' ? linkName : nonOptions[0])
          }
        }
      } else if (verb === 'node') {
        const hasEval = hasNodeEvalFlag(args)
        const joined = args.map((w) => w.replace(/^-[a-zA-Z]*[ep]/, ' ')).join(' ')
        if (hasEval) {
          const singleArgWriteRe = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|rmSync|rm|unlinkSync|unlink|mkdirSync|mkdir|truncateSync|truncate)\(\s*['"`]([^'"`]+)['"`]/g
          for (const m of joined.matchAll(singleArgWriteRe)) {
            pushTarget(m[1])
          }
          const twoArgCopyRenameRe = /\b(?:copyFileSync|copyFile|cpSync|cp|renameSync|rename|linkSync|link|symlinkSync|symlink)\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g
          for (const m of joined.matchAll(twoArgCopyRenameRe)) {
            if (m[0].startsWith('rename')) pushTarget(m[1])
            pushTarget(m[2])
          }
        }
      } else if (verb === 'python' || verb === 'python3') {
        const hasC = hasPythonInlineCodeFlag(args)
        const joined = args.map((w) => w.replace(/^-[BEdhiIOqsSuvVx]*c/, ' ')).join(' ')
        if (hasC) {
          for (const m of joined.matchAll(/open\(\s*['"]([^'"]+)['"]\s*,\s*['"][^'"]*[wax+][^'"]*['"]/g)) {
            pushTarget(m[1])
          }
          for (const m of joined.matchAll(/Path\(\s*['"]([^'"]+)['"]\s*\)\.(?:write_text|write_bytes|unlink|mkdir|touch)\(/g)) {
            pushTarget(m[1])
          }
          for (const m of joined.matchAll(/\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree)\(\s*['"]([^'"]+)['"]/g)) {
            pushTarget(m[1])
          }
          for (const m of joined.matchAll(/\b(?:os\.rename|os\.replace|shutil\.(?:copy|copy2|copyfile|copytree|move))\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
            if (m[0].includes('rename') || m[0].includes('replace') || m[0].includes('move')) pushTarget(m[1])
            pushTarget(m[2])
          }
        }
      } else if (verb === 'perl' && hasInPlaceFlag(args, new Set(['-e', '-E', '-I', '-M', '-m', '-F']))) {
        for (const item of extractPerlInPlaceTargets(args)) {
          pushTarget(item)
        }
      } else if (verb === 'find' && args.includes('-delete')) {
        for (const rootTarget of extractFindSearchRoots(args)) {
          pushTarget(rootTarget)
        }
      }
      return undefined
    },
  }, depth)

  return results
}

export function extractCommandWriteTargets(command) {
  return extractCommandWriteTargetsWithCwd(command).map((item) => item.target)
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

function classifyMaterializationSegment(words, inputRedirects = [], currentCwd = process.cwd(), depth = 0) {
  if (!words || words.length === 0 || depth > 4) return null
  const { words: unwrapped, envVars, targetDir } = unwrapExecutionWrapperWithMeta(words)
  if (unwrapped.length === 0) return null
  const effectiveCwd = targetDir ? resolve(currentCwd, targetDir) : currentCwd
  const verb = commandBasename(unwrapped[0])

  // 豁免纯只读/检视命令（如多行脚本里的 grep ... sync-to-app.sh 或 sed -n ... sync-to-app.sh）
  if (READONLY_INSPECTION_VERBS.has(verb)) return null
  if (verb === 'sed' && !hasInPlaceFlag(unwrapped.slice(1), new Set(['-e', '--expression', '-f', '--file']))) return null

  // 严禁利用 OMNIMUX_SYNC_ISOLATED_ACTIVE=1 或 --managed-tarball 与 --isolated 混用来伪装成隔离物化
  const setsIsolatedActive = envVars.has('OMNIMUX_SYNC_ISOLATED_ACTIVE')
  const hasManagedConflict = unwrapped.some((w) => /^--(?:managed-tarball|expect-|recover-managed-tarball)/.test(w))
  const hasIsolatedFlag = (args, { allowAfterDoubleDash = false } = {}) => {
    if (setsIsolatedActive || hasManagedConflict) return false
    if (allowAfterDoubleDash) return args.includes('--isolated')
    const ddIdx = args.indexOf('--')
    const slice = ddIdx === -1 ? args : args.slice(0, ddIdx)
    return slice.includes('--isolated')
  }

  // 1. 直接执行物化脚本（./scripts/sync-to-app.sh 等）
  if (MATERIALIZATION_SCRIPT_RE.test(unwrapped[0])) {
    const isolated = hasIsolatedFlag(unwrapped.slice(1)) && unwrapped[0].endsWith('sync-to-app.sh')
    return { script: commandBasename(unwrapped[0]), isolated, cwd: effectiveCwd }
  }

  // 2. 通过 shell 显式执行（bash [-o errexit] scripts/sync-to-app.sh / bash -c ... / bash < scripts/sync-to-app.sh）
  if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.'].includes(verb)) {
    const shellMeta = parseShellInvocation(unwrapped)
    if (!shellMeta || shellMeta.syntaxCheckOnly) return null
    if (shellMeta.inlineScript) {
      const inner = classifyMaterializationCommand(shellMeta.inlineScript, effectiveCwd, depth + 1)
      if (!inner) return null
      return setsIsolatedActive ? { ...inner, isolated: false } : inner
    }
    if (shellMeta.procSubCmd) {
      const info = extractProcessSubInfo(shellMeta.procSubCmd)
      if (info.materializationScripts.length > 0) {
        return { script: commandBasename(info.materializationScripts[0]), isolated: false, cwd: effectiveCwd }
      }
      for (const body of info.scripts) {
        const inner = classifyMaterializationCommand(body, effectiveCwd, depth + 1)
        if (inner) return setsIsolatedActive ? { ...inner, isolated: false } : inner
      }
    }
    if (shellMeta.scriptFile && MATERIALIZATION_SCRIPT_RE.test(shellMeta.scriptFile)) {
      const scriptIdx = unwrapped.indexOf(shellMeta.scriptFile)
      const scriptArgs = scriptIdx >= 0 ? unwrapped.slice(scriptIdx + 1) : []
      const isolated = hasIsolatedFlag(scriptArgs) && shellMeta.scriptFile.endsWith('sync-to-app.sh')
      return { script: commandBasename(shellMeta.scriptFile), isolated, cwd: effectiveCwd }
    }
    if (!shellMeta.scriptFile && inputRedirects.length > 0) {
      const redirectedScript = inputRedirects.find((t) => MATERIALIZATION_SCRIPT_RE.test(t))
      if (redirectedScript) {
        return { script: commandBasename(redirectedScript), isolated: false, cwd: effectiveCwd }
      }
    }
    return null
  }

  // 3. node [-r ./x.js] scripts/omnimux.mjs sync 或 omnimux(.mjs) sync
  // 仅在脚本路径之前出现的 --test / --check / -c 才属于 Node 自身测试/语法检查选项，
  // 脚本路径之后的 `--test` 是传给 omnimux.mjs 的参数，绝不能豁免。
  if (verb === 'node') {
    let i = 1
    while (i < unwrapped.length) {
      const flag = unwrapped[i]
      if (flag === '--') {
        i += 1
        break
      }
      if (!flag.startsWith('-')) break
      if (flag === '--test' || flag === '--check' || flag === '-c' || flag === '-e' || flag === '--eval' || flag === '-p' || flag === '--print') {
        return null
      }
      if (NODE_VALUE_FLAGS.has(flag)) {
        i += 2
        continue
      }
      i += 1
    }
    const scriptArg = unwrapped[i] || ''
    const subArg = unwrapped[i + 1] || ''
    if (!scriptArg || /\.test\.(?:mjs|js|ts|cjs)$/.test(scriptArg)) {
      return null
    }
    if (/(?:^|\/)omnimux(?:\.mjs)?$/.test(scriptArg) && subArg === 'sync') {
      const isolated = hasIsolatedFlag(unwrapped.slice(i + 2))
      return { script: 'omnimux.mjs sync', isolated, cwd: effectiveCwd }
    }
    return null
  }

  if (verb === 'omnimux' || verb === 'omnimux.mjs') {
    if (unwrapped[1] === 'sync') {
      return { script: `${verb} sync`, isolated: hasIsolatedFlag(unwrapped.slice(2)), cwd: effectiveCwd }
    }
    return null
  }

  // 4. 包管理器入口：yarn omnimux:sync / pnpm sync / npm run omnimux:sync / pnpm run sync -- --isolated
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(verb)) {
    const parsed = parsePackageManagerScript(unwrapped)
    if (parsed && (parsed.script === 'omnimux:sync' || parsed.script === 'sync')) {
      const pmCwd = parsed.targetDir ? resolve(effectiveCwd, parsed.targetDir) : effectiveCwd
      return {
        script: `${verb} ${parsed.script}`,
        isolated: hasIsolatedFlag(parsed.scriptArgs, { allowAfterDoubleDash: true }),
        cwd: pmCwd,
      }
    }
  }

  return null
}

function classifyMaterializationCommand(command, cwd = process.cwd(), depth = 0) {
  if (!command || typeof command !== 'string' || depth > 4) return null
  const trimmed = command.trim()
  if (!trimmed) return null

  let isolatedActiveArmed = false
  let matched = null
  let upstreamMatScript = ''
  let upstreamStdinText = ''
  let sawStdinShellInStmt = false

  const nonIsolated = walkShellCommands(trimmed, cwd, {
    onStatementStart() {
      upstreamMatScript = ''
      upstreamStdinText = ''
      sawStdinShellInStmt = false
    },
    onCloserTail({ tail, cwd: tailCwd, subSegments }) {
      const redirectedScript = extractInputRedirectionTargets(tail).find((t) => MATERIALIZATION_SCRIPT_RE.test(t))
      if (!redirectedScript) return undefined
      if (subSegments.length > 1 && !upstreamMatScript) {
        upstreamMatScript = redirectedScript
      }
      if (sawStdinShellInStmt) {
        return { script: commandBasename(redirectedScript), isolated: false, cwd: tailCwd }
      }
      return undefined
    },
    onStage({ rawStage, currentCwd, isPipeline, heredocs }) {
      const inputRedirects = extractInputRedirectionTargets(rawStage)
      const words = tokenizeCommandLine(stripShellRedirection(rawStage))
      if (words.length === 0) return undefined

      if (!isPipeline && (words[0] === 'export' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) {
        if (words.some((w) => /^OMNIMUX_SYNC_ISOLATED_ACTIVE=/.test(w))) {
          isolatedActiveArmed = true
        }
      }

      if (isPipeline) {
        const maybeScript =
          words.find((w) => MATERIALIZATION_SCRIPT_RE.test(w)) ||
          inputRedirects.find((t) => MATERIALIZATION_SCRIPT_RE.test(t))
        if (maybeScript && !upstreamMatScript) {
          upstreamMatScript = maybeScript
        }
        const stdinText = extractUpstreamStdinScript(words, heredocs)
        if (stdinText) upstreamStdinText = stdinText
      }

      const { words: unwrapped, envVars, targetDir } = unwrapExecutionWrapperWithMeta(words)
      const effectiveCwd = targetDir ? resolve(currentCwd, targetDir) : currentCwd
      const shellMeta = parseShellInvocation(unwrapped)
      if (shellMeta && !shellMeta.syntaxCheckOnly && !shellMeta.scriptFile && !shellMeta.inlineScript) {
        sawStdinShellInStmt = true
      }

      let hit = classifyMaterializationSegment(words, inputRedirects, currentCwd, depth)
      if (!hit && shellMeta && !shellMeta.syntaxCheckOnly && !shellMeta.scriptFile && !shellMeta.inlineScript) {
        const procSubInfo = extractProcessSubstitutionPayloads(rawStage)
        if (upstreamMatScript) {
          hit = { script: commandBasename(upstreamMatScript), isolated: false, cwd: effectiveCwd }
        } else if (procSubInfo.materializationScripts.length > 0) {
          hit = { script: commandBasename(procSubInfo.materializationScripts[0]), isolated: false, cwd: effectiveCwd }
        } else if (procSubInfo.scripts.length > 0) {
          for (const body of procSubInfo.scripts) {
            const nested = classifyMaterializationCommand(body, effectiveCwd, depth + 1)
            if (nested) {
              hit = envVars.has('OMNIMUX_SYNC_ISOLATED_ACTIVE') ? { ...nested, isolated: false } : nested
              if (!hit.isolated) break
            }
          }
        } else if (heredocs.length > 0) {
          for (const body of heredocs) {
            const nested = classifyMaterializationCommand(body, effectiveCwd, depth + 1)
            if (nested) {
              hit = envVars.has('OMNIMUX_SYNC_ISOLATED_ACTIVE') ? { ...nested, isolated: false } : nested
              if (!hit.isolated) break
            }
          }
        } else if (isPipeline && upstreamStdinText) {
          const nested = classifyMaterializationCommand(upstreamStdinText, effectiveCwd, depth + 1)
          if (nested) {
            hit = envVars.has('OMNIMUX_SYNC_ISOLATED_ACTIVE') ? { ...nested, isolated: false } : nested
          }
        }
      }
      if (!hit) return undefined
      if (isolatedActiveArmed && hit.isolated) {
        hit = { ...hit, isolated: false }
      }
      if (!hit.isolated) return hit
      matched = hit
      return undefined
    },
  }, depth)

  return nonIsolated || matched
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

export function decideMainBranchGitOp(command, cwd, options = {}, depth = 0) {
  if (!command || typeof command !== 'string' || depth > 4) return { decision: 'allow' }
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

  const mergeValueFlags = new Set([
    '-m', '-F', '-s', '--strategy', '-X', '--strategy-option', '-S', '--gpg-sign', '--log', '--into-name',
  ])

  let upstreamStdinText = ''
  const armedGitEnv = new Map()

  const denied = walkShellCommands(command, sessionCwd, {
    onStatementStart() {
      upstreamStdinText = ''
    },
    onStage({ rawStage, currentCwd, isPipeline, heredocs }) {
      const words = tokenizeCommandLine(stripShellRedirection(rawStage))
      if (words.length === 0) return undefined
      if (!isPipeline) collectGitExportEnv(words, armedGitEnv)
      if (isPipeline) {
        const stdinText = extractUpstreamStdinScript(words, heredocs)
        if (stdinText) upstreamStdinText = stdinText
      }
      const { words: effectiveWords, envMap, targetDir: wrapperDir } = unwrapExecutionWrapperWithMeta(words)
      if (effectiveWords.length === 0) return undefined
      const effectiveCwd = wrapperDir ? resolve(currentCwd, wrapperDir) : currentCwd
      const verb = commandBasename(effectiveWords[0])

      if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.'].includes(verb)) {
        const shellMeta = parseShellInvocation(effectiveWords)
        if (shellMeta && !shellMeta.syntaxCheckOnly) {
          if (shellMeta.inlineScript) {
            const nested = decideMainBranchGitOp(shellMeta.inlineScript, effectiveCwd, { ownerRoot }, depth + 1)
            if (nested.decision === 'deny') return nested
          } else if (shellMeta.procSubCmd) {
            for (const body of extractProducerScriptsFromProcessSub(shellMeta.procSubCmd)) {
              const nested = decideMainBranchGitOp(body, effectiveCwd, { ownerRoot }, depth + 1)
              if (nested.decision === 'deny') return nested
            }
          } else if (!shellMeta.scriptFile) {
            for (const body of heredocs) {
              const nested = decideMainBranchGitOp(body, effectiveCwd, { ownerRoot }, depth + 1)
              if (nested.decision === 'deny') return nested
            }
            for (const body of extractProcessSubstitutionPayloads(rawStage).scripts) {
              const nested = decideMainBranchGitOp(body, effectiveCwd, { ownerRoot }, depth + 1)
              if (nested.decision === 'deny') return nested
            }
            if (isPipeline && upstreamStdinText) {
              const nested = decideMainBranchGitOp(upstreamStdinText, effectiveCwd, { ownerRoot }, depth + 1)
              if (nested.decision === 'deny') return nested
            }
          }
        }
        return undefined
      }

      const mergedEnv = new Map(armedGitEnv)
      for (const [k, v] of envMap.entries()) mergedEnv.set(k, v)
      const gitInfo = parseGitInvocation(effectiveWords, effectiveCwd, mergedEnv)
      if (!gitInfo) return undefined
      const isMerge = gitInfo.sub === 'merge'
      const isCommit = gitInfo.sub === 'commit'
      if (!isMerge && !isCommit) return undefined

      // 允许合法的远端快进同步：git merge origin/main 或 git merge --ff-only origin/main
      if (isMerge) {
        const mergeRefs = collectNonOptionArgs(gitInfo.args, mergeValueFlags)
        if (mergeRefs.length > 0 && mergeRefs.every((ref) => ref === 'origin/main' || ref === 'origin/master')) {
          return undefined
        }
      }

      // 逐段解析 `git -C` / `--work-tree` / `--git-dir` / `GIT_DIR` / `GIT_WORK_TREE` / `cd`，
      // 避免前一段 `git -C <wt> status` 或尾随 `-C <wt>` 掩护主干提交/合并。
      for (const target of gitInfo.targetDirs) {
        if (isWorktreePath(target)) continue

        // 只保护本脚本所属仓库：目标目录不属于 omnimux-client 时不拦截外部仓的 main 操作。
        const targetRoot = commandTargetRepoRoot(target)
        if (!ownerRoot || targetRoot !== ownerRoot) continue

        const branchArgs = gitInfo.explicitGitDir
          ? ['--git-dir', gitInfo.explicitGitDir, 'symbolic-ref', '--quiet', '--short', 'HEAD']
          : ['-C', target, 'symbolic-ref', '--quiet', '--short', 'HEAD']
        const branchResult = spawnSync('git', branchArgs, {
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
      return undefined
    },
  }, depth)

  return denied || { decision: 'allow' }
}

const PM_VALUE_FLAGS = new Set([
  ...VALUE_TAKING_FLAGS,
  '--include', '--exclude', '--from', '-j', '--jobs',
])
const BUILD_SCRIPT_RE = /^(?:build|compile|bundle|package)(?::.+)?$|^plugins:build$/i

function extractDirFlagFromArgs(args) {
  let targetDir = ''
  for (let i = 0; i < args.length; i++) {
    const w = args[i]
    if (w === '--') break
    if (!w.startsWith('-')) continue
    const eq = w.indexOf('=')
    if (eq !== -1) {
      const flag = w.slice(0, eq)
      if (PM_DIR_FLAGS.has(flag)) targetDir = w.slice(eq + 1)
      continue
    }
    if (PM_DIR_FLAGS.has(w) && i + 1 < args.length) {
      targetDir = args[i + 1]
      i += 1
    }
  }
  return targetDir
}

function parsePackageManagerScript(effectiveWords) {
  if (!effectiveWords || effectiveWords.length === 0) return null
  const manager = commandBasename(effectiveWords[0])
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
      i += isPmValueFlag(manager, w) ? 2 : 1
      continue
    }
    break
  }

  // Bare `yarn` / `corepack yarn` (without -v/--version/-h/--help) performs implicit `yarn install`.
  if (i >= effectiveWords.length) {
    if (manager === 'yarn') {
      const flags = effectiveWords.slice(1)
      const isInfoOnly = flags.some((f) => f === '-v' || f === '--version' || f === '-h' || f === '--help')
      if (!isInfoOnly) {
        return { subcommand: 'install', script: 'install', restAfterSub: flags, scriptArgs: flags, targetDir }
      }
    }
    return null
  }

  let subcommand = effectiveWords[i].toLowerCase()
  let restAfterSub = effectiveWords.slice(i + 1)

  // Unwrap `pnpm recursive|multi|m [flags...] <subcommand> ...`
  if (manager === 'pnpm' && ['recursive', 'multi', 'm'].includes(subcommand)) {
    let k = 0
    while (k < restAfterSub.length) {
      const w = restAfterSub[k]
      if (w === '--') break
      if (!w.startsWith('-')) break
      const eq = w.indexOf('=')
      if (eq !== -1) {
        if (PM_DIR_FLAGS.has(w.slice(0, eq))) targetDir = w.slice(eq + 1)
        k += 1
        continue
      }
      if (PM_DIR_FLAGS.has(w) && k + 1 < restAfterSub.length) {
        targetDir = restAfterSub[k + 1]
        k += 2
        continue
      }
      k += isPmValueFlag(manager, w) ? 2 : 1
    }
    if (k < restAfterSub.length) {
      subcommand = restAfterSub[k].toLowerCase()
      restAfterSub = restAfterSub.slice(k + 1)
    }
  } else if (manager === 'yarn' && subcommand === 'workspace') {
    // Unwrap `yarn workspace <pkg> [run] <script>`
    let k = 0
    while (k < restAfterSub.length && restAfterSub[k].startsWith('-')) {
      k += isPmValueFlag(manager, restAfterSub[k]) ? 2 : 1
    }
    // Skip workspace package name
    k += 1
    while (k < restAfterSub.length && restAfterSub[k].startsWith('-')) {
      k += isPmValueFlag(manager, restAfterSub[k]) ? 2 : 1
    }
    if (k < restAfterSub.length) {
      subcommand = restAfterSub[k].toLowerCase()
      restAfterSub = restAfterSub.slice(k + 1)
    }
  } else if (manager === 'yarn' && subcommand === 'workspaces' && (restAfterSub[0] || '').toLowerCase() === 'foreach') {
    // Unwrap `yarn workspaces foreach [--since [ref]] ... [run] <script>`
    let k = 1
    while (k < restAfterSub.length && restAfterSub[k].startsWith('-')) {
      const w = restAfterSub[k]
      if (w === '--since' && k + 1 < restAfterSub.length) {
        const nextTok = restAfterSub[k + 1].toLowerCase()
        if (
          nextTok.startsWith('-') ||
          ['run', 'exec', 'dlx', 'install'].includes(nextTok) ||
          BUILD_SCRIPT_RE.test(nextTok) ||
          k + 2 >= restAfterSub.length
        ) {
          k += 1
          continue
        }
        k += 2
        continue
      }
      k += isPmValueFlag(manager, w) ? 2 : 1
    }
    if (k < restAfterSub.length) {
      subcommand = restAfterSub[k].toLowerCase()
      restAfterSub = restAfterSub.slice(k + 1)
    }
  }

  if (!targetDir) {
    targetDir = extractDirFlagFromArgs(restAfterSub)
  }

  let script = subcommand
  let scriptArgs = restAfterSub
  if (subcommand === 'run' || subcommand === 'run-script') {
    let j = 0
    while (j < restAfterSub.length && restAfterSub[j].startsWith('-')) {
      j += isPmValueFlag(manager, restAfterSub[j]) ? 2 : 1
    }
    script = (restAfterSub[j] || '').toLowerCase()
    scriptArgs = restAfterSub.slice(j + 1)
  }
  return { subcommand, script, restAfterSub, scriptArgs, targetDir }
}

export function decideMainCheckoutBuildCommand(command, cwd, depth = 0) {
  if (!command || typeof command !== 'string' || depth > 4) return { decision: 'allow' }
  const sessionCwd = resolve(cwd || process.cwd())
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

  let upstreamStdinText = ''

  const denied = walkShellCommands(command, sessionCwd, {
    onStatementStart() {
      upstreamStdinText = ''
    },
    onStage({ rawStage, currentCwd, isPipeline, heredocs }) {
      const words = tokenizeCommandLine(stripShellRedirection(rawStage))
      if (words.length === 0) return undefined

      if (isPipeline) {
        const stdinText = extractUpstreamStdinScript(words, heredocs)
        if (stdinText) upstreamStdinText = stdinText
      }

      const verb = commandBasename(words[0])
      if (verb === 'git') return undefined

      // 包装执行器（KEY=VAL / env [-S|-C] / exec / builtin / nohup / corepack / command / npx /
      // pnpm [--dir ...] [recursive|multi|m] exec|dlx / npm [--prefix ...] exec [-c] /
      // yarn [--cwd ...] [workspace <pkg> | workspaces foreach ...] exec|dlx / bunx）先解包，
      // 同时保留其目标目录覆盖（--dir / -C / --prefix / --cwd），再判定最终目标目录是否在 worktree。
      const { words: effectiveWords, targetDir: wrapperDir } = unwrapExecutionWrapperWithMeta(words)
      if (effectiveWords.length === 0) return undefined
      const effectiveVerb = commandBasename(effectiveWords[0])
      let effectiveCwd = wrapperDir ? resolve(currentCwd, wrapperDir) : currentCwd

      // 0.5. 递归判定 bash/sh/zsh/source -c 内联构建、process substitution `<(...)`、heredoc 与 echo|bash 管道脚本
      if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.'].includes(effectiveVerb)) {
        const shellMeta = parseShellInvocation(effectiveWords)
        if (shellMeta && !shellMeta.syntaxCheckOnly) {
          if (shellMeta.inlineScript) {
            const nested = decideMainCheckoutBuildCommand(shellMeta.inlineScript, effectiveCwd, depth + 1)
            if (nested.decision === 'deny') return nested
          } else if (shellMeta.procSubCmd) {
            for (const body of extractProducerScriptsFromProcessSub(shellMeta.procSubCmd)) {
              const nested = decideMainCheckoutBuildCommand(body, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
          } else if (!shellMeta.scriptFile) {
            for (const body of heredocs) {
              const nested = decideMainCheckoutBuildCommand(body, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
            for (const body of extractProcessSubstitutionPayloads(rawStage).scripts) {
              const nested = decideMainCheckoutBuildCommand(body, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
            if (isPipeline && upstreamStdinText) {
              const nested = decideMainCheckoutBuildCommand(upstreamStdinText, effectiveCwd, depth + 1)
              if (nested.decision === 'deny') return nested
            }
          }
        }
        return undefined
      }

      let parsedPm = null
      if (['pnpm', 'npm', 'yarn', 'bun'].includes(effectiveVerb)) {
        parsedPm = parsePackageManagerScript(effectiveWords)
        if (parsedPm && parsedPm.targetDir) {
          effectiveCwd = resolve(effectiveCwd, parsedPm.targetDir)
        }
      }

      // 必须基于最终 effectiveCwd（已解析 cd / --dir / -C / --prefix / --cwd）判定是否在 linked worktree 内；
      // 避免从 worktree 通过 `pnpm --dir <main>/plugins run build:all` 穿透主检出。
      if (isCwdWorktree(effectiveCwd)) return undefined

      // 1. tsc（严密校验 --noEmit，按最后一次出现为准，杜绝 --noEmit --noEmit=false / --noEmit false 穿透）
      const isTscInvocation =
        effectiveVerb === 'tsc' ||
        (effectiveVerb === 'npx' && effectiveWords[1] === 'tsc') ||
        (['pnpm', 'yarn', 'bun'].includes(effectiveVerb) && effectiveWords[1] === 'tsc') ||
        (effectiveVerb === 'npm' && effectiveWords[1] === 'exec' && effectiveWords.includes('tsc')) ||
        Boolean(parsedPm && parsedPm.script === 'tsc')

      if (isTscInvocation) {
        let isNoEmit = false
        for (let i = 0; i < effectiveWords.length; i += 1) {
          const w = effectiveWords[i]
          const wl = w.toLowerCase()
          if (wl === '--noemit') {
            const next = (effectiveWords[i + 1] || '').toLowerCase()
            if (next === 'false' || next === '0') {
              isNoEmit = false
              i += 1
            } else {
              isNoEmit = true
              if (next === 'true' || next === '1') i += 1
            }
          } else if (wl.startsWith('--noemit=')) {
            const val = wl.slice('--noemit='.length)
            isNoEmit = val === 'true' || val === '1'
          }
        }
        if (!isNoEmit) {
          return {
            decision: 'deny',
            reason: 'forbidden-main-checkout-build',
            command: rawStage,
          }
        }
      }

      // 2. build / build:* / compile / compile:* / bundle / bundle:* / package:* 禁止；
      //    冻结依赖恢复放行，manifest/lock 变更与未冻结 install 仍禁止。
      if (parsedPm) {
        const { subcommand, script, restAfterSub } = parsedPm
        if (
          BUILD_SCRIPT_RE.test(script) ||
          script === 'esbuild' ||
          (script === 'vite' && restAfterSub.includes('build'))
        ) {
          return {
            decision: 'deny',
            reason: 'forbidden-main-checkout-build',
            command: rawStage,
          }
        }
        // `pnpm add/remove/update…` 与带包名的安装会改 package.json/lock，仍拦截。
        const manifestMutation = ['add', 'remove', 'uninstall', 'update', 'up', 'upgrade', 'link', 'unlink', 'dedupe', 'prune', 'publish', 'pack']
        if (manifestMutation.includes(subcommand)) {
          return {
            decision: 'deny',
            reason: 'forbidden-main-checkout-build',
            command: rawStage,
          }
        }
        if (['install', 'i', 'ci'].includes(subcommand)) {
          // 依赖恢复（primary 维护 / node_modules 修复）：只允许无位置包名的
          // install/ci；带值 flag 的值不算位置参数，其余非 flag 参数按 add 语义保守拒绝。
          const positional = positionalArgs(restAfterSub, effectiveVerb)
          if (positional.length > 0) {
            return {
              decision: 'deny',
              reason: 'forbidden-main-checkout-build',
              command: rawStage,
            }
          }
          // 主检出的 install 必须按对应包管理器冻结 lockfile；`ci` 天然冻结。
          if (subcommand !== 'ci' && !isFrozenInstall(effectiveWords, effectiveVerb)) {
            return {
              decision: 'deny',
              reason: 'forbidden-main-checkout-unfrozen-install',
              command: rawStage,
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
          command: rawStage,
        }
      }
      return undefined
    },
  }, depth)

  return denied || { decision: 'allow' }
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

  // 1. 检查破坏性重置未推送提交（上游干净时严禁提前 return allow，必须继续经过步骤 2–6 全部防线）
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

  // 3. 检查试图通过命令行拷贝/写入/移动/删除到主 checkout 受保护目录（按段追踪 cd / subshell）
  const writeOps = extractCommandWriteTargetsWithCwd(command, cwd)
  for (const { target, cwd: targetCwd } of writeOps) {
    if (isForbiddenMainCheckoutWriteTarget(target, targetCwd)) {
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
  const matHit = classifyMaterializationCommand(command, cwd)
  if (matHit && !matHit.isolated) {
    const matDecision = decideMaterializationCommand({ cwd: matHit.cwd || cwd })
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
