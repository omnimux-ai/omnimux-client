import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterAccounts, presentStatuses, relativeTime, resolveUiLocale, selectAllState, selectRows, sortAccounts, summarize, uniqueValues } from './view.js'

const NOW = Date.parse('2026-08-20T12:00:00Z')

const rows = [
  { id: 'a', platform: 'tiktok', display_name: 'Ada', username: 'ada', group: 'ops', status: 'active', last_used_at: '2026-08-18T12:00:00Z' },
  { id: 'b', platform: 'instagram', display_name: 'Bo', username: 'bo', group: 'ops', status: 'expiring', expires_at: '2026-08-21T06:00:00Z' },
  { id: 'c', platform: 'youtube', display_name: 'Cara', username: 'cara', group: 'ads', status: 'expired' },
  { id: 'd', platform: 'tiktok', display_name: 'Dan', username: 'dan', status: 'error' },
  { id: 'e', platform: 'tiktok', name: 'NoDisplayName', status: 'active' },
]

describe('filterAccounts', () => {
  it('returns everything with empty filters', () => {
    assert.equal(filterAccounts(rows, {}).length, 5)
    assert.equal(filterAccounts(rows).length, 5)
    assert.deepEqual(filterAccounts('not-an-array', {}), [])
  })

  it('matches query across name, username, platform, group and id', () => {
    assert.deepEqual(filterAccounts(rows, { query: 'ada' }).map((r) => r.id), ['a'])
    assert.deepEqual(filterAccounts(rows, { query: '@cara' }).map((r) => r.id), [])
    assert.deepEqual(filterAccounts(rows, { query: 'cara' }).map((r) => r.id), ['c'])
    assert.deepEqual(filterAccounts(rows, { query: 'TIKTOK' }).map((r) => r.id), ['a', 'd', 'e'])
    assert.deepEqual(filterAccounts(rows, { query: 'ops' }).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(filterAccounts(rows, { query: '  ' }).length, 5)
    assert.deepEqual(filterAccounts(rows, { query: 'zzz' }), [])
  })

  it('applies exact platform / group / status filters case-insensitively', () => {
    assert.deepEqual(filterAccounts(rows, { platform: 'TikTok' }).map((r) => r.id), ['a', 'd', 'e'])
    assert.deepEqual(filterAccounts(rows, { group: 'ADS' }).map((r) => r.id), ['c'])
    assert.deepEqual(filterAccounts(rows, { status: 'EXPIRED' }).map((r) => r.id), ['c'])
    // a row without the field never matches a set filter
    assert.deepEqual(filterAccounts(rows, { group: 'ops', platform: 'youtube' }), [])
  })

  it('combines filters with AND semantics', () => {
    assert.deepEqual(
      filterAccounts(rows, { platform: 'tiktok', status: 'active' }).map((r) => r.id),
      ['a', 'e'],
    )
    assert.deepEqual(
      filterAccounts(rows, { query: 'a', group: 'ops' }).map((r) => r.id),
      ['a', 'b'],
    )
  })

  it('filters by statusGroup (connected -> active+expiring, needsAttention -> expired+error)', () => {
    assert.deepEqual(
      filterAccounts(rows, { statusGroup: 'connected' }).map((r) => r.id),
      ['a', 'b', 'e'],
    )
    assert.deepEqual(
      filterAccounts(rows, { statusGroup: 'needsAttention' }).map((r) => r.id),
      ['c', 'd'],
    )
    // Specific status overrides statusGroup
    assert.deepEqual(
      filterAccounts(rows, { statusGroup: 'connected', status: 'expiring' }).map((r) => r.id),
      ['b'],
    )
  })
})

describe('sortAccounts', () => {
  it('sorts by display_name with a username fallback, missing values last', () => {
    const mixed = [
      { id: 'x', username: 'zeta' },
      { id: 'y', display_name: 'Beta' },
      { id: 'z', display_name: 'alpha' },
    ]
    assert.deepEqual(sortAccounts(mixed, 'display_name', 'asc').map((r) => r.id), ['z', 'y', 'x'])
    assert.deepEqual(sortAccounts(mixed, 'display_name', 'desc').map((r) => r.id), ['x', 'y', 'z'])
  })

  it('sorts by platform and by last_used_at', () => {
    assert.deepEqual(sortAccounts(rows, 'platform', 'asc').map((r) => r.platform),
      ['instagram', 'tiktok', 'tiktok', 'tiktok', 'youtube'])
    const withTimes = [
      { id: 'old', last_used_at: '2026-08-01T00:00:00Z' },
      { id: 'new', last_used_at: '2026-08-19T00:00:00Z' },
      { id: 'never' },
    ]
    assert.deepEqual(sortAccounts(withTimes, 'last_used_at', 'asc').map((r) => r.id), ['old', 'new', 'never'])
    assert.deepEqual(sortAccounts(withTimes, 'last_used_at', 'desc').map((r) => r.id), ['new', 'old', 'never'])

    const withConnectedAndExpires = [
      { id: 'c1', connected_at: '2026-08-01T00:00:00Z', expires_at: '2026-09-01T00:00:00Z' },
      { id: 'c2', connected_at: '2026-08-15T00:00:00Z', expires_at: '2026-08-25T00:00:00Z' },
      { id: 'c3' },
    ]
    assert.deepEqual(sortAccounts(withConnectedAndExpires, 'connected_at', 'desc').map((r) => r.id), ['c2', 'c1', 'c3'])
    assert.deepEqual(sortAccounts(withConnectedAndExpires, 'expires_at', 'asc').map((r) => r.id), ['c2', 'c1', 'c3'])
  })

  it('sorts statuses by severity and falls back for unknown keys', () => {
    assert.deepEqual(sortAccounts(rows, 'status', 'asc').map((r) => r.status),
      ['active', 'active', 'expiring', 'expired', 'error'])
    assert.deepEqual(sortAccounts(rows, 'nonsense', 'asc').map((r) => r.id),
      sortAccounts(rows, 'display_name', 'asc').map((r) => r.id))
  })

  it('does not mutate the input array', () => {
    const input = [{ id: 'b', display_name: 'Bravo' }, { id: 'a', display_name: 'Alpha' }]
    const sorted = sortAccounts(input, 'display_name', 'asc')
    assert.deepEqual(sorted.map((r) => r.id), ['a', 'b'])
    assert.deepEqual(input.map((r) => r.id), ['b', 'a'])
  })
})

describe('summarize', () => {
  it('counts connected (active+expiring), attention (expired+error), platforms, total', () => {
    assert.deepEqual(summarize(rows), { total: 5, connected: 3, needsAttention: 2, platformCount: 3 })
  })

  it('handles empty, missing and unknown statuses', () => {
    assert.deepEqual(summarize([]), { total: 0, connected: 0, needsAttention: 0, platformCount: 0 })
    assert.deepEqual(summarize(undefined), { total: 0, connected: 0, needsAttention: 0, platformCount: 0 })
    assert.deepEqual(
      summarize([{ id: 'a' }, { id: 'b', status: 'weird' }, { id: 'c', platform: '  ' }]),
      { total: 3, connected: 0, needsAttention: 0, platformCount: 0 },
    )
    // platforms are deduped case-insensitively
    assert.equal(summarize([{ platform: 'TikTok' }, { platform: 'tiktok' }]).platformCount, 1)
  })
})

describe('relativeTime', () => {
  it('formats past and future times with sensible units', () => {
    const past = relativeTime('2026-08-18T12:00:00Z', NOW, 'en')
    assert.match(past, /2 days? ago/)
    const future = relativeTime('2026-08-21T06:00:00Z', NOW, 'en')
    assert.match(future, /in 18 hours?/)
    assert.match(relativeTime('2026-08-20T11:57:00Z', NOW, 'en'), /3 minutes? ago/)
    assert.match(relativeTime('2026-08-20T12:00:40Z', NOW, 'en'), /in 40 seconds?/)
    assert.match(relativeTime('2026-08-20T12:40:00Z', NOW, 'en'), /in 40 minutes?/)
  })

  it('keeps zh relative text when locale is zh (no en/zh mix)', () => {
    const future = relativeTime('2026-08-21T00:00:00Z', NOW, 'zh')
    assert.match(future, /小时/)
    assert.doesNotMatch(future, /in \d+/)
    assert.equal(resolveUiLocale('zh'), 'zh-CN')
    assert.equal(resolveUiLocale('en-US'), 'en')
  })

  it('returns empty for missing or invalid input', () => {
    assert.equal(relativeTime(undefined, NOW, 'en'), '')
    assert.equal(relativeTime('', NOW, 'en'), '')
    assert.equal(relativeTime('not-a-date', NOW, 'en'), '')
    assert.equal(relativeTime(12345, NOW, 'en'), '')
  })

  it('accepts a Date for now', () => {
    assert.match(relativeTime('2026-08-18T12:00:00Z', new Date(NOW), 'en'), /2 days? ago/)
  })
})

describe('option derivation', () => {
  it('derives unique sorted values and drops blanks', () => {
    assert.deepEqual(uniqueValues(rows, 'platform'), ['instagram', 'tiktok', 'youtube'])
    assert.deepEqual(uniqueValues(rows, 'group'), ['ads', 'ops'])
    assert.deepEqual(uniqueValues([...rows, { group: '  ' }], 'group'), ['ads', 'ops'])
    assert.deepEqual(uniqueValues([], 'group'), [])
  })

  it('lists only statuses present in the data in display order', () => {
    assert.deepEqual(presentStatuses(rows), ['active', 'expiring', 'expired', 'error'])
    assert.deepEqual(presentStatuses([{ status: 'expired' }, { status: 'expired' }]), ['expired'])
    assert.deepEqual(presentStatuses([]), [])
    assert.deepEqual(presentStatuses([{ id: 'a' }]), [])
  })
})

describe('selection helpers', () => {
  it('selectRows keeps input order and accepts Set or array of ids', () => {
    assert.deepEqual(selectRows(rows, new Set(['b', 'd'])).map((r) => r.id), ['b', 'd'])
    assert.deepEqual(selectRows(rows, ['d', 'b']).map((r) => r.id), ['b', 'd'])
    assert.deepEqual(selectRows(rows, new Set(['ghost'])), [])
    assert.deepEqual(selectRows(rows, new Set()), [])
    assert.deepEqual(selectRows('nope', new Set(['a'])), [])
  })

  it('selectAllState reports all / some / count over visible rows', () => {
    assert.deepEqual(selectAllState(rows, new Set(['a', 'b', 'c', 'd', 'e'])), { all: true, some: true, count: 5 })
    assert.deepEqual(selectAllState(rows, new Set(['a'])), { all: false, some: true, count: 1 })
    assert.deepEqual(selectAllState(rows, new Set(['ghost'])), { all: false, some: false, count: 0 })
    assert.deepEqual(selectAllState([], new Set(['a'])), { all: false, some: false, count: 0 })
    // ids not currently visible do not count toward all
    assert.deepEqual(selectAllState(rows.slice(0, 2), new Set(['a', 'b', 'c'])), { all: true, some: true, count: 2 })
  })
})
