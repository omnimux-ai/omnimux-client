/**
 * Resilient multi-connection installer downloader for OmniMux immutable release artifacts.
 *
 * Improvements over the legacy upstream downloader:
 * - Downloads from the manifest-declared immutable versioned URL (zero `latest` race condition).
 * - Uses per-connection idle read deadlines (default 60s) instead of a flat 60-minute total cap.
 * - Retries failed byte-range slices up to 3 times with exponential backoff.
 * - Enforces exact byte size (when declared), installer binary magic, and mandatory SHA-256.
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { OMNIMUX_ALLOWED_UPDATE_HOSTS } from '../product-identity.ts'
import { assertSecureHttpsUrl, OmniMuxUpdateError } from './manifest.ts'
import type { UpdateArtifactRequest } from './types.ts'

export const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
export const PARALLEL_MIN_BYTES = 16 * 1024 * 1024
export const PARALLEL_CHUNK_BYTES = 8 * 1024 * 1024
export const PARALLEL_CONCURRENCY = 8
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_CHUNK_RETRIES = 3

const PRIVATE_FILE_MODE = 0o600
const DECIMAL_BYTES = /^(0|[1-9][0-9]*)$/u
const DMG_TRAILER_BYTES = 512
const DMG_TRAILER_MAGIC = Buffer.from('koly', 'ascii')
const DOS_HEADER_BYTES = 64
const PE_OFFSET_POSITION = 0x3c
const PE_MAGIC = Buffer.from([0x50, 0x45, 0x00, 0x00])

export interface DownloadOmniMuxArtifactOptions {
  readonly url: string
  readonly platform: 'darwin' | 'win32'
  readonly destinationPath: string
  readonly expectedSha256: string
  readonly expectedSize?: number
  readonly request: UpdateArtifactRequest
  readonly allowedHosts?: readonly string[]
  readonly signal?: AbortSignal
  readonly onProgress?: (received: number, total: number | undefined) => void
  readonly idleTimeoutMs?: number
  readonly maxChunkRetries?: number
  readonly retryBaseDelayMs?: number
  readonly parallel?: {
    readonly concurrency?: number
    readonly chunkBytes?: number
    readonly minBytes?: number
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'The update download was cancelled.', { cause: signal.reason })
  }
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfAborted(signal)
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolveRead, rejectRead) => {
      timer = setTimeout(() => {
        rejectRead(new OmniMuxUpdateError('DOWNLOAD_TIMEOUT', `No bytes received for ${String(idleTimeoutMs)}ms`, { detail: 'idle-timeout' }))
      }, idleTimeoutMs)
      onAbort = () => {
        rejectRead(new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'The update download was cancelled.', { cause: signal?.reason }))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      reader.read().then(resolveRead, rejectRead)
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

async function sleepAbortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal)
  if (ms <= 0) return
  await new Promise<void>((resolveSleep, rejectSleep) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolveSleep()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      rejectSleep(new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'The update download was cancelled.', { cause: signal?.reason }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function writeAllAt(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
  position: number,
  length: number = chunk.byteLength,
): Promise<void> {
  let offset = 0
  while (offset < length) {
    const result = await handle.write(chunk, offset, length - offset, position + offset)
    if (result.bytesWritten === 0) throw new Error('Update installer write made no progress')
    offset += result.bytesWritten
  }
}

async function writeSequential(
  filename: string,
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
  onProgress?: (received: number) => void,
): Promise<number> {
  const handle = await open(filename, 'wx', PRIVATE_FILE_MODE)
  const reader = body.getReader()
  let written = 0
  try {
    while (true) {
      const step = await readWithIdleTimeout(reader, idleTimeoutMs, signal)
      if (step.done) break
      if (step.value.byteLength > MAX_ARTIFACT_BYTES - written) {
        throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Downloaded installer exceeded size cap')
      }
      await writeAllAt(handle, step.value, written)
      written += step.value.byteLength
      onProgress?.(written)
    }
    if (written === 0) {
      throw new OmniMuxUpdateError('HTTP_ERROR', 'Update server returned an empty body')
    }
    await handle.sync()
    return written
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
    await handle.close()
  }
}

async function writeParallel(options: {
  readonly filename: string
  readonly initialBody: ReadableStream<Uint8Array>
  readonly totalBytes: number
  readonly chunkBytes: number
  readonly concurrency: number
  readonly etag: string | undefined
  readonly url: string
  readonly request: UpdateArtifactRequest
  readonly idleTimeoutMs: number
  readonly maxChunkRetries: number
  readonly retryBaseDelayMs: number
  readonly signal: AbortSignal | undefined
  readonly onProgress?: (received: number) => void
}): Promise<void> {
  const {
    filename, initialBody, totalBytes, chunkBytes, concurrency, etag,
    url, request, idleTimeoutMs, maxChunkRetries, retryBaseDelayMs, signal, onProgress,
  } = options
  const handle = await open(filename, 'wx', PRIVATE_FILE_MODE)
  const controller = new AbortController()
  const onCallerAbort = (): void => { controller.abort(signal?.reason) }
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  const combined = controller.signal

  const slices: Array<{ readonly start: number; readonly end: number }> = []
  for (let start = chunkBytes; start < totalBytes; start += chunkBytes) {
    slices.push({ start, end: Math.min(totalBytes - 1, start + chunkBytes - 1) })
  }

  let totalReceived = 0
  const addBytes = (delta: number): void => {
    totalReceived += delta
    onProgress?.(totalReceived)
  }

  const consumePrefix = async (): Promise<void> => {
    const firstLimit = Math.min(totalBytes, chunkBytes)
    const reader = initialBody.getReader()
    let written = 0
    try {
      while (written < firstLimit) {
        const step = await readWithIdleTimeout(reader, idleTimeoutMs, combined)
        if (step.done) break
        const toWrite = Math.min(step.value.byteLength, firstLimit - written)
        if (toWrite > 0) {
          await writeAllAt(handle, step.value, written, toWrite)
          written += toWrite
          addBytes(toWrite)
        }
      }
      if (written < firstLimit) {
        throw new OmniMuxUpdateError('OFFLINE', 'Initial range stream ended prematurely')
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  const downloadSliceOnce = async (slice: { readonly start: number; readonly end: number }): Promise<number> => {
    const expectedLength = slice.end - slice.start + 1
    let settled
    try {
      settled = await request(url, {
        method: 'GET',
        headers: {
          Range: `bytes=${String(slice.start)}-${String(slice.end)}`,
          ...(etag === undefined ? {} : { 'If-Range': etag }),
        },
        cache: 'no-store',
        redirect: 'follow',
        signal: combined,
      })
    } catch (cause) {
      if (signal?.aborted === true || isAbortError(cause)) {
        throw new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'The update download was cancelled.', { cause })
      }
      throw new OmniMuxUpdateError('OFFLINE', 'Parallel range request failed', { cause })
    }
    const { response, finalUrl } = settled
    try {
      assertSecureHttpsUrl(finalUrl)
    } catch (error) {
      await response.body?.cancel().catch(() => undefined)
      throw error
    }
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined)
      throw new OmniMuxUpdateError('HTTP_ERROR', `Range request returned HTTP ${String(response.status)}`, {
        detail: `HTTP ${String(response.status)}`,
      })
    }
    if (response.body === null) {
      throw new OmniMuxUpdateError('HTTP_ERROR', 'Range request returned empty body')
    }
    const reader = response.body.getReader()
    let written = 0
    try {
      while (true) {
        const step = await readWithIdleTimeout(reader, idleTimeoutMs, combined)
        if (step.done) break
        if (written + step.value.byteLength > expectedLength) {
          throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Range chunk exceeded requested slice')
        }
        await writeAllAt(handle, step.value, slice.start + written, step.value.byteLength)
        written += step.value.byteLength
        addBytes(step.value.byteLength)
      }
      if (written !== expectedLength) {
        throw new OmniMuxUpdateError('OFFLINE', 'Range slice ended prematurely')
      }
      return written
    } catch (error) {
      await reader.cancel(error).catch(() => undefined)
      // Roll back progress delta contributed by this failed attempt before retry.
      if (written > 0) addBytes(-written)
      throw error
    } finally {
      reader.releaseLock()
    }
  }

  const downloadSliceWithRetry = async (slice: { readonly start: number; readonly end: number }): Promise<void> => {
    let lastError: unknown
    for (let attempt = 0; attempt <= maxChunkRetries; attempt += 1) {
      try {
        await downloadSliceOnce(slice)
        return
      } catch (error) {
        lastError = error
        if (signal?.aborted === true || combined.aborted) throw error
        if (error instanceof OmniMuxUpdateError && (error.code === 'DOWNLOAD_ABORTED' || error.code === 'MANIFEST_INVALID')) {
          throw error
        }
        if (error instanceof OmniMuxUpdateError && error.code === 'HTTP_ERROR' && error.detail !== undefined
          && /^HTTP 4\d\d$/u.test(error.detail) && error.detail !== 'HTTP 429' && error.detail !== 'HTTP 408') {
          throw error
        }
        if (attempt < maxChunkRetries) {
          const delay = retryBaseDelayMs * (2 ** attempt)
          await sleepAbortable(delay, combined)
        }
      }
    }
    throw lastError
  }

  let nextSlice = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextSlice
      nextSlice += 1
      const slice = slices[idx]
      if (slice === undefined) return
      await downloadSliceWithRetry(slice)
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency - 1), slices.length)
  try {
    await Promise.all([
      consumePrefix().catch(error => { controller.abort(error); throw error }),
      ...Array.from({ length: workerCount }, () => worker().catch(error => { controller.abort(error); throw error })),
    ])
    await handle.sync()
  } finally {
    signal?.removeEventListener('abort', onCallerAbort)
    await handle.close()
  }
}

async function validateBinaryArtifact(filename: string, platform: 'darwin' | 'win32', expectedSize?: number): Promise<void> {
  const handle = await open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) {
      throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded installer file size is invalid')
    }
    if (expectedSize !== undefined && expectedSize > 0 && stat.size !== expectedSize) {
      throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', `Installer size ${String(stat.size)} != expected ${String(expectedSize)}`, {
        detail: `size ${String(stat.size)} != ${String(expectedSize)}`,
      })
    }
    if (platform === 'darwin') {
      if (stat.size < DMG_TRAILER_BYTES) throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded DMG is truncated')
      const magic = Buffer.alloc(DMG_TRAILER_MAGIC.byteLength)
      const res = await handle.read(magic, 0, magic.byteLength, stat.size - DMG_TRAILER_BYTES)
      if (res.bytesRead !== magic.byteLength || !magic.equals(DMG_TRAILER_MAGIC)) {
        throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded file is not a valid macOS DMG')
      }
      return
    }
    if (stat.size < DOS_HEADER_BYTES) throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded EXE is truncated')
    const dos = Buffer.alloc(DOS_HEADER_BYTES)
    const dosRead = await handle.read(dos, 0, dos.byteLength, 0)
    if (dosRead.bytesRead !== dos.byteLength || dos[0] !== 0x4d || dos[1] !== 0x5a) {
      throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded file is not a valid Windows executable')
    }
    const peOffset = dos.readUInt32LE(PE_OFFSET_POSITION)
    if (peOffset < DOS_HEADER_BYTES || peOffset + PE_MAGIC.byteLength > stat.size) {
      throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded executable has an invalid PE header offset')
    }
    const pe = Buffer.alloc(PE_MAGIC.byteLength)
    const peRead = await handle.read(pe, 0, pe.byteLength, peOffset)
    if (peRead.bytesRead !== pe.byteLength || !pe.equals(PE_MAGIC)) {
      throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded executable has an invalid PE signature')
    }
  } finally {
    await handle.close()
  }
}

async function assertSha256(filename: string, expectedHex: string): Promise<void> {
  const normalized = expectedHex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Expected SHA-256 digest is invalid')
  }
  const expected = Buffer.from(normalized, 'hex')
  const hash = createHash('sha256')
  const handle = await open(filename, 'r')
  try {
    const chunk = Buffer.alloc(1024 * 1024)
    while (true) {
      const read = await handle.read(chunk, 0, chunk.byteLength, null)
      if (read.bytesRead === 0) break
      hash.update(read.bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, read.bytesRead))
    }
  } finally {
    await handle.close()
  }
  const actual = hash.digest()
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    throw new OmniMuxUpdateError('CHECKSUM_MISMATCH', 'Downloaded installer SHA-256 digest does not match manifest')
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try { await unlink(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function omnimuxInstallerFilename(platform: 'darwin' | 'win32', version: string, arch?: 'arm64' | 'x64'): string {
  if (platform === 'darwin') return `OmniMux-${version}-${arch ?? 'arm64'}.dmg`
  return `OmniMux-${version}-x64-Setup.exe`
}

/** Download an immutable OmniMux release artifact, verify binary structure & SHA-256, and atomically move into place. */
export async function downloadOmniMuxArtifact(options: DownloadOmniMuxArtifactOptions): Promise<string> {
  const allowedHosts = options.allowedHosts ?? OMNIMUX_ALLOWED_UPDATE_HOSTS
  const secureUrl = assertSecureHttpsUrl(options.url, allowedHosts)
  if (!isAbsolute(options.destinationPath) || /[\0\r\n]/u.test(options.destinationPath)) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Destination path must be absolute')
  }
  const expectedExt = options.platform === 'darwin' ? '.dmg' : '.exe'
  if (extname(options.destinationPath).toLowerCase() !== expectedExt) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', `Destination path must end with ${expectedExt}`)
  }
  const destination = resolve(options.destinationPath)
  const dirStat = await lstat(dirname(destination))
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new OmniMuxUpdateError('PERMISSION_DENIED', 'Download directory must be a real directory')
  }
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomUUID()}.partial`)
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const maxChunkRetries = options.maxChunkRetries ?? DEFAULT_MAX_CHUNK_RETRIES
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000

  throwIfAborted(options.signal)

  let response: Response
  let finalUrl: string
  try {
    const settled = await options.request(secureUrl.href, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
      cache: 'no-store',
      redirect: 'follow',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    response = settled.response
    finalUrl = settled.finalUrl
  } catch (cause) {
    if (options.signal?.aborted === true || isAbortError(cause)) {
      throw new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'The update download was cancelled.', { cause })
    }
    throw new OmniMuxUpdateError('OFFLINE', 'The update installer could not be downloaded.', { cause })
  }

  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    throw new OmniMuxUpdateError('HTTP_ERROR', `Download server returned HTTP ${String(response.status)}`, {
      detail: `HTTP ${String(response.status)}`,
    })
  }
  if (response.body === null) {
    throw new OmniMuxUpdateError('HTTP_ERROR', 'Download server returned an empty body')
  }
  try {
    assertSecureHttpsUrl(finalUrl)
  } catch (error) {
    await response.body.cancel().catch(() => undefined)
    throw error
  }

  const declaredHeader = response.headers.get('content-length')
  const declared = declaredHeader !== null && DECIMAL_BYTES.test(declaredHeader) ? Number(declaredHeader) : Number.NaN
  if (Number.isFinite(declared) && declared > MAX_ARTIFACT_BYTES) {
    await response.body.cancel().catch(() => undefined)
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Installer exceeds maximum allowed size')
  }

  try {
    const acceptsRanges = /\bbytes\b/iu.test(response.headers.get('accept-ranges') ?? '')
    const minBytes = Math.max(1024, options.parallel?.minBytes ?? PARALLEL_MIN_BYTES)
    const chunkBytes = Math.max(1024, options.parallel?.chunkBytes ?? PARALLEL_CHUNK_BYTES)
    const concurrency = Math.max(1, Math.min(16, options.parallel?.concurrency ?? PARALLEL_CONCURRENCY))

    if (acceptsRanges && concurrency > 1 && Number.isSafeInteger(declared) && declared >= minBytes && declared > chunkBytes) {
      await writeParallel({
        filename: temporary,
        initialBody: response.body,
        totalBytes: declared,
        chunkBytes,
        concurrency,
        etag: response.headers.get('etag') ?? undefined,
        url: finalUrl,
        request: options.request,
        idleTimeoutMs,
        maxChunkRetries,
        retryBaseDelayMs,
        signal: options.signal,
        onProgress: received => { options.onProgress?.(received, declared) },
      })
    } else {
      const total = Number.isFinite(declared) && declared > 0 ? declared : options.expectedSize
      await writeSequential(temporary, response.body, idleTimeoutMs, options.signal, received => {
        options.onProgress?.(received, total)
      })
    }

    throwIfAborted(options.signal)
    await validateBinaryArtifact(temporary, options.platform, options.expectedSize)
    await assertSha256(temporary, options.expectedSha256)
    throwIfAborted(options.signal)
    await unlinkIfPresent(destination)
    await rename(temporary, destination)
    return destination
  } catch (error) {
    if (error instanceof OmniMuxUpdateError) throw error
    if (options.signal?.aborted === true || isAbortError(error)) {
      throw new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'The update download was cancelled.', { cause: error })
    }
    throw new OmniMuxUpdateError('OFFLINE', 'Update download failed', { cause: error })
  } finally {
    await unlinkIfPresent(temporary).catch(() => undefined)
  }
}
