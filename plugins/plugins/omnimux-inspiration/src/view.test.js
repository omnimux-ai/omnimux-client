import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { errorMessage, pickList, uniqueTags } from './view.js'

describe('pickList', () => {
  it('reads the inspiration envelope', () => {
    const picked = pickList({
      success: true,
      data: { total: 2, items: [{ id: '1' }, { id: '2' }] },
    })
    assert.equal(picked.total, 2)
    assert.deepEqual(picked.items.map((row) => row.id), ['1', '2'])
  })

  it('tolerates a missing envelope', () => {
    assert.deepEqual(pickList(null), { total: 0, items: [] })
    assert.equal(pickList({ items: [{ id: 'x' }] }).items[0].id, 'x')
  })
})

describe('uniqueTags', () => {
  it('flattens string and object tags', () => {
    assert.deepEqual(
      uniqueTags([
        { tags: ['猫', { name: '热门' }] },
        { tags: ['猫'] },
      ]),
      ['热门', '猫'],
    )
  })
})

describe('errorMessage', () => {
  it('maps gateway disabled codes', () => {
    assert.equal(errorMessage({ code: 'INSPIRATION_DISABLED' }, 503), 'disabled')
    assert.equal(errorMessage({ error: 'boom' }, 502), 'boom')
  })
})
