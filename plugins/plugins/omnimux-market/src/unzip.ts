import { inflateRawSync } from 'node:zlib'

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50

export const MAX_ZIP_ENTRIES = 1000
export const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024
export const MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_PATH_DEPTH = 16
export const MAX_ZIP_COMPRESSION_RATIO = 100
const RATIO_CHECK_MIN_BYTES = 4096

export interface UnzipLimits {
  maxEntries?: number
  maxEntryBytes?: number
  maxTotalBytes?: number
  maxPathDepth?: number
  maxCompressionRatio?: number
}

interface ResolvedLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxPathDepth: number
  maxCompressionRatio: number
}

function resolveLimits(limits?: UnzipLimits): ResolvedLimits {
  return {
    maxEntries: limits?.maxEntries ?? MAX_ZIP_ENTRIES,
    maxEntryBytes: limits?.maxEntryBytes ?? MAX_ZIP_ENTRY_BYTES,
    maxTotalBytes: limits?.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES,
    maxPathDepth: limits?.maxPathDepth ?? MAX_ZIP_PATH_DEPTH,
    maxCompressionRatio: limits?.maxCompressionRatio ?? MAX_ZIP_COMPRESSION_RATIO,
  }
}

const FORBIDDEN_SEGMENTS = new Set(['.', '..', '__proto__', 'constructor', 'prototype'])

function validateEntryName(name: string, maxPathDepth: number): string {
  if (!name || name.includes('\0') || name.includes('\\')) {
    throw new Error(`zip 不安全路径: ${name}`)
  }
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`zip 不安全路径(不得为绝对路径): ${name}`)
  }
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name
  const segments = normalized.split('/')
  if (segments.length > maxPathDepth) {
    throw new Error(`zip 不安全路径(目录层级超过上限 ${maxPathDepth}): ${name}`)
  }
  for (const seg of segments) {
    if (!seg || FORBIDDEN_SEGMENTS.has(seg)) {
      throw new Error(`zip 不安全路径(包含非法目录段): ${name}`)
    }
  }
  return name
}

export function unzipToFiles(buf: Buffer, limits?: UnzipLimits): Record<string, Buffer> {
  const resolved = resolveLimits(limits)
  const eocd = findEocd(buf)
  return eocd >= 0 ? unzipFromCentral(buf, eocd, resolved) : unzipFromLocal(buf, resolved)
}

function unzipFromCentral(buf: Buffer, eocd: number, limits: ResolvedLimits): Record<string, Buffer> {
  const count = buf.readUInt16LE(eocd + 10)
  if (count === 0xffff) {
    throw new Error('不支持 ZIP64 压缩包')
  }
  if (count > limits.maxEntries) {
    throw new Error(`zip 条目数超过上限(${limits.maxEntries})`)
  }
  let offset = buf.readUInt32LE(eocd + 16)
  if (offset === 0xffffffff) {
    throw new Error('不支持 ZIP64 压缩包')
  }
  const out: Record<string, Buffer> = Object.create(null)
  const seenOffsets = new Set<number>()
  let totalBytes = 0
  let fileEntries = 0
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL) throw new Error('不是有效的 zip 包')
    const method = buf.readUInt16LE(offset + 10)
    const compSize = buf.readUInt32LE(offset + 20)
    const uncompSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOff = buf.readUInt32LE(offset + 42)
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOff === 0xffffffff) {
      throw new Error('不支持 ZIP64 压缩包')
    }
    if (offset + 46 + nameLen > buf.length) throw new Error('zip 包已截断')
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    offset += 46 + nameLen + extraLen + commentLen
    if (!name) continue
    validateEntryName(name, limits.maxPathDepth)
    if (name.endsWith('/')) continue
    fileEntries += 1
    if (fileEntries > limits.maxEntries) {
      throw new Error(`zip 条目数超过上限(${limits.maxEntries})`)
    }
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      throw new Error(`zip 包含重复条目: ${name}`)
    }
    if (seenOffsets.has(localOff)) {
      throw new Error(`zip 包含重叠本地偏移: ${name}`)
    }
    seenOffsets.add(localOff)
    if (uncompSize > limits.maxEntryBytes) {
      throw new Error(`zip 条目超过单文件大小上限(${limits.maxEntryBytes}): ${name}`)
    }
    const remaining = limits.maxTotalBytes - totalBytes
    if (uncompSize > remaining) {
      throw new Error(`zip 解压总大小超过上限(${limits.maxTotalBytes})`)
    }
    const content = readEntry(buf, localOff, method, compSize, name, Math.min(limits.maxEntryBytes, remaining), limits.maxCompressionRatio)
    totalBytes += content.length
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(`zip 解压总大小超过上限(${limits.maxTotalBytes})`)
    }
    out[name] = content
  }
  return out
}

