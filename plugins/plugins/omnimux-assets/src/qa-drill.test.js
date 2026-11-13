/**
 * QA supplement: sub-path drill-down boundary behavior and escape guards.
 * Covers the thin spots left by http-routes.test.js:
 * - path= '' / '/' / '//sub' normalization
 * - file-kind mappings refuse sub paths with path-not-dir
 * - symlink escape refused even when the lexical path stays inside the root
 * - symlink pointing inside the root still works
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createAssetsDispatcher } from './http-routes.js'
import { createArtifactStore } from './artifacts.js'
import { createMappingStore } from './mappings.js'

let root
let realDir
let outside

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-qa-drill-'))
  realDir = join(root, 'scan-target')
  mkdirSync(realDir)
  mkdirSync(join(realDir, 'nested'))
  writeFileSync(join(realDir, 'top.png'), 'png')
  writeFileSync(join(realDir, 'nested', 'deep.png'), 'png')
  outside = join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'secret')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeDispatcher() {
  const storeDir = join(root, 'store')
  const mappings = createMappingStore({
    paths: {
      mappingsFile: join(storeDir, 'mappings.json'),
      scansDir: join(storeDir, 'scans'),
    },
  })
  const artifacts = createArtifactStore({
    paths: {
      artifactsFile: join(storeDir, 'artifacts.json'),
      artifactsDir: join(storeDir, 'artifacts'),
    },
  })
  return { dispatcher: createAssetsDispatcher({ mappings, artifacts }) }
}

async function addMapping(dispatcher, path = realDir, name = '根') {
  const added = await dispatcher.dispatch({ method: 'POST', url: '/omnimux/assets/mappings', body: { path, name } })
  assert.equal(added.status, 200)
  return added.body.mapping.id
}

function getFiles(id, subPath) {
  const query = subPath === undefined ? '' : `&path=${encodeURIComponent(subPath)}`
  return { method: 'GET', url: `/omnimux/assets/mappings/files?id=${id}${query}` }
}

describe('QA drill: sub-path normalization', () => {
  it('treats an empty path= as the mapping top level', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, ''))
    assert.equal(result.status, 200)
    const names = result.body.files.map((f) => f.name)
    assert.ok(names.includes('top.png'))
    assert.ok(names.includes('nested'))
  })

  it('treats a pure "/" path as the mapping top level', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, '/'))
    assert.equal(result.status, 200)
    const names = result.body.files.map((f) => f.name)
    assert.ok(names.includes('top.png'))
  })

  it('strips leading slashes: "//nested" drills into nested/', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, '//nested'))
    assert.equal(result.status, 200)
    assert.equal(result.body.files.length, 1)
    assert.equal(result.body.files[0].name, 'deep.png')
    assert.equal(result.body.files[0].relative_path, 'nested/deep.png')
  })

  it('treats an absolute-looking path ("/etc") as relative, yielding path-not-found', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, '/etc'))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'path-not-found')
  })

  it('keeps "nested/.." inside the root (lexical climb that lands back at root)', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, 'nested/..'))
    assert.equal(result.status, 200)
    const names = result.body.files.map((f) => f.name)
    assert.ok(names.includes('top.png'))
  })
})

describe('QA drill: file-kind mappings refuse sub paths', () => {
  it('answers path-not-dir when a file mapping is asked for a sub path', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher, join(realDir, 'top.png'), '单图')
    for (const subPath of ['nested', '/', '..']) {
      const result = await dispatcher.dispatch(getFiles(id, subPath))
      assert.equal(result.status, 400, `path=${JSON.stringify(subPath)}`)
      assert.equal(result.body.error, 'path-not-dir')
    }
  })

  it('still serves the single file entry when no sub path is given', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher, join(realDir, 'top.png'), '单图')
    const result = await dispatcher.dispatch(getFiles(id))
    assert.equal(result.status, 200)
    assert.equal(result.body.files.length, 1)
    assert.equal(result.body.files[0].name, 'top.png')
  })
})

describe('QA drill: deleted mapping root', () => {
  it('answers 200 + empty files + invalid view when the root is deleted after mounting', async () => {
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    rmSync(realDir, { recursive: true, force: true })
    const result = await dispatcher.dispatch(getFiles(id, 'nested'))
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.files, [])
    assert.equal(result.body.mapping.status, 'invalid')
  })
})

describe('QA drill: symlink escape guard', () => {
  it('refuses a symlink that points outside the mapping root (path-denied)', async () => {
    symlinkSync(outside, join(realDir, 'escape-link'))
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, 'escape-link'))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'path-denied')
  })

  it('refuses a chained sub path that dives through an escaping symlink', async () => {
    symlinkSync(outside, join(realDir, 'escape-link'))
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    // `..` is collapsed lexically BEFORE any fs access, so this never
    // traverses the symlink: it resolves to <root>/outside which does not
    // exist → path-not-found. Either way the escape is refused with 400.
    const result = await dispatcher.dispatch(getFiles(id, 'escape-link/../outside'))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'path-not-found')
    assert.ok(!JSON.stringify(result.body).includes('secret'))
  })

  it('allows a symlink that resolves back inside the root', async () => {
    symlinkSync(join(realDir, 'nested'), join(realDir, 'inner-link'))
    const { dispatcher } = makeDispatcher()
    const id = await addMapping(dispatcher)
    const result = await dispatcher.dispatch(getFiles(id, 'inner-link'))
    assert.equal(result.status, 200)
    assert.equal(result.body.files.length, 1)
    assert.equal(result.body.files[0].name, 'deep.png')
  })
})
