/**
 * Pure-JS video container duration prober (zero external binary / ffprobe dependency).
 * Supports:
 *   1. ISO BMFF (MP4 / MOV / M4V): parses `moov` -> `mvhd` (version 0 & 1).
 *   2. EBML (WebM / MKV): parses `Segment` (0x18538067) -> `Info` (0x1549A966)
 *      -> `TimestampScale` (0x2AD7B1, default 1_000_000 ns) & `Duration` (0x4489).
 *
 * Malformed, truncated, or unsupported buffers safely return `null` without throwing.
 */

const MAX_BOX_STEPS = 4096
const MAX_EBML_STEPS = 4096
const DEFAULT_EBML_TIMESTAMP_SCALE = 1_000_000

/**
 * Round positive finite seconds to 2 decimal places.
 * @param {number} seconds
 * @returns {number | null}
 */
function normalizeSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds * 100) / 100
}

/**
 * Parse ISO BMFF `mvhd` payload (starting at `payloadStart`, length `payloadEnd - payloadStart`).
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @returns {number | null}
 */
function parseMvhd(bytes, start, end) {
  const len = end - start
  if (len < 20) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, len)
  const version = view.getUint8(0)
  if (version === 0) {
    if (len < 20) return null
    const timescale = view.getUint32(12, false)
    const duration = view.getUint32(16, false)
    if (timescale === 0 || duration === 0 || duration === 0xffffffff) return null
    return normalizeSeconds(duration / timescale)
  }
  if (version === 1) {
    if (len < 32) return null
    const timescale = view.getUint32(20, false)
    const high = view.getUint32(24, false)
    const low = view.getUint32(28, false)
    if (timescale === 0) return null
    if (high === 0xffffffff && low === 0xffffffff) return null
    const duration = high * 4294967296 + low
    if (duration <= 0) return null
    return normalizeSeconds(duration / timescale)
  }
  return null
}

/**
 * Read a 4-byte ASCII box type at `offset`.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {string}
 */
function readBoxType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  )
}

/**
 * Scan ISO BMFF boxes in `[rangeStart, rangeEnd)` to locate `moov -> mvhd`.
 * @param {Uint8Array} bytes
 * @param {number} rangeStart
 * @param {number} rangeEnd
 * @param {number} depth
 * @returns {number | null}
 */
function scanIsoBoxes(bytes, rangeStart, rangeEnd, depth) {
  if (depth > 4) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = rangeStart
  let steps = 0
  while (offset + 8 <= rangeEnd && steps < MAX_BOX_STEPS) {
    steps += 1
    const size32 = view.getUint32(offset, false)
    const type = readBoxType(bytes, offset + 4)
    let headerSize = 8
    let boxSize = size32
    if (size32 === 1) {
      if (offset + 16 > rangeEnd) return null
      const high = view.getUint32(offset + 8, false)
      const low = view.getUint32(offset + 12, false)
      boxSize = high * 4294967296 + low
      headerSize = 16
    } else if (size32 === 0) {
      boxSize = rangeEnd - offset
    }
    if (!Number.isFinite(boxSize) || boxSize < headerSize) return null
    const boxEnd = Math.min(rangeEnd, offset + boxSize)
    const payloadStart = offset + headerSize
    if (type === 'mvhd') {
      return parseMvhd(bytes, payloadStart, boxEnd)
    }
    if (type === 'moov') {
      const found = scanIsoBoxes(bytes, payloadStart, boxEnd, depth + 1)
      if (found !== null) return found
    }
    if (boxEnd <= offset) return null
    offset = boxEnd
  }
  return null
}

/**
 * Read an EBML Element ID VINT (keeps marker bit as part of ID).
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} end
 * @returns {{ value: number, length: number } | null}
 */
function readEbmlId(bytes, offset, end) {
  if (offset >= end) return null
  const first = bytes[offset]
  if (first === 0) return null
  let length = 1
  let mask = 0x80
  while (length <= 4 && (first & mask) === 0) {
    mask >>= 1
    length += 1
  }
  if (length > 4 || offset + length > end) return null
  let value = 0
  for (let i = 0; i < length; i += 1) {
    value = value * 256 + bytes[offset + i]
  }
  return { value, length }
}

/**
 * Read an EBML Data Size VINT (strips marker bit). Returns `-1` for unknown/indefinite size.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} end
 * @returns {{ value: number, length: number } | null}
 */
function readEbmlSize(bytes, offset, end) {
  if (offset >= end) return null
  const first = bytes[offset]
  if (first === 0) return null
  let length = 1
  let mask = 0x80
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1
    length += 1
  }
  if (length > 8 || offset + length > end) return null
  const firstVal = first & (mask - 1)
  let allOnes = firstVal === mask - 1
  let value = firstVal
  for (let i = 1; i < length; i += 1) {
    const b = bytes[offset + i]
    if (b !== 0xff) allOnes = false
    value = value * 256 + b
  }
  return { value: allOnes ? -1 : value, length }
}

