import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { timelineStore } from './timelineStore.js'
import { schemaFromOpenPayload } from './timelineTypes.js'

describe('timelineStore', () => {
  beforeEach(() => {
    timelineStore.reset()
  })

  it('hydrates upstream media onto video/audio tracks', () => {
    timelineStore.hydrateFromPayload({
      source: 'canvas',
      nodeId: 'n1',
      nodeTitle: '成片',
      projectId: 'proj1',
      upstreamInputs: {
        videos: [{ path: '/tmp/a.mp4', name: 'A', durationMs: 2000 }],
        images: [{ path: '/tmp/b.png', name: 'B', displayDurationMs: 1000 }],
        audios: [{ path: '/tmp/c.mp3', name: 'C', durationMs: 1500 }],
        captions: [{ text: '你好', startTimeMs: 0, durationMs: 1200 }],
      },
    })
    const { schema, projectName } = timelineStore.getState()
    assert.equal(projectName, '成片')
    assert.equal(schema.projectId, 'proj1')
    const video = schema.tracks.find((t) => t.type === 'video')
    const audio = schema.tracks.find((t) => t.type === 'audio')
    const text = schema.tracks.find((t) => t.type === 'text')
    assert.equal(video.clips.length, 2)
    assert.equal(audio.clips.length, 1)
    assert.equal(text.clips.length, 1)
    assert.equal(video.clips[1].startTimeMs, 2000)
  })

  it('splits, trims, moves, and undoes clip edits', () => {
    timelineStore.hydrateFromPayload({
      source: 'canvas',
      nodeId: 'n1',
      projectId: 'proj2',
      upstreamInputs: {
        videos: [{ path: '/tmp/a.mp4', name: 'A', durationMs: 4000 }],
      },
    })
    const clipId = timelineStore.getState().schema.tracks[0].clips[0].id
    timelineStore.splitClip(clipId, 1500)
    assert.equal(timelineStore.getState().schema.tracks[0].clips.length, 2)
    const left = timelineStore.getState().schema.tracks[0].clips[0]
    assert.equal(left.durationMs, 1500)
    timelineStore.moveClip(left.id, { startTimeMs: 200 })
    assert.equal(timelineStore.getState().schema.tracks[0].clips[0].startTimeMs, 200)
    timelineStore.undo()
    assert.equal(timelineStore.getState().schema.tracks[0].clips[0].startTimeMs, 0)
    timelineStore.redo()
    assert.equal(timelineStore.getState().schema.tracks[0].clips[0].startTimeMs, 200)
    timelineStore.setSpeed(left.id, 2)
    assert.equal(timelineStore.getState().schema.tracks[0].clips[0].speed, 2)
    timelineStore.removeClip(left.id)
    assert.equal(timelineStore.getState().schema.tracks[0].clips.length, 1)
  })

  it('keeps draftSchema when reopening', () => {
    const schema = schemaFromOpenPayload({
      projectId: 'keep',
      upstreamInputs: { videos: [{ path: '/x.mp4', name: 'X', durationMs: 1000 }] },
    })
    const again = schemaFromOpenPayload({ projectId: 'keep', draftSchema: schema })
    assert.equal(again.tracks[0].clips.length, 1)
    assert.equal(again.projectId, 'keep')
  })
})
