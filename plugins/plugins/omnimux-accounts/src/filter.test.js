import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterAccounts, uniqueValues } from './filter.js'

const rows = [
  { id: 'a', platform: 'tiktok', group: 'ops' },
  { id: 'b', platform: 'youtube', group: 'ads' },
  { id: 'c', platform: 'tiktok', group: 'ads' },
]

describe('filterAccounts', () => {
  it('filters by platform and group', () => {
    assert.deepEqual(filterAccounts(rows, { platform: 'TikTok' }).map((row) => row.id), ['a', 'c'])
    assert.deepEqual(filterAccounts(rows, { group: 'ads', platform: 'tiktok' }).map((row) => row.id), ['c'])
  })
})

describe('uniqueValues', () => {
  it('lists distinct platforms and groups', () => {
    assert.deepEqual(uniqueValues(rows, 'platform'), ['tiktok', 'youtube'])
    assert.deepEqual(uniqueValues(rows, 'group'), ['ads', 'ops'])
  })
})
