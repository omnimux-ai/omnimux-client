import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { cacheId, cacheResponseHeaders, createMediaCache, matchesCondition } from './inspiration-cache.js'

const temps = []

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'insp-cache-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('inspiration media cache', () => {
  it('is a no-op without dataRoot', () => {
    const cache = createMediaCache('')
    assert.equal(cache.enabled, false)
    assert.equal(cache.read('seed/a.jpg'), null)
    cache.write('seed/a.jpg', { body: Buffer.from('x'), mime: 'image/jpeg' })
    assert.equal(cache.read('seed/a.jpg'), null)
  })

  it('round-trips bytes and derived etag', () => {
    const cache = createMediaCache(tempRoot())
    const body = Buffer.from('jpeg-bytes')
    cache.write('seed/cover-04.jpg', { body, mime: 'image/jpeg', lastModified: 'Mon, 24 Aug 2026 03:37:10 GMT' })
    const hit = cache.read('seed/cover-04.jpg')
    assert.ok(hit)
    assert.equal(hit.mime, 'image/jpeg')
    assert.equal(hit.length, body.length)
    assert.deepEqual(hit.body, body)
    assert.equal(hit.etag, `"${cacheId('seed/cover-04.jpg')}"`)
    assert.equal(hit.lastModified, 'Mon, 24 Aug 2026 03:37:10 GMT')
  })

  it('treats a missing bin as a miss even if meta exists', () => {
    const home = tempRoot()
    const cache = createMediaCache(home)
    cache.write('seed/a.jpg', { body: Buffer.from('x'), mime: 'image/jpeg' })
    const id = cacheId('seed/a.jpg')
    rmSync(join(home, 'omnimux', 'media', 'inspiration', `${id}.bin`), { force: true })
    assert.equal(cache.read('seed/a.jpg'), null)
  })

  it('prunes oldest entries past the count cap', () => {
    const home = tempRoot()
    const cache = createMediaCache(home, { maxEntries: 2 })
    cache.write('a.jpg', { body: Buffer.from('a'), mime: 'image/jpeg' })
    cache.write('b.jpg', { body: Buffer.from('b'), mime: 'image/jpeg' })
    cache.write('c.jpg', { body: Buffer.from('c'), mime: 'image/jpeg' })
    const names = readdirSync(join(home, 'omnimux', 'media', 'inspiration')).filter((n) => n.endsWith('.bin'))
    assert.equal(names.length, 2)
    assert.equal(names.includes(`${cacheId('c.jpg')}.bin`), true)
  })

  it('serves a stale body when allowStale is set', () => {
    const cache = createMediaCache(tempRoot(), { ttlMs: 1 })
    cache.write('seed/a.jpg', { body: Buffer.from('old'), mime: 'image/jpeg', etag: '"old"' })
    const start = Date.now()
    while (Date.now() - start < 5) { /* wait past ttl */ }
    assert.equal(cache.read('seed/a.jpg'), null)
    const stale = cache.read('seed/a.jpg', { allowStale: true })
    assert.ok(stale)
    assert.equal(stale.body.toString(), 'old')
  })
})

describe('matchesCondition', () => {
  it('matches If-None-Match and If-Modified-Since', () => {
    const hit = { etag: '"abc"', lastModified: 'Mon, 24 Aug 2026 03:37:10 GMT' }
    assert.equal(matchesCondition(hit, '"abc"', undefined), true)
    assert.equal(matchesCondition(hit, 'W/"other", "abc"', undefined), true)
    assert.equal(matchesCondition(hit, undefined, 'Mon, 24 Aug 2026 03:37:10 GMT'), true)
    assert.equal(matchesCondition(hit, '"nope"', undefined), false)
  })
})

describe('cacheResponseHeaders', () => {
  it('always emits a public max-age', () => {
    const headers = cacheResponseHeaders({ etag: '"x"', lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' })
    assert.equal(headers['cache-control'], 'public, max-age=3600')
    assert.equal(headers.etag, '"x"')
    assert.equal(headers['last-modified'], 'Mon, 01 Jan 2026 00:00:00 GMT')
  })
})
