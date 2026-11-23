#!/usr/bin/env node
/**
 * scripts/analyze-lessons-signals.mjs
 *
 * 确定性事故账本增量信号提取器：
 *   1. 读取根 LESSONS.md 的 reviewed-through 游标、活跃规则 seen 计数、最近日期与体积预算，
 *      识别待晋升规则（seen >= 3）与长期未复发条目（seen <= 1 且 > 30 天）。
 *   2. 扫描 since..head（并向前回看 windowHours，默认 72h）的一父提交历史，提取四类可证伪信号：
 *      - 回滚提交（Revert）
 *      - 72h 返修链（fix/revert 与前 72h 内提交改动了重叠的产品源码或运行脚本）
 *      - 无回归测试的 fix 提交（改产品代码却未触碰测试文件，区分是否含 No-Regression-Test: trailer）
 *      - 跨日连修热点产品文件（>= 2 个不同日历日被 fix/revert 触碰）
 *   3. 输出结构化 JSON 或 Markdown 摘要，供本地复盘与定期工作流消费（不自动修改 LESSONS.md 游标）。
 *
 * 用法：
 *   node scripts/analyze-lessons-signals.mjs [root] [--since <sha>] [--head <ref>] [--window-hours <N>]
 *     [--as-of <YYYY-MM-DD>] [--lessons <path>] [--json] [--markdown] [--output <file>] [--fail-on-signals]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  MIN_WAIVER_CHARS,
  NO_REGRESSION_TEST_SECTION,
  NO_REGRESSION_TEST_TRAILER,
  extractCommitWaivers,
  extractSpecSection,
  isFixSubject,
  isProductCodePath,
  isTestFilePath,
} from './verify-fix-regression-test.mjs'

export const DEFAULT_WINDOW_HOURS = 72
export const TIGHT_REWORK_HOURS = 24
export const PROMOTION_SEEN_THRESHOLD = 3
export const STALE_DAYS_THRESHOLD = 30
export const LESSONS_MAX_LINES = 200
export const LESSONS_MAX_BYTES = 16_000

const REVERT_SUBJECT_RE = /^\s*revert(?:\([^)]*\))?(?:\s*:|\s+["'“#])/i
const ZH_FIX_SUBJECT_RE = /^\s*修复/
const CURSOR_RE = /^<!--\s*reviewed-through:\s*([0-9a-f]{7,40})\s*\((\d{4}-\d{2}-\d{2})\)\s*-->/m
const ACTIVE_HEADING_RE = /^##\s+活跃规则\s*$/
const ANY_H2_RE = /^##\s+/
const RULE_BULLET_RE = /^-\s+\*\*(.+?)\*\*(.*)$/
const SEEN_RE = /\bseen\s+(\d+)\b/i
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/g
const PR_REF_RE = /\(#(\d+)\)/g

const RECORD_SEP = '\x1d'
const FIELD_SEP = '\x1f'
const BODY_END = '\x1e'

export function isRevertSubject(subject) {
  return REVERT_SUBJECT_RE.test(String(subject ?? ''))
}

export function isFixLikeSubject(subject) {
  const text = String(subject ?? '')
  return isFixSubject(text) || isRevertSubject(text) || ZH_FIX_SUBJECT_RE.test(text)
}

export function extractPrNumber(subject) {
  const matches = [...String(subject ?? '').matchAll(PR_REF_RE)]
  if (!matches.length) return null
  return Number(matches[matches.length - 1][1])
}

function daysBetweenIsoDates(fromDate, toDate) {
  if (!fromDate || !toDate) return null
  const fromMs = Date.parse(`${fromDate}T00:00:00Z`)
  const toMs = Date.parse(`${toDate}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null
  return Math.floor((toMs - fromMs) / 86_400_000)
}

/**
 * 解析 LESSONS.md 游标、预算和活跃规则元数据。
 */
