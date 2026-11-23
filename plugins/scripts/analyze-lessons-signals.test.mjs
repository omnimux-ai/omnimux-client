import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROMOTION_SEEN_THRESHOLD,
  STALE_DAYS_THRESHOLD,
  analyzeRepository,
  detectLessonsSignals,
  extractPrNumber,
  formatMarkdownReport,
  isFixLikeSubject,
  isRevertSubject,
  parseCliArgs,
  parseLessonsLedger,
} from './analyze-lessons-signals.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const SCRIPT_PATH = join(HERE, 'analyze-lessons-signals.mjs')

const CLEAN_GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
)

function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    env: { ...CLEAN_GIT_ENV, GIT_OPTIONAL_LOCKS: '0', ...extraEnv },
    encoding: 'utf8',
  }).trim()
}

function writeRel(root, relPath, content) {
  const full = join(root, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

function commitAt(root, isoTimestamp, subject, body = '') {
  git(root, ['add', '-A'])
  const args = ['commit', '-q', '-m', subject]
  if (body) args.push('-m', body)
  git(root, args, {
    GIT_AUTHOR_DATE: isoTimestamp,
    GIT_COMMITTER_DATE: isoTimestamp,
  })
  return git(root, ['rev-parse', 'HEAD'])
}

function withFixtureRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-lessons-signals-'))
  try {
    git(dir, ['init', '-q', '-b', 'main'])
    git(dir, ['config', 'user.email', 'test@omnimux.local'])
    git(dir, ['config', 'user.name', 'Test User'])
    git(dir, ['config', 'commit.gpgsign', 'false'])
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('主题识别覆盖 revert、中英文 fix 与 PR 号提取', () => {
  assert.equal(isRevertSubject('Revert "feat(canvas): enable auto switch (#99)"'), true)
  assert.equal(isRevertSubject('revert(hub): rollback broken route'), true)
  assert.equal(isRevertSubject('Revert #142'), true)
  assert.equal(isRevertSubject('feat(canvas): add revert button in editor'), false)

  assert.equal(isFixLikeSubject('fix(hub): guard empty payload (#107)'), true)
  assert.equal(isFixLikeSubject('修复画布提示词引用 (#149)'), true)
  assert.equal(isFixLikeSubject('Revert "feat: bad change"'), true)
  assert.equal(isFixLikeSubject('feat(market): add filter (#200)'), false)

  assert.equal(extractPrNumber('fix(clip): 修复欢迎页 (#174) (#177)'), 177)
  assert.equal(extractPrNumber('chore: no pr ref'), null)
})

test('parseLessonsLedger 精准解析游标、预算、待晋升与超 30 天未复发条目', () => {
  const sample = [
    '<!-- reviewed-through: 08498ae0734cb860163229c8da48f3da7b33eb4f (2026-11-18) -->',
    '# Lessons',
    '',
    '## 活跃规则',
    '',
    '### 验证',
    '- **规则 A：达到晋升阈值**（`seen 3` · 最近 `2026-11-22`）',
    '  - 说明：跨 3 天复现',
    '- **规则 B：超过 30 天未复发**（`seen 1` · 最近 `2026-10-10`）',
    '  - 说明：长期静止',
    '- **规则 C：seen 2 但超过 30 天仍不标过期**（`seen 2` · 最近 `2026-10-01`）',
    '- **规则 D：30 天边界内正常活跃**（`seen 1` · 最近 `2026-10-25`）',
    '',
    '## 已毕业（已转规则或门禁）',
    '- **已毕业条目不应进入活跃统计**（`seen 9` · 最近 `2025-01-01`）',
    '',
  ].join('\n')

  const parsed = parseLessonsLedger(sample, { asOfDate: '2026-11-23' })
  assert.deepEqual(parsed.cursor, {
    sha: '08498ae0734cb860163229c8da48f3da7b33eb4f',
    date: '2026-11-18',
  })
  assert.equal(parsed.overBudget, false)
  assert.equal(parsed.activeRules.length, 4)
  assert.equal(PROMOTION_SEEN_THRESHOLD, 3)
  assert.equal(STALE_DAYS_THRESHOLD, 30)
  assert.deepEqual(parsed.promotionReady.map(r => r.title), ['规则 A：达到晋升阈值'])
  assert.deepEqual(parsed.staleEntries.map(r => r.title), ['规则 B：超过 30 天未复发'])
  assert.equal(parsed.staleEntries[0].daysSinceLastSeen, 44)
})

test('detectLessonsSignals 精准识别跨游标 72h 返修链、超时不误报与跨日热点文件', () => {
  const baseTs = Date.parse('2026-11-18T10:00:00Z') / 1000
  const hour = 3600

  const commits = [
    // index 0: 游标前 100h（超 72h，不应关联）
    {
      sha: 'aaaa000100000000',
      timestampSec: baseTs - 100 * hour,
      date: '2026-11-14',
      subject: 'feat(hub): old feature (#10)',
      body: '',
      files: ['plugins/plugins/omnimux/src/old.js'],
    },
    // index 1: 游标前 12h（在 72h 回看窗口内，应被跨游标关联）
    {
      sha: 'bbbb000200000000',
      timestampSec: baseTs - 12 * hour,
      date: '2026-11-17',
      subject: 'feat(canvas): collapse groups (#100)',
      body: '',
      files: ['plugins/plugins/omnimux-workflow/src/group.ts'],
    },
    // index 2 (reviewStartIndex): 窗口内 fix，与 index 1 重叠（12h <= 24h）
    {
      sha: 'cccc000300000000',
      timestampSec: baseTs,
      date: '2026-11-18',
      subject: 'fix(canvas): restore group bounds (#112)',
      body: '',
      files: [
        'plugins/plugins/omnimux-workflow/src/group.ts',
        'plugins/plugins/omnimux-workflow/src/group.test.ts',
      ],
    },
    // index 3: 同一天再修 old.js（距 index 0 达 101h > 72h，且有测试，不形成返修链，也仅 1 天不算跨日热点）
    {
      sha: 'dddd000400000000',
      timestampSec: baseTs + 1 * hour,
      date: '2026-11-18',
      subject: 'fix(hub): guard old edge case (#113)',
      body: '',
      files: [
        'plugins/plugins/omnimux/src/old.js',
        'plugins/plugins/omnimux/src/old.test.js',
      ],
    },
    // index 4: 次日再修 group.ts（形成跨 2 天热点文件，且与 index 2 构成 26h 返修链）
    {
      sha: 'eeee000500000000',
      timestampSec: baseTs + 26 * hour,
      date: '2026-11-19',
      subject: 'fix(canvas): keep group bounds on undo (#116)',
      body: '',
      files: [
        'plugins/plugins/omnimux-workflow/src/group.ts',
        'plugins/plugins/omnimux-workflow/src/group.test.ts',
      ],
    },
    // index 5: 仅改文档的 fix，不应计入无测试 fix 或热点文件
    {
      sha: 'ffff000600000000',
      timestampSec: baseTs + 27 * hour,
      date: '2026-11-19',
      subject: 'fix(docs): fix broken badge (#192)',
      body: '',
      files: ['README.md'],
    },
  ]

  const signals = detectLessonsSignals(commits, { reviewStartIndex: 2, windowHours: 72 })
  assert.equal(signals.totalCommits, 4)
  assert.equal(signals.fixCommitCount, 4)
  assert.equal(signals.reverts.length, 0)
  assert.equal(signals.untestedFixes.length, 0)
  assert.equal(signals.reworkChains.length, 2)
  assert.equal(signals.tightReworkCount, 1)

  const tight = signals.reworkChains[0]
  assert.equal(tight.sha, 'cccc0003')
  assert.equal(tight.tightestHours, 12)
  assert.equal(tight.isTight, true)
  assert.equal(tight.predecessors[0].sha, 'bbbb0002')
  assert.equal(tight.predecessors[0].beforeCursor, true)

  const second = signals.reworkChains[1]
  assert.equal(second.sha, 'eeee0005')
  assert.equal(second.tightestHours, 26)
  assert.equal(second.isTight, false)

  assert.equal(signals.multiDayHotspots.length, 1)
  assert.equal(signals.multiDayHotspots[0].file, 'plugins/plugins/omnimux-workflow/src/group.ts')
  assert.deepEqual(signals.multiDayHotspots[0].dates, ['2026-11-18', '2026-11-19'])
})

test('真实临时仓库集成：检测回滚、跨游标返修、无测试 fix 及 trailer/spec 豁免', () => {
  withFixtureRepo(root => {
    writeRel(root, 'plugins/plugins/demo/src/app.js', 'export const v = 1\n')
    writeRel(root, 'plugins/plugins/demo/src/waived-trailer.js', 'export const a = 1\n')
    writeRel(root, 'plugins/plugins/demo/src/waived-spec.js', 'export const b = 1\n')
    writeRel(root, 'plugins/plugins/demo/src/untested.js', 'export const c = 1\n')
    // 初始提交放在 8 天前（超过 72h 回看窗口），确保只有近期改动的 app.js 构成返修链
    const baseSha = commitAt(root, '2026-11-10T08:00:00Z', 'feat(demo): initial (#1)')

    writeRel(root, 'LESSONS.md', [
      `<!-- reviewed-through: ${baseSha} (2026-11-18) -->`,
      '# Lessons',
      '',
      '## 活跃规则',
      '- **普通活跃规则**（`seen 1` · 最近 `2026-11-18`）',
      '',
    ].join('\n'))
    const cursorSha = commitAt(root, '2026-11-18T09:00:00Z', 'chore(lessons): set cursor')
    writeRel(root, 'LESSONS.md', [
      `<!-- reviewed-through: ${cursorSha} (2026-11-18) -->`,
      '# Lessons',
      '',
      '## 活跃规则',
      '- **普通活跃规则**（`seen 1` · 最近 `2026-11-18`）',
      '',
    ].join('\n'))
    // 紧邻游标前 2h 改一次 app.js 并推进游标到这个提交
    writeRel(root, 'plugins/plugins/demo/src/app.js', 'export const v = 2\n')
    const reviewedSha = commitAt(root, '2026-11-18T10:00:00Z', 'feat(demo): update app (#2)')
    writeRel(root, 'LESSONS.md', [
      `<!-- reviewed-through: ${reviewedSha} (2026-11-18) -->`,
      '# Lessons',
      '',
      '## 活跃规则',
      '- **普通活跃规则**（`seen 1` · 最近 `2026-11-18`）',
      '',
    ].join('\n'))
    commitAt(root, '2026-11-18T11:00:00Z', 'chore(lessons): record cursor')

    // 1. 窗口内无测试 fix（未豁免）+ 跨游标 4h 返修 app.js
    writeRel(root, 'plugins/plugins/demo/src/app.js', 'export const v = 3\n')
    commitAt(root, '2026-11-18T14:00:00Z', 'fix(demo): quick hotfix without test (#3)')

    // 2. 含有效 No-Regression-Test trailer 的 fix（应记入 untestedFixes 但 waived=true）
    writeRel(root, 'plugins/plugins/demo/src/waived-trailer.js', 'export const a = 2\n')
    commitAt(
      root,
      '2026-11-19T10:00:00Z',
      'fix(demo): trailer waived (#4)',
      'No-Regression-Test: 仅调整签名证书环境参数，已在真机完成人工签名与启动验证。',
    )

    // 3. 含过短 trailer 的 fix（< 20 非空白字符，不应算豁免）
    writeRel(root, 'plugins/plugins/demo/src/untested.js', 'export const c = 2\n')
    commitAt(
      root,
      '2026-11-19T11:00:00Z',
      'fix(demo): short trailer should not waive (#5)',
      'No-Regression-Test: 太短不算',
    )

    // 4. 含已提交 specs/*.md 无回归测试声明的 fix（应记 waived=true）
    writeRel(root, 'plugins/plugins/demo/src/waived-spec.js', 'export const b = 2\n')
    writeRel(root, 'specs/demo-waiver.spec.md', [
      '# Demo',
      '',
      '## 无回归测试声明',
      '本次修复仅涉及原生操作系统权限弹窗，已在隔离真机逐项复测通过。',
      '',
    ].join('\n'))
    commitAt(root, '2026-11-19T12:00:00Z', 'fix(demo): spec waived (#6)')

    // 5. Revert 提交
    writeRel(root, 'plugins/plugins/demo/src/app.js', 'export const v = 2\n')
    commitAt(root, '2026-11-20T10:00:00Z', 'Revert "fix(demo): quick hotfix without test (#3)" (#7)')

    const report = analyzeRepository({ root, asOfDate: '2026-11-20' })
    assert.equal(report.actionable, true)
    assert.equal(report.summary.revertCount, 1)
    assert.equal(report.summary.reworkChainCount, 2)
    assert.equal(report.summary.tightReworkCount, 1)
    assert.equal(report.summary.untestedFixCount, 5)
    assert.equal(report.summary.unwaivedUntestedFixCount, 3)

    const byPr = new Map(report.signals.untestedFixes.map(item => [item.pr, item]))
    assert.equal(byPr.get(3).waived, false)
    assert.equal(byPr.get(4).hasWaiverTrailer, true)
    assert.equal(byPr.get(4).waived, true)
    assert.equal(byPr.get(5).waived, false)
    assert.equal(byPr.get(6).hasSpecWaiver, true)
    assert.equal(byPr.get(6).waived, true)

    assert.equal(report.signals.multiDayHotspots.length, 1)
    assert.equal(report.signals.multiDayHotspots[0].file, 'plugins/plugins/demo/src/app.js')

    const md = formatMarkdownReport(report)
    assert.match(md, /### 1\. 回滚提交/)
    assert.match(md, /### 2\. 72h 返修链/)
    assert.match(md, /### 3\. 无回归测试的 `fix:` 提交/)
    assert.match(md, /### 4\. 跨日连修热点产品文件/)
    assert.match(md, /reviewed-through:/)
  })
})

test('无信号仓库返回 actionable=false 且 CLI --fail-on-signals 退出码准确', () => {
  withFixtureRepo(root => {
    writeRel(root, 'README.md', '# Demo\n')
    const c1 = commitAt(root, '2026-11-20T10:00:00Z', 'chore: init')
    writeRel(root, 'LESSONS.md', [
      `<!-- reviewed-through: ${c1} (2026-11-20) -->`,
      '# Lessons',
      '',
      '## 活跃规则',
      '- **规则 1**（`seen 1` · 最近 `2026-11-20`）',
      '',
    ].join('\n'))
    const c2 = commitAt(root, '2026-11-20T11:00:00Z', 'chore(lessons): track cursor')
    writeRel(root, 'LESSONS.md', [
      `<!-- reviewed-through: ${c2} (2026-11-20) -->`,
      '# Lessons',
      '',
      '## 活跃规则',
      '- **规则 1**（`seen 1` · 最近 `2026-11-20`）',
      '',
    ].join('\n'))
    commitAt(root, '2026-11-21T10:00:00Z', 'docs: update readme')

    const cleanRes = spawnSync(
      process.execPath,
      [SCRIPT_PATH, root, '--as-of', '2026-11-23', '--json', '--fail-on-signals'],
      { encoding: 'utf8' },
    )
    assert.equal(cleanRes.status, 0, cleanRes.stderr)
    const cleanJson = JSON.parse(cleanRes.stdout)
    assert.equal(cleanJson.actionable, false)

    // 推进基准日至 40 天后，触发 stale 代谢信号，--fail-on-signals 必须返回退出码 2
    const staleRes = spawnSync(
      process.execPath,
      [SCRIPT_PATH, root, '--as-of', '2026-12-30', '--json', '--fail-on-signals'],
      { encoding: 'utf8' },
    )
    assert.equal(staleRes.status, 2, staleRes.stderr)
    const staleJson = JSON.parse(staleRes.stdout)
    assert.equal(staleJson.actionable, true)
    assert.equal(staleJson.summary.staleEntryCount, 1)
  })
})

test('parseCliArgs 校验未知参数与缺值参数', () => {
  const parsed = parseCliArgs(['.', '--since', 'abc1234', '--window-hours', '48', '--json', '--fail-on-signals'])
  assert.equal(parsed.root, '.')
  assert.equal(parsed.since, 'abc1234')
  assert.equal(parsed.windowHours, 48)
  assert.equal(parsed.json, true)
  assert.equal(parsed.failOnSignals, true)

  assert.throws(() => parseCliArgs(['--unknown']), /Unknown option/)
  assert.throws(() => parseCliArgs(['--since']), /Missing value/)
})

test('工作流元门禁：quality-gate.yml 与 lessons-review-digest.yml 真实接入信号脚本与单测', () => {
  const qg = readFileSync(join(REPO_ROOT, '.github/workflows/quality-gate.yml'), 'utf8')
  assert.match(qg, /node --check scripts\/analyze-lessons-signals\.mjs/)
  assert.match(qg, /node --test scripts\/analyze-lessons-signals\.test\.mjs/)

  const digest = readFileSync(join(REPO_ROOT, '.github/workflows/lessons-review-digest.yml'), 'utf8')
  assert.match(digest, /schedule:/)
  assert.match(digest, /workflow_dispatch:/)
  assert.match(digest, /node plugins\/scripts\/analyze-lessons-signals\.mjs/)
  assert.match(digest, /steps\.analyze\.outputs\.actionable == 'true'/)
  assert.match(digest, /lessons-review/)
})
