import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { probeVideoDurationSec } from './media-duration.js'
import { createMediaStore } from './media.js'

/** Build a synthetic ISO BMFF MP4 buffer containing `ftyp` + `moov/mvhd` (version 0 or 1). */
export function buildSyntheticMp4({ durationSec, timescale = 1000, version = 0, useExtendedBox = false }) {
  const ftyp = Buffer.alloc(16)
  ftyp.writeUInt32BE(16, 0)
  ftyp.write('ftyp', 4, 'ascii')
  ftyp.write('isom', 8, 'ascii')

  const mvhdPayload = version === 1 ? Buffer.alloc(36) : Buffer.alloc(24)
  mvhdPayload.writeUInt8(version, 0)
  const ticks = Math.round(durationSec * timescale)
  if (version === 0) {
    mvhdPayload.writeUInt32BE(timescale, 12)
    mvhdPayload.writeUInt32BE(ticks, 16)
  } else {
    mvhdPayload.writeUInt32BE(timescale, 20)
    const high = Math.floor(ticks / 4294967296)
    const low = ticks >>> 0
    mvhdPayload.writeUInt32BE(high, 24)
    mvhdPayload.writeUInt32BE(low, 28)
  }
  const mvhd = Buffer.alloc(8 + mvhdPayload.length)
  mvhd.writeUInt32BE(mvhd.length, 0)
  mvhd.write('mvhd', 4, 'ascii')
  mvhdPayload.copy(mvhd, 8)

  const moov = Buffer.alloc(8 + mvhd.length)
  moov.writeUInt32BE(moov.length, 0)
  moov.write('moov', 4, 'ascii')
  mvhd.copy(moov, 8)

  if (!useExtendedBox) return Buffer.concat([ftyp, moov])

  // Insert an extended-size (64-bit) `free` box before `moov`
  const freePayload = Buffer.alloc(12)
  const freeBox = Buffer.alloc(16 + freePayload.length)
  freeBox.writeUInt32BE(1, 0)
  freeBox.write('free', 4, 'ascii')
  freeBox.writeUInt32BE(0, 8)
  freeBox.writeUInt32BE(freeBox.length, 12)
  freePayload.copy(freeBox, 16)
  return Buffer.concat([ftyp, freeBox, moov])
}

/** Encode a small EBML data size (< 127) as 1-byte VINT. */
function ebmlSize1(len) {
  return Buffer.from([0x80 | len])
}

/** Build a synthetic WebM/MKV EBML buffer containing `EBML + Segment -> Info(TimestampScale + Duration)`. */
export function buildSyntheticWebm({ durationSec, timestampScale = 1_000_000, floatBytes = 4 }) {
  const ebmlHeader = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), ebmlSize1(4), Buffer.from([0x42, 0x86, 0x81, 0x01])])
  const scaleBuf = Buffer.alloc(4)
  scaleBuf.writeUInt32BE(timestampScale, 0)
  const scaleEl = Buffer.concat([Buffer.from([0x2a, 0xd7, 0xb1]), ebmlSize1(4), scaleBuf])

  const ticks = (durationSec * 1e9) / timestampScale
  const durBuf = Buffer.alloc(floatBytes)
  if (floatBytes === 8) durBuf.writeDoubleBE(ticks, 0)
  else durBuf.writeFloatBE(ticks, 0)
  const durEl = Buffer.concat([Buffer.from([0x44, 0x89]), ebmlSize1(floatBytes), durBuf])

  const infoPayload = Buffer.concat([scaleEl, durEl])
  const infoEl = Buffer.concat([Buffer.from([0x15, 0x49, 0xa9, 0x66]), ebmlSize1(infoPayload.length), infoPayload])
  const segEl = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67]), ebmlSize1(infoEl.length), infoEl])
  return Buffer.concat([ebmlHeader, segEl])
}

