import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertRemoteVersionAdvances,
  assertVersionAdvances,
  channelForVersion,
  compareVersions,
  fetchLiveVersion,
  parseVersion,
} from './verify-version-advance.mjs'

const manifestResponse = (version, channel) => ({
  status: 200,
  ok: true,
  statusText: 'OK',
  json: async () => ({ version, channel, sha256: {} }),
})

test('compares stable versions numerically', () => {
  assert.ok(compareVersions('2.0.24', '2.0.23') > 0)
  assert.ok(compareVersions('2.0.23', '2.0.24') < 0)
  assert.equal(compareVersions('2.0.24', '2.0.24'), 0)
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0)
})

test('follows SemVer prerelease precedence', () => {
  assert.ok(compareVersions('2.0.24-next', '2.0.24') < 0)
  assert.ok(compareVersions('2.0.24-next.2', '2.0.24-next') > 0)
  assert.ok(compareVersions('2.0.24-beta', '2.0.24-next') < 0)
  assert.equal(compareVersions('2.0.24+build.7', '2.0.24'), 0)
})

test('rejects equal and older versions', () => {
  assert.doesNotThrow(() => assertVersionAdvances('2.0.24', '2.0.23'))
  assert.throws(() => assertVersionAdvances('2.0.23', '2.0.23'), /must advance/)
  assert.throws(() => assertVersionAdvances('2.0.22', '2.0.23'), /must advance/)
})

test('derives the channel from the prerelease tag', () => {
  assert.equal(channelForVersion('2.0.24'), 'stable')
  assert.equal(channelForVersion('2.0.24-beta'), 'beta')
  assert.equal(channelForVersion('2.0.24-next'), 'next')
  assert.throws(() => channelForVersion('2.0.24-rc.1'), /does not belong/)
})

test('rejects malformed versions', () => {
  assert.throws(() => parseVersion('2.0'), /not a canonical SemVer/)
  assert.throws(() => parseVersion('v2.0.24'), /not a canonical SemVer/)
})

test('treats a missing channel manifest as the first publish', async t => {
  const result = await fetchLiveVersion({
    channel: 'stable',
    fetchImpl: async () => ({ status: 404, ok: false, statusText: 'Not Found' }),
    timeoutMs: 100,
  })
  assert.equal(result, null)
  void t
})

test('fails closed on malformed live manifests', async () => {
  await assert.rejects(
    fetchLiveVersion({ channel: 'stable', fetchImpl: async () => ({ status: 200, ok: true, statusText: 'OK', json: async () => ({}) }), timeoutMs: 100 }),
    /missing a version field/,
  )
  await assert.rejects(
    fetchLiveVersion({ channel: 'stable', fetchImpl: async () => ({ status: 200, ok: true, statusText: 'OK', json: async () => ({ version: 'banana' }) }), timeoutMs: 100 }),
    /not a canonical SemVer/,
  )
})

test('enforces the live CDN version through the injected fetch', async () => {
  const logs = []
  const ok = await assertRemoteVersionAdvances({
    version: '2.0.24',
    channel: 'stable',
    fetchImpl: async () => manifestResponse('2.0.23', 'stable'),
    log: message => logs.push(message),
  })
  assert.deepEqual(ok, { candidate: '2.0.24', live: '2.0.23' })
  assert.match(logs.at(-1), /guard passed/)

  await assert.rejects(
    assertRemoteVersionAdvances({
      version: '2.0.24',
      channel: 'stable',
      fetchImpl: async () => manifestResponse('2.0.24', 'stable'),
      log: () => {},
    }),
    /must advance/,
  )
  await assert.rejects(
    assertRemoteVersionAdvances({
      version: '2.0.24',
      channel: 'stable',
      fetchImpl: async () => manifestResponse('2.0.25', 'stable'),
      log: () => {},
    }),
    /must advance/,
  )
})