export function parseLessonsLedger(markdown, options = {}) {
  const text = String(markdown ?? '')
  const asOfDate = options.asOfDate || null
  const lines = text.split(/\r?\n/)
  const bytes = Buffer.byteLength(text, 'utf8')
  const cursorMatch = CURSOR_RE.exec(text)
  const cursor = cursorMatch ? { sha: cursorMatch[1], date: cursorMatch[2] } : null

  const activeRules = []
  let inActiveSection = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (ACTIVE_HEADING_RE.test(line)) {
      inActiveSection = true
      continue
    }
    if (inActiveSection && ANY_H2_RE.test(line)) {
      inActiveSection = false
      break
    }
    if (!inActiveSection) continue

    const bullet = RULE_BULLET_RE.exec(line)
    if (!bullet) continue

    const title = bullet[1].trim()
    const meta = bullet[2] || ''
    const seenMatch = SEEN_RE.exec(meta)
    const seen = seenMatch ? Number(seenMatch[1]) : 1
    const dates = [...meta.matchAll(DATE_RE)].map(m => m[1])
    const lastSeenDate = dates.length ? dates[dates.length - 1] : null
    const daysSinceLastSeen = daysBetweenIsoDates(lastSeenDate, asOfDate)
    const promotionReady = seen >= PROMOTION_SEEN_THRESHOLD
    const stale = seen <= 1 && daysSinceLastSeen !== null && daysSinceLastSeen > STALE_DAYS_THRESHOLD

    activeRules.push({
      line: i + 1,
      title,
      seen,
      lastSeenDate,
      daysSinceLastSeen,
      promotionReady,
      stale,
    })
  }

  return {
    cursor,
    lines: lines.length,
    bytes,
    maxLines: LESSONS_MAX_LINES,
    maxBytes: LESSONS_MAX_BYTES,
    overBudget: lines.length > LESSONS_MAX_LINES || bytes > LESSONS_MAX_BYTES,
    activeRules,
    promotionReady: activeRules.filter(rule => rule.promotionReady),
    staleEntries: activeRules.filter(rule => rule.stale),
  }
}

function hasWaiverTrailer(commit) {
  return extractCommitWaivers([{ sha: commit.sha || '000000000000', body: commit.body || '' }]).length > 0
}

