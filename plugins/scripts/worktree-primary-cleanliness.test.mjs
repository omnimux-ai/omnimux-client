/**
 * worktree.sh 的主检出洁净度必须与物化门禁 sync-main.sh 同一口径：
 * 子模块指针漂移、demo/证据草稿不阻塞收尾；会进入插件产物的未跟踪源码必须提前拦截。
 * 同时守护「只有 worktree.sh 的裸拷贝」时的同口径兜底，避免两处判定再次漂移。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function createFixture(t, { withContract }) {
  const fixture = mkdtempSync(join(tmpdir(), 'omnimux-primary-clean-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const repo = join(fixture, 'repo')
  const remote = join(fixture, 'origin.git')
  const bin = join(fixture, 'bin')
  mkdirSync(repo)
  mkdirSync(bin)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const gitAt = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  git('init', '--bare', '-b', 'main', remote)
  git('init', '-b', 'main')
  git('config', 'user.name', 'delivery-test')
  git('config', 'user.email', 'delivery@example.test')

  mkdirSync(join(repo, 'scripts'))
  copyFileSync(join(root, 'scripts/worktree.sh'), join(repo, 'scripts/worktree.sh'))
  if (withContract) copyFileSync(join(root, 'scripts/sync-main.sh'), join(repo, 'scripts/sync-main.sh'))
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n')
  writeFileSync(join(repo, 'scripts/sync-to-app.sh'), '#!/bin/sh\necho "SYNC_CALLED: $*" >> sync_receipt.txt\n', { mode: 0o755 })
  git('add', '.')
  git('commit', '-m', 'seed')
  git('remote', 'add', 'origin', remote)
  git('push', '-u', 'origin', 'HEAD')

  const addSubmoduleDrift = () => {
    const subsrc = join(fixture, 'subsrc')
    mkdirSync(subsrc)
    gitAt(subsrc, 'init', '-b', 'main')
    gitAt(subsrc, 'config', 'user.name', 'sub-fixture')
    gitAt(subsrc, 'config', 'user.email', 'sub@example.test')
    writeFileSync(join(subsrc, 'README.md'), 'v1\n')
    gitAt(subsrc, 'add', '.')
    gitAt(subsrc, 'commit', '-m', 'sub v1')
    git('-c', 'protocol.file.allow=always', 'submodule', 'add', subsrc, 'app/deepseek-harness')
    git('commit', '-m', 'add submodule')
    git('push', 'origin', 'HEAD')
    const subdir = join(repo, 'app/deepseek-harness')
    gitAt(subdir, 'config', 'user.name', 'sub-fixture')
    gitAt(subdir, 'config', 'user.email', 'sub@example.test')
    writeFileSync(join(subdir, 'README.md'), 'v2\n')
    gitAt(subdir, 'add', 'README.md')
    gitAt(subdir, '-c', 'commit.gpgsign=false', 'commit', '-m', 'sub v2')
    assert.match(git('status', '--porcelain'), /M app\/deepseek-harness/)
  }

  const addDrafts = () => {
    for (const draft of ['ui-demo/preview.png', 'plugins/docs/evidence/dev-smoke-report.json', 'plugins/.agent-reports/task/notes.md']) {
      mkdirSync(dirname(join(repo, draft)), { recursive: true })
      writeFileSync(join(repo, draft), 'draft\n')
    }
  }

  const mergeFeature = (name = 'plugin-feature', files = { 'plugins/omnimux-workflow/src/index.ts': 'export const workflow = 1\n' }) => {
    const worktree = join(repo, `.worktrees/${name}`)
    git('-c', 'protocol.file.allow=always', 'worktree', 'add', '-b', `agent/${name}`, worktree)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(worktree, path)), { recursive: true })
      writeFileSync(join(worktree, path), content)
    }
    git('-C', worktree, 'add', '.')
    git('-C', worktree, 'commit', '-m', 'feat: fixture')
    const head = git('-C', worktree, 'rev-parse', 'HEAD')
    git('push', 'origin', `agent/${name}`)
    execFileSync('git', ['--git-dir', remote, 'update-ref', 'refs/heads/main', head], { encoding: 'utf8' })
    writeFileSync(
      join(bin, 'gh'),
      `#!/bin/sh\ncase "$*" in\n  *'--json state -q .state'*) echo 'MERGED' ;;\n  *) printf 'MERGED\\tagent/${name}\\t${head}\\tmain\\t${head}\\n' ;;\nesac\n`,
      { mode: 0o755 },
    )
    return { worktree, head }
  }

  const ship = (name, pr, bashPath = 'bash') => spawnSync(bashPath, ['scripts/worktree.sh', 'ship', name, '--pr', pr], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OMNIMUX_DEV_SNAPSHOT: join(fixture, 'absent-dev'),
      OMNIMUX_SAG_INDEX: '0',
    },
  })

  return { fixture, repo, remote, bin, git, gitAt, addSubmoduleDrift, addDrafts, mergeFeature, ship }
}

test('ship tolerates primary submodule drift and evidence drafts when the contract is present', (t) => {
  const f = createFixture(t, { withContract: true })
  f.addSubmoduleDrift()
  f.addDrafts()
  f.mergeFeature('plugin-feature')

  const result = f.ship('plugin-feature', '9101')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.ok(existsSync(join(f.repo, 'sync_receipt.txt')), 'submodule drift must not skip automatic materialization')
})

test('ship refuses untracked plugin sources before any materialization', (t) => {
  const f = createFixture(t, { withContract: true })
  const { worktree } = f.mergeFeature('plugin-feature', { 'feature.txt': 'merged\n' })
  mkdirSync(join(f.repo, 'plugins/plugins/omnimux'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/plugins/omnimux/stray.js'), 'export const stray = 1\n')

  const result = f.ship('plugin-feature', '9102')
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stderr, /primary checkout is not clean for materialization/)
  assert.match(result.stderr, /stray\.js/)
  assert.equal(existsSync(join(f.repo, 'sync_receipt.txt')), false, 'must not materialize from a blocked primary checkout')
  assert.ok(existsSync(join(worktree, 'feature.txt')), 'retain the task worktree when the primary checkout blocks delivery')
})

test('fallback allow-list literal matches the sync-main contract', () => {
  const pattern = /OMNIMUX_PRIMARY_ALLOWED_UNTRACKED_RE='([^']+)'/
  const contract = readFileSync(join(root, 'scripts/sync-main.sh'), 'utf8').match(pattern)?.[1]
  const consumer = readFileSync(join(root, 'scripts/worktree.sh'), 'utf8').match(pattern)?.[1]
  assert.ok(contract, 'sync-main.sh must declare the allow-list literal')
  assert.equal(consumer, contract, 'worktree.sh fallback must not drift from the contract')
})

test('remove cleans the worktree and reports why materialization was skipped', (t) => {
  const f = createFixture(t, { withContract: true })
  const { worktree } = f.mergeFeature('plugin-feature')
  mkdirSync(join(f.repo, 'plugins/plugins/omnimux'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/plugins/omnimux/stray.js'), 'export const stray = 1\n')
  writeFileSync(join(f.bin, 'gh'), '#!/bin/sh\necho MERGED\n', { mode: 0o755 })

  const result = spawnSync('bash', ['scripts/worktree.sh', 'remove', 'plugin-feature', '--pr', '9105'], {
    cwd: f.repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, OMNIMUX_DEV_SNAPSHOT: join(f.fixture, 'absent-dev'), OMNIMUX_SAG_INDEX: '0' },
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(existsSync(worktree), false, 'remove must still clean the merged worktree')
  assert.equal(existsSync(join(f.repo, 'sync_receipt.txt')), false, 'blocked primary checkout must not materialize')
  assert.match(result.stdout, /跳过自动物化/)
  assert.match(result.stderr, /stray\.js/)
})

test('bare worktree.sh copies keep the same allow-list without sync-main.sh', (t) => {
  const f = createFixture(t, { withContract: false })
  f.addSubmoduleDrift()
  f.addDrafts()
  f.mergeFeature('plugin-feature')

  const result = f.ship('plugin-feature', '9103')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.ok(existsSync(join(f.repo, 'sync_receipt.txt')), 'fallback must keep the shared allow-list for submodule drift')
})

test('bare worktree.sh copies still refuse untracked plugin sources', (t) => {
  const f = createFixture(t, { withContract: false })
  f.mergeFeature('plugin-feature', { 'feature.txt': 'merged\n' })
  mkdirSync(join(f.repo, 'plugins/plugins/omnimux'), { recursive: true })
  writeFileSync(join(f.repo, 'plugins/plugins/omnimux/stray.js'), 'export const stray = 1\n')

  const result = f.ship('plugin-feature', '9104')
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stderr, /stray\.js/)
})

test('ship derives plugin names from the monorepo plugins/plugins/<name> layout', (t) => {
  const f = createFixture(t, { withContract: true })
  f.mergeFeature('plugin-feature', {
    'plugins/plugins/omnimux-workflow/package.json': '{"name":"omnimux-workflow"}\n',
    'plugins/plugins/omnimux-workflow/src/index.ts': 'export const workflow = 1\n',
  })

  const result = f.ship('plugin-feature', '9201')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(readFileSync(join(f.repo, 'sync_receipt.txt'), 'utf8').trim(), 'SYNC_CALLED: omnimux-workflow')
})

test('ship runs a full sync for workspace and shared package changes', (t) => {
  const cases = [
    { files: { 'plugins/package.json': '{"name":"omnimux-plugins"}\n' }, label: 'workspace package.json' },
    { files: { 'plugins/packages/dsh-ui-kit/src/index.js': 'export const kit = 1\n' }, label: 'shared ui kit' },
  ]
  for (const { files, label } of cases) {
    const f = createFixture(t, { withContract: true })
    f.mergeFeature('plugin-feature', files)
    const result = f.ship('plugin-feature', '9202')
    assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /共享依赖改动需要完整同步/, label)
    assert.equal(readFileSync(join(f.repo, 'sync_receipt.txt'), 'utf8').trim(), 'SYNC_CALLED:', `${label} must run a full sync without plugin arguments`)
  }
})

test('ship runs full sync and then the named plugins for mixed workspace changes', (t) => {
  const f = createFixture(t, { withContract: true })
  f.mergeFeature('plugin-feature', {
    'plugins/package.json': '{"name":"omnimux-plugins"}\n',
    'plugins/plugins/omnimux-browser/package.json': '{"name":"omnimux-browser"}\n',
    'plugins/plugins/omnimux-browser/src/index.ts': 'export const browser = 1\n',
  })

  const result = f.ship('plugin-feature', '9301')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.deepEqual(readFileSync(join(f.repo, 'sync_receipt.txt'), 'utf8').trim().split('\n').map(line => line.trim()), [
    'SYNC_CALLED:',
    'SYNC_CALLED: omnimux-browser',
  ], 'workspace sync must be followed by the named plugin sync')
})

test('ship ignores plugin-workspace directories that are not plugin packages', (t) => {
  const f = createFixture(t, { withContract: true })
  f.mergeFeature('plugin-feature', { 'plugins/.agents/skills/demo/SKILL.md': '# demo\n' })

  const result = f.ship('plugin-feature', '9302')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /无需物化/)
  assert.equal(existsSync(join(f.repo, 'sync_receipt.txt')), false)
})

test('workspace-only ship survives bash 3.2 with an empty changed-plugin list', (t) => {
  const f = createFixture(t, { withContract: true })
  f.mergeFeature('plugin-feature', {
    'plugins/package.json': '{"name":"omnimux-plugins"}\n',
    'scripts/dev-smoke.mjs': 'process.exit(0)\n',
  })

  const result = f.ship('plugin-feature', '9303', '/bin/bash')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.doesNotMatch(result.stderr, /unbound variable/)
  assert.match(result.stdout, /完整同步已完成/)
})

test('mixed sync distinguishes a named-plugin failure from a full-sync failure', (t) => {
  const f = createFixture(t, { withContract: true })
  f.mergeFeature('plugin-feature', {
    'plugins/package.json': '{"name":"omnimux-plugins"}\n',
    'plugins/plugins/omnimux-browser/package.json': '{"name":"omnimux-browser"}\n',
    'plugins/plugins/omnimux-browser/src/index.ts': 'export const browser = 1\n',
    'scripts/sync-to-app.sh': '#!/bin/sh\nif [ "$#" -eq 0 ]; then echo "SYNC_CALLED:" >> sync_receipt.txt; exit 0; fi\necho "SYNC_FAILED: $*" >> sync_receipt.txt; exit 1\n',
  })

  const result = f.ship('plugin-feature', '9304')
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /完整同步成功，但本次插件 \[omnimux-browser\] 安装失败/)
  assert.doesNotMatch(result.stdout, /完整同步失败/)
})
