/**
 * Minimal ISO-BMFF muxer for a single AVC video track + optional AAC audio.
 * Writes a playable ftyp/moov/mdat MP4 without a third-party muxer.
 */

function concat(chunks) {
  const size = chunks.reduce((sum, item) => sum + item.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function u8(...bytes) {
  return new Uint8Array(bytes)
}

function u16(value) {
  return u8((value >> 8) & 0xff, value & 0xff)
}

function u32(value) {
  return u8(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  )
}

function u64(value) {
  const hi = Math.floor(value / 0x100000000)
  const lo = value >>> 0
  return concat([u32(hi), u32(lo)])
}

function fourcc(tag) {
  return new Uint8Array([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)])
}

function box(type, ...payloads) {
  const body = concat(payloads)
  return concat([u32(body.byteLength + 8), fourcc(type), body])
}

function fullBox(type, version, flags, ...payloads) {
  return box(type, u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...payloads)
}

function ascii(text, length) {
  const out = new Uint8Array(length)
  for (let i = 0; i < Math.min(text.length, length); i += 1) out[i] = text.charCodeAt(i)
  return out
}

function parseAvcDecoderConfig(description) {
  const view = description instanceof Uint8Array ? description : new Uint8Array(description)
  if (view.byteLength >= 7 && view[0] === 1) return view
  // Annex-B fallback: split NALs and pack as avcC.
  const nals = splitAnnexB(view)
  const sps = nals.find((nal) => (nal[0] & 0x1f) === 7) || nals[0] || new Uint8Array()
  const pps = nals.find((nal) => (nal[0] & 0x1f) === 8) || nals[1] || new Uint8Array()
  return concat([
    u8(1, sps[1] || 0x64, sps[2] || 0, sps[3] || 0x1f, 0xff),
    u8(0xe1),
    u16(sps.byteLength),
    sps,
    u8(1),
    u16(pps.byteLength),
    pps,
  ])
}

function splitAnnexB(data) {
  const nals = []
  let i = 0
  while (i < data.length) {
    let start = -1
    if (i + 3 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) start = i + 3
    if (i + 4 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) start = i + 4
    if (start < 0) {
      i += 1
      continue
    }
    let next = data.length
    for (let j = start; j + 3 < data.length; j += 1) {
      if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
        next = j
        break
      }
    }
    nals.push(data.subarray(start, next))
    i = next
  }
  return nals
}

function toLengthPrefixed(chunk, description) {
  const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  if (description && description.byteLength >= 7 && description[0] === 1) {
    // Already length-prefixed AVC.
    return data
  }
  const nals = splitAnnexB(data)
  if (nals.length === 0) return data
  const parts = []
  for (const nal of nals) parts.push(u32(nal.byteLength), nal)
  return concat(parts)
}

/**
 * @param {{
 *   width: number,
 *   height: number,
 *   fps: number,
 *   videoChunks: Array<{ data: Uint8Array, timestamp: number, duration: number, type: string, description?: Uint8Array }>,
 *   audioChunks?: Array<{ data: Uint8Array, timestamp: number, duration: number }>,
 *   audioSampleRate?: number,
 *   audioChannels?: number,
 * }} opts
 */