/**
 * Read a big-endian unsigned integer of 1..8 bytes.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 * @returns {number | null}
 */
function readUintBE(bytes, offset, length) {
  if (length <= 0 || length > 8 || offset + length > bytes.byteLength) return null
  let value = 0
  for (let i = 0; i < length; i += 1) {
    value = value * 256 + bytes[offset + i]
  }
  return value
}

/**
 * Parse EBML `Info` element (0x1549A966) for `TimestampScale` and `Duration`.
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @returns {number | null}
 */
function parseEbmlInfo(bytes, start, end) {
  let offset = start
  let steps = 0
  let timestampScale = DEFAULT_EBML_TIMESTAMP_SCALE
  /** @type {number | null} */
  let durationTicks = null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (offset < end && steps < MAX_EBML_STEPS) {
    steps += 1
    const id = readEbmlId(bytes, offset, end)
    if (!id) break
    const size = readEbmlSize(bytes, offset + id.length, end)
    if (!size) break
    const dataStart = offset + id.length + size.length
    if (size.value < 0) break
    const dataEnd = Math.min(end, dataStart + size.value)
    if (id.value === 0x2ad7b1) {
      const parsed = readUintBE(bytes, dataStart, dataEnd - dataStart)
      if (parsed !== null && parsed > 0) timestampScale = parsed
    } else if (id.value === 0x4489) {
      const dLen = dataEnd - dataStart
      if (dLen === 4) durationTicks = view.getFloat32(dataStart, false)
      else if (dLen === 8) durationTicks = view.getFloat64(dataStart, false)
    }
    if (dataEnd <= offset) break
    offset = dataEnd
  }
  if (durationTicks === null || !Number.isFinite(durationTicks) || durationTicks <= 0) return null
  return normalizeSeconds((durationTicks * timestampScale) / 1e9)
}

/**
 * Parse EBML container (WebM / MKV) for `Segment -> Info`.
 * @param {Uint8Array} bytes
 * @returns {number | null}
 */
function parseEbmlDuration(bytes) {
  if (bytes.byteLength < 12) return null
  // EBML header magic 0x1A 0x45 0xDF 0xA3
  if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return null
  let offset = 0
  let steps = 0
  const end = bytes.byteLength
  while (offset < end && steps < MAX_EBML_STEPS) {
    steps += 1
    const id = readEbmlId(bytes, offset, end)
    if (!id) return null
    const size = readEbmlSize(bytes, offset + id.length, end)
    if (!size) return null
    const dataStart = offset + id.length + size.length
    const dataEnd = size.value < 0 ? end : Math.min(end, dataStart + size.value)
    if (id.value === 0x18538067) {
      // Segment: scan children for Info (0x1549A966)
      let childOffset = dataStart
      let childSteps = 0
      while (childOffset < dataEnd && childSteps < MAX_EBML_STEPS) {
        childSteps += 1
        const cid = readEbmlId(bytes, childOffset, dataEnd)
        if (!cid) break
        const csize = readEbmlSize(bytes, childOffset + cid.length, dataEnd)
        if (!csize) break
        const cStart = childOffset + cid.length + csize.length
        const cEnd = csize.value < 0 ? dataEnd : Math.min(dataEnd, cStart + csize.value)
        if (cid.value === 0x1549a966) {
          return parseEbmlInfo(bytes, cStart, cEnd)
        }
        // Skip Cluster (0x1F43B675) only if known size; if unknown stop scanning
        if (csize.value < 0 || cEnd <= childOffset) break
        childOffset = cEnd
      }
      return null
    }
    if (size.value < 0 || dataEnd <= offset) return null
    offset = dataEnd
  }
  return null
}

/**
 * Probe video duration in seconds from raw bytes without external binaries.
 * @param {Buffer | Uint8Array} buffer
 * @param {string} [contentType]
 * @param {string} [filename]
 * @returns {number | null}
 */
export function probeVideoDurationSec(buffer, contentType = '', filename = '') {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength < 12) return null
  const mime = String(contentType || '').toLowerCase()
  const name = String(filename || '').toLowerCase()
  const isEbmlMagic = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
  if (isEbmlMagic || mime.includes('webm') || mime.includes('matroska') || name.endsWith('.webm') || name.endsWith('.mkv')) {
    const ebml = parseEbmlDuration(buffer)
    if (ebml !== null) return ebml
  }
  const iso = scanIsoBoxes(buffer, 0, buffer.byteLength, 0)
  if (iso !== null) return iso
  if (!isEbmlMagic) return null
  return parseEbmlDuration(buffer)
}
