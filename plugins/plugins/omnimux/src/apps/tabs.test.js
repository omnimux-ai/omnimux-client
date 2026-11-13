import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createTabsStore, isValidTabId, parseTabs } from './tabs.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'omnimux-tabs-'))
}

function tabRow(overrides = {}) {
  return {
    id: 'accounts',
    pinned: false,
    pinnedAt: null,
    toppedAt: null,
    lastOpenedAt: '2026-08-20T07:00:00Z',
    ...overrides,
  }
}

describe('parseTabs', () => {
  it('accepts a valid schema-1 document', () => {
    const doc = parseTabs(JSON.stringify({ schema: 1, tabs: [tabRow()] }))
    assert.equal(doc.schema, 1)
    assert.deepEqual(doc.tabs, [tabRow()])
  })

  it('treats non-JSON and non-object bodies as an empty table', () => {
    assert.deepEqual(parseTabs('not json'), { schema: 1, tabs: [] })
    assert.deepEqual(parseTabs('[]'), { schema: 1, tabs: [] })
    assert.deepEqual(parseTabs('null'), { schema: 1, tabs: [] })
  })

  it('rejects wrong schema, missing tabs, unknown top-level fields', () => {
    assert.deepEqual(parseTabs(JSON.stringify({ schema: 2, tabs: [] })), { schema: 1, tabs: [] })
    assert.deepEqual(parseTabs(JSON.stringify({ schema: 1 })), { schema: 1, tabs: [] })
    assert.deepEqual(parseTabs(JSON.stringify({ schema: 1, tabs: [], extra: 1 })), { schema: 1, tabs: [] })
  })

  it('rejects the whole document on any bad row (unknown fields, wrong types, bad id)', () => {
    const cases = [
      [tabRow({ unknown: 1 })],
      [tabRow({ pinned: 'yes' })],
      [tabRow({ pinnedAt: 123 })],
      [tabRow({ lastOpenedAt: null })],
      [tabRow({ id: 'X!' })],
      [tabRow({ id: 'a' })],
      [tabRow(), tabRow()],
      ['not-an-object'],
    ]
    for (const tabs of cases) {
      assert.deepEqual(parseTabs(JSON.stringify({ schema: 1, tabs })), { schema: 1, tabs: [] }, JSON.stringify(tabs))
    }
  })

  it('rejects more than 64 rows', () => {
    const tabs = []
    for (let index = 0; index < 65; index += 1) tabs.push(tabRow({ id: `app-${String(index)}` }))
    assert.deepEqual(parseTabs(JSON.stringify({ schema: 1, tabs })), { schema: 1, tabs: [] })
  })
})

describe('isValidTabId', () => {
  it('follows the catalog id rules', () => {
    assert.equal(isValidTabId('accounts'), true)
    assert.equal(isValidTabId('e-commerce-design'), true)
    assert.equal(isValidTabId('a'), false)
    assert.equal(isValidTabId('X!'), false)
    assert.equal(isValidTabId(''), false)
    assert.equal(isValidTabId(42), false)
  })
})

