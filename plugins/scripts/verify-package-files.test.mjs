import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isPathCoveredByFiles, verifyPackageFiles } from './verify-package-files.mjs'

describe('isPathCoveredByFiles', () => {
  it('matches exact and ancestor directory patterns', () => {
    assert.equal(isPathCoveredByFiles('src/index.js', ['src']), true)
    assert.equal(isPathCoveredByFiles('src/events/hub.js', ['src']), true)
    assert.equal(isPathCoveredByFiles('cordis.patch.yml', ['cordis.patch.yml']), true)
    assert.equal(isPathCoveredByFiles('lib/client.js', ['lib']), true)
    assert.equal(isPathCoveredByFiles('lib/client.js', ['lib/client.js']), true)
  })

  it('rejects uncovered paths', () => {
    assert.equal(isPathCoveredByFiles('src/events/hub.js', ['src/host', 'src/tools']), false)
    assert.equal(isPathCoveredByFiles('dist/index.js', ['src']), false)
  })

  it('treats empty files list as unrestricted', () => {
    assert.equal(isPathCoveredByFiles('anything', []), true)
  })
})

describe('verifyPackageFiles', () => {
  let root

  const writePlugin = (name, pkg, { withSrcIndex = true, extraDirs = [] } = {}) => {
    const dir = join(root, 'plugins', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
    if (withSrcIndex) {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'index.js'), 'export default {}\n')
    }
    for (const d of extraDirs) {
      mkdirSync(join(dir, d), { recursive: true })
      writeFileSync(join(dir, d, '.keep'), '')
    }
    if (pkg.dsh?.bundle?.patch) {
      const patch = pkg.dsh.bundle.patch.replace(/^\.\//, '')
      writeFileSync(join(dir, patch), '- id: x\n')
    }
  }

  it('passes when src-based plugin declares "src" holistically', () => {
    root = mkdtempSync(join(tmpdir(), 'pkg-files-ok-'))
    writePlugin('demo', {
      name: 'demo',
      main: 'src/index.js',
      files: ['src', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, { extraDirs: ['src/events'] })
    const { errors, auditedCount } = verifyPackageFiles(root)
    assert.equal(auditedCount, 1)
    assert.deepEqual(errors, [])
    rmSync(root, { recursive: true, force: true })
  })

  it('fails when src-based plugin fragments src subdirs without "src"', () => {
    root = mkdtempSync(join(tmpdir(), 'pkg-files-bad-'))
    writePlugin('hub', {
      name: 'hub',
      main: 'src/index.js',
      files: ['src/index.js', 'src/host', 'src/events', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, { extraDirs: ['src/host', 'src/events'] })
    const { errors } = verifyPackageFiles(root)
    assert.ok(errors.some(e => e.includes('hub') && e.includes('"src"')))
    rmSync(root, { recursive: true, force: true })
  })

  it('fails when files lists a missing non-build path', () => {
    root = mkdtempSync(join(tmpdir(), 'pkg-files-missing-'))
    writePlugin('prev', {
      name: 'prev',
      main: 'src/index.js',
      files: ['src', 'README.md'],
    })
    const { errors } = verifyPackageFiles(root)
    assert.ok(errors.some(e => e.includes('README.md') && e.includes('不存在')))
    rmSync(root, { recursive: true, force: true })
  })

  it('fails when main is not covered by files', () => {
    root = mkdtempSync(join(tmpdir(), 'pkg-files-main-'))
    writePlugin('built', {
      name: 'built',
      main: 'dist/index.js',
      files: ['src'],
    }, { withSrcIndex: false, extraDirs: ['src', 'dist'] })
    writeFileSync(join(root, 'plugins', 'built', 'dist', 'index.js'), 'export default {}\n')
    const { errors } = verifyPackageFiles(root)
    assert.ok(errors.some(e => e.includes('主入口') || e.includes('main')))
    rmSync(root, { recursive: true, force: true })
  })

  it('passes on the live monorepo after omnimux files consolidation', () => {
    const here = new URL('.', import.meta.url).pathname
    // scripts/ -> repo root
    const liveRoot = join(here, '..')
    const { errors, auditedCount } = verifyPackageFiles(liveRoot)
    assert.ok(auditedCount >= 8, 'should audit multiple plugins')
    assert.deepEqual(errors, [], 'live monorepo must be clean: ' + errors.join('; '))
  })
})
