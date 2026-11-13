import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveCatalog } from './resolve.js'

function doc(generatedAt, minHub = '0.1.0') {
  return { generated_at: generatedAt, min_hub: minHub, apps: [] }
}

describe('resolveCatalog', () => {
  it('keeps a newer remote over bundled', () => {
    const chosen = resolveCatalog({
      bundled: doc('2026-08-17T00:00:00Z'),
      memory: doc('2026-08-18T00:00:00Z'),
      hubVersion: '0.1.0',
    })
    assert.equal(chosen.source, 'remote')
    assert.equal(chosen.catalog.generated_at, '2026-08-18T00:00:00Z')
  })

  it('drops a cache older than the bundled floor', () => {
    const chosen = resolveCatalog({
      bundled: doc('2026-08-18T00:00:00Z'),
      disk: doc('2026-08-17T00:00:00Z'),
      hubVersion: '0.1.0',
    })
    assert.equal(chosen.source, 'bundled')
    assert.deepEqual(chosen.drop, [{ kind: 'disk', reason: 'older_than_bundled' }])
  })

  it('drops a remote that needs a newer hub', () => {
    const chosen = resolveCatalog({
      bundled: doc('2026-08-17T00:00:00Z'),
      memory: doc('2026-08-19T00:00:00Z', '0.2.0'),
      hubVersion: '0.1.0',
    })
    assert.equal(chosen.source, 'bundled')
    assert.deepEqual(chosen.drop, [{ kind: 'memory', reason: 'min_hub' }])
  })

  it('prefers memory over disk on a generated_at tie', () => {
    const chosen = resolveCatalog({
      bundled: doc('2026-08-17T00:00:00Z'),
      disk: doc('2026-08-18T00:00:00Z'),
      memory: doc('2026-08-18T00:00:00Z'),
      hubVersion: '0.1.0',
    })
    assert.equal(chosen.source, 'remote')
  })
})
