import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const pluginsRoot = resolve(here, '..')
const repoRoot = resolve(pluginsRoot, '..')
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8')

test('historical nested workflow directory and retired legacy shell are removed', () => {
  assert.equal(existsSync(join(repoRoot, 'app', '.github')), false)
  assert.equal(read('.github/workflows/r2-publish.yml').includes('app/.github'), false)
  assert.equal(existsSync(join(repoRoot, 'app', 'dsh-plugin-desktop')), false)
  assert.equal(read('app/dsh-desktop-next/tests/package.spec.ts').includes("new URL('.github/workflows/ci.yml', workspaceRoot)"), false)
})

test('sync-upstream uses the current main branch and existing decision log', () => {
  const scriptPath = join(repoRoot, 'app', 'scripts', 'sync-upstream.sh')
  const script = readFileSync(scriptPath, 'utf8')
  assert.ok(script.includes('SYNC_FROM="${SYNC_FROM:-origin/main}"'))
  assert.ok(script.includes('main..${SYNC_FROM}'))
  assert.ok(script.includes('docs/contracts/upstream-sync-log.md'))
  assert.equal(script.includes('omnimux..'), false)
  assert.equal(script.includes('upstream-sync.md'), false)

  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
  const count = spawnSync('git', ['rev-list', '--count', 'main..origin/main'], {
    cwd: join(repoRoot, 'app'),
    encoding: 'utf8',
  })
  assert.equal(count.status, 0, count.stderr)
  const head = spawnSync('git', ['rev-parse', 'origin/main'], {
    cwd: join(repoRoot, 'app'),
    encoding: 'utf8',
  })
  assert.equal(head.status, 0, head.stderr)
})

test('cordis propagation resolves the in-repo harness by default and fails loudly when missing', () => {
  const scriptPath = join(pluginsRoot, 'scripts', 'verify-cordis-propagate.mjs')
  const script = readFileSync(scriptPath, 'utf8')
  assert.ok(script.includes("join(repoRoot, 'app', 'deepseek-harness')"))
  assert.equal(script.includes('/Users/'), false)

  const missing = mkdtempSync(join(tmpdir(), 'dsh-src-missing-'))
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: pluginsRoot,
      encoding: 'utf8',
      env: { ...process.env, DSH_SRC: missing },
      timeout: 30000,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /DSH_SRC is missing a DeepSeek Harness checkout/)
  } finally {
    rmSync(missing, { recursive: true, force: true })
  }
})

test('smoke script defaults DSH_SRC to the in-repo harness and validates it', () => {
  const scriptPath = join(pluginsRoot, 'scripts', 'smoke.sh')
  const script = readFileSync(scriptPath, 'utf8')
  assert.ok(script.includes('DSH_SRC="${DSH_SRC:-$repo_root/app/deepseek-harness}"'))
  assert.ok(script.includes('package.json'))
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
})

test('historical one-time ui-audit scripts are removed without registry ghosts', () => {
  for (const name of ['ui-audit.binding-qa.mjs', 'ui-audit.round2-identity.mjs', 'ui-audit.repair-binding.mjs']) {
    assert.equal(existsSync(join(pluginsRoot, 'scripts', name)), false, name)
  }
  const manifest = read('plugins/scripts/governance-manifest.json')
  assert.equal(manifest.includes('ui-audit.binding-qa'), false)
  assert.equal(manifest.includes('ui-audit.round2-identity'), false)
  assert.equal(manifest.includes('ui-audit.repair-binding'), false)
})

test('dev-doctor no longer requires the absent avatar plugin', () => {
  const scriptPath = join(pluginsRoot, 'scripts', 'dev-doctor.sh')
  const script = readFileSync(scriptPath, 'utf8')
  assert.equal(script.includes('omnimux-avatar'), false)
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr)
})

test('worktree and reference docs contain no local user home paths', () => {
  for (const rel of [
    'plugins/scripts/guard-worktree.mjs',
    'plugins/plugins/omnimux/src/workbench/reference-navigation.js',
    'plugins/plugins/omnimux/src/agents/contracts/virtual-reference.md',
  ]) {
    assert.equal(read(rel).includes('/Users/'), false, rel)
  }
})

test('legacy repository markers are updated while the package sentinel stays intact', () => {
  const legacyDesktop = ['omnimux', 'desktop', 'fork'].join('-')
  const legacyPlugin = ['omnimux', 'dsh'].join('-')
  for (const rel of [
    'app/scripts/ops/guard-worktree.mjs',
    'app/scripts/worktree.sh',
    'plugins/scripts/guard-worktree.mjs',
    'plugins/scripts/git-wt.sh',
  ]) {
    const content = read(rel)
    assert.equal(content.includes(legacyDesktop), false, rel)
    assert.equal(content.includes(legacyPlugin), false, rel)
  }
  assert.ok(read('plugins/scripts/git-wt.sh').includes('worktree_dir'))
  assert.ok(read('plugins/scripts/git-wt.sh').includes('/.worktrees/'))
  assert.ok(read('app/scripts/worktree.sh').includes('omnimux-client'))
  assert.equal(JSON.parse(read('plugins/package.json')).name, legacyPlugin)
})