function unzipFromLocal(buf: Buffer, limits: ResolvedLimits): Record<string, Buffer> {
  const out: Record<string, Buffer> = Object.create(null)
  let offset = 0
  let totalBytes = 0
  let seenEntries = 0
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset)
    if (sig === CENTRAL || sig === EOCD) break
    if (sig !== LOCAL) throw new Error('不是有效的 zip 包')
    seenEntries += 1
    if (seenEntries > limits.maxEntries) {
      throw new Error(`zip 条目数超过上限(${limits.maxEntries})`)
    }
    const gp = buf.readUInt16LE(offset + 6)
    const method = buf.readUInt16LE(offset + 8)
    const compSize = buf.readUInt32LE(offset + 18)
    const uncompSize = buf.readUInt32LE(offset + 22)
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw new Error('不支持 ZIP64 压缩包')
    }
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    if (offset + 30 + nameLen > buf.length) throw new Error('zip 包已截断')
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const dataStart = offset + 30 + nameLen + extraLen
    if (gp & 0x8) throw new Error('zip 包缺少中央目录')
    const dataEnd = dataStart + compSize
    if (dataEnd > buf.length) throw new Error('zip 包已截断')
    if (name) {
      validateEntryName(name, limits.maxPathDepth)
      if (!name.endsWith('/')) {
        if (Object.prototype.hasOwnProperty.call(out, name)) {
          throw new Error(`zip 包含重复条目: ${name}`)
        }
        if (uncompSize > limits.maxEntryBytes) {
          throw new Error(`zip 条目超过单文件大小上限(${limits.maxEntryBytes}): ${name}`)
        }
        const remaining = limits.maxTotalBytes - totalBytes
        if (uncompSize > remaining) {
          throw new Error(`zip 解压总大小超过上限(${limits.maxTotalBytes})`)
        }
        const content = inflateEntry(
          buf.subarray(dataStart, dataEnd),
          method,
          name,
          Math.min(limits.maxEntryBytes, remaining),
          limits.maxCompressionRatio,
        )
        totalBytes += content.length
        if (totalBytes > limits.maxTotalBytes) {
          throw new Error(`zip 解压总大小超过上限(${limits.maxTotalBytes})`)
        }
        out[name] = content
      }
    }
    offset = dataEnd
  }
  return out
}

function readEntry(
  buf: Buffer,
  localOff: number,
  method: number,
  compSize: number,
  name: string,
  maxBytes: number,
  maxCompressionRatio: number,
): Buffer {
  if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOCAL) throw new Error(`zip 条目损坏: ${name}`)
  const nameLen = buf.readUInt16LE(localOff + 26)
  const extraLen = buf.readUInt16LE(localOff + 28)
  const dataStart = localOff + 30 + nameLen + extraLen
  const dataEnd = dataStart + compSize
  if (dataEnd > buf.length) throw new Error('zip 包已截断')
  return inflateEntry(buf.subarray(dataStart, dataEnd), method, name, maxBytes, maxCompressionRatio)
}

function inflateEntry(
  compressed: Buffer,
  method: number,
  name: string,
  maxBytes: number,
  maxCompressionRatio: number,
): Buffer {
  if (method === 0) {
    if (compressed.length > maxBytes) {
      throw new Error(`zip 条目超过大小上限(${maxBytes}): ${name}`)
    }
    return Buffer.from(compressed)
  }
  if (method !== 8) throw new Error(`不支持的 zip 压缩方法 ${method}`)
  let inflated: Buffer
  try {
    inflated = inflateRawSync(compressed, { maxOutputLength: Math.max(1, maxBytes) })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE'
      || /maxOutputLength/i.test(err instanceof Error ? err.message : '')) {
      throw new Error(`zip 条目超过解压大小上限(${maxBytes}): ${name}`)
    }
    throw new Error(`zip 解压失败: ${name}`)
  }
  if (inflated.length > maxBytes) {
    throw new Error(`zip 条目超过大小上限(${maxBytes}): ${name}`)
  }
  if (inflated.length > RATIO_CHECK_MIN_BYTES) {
    if (compressed.length === 0 || inflated.length / compressed.length > maxCompressionRatio) {
      throw new Error(`zip 压缩比超过安全上限(${maxCompressionRatio}x): ${name}`)
    }
  }
  return inflated
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) !== EOCD) continue
    const commentLen = buf.readUInt16LE(i + 20)
    if (i + 22 + commentLen === buf.length) return i
  }
  return -1
}
