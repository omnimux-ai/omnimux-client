import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createLibraryStore } from './library.js'
import { createMappingStore } from './mappings.js'
import { AssetsError } from './mappings.js'
import { DISK_HEADROOM_BYTES, copyIntoVault } from './ingest.js'

let root
let realFile

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-library-'))
  realFile = join(root, 'hero.png')
  writeFileSync(realFile, 'png')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeStore() {
  return createLibraryStore({
    paths: {
      dir: join(root, 'store'),
      libraryFile: join(root, 'store', 'library.json'),
      filesDir: join(root, 'store', 'data', 'files'),
    },
  })
}

describe('LibraryStore add/list', () => {
  it('creates a named character with no files', async () => {
    const store = makeStore()
    const asset = await store.add({ name: '林晓', type: 'character', description: '冷白皮长直发' })
    assert.match(asset.id, /^ast_[0-9a-f]{8}$/)
    assert.equal(asset.type, 'character')
    assert.equal(asset.handle, '林晓')
    assert.equal(asset.cite, '@角色/林晓')
    assert.equal(asset.files.length, 0)
    assert.equal(store.revision(), 1)
  })

  it('falls into custom when type is omitted', async () => {
    const store = makeStore()
    const asset = await store.add({ name: '未分类草稿' })
    assert.equal(asset.type, 'custom')
  })

  it('rejects blank names, slashes, and duplicates', async () => {
    const store = makeStore()
    await assert.rejects(() => store.add({ name: '  ' }), (error) => error.code === 'name-required')
    await assert.rejects(() => store.add({ name: 'a/b' }), (error) => error.code === 'name-invalid')
    await store.add({ name: '林晓', type: 'character' })
    await assert.rejects(() => store.add({ name: '林晓', type: 'scene' }), (error) => error.code === 'name-conflict')
  })

  it('search hits description and tags', async () => {
    const store = makeStore()
    await store.add({ name: '林晓', type: 'character', description: '冷白皮', tags: ['女主'] })
    await store.add({ name: '雨夜便利店', type: 'scene', description: '霓虹' })
    assert.equal(store.list({ query: '冷白' }).length, 1)
    assert.equal(store.list({ query: '女主' })[0].name, '林晓')
    assert.equal(store.list({ type: 'scene' }).length, 1)
  })
})

