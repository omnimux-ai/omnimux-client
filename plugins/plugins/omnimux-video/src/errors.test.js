import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VideoError } from './errors.js'

test('VideoError carries code and name', () => {
  const e = new VideoError('video-invalid-input', 'missing videoUrl')
  assert.ok(e instanceof Error)
  assert.equal(e.name, 'VideoError')
  assert.equal(e.code, 'video-invalid-input')
  assert.equal(e.message, 'missing videoUrl')
})

test('VideoError attaches extra hint and stderrTail', () => {
  const e = new VideoError('video-ffmpeg-failed', 'boom', { hint: 're-encode first', stderrTail: 'tail...' })
  assert.equal(e.hint, 're-encode first')
  assert.equal(e.stderrTail, 'tail...')
})

test('VideoError tolerates missing extra', () => {
  const e = new VideoError('video-timeout', 'slow')
  assert.equal(e.hint, undefined)
  assert.equal(e.stderrTail, undefined)
})