describe('probeVideoDurationSec (pure JS MP4/MOV/WebM parser)', () => {
  it('parses MP4 mvhd version 0 and version 1 durations including 64-bit extended boxes', () => {
    assert.equal(probeVideoDurationSec(buildSyntheticMp4({ durationSec: 45, version: 0 }), 'video/mp4', 'a.mp4'), 45)
    assert.equal(probeVideoDurationSec(buildSyntheticMp4({ durationSec: 680.5, version: 0 }), 'video/mp4', 'long.mp4'), 680.5)
    assert.equal(probeVideoDurationSec(buildSyntheticMp4({ durationSec: 120, version: 1 }), 'video/quicktime', 'clip.mov'), 120)
    assert.equal(probeVideoDurationSec(buildSyntheticMp4({ durationSec: 215, version: 0, useExtendedBox: true }), 'video/mp4', 'ext.mp4'), 215)
  })

  it('parses WebM/MKV EBML Segment/Info durations (float32 & float64)', () => {
    assert.equal(probeVideoDurationSec(buildSyntheticWebm({ durationSec: 45.5, floatBytes: 4 }), 'video/webm', 'a.webm'), 45.5)
    assert.equal(probeVideoDurationSec(buildSyntheticWebm({ durationSec: 680, floatBytes: 8 }), 'video/x-matroska', 'long.mkv'), 680)
  })

  it('returns null safely for non-video, truncated, or malformed buffers', () => {
    assert.equal(probeVideoDurationSec(Buffer.from('not-a-video'), 'video/mp4', 'bad.mp4'), null)
    assert.equal(probeVideoDurationSec(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/png', 'a.png'), null)
    assert.equal(probeVideoDurationSec(Buffer.alloc(4), 'video/mp4', 'tiny.mp4'), null)
    assert.equal(probeVideoDurationSec(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]), 'video/webm', 'corrupt.webm'), null)
  })
})

describe('MediaStore video duration persistence & lazy backfill', () => {
  it('probes duration_sec on video import and lazily backfills legacy media.json records without duration_sec', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-publish-dur-'))
    try {
      const paths = { mediaIndexFile: join(dir, 'media.json'), mediaDir: join(dir, 'media') }
      const store = createMediaStore({ paths, maxBytes: 1024 * 1024 })
      const mp4 = buildSyntheticMp4({ durationSec: 185, version: 0 })
      const { media } = store.importBuffer(mp4, { filename: 'clip.mp4', content_type: 'video/mp4' })
      assert.equal(media.duration_sec, 185)

      const { media: img } = store.importBuffer(Buffer.from('jpg-data'), { filename: 'p.jpg', content_type: 'image/jpeg' })
      assert.equal(img.duration_sec, undefined)

      // Simulate a legacy media.json video row lacking `duration_sec`
      const legacyDir = mkdtempSync(join(tmpdir(), 'dsh-publish-legacy-dur-'))
      try {
        const legacyPaths = { mediaIndexFile: join(legacyDir, 'media.json'), mediaDir: join(legacyDir, 'media') }
        mkdirSync(legacyPaths.mediaDir, { recursive: true })
        const legacyMp4 = buildSyntheticMp4({ durationSec: 650, version: 0 })
        writeFileSync(join(legacyPaths.mediaDir, 'legacyhash'), legacyMp4)
        writeFileSync(legacyPaths.mediaIndexFile, JSON.stringify({
          schema: 1,
          revision: 1,
          media: [{
            id: 'legacyhash',
            sha256: 'legacyhash',
            filename: 'old.mp4',
            content_type: 'video/mp4',
            kind: 'video',
            size: legacyMp4.length,
            created_at: '2026-01-01T00:00:00.000Z',
          }],
        }))
        const legacyStore = createMediaStore({ paths: legacyPaths, maxBytes: 1024 * 1024 })
        assert.equal(legacyStore.get('legacyhash').duration_sec, undefined)
        const probed = legacyStore.probeDuration('legacyhash')
        assert.equal(probed.duration_sec, 650)
        assert.equal(legacyStore.get('legacyhash').duration_sec, 650)
      } finally {
        rmSync(legacyDir, { recursive: true, force: true })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
