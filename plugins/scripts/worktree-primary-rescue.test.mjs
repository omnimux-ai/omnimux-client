/**
 * worktree.sh rescue-primary 回归测试：
 * - 原子迁出主检出阻断性脏改动（修改、暂存、部分暂存、删除、重命名、git rm --cached、
 *   符号链接、可执行位、中文/空格路径、阻断性未跟踪文件）到独立工作树并双校验一致；
 * - 保留合法草稿目录（specs/、plugins/docs/evidence/ 等）与子模块漂移，不误删；
 * - 兼容落后主干且同文件同位置冲突（零冲突基于 primary HEAD 建 rescue 工作树，主干顺滑 ff-only）；
 * - 类型 0 预检提示（与 origin/main 逐字一致时输出 TRIAGE_HINT=type-0-identical-to-origin-main）；
 * - 前置硬拒绝（非默认分支、领先未推送提交、合并冲突/MERGE_HEAD、破坏性参数、嵌套 git 目录）；
 * - 兼容 macOS /bin/bash 3.2 与无 sync-main.sh 裸拷贝，并与 ship 主检出洁净门禁闭环衔接。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseKv(stdout) {
  const out = {}
  const files = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m) continue
    if (m[1] === 'RESCUE_FILE') files.push(m[2])
    else out[m[1]] = m[2]
  }
  out.RESCUE_FILES_LIST = files
  return out
}

function createFixture(t, { withContract = true, scriptLayout = 'plugins/scripts' } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'omnimux-primary-rescue-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))

  const repo = join(fixture, 'repo')
  const remote = join(fixture, 'origin.git')
  const bin = join(fixture, 'bin')
  mkdirSync(repo, { recursive: true })
  mkdirSync(bin, { recursive: true })

  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const gitAt = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  git('init', '--bare', '-b', 'main', remote)
  git('init', '-b', 'main')
  git('config', 'user.name', 'rescue-test')
  git('config', 'user.email', 'rescue@example.test')

  const scriptsDir = join(repo, scriptLayout)
  mkdirSync(scriptsDir, { recursive: true })
  copyFileSync(join(root, 'scripts/worktree.sh'), join(scriptsDir, 'worktree.sh'))
  if (withContract) {
    copyFileSync(join(root, 'scripts/sync-main.sh'), join(scriptsDir, 'sync-main.sh'))
  }
  writeFileSync(join(scriptsDir, 'sync-to-app.sh'), '#!/bin/sh\necho "SYNC_CALLED: $*" >> sync_receipt.txt\n', { mode: 0o755 })
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\nignored.log\n')
  writeFileSync(join(repo, 'AGENTS.md'), '# Rules\nline-1\nline-2\n')
  writeFileSync(join(repo, 'keep.txt'), 'original-keep\n')
  writeFileSync(join(repo, 'to-delete.txt'), 'delete-me\n')
  writeFileSync(join(repo, 'to-rename.txt'), 'rename-me\n')
  writeFileSync(join(repo, 'cached-rm.txt'), 'cached-rm-body\n')
  writeFileSync(join(repo, 'exec.sh'), '#!/bin/sh\necho v1\n', { mode: 0o644 })
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'docs/tracked-doc.md'), '# tracked doc\n')
  writeFileSync(join(repo, 'chain-a.txt'), 'content-a\n')
  writeFileSync(join(repo, 'chain-b.txt'), 'content-b\n')
  mkdirSync(join(repo, 'swap-dir'), { recursive: true })
  writeFileSync(join(repo, 'swap-dir/sub.txt'), 'inside-dir\n')
  writeFileSync(join(repo, 'swap-file'), 'was-a-file\n')
  mkdirSync(join(repo, 'src/[id]'), { recursive: true })
  writeFileSync(join(repo, 'src/[id]/page.js'), 'export const id = 1\n')
  mkdirSync(join(repo, 'src/i'), { recursive: true })
  writeFileSync(join(repo, 'src/i/page.js'), 'export const i = 1\n')

  git('add', '.')
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'seed')
  git('remote', 'add', 'origin', remote)
  git('push', '-u', 'origin', 'HEAD')

  const pushRemoteCommit = (files, message = 'remote update') => {
    const pusher = join(fixture, `pusher-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`)
    execFileSync('git', ['clone', '--branch', 'main', remote, pusher], { stdio: 'ignore' })
    gitAt(pusher, 'config', 'user.name', 'remote-bot')
    gitAt(pusher, 'config', 'user.email', 'remote@example.test')
    for (const [rel, content] of Object.entries(files)) {
      const full = join(pusher, rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    gitAt(pusher, 'add', '.')
    gitAt(pusher, '-c', 'commit.gpgsign=false', 'commit', '-m', message)
    gitAt(pusher, 'push', 'origin', 'main')
    const head = gitAt(pusher, 'rev-parse', 'HEAD')
    rmSync(pusher, { recursive: true, force: true })
    return head
  }

  const rescue = (args = [], { bashPath = 'bash', cwd = repo, extraEnv = {}, scriptPath = null } = {}) =>
    spawnSync(bashPath, [scriptPath || join(repo, scriptLayout, 'worktree.sh'), 'rescue-primary', ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        OMNIMUX_DEV_SNAPSHOT: join(fixture, 'absent-dev'),
        OMNIMUX_SAG_INDEX: '0',
        ...extraEnv,
      },
    })

  return { fixture, repo, remote, bin, scriptLayout, git, gitAt, pushRemoteCommit, rescue }
}

test('rescue-primary atomically moves tracked and blocking untracked changes, preserves drafts, and ff-syncs main', (t) => {
  const f = createFixture(t)
  const remoteHead = f.pushRemoteCommit({ 'remote-only.txt': 'from-remote\n' }, 'feat: remote change')

  // Dirty tracked + blocking untracked (including spaces & CJK) + allowed drafts
  writeFileSync(join(f.repo, 'AGENTS.md'), '# Rules\nline-1\nline-2\nlocal-addition\n')
  mkdirSync(join(f.repo, 'plugins/plugins/omnimux'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/plugins/omnimux/stray 草稿.js'), 'export const stray = 42\n')
  mkdirSync(join(f.repo, 'specs'), { recursive: true })
  writeFileSync(join(f.repo, 'specs/local-draft.md'), '# allowed draft\n')
  mkdirSync(join(f.repo, 'plugins/docs/evidence'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/docs/evidence/report.json'), '{"ok":true}\n')

  const res = f.rescue(['--task', 'rescue-mixed'])
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)

  const kv = parseKv(res.stdout)
  assert.equal(kv.RESCUE_STATUS, 'rescued')
  assert.equal(kv.RESCUE_WORKTREE, '.worktrees/rescue-mixed')
  assert.equal(kv.RESCUE_BRANCH, 'chore/rescue-mixed')
  assert.equal(kv.PRIMARY_HEAD, remoteHead)
  assert.equal(kv.TRIAGE_HINT, 'inspect-required')
  assert.deepEqual(kv.RESCUE_FILES_LIST, ['AGENTS.md', 'plugins/plugins/omnimux/stray 草稿.js'])

  // Primary checkout is clean for tracked/blocking paths, synced to remote, and keeps allowed drafts
  assert.equal(f.git('rev-parse', 'HEAD'), remoteHead)
  assert.equal(f.git('status', '--porcelain', '--untracked-files=no'), '')
  assert.equal(existsSync(join(f.repo, 'plugins/plugins/omnimux/stray 草稿.js')), false)
  assert.equal(existsSync(join(f.repo, 'remote-only.txt')), true)
  assert.equal(readFileSync(join(f.repo, 'specs/local-draft.md'), 'utf8'), '# allowed draft\n')
  assert.equal(readFileSync(join(f.repo, 'plugins/docs/evidence/report.json'), 'utf8'), '{"ok":true}\n')

  // Rescued worktree preserves exact bytes and is clean on its rescue branch
  const wt = join(f.repo, '.worktrees/rescue-mixed')
  assert.equal(f.gitAt(wt, 'status', '--porcelain'), '')
  assert.equal(readFileSync(join(wt, 'AGENTS.md'), 'utf8'), '# Rules\nline-1\nline-2\nlocal-addition\n')
  assert.equal(readFileSync(join(wt, 'plugins/plugins/omnimux/stray 草稿.js'), 'utf8'), 'export const stray = 42\n')
})

test('rescue-primary marks TRIAGE_HINT=type-0-identical-to-origin-main when rescued files match origin/main byte-for-byte', (t) => {
  const f = createFixture(t)
  const mergedContent = '# Rules\nline-1\nline-2\nrule-merged-upstream\n'
  const remoteHead = f.pushRemoteCommit({ 'AGENTS.md': mergedContent }, 'docs: upstream merged rule')

  // Primary checkout still on older HEAD with the exact same local edit
  writeFileSync(join(f.repo, 'AGENTS.md'), mergedContent)

  const res = f.rescue(['--task', 'rescue-type0'])
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)

  const kv = parseKv(res.stdout)
  assert.equal(kv.RESCUE_STATUS, 'rescued')
  assert.equal(kv.PRIMARY_HEAD, remoteHead)
  assert.equal(kv.TRIAGE_HINT, 'type-0-identical-to-origin-main')
  assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), mergedContent)
})

test('rescue-primary handles conflicting stale draft vs newer origin/main without conflict failure', (t) => {
  const f = createFixture(t)
  const remoteHead = f.pushRemoteCommit(
    { 'AGENTS.md': '# Rules\nline-1\nline-2\nremote-refined-wording\n' },
    'docs: refined rule wording',
  )

  // Local stale draft modifies the same line differently from origin/main
  writeFileSync(join(f.repo, 'AGENTS.md'), '# Rules\nline-1\nline-2\nlocal-stale-draft\n')

  const res = f.rescue(['--task', 'rescue-conflict-stale'])
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)

  const kv = parseKv(res.stdout)
  assert.equal(kv.RESCUE_STATUS, 'rescued')
  assert.equal(kv.PRIMARY_HEAD, remoteHead)
  assert.equal(kv.TRIAGE_HINT, 'inspect-required')
  assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), '# Rules\nline-1\nline-2\nremote-refined-wording\n')
  assert.equal(
    readFileSync(join(f.repo, '.worktrees/rescue-conflict-stale/AGENTS.md'), 'utf8'),
    '# Rules\nline-1\nline-2\nlocal-stale-draft\n',
  )
})

test('rescue-primary preserves partial staging, deletions, renames, git rm --cached, exec bit, and symlinks losslessly', (t) => {
  const f = createFixture(t)

  // Partial staging on keep.txt: staged v2, working-tree v3
  writeFileSync(join(f.repo, 'keep.txt'), 'staged-v2\n')
  f.git('add', 'keep.txt')
  writeFileSync(join(f.repo, 'keep.txt'), 'working-v3\n')

  // Deletion, rename, git rm --cached, executable mode, symlink, staged new file
  rmSync(join(f.repo, 'to-delete.txt'))
  f.git('mv', 'to-rename.txt', 'renamed.txt')
  f.git('rm', '--cached', 'cached-rm.txt')
  chmodSync(join(f.repo, 'exec.sh'), 0o755)
  symlinkSync('keep.txt', join(f.repo, 'link-to-keep'))
  writeFileSync(join(f.repo, 'staged-new.txt'), 'brand-new-staged\n')
  f.git('add', 'staged-new.txt')

  const res = f.rescue(['--task', 'rescue-complex', '--no-sync'])
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)

  const kv = parseKv(res.stdout)
  assert.equal(kv.RESCUE_STATUS, 'rescued')
  assert.equal(kv.RESCUE_COMMITS, '2')

  // Primary checkout fully restored to clean HEAD
  assert.equal(f.git('status', '--porcelain'), '')
  assert.equal(readFileSync(join(f.repo, 'keep.txt'), 'utf8'), 'original-keep\n')
  assert.equal(existsSync(join(f.repo, 'to-delete.txt')), true)
  assert.equal(existsSync(join(f.repo, 'to-rename.txt')), true)
  assert.equal(existsSync(join(f.repo, 'renamed.txt')), false)
  assert.equal(existsSync(join(f.repo, 'cached-rm.txt')), true)
  assert.equal(existsSync(join(f.repo, 'staged-new.txt')), false)
  assert.equal(existsSync(join(f.repo, 'link-to-keep')), false)

  // Rescued worktree preserves both staged commit (HEAD~1) and working-tree commit (HEAD)
  const wt = join(f.repo, '.worktrees/rescue-complex')
  assert.equal(f.gitAt(wt, 'status', '--porcelain'), '')
  assert.equal(f.gitAt(wt, 'show', 'HEAD~1:keep.txt'), 'staged-v2')
  assert.equal(readFileSync(join(wt, 'keep.txt'), 'utf8'), 'working-v3\n')
  assert.equal(existsSync(join(wt, 'to-delete.txt')), false)
  assert.equal(existsSync(join(wt, 'to-rename.txt')), false)
  assert.equal(readFileSync(join(wt, 'renamed.txt'), 'utf8'), 'rename-me\n')
  assert.equal(readFileSync(join(wt, 'cached-rm.txt'), 'utf8'), 'cached-rm-body\n')
  assert.equal(readFileSync(join(wt, 'staged-new.txt'), 'utf8'), 'brand-new-staged\n')
  assert.equal((lstatSync(join(wt, 'exec.sh')).mode & 0o111) !== 0, true)
  assert.equal(lstatSync(join(wt, 'link-to-keep')).isSymbolicLink(), true)
  assert.equal(readlinkSync(join(wt, 'link-to-keep')), 'keep.txt')
})

test('rescue-primary is idempotent when primary is already clean and fast-forwards main', (t) => {
  const f = createFixture(t)
  const remoteHead = f.pushRemoteCommit({ 'upstream.txt': 'ok\n' })

  const res = f.rescue()
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
  const kv = parseKv(res.stdout)
  assert.equal(kv.RESCUE_STATUS, 'already-clean')
  assert.equal(kv.PRIMARY_HEAD, remoteHead)
  assert.equal(f.git('rev-parse', 'HEAD'), remoteHead)
})

test('rescue-primary refuses destructive flags, non-main branch, ahead commits, and in-progress merge without touching dirty edits', (t) => {
  // 1. Destructive flags rejected
  {
    const f = createFixture(t)
    writeFileSync(join(f.repo, 'AGENTS.md'), 'dirty\n')
    for (const flag of ['--discard', '--force', '--abandon', '--unknown']) {
      const res = f.rescue([flag])
      assert.notEqual(res.status, 0, `expected failure for ${flag}`)
      assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), 'dirty\n')
    }
  }

  // 2. Non-default branch rejected
  {
    const f = createFixture(t)
    f.git('checkout', '-b', 'feat/other')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'other-dirty\n')
    const res = f.rescue()
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /must be on default branch/)
    assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), 'other-dirty\n')
  }

  // 3. Unpushed local commits on main rejected
  {
    const f = createFixture(t)
    writeFileSync(join(f.repo, 'local-commit.txt'), 'unpushed\n')
    f.git('add', 'local-commit.txt')
    f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'local unpushed')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'dirty-with-ahead\n')
    const res = f.rescue()
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /unpushed local commit/)
    assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), 'dirty-with-ahead\n')
  }

  // 4. In-progress merge sentinel rejected
  {
    const f = createFixture(t)
    writeFileSync(join(f.repo, '.git/MERGE_HEAD'), f.git('rev-parse', 'HEAD') + '\n')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'dirty-merge\n')
    const res = f.rescue()
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /in-progress git operation/)
    assert.equal(readFileSync(join(f.repo, 'AGENTS.md'), 'utf8'), 'dirty-merge\n')
  }
})

test('rescue-primary works with macOS /bin/bash 3.2 and bare worktree.sh copy without sync-main.sh, unblocking ship', (t) => {
  const f = createFixture(t, { withContract: false, scriptLayout: 'scripts' })

  // Create and "merge" a feature worktree on remote
  const wt = join(f.repo, '.worktrees/feat-demo')
  f.git('worktree', 'add', '-b', 'feat/feat-demo', wt)
  writeFileSync(join(wt, 'feature.txt'), 'shipped\n')
  f.gitAt(wt, 'add', 'feature.txt')
  f.gitAt(wt, '-c', 'commit.gpgsign=false', 'commit', '-m', 'feat: demo')
  const head = f.gitAt(wt, 'rev-parse', 'HEAD')
  f.git('push', 'origin', 'feat/feat-demo')
  execFileSync('git', ['--git-dir', f.remote, 'update-ref', 'refs/heads/main', head])
  writeFileSync(
    join(f.bin, 'gh'),
    `#!/bin/sh\ncase "$*" in\n  *'--json state -q .state'*) echo 'MERGED' ;;\n  *) printf 'MERGED\\tfeat/feat-demo\\t${head}\\tmain\\t${head}\\n' ;;\nesac\n`,
    { mode: 0o755 },
  )

  // Dirty primary checkout blocks ship
  writeFileSync(join(f.repo, 'AGENTS.md'), '# Rules\nunexpected-primary-edit\n')
  const blockedShip = spawnSync('/bin/bash', ['scripts/worktree.sh', 'ship', 'feat-demo', '--pr', '9901'], {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, OMNIMUX_DEV_SNAPSHOT: join(f.fixture, 'absent-dev'), OMNIMUX_SAG_INDEX: '0' },
  })
  assert.equal(blockedShip.status, 1)
  assert.match(blockedShip.stderr, /primary checkout is not clean for materialization/)
  assert.match(blockedShip.stderr, /rescue-primary/)

  // Rescue under /bin/bash 3.2 unblocks ship
  const rescued = f.rescue(['--task', 'rescue-unblock'], { bashPath: '/bin/bash' })
  assert.equal(rescued.status, 0, `${rescued.stdout}\n${rescued.stderr}`)
  assert.doesNotMatch(rescued.stderr, /unbound variable/)

  const shipOk = spawnSync('/bin/bash', ['scripts/worktree.sh', 'ship', 'feat-demo', '--pr', '9901'], {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, OMNIMUX_DEV_SNAPSHOT: join(f.fixture, 'absent-dev'), OMNIMUX_SAG_INDEX: '0' },
  })
  assert.equal(shipOk.status, 0, `${shipOk.stdout}\n${shipOk.stderr}`)
  assert.equal(
    readFileSync(join(f.repo, '.worktrees/rescue-unblock/AGENTS.md'), 'utf8'),
    '# Rules\nunexpected-primary-edit\n',
  )
})

test('rescue-primary tolerates non-ASCII allowed drafts and submodule drift without misclassifying or deleting them', (t) => {
  const f = createFixture(t)
  const subsrc = join(f.fixture, 'subsrc')
  mkdirSync(subsrc, { recursive: true })
  f.gitAt(subsrc, 'init', '-b', 'main')
  f.gitAt(subsrc, 'config', 'user.name', 'sub')
  f.gitAt(subsrc, 'config', 'user.email', 'sub@example.test')
  writeFileSync(join(subsrc, 'README.md'), 'v1\n')
  f.gitAt(subsrc, 'add', '.')
  f.gitAt(subsrc, '-c', 'commit.gpgsign=false', 'commit', '-m', 'sub v1')
  f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', subsrc, 'app/deepseek-harness')
  f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'add submodule')
  f.git('push', 'origin', 'main')

  // Create submodule pointer drift + non-ASCII allowed drafts
  const subdir = join(f.repo, 'app/deepseek-harness')
  f.gitAt(subdir, 'config', 'user.name', 'sub')
  f.gitAt(subdir, 'config', 'user.email', 'sub@example.test')
  writeFileSync(join(subdir, 'README.md'), 'v2\n')
  f.gitAt(subdir, 'add', 'README.md')
  f.gitAt(subdir, '-c', 'commit.gpgsign=false', 'commit', '-m', 'sub v2')

  mkdirSync(join(f.repo, 'specs'), { recursive: true })
  writeFileSync(join(f.repo, 'specs/中文草稿.md'), '# 中文草稿\n')
  mkdirSync(join(f.repo, 'plugins/docs/evidence'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/docs/evidence/中文证据.json'), '{"ok":true}\n')

  // Case 1: Only non-ASCII allowed drafts + submodule drift -> already-clean
  const cleanRes = f.rescue(['--no-sync'])
  assert.equal(cleanRes.status, 0, `${cleanRes.stdout}\n${cleanRes.stderr}`)
  assert.equal(parseKv(cleanRes.stdout).RESCUE_STATUS, 'already-clean')

  // Case 2: Add real dirty tracked edit alongside non-ASCII drafts + submodule drift -> rescues cleanly
  writeFileSync(join(f.repo, 'AGENTS.md'), '# Rules\nwith-cjk-draft\n')
  const res = f.rescue(['--task', 'rescue-cjk-draft', '--no-sync'])
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
  assert.equal(parseKv(res.stdout).RESCUE_STATUS, 'rescued')
  assert.equal(readFileSync(join(f.repo, 'specs/中文草稿.md'), 'utf8'), '# 中文草稿\n')
  assert.equal(readFileSync(join(f.repo, 'plugins/docs/evidence/中文证据.json'), 'utf8'), '{"ok":true}\n')
})

test('rescue-primary preserves git rm --cached on allowed draft dir and never mislabels multi-commit rescues as type-0', (t) => {
  // 1. git rm --cached on docs/tracked-doc.md alongside another staged edit
  {
    const f = createFixture(t)
    f.git('rm', '--cached', 'docs/tracked-doc.md')
    writeFileSync(join(f.repo, 'AGENTS.md'), '# Rules\nstaged-rule\n')
    f.git('add', 'AGENTS.md')

    const res = f.rescue(['--task', 'rescue-cached-draft', '--no-sync'])
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
    const kv = parseKv(res.stdout)
    assert.equal(kv.RESCUE_STATUS, 'rescued')
    assert.equal(kv.RESCUE_COMMITS, '2')
    assert.equal(kv.TRIAGE_HINT, 'inspect-required')

    const wt = join(f.repo, '.worktrees/rescue-cached-draft')
    // Commit 1 (HEAD~1) preserved the staged deletion of docs/tracked-doc.md
    assert.throws(() => f.gitAt(wt, 'cat-file', '-e', 'HEAD~1:docs/tracked-doc.md'))
    // Commit 2 (HEAD) preserved the on-disk copy of docs/tracked-doc.md
    assert.equal(readFileSync(join(wt, 'docs/tracked-doc.md'), 'utf8'), '# tracked doc\n')
  }

  // 2. Partial staging reverted in working tree to match origin/main -> must NOT emit type-0-identical-to-origin-main
  {
    const f = createFixture(t)
    writeFileSync(join(f.repo, 'keep.txt'), 'valuable-staged-work\n')
    f.git('add', 'keep.txt')
    writeFileSync(join(f.repo, 'keep.txt'), 'original-keep\n')

    const res = f.rescue(['--task', 'rescue-staged-revert'])
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
    const kv = parseKv(res.stdout)
    assert.equal(kv.RESCUE_STATUS, 'rescued')
    assert.equal(kv.RESCUE_COMMITS, '2')
    assert.equal(kv.TRIAGE_HINT, 'inspect-required')
    assert.equal(f.gitAt(join(f.repo, '.worktrees/rescue-staged-revert'), 'show', 'HEAD~1:keep.txt'), 'valuable-staged-work')
  }
})

test('rescue-primary handles chained renames, file<->dir swaps, glob metachar paths, force-staged ignored files, and blocking pre-commit hooks', (t) => {
  const f = createFixture(t)

  // Install a hostile pre-commit hook that would otherwise block rescue commits
  const preCommit = join(f.repo, '.git/hooks/pre-commit')
  writeFileSync(preCommit, '#!/bin/sh\necho "blocked by local pre-commit" >&2\nexit 1\n', { mode: 0o755 })

  // Chained staged rename: chain-b -> chain-c, chain-a -> chain-b
  f.git('mv', 'chain-b.txt', 'chain-c.txt')
  f.git('mv', 'chain-a.txt', 'chain-b.txt')

  // Directory -> file swap AND file -> directory swap
  rmSync(join(f.repo, 'swap-dir'), { recursive: true, force: true })
  writeFileSync(join(f.repo, 'swap-dir'), 'now-a-regular-file\n')
  rmSync(join(f.repo, 'swap-file'))
  mkdirSync(join(f.repo, 'swap-file'), { recursive: true })
  writeFileSync(join(f.repo, 'swap-file/child.txt'), 'now-inside-dir\n')

  // Glob metacharacter path: edit src/[id]/page.js while src/i/page.js stays untouched
  writeFileSync(join(f.repo, 'src/[id]/page.js'), 'export const id = 999\n')

  // Force-staged gitignored file
  writeFileSync(join(f.repo, 'ignored.log'), 'force-staged-secret-trace\n')
  f.git('add', '-f', 'ignored.log')

  const res = f.rescue(['--task', 'rescue-hard-edges', '--no-sync'])
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
  assert.equal(parseKv(res.stdout).RESCUE_STATUS, 'rescued')

  // Primary checkout fully restored
  assert.equal(f.git('status', '--porcelain'), '')
  assert.equal(readFileSync(join(f.repo, 'chain-a.txt'), 'utf8'), 'content-a\n')
  assert.equal(readFileSync(join(f.repo, 'chain-b.txt'), 'utf8'), 'content-b\n')
  assert.equal(existsSync(join(f.repo, 'chain-c.txt')), false)
  assert.equal(readFileSync(join(f.repo, 'swap-dir/sub.txt'), 'utf8'), 'inside-dir\n')
  assert.equal(readFileSync(join(f.repo, 'swap-file'), 'utf8'), 'was-a-file\n')
  assert.equal(readFileSync(join(f.repo, 'src/[id]/page.js'), 'utf8'), 'export const id = 1\n')
  assert.equal(readFileSync(join(f.repo, 'src/i/page.js'), 'utf8'), 'export const i = 1\n')
  assert.equal(existsSync(join(f.repo, 'ignored.log')), false)

  // Rescued worktree faithfully captured everything
  const wt = join(f.repo, '.worktrees/rescue-hard-edges')
  assert.equal(f.gitAt(wt, 'status', '--porcelain'), '')
  assert.equal(existsSync(join(wt, 'chain-a.txt')), false)
  assert.equal(readFileSync(join(wt, 'chain-b.txt'), 'utf8'), 'content-a\n')
  assert.equal(readFileSync(join(wt, 'chain-c.txt'), 'utf8'), 'content-b\n')
  assert.equal(readFileSync(join(wt, 'swap-dir'), 'utf8'), 'now-a-regular-file\n')
  assert.equal(readFileSync(join(wt, 'swap-file/child.txt'), 'utf8'), 'now-inside-dir\n')
  assert.equal(readFileSync(join(wt, 'src/[id]/page.js'), 'utf8'), 'export const id = 999\n')
  assert.equal(readFileSync(join(wt, 'src/i/page.js'), 'utf8'), 'export const i = 1\n')
  assert.equal(readFileSync(join(wt, 'ignored.log'), 'utf8'), 'force-staged-secret-trace\n')
})

test('rescue-primary rejects real unmerged conflicts (ls-files -u) and nested untracked git repos with empty-shell cleanup', (t) => {
  // 1. Real unmerged index conflict (ls-files -u)
  {
    const f = createFixture(t)
    f.git('checkout', '-b', 'conflict-branch')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'branch-version\n')
    f.git('add', 'AGENTS.md')
    f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'branch edit')
    f.git('checkout', 'main')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'main-version\n')
    f.git('add', 'AGENTS.md')
    f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'main edit')
    spawnSync('git', ['merge', 'conflict-branch'], { cwd: f.repo, stdio: 'ignore' })
    rmSync(join(f.repo, '.git/MERGE_HEAD'), { force: true }) // test ls-files -u independently of MERGE_HEAD

    const res = f.rescue(['--no-sync'])
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /unmerged conflict entries/)
  }

  // 2. Nested untracked git repo directory rejected and empty rescue worktree cleaned up
  {
    const f = createFixture(t)
    const nested = join(f.repo, 'nested-repo')
    mkdirSync(nested, { recursive: true })
    f.gitAt(nested, 'init', '-b', 'main')
    writeFileSync(join(nested, 'README.md'), 'nested\n')

    const res = f.rescue(['--task', 'rescue-nested', '--no-sync'])
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /refusing to rescue directory entry|cleaned empty shell worktree/)
    assert.equal(existsSync(join(f.repo, '.worktrees/rescue-nested')), false)
    assert.equal(existsSync(join(nested, 'README.md')), true)
  }
})

test('rescue-primary ignores forged env overrides, resolves symlink SCRIPT_DIR physically, and reports rescued metadata even when trailing ff-sync fails', (t) => {
  // 1. Forged WORKTREE_REMOTE / WORKTREE_DEFAULT_BRANCH cannot bypass ahead-commit check
  {
    const f = createFixture(t)
    writeFileSync(join(f.repo, 'ahead.txt'), 'unpushed\n')
    f.git('add', 'ahead.txt')
    f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'ahead')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'dirty\n')

    const res = f.rescue([], {
      extraEnv: { WORKTREE_REMOTE: 'nonexistent', WORKTREE_DEFAULT_BRANCH: 'other' },
    })
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /unpushed local commit/)
  }

  // 2. Symlink invocation resolves physical SCRIPT_DIR and does NOT source hostile sibling sync-main.sh
  {
    const f = createFixture(t)
    const evilDir = join(f.fixture, 'evil-symlink-dir')
    mkdirSync(evilDir, { recursive: true })
    const pwnMarker = join(evilDir, 'pwned.txt')
    writeFileSync(join(evilDir, 'sync-main.sh'), `echo pwned > "${pwnMarker}"\n`)
    const linkPath = join(evilDir, 'worktree.sh')
    symlinkSync(join(f.repo, f.scriptLayout, 'worktree.sh'), linkPath)
    writeFileSync(join(f.repo, 'AGENTS.md'), 'symlink-test\n')

    const res = f.rescue(['--task', 'rescue-symlink-safe', '--no-sync'], { scriptPath: linkPath })
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
    assert.equal(existsSync(pwnMarker), false, 'worktree.sh must resolve physical SCRIPT_DIR and never source sibling sync-main.sh')
  }

  // 3. Trailing ff-only collision with allowed untracked draft still prints rescued worktree metadata
  {
    const f = createFixture(t)
    f.pushRemoteCommit({ 'specs/collide.md': 'upstream-spec\n' }, 'docs: add specs/collide.md')
    mkdirSync(join(f.repo, 'specs'), { recursive: true })
    writeFileSync(join(f.repo, 'specs/collide.md'), 'local-untracked-draft\n')
    writeFileSync(join(f.repo, 'AGENTS.md'), 'local-rule-edit\n')

    const res = f.rescue(['--task', 'rescue-ff-collide'])
    assert.notEqual(res.status, 0)
    const kv = parseKv(res.stdout)
    assert.equal(kv.RESCUE_STATUS, 'rescued-sync-failed')
    assert.equal(kv.RESCUE_WORKTREE, '.worktrees/rescue-ff-collide')
    assert.ok(kv.RESCUE_COMMIT)
    assert.equal(readFileSync(join(f.repo, '.worktrees/rescue-ff-collide/AGENTS.md'), 'utf8'), 'local-rule-edit\n')
    assert.equal(readFileSync(join(f.repo, 'specs/collide.md'), 'utf8'), 'local-untracked-draft\n')
  }
})
