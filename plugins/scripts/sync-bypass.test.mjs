import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { copySyncScripts } from './sync-fixtures.test.mjs'

const here = dirname(fileURLToPath(import.meta.url))
function fixture(t, state = 'aligned') {
  const home = mkdtempSync(join(tmpdir(), 'omnimux-sync-main-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const repo = join(home, 'repo')
  copySyncScripts(repo)
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  for (const key of Object.keys(gitEnv)) if (key.startsWith('GIT_') && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'].includes(key)) delete gitEnv[key]
  const git = (...args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitEnv })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test Agent')
  git('config', 'user.email', 'agent@omnimux.test')
  git('add', '.')
  git('commit', '-m', 'fixture: clean main')
  const remote = join(home, 'remote.git')
  spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8', env: gitEnv })
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'main')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  if (state === 'feature' || state === 'master') git('switch', '-c', state)
  if (state === 'detached') git('checkout', '--detach')
  if (state === 'dirty') writeFileSync(join(repo, 'scripts/sync-main.sh'), readFileSync(join(repo, 'scripts/sync-main.sh'), 'utf8') + '\n')
  if (state === 'untracked') writeFileSync(join(repo, 'untracked'), 'dirty')
  if (state === 'missing-ref') { git('update-ref', '-d', 'refs/remotes/origin/main'); git('remote', 'remove', 'origin'); }
  if (state === 'non-git') rmSync(join(repo, '.git'), { recursive: true })
  if (state === 'ahead' || state === 'behind') {
    git('commit', '--allow-empty', '-m', 'fixture: next main')
    if (state === 'behind') { git('push', 'origin', 'main'); git('checkout', 'HEAD~1', '-B', 'main') }
  }
  const target = join(home, 'target')
  const profile = join(target, 'profiles/omnimux')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{"sentinel":"unchanged"}\n')
  return { repo, home, target, profile, gitEnv }
}

for (const state of ['feature', 'master', 'detached', 'dirty', 'untracked', 'ahead', 'behind', 'missing-ref', 'non-git']) {
  test(`both sync entrypoints reject ${state}, regardless of obsolete bypass variables`, t => {
    const f = fixture(t, state)
    for (const entry of ['sync-to-app.sh', 'sync-stable.sh']) {
      const result = spawnSync('bash', [join(f.repo, 'scripts', entry), '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
        encoding: 'utf8', env: { ...f.gitEnv, HOME: f.home, OMNIMUX_SYNC_VIA: 'internal',
          OMNIMUX_SYNC_TARGETS: '', OMNIMUX_ALLOW_UNMERGED_MATERIALIZE: '1',
          OMNIMUX_ALLOW_UNMERGED_TARGET: f.target },
      })
      assert.notEqual(result.status, 0, `${entry}/${state}`)
      assert.match(result.stderr, /sync:.*(main|Git|未提交|未跟踪)/, result.stderr)
      assert.equal(readFileSync(join(f.profile, 'package.json'), 'utf8'), '{"sentinel":"unchanged"}\n')
      assert.doesNotMatch(result.stdout, /物化完成|已物化进/)
    }
  })
}

test('clean main must match origin/main exactly; inherited Git overrides cannot attest another checkout', t => {
  const aligned = fixture(t)
  const dirty = fixture(t, 'untracked')
  const gate = (f, extra = {}) => spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], {
    encoding: 'utf8', env: { ...f.gitEnv, ...extra },
  })
  assert.equal(gate(aligned).status, 0)
  const spoofed = gate(dirty, { GIT_DIR: join(aligned.repo, '.git'), GIT_WORK_TREE: aligned.repo })
  assert.equal(spoofed.status, 1)
  assert.match(spoofed.stderr, /已跟踪文件的未提交改动|会进入物化产物的未跟踪文件/)
})

