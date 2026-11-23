#!/usr/bin/env node
/**
 * scripts/verify-fix-regression-test.mjs
 *
 * CI 侧「一坑一测试」门禁：
 * 当变更被识别为 fix（PR 标题 / 标签 / 非合并提交主题命中 fix/bugfix/hotfix 或 bug/regression 标签）
 * 且修改了产品源码或运行脚本时，已提交范围内必须包含：
 *   1. 至少一个有实质新增代码行的测试文件（不能只改空行、纯注释或只删测试）；或
 *   2. 已提交的显式豁免：本范围在 specs/*.md 新增 `## 无回归测试声明`（≥ 20 非空白字符），
 *      或在非合并提交正文带 `No-Regression-Test: <原因与替代验收>`（≥ 20 非空白字符）。
 *
 * 豁免必须进入 Git 提交，确保 pull_request 与 merge_group 判定口径完全一致。
 *
 * 用法：
 *   node scripts/verify-fix-regression-test.mjs [root] [base] [--head <ref>] [--pr-title <title>] [--labels <a,b>] [--json]
 *   也支持通过环境变量 PR_TITLE / PR_LABELS 传入 PR 元数据（推荐在 GitHub Actions 中通过 env 传参）。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const NO_REGRESSION_TEST_SECTION = '无回归测试声明'
export const NO_REGRESSION_TEST_TRAILER = 'No-Regression-Test'
export const MIN_WAIVER_CHARS = 20

const FIX_SUBJECT_RE = /^\s*(?:fix|bugfix|hotfix)(?:\([^)]*\))?!?\s*:/i
const FIX_LABEL_RE = /^(?:bug|type:bug|kind\/bug|regression)$/i

const FIXTURE_OR_SNAPSHOT_RE = /(?:^|\/)(?:fixtures?|mocks?|test-fixtures|__snapshots__)(?:\/|$)|\.(?:fixture|mock)\.[^/]+$/i
const BUILD_ARTIFACT_RE = /(?:^|\/)(?:lib|dist|build|coverage|node_modules)(?:\/|$)/i
const CODE_EXT_RE = /\.(?:[cm]?[jt]sx?|css|sh|py)$/i

const PRODUCT_SOURCE_ROOTS = [
  /^plugins\/(?:plugins|packages)\/[^/]+\/(?:src|scripts)\//,
  /^app\/[^/]+\/(?:src|scripts)\//,
  /^(?:app\/|plugins\/)?scripts\//,
]

function normalizeRelPath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isFixSubject(text) {
  return FIX_SUBJECT_RE.test(String(text ?? ''))
}

export function isFixLabel(label) {
  return FIX_LABEL_RE.test(String(label ?? '').trim())
}

export function isTestFilePath(filePath) {
  const rel = normalizeRelPath(filePath)
  if (!rel || /\.md$/i.test(rel) || FIXTURE_OR_SNAPSHOT_RE.test(rel)) return false
  if (/\.(?:type-)?(?:test|spec)\.[cm]?[jt]sx?$/i.test(rel)) return true
  if (/\.(?:test|spec)\.py$/i.test(rel)) return true
  if (/(?:^|\/)(?:tests?|__tests__|e2e)\/.+\.[cm]?[jt]sx?$/i.test(rel)) return true
  if (/^(?:(?:app|plugins)\/)?scripts\/test-[^/]+\.[cm]?[jt]s$/.test(rel)) return true
  return false
}

export function isProductCodePath(filePath) {
  const rel = normalizeRelPath(filePath)
  if (!rel || !CODE_EXT_RE.test(rel)) return false
  if (isTestFilePath(rel) || FIXTURE_OR_SNAPSHOT_RE.test(rel) || BUILD_ARTIFACT_RE.test(rel)) return false
  return PRODUCT_SOURCE_ROOTS.some(pattern => pattern.test(rel))
}

/**
 * 判断单文件 unified diff 中是否包含至少一行非空、非纯注释的新增代码。
 */
