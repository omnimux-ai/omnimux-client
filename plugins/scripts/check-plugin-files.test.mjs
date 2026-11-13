import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkPlugin,
  collectRelativeImportClosure,
  extractRelativeSpecifiers,
  missingFromPack,
  packFilesFromNpmJson,
  resolveMainEntry,
  stripComments,
} from './check-plugin-files.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins')

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
}

describe('stripComments / extractRelativeSpecifiers', () => {
  it('ignores commented-out relative imports', () => {
    const source = `
      // import { x } from './dead.js'
      /* import { y } from './block.js' */
      import { live } from './live.js'
      const dyn = await import('./dyn.js')
      const cjs = require('./cjs.js')
    `
    assert.deepEqual(extractRelativeSpecifiers(source), ['./live.js', './dyn.js', './cjs.js'])
  })

  it('does not treat protocol-relative URLs as relative imports', () => {
    const source = `import { x } from './ok.js'\nconst u = '//cdn.example/app.js'\n`
    assert.deepEqual(extractRelativeSpecifiers(source), ['./ok.js'])
    assert.equal(stripComments('keep // trail\ncode').includes('keep'), true)
  })

  it('picks JSON imports with import-attributes', () => {
    const source = `
      import manifest from '../../assets/brands/manifest.json' with { type: 'json' }
      const cards = await import('../../assets/minimax-showcase/creation-cards.json', { with: { type: 'json' } })
    `
    assert.deepEqual(extractRelativeSpecifiers(source), [
      '../../assets/brands/manifest.json',
      '../../assets/minimax-showcase/creation-cards.json',
    ])
  })
})

describe('collectRelativeImportClosure', () => {
  it('walks the Host graph and skips node: / package imports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-files-'))
    try {
      writeTree(dir, {
        'src/index.js': `
          import { join } from 'node:path'
          import { paths } from './paths.js'
          import { store } from './local-store.js'
        `,
        'src/paths.js': 'export const paths = {}\n',
        'src/local-store.js': "import { paths } from './paths.js'\nexport const store = {}\n",
        'src/orphan.js': 'export const unused = 1\n',
      })
      const { files, unresolved } = collectRelativeImportClosure(join(dir, 'src/index.js'), dir)
      assert.deepEqual(files, ['src/index.js', 'src/local-store.js', 'src/paths.js'])
      assert.deepEqual(unresolved, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports unresolved relative specs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-files-miss-'))
    try {
      writeTree(dir, {
        'src/index.js': "import { missing } from './nope.js'\n",
      })
      const { unresolved } = collectRelativeImportClosure(join(dir, 'src/index.js'), dir)
      assert.equal(unresolved.length, 1)
      assert.equal(unresolved[0].spec, './nope.js')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('missingFromPack / packFilesFromNpmJson', () => {
  it('flags Host modules dropped by a narrow files whitelist', () => {
    const missing = missingFromPack(
      ['src/index.js', 'src/paths.js', 'src/local-store.js'],
      ['src/index.js', 'src/client/index.js', 'lib/client.js'],
    )
    assert.deepEqual(missing, ['src/paths.js', 'src/local-store.js'])
  })

  it('accepts a directory-level pack entry', () => {
    assert.deepEqual(missingFromPack(['src/index.js', 'src/paths.js'], ['src']), [])
  })

  it('parses npm pack --json file lists', () => {
    const files = packFilesFromNpmJson(JSON.stringify([
      {
        filename: 'omnimux-inspiration-0.1.0.tgz',
        files: [
          { path: 'package.json', size: 10 },
          { path: 'src/index.js', size: 20 },
          { path: 'src/paths.js', size: 30 },
        ],
      },
    ]))
    assert.deepEqual(files, ['package.json', 'src/index.js', 'src/paths.js'])
  })
})

describe('checkPlugin', () => {
  it('fails when pack files omit the Host closure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-files-check-'))
    try {
      writeTree(dir, {
        'package.json': JSON.stringify({
          name: 'fixture-narrow-files',
          type: 'module',
          main: 'src/index.js',
          files: ['src/index.js'],
        }),
        'src/index.js': "import { paths } from './paths.js'\nexport function apply() {}\n",
        'src/paths.js': 'export const paths = {}\n',
      })
      const result = checkPlugin(dir, { packFiles: ['src/index.js', 'package.json'] })
      assert.equal(result.ok, false)
      assert.deepEqual(result.missing, ['src/paths.js'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when pack files cover the Host closure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-files-ok-'))
    try {
      writeTree(dir, {
        'package.json': JSON.stringify({
          name: 'fixture-src-dir',
          type: 'module',
          main: 'src/index.js',
          files: ['src'],
        }),
        'src/index.js': "import { paths } from './paths.js'\nexport function apply() {}\n",
        'src/paths.js': 'export const paths = {}\n',
      })
      const result = checkPlugin(dir, {
        packFiles: ['package.json', 'src/index.js', 'src/paths.js'],
      })
      assert.equal(result.ok, true)
      assert.deepEqual(result.needed, ['src/index.js', 'src/paths.js'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves main from package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-files-main-'))
    try {
      writeTree(dir, {
        'package.json': JSON.stringify({ name: 'x', main: 'src/index.js' }),
        'src/index.js': 'export function apply() {}\n',
      })
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      assert.equal(resolveMainEntry(pkg, dir), join(dir, 'src/index.js'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('live plugins (pack coverage)', () => {
  it('omnimux-inspiration Host closure includes paths.js', () => {
    const root = join(fixturesRoot, 'omnimux-inspiration')
    const { files } = collectRelativeImportClosure(join(root, 'src/index.js'), root)
    assert.ok(files.includes('src/paths.js'), files.join(','))
    assert.ok(files.includes('src/local-store.js'))
    assert.ok(files.includes('src/http-routes.js'))
  })

  it('omnimux-accounts Host entry is self-contained', () => {
    const root = join(fixturesRoot, 'omnimux-accounts')
    const { files, unresolved } = collectRelativeImportClosure(join(root, 'src/index.js'), root)
    assert.deepEqual(files, ['src/index.js'])
    assert.deepEqual(unresolved, [])
  })
})
