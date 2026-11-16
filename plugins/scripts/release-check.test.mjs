import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkManifest,
  classifyPublishState,
  formatResults,
  listPublishablePackages,
  normalizeRepositoryUrl,
  parseArguments,
  runReleaseCheck,
  runReleaseCheckAll,
} from './release-check.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const MANIFEST = {
  name: 'omnimux',
  version: '0.1.8',
  repository: {
    type: 'git',
    url: 'git+https://github.com/omnimux-ai/omnimux-client.git',
    directory: 'plugins/plugins/omnimux',
  },
}

const NOT_PUBLISHED = { status: 1, stderr: 'npm error code E404\nnpm error 404 Not Found' }
const PUBLISHED = { status: 0, stdout: '0.1.8\n' }

function makeDeps(overrides = {}) {
  return {
    readFile: () => JSON.stringify(overrides.manifest ?? MANIFEST),
    gitBranch: () => 'main',
    gitStatus: () => '',
    gitRemoteUrl: () => 'https://github.com/omnimux-ai/omnimux-client.git',
    verifySource: () => ({ ok: true, problems: [] }),
    npmView: () => overrides.view ?? NOT_PUBLISHED,
    actionlint: () => overrides.lint ?? { status: 'pass', output: '' },
    ...overrides.deps,
  }
}

function runCheck(overrides = {}) {
  return runReleaseCheck({
    packageDir: 'plugins/plugins/omnimux',
    repoRoot: '/repo',
    allowPublished: overrides.allowPublished ?? false,
    deps: makeDeps(overrides),
  })
}

const failedIds = result => result.results.filter(item => item.status === 'fail').map(item => item.id)

test('parseArguments defaults to plugins/plugins/omnimux and accepts a package name or a path', () => {
  assert.deepEqual(parseArguments([]), { mode: 'single', packageDir: 'plugins/plugins/omnimux', allowPublished: false, json: false })
  assert.deepEqual(parseArguments(['omnimux']), { mode: 'single', packageDir: 'plugins/plugins/omnimux', allowPublished: false, json: false })
  assert.deepEqual(parseArguments(['plugins/plugins/omnimux']), { mode: 'single', packageDir: 'plugins/plugins/omnimux', allowPublished: false, json: false })
  assert.deepEqual(parseArguments(['./plugins/plugins/omnimux/']), { mode: 'single', packageDir: 'plugins/plugins/omnimux', allowPublished: false, json: false })
  assert.deepEqual(parseArguments(['omnimux', '--allow-published']), { mode: 'single', packageDir: 'plugins/plugins/omnimux', allowPublished: true, json: false })
})

test('parseArguments supports --all and --list for the whole release set', () => {
  assert.deepEqual(parseArguments(['--all']), { mode: 'all', packageDir: null, allowPublished: false, json: false })
  assert.deepEqual(parseArguments(['--all', '--allow-published']), { mode: 'all', packageDir: null, allowPublished: true, json: false })
  assert.deepEqual(parseArguments(['--list']), { mode: 'list', packageDir: null, allowPublished: false, json: false })
  assert.deepEqual(parseArguments(['--list', '--json']), { mode: 'list', packageDir: null, allowPublished: false, json: true })
  assert.throws(() => parseArguments(['--all', '--list']), /不能同时使用/)
  assert.throws(() => parseArguments(['--all', 'omnimux']), /不接受包参数/)
  assert.throws(() => parseArguments(['--json']), /只能与 --list/)
})

test('parseArguments rejects unknown flags, extra positional arguments and out-of-repo paths', () => {
  assert.throws(() => parseArguments(['--nope']), /未知参数/)
  assert.throws(() => parseArguments(['omnimux', 'other']), /只接受一个包参数/)
  assert.throws(() => parseArguments(['../outside']), /包路径必须是 plugins\/plugins\/<name>/)
  assert.throws(() => parseArguments(['/abs/path']), /包路径必须是 plugins\/plugins\/<name>/)
  assert.throws(() => parseArguments(['plugins/omnimux']), /包路径必须是 plugins\/plugins\/<name>/)
})