export function hasMeaningfulAddedCode(diffText) {
  let inBlockComment = false
  for (const rawLine of String(diffText ?? '').split(/\r?\n/)) {
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue
    let line = rawLine.slice(1).trim()
    if (!line) continue

    while (line) {
      if (inBlockComment) {
        const end = line.indexOf('*/')
        if (end === -1) {
          line = ''
          break
        }
        inBlockComment = false
        line = line.slice(end + 2).trim()
        continue
      }
      if (line.startsWith('/*')) {
        const end = line.indexOf('*/', 2)
        if (end === -1) {
          inBlockComment = true
          line = ''
          break
        }
        line = line.slice(end + 2).trim()
        continue
      }
      if (line.startsWith('//') || line.startsWith('#') || line.startsWith('*')) {
        line = ''
        break
      }
      return true
    }
  }
  return false
}

/**
 * 提取 Markdown 中 `## <headingName>` 一节正文（跳过代码块内的伪标题）。
 */
export function extractSpecSection(markdown, headingName = NO_REGRESSION_TEST_SECTION) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  let inFence = false
  let fenceChar = ''
  let collecting = false
  const collected = []

  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const ch = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceChar = ch
      } else if (ch === fenceChar) {
        inFence = false
        fenceChar = ''
      }
      if (collecting) collected.push(line)
      continue
    }
    if (!inFence) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (heading) {
        const level = heading[1].length
        const title = heading[2].trim()
        if (collecting && level <= 2) break
        if (level === 2 && title === headingName) {
          collecting = true
          continue
        }
      }
    }
    if (collecting) collected.push(line)
  }

  return collected.join('\n').trim()
}

function nonWhitespaceLength(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

/**
 * 提取提交正文中的 `No-Regression-Test:` 豁免声明。
 */
export function extractCommitWaivers(commits) {
  const waivers = []
  const pattern = new RegExp(`^\\s*${NO_REGRESSION_TEST_TRAILER}\\s*:\\s*(.+)$`, 'gim')
  for (const commit of commits) {
    const body = String(commit?.body ?? '')
    for (const match of body.matchAll(pattern)) {
      const reason = match[1].trim()
      if (nonWhitespaceLength(reason) >= MIN_WAIVER_CHARS) {
        waivers.push({ source: 'commit-trailer', ref: commit.sha.slice(0, 12), reason })
      }
    }
  }
  return waivers
}

function git(root, args, encoding = 'utf8') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['--no-optional-locks', '--literal-pathspecs', '-C', root, ...args], {
    encoding,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15000,
  })
}

function nulFields(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text && !text.endsWith('\0')) throw new Error('truncated-git-path-list')
  return text.split('\0')
}

function resolveGitRoot(dir) {
  const real = realpathSync(dir)
  const top = spawnSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (top.status !== 0 || !(top.stdout || '').trim()) {
    throw new Error(`not-a-git-repository: ${real}`)
  }
  return realpathSync(top.stdout.trim())
}

function parseLabelList(raw) {
  if (Array.isArray(raw)) return raw.map(v => String(v ?? '').trim()).filter(Boolean)
  const text = String(raw ?? '').trim()
  if (!text || text === 'null' || text === 'undefined') return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map(v => String(v?.name ?? v ?? '').trim()).filter(Boolean)
    } catch { /* fall back to comma split */ }
  }
  return text.split(',').map(v => v.trim()).filter(Boolean)
}

