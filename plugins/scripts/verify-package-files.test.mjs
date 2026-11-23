import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isPathCoveredByFiles, verifyPackageFiles, verifyPluginDisplayMeta } from './verify-package-files.mjs'

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

describe('verifyPluginDisplayMeta', () => {
  const writeLocalizedPlugin = (root, name, pkg, locales = {}) => {
    const dir = join(root, 'plugins', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
    if (Object.keys(locales).length > 0) {
      mkdirSync(join(dir, 'locale'), { recursive: true })
      for (const [lang, content] of Object.entries(locales)) {
        writeFileSync(join(dir, 'locale', `${lang}.json`), typeof content === 'string' ? content : JSON.stringify(content, null, 2))
      }
    }
  }

  it('passes when plugin exports locale/{en,zh}.json with valid concise metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-meta-ok-'))
    try {
      writeLocalizedPlugin(root, 'omnimux-demo', {
        name: 'omnimux-demo',
        description: 'Manage demo items.',
        exports: { '.': './src/index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
        files: ['src', 'locale'],
      }, {
        en: { meta: { title: 'Demo Tools', description: 'Manage demo items.' } },
        zh: { meta: { title: '演示工具', description: '管理演示项目。' } },
      })
      const { errors, auditedCount } = verifyPluginDisplayMeta(root)
      assert.equal(auditedCount, 1)
      assert.deepEqual(errors, [])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects missing zh locale, missing export, raw slug title, middle-dot, and mismatched description', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-meta-bad-'))
    try {
      writeLocalizedPlugin(root, 'omnimux-bad', {
        name: 'omnimux-bad',
        description: 'Different fallback description.',
        exports: { '.': './src/index.js', './package.json': './package.json' },
        files: ['src'],
      }, {
        en: { meta: { title: 'omnimux-bad', description: 'A · B description.' } },
      })
      const { errors } = verifyPluginDisplayMeta(root)
      assert.ok(errors.some(e => e.includes('./locale/*.json')), 'must flag missing locale export')
      assert.ok(errors.some(e => e.includes('locale/zh.json')), 'must flag missing zh.json')
      assert.ok(errors.some(e => e.includes('files 白名单')), 'must flag locale not covered by files')
      assert.ok(errors.some(e => e.includes('包名 slug')), 'must flag raw slug title')
      assert.ok(errors.some(e => e.includes('中点')), 'must flag middle-dot separator')
      assert.ok(errors.some(e => e.includes('不一致')), 'must flag package.json.description drift')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects empty files array, negated locale entry, and embedded newlines', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-meta-edge-'))
    try {
      writeLocalizedPlugin(root, 'custom-plugin', {
        name: '@scope/custom-plugin',
        description: 'Line one\nLine two.',
        exports: { '.': './src/index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
        files: [],
      }, {
        en: { meta: { title: '@scope/custom-plugin', description: 'Line one\nLine two.' } },
        zh: { meta: { title: '自定义插件', description: '单行描述。' } },
      })
      const { errors } = verifyPluginDisplayMeta(root)
      assert.ok(errors.some(e => e.includes('files 白名单')), 'must reject explicit empty files array')
      assert.ok(errors.some(e => e.includes('换行符')), 'must reject embedded newlines')
      assert.ok(errors.some(e => e.includes('包名 slug')), 'must reject package name as title')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes on all 13 live plugins and verifies Node exports resolve locale/{en,zh}.json', () => {
    const here = new URL('.', import.meta.url).pathname
    const liveRoot = join(here, '..')
    const { errors, auditedCount } = verifyPluginDisplayMeta(liveRoot)
    assert.equal(auditedCount, 13, 'should audit all 13 shipped plugins')
    assert.deepEqual(errors, [], 'live plugin display metadata must be clean: ' + errors.join('; '))

    // Verify each plugin self-reference export resolves through real Node exports rules
    const pluginsDir = join(liveRoot, 'plugins')
    const dirs = readdirSync(pluginsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort()
    assert.equal(dirs.length, 13)
    for (const dir of dirs) {
      const pkgDir = join(pluginsDir, dir)
      const pkgPath = join(pkgDir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const req = createRequire(pkgPath)
      assert.equal(req.resolve(`${pkg.name}/package.json`), pkgPath, `${dir} resolves ./package.json`)
      for (const lang of ['en', 'zh']) {
        const expectedLocalePath = join(pkgDir, 'locale', `${lang}.json`)
        assert.equal(req.resolve(`${pkg.name}/locale/${lang}.json`), expectedLocalePath, `${dir} resolves ./locale/${lang}.json`)
        const localeDoc = JSON.parse(readFileSync(expectedLocalePath, 'utf8'))
        assert.ok(localeDoc.meta.title && localeDoc.meta.description, `${dir} has valid ${lang} meta`)
      }
    }
  })
})
