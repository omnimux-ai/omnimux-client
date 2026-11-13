import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadBundledCatalog, parseCatalog } from './parse.js'

function validCatalog(overrides = {}) {
  return {
    schema: 1,
    generated_at: '2026-08-17T00:00:00Z',
    min_hub: '0.1.0',
    apps: [],
    ...overrides,
  }
}

function validApp(overrides = {}) {
  return {
    id: 'accounts',
    title: '账号',
    summary: '查看并连接已绑定的社媒账号',
    kind: 'official',
    listed: true,
    capabilities: ['identity'],
    client: true,
    spec: { source: 'npm', name: 'omnimux-accounts', version: '0.1.0' },
    ...overrides,
  }
}

describe('parseCatalog', () => {
  it('accepts the empty official document', () => {
    const parsed = parseCatalog(validCatalog())
    assert.equal(parsed.schema, 1)
    assert.deepEqual(parsed.apps, [])
  })

  it('accepts a pinned npm row', () => {
    const parsed = parseCatalog(validCatalog({ apps: [validApp()] }))
    assert.equal(parsed.apps[0].spec.version, '0.1.0')
  })

  it('rejects latest and range versions', () => {
    assert.throws(
      () => parseCatalog(validCatalog({ apps: [validApp({ spec: { source: 'npm', name: 'omnimux-accounts', version: 'latest' } })] })),
      /pinned/,
    )
    assert.throws(
      () => parseCatalog(validCatalog({ apps: [validApp({ spec: { source: 'npm', name: 'omnimux-accounts', version: '^1.0.0' } })] })),
      /pinned/,
    )
  })

  it('rejects reserved hub package names', () => {
    assert.throws(
      () => parseCatalog(validCatalog({ apps: [validApp({ id: 'omnimux' })] })),
      /reserved/,
    )
    assert.throws(
      () => parseCatalog(validCatalog({
        apps: [validApp({ spec: { source: 'npm', name: 'omnimux', version: '0.1.0' } })],
      })),
      /reserved/,
    )
  })

  it('rejects a document over the size limit', () => {
    assert.throws(() => parseCatalog(JSON.stringify(validCatalog()), { maxBytes: 8 }), /size limit/)
  })

  it('rejects unknown fields', () => {
    assert.throws(() => parseCatalog(validCatalog({ extra: true })), /unknown fields/)
  })

  it('rejects a pinned version on a bundled spec', () => {
    assert.throws(
      () => parseCatalog(validCatalog({
        apps: [validApp({ spec: { source: 'bundled', name: 'omnimux-accounts', version: '0.1.0' } })],
      })),
      /bundled spec cannot pin/,
    )
  })
})

describe('loadBundledCatalog', () => {
  it('reads the shipped official catalog', () => {
    const parsed = loadBundledCatalog()
    assert.equal(parsed.schema, 1)
    assert.equal(parsed.apps[0].id, 'accounts')
    assert.equal(parsed.apps[0].spec.name, 'omnimux-accounts')
    assert.equal(parsed.apps[0].spec.source, 'bundled')
    assert.equal(parsed.apps[0].spec.version, undefined)
  })

  it('fails when the bundled file is missing', () => {
    assert.throws(() => loadBundledCatalog(() => {
      throw new Error('ENOENT')
    }), /missing/)
  })
})
