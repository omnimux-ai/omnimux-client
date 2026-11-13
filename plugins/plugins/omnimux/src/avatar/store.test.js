import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { avatarFile, createAvatarStore } from './store.js'

describe('avatar store', () => {
  it('persists per-id rows and isolates them', () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-avatar-'))
    try {
      const store = createAvatarStore({ home })
      assert.equal(store.read('3'), undefined)
      store.update('3', { hue: 210, snapshot_uri: 'data:a' })
      store.update('9', { hue: 12 })
      assert.deepEqual(store.read('3'), { hue: 210, snapshot_uri: 'data:a' })
      assert.deepEqual(createAvatarStore({ home }).read('3'), { hue: 210, snapshot_uri: 'data:a' })
      store.update('3', { hue: 90 })
      assert.equal(store.read('3').hue, 90)
      assert.equal(store.read('3').snapshot_uri, 'data:a')
      store.reset('3')
      assert.equal(store.read('3'), undefined)
      assert.equal(store.read('9').hue, 12)
      const raw = JSON.parse(readFileSync(avatarFile(home), 'utf8'))
      assert.equal('3' in raw, false)
      assert.equal(raw['9'].hue, 12)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('treats a missing or corrupt file as empty', () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-avatar-bad-'))
    try {
      const store = createAvatarStore({ home })
      assert.equal(store.read('3'), undefined)
      mkdirSync(join(home, 'omnimux'), { recursive: true, mode: 0o700 })
      writeFileSync(avatarFile(home), 'not-json', { mode: 0o600 })
      assert.equal(store.read('3'), undefined)
      store.update('3', { hue: 12 })
      assert.equal(store.read('3').hue, 12)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
