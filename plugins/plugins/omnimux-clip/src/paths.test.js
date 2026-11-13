import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ClipDomainError } from './errors.js'
import {
  assertInsideClipRoot,
  assertProjectId,
  ensureClipDirs,
  exportMp4Path,
  projectJsonPath,
  resolveClipPaths,
  resolveDshHome,
  snapshotPngPath,
} from './paths.js'

describe('resolveClipPaths', () => {
  it('honours DSH_HOME and lays out the four subdirs', () => {
    const paths = resolveClipPaths({ env: { DSH_HOME: '/tmp/dsh-home-x' } })
    assert.equal(paths.dir, join('/tmp/dsh-home-x', 'omnimux', 'clip'))
    assert.equal(paths.projectsDir, join(paths.dir, 'projects'))
    assert.equal(paths.exportsDir, join(paths.dir, 'exports'))
    assert.equal(paths.snapshotsDir, join(paths.dir, 'snapshots'))
    assert.equal(paths.tmpDir, join(paths.dir, 'tmp'))
  })

  it('falls back to homeDir then ~/.dsh', () => {
    const fromHome = resolveDshHome('/custom/home', {})
    assert.equal(fromHome, '/custom/home')
    const fallback = resolveDshHome(undefined, {})
    assert.match(fallback, /\.dsh$/)
  })
})

describe('ensureClipDirs', () => {
  it('mkdirs projects/exports/snapshots/tmp under the clip root', () => {
    const root = mkdtempSync(join(tmpdir(), 'omnimux-clip-'))
    try {
      const paths = resolveClipPaths({ homeDir: root, env: {} })
      ensureClipDirs(paths)
      assert.equal(existsSync(paths.dir), true)
      assert.equal(existsSync(paths.projectsDir), true)
      assert.equal(existsSync(paths.exportsDir), true)
      assert.equal(existsSync(paths.snapshotsDir), true)
      assert.equal(existsSync(paths.tmpDir), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('path safety', () => {
  it('accepts kebab project ids and rejects traversal', () => {
    assert.equal(assertProjectId('demo-1'), 'demo-1')
    assert.throws(
      () => assertProjectId('../etc'),
      (error) => error instanceof ClipDomainError && error.code === 'invalid-id',
    )
    assert.throws(
      () => assertProjectId(''),
      (error) => error instanceof ClipDomainError && error.code === 'invalid-id',
    )
  })

  it('refuses writes that escape the clip root', () => {
    const paths = resolveClipPaths({ env: { DSH_HOME: '/tmp/dsh-home-x' } })
    assert.throws(
      () => assertInsideClipRoot(paths.dir, join(paths.dir, '..', 'secrets.json')),
      (error) => error instanceof ClipDomainError && error.code === 'path-denied',
    )
    const json = projectJsonPath(paths, 'demo-1')
    assert.equal(json, join(paths.projectsDir, 'demo-1.json'))
    const mp4 = exportMp4Path(paths, 'demo-1')
    assert.equal(mp4, join(paths.exportsDir, 'demo-1.mp4'))
    const snap = snapshotPngPath(paths, 'demo-1', 1250)
    assert.equal(snap, join(paths.snapshotsDir, 'demo-1-1250.png'))
  })
})
