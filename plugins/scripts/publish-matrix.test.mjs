import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTIONS,
  buildPlan,
  orderByDependencies,
  parseArguments,
  resolvePackageSelection,
} from './publish-matrix.mjs'

const DIRS = {
  omnimux: 'plugins/plugins/omnimux',
  products: 'plugins/plugins/omnimux-products',
  assets: 'plugins/plugins/omnimux-assets',
}

const MANIFESTS = {
  [DIRS.omnimux]: { name: 'omnimux', version: '0.1.8' },
  [DIRS.products]: {
    name: 'omnimux-products',
    version: '0.1.2',
    dependencies: { 'dsh-ui-kit': '^0.1.0' },
  },
  [DIRS.assets]: {
    name: 'omnimux-assets',
    version: '0.2.2',
    dependencies: { 'omnimux-products': '^0.1.2' },
  },
}

const PACKAGE_DIRS = Object.values(DIRS)
const PUBLISHED = new Set(['omnimux@0.1.8'])
const view = ({ name, version }) => (
  PUBLISHED.has(`${name}@${version}`)
    ? { status: 0, stdout: `${version}\n` }
    : { status: 1, stderr: 'npm error code E404\nnpm error 404 Not Found' }
)

function plan(options = {}) {
  return buildPlan({
    packages: 'all',
    dryRun: true,
    packageDirs: PACKAGE_DIRS,
    readManifest: dir => MANIFESTS[dir],
    npmView: view,
    ...options,
  })
}

test('parseArguments defaults to all packages and dry-run true', () => {
  assert.deepEqual(parseArguments([]), { packages: 'all', dryRun: true, help: false })
  assert.deepEqual(parseArguments(['--packages', 'omnimux-accounts,omnimux-video', '--dry-run', 'false']), {
    packages: 'omnimux-accounts,omnimux-video',
    dryRun: false,
    help: false,
  })
  assert.equal(parseArguments(['--packages=all', '--dry-run=false']).dryRun, false)
  assert.equal(parseArguments(['--dry-run']).dryRun, true)
  assert.equal(parseArguments(['--help']).help, true)
})

test('parseArguments rejects unknown flags and non-boolean dry-run values', () => {
  assert.throws(() => parseArguments(['--nope']), /未知参数/)
  assert.throws(() => parseArguments(['--packages']), /需要一个值/)
  assert.throws(() => parseArguments(['--dry-run=yes']), /只接受 true 或 false/)
})

test('resolvePackageSelection accepts all, names and directories but rejects unknown or duplicate packages', () => {
  assert.deepEqual(resolvePackageSelection('all', PACKAGE_DIRS), { isAll: true, dirs: PACKAGE_DIRS })
  assert.deepEqual(resolvePackageSelection('omnimux-products, omnimux-assets', PACKAGE_DIRS), {
    isAll: false,
    dirs: [DIRS.products, DIRS.assets],
  })
  assert.deepEqual(resolvePackageSelection('plugins/plugins/omnimux-assets', PACKAGE_DIRS), {
    isAll: false,
    dirs: [DIRS.assets],
  })
  assert.throws(() => resolvePackageSelection('omnimux-missing', PACKAGE_DIRS), /未知包/)
  assert.throws(() => resolvePackageSelection('omnimux-assets,omnimux-assets', PACKAGE_DIRS), /重复包/)
})

test('dry-run includes unpublished packages as publish-dry-run and published packages as pack-dry-run', () => {
  const result = plan()
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.include.map(item => [item.package, item.action]), [
    ['omnimux', ACTIONS.PACK_DRY_RUN],
    ['omnimux-products', ACTIONS.PUBLISH_DRY_RUN],
    ['omnimux-assets', ACTIONS.PUBLISH_DRY_RUN],
  ])
})

test('real all skips already published packages with a warning and keeps dependency order', () => {
  const result = plan({ dryRun: false })
  assert.deepEqual(result.warnings, ['omnimux@0.1.8 已发布，真实发布时跳过'])
  assert.deepEqual(result.include.map(item => item.package), ['omnimux-products', 'omnimux-assets'])
  assert.ok(result.include.every(item => item.action === ACTIONS.PUBLISH))
  assert.ok(result.include.findIndex(item => item.package === 'omnimux-products')
    < result.include.findIndex(item => item.package === 'omnimux-assets'))
})

test('real explicit selection of an already published package fails instead of silently skipping', () => {
  assert.throws(() => plan({ packages: 'omnimux', dryRun: false }), /已在 npm 发布/)
})

test('dry-run explicit selection of a published package uses pack-dry-run', () => {
  const result = plan({ packages: 'omnimux', dryRun: true })
  assert.deepEqual(result.include, [{
    package: 'omnimux',
    dir: DIRS.omnimux,
    version: '0.1.8',
    action: ACTIONS.PACK_DRY_RUN,
  }])
})

test('unknown npm state fails closed', () => {
  assert.throws(
    () => plan({ npmView: () => ({ status: 1, stderr: 'npm error network failure' }) }),
    /无法确认/,
  )
})

test('orderByDependencies rejects cycles', () => {
  const manifests = new Map([
    ['a', { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } }],
    ['b', { name: 'b', version: '1.0.0', dependencies: { a: '1.0.0' } }],
  ])
  assert.throws(
    () => orderByDependencies([
      { package: 'a', dir: 'a', version: '1.0.0', action: ACTIONS.PUBLISH },
      { package: 'b', dir: 'b', version: '1.0.0', action: ACTIONS.PUBLISH },
    ], manifests),
    /依赖存在环/,
  )
})

test('an empty selection fails rather than returning an empty matrix', () => {
  assert.throws(() => resolvePackageSelection('', PACKAGE_DIRS), /不能为空/)
  assert.throws(() => buildPlan({
    packages: 'all',
    dryRun: true,
    packageDirs: [],
    readManifest: () => { throw new Error('must not read') },
    npmView: () => { throw new Error('must not query') },
  }), /没有可发布的包/)
})

test('dependency order is independent of the selected packageDirs order', () => {
  const result = plan({
    dryRun: false,
    packageDirs: [DIRS.omnimux, DIRS.assets, DIRS.products],
  })
  assert.deepEqual(result.include.map(item => item.package), ['omnimux-products', 'omnimux-assets'])
})