export function resolveCliOptions(argv = process.argv.slice(2), env = process.env) {
  const positional = []
  const options = {
    root: process.cwd(),
    base: 'origin/main',
    head: 'HEAD',
    prTitle: env?.PR_TITLE ?? '',
    labels: parseLabelList(env?.PR_LABELS ?? ''),
    json: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--head' || arg === '--pr-title' || arg === '--labels') {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      i += 1
      if (arg === '--head') options.head = value
      else if (arg === '--pr-title') options.prTitle = value
      else if (arg === '--labels') options.labels = parseLabelList(value)
      continue
    }
    if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`)
    positional.push(arg)
  }
  if (positional.length > 2) {
    throw new Error('usage: verify-fix-regression-test.mjs [root] [base] [--head <ref>] [--pr-title <title>] [--labels <a,b>] [--json]')
  }
  if (positional[0]) options.root = positional[0]
  if (positional[1]) options.base = positional[1]
  return options
}

/**
 * 校验 fix 变更是否包含可判别的回归测试或已提交的显式豁免。
 */
export function verifyFixRegressionTest({
  root,
  base = 'origin/main',
  head = 'HEAD',
  prTitle = '',
  labels = [],
} = {}) {
  const repoRoot = resolveGitRoot(root || process.cwd())
  const resolveCommit = ref => git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  const candidate = resolveCommit(head)
  const baseCommit = resolveCommit(base)
  const bases = git(repoRoot, ['merge-base', '--all', baseCommit, candidate]).trim().split('\n').filter(Boolean)
  if (bases.length !== 1) throw new Error('ambiguous-comparison-base')
  const comparisonBase = bases[0]

  const rawLog = git(repoRoot, ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', `${comparisonBase}..${candidate}`])
  const commits = rawLog
    .split('\x1e')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [sha = '', subject = '', body = ''] = entry.split('\x1f')
      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() }
    })

  const normalizedLabels = parseLabelList(labels)
  const fixReasons = []
  if (isFixSubject(prTitle)) fixReasons.push(`PR 标题命中 fix 前缀：${prTitle.trim()}`)
  for (const label of normalizedLabels) {
    if (isFixLabel(label)) fixReasons.push(`PR 标签命中缺陷类：${label}`)
  }
  for (const commit of commits) {
    if (isFixSubject(commit.subject)) {
      fixReasons.push(`提交 ${commit.sha.slice(0, 12)} 主题命中 fix 前缀：${commit.subject}`)
    }
  }

  const baseResult = {
    root: repoRoot,
    comparisonBase,
    candidate,
    isFix: fixReasons.length > 0,
    fixReasons,
    productFiles: [],
    qualifiedTests: [],
    ignoredTestTouches: [],
    waivers: [],
  }

  if (!baseResult.isFix) {
    return { ...baseResult, ok: true, status: 'not-a-fix' }
  }

  const fields = nulFields(git(repoRoot, ['diff', '--name-status', '-z', '--find-renames', comparisonBase, candidate], null))
  const changes = []
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++]
    const oldPath = fields[i++]
    const path = /^[RC]/.test(status) ? fields[i++] : oldPath
    if (!path || !oldPath) throw new Error('truncated-change-list')
    changes.push({ status, oldPath: normalizeRelPath(oldPath), path: normalizeRelPath(path) })
  }

  const productFiles = []
  const candidateTests = []
  const specChanges = []
  for (const change of changes) {
    if (isProductCodePath(change.path) || isProductCodePath(change.oldPath)) {
      productFiles.push(change.path)
    }
    if (change.status !== 'D' && isTestFilePath(change.path)) {
      candidateTests.push(change.path)
    }
    if (change.status !== 'D' && /^specs\/.*\.md$/.test(change.path)) {
      specChanges.push(change)
    }
  }

  baseResult.productFiles = [...new Set(productFiles)].sort()
  if (baseResult.productFiles.length === 0) {
    return { ...baseResult, ok: true, status: 'no-product-code-changed' }
  }

  const qualifiedTests = []
  const ignoredTestTouches = []
  for (const testPath of [...new Set(candidateTests)].sort()) {
    const diff = git(repoRoot, ['diff', '-U0', comparisonBase, candidate, '--', testPath])
    if (hasMeaningfulAddedCode(diff)) qualifiedTests.push(testPath)
    else ignoredTestTouches.push(testPath)
  }
  baseResult.qualifiedTests = qualifiedTests
  baseResult.ignoredTestTouches = ignoredTestTouches

  if (qualifiedTests.length > 0) {
    return { ...baseResult, ok: true, status: 'covered' }
  }

  const waivers = []
  const readBlob = (sha, path) => {
    try {
      return git(repoRoot, ['show', `${sha}:${path}`])
    } catch {
      return ''
    }
  }
  for (const change of specChanges) {
    const afterSection = extractSpecSection(readBlob(candidate, change.path), NO_REGRESSION_TEST_SECTION)
    if (nonWhitespaceLength(afterSection) < MIN_WAIVER_CHARS) continue
    const beforeSection = change.status === 'A'
      ? ''
      : extractSpecSection(readBlob(comparisonBase, change.oldPath), NO_REGRESSION_TEST_SECTION)
    if (afterSection === beforeSection) continue
    waivers.push({ source: 'spec-section', ref: change.path, reason: afterSection.split(/\r?\n/)[0].trim() })
  }
  waivers.push(...extractCommitWaivers(commits))
  baseResult.waivers = waivers

  if (waivers.length > 0) {
    return { ...baseResult, ok: true, status: 'waived' }
  }

  return { ...baseResult, ok: false, status: 'missing-regression-test' }
}

export function formatReport(result) {
  const lines = []
  lines.push(`== fix 回归测试门禁 (${result.comparisonBase.slice(0, 12)}..${result.candidate.slice(0, 12)}) ==`)
  if (result.status === 'not-a-fix') {
    lines.push('✅ 非 fix 类变更，跳过回归测试存在性要求。')
    return lines.join('\n')
  }
  lines.push(`触发原因：${result.fixReasons.join('；')}`)
  if (result.status === 'no-product-code-changed') {
    lines.push('✅ 未修改产品源码或运行脚本，放行。')
    return lines.join('\n')
  }
  lines.push(`改动的产品源码/脚本（${result.productFiles.length}）：`)
  for (const file of result.productFiles) lines.push(`  - ${file}`)

  if (result.status === 'covered') {
    lines.push(`✅ 已包含有效回归测试（${result.qualifiedTests.length}）：`)
    for (const file of result.qualifiedTests) lines.push(`  - ${file}`)
    return lines.join('\n')
  }

  if (result.status === 'waived') {
    lines.push(`⚠️ 已通过显式无回归测试豁免（${result.waivers.length}，请评审独立核实替代验收）：`)
    for (const item of result.waivers) lines.push(`  - [${item.source}] ${item.ref}：${item.reason}`)
    return lines.join('\n')
  }

  lines.push('')
  lines.push('❌ 阻断：fix 改动修改了产品源码或运行脚本，但未包含带实质新增代码行的回归测试。')
  if (result.ignoredTestTouches.length > 0) {
    lines.push('   以下测试文件虽有改动，但未新增有效代码行（仅空行、注释或删除不算回归测试）：')
    for (const file of result.ignoredTestTouches) lines.push(`   - ${file}`)
  }
  lines.push('')
  lines.push('修复方式（二选一）：')
  lines.push('  1. 新增或补充回归测试，使用真实数据形态并完成双向证伪（回退修复必红、恢复必绿）。')
  lines.push(`  2. 确属无法自动测试的场景：在已提交的 specs/<feature>.spec.md 新增 \`## ${NO_REGRESSION_TEST_SECTION}\`（≥ ${MIN_WAIVER_CHARS} 非空白字符），或在提交正文写 \`${NO_REGRESSION_TEST_TRAILER}: <原因与替代验收>\`。`)
  lines.push('参考规范：AGENTS.md#一坑一测试 · LESSONS.md')
  return lines.join('\n')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = resolveCliOptions(process.argv.slice(2), process.env)
    const result = verifyFixRegressionTest(options)
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      process.stdout.write(formatReport(result) + '\n')
    }
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(`fix 回归测试门禁执行失败：${error.message}`)
    process.exitCode = 1
  }
}