export function muxMp4(opts) {
  const timescale = 30_000
  const fps = Math.max(1, opts.fps || 30)
  const frameDuration = Math.round(timescale / fps)
  const videoSamples = opts.videoChunks.map((chunk, index) => {
    const duration = chunk.duration > 0
      ? Math.max(1, Math.round((chunk.duration / 1_000_000) * timescale))
      : frameDuration
    return {
      data: toLengthPrefixed(chunk.data, chunk.description),
      duration,
      isKey: chunk.type === 'key' || index === 0,
      timestamp: chunk.timestamp || 0,
      description: chunk.description,
    }
  })
  if (videoSamples.length === 0) {
    throw new Error('export-encode-failed: no video samples')
  }
  const avcC = parseAvcDecoderConfig(videoSamples.find((s) => s.description)?.description || videoSamples[0].data)

  const mdatParts = []
  let videoOffset = 0
  const chunkOffsets = []
  const sampleSizes = []
  const sampleDurations = []
  const syncSamples = []
  videoSamples.forEach((sample, index) => {
    chunkOffsets.push(videoOffset)
    sampleSizes.push(sample.data.byteLength)
    sampleDurations.push(sample.duration)
    if (sample.isKey) syncSamples.push(index + 1)
    mdatParts.push(sample.data)
    videoOffset += sample.data.byteLength
  })
  const videoDuration = sampleDurations.reduce((sum, item) => sum + item, 0)

  const audio = (opts.audioChunks || []).map((chunk) => ({
    data: chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data),
    duration: Math.max(1, Math.round(((chunk.duration || 0) / 1_000_000) * (opts.audioSampleRate || 48000))),
  }))
  const audioSampleRate = opts.audioSampleRate || 48000
  const audioChannels = opts.audioChannels || 2
  const audioSizes = audio.map((s) => s.data.byteLength)
  const audioDurations = audio.map((s) => s.duration || 1024)
  const audioDuration = audioDurations.reduce((sum, item) => sum + item, 0)
  let audioOffset = videoOffset
  const audioChunkOffsets = []
  for (const sample of audio) {
    audioChunkOffsets.push(audioOffset)
    mdatParts.push(sample.data)
    audioOffset += sample.data.byteLength
  }

  const mvhd = fullBox(
    'mvhd',
    0, 0,
    u32(0), u32(0),
    u32(timescale),
    u32(videoDuration),
    u32(0x00010000),
    u16(0x0100),
    u16(0),
    u32(0), u32(0),
    concat([
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
    ]),
    u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
    u32(audio.length ? 3 : 2),
  )

  const tkhd = fullBox(
    'tkhd',
    0, 0x000003,
    u32(0), u32(0),
    u32(1),
    u32(0),
    u32(videoDuration),
    u32(0), u32(0),
    u16(0), u16(0),
    u16(0), u16(0),
    concat([
      u32(0x00010000), u32(0), u32(0),
      u32(0), u32(0x00010000), u32(0),
      u32(0), u32(0), u32(0x40000000),
    ]),
    u32(opts.width << 16),
    u32(opts.height << 16),
  )

  const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(videoDuration), u16(0x55c4), u16(0))
  const hdlr = fullBox('hdlr', 0, 0, u32(0), fourcc('vide'), u32(0), u32(0), u32(0), ascii('VideoHandler', 13))
  const vmhd = fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0))
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)))

  const avc1 = concat([
    u32(8 + 78 + avcC.byteLength + 8), fourcc('avc1'),
    u8(0, 0, 0, 0, 0, 0),
    u16(1),
    u16(0), u16(0),
    u32(0), u32(0), u32(0),
    u16(opts.width), u16(opts.height),
    u32(0x00480000), u32(0x00480000),
    u32(0),
    u16(1),
    ascii('AVC Coding', 32),
    u16(0x0018),
    u16(0xffff),
    box('avcC', avcC),
  ])
  const stsd = fullBox('stsd', 0, 0, u32(1), avc1)
  const sttsEntries = compress(sampleDurations)
  const stts = fullBox(
    'stts', 0, 0,
    u32(sttsEntries.length),
    ...sttsEntries.flatMap(([count, duration]) => [u32(count), u32(duration)]),
  )
  const stss = fullBox('stss', 0, 0, u32(syncSamples.length), ...syncSamples.map((n) => u32(n)))
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(sampleSizes.length), ...sampleSizes.map((n) => u32(n)))
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1))
  const stcoPlaceholder = fullBox('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map(() => u32(0)))
  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stcoPlaceholder)
  const minf = box('minf', vmhd, dinf, stbl)
  const mdia = box('mdia', mdhd, hdlr, minf)
  const videoTrak = box('trak', tkhd, mdia)

  let audioTrak = new Uint8Array(0)
  let audioStcoPlaceholder = new Uint8Array(0)
  if (audio.length) {
    const audioTkhd = fullBox(
      'tkhd', 0, 0x000003,
      u32(0), u32(0),
      u32(2),
      u32(0),
      u32(Math.round(audioDuration * (timescale / audioSampleRate))),
      u32(0), u32(0),
      u16(0), u16(0),
      u16(0x0100), u16(0),
      concat([
        u32(0x00010000), u32(0), u32(0),
        u32(0), u32(0x00010000), u32(0),
        u32(0), u32(0), u32(0x40000000),
      ]),
      u32(0), u32(0),
    )
    const audioMdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(audioSampleRate), u32(audioDuration), u16(0x55c4), u16(0))
    const audioHdlr = fullBox('hdlr', 0, 0, u32(0), fourcc('soun'), u32(0), u32(0), u32(0), ascii('SoundHandler', 13))
    const smhd = fullBox('smhd', 0, 0, u16(0), u16(0))
    const esds = box(
      'esds',
      u8(0, 0, 0, 0),
      u8(0x03, 0x19, 0x00, 0x01, 0x00),
      u8(0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00),
      u8(0x05, 0x02, 0x11, 0x90),
      u8(0x06, 0x01, 0x02),
    )
    const mp4a = concat([
      u32(8 + 28 + esds.byteLength), fourcc('mp4a'),
      u8(0, 0, 0, 0, 0, 0),
      u16(1),
      u32(0), u32(0),
      u16(audioChannels), u16(16),
      u16(0), u16(0),
      u32(audioSampleRate << 16),
      esds,
    ])
    const aStsd = fullBox('stsd', 0, 0, u32(1), mp4a)
    const aSttsEntries = compress(audioDurations)
    const aStts = fullBox(
      'stts', 0, 0,
      u32(aSttsEntries.length),
      ...aSttsEntries.flatMap(([count, duration]) => [u32(count), u32(duration)]),
    )
    const aStsz = fullBox('stsz', 0, 0, u32(0), u32(audioSizes.length), ...audioSizes.map((n) => u32(n)))
    const aStsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1))
    audioStcoPlaceholder = fullBox('stco', 0, 0, u32(audioChunkOffsets.length), ...audioChunkOffsets.map(() => u32(0)))
    const aStbl = box('stbl', aStsd, aStts, aStsc, aStsz, audioStcoPlaceholder)
    const aMinf = box('minf', smhd, dinf, aStbl)
    const aMdia = box('mdia', audioMdhd, audioHdlr, aMinf)
    audioTrak = box('trak', audioTkhd, aMdia)
  }

  const moov = box('moov', mvhd, videoTrak, audioTrak)
  const ftyp = box('ftyp', fourcc('isom'), u32(0x200), fourcc('isom'), fourcc('iso2'), fourcc('avc1'), fourcc('mp41'))
  const mdatBody = concat(mdatParts)
  const mdat = concat([u32(mdatBody.byteLength + 8), fourcc('mdat'), mdatBody])

  const headerSize = ftyp.byteLength + moov.byteLength + 8
  const videoStco = fullBox('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map((off) => u32(off + headerSize)))
  const patchedMoov = replaceOnce(moov, stcoPlaceholder, videoStco)
  const audioStco = audio.length
    ? fullBox('stco', 0, 0, u32(audioChunkOffsets.length), ...audioChunkOffsets.map((off) => u32(off + headerSize)))
    : new Uint8Array(0)
  const finalMoov = audio.length ? replaceOnce(patchedMoov, audioStcoPlaceholder, audioStco) : patchedMoov
  return concat([ftyp, finalMoov, mdat])
}

function compress(durations) {
  const entries = []
  for (const duration of durations) {
    const last = entries[entries.length - 1]
    if (last && last[1] === duration) last[0] += 1
    else entries.push([1, duration])
  }
  return entries
}

function replaceOnce(haystack, needle, replacement) {
  const src = haystack
  const n = needle
  outer: for (let i = 0; i + n.byteLength <= src.byteLength; i += 1) {
    for (let j = 0; j < n.byteLength; j += 1) {
      if (src[i + j] !== n[j]) continue outer
    }
    return concat([src.subarray(0, i), replacement, src.subarray(i + n.byteLength)])
  }
  return src
}

export function bytesToBase64(bytes) {
  const u8arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < u8arr.length; i += chunk) {
    binary += String.fromCharCode(...u8arr.subarray(i, i + chunk))
  }
  return btoa(binary)
}