describe('tabs store', () => {
  it('starts empty and creates a row on first open', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => Date.parse('2026-08-20T07:00:00Z') })
    assert.deepEqual(store.list(), { schema: 1, tabs: [] })
    store.upsert('accounts')
    assert.deepEqual(store.list().tabs, [tabRow({ lastOpenedAt: '2026-08-20T07:00:00.000Z' })])
  })

  it('refreshes lastOpenedAt and clears toppedAt on reopen', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => Date.parse('2026-08-20T07:00:00Z') })
    store.upsert('accounts')
    store.patch('accounts', { order: 'top' })
    store.upsert('accounts')
    const row = store.list().tabs[0]
    assert.equal(row.toppedAt, null)
    assert.equal(row.lastOpenedAt, '2026-08-20T07:00:00.000Z')
  })

  it('pins and unpins, tracking pinnedAt', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => Date.parse('2026-08-20T07:00:00Z') })
    store.upsert('accounts')
    assert.equal(store.patch('accounts', { pinned: true }).tabs[0].pinned, true)
    assert.equal(store.list().tabs[0].pinnedAt, '2026-08-20T07:00:00.000Z')
    assert.equal(store.patch('accounts', { pinned: false }).tabs[0].pinned, false)
    assert.equal(store.list().tabs[0].pinnedAt, null)
    assert.equal(store.patch('ghost-app', { pinned: true }), null)
  })

  it('orders pinned rows first, then by topped/pinned/opened time descending', () => {
    const home = tempHome()
    let clock = Date.parse('2026-08-20T07:00:00Z')
    const store = createTabsStore({ home, now: () => clock })
    store.upsert('app-old')
    clock = Date.parse('2026-08-20T08:00:00Z')
    store.upsert('app-new')
    clock = Date.parse('2026-08-20T09:00:00Z')
    store.upsert('app-pinned')
    store.patch('app-pinned', { pinned: true })
    clock = Date.parse('2026-08-20T10:00:00Z')
    store.upsert('app-topped')
    store.patch('app-topped', { order: 'top' })
    clock = Date.parse('2026-08-20T11:00:00Z')
    store.upsert('app-pinned2')
    store.patch('app-pinned2', { pinned: true })
    assert.deepEqual(store.list().tabs.map((row) => row.id), [
      'app-pinned2',
      'app-pinned',
      'app-topped',
      'app-new',
      'app-old',
    ])
  })

  it('removes rows and reports misses', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => 0 })
    store.upsert('accounts')
    assert.equal(store.remove('accounts').tabs.length, 0)
    assert.equal(store.remove('accounts'), null)
  })

  it('persists to tabs.json with 0600 file and 0700 directory modes', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => 0 })
    store.upsert('accounts')
    assert.equal(statSync(store.path).mode & 0o777, 0o600)
    assert.equal(statSync(join(home, 'omnimux', 'apps')).mode & 0o777, 0o700)
    const raw = JSON.parse(readFileSync(store.path, 'utf8'))
    assert.equal(raw.schema, 1)
    assert.equal(raw.tabs[0].id, 'accounts')
    const reopened = createTabsStore({ home, now: () => 0 })
    assert.equal(reopened.list().tabs.length, 1)
  })

  it('rebuilds an empty table from a corrupt file', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => 0 })
    store.upsert('accounts')
    mkdirSync(join(home, 'omnimux', 'apps'), { recursive: true })
    writeFileSync(store.path, '{not json', { mode: 0o600 })
    assert.deepEqual(store.list(), { schema: 1, tabs: [] })
    store.upsert('fresh-app')
    assert.equal(store.list().tabs.length, 1)
  })

  it('keeps hidden rows on disk while the view filters them out', () => {
    const home = tempHome()
    const store = createTabsStore({ home, now: () => 0 })
    store.upsert('accounts')
    const apps = [{ id: 'accounts', title: '账号', state: 'available' }]
    assert.deepEqual(store.view({ apps }), { schema: 1, tabs: [] })
    assert.equal(store.list().tabs.length, 1)
    const installed = [{ id: 'accounts', title: '账号', state: 'installed' }]
    assert.deepEqual(store.view({ apps: installed }).tabs, [
      { id: 'accounts', title: '账号', pinned: false, lastOpenedAt: '1970-01-01T00:00:00.000Z' },
    ])
    const updating = [{ id: 'accounts', title: '账号', state: 'update' }]
    assert.equal(store.view({ apps: updating }).tabs.length, 1)
  })

  it('evicts the least-recent non-pinned row past 64', () => {
    const home = tempHome()
    let clock = Date.parse('2026-08-20T07:00:00Z')
    const store = createTabsStore({ home, now: () => clock })
    for (let index = 0; index < 64; index += 1) {
      store.upsert(`app-${String(index).padStart(2, '0')}`)
      clock += 1000
    }
    store.patch('app-00', { pinned: true })
    clock += 1000
    store.upsert('app-new')
    const ids = store.list().tabs.map((row) => row.id)
    assert.equal(ids.length, 64)
    assert.ok(ids.includes('app-new'), 'the freshly opened row survives')
    assert.ok(ids.includes('app-00'), 'the pinned row survives')
    assert.ok(!ids.includes('app-01'), 'the least-recent non-pinned row is evicted')
  })
})