function nonWhitespaceLength(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

function isSpecDocPath(filePath) {
  return /^specs\/.+\.md$/i.test(String(filePath ?? '').replace(/\\/g, '/').replace(/^\.\//, ''))
}

/**
 * 纯函数：从按时间升序排列的提交列表中提取返修与回归信号。
 * `commits[0 .. reviewStartIndex - 1]` 仅作为 72h 返修链的前置回看窗口，不计入本次复盘区间统计。
 */
export function detectLessonsSignals(commits, options = {}) {
  const reviewStartIndex = Math.max(0, Number(options.reviewStartIndex ?? 0))
  const windowHours = Number(options.windowHours ?? DEFAULT_WINDOW_HOURS)
  const windowSec = windowHours * 3600

  const normalized = (commits || []).map(commit => {
    const files = [...new Set((commit.files || []).filter(Boolean))]
    return {
      sha: commit.sha,
      shortSha: String(commit.sha || '').slice(0, 8),
      timestampSec: Number(commit.timestampSec ?? 0),
      date: commit.date || '',
      subject: String(commit.subject || ''),
      body: String(commit.body || ''),
      pr: commit.pr ?? extractPrNumber(commit.subject),
      files,
      productFiles: files.filter(isProductCodePath),
      testFiles: files.filter(isTestFilePath),
      hasSpecWaiver: Boolean(commit.hasSpecWaiver),
    }
  })

  const inWindow = normalized.slice(reviewStartIndex)
  const reverts = []
  const reworkChains = []
  const untestedFixes = []
  const hotspotMap = new Map()
  let fixCommitCount = 0

  for (let idx = reviewStartIndex; idx < normalized.length; idx++) {
    const commit = normalized[idx]
    const revert = isRevertSubject(commit.subject)
    const fixLike = isFixLikeSubject(commit.subject)

    if (revert) {
      reverts.push({
        sha: commit.shortSha,
        fullSha: commit.sha,
        date: commit.date,
        pr: commit.pr,
        subject: commit.subject,
        productFiles: commit.productFiles,
      })
    }

    if (!fixLike) continue
    fixCommitCount++

    if (commit.productFiles.length === 0) continue

    if (commit.testFiles.length === 0) {
      const hasTrailer = hasWaiverTrailer(commit)
      const hasSpecWaiver = Boolean(commit.hasSpecWaiver)
      untestedFixes.push({
        sha: commit.shortSha,
        fullSha: commit.sha,
        date: commit.date,
        pr: commit.pr,
        subject: commit.subject,
        productFiles: commit.productFiles,
        hasWaiverTrailer: hasTrailer,
        hasSpecWaiver,
        waived: hasTrailer || hasSpecWaiver,
      })
    }

    for (const file of commit.productFiles) {
      if (!hotspotMap.has(file)) hotspotMap.set(file, new Map())
      const byDay = hotspotMap.get(file)
      if (!byDay.has(commit.date)) byDay.set(commit.date, [])
      byDay.get(commit.date).push({
        sha: commit.shortSha,
        pr: commit.pr,
        subject: commit.subject,
      })
    }

    const productSet = new Set(commit.productFiles)
    const predecessors = []
    for (let j = idx - 1; j >= 0; j--) {
      const prev = normalized[j]
      const deltaSec = commit.timestampSec - prev.timestampSec
      if (deltaSec < 0) continue
      if (deltaSec > windowSec) break
      const overlappingFiles = prev.productFiles.filter(file => productSet.has(file))
      if (overlappingFiles.length > 0) {
        predecessors.push({
          sha: prev.shortSha,
          fullSha: prev.sha,
          date: prev.date,
          pr: prev.pr,
          subject: prev.subject,
          elapsedHours: Number((deltaSec / 3600).toFixed(1)),
          overlappingFiles,
          beforeCursor: j < reviewStartIndex,
        })
      }
    }

    if (predecessors.length > 0) {
      const tightestHours = Math.min(...predecessors.map(item => item.elapsedHours))
      reworkChains.push({
        sha: commit.shortSha,
        fullSha: commit.sha,
        date: commit.date,
        pr: commit.pr,
        subject: commit.subject,
        tightestHours,
        isTight: tightestHours <= TIGHT_REWORK_HOURS,
        predecessors,
      })
    }
  }

  reworkChains.sort((a, b) => a.tightestHours - b.tightestHours || a.date.localeCompare(b.date))

  const multiDayHotspots = []
  for (const [file, byDay] of hotspotMap.entries()) {
    if (byDay.size < 2) continue
    const dates = [...byDay.keys()].sort()
    const hits = dates.flatMap(date => byDay.get(date).map(entry => ({ date, ...entry })))
    multiDayHotspots.push({
      file,
      days: byDay.size,
      commitCount: hits.length,
      dates,
      commits: hits,
    })
  }
  multiDayHotspots.sort((a, b) => b.days - a.days || b.commitCount - a.commitCount || a.file.localeCompare(b.file))

  return {
    totalCommits: inWindow.length,
    fixCommitCount,
    reverts,
    reworkChains,
    tightReworkCount: reworkChains.filter(item => item.isTight).length,
    untestedFixes,
    multiDayHotspots,
  }
}

function runGit(repoRoot, args, extraOptions = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['--no-optional-locks', '--literal-pathspecs', ...args], {
    cwd: repoRoot,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...extraOptions,
  })
}

function readGitBlob(repoRoot, revSpec) {
  try {
    return runGit(repoRoot, ['show', revSpec], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

function commitHasSpecWaiver(repoRoot, commit) {
  const specFiles = (commit.files || []).filter(isSpecDocPath)
  if (!specFiles.length) return false
  for (const rel of specFiles) {
    const afterText = readGitBlob(repoRoot, `${commit.sha}:${rel}`)
    if (!afterText) continue
    const afterSection = extractSpecSection(afterText, NO_REGRESSION_TEST_SECTION)
    if (nonWhitespaceLength(afterSection) < MIN_WAIVER_CHARS) continue
    const beforeText = readGitBlob(repoRoot, `${commit.sha}^:${rel}`)
    const beforeSection = beforeText ? extractSpecSection(beforeText, NO_REGRESSION_TEST_SECTION) : ''
    if (afterSection !== beforeSection) return true
  }
  return false
}

function loadFirstParentCommits(repoRoot, revRange, extraArgs = []) {
  const format = `${RECORD_SEP}%H${FIELD_SEP}%ct${FIELD_SEP}%cs${FIELD_SEP}%s${FIELD_SEP}%b${BODY_END}`
  const stdout = runGit(repoRoot, [
    'log',
    '--first-parent',
    '--reverse',
    '--name-only',
    `-z`,
    `--format=${format}`,
    ...extraArgs,
    revRange,
  ])
  // Note: with -z, file paths after BODY_END are NUL-separated and non-quoted (safe for UTF-8 filenames).
  const records = String(stdout ?? '').split(RECORD_SEP).filter(Boolean)
  const commits = []
  for (const record of records) {
    const bodyEndIndex = record.indexOf(BODY_END)
    if (bodyEndIndex === -1) continue
    const header = record.slice(0, bodyEndIndex)
    const filesBlock = record.slice(bodyEndIndex + 1)
    const parts = header.split(FIELD_SEP)
    if (parts.length < 4) continue
    const [sha, ts, date, subject, ...bodyParts] = parts
    const body = bodyParts.join(FIELD_SEP).trim()
    const files = filesBlock
      .split('\0')
      .map(line => line.replace(/^[\r\n]+|[\r\n]+$/g, ''))
      .filter(Boolean)
    commits.push({
      sha: sha.trim(),
      timestampSec: Number(ts),
      date: date.trim(),
      subject: subject.trim(),
      body,
      files,
    })
  }
  return commits
}

/**
 * 在真实 Git 仓库中分析 reviewed-through..head 的增量事故信号与账本状态。
 */
export function analyzeRepository(options = {}) {
  const startDir = resolve(options.root || process.cwd())
  const repoRoot = runGit(startDir, ['rev-parse', '--show-toplevel']).trim()
  const windowHours = Number(options.windowHours ?? DEFAULT_WINDOW_HOURS)
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new Error(`Invalid windowHours: ${options.windowHours}`)
  }

  const headRef = options.head || 'HEAD'
  const headSha = runGit(repoRoot, ['rev-parse', '--verify', `${headRef}^{commit}`]).trim()
  const headDate = runGit(repoRoot, ['show', '-s', '--format=%cs', headSha]).trim()
  const asOfDate = options.asOfDate || headDate

  const lessonsRel = options.lessonsPath || 'LESSONS.md'
  const lessonsFull = resolve(repoRoot, lessonsRel)
  if (!existsSync(lessonsFull)) {
    throw new Error(`LESSONS.md not found at ${lessonsRel}`)
  }
  const ledger = parseLessonsLedger(readFileSync(lessonsFull, 'utf8'), { asOfDate })

  const sinceRef = options.since || ledger.cursor?.sha
  if (!sinceRef) {
    throw new Error(`Missing --since and no reviewed-through cursor in ${lessonsRel}`)
  }
  const sinceSha = runGit(repoRoot, ['rev-parse', '--verify', `${sinceRef}^{commit}`]).trim()

  const inWindowCommits = loadFirstParentCommits(repoRoot, `${sinceSha}..${headSha}`)
  for (const commit of inWindowCommits) {
    if (isFixLikeSubject(commit.subject) && commit.files.some(isProductCodePath) && !commit.files.some(isTestFilePath)) {
      commit.hasSpecWaiver = commitHasSpecWaiver(repoRoot, commit)
    }
  }

  let lookbackCommits = []
  if (inWindowCommits.length > 0) {
    const earliestTs = Math.min(...inWindowCommits.map(commit => commit.timestampSec))
    const lookbackSinceTs = Math.max(0, earliestTs - Math.ceil(windowHours * 3600))
    lookbackCommits = loadFirstParentCommits(repoRoot, sinceSha, [`--since=@${lookbackSinceTs}`])
  }

  const combined = [...lookbackCommits, ...inWindowCommits]
  const signals = detectLessonsSignals(combined, {
    reviewStartIndex: lookbackCommits.length,
    windowHours,
  })

  const unwaivedUntestedFixes = signals.untestedFixes.filter(item => !item.waived)
  const actionable = (
    signals.reverts.length > 0
    || signals.reworkChains.length > 0
    || unwaivedUntestedFixes.length > 0
    || signals.multiDayHotspots.length > 0
    || ledger.promotionReady.length > 0
    || ledger.staleEntries.length > 0
    || ledger.overBudget
  )

  return {
    range: {
      since: sinceSha,
      sinceShort: sinceSha.slice(0, 8),
      head: headSha,
      headShort: headSha.slice(0, 8),
      headDate,
      cursorSha: ledger.cursor?.sha || null,
      cursorDate: ledger.cursor?.date || null,
    },
    windowHours,
    asOfDate,
    actionable,
    summary: {
      totalCommits: signals.totalCommits,
      fixCommitCount: signals.fixCommitCount,
      revertCount: signals.reverts.length,
      reworkChainCount: signals.reworkChains.length,
      tightReworkCount: signals.tightReworkCount,
      untestedFixCount: signals.untestedFixes.length,
      unwaivedUntestedFixCount: unwaivedUntestedFixes.length,
      multiDayHotspotCount: signals.multiDayHotspots.length,
      promotionReadyCount: ledger.promotionReady.length,
      staleEntryCount: ledger.staleEntries.length,
      ledgerLines: ledger.lines,
      ledgerBytes: ledger.bytes,
      overBudget: ledger.overBudget,
    },
    ledger,
    signals,
  }
}

function formatCommitRef(item) {
  const prTag = item.pr ? ` (#${item.pr})` : ''
  const subject = item.pr && item.subject.includes(`(#${item.pr})`)
    ? item.subject
    : `${item.subject}${prTag}`
  return `\`${item.sha}\` (${item.date}) ${subject}`
}

function formatFilePreview(files, limit = 4) {
  if (!files.length) return ''
  const shown = files.slice(0, limit).map(file => `\`${file}\``).join(', ')
  return files.length > limit ? `${shown} 等 ${files.length} 个文件` : shown
}

export function formatMarkdownReport(report) {
  const { range, windowHours, asOfDate, actionable, summary, ledger, signals } = report
  const out = []

  out.push(`## 事故账本增量信号摘要（\`${range.sinceShort}..${range.headShort}\`）`)
  out.push('')
  out.push(`- 扫描范围：\`${range.sinceShort}\` → \`${range.headShort}\`（基准日期 \`${asOfDate}\`，返修窗口 \`${windowHours}h\`）`)
  out.push(`- 账本游标：${range.cursorSha ? `\`${range.cursorSha.slice(0, 8)}\`（${range.cursorDate}）` : '缺失'} · 当前体积 \`${ledger.lines}/${ledger.maxLines} 行\`、\`${ledger.bytes}/${ledger.maxBytes} B\``)
  out.push(`- 判定结论：**${actionable ? '存在待核查信号（建议安排增量复盘）' : '无待处理复盘信号'}**`)
  out.push('')
  out.push('| 指标 | 数量 |')
  out.push('|---|---|')
  out.push(`| 主干提交 / fix 提交 | ${summary.totalCommits} / ${summary.fixCommitCount} |`)
  out.push(`| 回滚提交（Revert） | ${summary.revertCount} |`)
  out.push(`| ${windowHours}h 返修链（其中 ≤ ${TIGHT_REWORK_HOURS}h） | ${summary.reworkChainCount}（${summary.tightReworkCount}） |`)
  out.push(`| 无回归测试的 fix（未豁免） | ${summary.untestedFixCount}（${summary.unwaivedUntestedFixCount}） |`)
  out.push(`| 跨日连修热点产品文件（≥ 2 天） | ${summary.multiDayHotspotCount} |`)
  out.push(`| 账本待晋升（seen ≥ ${PROMOTION_SEEN_THRESHOLD}） / 超 ${STALE_DAYS_THRESHOLD} 天未复发 | ${summary.promotionReadyCount} / ${summary.staleEntryCount} |`)

  if (!actionable) {
    out.push('')
    out.push('本次扫描未检出需要人工复盘的异常信号或账本代谢待办。')
    return `${out.join('\n')}\n`
  }

  if (signals.reverts.length > 0) {
    out.push('')
    out.push('### 1. 回滚提交（优先核查「本不该合」）')
    for (const item of signals.reverts) {
      out.push(`- ${formatCommitRef(item)}${item.productFiles.length ? ` — ${formatFilePreview(item.productFiles)}` : ''}`)
    }
  }

  if (signals.reworkChains.length > 0) {
    out.push('')
    out.push(`### 2. ${windowHours}h 返修链（按最短间隔排序）`)
    for (const chain of signals.reworkChains.slice(0, 15)) {
      const badge = chain.isTight ? `\`≤${TIGHT_REWORK_HOURS}h\`` : `\`${chain.tightestHours}h\``
      out.push(`- ${badge} ${formatCommitRef(chain)}`)
      for (const prev of chain.predecessors.slice(0, 3)) {
        const crossCursor = prev.beforeCursor ? ' · 跨游标前序' : ''
        out.push(`  - 前序（-${prev.elapsedHours}h${crossCursor}）：${formatCommitRef(prev)} — 重叠 ${formatFilePreview(prev.overlappingFiles, 3)}`)
      }
      if (chain.predecessors.length > 3) {
        out.push(`  - 其余 ${chain.predecessors.length - 3} 个前序重叠提交已省略`)
      }
    }
    if (signals.reworkChains.length > 15) {
      out.push(`- 其余 ${signals.reworkChains.length - 15} 条返修链已省略（可用 \`--json\` 查看全量）`)
    }
  }

  if (signals.untestedFixes.length > 0) {
    out.push('')
    out.push('### 3. 无回归测试的 `fix:` 提交')
    for (const item of signals.untestedFixes) {
      const waiver = item.hasWaiverTrailer
        ? `（含 \`${NO_REGRESSION_TEST_TRAILER}:\` trailer）`
        : item.hasSpecWaiver
          ? `（含 \`specs/*.md\`「${NO_REGRESSION_TEST_SECTION}」）`
          : '（未见有效豁免声明）'
      out.push(`- ${formatCommitRef(item)} ${waiver} — ${formatFilePreview(item.productFiles)}`)
    }
  }

  if (signals.multiDayHotspots.length > 0) {
    out.push('')
    out.push('### 4. 跨日连修热点产品文件（≥ 2 天）')
    for (const spot of signals.multiDayHotspots.slice(0, 12)) {
      out.push(`- \`${spot.file}\`（${spot.days} 天 / ${spot.commitCount} 次 fix：${spot.dates.join('、')}）`)
    }
    if (signals.multiDayHotspots.length > 12) {
      out.push(`- 其余 ${signals.multiDayHotspots.length - 12} 个热点文件已省略`)
    }
  }

  if (ledger.promotionReady.length > 0 || ledger.staleEntries.length > 0 || ledger.overBudget) {
    out.push('')
    out.push('### 5. 账本代谢提醒')
    if (ledger.overBudget) {
      out.push(`- **超出预算**：当前 \`${ledger.lines} 行 / ${ledger.bytes} B\`（上限 \`${ledger.maxLines} 行 / ${ledger.maxBytes} B\`），须先转门禁或压缩。`)
    }
    for (const rule of ledger.promotionReady) {
      out.push(`- **待晋升（seen ${rule.seen}）**：${rule.title}（最近 ${rule.lastSeenDate || '未知'}）— 评估转自动门禁或压成 1–2 句晋升 \`AGENTS.md\` / \`docs/subsystems.md\``)
    }
    for (const rule of ledger.staleEntries) {
      out.push(`- **可归档（seen ${rule.seen}，已 ${rule.daysSinceLastSeen} 天未复发）**：${rule.title}（最近 ${rule.lastSeenDate}）`)
    }
  }

  out.push('')
  out.push('### 复盘核对清单')
  out.push('- [ ] 逐条核对高紧度返修链与回滚 PR 的真实 diff（区分计划内叠改与真实漏测/返修）')
  out.push('- [ ] 能写成脚本/CI 门禁的共性教训优先转门禁，无法机检的更新 `LESSONS.md` 活跃条目与 `seen` 计数')
  out.push(`- [ ] 将 \`LESSONS.md\` 首行游标推进至 \`<!-- reviewed-through: ${range.head} (${range.headDate}) -->\` 并通过 \`chore(lessons):\` PR 合入`)
  out.push('')

  return `${out.join('\n')}\n`
}

export function parseCliArgs(argv) {
  const opts = {
    root: null,
    since: null,
    head: 'HEAD',
    windowHours: DEFAULT_WINDOW_HOURS,
    asOfDate: null,
    lessonsPath: 'LESSONS.md',
    json: false,
    markdown: false,
    output: null,
    failOnSignals: false,
  }
  const takeValue = (flag, index) => {
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${flag}`)
    return argv[index + 1]
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '--since') opts.since = takeValue(arg, i++)
    else if (arg === '--head') opts.head = takeValue(arg, i++)
    else if (arg === '--window-hours') opts.windowHours = Number(takeValue(arg, i++))
    else if (arg === '--as-of') opts.asOfDate = takeValue(arg, i++)
    else if (arg === '--lessons') opts.lessonsPath = takeValue(arg, i++)
    else if (arg === '--json') opts.json = true
    else if (arg === '--markdown') opts.markdown = true
    else if (arg === '--output') opts.output = takeValue(arg, i++)
    else if (arg === '--fail-on-signals') opts.failOnSignals = true
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    else positional.push(arg)
  }
  if (positional[0]) opts.root = positional[0]
  return opts
}

function main() {
  try {
    const opts = parseCliArgs(process.argv.slice(2))
    const report = analyzeRepository(opts)
    const rendered = opts.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatMarkdownReport(report)

    if (opts.output) {
      const target = resolve(opts.output)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, rendered, 'utf8')
    }
    process.stdout.write(rendered)

    if (opts.failOnSignals && report.actionable) {
      process.exit(2)
    }
  } catch (error) {
    process.stderr.write(`❌ analyze-lessons-signals 失败：${error.message}\n`)
    process.exit(1)
  }
}

const isEntrypoint = Boolean(process.argv[1]) && (() => {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
  } catch {
    return pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  }
})()

if (isEntrypoint) main()