test('untracked drafts under the allow-list pass the cleanliness gate and proceed downstream', t => {
  const f = fixture(t)
  for (const draft of ['specs/gate-draft.spec.md', 'tmp/scratch.txt', '.agent-reports/task/report.md']) {
    mkdirSync(dirname(join(f.repo, draft)), { recursive: true })
    writeFileSync(join(f.repo, draft), 'draft\n')
  }
  const gate = spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(gate.status, 0, gate.stderr)
  assert.doesNotMatch(gate.stderr, /拒绝物化/)
  for (const entry of ['sync-to-app.sh', 'sync-stable.sh']) {
    const result = spawnSync('bash', [join(f.repo, 'scripts', entry), '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
      encoding: 'utf8', env: { ...f.gitEnv, HOME: f.home, OMNIMUX_SYNC_VIA: 'internal', OMNIMUX_SYNC_TARGETS: '' },
    })
    assert.doesNotMatch(result.stderr, /已跟踪文件的未提交改动|会进入物化产物的未跟踪文件/, `${entry}: ${result.stderr}`)
    // 越过洁净度门禁的实证：失败点已在下游插件解析，而不是源码身份门禁。
    assert.match(result.stderr, /源码缺失/, `${entry}: ${result.stderr}`)
  }
  // 白名单是过滤器，不是全量放行：清单外的未跟踪文件仍然必须拦截。
  writeFileSync(join(f.repo, 'unlisted.txt'), 'not a draft\n')
  const blocked = spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /会进入物化产物的未跟踪文件/)
  assert.match(blocked.stderr, /unlisted\.txt/)
})

