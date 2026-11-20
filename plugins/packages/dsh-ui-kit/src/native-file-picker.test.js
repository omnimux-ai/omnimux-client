import assert from 'node:assert/strict'
import test from 'node:test'
import { hasDesktopFilePicker, requestFilePicker } from './native-file-picker.js'

const request = { kind: 'file', extensions: ['png'], multiple: false }
const unused = () => assert.fail('the Desktop picker must own this request')
const desktop = open => ({ protocolVersion: 1, filePicker: { version: 1, open } })

test('the Desktop picker receives the filters and preserves path order', async () => {
  const paths = ['/tmp/测试 素材.png', '/tmp/second.png']
  let input
  const carrier = desktop(async options => {
    input = options
    return { ok: true, path: paths[0], paths }
  })
  assert.equal(hasDesktopFilePicker(carrier), true)
  assert.deepEqual(await requestFilePicker(request, unused, carrier), {
    ok: true, status: 200, body: { path: paths[0], paths },
  })
  assert.equal(input, request)
})

test('cancellation is a successful empty selection', async () => {
  const carrier = desktop(async () => ({ ok: true, path: null, paths: [] }))
  assert.deepEqual(await requestFilePicker(request, unused, carrier), {
    ok: true, status: 200, body: { path: null, paths: [] },
  })
})

test('a Desktop without the v1 picker reports an update instead of using the Web request', async () => {
  for (const carrier of [{ protocolVersion: 1 }, { protocolVersion: 1, filePicker: { version: 2 } }]) {
    assert.equal(hasDesktopFilePicker(carrier), false)
    const result = await requestFilePicker(request, unused, carrier)
    assert.equal(result.ok, false)
    assert.equal(result.body.error, 'picker-update-required')
    assert.ok(result.body.message)
  }
})

test('Web gets its existing response and propagates the original network failure', async () => {
  const response = { ok: true, status: 200, body: { path: '/tmp/x', paths: ['/tmp/x'] } }
  assert.equal(await requestFilePicker(request, async () => response, {}), response)
  await assert.rejects(requestFilePicker(request, async () => { throw new Error('offline') }, {}), /offline/)
})

test('Desktop failures, invalid payloads, and rejected transport stay distinct from cancellation', async () => {
  const outcomes = [
    [async () => ({ ok: false, error: 'picker-busy' }), 409, 'picker-busy'],
    [async () => ({ ok: false, error: 'picker-gesture-required' }), 403, 'picker-gesture-required'],
    [async () => ({ ok: true, path: null, paths: [''] }), 500, 'picker-failed'],
    [async () => { throw new Error('renderer closed') }, 500, 'picker-failed'],
  ]
  for (const [open, status, error] of outcomes) {
    const result = await requestFilePicker(request, unused, desktop(open))
    assert.equal(result.ok, false)
    assert.equal(result.status, status)
    assert.equal(result.body.error, error)
    assert.deepEqual(result.body.paths, [])
  }
})
