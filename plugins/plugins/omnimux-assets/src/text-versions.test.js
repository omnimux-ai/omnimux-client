import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { MAX_TEXT_VERSIONS } from './text-files.js'
import { createTextVersionStore } from './text-versions.js'

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-text-versions-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('TextVersionStore persistence, retention, and recycle', () => {
  it('creates snapshots, returns metadata-only lists, reads full content, and deletes snapshots', async () => {
    const store = createTextVersionStore({ paths: { textVersionsDir: join(root, 'text-versions') } })
    const assetId = 'ast_12345678'
    const fileId = 'f1'
    const subPath = 'docs/SKILL.md'

    const s1 = await store.createSnapshot(assetId, fileId, subPath, {
      name: '初稿',
      content: '# 角色设定\naccess_token 仅作文档说明',
      source: 'manual',
    })
    assert.match(s1.id, /^ver_/)
    assert.equal(s1.name, '初稿')
    assert.equal(s1.source, 'manual')
    assert.equal(s1.content, undefined)
    assert.equal(s1.charCount, '# 角色设定\naccess_token 仅作文档说明'.length)

    const s2 = await store.createSnapshot(assetId, fileId, subPath, {
      name: '',
      content: '# 角色设定 v2\n更新分镜说明',
      source: 'revert',
    })
    assert.match(s2.name, /^版本快照 /)
    assert.equal(s2.source, 'revert')

    const list = await store.listSnapshots(assetId, fileId, subPath)
    assert.equal(list.length, 2)
    assert.equal(list[0].id, s2.id)
    assert.equal(list[1].id, s1.id)
    assert.equal(list[0].content, undefined)
    assert.equal(list[1].content, undefined)

    const full = await store.getSnapshot(assetId, fileId, subPath, s1.id)
    assert.equal(full.content, '# 角色设定\naccess_token 仅作文档说明')
    assert.equal(full.name, '初稿')

    const removed = await store.deleteSnapshot(assetId, fileId, subPath, s1.id)
    assert.equal(removed.deleted, true)
    assert.equal((await store.listSnapshots(assetId, fileId, subPath)).length, 1)

    await assert.rejects(
      () => store.getSnapshot(assetId, fileId, subPath, s1.id),
      (error) => error.code === 'version-not-found',
    )
  })

  it('caps snapshot retention at MAX_TEXT_VERSIONS (50) and serializes concurrent writes', async () => {
    const store = createTextVersionStore({ paths: { textVersionsDir: join(root, 'text-versions') } })
    const total = MAX_TEXT_VERSIONS + 5

    await Promise.all(
      Array.from({ length: total }, (_, idx) => store.createSnapshot('ast_cap', 'f1', '', {
        name: `v${idx + 1}`,
        content: `body-${idx + 1}`,
        source: 'manual',
      })),
    )

    const list = await store.listSnapshots('ast_cap', 'f1', '')
    assert.equal(list.length, MAX_TEXT_VERSIONS)
    assert.equal(list[0].name, `v${total}`)
    assert.equal(list[list.length - 1].name, `v${total - MAX_TEXT_VERSIONS + 1}`)
  })

  it('isolates different subPaths under the same asset and recycles all on asset removal', async () => {
    const dir = join(root, 'text-versions')
    const store = createTextVersionStore({ paths: { textVersionsDir: dir } })

    await store.createSnapshot('ast_iso', 'f1', 'a.md', { name: 'A1', content: 'AAA' })
    await store.createSnapshot('ast_iso', 'f1', 'b.md', { name: 'B1', content: 'BBB' })

    assert.equal((await store.listSnapshots('ast_iso', 'f1', 'a.md')).length, 1)
    assert.equal((await store.listSnapshots('ast_iso', 'f1', 'b.md')).length, 1)
    assert.equal(existsSync(join(dir, 'ast_iso')), true)

    await store.recycleAssetSnapshots('ast_iso')
    assert.equal(existsSync(join(dir, 'ast_iso')), false)
    assert.deepEqual(await store.listSnapshots('ast_iso', 'f1', 'a.md'), [])
  })

  it('rejects secret-pattern snapshot names and NUL bytes before writing to disk', async () => {
    const store = createTextVersionStore({ paths: { textVersionsDir: join(root, 'text-versions') } })
    await assert.rejects(
      () => store.createSnapshot('ast_sec', 'f1', 'SKILL.md', { name: 'access_token 备份', content: 'ok' }),
      (error) => error.code === 'secret-detected',
    )
    await assert.rejects(
      () => store.createSnapshot('ast_sec', 'f1', 'SKILL.md', { name: '备份 sk-a', content: 'ok' }),
      (error) => error.code === 'secret-detected',
    )
    await assert.rejects(
      () => store.createSnapshot('ast_sec', 'f1', 'SKILL.md', { name: '正常名称', content: 'a\0b' }),
      (error) => error.code === 'file-not-text',
    )
    assert.deepEqual(await store.listSnapshots('ast_sec', 'f1', 'SKILL.md'), [])
  })
})