describe('LibraryStore copy-on-ingest', () => {
  it('copies the source and keeps serving after the original is deleted', async () => {
    const store = makeStore()
    const asset = await store.add({
      name: '定妆',
      type: 'character',
      files: [{ real_path: realFile }],
    })
    assert.equal(asset.files.length, 1)
    assert.equal(asset.files[0].relative_path.startsWith(`data/files/${asset.id}/`), true)
    assert.equal(asset.files[0].relative_path.includes('/Users'), false)
    assert.notEqual(asset.files[0].real_path, realFile)
    assert.equal(readFileSync(asset.files[0].real_path, 'utf8'), 'png')
    const ledger = JSON.parse(readFileSync(join(root, 'store', 'library.json'), 'utf8'))
    assert.equal(JSON.stringify(ledger).includes('/Users'), false)
    assert.equal(ledger.assets[0].files[0].relative_path, asset.files[0].relative_path)
    assert.equal(ledger.assets[0].files[0].real_path, undefined)

    rmSync(realFile)
    const view = store.getView(asset.id)
    assert.equal(view.files.length, 1)
    assert.equal(readFileSync(view.files[0].real_path, 'utf8'), 'png')
  })

  it('skips missing paths on create and hides files whose managed copy vanishes', async () => {
    const store = makeStore()
    const missingAtCreate = join(root, 'never-there.jpg')
    const asset = await store.add({
      name: '定妆',
      type: 'character',
      files: [{ real_path: realFile }, { real_path: missingAtCreate }],
    })
    assert.equal(asset.files.length, 1)

    const gone = join(root, 'gone.jpg')
    writeFileSync(gone, 'jpg')
    const updated = await store.update(asset.id, { files: [{ real_path: realFile }, { real_path: gone }] })
    assert.equal(updated.files.length, 2)
    rmSync(updated.files[1].real_path)
    const view = store.getView(asset.id)
    assert.equal(view.files.length, 1)
    assert.equal(view.missing_file_count, 1)
    assert.equal(statSync(realFile).isFile(), true)
  })

  it('keeps a folder as one file ref and lists one directory layer at a time', async () => {
    const store = makeStore()
    const pack = join(root, 'pack')
    mkdirSync(join(pack, 'looks'), { recursive: true })
    writeFileSync(join(pack, 'cover.png'), 'png')
    writeFileSync(join(pack, 'looks', 'front.png'), 'png')
    const asset = await store.add({ name: '风格包A', type: 'style', files: [{ real_path: pack }] })
    assert.equal(asset.files.length, 1)
    assert.equal(asset.files[0].kind, 'directory')
    const rootLayer = store.listFileEntries(asset.id, asset.files[0].id, '')
    assert.equal(rootLayer.entries.some((row) => row.name === 'cover.png' && !row.is_dir), true)
    assert.equal(rootLayer.entries.some((row) => row.name === 'looks' && row.is_dir), true)
    assert.equal(rootLayer.entries.some((row) => row.name === 'front.png'), false)
    const nested = store.listFileEntries(asset.id, asset.files[0].id, 'looks')
    assert.deepEqual(nested.entries.map((row) => row.name), ['front.png'])
    const preview = store.resolvePreview(asset.id, asset.files[0].id, 'looks/front.png')
    assert.equal(preview.mime, 'image/png')
    assert.equal(preview.absolutePath.endsWith('front.png'), true)
    assert.throws(() => store.resolvePreview(asset.id, asset.files[0].id, ''), (error) => error.code === 'path-not-dir')
    assert.throws(
      () => store.listFileEntries(asset.id, asset.files[0].id, '../'),
      (error) => error.code === 'path-denied' || error.code === 'path-not-found',
    )
  })

  it('resolves an entry path for reveal without leaving the file root', async () => {
    const store = makeStore()
    const pack = join(root, 'pack-reveal')
    mkdirSync(join(pack, 'looks'), { recursive: true })
    writeFileSync(join(pack, 'cover.png'), 'png')
    writeFileSync(join(pack, 'looks', 'front.png'), 'png')
    const asset = await store.add({ name: '风格包B', type: 'style', files: [{ real_path: pack }] })
    const fileId = asset.files[0].id

    const folder = store.resolveEntryPath(asset.id, fileId, '')
    assert.equal(folder.isDirectory, true)
    assert.equal(folder.absolutePath.startsWith(join(root, 'store')), true)

    const nested = store.resolveEntryPath(asset.id, fileId, 'looks')
    assert.equal(nested.isDirectory, true)
    assert.equal(nested.absolutePath.endsWith('looks'), true)

    const file = store.resolveEntryPath(asset.id, fileId, 'cover.png')
    assert.equal(file.isDirectory, false)
    assert.equal(file.absolutePath.endsWith('cover.png'), true)

    assert.throws(() => store.resolveEntryPath(asset.id, fileId, '../../..'), (error) => error.code === 'path-denied')
    assert.throws(() => store.resolveEntryPath('ast_missing', fileId, ''), (error) => error.code === 'asset-not-found')
    assert.throws(() => store.resolveEntryPath(asset.id, 'nope', ''), (error) => error.code === 'path-not-found')

    const single = await store.add({ name: '单文件', type: 'custom', files: [{ real_path: realFile }] })
    assert.throws(
      () => store.resolveEntryPath(single.id, single.files[0].id, 'nested.png'),
      (error) => error.code === 'path-not-dir',
    )
    assert.equal(store.resolveEntryPath(single.id, single.files[0].id, '').isDirectory, false)
  })

  it('remove recycles the managed copy and never unlinks the original', async () => {
    const store = makeStore()
    const asset = await store.add({ name: '林晓', files: [{ real_path: realFile }] })
    const managed = asset.files[0].real_path
    assert.equal(existsSync(managed), true)
    store.remove(asset.id)
    assert.equal(store.list().length, 0)
    assert.equal(statSync(realFile).isFile(), true)
    assert.equal(existsSync(managed), false)
    assert.equal(existsSync(join(root, 'store', 'data', 'files', asset.id)), false)
  })
})