test('normalizeRepositoryUrl folds the forms npm writes into one https url', () => {
  const expected = 'https://github.com/omnimux-ai/omnimux-client'
  for (const raw of [
    'git+https://github.com/omnimux-ai/omnimux-client.git',
    'https://github.com/omnimux-ai/omnimux-client',
    'https://github.com/omnimux-ai/omnimux-client/',
    'git@github.com:omnimux-ai/omnimux-client.git',
    'ssh://git@github.com/omnimux-ai/omnimux-client.git',
    'github:omnimux-ai/omnimux-client',
  ]) {
    assert.equal(normalizeRepositoryUrl(raw), expected, raw)
  }
  assert.equal(normalizeRepositoryUrl(undefined), '')
  assert.equal(normalizeRepositoryUrl(''), '')
})

test('checkManifest accepts the shipped manifest shape', () => {
  assert.deepEqual(
    checkManifest({ manifest: MANIFEST, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' }),
    [],
  )
})

test('checkManifest requires repository, git type, matching origin and monorepo directory', () => {
  const withoutRepository = { name: 'omnimux', version: '0.1.8' }
  assert.match(checkManifest({ manifest: withoutRepository, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' })[0], /缺少 repository/)

  const wrongType = { ...MANIFEST, repository: { ...MANIFEST.repository, type: 'svn' } }
  assert.match(checkManifest({ manifest: wrongType, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' })[0], /repository\.type/)

  const wrongUrl = { ...MANIFEST, repository: { ...MANIFEST.repository, url: 'git+https://github.com/other/repo.git' } }
  assert.match(checkManifest({ manifest: wrongUrl, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' })[0], /与 origin 不一致/)

  const wrongDirectory = { ...MANIFEST, repository: { ...MANIFEST.repository, directory: 'plugins/other' } }
  assert.match(checkManifest({ manifest: wrongDirectory, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' })[0], /repository\.directory 与包目录不一致/)

  const emptyDirectory = { ...MANIFEST, repository: { type: 'git', url: MANIFEST.repository.url } }
  assert.match(checkManifest({ manifest: emptyDirectory, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' })[0], /repository\.directory 为空/)
})

test('checkManifest rejects a missing name or a non-semver version', () => {
  const problems = checkManifest({
    manifest: { version: 'latest', repository: MANIFEST.repository },
    packageDir: 'plugins/plugins/omnimux',
    remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git',
  })
  assert.ok(problems.some(problem => /缺少 name/.test(problem)))
  assert.ok(problems.some(problem => /不是合法 semver/.test(problem)))
})

test('checkManifest rejects machine-local specifiers that npm would ship verbatim', () => {
  const remoteUrl = 'https://github.com/omnimux-ai/omnimux-client.git'
  const manifest = {
    ...MANIFEST,
    dependencies: { 'dsh-ui-kit': 'file:../../packages/dsh-ui-kit' },
    optionalDependencies: { 'omnimux-products': 'workspace:^0.1.0' },
    peerDependencies: { 'omnimux-video': 'link:../omnimux-video' },
    devDependencies: { '@omnimux/form-contract': 'file:../../packages/form-contract' },
  }
  const problems = checkManifest({ manifest, packageDir: 'plugins/plugins/omnimux', remoteUrl })
  assert.equal(problems.length, 3)
  assert.ok(problems.some(problem => /dependencies\.dsh-ui-kit/.test(problem)))
  assert.ok(problems.some(problem => /optionalDependencies\.omnimux-products/.test(problem)))
  assert.ok(problems.some(problem => /peerDependencies\.omnimux-video/.test(problem)))
  assert.ok(!problems.some(problem => /devDependencies/.test(problem)))
})

test('checkManifest accepts published semver ranges for workspace packages', () => {
  const manifest = {
    ...MANIFEST,
    dependencies: { 'dsh-ui-kit': '^0.1.0', 'omnimux-products': '^0.1.2' },
    devDependencies: { '@omnimux/form-contract': 'file:../../packages/form-contract' },
  }
  assert.deepEqual(
    checkManifest({ manifest, packageDir: 'plugins/plugins/omnimux', remoteUrl: 'https://github.com/omnimux-ai/omnimux-client.git' }),
    [],
  )
})

test('listPublishablePackages lists only non-private omnimux packages, sorted by directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-check-'))
  try {
    const plugins = join(root, 'plugins', 'plugins')
    const writeManifest = (dir, manifest) => {
      mkdirSync(join(plugins, dir), { recursive: true })
      writeFileSync(join(plugins, dir, 'package.json'), JSON.stringify(manifest))
    }
    writeManifest('omnimux-workflow', { name: 'omnimux-workflow', version: '1.0.0-rc.3' })
    writeManifest('omnimux-accounts', { name: 'omnimux-accounts', version: '0.1.3' })
    writeManifest('private-tool', { name: 'omnimux-private', version: '1.0.0', private: true })
    writeManifest('other', { name: 'other-tool', version: '1.0.0' })
    mkdirSync(join(plugins, 'no-manifest'), { recursive: true })
    assert.deepEqual(listPublishablePackages(root), ['plugins/plugins/omnimux-accounts', 'plugins/plugins/omnimux-workflow'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listPublishablePackages returns an empty list when the plugin tree is absent', () => {
  assert.deepEqual(listPublishablePackages(join(tmpdir(), 'release-check-missing-root')), [])
})

test('every publishable package in this repository carries publishable metadata and semver-only runtime deps', () => {
  const packageDirs = listPublishablePackages(REPO_ROOT)
  assert.ok(packageDirs.length >= 12, `expected at least 12 publishable packages, got ${packageDirs.length}`)
  for (const packageDir of packageDirs) {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, packageDir, 'package.json'), 'utf8'))
    assert.deepEqual(
      checkManifest({ manifest, packageDir, remoteUrl: 'git+https://github.com/omnimux-ai/omnimux-client.git' }),
      [],
      packageDir,
    )
  }
})

test('classifyPublishState separates published, missing and unknown registry answers', () => {
  assert.equal(classifyPublishState({ name: 'omnimux', version: '0.1.8', view: PUBLISHED }).state, 'published')
  assert.equal(classifyPublishState({ name: 'omnimux', version: '0.1.8', view: NOT_PUBLISHED }).state, 'missing')
  assert.equal(classifyPublishState({ name: 'omnimux', version: '0.1.8', view: { status: 1, stderr: 'E500 internal error' } }).state, 'unknown')
  assert.equal(classifyPublishState({ name: 'omnimux', version: '0.1.8', view: { status: null, errorCode: 'ENOENT' } }).state, 'unknown')
})

test('runReleaseCheck passes when the tree is clean, metadata matches and the version is unpublished', () => {
  const result = runCheck()
  assert.equal(result.ok, true)
  assert.deepEqual(failedIds(result), [])
  assert.deepEqual(result.results.filter(item => item.status === 'pass').map(item => item.id), ['tree', 'manifest', 'source', 'npm', 'actionlint'])
  assert.deepEqual(result.results.find(item => item.id === 'branch'), { id: 'branch', status: 'info', message: '当前分支：main' })
})

test('runReleaseCheck fails on uncommitted tracked files', () => {
  const result = runCheck({ deps: { gitStatus: () => ' M plugins/plugins/omnimux/package.json\n' } })
  assert.equal(result.ok, false)
  assert.deepEqual(failedIds(result), ['tree'])
  assert.match(result.results.find(item => item.id === 'tree').message, /未提交改动/)
})

test('runReleaseCheck fails when verify-publish-source reports a problem', () => {
  const result = runCheck({ deps: { verifySource: () => ({ ok: false, problems: ['version 0.1.8 is not committed'] }) } })
  assert.equal(result.ok, false)
  assert.deepEqual(failedIds(result), ['source'])
  assert.equal(result.results.find(item => item.id === 'source').message, 'version 0.1.8 is not committed')
})

test('an already published version fails by default and only warns with --allow-published', () => {
  const strict = runCheck({ view: PUBLISHED })
  assert.equal(strict.ok, false)
  assert.deepEqual(failedIds(strict), ['npm'])
  assert.match(strict.results.find(item => item.id === 'npm').message, /不能重复发布/)

  const lenient = runCheck({ view: PUBLISHED, allowPublished: true })
  assert.equal(lenient.ok, true)
  assert.equal(lenient.results.find(item => item.id === 'npm').status, 'skip')
})

test('an unknown npm answer fails instead of passing silently', () => {
  const result = runCheck({ view: { status: 1, stderr: 'npm error network request failed' } })
  assert.equal(result.ok, false)
  assert.deepEqual(failedIds(result), ['npm'])
  assert.match(result.results.find(item => item.id === 'npm').message, /无法确认 npm 发布状态/)
})

test('a missing manifest file is reported as a failure', () => {
  const result = runCheck({
    deps: {
      readFile: () => {
        throw new Error('ENOENT: no such file')
      },
    },
  })
  assert.equal(result.ok, false)
  assert.ok(failedIds(result).includes('manifest'))
  assert.match(result.results.find(item => item.id === 'manifest').message, /无法读取 plugins\/plugins\/omnimux\/package\.json/)
})

test('runReleaseCheckAll fails when any package fails and keeps per-package results', () => {
  const deps = {
    ...makeDeps(),
    npmView: ({ name }) => (name === 'omnimux-accounts' ? PUBLISHED : NOT_PUBLISHED),
    readFile: path => JSON.stringify(path.endsWith('omnimux-accounts/package.json')
      ? { ...MANIFEST, name: 'omnimux-accounts', version: '0.1.3', repository: { ...MANIFEST.repository, directory: 'plugins/plugins/omnimux-accounts' } }
      : MANIFEST),
  }
  const result = runReleaseCheckAll({
    packageDirs: ['plugins/plugins/omnimux', 'plugins/plugins/omnimux-accounts'],
    repoRoot: '/repo',
    deps,
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.packages.map(item => item.packageDir), ['plugins/plugins/omnimux', 'plugins/plugins/omnimux-accounts'])
  assert.equal(result.packages[0].ok, true)
  assert.equal(result.packages[1].ok, false)
  assert.deepEqual(failedIds(result.packages[1]), ['npm'])
})

test('runReleaseCheckAll passes when every package is publishable', () => {
  const accountsManifest = {
    ...MANIFEST,
    name: 'omnimux-accounts',
    version: '0.1.3',
    repository: { ...MANIFEST.repository, directory: 'plugins/plugins/omnimux-accounts' },
  }
  const result = runReleaseCheckAll({
    packageDirs: ['plugins/plugins/omnimux', 'plugins/plugins/omnimux-accounts'],
    repoRoot: '/repo',
    deps: {
      ...makeDeps(),
      readFile: path => JSON.stringify(path.endsWith('omnimux-accounts/package.json') ? accountsManifest : MANIFEST),
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.packages.length, 2)
})

test('actionlint is reported as skipped when unavailable and as a failure when it reports errors', () => {
  const skipped = runCheck({ lint: { status: 'skip' } })
  assert.equal(skipped.ok, true)
  assert.equal(skipped.results.find(item => item.id === 'actionlint').status, 'skip')

  const failing = runCheck({ lint: { status: 'fail', output: 'workflow.yml:3:1: unexpected key' } })
  assert.equal(failing.ok, false)
  assert.deepEqual(failedIds(failing), ['actionlint'])
  assert.match(failing.results.find(item => item.id === 'actionlint').message, /unexpected key/)
})

test('formatResults renders one pass/fail/skip line per check', () => {
  const lines = formatResults([
    { status: 'pass', message: 'ok' },
    { status: 'fail', message: 'broken' },
    { status: 'skip', message: 'skipped' },
    { status: 'info', message: 'note' },
  ]).split('\n')
  assert.deepEqual(lines, ['✓ ok', '✗ broken', '- skipped', 'ℹ note'])
})
