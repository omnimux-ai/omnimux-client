import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assignConfig, dshHome, overlayPath, publicConfig, readOverlay, sanitizePatch, sanitizeSortBy, withDefaults, writeOverlay } from '../config-store.js'

test('withDefaults fills required fields', () => {
  const cfg = withDefaults({ skillsDir: '/tmp/skills', timeoutMs: 5000, userAgent: 'test' })
  assert.equal(cfg.apiBase, 'https://api.skillhub.cn')
  assert.equal(cfg.webBase, 'https://skillhub.cn')
  assert.equal(cfg.skillsDir, '/tmp/skills')
  assert.equal(cfg.sortBy, 'score')
  assert.equal(cfg.plazaKeepAlive, true)
  assert.equal(cfg.plazaCacheTtlSec, 90)
  assert.equal(cfg.pluginMaxResults, 6)
  assert.equal(cfg.connectorMaxResults, 6)
  assert.deepEqual(cfg.protectedBundlesExtra, [])
  assert.deepEqual(cfg.aggregateChannels, ['custom', 'workbuddy', 'skillhub'])
  assert.equal(cfg.workbuddySkillsMarketplace, '')
  assert.equal(cfg.aggregateRemoteSoftFail, true)
  assert.equal('cosBase' in cfg, false)
})

test('plazaKeepAlive and plazaCacheTtlSec sanitize + assign', () => {
  assert.equal(withDefaults({ plazaKeepAlive: false }).plazaKeepAlive, false)
  const patch = sanitizePatch({ plazaKeepAlive: 'false', plazaCacheTtlSec: 120 })
  assert.equal(patch.plazaKeepAlive, false)
  assert.equal(patch.plazaCacheTtlSec, 120)
  const live = withDefaults({})
  assignConfig(live, patch)
  assert.equal(live.plazaKeepAlive, false)
  assert.equal(live.plazaCacheTtlSec, 120)
  const pub = publicConfig(live)
  assert.equal(pub.plazaKeepAlive, false)
  assert.equal(pub.plazaCacheTtlSec, 120)
})

test('sanitizePatch ignores leftover cosBase and invalid urls', () => {
  const patch = sanitizePatch({
    apiBase: 'https://api.example.com/',
    cosBase: 'https://cos.example',
    webBase: 'not-a-url',
    skillsDir: ' ~/.dsh/skills ',
    timeoutMs: 100,
    maxResults: 99,
    sortBy: 'downloads',
  })
  assert.equal(patch.apiBase, 'https://api.example.com')
  assert.equal(patch.webBase, undefined)
  assert.equal(patch.skillsDir, '~/.dsh/skills')
  assert.equal(patch.timeoutMs, undefined)
  assert.equal(patch.maxResults, 80)
  assert.equal(patch.sortBy, 'downloads')
  assert.equal('cosBase' in patch, false)
})

test('publicConfig omits userAgent', () => {
  const pub = publicConfig(withDefaults({ skillsDir: '/tmp/skills', userAgent: 'secret-ua' }))
  assert.equal('userAgent' in pub, false)
  assert.equal(pub.apiBase, 'https://api.skillhub.cn')
})

test('sanitizeSortBy falls back for unknown values', () => {
  assert.equal(sanitizeSortBy('downloads'), 'downloads')
  assert.equal(sanitizeSortBy('nope', 'stars'), 'stars')
  assert.equal(sanitizeSortBy(''), 'score')
})

test('assignConfig copies recognized fields', () => {
  const live = withDefaults({ skillsDir: '/a', userAgent: 'old' })
  assignConfig(live, { apiBase: 'https://api.example', skillsDir: '/b', timeoutMs: 9000, maxResults: 4, sortBy: 'stars' })
  assert.equal(live.apiBase, 'https://api.example')
  assert.equal(live.skillsDir, '/b')
  assert.equal(live.timeoutMs, 9000)
  assert.equal(live.maxResults, 4)
  assert.equal(live.sortBy, 'stars')
})

test('sanitizePatch clamps timeout and maxResults', () => {
  const patch = sanitizePatch({ timeoutMs: 999999, maxResults: 0, userAgent: ' ua ' })
  assert.equal(patch.timeoutMs, 120000)
  assert.equal(patch.maxResults, undefined)
  assert.equal(patch.userAgent, 'ua')
})

test('sanitizePatch clamps plugin/connector max and extra protected names', () => {
  const patch = sanitizePatch({
    pluginMaxResults: 99,
    connectorMaxResults: 1,
    protectedBundlesExtra: ['dsh-better-sidebar', 'github:evil', ''],
  })
  assert.equal(patch.pluginMaxResults, 8)
  assert.equal(patch.connectorMaxResults, 1)
  assert.deepEqual(patch.protectedBundlesExtra, ['dsh-better-sidebar'])
})

test('overlay round-trip uses DSH_HOME and drops userAgent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skillhub-cfg-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    assert.equal(dshHome(), dir)
    assert.equal(overlayPath(), join(dir, 'omnimux-market.json'))
    assert.deepEqual(readOverlay(), {})
    const cfg = withDefaults({ skillsDir: join(dir, 'skills'), userAgent: 'secret-ua', maxResults: 7 })
    writeOverlay(cfg)
    const loaded = readOverlay()
    assert.equal(loaded.maxResults, 7)
    assert.equal(loaded.skillsDir, join(dir, 'skills'))
    assert.equal('userAgent' in loaded, false)
    assert.equal('userAgent' in publicConfig(cfg), false)
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  }
})

test('readOverlay ignores invalid json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skillhub-bad-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    await writeFile(join(dir, 'omnimux-market.json'), '{not json')
    assert.deepEqual(readOverlay(), {})
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  }
})
