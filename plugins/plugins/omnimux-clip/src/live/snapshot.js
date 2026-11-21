import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { ClipDomainError, isClipRevision } from '../errors.js'

export const MAX_SNAPSHOT_FRAMES = 6
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const MAX_FRAME_TOTAL = 24 * 1024 * 1024
export const MAX_RECEIPT_BYTES = Math.ceil(MAX_FRAME_TOTAL * 4 / 3) + 64 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function invalidFrame() {
  return new ClipDomainError('INVALID_RECEIPT', 'The editor must return a complete preview PNG with valid frame dimensions.')
}

/** Validate the common 8-bit RGB/RGBA format produced by canvas.toBlob. */
function readPng(base64) {
  if (typeof base64 !== 'string') throw invalidFrame()
  const encoded = base64.replace(/^data:image\/png;base64,/, '')
  if (encoded.length > Math.ceil(MAX_FRAME_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalidFrame()
  const data = Buffer.from(encoded, 'base64')
  if (data.length > MAX_FRAME_BYTES || data.toString('base64') !== encoded || !data.subarray(0, 8).equals(PNG_SIGNATURE)
    || data.length < 57 || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw invalidFrame()
  }
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const channels = data[25] === 2 ? 3 : data[25] === 6 ? 4 : 0
  if (width < 2 || height < 2 || width * height > 4096 * 4096 || !channels
    || data[24] !== 8 || data[26] !== 0 || data[27] !== 0 || data[28] !== 0) throw invalidFrame()
  const compressed = []
  let ended = false
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset)
    const chunk = offset + 8
    const end = chunk + length
    const type = data.toString('ascii', offset + 4, chunk)
    if (end + 4 > data.length || crc32(data.subarray(offset + 4, end)) !== data.readUInt32BE(end)) throw invalidFrame()
    if (type === 'IDAT') compressed.push(data.subarray(chunk, end))
    if (type === 'IEND') {
      ended = length === 0 && end + 4 === data.length
      break
    }
    offset = end + 4
  }
  if (!ended || !compressed.length) throw invalidFrame()
  const rowBytes = width * channels + 1
  const size = rowBytes * height
  let pixels
  try {
    pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: size })
  } catch {
    throw invalidFrame()
  }
  if (pixels.length !== size) throw invalidFrame()
  for (let row = 0; row < size; row += rowBytes) {
    if (pixels[row] > 4) throw invalidFrame()
  }
  return { width, height, data }
}

export function persistSnapshot(paths, result, { args }) {
  const { frames } = result
  const count = args.times?.length ?? (args.fromSec !== undefined ? args.count ?? MAX_SNAPSHOT_FRAMES : 1)
  if (!isClipRevision(result.revision) || !Array.isArray(frames) || frames.length !== count || count > MAX_SNAPSHOT_FRAMES) throw invalidFrame()
  let total = 0
  const checked = frames.map((frame, index) => {
    const { timeSec, base64, requestedTimeSec = timeSec } = frame ?? {}
    const expectedTime = args.times?.[index] ?? (args.fromSec === undefined ? undefined : args.fromSec + (args.toSec - args.fromSec) * (index + 0.5) / count)
    if (!Number.isFinite(timeSec) || timeSec < 0 || !Number.isFinite(requestedTimeSec) || requestedTimeSec < timeSec
      || (expectedTime !== undefined && Math.abs(expectedTime - requestedTimeSec) > 1e-6)) throw invalidFrame()
    const image = readPng(base64)
    total += image.data.length
    if (total > MAX_FRAME_TOTAL) throw invalidFrame()
    return { timeSec, ...(requestedTimeSec !== timeSec ? { requestedTimeSec } : {}), ...image }
  })
  const written = []
  try {
    for (const { data, ...frame } of checked) {
      const path = join(paths.snapshotsDir, `frame-${randomUUID()}.png`)
      writeFileSync(path, data, { flag: 'wx', mode: 0o600 })
      written.push({ ...frame, path, bytes: data.length })
    }
  } catch {
    for (const { path } of written) rmSync(path, { force: true })
    throw new ClipDomainError('snapshot-save-failed', 'The Host could not save the captured preview frame.')
  }
  return { revision: result.revision, frames: written }
}
