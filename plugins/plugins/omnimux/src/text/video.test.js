import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { durationFromIsoBmff, probeTextVideo } from './video.js'

function box(type, payload) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(header.length + payload.length, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function mp4WithDuration(seconds, timescale = 1_000) {
  const ftyp = box('ftyp', Buffer.from([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]))
  const payload = Buffer.alloc(20)
  payload.writeUInt32BE(timescale, 12)
  payload.writeUInt32BE(Math.round(seconds * timescale), 16)
  return Buffer.concat([ftyp, box('moov', box('mvhd', payload))])
}

describe('video byte metadata', () => {
  it('reads duration from the nested ISO-BMFF movie header', () => {
    assert.equal(durationFromIsoBmff(mp4WithDuration(15.25)), 15.25)
  })

  it('returns byte-derived MIME, size, and duration without network access', async () => {
    const bytes = mp4WithDuration(30)
    const result = await probeTextVideo(`data:video/mp4;base64,${bytes.toString('base64')}`, {
      maxVideoBytes: 200 * 1024 * 1024,
    })
    assert.equal(result.mediaType, 'video/mp4')
    assert.equal(result.sizeBytes, bytes.byteLength)
    assert.equal(result.durationSec, 30)
  })

  it('keeps duration unknown when the container has no movie header', async () => {
    const bytes = box('ftyp', Buffer.from([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]))
    const result = await probeTextVideo(`data:video/mp4;base64,${bytes.toString('base64')}`)
    assert.equal('durationSec' in result, false)
  })
})