test('shared cleanliness helpers classify drafts, plugin strays and tracked edits for every caller', t => {
  const f = fixture(t)
  const probe = (fn) => spawnSync('bash', ['-c', `source "$1"; ${fn} "$2"`, 'probe', join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(probe('omnimux_primary_is_clean').status, 0, 'clean fixture must be clean')

  for (const draft of [
    'ui-demo/preview.png',
    'plugins/docs/evidence/report.json',
    'plugins/.agent-reports/task/notes.md',
    '.tmp/worktree-archive/task/spec.md',
    'specs/draft.spec.md',
    'docs/evidence/shot.png',
  ]) {
    mkdirSync(dirname(join(f.repo, draft)), { recursive: true })
    writeFileSync(join(f.repo, draft), 'draft\n')
  }
  assert.equal(probe('omnimux_primary_is_clean').status, 0, 'allow-listed drafts must not block materialization')
  assert.equal(probe('omnimux_primary_blocking_untracked').stdout.trim(), '')

  mkdirSync(join(f.repo, 'plugins/plugins/omnimux'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/plugins/omnimux/stray.js'), 'export const stray = 1\n')
  assert.equal(probe('omnimux_primary_is_clean').status, 1)
  assert.match(probe('omnimux_primary_blocking_untracked').stdout, /plugins\/plugins\/omnimux\/stray\.js/)

  writeFileSync(join(f.repo, 'scripts/sync-main.sh'), readFileSync(join(f.repo, 'scripts/sync-main.sh'), 'utf8') + '\n')
  assert.match(probe('omnimux_primary_tracked_changes').stdout, /scripts\/sync-main\.sh/)
  assert.equal(probe('omnimux_primary_is_clean').status, 1)
})

test('both entrypoints reject external plugin roots even from clean aligned main', t => {
  const f = fixture(t)
  const external = join(f.home, 'external-plugins')
  mkdirSync(external)
  for (const entry of ['sync-to-app.sh', 'sync-stable.sh']) {
    const result = spawnSync('bash', [join(f.repo, 'scripts', entry), '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
      encoding: 'utf8', env: { ...f.gitEnv, HOME: f.home, OMNIMUX_PLUGINS_DIR: external, OMNIMUX_SYNC_TARGETS: '' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /ROOT\/plugins/)
  }
  const alias = join(f.home, 'plugins-alias')
  symlinkSync(join(f.repo, 'plugins'), alias)
  const result = spawnSync('bash', ['-c', 'source "$1"; assert_omnimux_sync_plugins "$2" "$3"', 'check', join(here, 'sync-main.sh'), f.repo, alias], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('monorepo evidence and archive paths pass while untracked plugin source stays blocked', t => {
  const f = fixture(t)
  for (const draft of [
    'plugins/docs/evidence/dev-smoke-report.json',
    'plugins/.agent-reports/task-demo/browser-evidence.md',
    '.tmp/worktree-archive/task/spec.md',
    'ui-demo/preview-demo.png',
  ]) {
    mkdirSync(dirname(join(f.repo, draft)), { recursive: true })
    writeFileSync(join(f.repo, draft), 'evidence\n')
  }
  const passGate = spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(passGate.status, 0, passGate.stderr)
  assert.doesNotMatch(passGate.stderr, /拒绝物化/)

  // 实际插件源码目录下的未跟踪文件仍必须拦截，不能因放行 plugins/docs/evidence 而放宽。
  const strayPluginFile = 'plugins/plugins/omnimux/stray.js'
  mkdirSync(dirname(join(f.repo, strayPluginFile)), { recursive: true })
  writeFileSync(join(f.repo, strayPluginFile), 'export const stray = 1\n')
  const blocked = spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /会进入物化产物的未跟踪文件/)
  assert.match(blocked.stderr, /plugins\/plugins\/omnimux\/stray\.js/)
})

test('drifted or dirty git submodule does not block plugin sync-main while superproject tracked edits still fail', t => {
  const f = fixture(t)
  const subSrc = join(f.home, 'sub-src')
  mkdirSync(subSrc, { recursive: true })
  const gitIn = (cwd, ...args) => {
    const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: f.gitEnv })
    assert.equal(res.status, 0, `${args.join(' ')}: ${res.stderr}`)
    return res.stdout.trim()
  }
  gitIn(subSrc, 'init', '-b', 'main')
  gitIn(subSrc, 'config', 'user.name', 'Test Agent')
  gitIn(subSrc, 'config', 'user.email', 'agent@omnimux.test')
  writeFileSync(join(subSrc, 'README.md'), 'v1\n')
  gitIn(subSrc, 'add', '.')
  gitIn(subSrc, 'commit', '-m', 'sub v1')

  gitIn(f.repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', subSrc, 'app/deepseek-harness')
  gitIn(f.repo, 'commit', '-m', 'add submodule')
  gitIn(f.repo, 'push', 'origin', 'main')

  // 让子模块指针漂移并产生脏文件，验证不影响插件物化门禁。
  const subDir = join(f.repo, 'app/deepseek-harness')
  gitIn(subDir, 'config', 'user.name', 'Test Agent')
  gitIn(subDir, 'config', 'user.email', 'agent@omnimux.test')
  writeFileSync(join(subDir, 'README.md'), 'v2\n')
  gitIn(subDir, 'add', 'README.md')
  gitIn(subDir, '-c', 'commit.gpgsign=false', 'commit', '-m', 'sub v2')
  writeFileSync(join(subDir, 'untracked-in-sub.txt'), 'dirty\n')

  // 同一口径的查询函数也必须忽略子模块：收尾入口直接复用它，不能两边判定不同。
  const cleanProbe = spawnSync('bash', ['-c', 'source "$1"; omnimux_primary_is_clean "$2"', 'probe', join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(cleanProbe.status, 0, 'submodule drift must not count as a blocking primary change')

  const allowed = spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(allowed.status, 0, allowed.stderr)

  // 主仓已跟踪源码改动仍必须严格拒绝。
  writeFileSync(join(f.repo, 'scripts/sync-main.sh'), readFileSync(join(f.repo, 'scripts/sync-main.sh'), 'utf8') + '\n')
  const blocked = spawnSync('bash', [join(here, 'sync-main.sh'), f.repo], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /已跟踪文件的未提交改动/)
})

test('sync-to-app.sh --isolated materializes from fresh origin/main detached worktree even when primary checkout is dirty and behind, and cleans up temp worktree', t => {
  const f = fixture(t, 'behind')
  // 同时让主检出既落后 origin/main，又存在已跟踪文件脏改动
  writeFileSync(join(f.repo, 'scripts/sync-main.sh'), readFileSync(join(f.repo, 'scripts/sync-main.sh'), 'utf8') + '\n# dirty-primary\n')

  // 普通调用必须仍被主检出洁净度门禁拦截
  const direct = spawnSync('bash', [join(f.repo, 'scripts/sync-to-app.sh'), '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
    encoding: 'utf8',
    env: { ...f.gitEnv, HOME: f.home, OMNIMUX_SYNC_TARGETS: '' },
  })
  assert.notEqual(direct.status, 0)
  assert.match(direct.stderr, /已跟踪文件的未提交改动|不等于最新 origin\/main/)

  // --isolated 自动签出最新 origin/main 的干净临时 detached worktree，顺利通过源码身份门禁并在退出后清理临时工作树
  const isolated = spawnSync('bash', [join(f.repo, 'scripts/sync-to-app.sh'), '--isolated', '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
    encoding: 'utf8',
    env: { ...f.gitEnv, HOME: f.home, OMNIMUX_SYNC_TARGETS: '' },
  })
  assert.match(isolated.stdout, /sync --isolated: 签出最新 origin\/main/)
  assert.doesNotMatch(isolated.stderr, /已跟踪文件的未提交改动|不等于最新 origin\/main|会进入物化产物的未跟踪文件/, isolated.stderr)
  // 越过源码身份门禁后到达下游插件解析失败（证明临时工作树干净且精确对齐 origin/main）
  assert.match(isolated.stderr, /源码缺失/, isolated.stderr)

  // 确认临时 worktree 已被 trap 自动拆除，主检出的 worktree 列表仅有主检出本身
  const wtList = spawnSync('git', ['-C', f.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', env: f.gitEnv })
  assert.equal(wtList.status, 0, wtList.stderr)
  const worktreeLines = wtList.stdout.split('\n').filter((line) => line.startsWith('worktree '))
  assert.equal(worktreeLines.length, 1, `Temporary isolated worktree was not cleaned up:\n${wtList.stdout}`)
})

test('sync-to-app.sh --isolated clears wrapper OMNIMUX_* overrides, ignores inherited GIT_* poisoning, and rejects conflicting flags', t => {
  const f = fixture(t, 'behind')
  const evil = fixture(t, 'aligned')
  const realTargetCommit = spawnSync('git', ['-C', f.repo, 'rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], {
    encoding: 'utf8',
    env: f.gitEnv,
  }).stdout.trim()
  const evilCommit = spawnSync('git', ['-C', evil.repo, 'rev-parse', '--verify', 'HEAD^{commit}'], {
    encoding: 'utf8',
    env: evil.gitEnv,
  }).stdout.trim()
  assert.notEqual(realTargetCommit, evilCommit)

  // B1 + B2 回归：携带 omnimux.mjs 注入的 OMNIMUX_PLUGINS_DIR / OMNIMUX_PRODUCT_DIR / OMNIMUX_DSH_UI_KIT_DIR
  // 与伪造的 GIT_DIR / GIT_WORK_TREE 时，--isolated 必须使用真实仓库最新 origin/main 并通过 plugins 归属门禁
  const isolated = spawnSync('bash', [join(f.repo, 'scripts/sync-to-app.sh'), '--isolated', '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
    encoding: 'utf8',
    env: {
      ...f.gitEnv,
      HOME: f.home,
      OMNIMUX_SYNC_TARGETS: '',
      OMNIMUX_PLUGINS_DIR: join(f.repo, 'plugins'),
      OMNIMUX_PRODUCT_DIR: f.repo,
      OMNIMUX_DSH_UI_KIT_DIR: join(f.repo, 'dsh-ui-kit'),
      GIT_DIR: join(evil.repo, '.git'),
      GIT_WORK_TREE: evil.repo,
    },
  })
  assert.match(isolated.stdout, new RegExp(`sync --isolated: 签出最新 origin/main \\(${realTargetCommit.slice(0, 12)}\\)`), isolated.stdout + isolated.stderr)
  assert.doesNotMatch(isolated.stderr, /ROOT\/plugins|已跟踪文件的未提交改动|不等于最新 origin\/main/, isolated.stderr)
  assert.match(isolated.stderr, /源码缺失/, isolated.stderr)

  // 禁止 --isolated 与 --managed-tarball 混用
  const conflictManaged = spawnSync('bash', [join(f.repo, 'scripts/sync-to-app.sh'), '--isolated', '--managed-tarball=/tmp/fake.tgz'], {
    encoding: 'utf8',
    env: { ...f.gitEnv, HOME: f.home },
  })
  assert.equal(conflictManaged.status, 1)
  assert.match(conflictManaged.stderr, /--isolated 不能与 --managed-tarball/)

  // 禁止携带 OMNIMUX_SYNC_ISOLATED_ACTIVE=1 嵌套或绕过 --isolated
  const conflictActive = spawnSync('bash', [join(f.repo, 'scripts/sync-to-app.sh'), '--isolated', '--skip-build', `--target=${f.target}`, 'missing-plugin'], {
    encoding: 'utf8',
    env: { ...f.gitEnv, HOME: f.home, OMNIMUX_SYNC_ISOLATED_ACTIVE: '1' },
  })
  assert.equal(conflictActive.status, 1)
  assert.match(conflictActive.stderr, /OMNIMUX_SYNC_ISOLATED_ACTIVE=1/)
})
