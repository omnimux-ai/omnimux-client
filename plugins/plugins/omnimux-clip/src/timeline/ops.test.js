import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ClipDomainError } from '../errors.js'
import { createEmptySchema } from '../client/store/timelineTypes.js'
import { applyOperations, findClip } from './ops.js'
import { diagnoseTimeline } from './diagnostics.js'
import { secToMs } from './time.js'

function seeded() {
  const schema = createEmptySchema({ projectId: 'demo' })
  const applied = applyOperations(schema, [{
    type: 'import_media',
    path: '/tmp/a.mp4',
    name: 'A',
    mediaType: 'video',
    durationSec: 4,
    startSec: 0,
  }])
  return applied.schema
}

describe('secToMs', () => {
  it('converts agent seconds to integer milliseconds', () => {
    assert.equal(secToMs(1.5, 't'), 1500)
    assert.equal(secToMs(0, 't'), 0)
    assert.throws(
      () => secToMs('nope', 't'),
      (error) => error instanceof ClipDomainError && error.code === 'invalid-json',
    )
  })
})

describe('applyOperations', () => {
  it('splits, trims, moves and removes as one batch', () => {
    const schema = seeded()
    const clipId = schema.tracks[0].clips[0].id
    const { schema: next, results } = applyOperations(schema, [
      { type: 'split_clip', clipId, atSec: 1.5 },
      { type: 'set_speed', clipId, speed: 2 },
      { type: 'set_volume', clipId, volume: 0.4 },
    ])
    assert.equal(next.tracks[0].clips.length, 2)
    assert.equal(next.tracks[0].clips[0].durationMs, 1500)
    assert.equal(next.tracks[0].clips[0].speed, 2)
    assert.equal(next.tracks[0].clips[0].volume, 0.4)
    assert.equal(results.length, 3)
    assert.equal(results[0].rightClipId, next.tracks[0].clips[1].id)
  })

  it('set_text creates a caption at 56px when no clipId', () => {
    const schema = seeded()
    const { schema: next, results } = applyOperations(schema, [{
      type: 'set_text',
      content: '花字',
      fontSize: 56,
      startSec: 0.2,
      durationSec: 2,
    }])
    const textTrack = next.tracks.find((track) => track.type === 'text')
    assert.equal(textTrack.clips.length, 1)
    assert.equal(textTrack.clips[0].textStyle.fontSize, 56)
    assert.equal(textTrack.clips[0].textStyle.content, '花字')
    assert.equal(textTrack.clips[0].startTimeMs, 200)
    assert.equal(results[0].created, true)
  })

  it('remove_range splits a covering clip', () => {
    const schema = seeded()
    const clipId = schema.tracks[0].clips[0].id
    const { schema: next } = applyOperations(schema, [{
      type: 'remove_range',
      fromSec: 1,
      toSec: 2,
      trackId: 'track_video',
    }])
    assert.equal(next.tracks[0].clips.length, 2)
    assert.equal(next.tracks[0].clips[0].id, clipId)
    assert.equal(next.tracks[0].clips[0].durationMs, 1000)
    assert.equal(next.tracks[0].clips[1].startTimeMs, 2000)
  })

  it('cut_silences closes video-track gaps', () => {
    const schema = seeded()
    const withGap = applyOperations(schema, [{
      type: 'add_clip',
      trackId: 'track_video',
      name: 'B',
      path: '/tmp/b.mp4',
      startSec: 6,
      durationSec: 2,
    }]).schema
    const { schema: next, results } = applyOperations(withGap, [{
      type: 'cut_silences',
      trackId: 'track_video',
      minSilenceSec: 0.3,
    }])
    const clips = next.tracks[0].clips.sort((a, b) => a.startTimeMs - b.startTimeMs)
    assert.equal(clips[1].startTimeMs, 4000)
    assert.equal(results[0].closed, 1)
  })

  it('rejects unknown operation types with ClipDomainError', () => {
    const schema = seeded()
    assert.throws(
      () => applyOperations(schema, [{ type: 'explode' }]),
      (error) => error instanceof ClipDomainError && error.code === 'invalid-json',
    )
  })

  it('findClip throws not-found', () => {
    const schema = seeded()
    assert.throws(
      () => findClip(schema, 'missing'),
      (error) => error instanceof ClipDomainError && error.code === 'not-found',
    )
  })
})

describe('diagnoseTimeline', () => {
  it('reports timeline_gap, clip_overlap and media_missing', () => {
    const schema = createEmptySchema({ projectId: 'diag' })
    schema.tracks[0].clips = [
      {
        id: 'c1',
        trackId: 'track_video',
        name: 'A',
        mediaType: 'video',
        startTimeMs: 0,
        durationMs: 1000,
        sourceUrl: '/no/such/a.mp4',
        sourceInMs: 0,
        sourceOutMs: 1000,
        speed: 1,
        volume: 1,
      },
      {
        id: 'c2',
        trackId: 'track_video',
        name: 'B',
        mediaType: 'video',
        startTimeMs: 800,
        durationMs: 1000,
        sourceUrl: '/no/such/b.mp4',
        sourceInMs: 0,
        sourceOutMs: 1000,
        speed: 1,
        volume: 1,
      },
    ]
    const overlap = diagnoseTimeline(schema, { fs: { existsSync: () => true } })
    assert.equal(overlap.ok, false)
    assert.ok(overlap.issues.some((item) => item.code === 'clip_overlap'))

    schema.tracks[0].clips[1].startTimeMs = 1800
    const gap = diagnoseTimeline(schema, { fs: { existsSync: () => true } })
    assert.ok(gap.issues.some((item) => item.code === 'timeline_gap'))

    const missing = diagnoseTimeline(schema, { fs: { existsSync: () => false } })
    assert.ok(missing.issues.some((item) => item.code === 'media_missing'))
  })
})