describe('LibraryStore mapping migrate', () => {
  it('turns each mapping into a custom path-ref asset then copies on list', async () => {
    const mappings = createMappingStore({
      paths: {
        mappingsFile: join(root, 'store', 'mappings.json'),
        scansDir: join(root, 'store', 'scans'),
      },
    })
    const dir = join(root, 'brand')
    mkdirSync(dir)
    writeFileSync(join(dir, 'logo.png'), 'png')
    mappings.add(dir, '品牌素材')
    const store = makeStore()
    const result = store.migrateMappings(mappings)
    assert.equal(result.migrated, 1)
    const listed = store.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].type, 'custom')
    assert.equal(listed[0].source, 'migrated-mapping')
    assert.equal(listed[0].files[0].relative_path.startsWith(`data/files/${listed[0].id}/`), true)
    assert.notEqual(listed[0].files[0].real_path, dir)
    const second = store.migrateMappings(mappings)
    assert.equal(second.migrated, 0)
    assert.equal(store.list().length, 1)
  })
})

describe('copyIntoVault disk + escape', () => {
  it('throws disk-space-insufficient when free is below headroom', async () => {
    await assert.rejects(
      () => copyIntoVault({
        sourceAbs: realFile,
        destDir: join(root, 'store', 'data', 'files', 'ast_x'),
        vaultRoot: join(root, 'store'),
        statfs: () => ({ bavail: 1, bsize: 1 }),
      }),
      (error) => error instanceof AssetsError && error.code === 'disk-space-insufficient',
    )
    const copied = await copyIntoVault({
      sourceAbs: realFile,
      destDir: join(root, 'store', 'data', 'files', 'ast_ok'),
      vaultRoot: join(root, 'store'),
      statfs: () => ({ bavail: DISK_HEADROOM_BYTES + 10_000, bsize: 1 }),
    })
    assert.equal(copied.relativePath.startsWith('data/files/ast_ok/'), true)
  })

  it('refuses destinations that escape the vault', async () => {
    await assert.rejects(
      () => copyIntoVault({
        sourceAbs: realFile,
        destDir: join(root, 'outside'),
        vaultRoot: join(root, 'store'),
      }),
      (error) => error instanceof AssetsError && error.code === 'path-denied',
    )
  })
})

describe('LibraryStore managed text read/write and safety boundaries', () => {
  it('reads and writes managed .md/.txt copies while keeping source originals untouched', async () => {
    const store = makeStore()
    const srcDoc = join(root, 'SKILL.md')
    writeFileSync(srcDoc, '# 原始标题\n内容第一版', 'utf8')

    const asset = await store.add({
      name: '技能文档',
      type: 'knowledge',
      files: [{ real_path: srcDoc }],
    })
    const fileId = asset.files[0].id
    const revBefore = store.revision()

    const initial = await store.readTextFile(asset.id, fileId, '')
    assert.equal(initial.content, '# 原始标题\n内容第一版')
    assert.equal(initial.editable, true)
    assert.equal(initial.isMarkdown, true)
    assert.equal(initial.ext, '.md')
    assert.match(initial.etag, /^[0-9a-f]{64}$/)

    const saved = await store.writeTextFile(asset.id, fileId, '', {
      content: '# 更新标题\n内容第二版',
      expectedEtag: initial.etag,
    })
    assert.notEqual(saved.etag, initial.etag)
    assert.equal(store.revision(), revBefore + 1)

    const reread = await store.readTextFile(asset.id, fileId, '')
    assert.equal(reread.content, '# 更新标题\n内容第二版')
    assert.equal(reread.etag, saved.etag)
    // User original file on disk MUST remain completely untouched.
    assert.equal(readFileSync(srcDoc, 'utf8'), '# 原始标题\n内容第一版')
  })

  it('reads and writes nested text files inside folder assets and rejects path escapes / symlinks', async () => {
    const store = makeStore()
    const pack = join(root, 'doc-pack')
    mkdirSync(join(pack, 'sub'), { recursive: true })
    writeFileSync(join(pack, 'sub', 'notes.txt'), 'line 1\nline 2', 'utf8')
    const outsideSecret = join(root, 'outside.md')
    writeFileSync(outsideSecret, 'outside secret', 'utf8')

    const asset = await store.add({
      name: '文档包',
      type: 'knowledge',
      files: [{ real_path: pack }],
    })
    const fileId = asset.files[0].id
    const managedRoot = asset.files[0].real_path
    symlinkSync(outsideSecret, join(managedRoot, 'escape.md'))

    const nested = await store.readTextFile(asset.id, fileId, 'sub/notes.txt')
    assert.equal(nested.content, 'line 1\nline 2')
    assert.equal(nested.isMarkdown, false)
    assert.equal(nested.ext, '.txt')

    await store.writeTextFile(asset.id, fileId, 'sub/notes.txt', {
      content: 'updated notes',
      expectedEtag: nested.etag,
    })
    assert.equal((await store.readTextFile(asset.id, fileId, 'sub/notes.txt')).content, 'updated notes')

    await assert.rejects(
      () => store.readTextFile(asset.id, fileId, '../outside.md'),
      (error) => error.code === 'path-denied',
    )
    await assert.rejects(
      () => store.readTextFile(asset.id, fileId, 'escape.md'),
      (error) => error.code === 'path-denied',
    )
    await assert.rejects(
      () => store.writeTextFile(asset.id, fileId, 'escape.md', { content: 'hijack' }),
      (error) => error.code === 'path-denied',
    )
    assert.equal(readFileSync(outsideSecret, 'utf8'), 'outside secret')
  })

  it('enforces optimistic ETag concurrency, force overwrite, binary/size limits, and onRemoveAsset cleanup', async () => {
    const removedIds = []
    const store = createLibraryStore({
      paths: {
        dir: join(root, 'store-extra'),
        libraryFile: join(root, 'store-extra', 'library.json'),
        filesDir: join(root, 'store-extra', 'data', 'files'),
      },
      onRemoveAsset: (id) => { removedIds.push(id) },
    })

    const docPath = join(root, 'script.md')
    writeFileSync(docPath, 'v1', 'utf8')
    const binPath = join(root, 'fake.txt')
    writeFileSync(binPath, Buffer.from([0x61, 0x00, 0x62]))
    const bigPath = join(root, 'huge.md')
    writeFileSync(bigPath, 'a'.repeat(2 * 1024 * 1024 + 64), 'utf8')

    const asset = await store.add({ name: '剧本', files: [{ real_path: docPath }] })
    const fId = asset.files[0].id
    const v1 = await store.readTextFile(asset.id, fId, '')

    // Simulate external disk edit after read.
    writeFileSync(asset.files[0].real_path, 'external edit', 'utf8')

    await assert.rejects(
      () => store.writeTextFile(asset.id, fId, '', { content: 'user edit', expectedEtag: v1.etag }),
      (error) => error.code === 'file-conflict' && typeof error.currentEtag === 'string' && error.currentEtag !== v1.etag,
    )

    const forced = await store.writeTextFile(asset.id, fId, '', {
      content: 'user edit',
      expectedEtag: v1.etag,
      force: true,
    })
    assert.equal((await store.readTextFile(asset.id, fId, '')).content, 'user edit')
    assert.equal(typeof forced.etag, 'string')

    const binAsset = await store.add({ name: '坏文本', files: [{ real_path: binPath }] })
    await assert.rejects(
      () => store.readTextFile(binAsset.id, binAsset.files[0].id, ''),
      (error) => error.code === 'file-not-text',
    )

    const bigAsset = await store.add({ name: '超大文档', files: [{ real_path: bigPath }] })
    await assert.rejects(
      () => store.readTextFile(bigAsset.id, bigAsset.files[0].id, ''),
      (error) => error.code === 'file-too-large',
    )

    store.remove(asset.id)
    assert.deepEqual(removedIds, [asset.id])
  })

  it('blocks intra-folder symlink to non-allowlisted ext, managed single-file symlink escapes, external writes, and concurrent write races', async () => {
    const store = makeStore()

    // 1. Intra-folder symlink `note.md -> .env` must fail realpath extension check.
    const pack = join(root, 'symlink-pack')
    mkdirSync(pack, { recursive: true })
    writeFileSync(join(pack, '.env'), 'KEY=1\n', 'utf8')
    const packAsset = await store.add({ name: '符号链测试', files: [{ real_path: pack }] })
    const packFileId = packAsset.files[0].id
    symlinkSync(join(packAsset.files[0].real_path, '.env'), join(packAsset.files[0].real_path, 'note.md'))
    await assert.rejects(
      () => store.readTextFile(packAsset.id, packFileId, 'note.md'),
      (error) => error.code === 'path-unsupported',
    )

    // 2. Managed single-file replaced by symlink escaping vault must be denied on READ too.
    const singleOrig = join(root, 'single.md')
    const externalTxt = join(root, 'outside-secret.txt')
    writeFileSync(singleOrig, '# ok', 'utf8')
    writeFileSync(externalTxt, 'outside text', 'utf8')
    const singleAsset = await store.add({ name: '单文件符号链', files: [{ real_path: singleOrig }] })
    const managedSingle = singleAsset.files[0].real_path
    rmSync(managedSingle)
    symlinkSync(externalTxt, managedSingle)
    await assert.rejects(
      () => store.readTextFile(singleAsset.id, singleAsset.files[0].id, ''),
      (error) => error.code === 'path-denied',
    )

    // 3. Concurrent writeTextFile calls with identical expectedEtag serialize: 1 succeeds, 1 hits file-conflict.
    const raceOrig = join(root, 'race.md')
    writeFileSync(raceOrig, 'initial', 'utf8')
    const raceAsset = await store.add({ name: '并发写入', files: [{ real_path: raceOrig }] })
    const raceFileId = raceAsset.files[0].id
    const v0 = await store.readTextFile(raceAsset.id, raceFileId, '')
    const [r1, r2] = await Promise.allSettled([
      store.writeTextFile(raceAsset.id, raceFileId, '', { content: 'writer-A', expectedEtag: v0.etag }),
      store.writeTextFile(raceAsset.id, raceFileId, '', { content: 'writer-B', expectedEtag: v0.etag }),
    ])
    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled')
    const rejected = [r1, r2].filter((r) => r.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].reason.code, 'file-conflict')

    // 4. Unmaterialized legacy external file opens read-only and refuses writes (external file untouched).
    const roStoreDir = join(root, 'ro-store')
    mkdirSync(join(roStoreDir, 'data'), { recursive: true })
    // Place a regular file at data/files so vault materialization cannot succeed and falls back to read-only.
    writeFileSync(join(roStoreDir, 'data', 'files'), 'not-a-dir', 'utf8')
    const extDoc = join(root, 'external-ro.md')
    writeFileSync(extDoc, '# 只读外链', 'utf8')
    writeFileSync(join(roStoreDir, 'library.json'), JSON.stringify({
      schema: 2,
      revision: 1,
      assets: [{
        id: 'ast_extro001',
        name: '外部只读',
        type: 'knowledge',
        files: [{ id: 'fil_ext1', real_path: extDoc, original_name: 'external-ro.md' }],
      }],
    }), 'utf8')
    const readonlyStore = createLibraryStore({
      paths: { dir: roStoreDir, libraryFile: join(roStoreDir, 'library.json') },
    })
    const roRead = await readonlyStore.readTextFile('ast_extro001', 'fil_ext1', '')
    assert.equal(roRead.editable, false)
    assert.equal(roRead.content, '# 只读外链')
    await assert.rejects(
      () => readonlyStore.writeTextFile('ast_extro001', 'fil_ext1', '', { content: 'mutate' }),
      (error) => error.code === 'path-denied',
    )
    assert.equal(readFileSync(extDoc, 'utf8'), '# 只读外链')
  })
})
