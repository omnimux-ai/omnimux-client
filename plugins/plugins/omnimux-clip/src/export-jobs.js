import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isCanvasClipBinding } from './client/clip-events.js'
import { ClipDomainError, isClipRevision, isClipToken } from './errors.js'
import { assertProjectId } from './paths.js'

const UPLOAD_TTL_MS = 30 * 60 * 1_000
const MAX_MP4_READ_BYTES = 64 * 1024 * 1024
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
const uploadsInFlight = new Set()
const projectWrites = new Map()

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function normalizeJobId(id) {
  const number = typeof id === 'string' && /^[1-9]\d{0,15}$/.test(id) ? Number(id) : id
  if (!Number.isSafeInteger(number) || number < 1) throw ClipDomainError.invalidId('invalid export job id')
  return number
}

function bindingFor(binding, projectId) {
  if (binding === undefined) return undefined
  if (!isCanvasClipBinding(binding) || binding.projectId !== projectId) {
    throw ClipDomainError.invalidJson('invalid export canvas binding')
  }
  return { workspaceId: binding.workspaceId, nodeId: binding.nodeId, projectId }
}

function uploadDigest(token) {
  return createHash('sha256').update(token).digest('hex')
}

function generationOf(job) {
  return job.exportGeneration ?? job.revisionEpoch ?? 0
}

function reserveGeneration(jobs, { projectId, revisionEpoch, draftWriterId, editorInstanceId }) {
  let generation = 0
  let previousWriterJob
  const writer = draftWriterId ?? editorInstanceId
  for (const job of jobs) {
    if (job.projectId !== projectId) continue
    generation = Math.max(generation, generationOf(job))
    if (writer && (job.draftWriterId ?? job.editorInstanceId) === writer) previousWriterJob = job
  }
  // The local epoch follows the persisted draft through editor recreation.
  // Keep its existing generation until that writer adopts another version.
  if (revisionEpoch > (previousWriterJob?.revisionEpoch ?? 0)) return generation + 1
  if (previousWriterJob && revisionEpoch === previousWriterJob.revisionEpoch) return generationOf(previousWriterJob)
  return generation
}

function isSuperseded(job, selected) {
  const generation = generationOf(job)
  const selectedGeneration = generationOf(selected)
  return selectedGeneration > generation || (selectedGeneration === generation
    && (selected.exportJobId > job.exportJobId || selected.projectRevision > job.projectRevision))
}

function invalidMp4() {
  return new ClipDomainError('invalid-export-media', 'The upload is not a complete MP4 with a video track.')
}

async function readRange(file, start, end) {
  const length = end - start
  if (length <= 0 || length > MAX_MP4_READ_BYTES) throw invalidMp4()
  const buffer = Buffer.allocUnsafe(length)
  let bytes = 0
  while (bytes < length) {
    const { bytesRead } = await file.read(buffer, bytes, length - bytes, start + bytes)
    if (!bytesRead) throw invalidMp4()
    bytes += bytesRead
  }
  return buffer
}

// The native muxer writes non-fragmented MP4. Walk the top-level headers so a
// readable prefix or a truncated tail cannot pass the demuxer's metadata probe.
async function checkMp4Boxes(file, bytes) {
  let hasMovie = false
  let hasMedia = false
  let offset = 0
  for (let count = 0; offset < bytes; count++) {
    if (count >= 4096 || bytes - offset < 8) throw invalidMp4()
    const box = await readRange(file, offset, Math.min(offset + 16, bytes))
    const type = box.toString('ascii', 4, 8)
    let size = box.readUInt32BE(0)
    const headerBytes = size === 1 ? 16 : 8
    if (size === 1) size = box.length >= 16 ? Number(box.readBigUInt64BE(8)) : 0
    else if (size === 0) size = bytes - offset
    if (size < headerBytes || size > bytes - offset) throw invalidMp4()
    if (count === 0 && (type !== 'ftyp' || size < headerBytes + 8)) throw invalidMp4()
    if (type === 'moov' && size > headerBytes) hasMovie = true
    if (type === 'mdat' && size > headerBytes) hasMedia = true
    offset += size
  }
  if (!hasMovie || !hasMedia) throw invalidMp4()
}

async function probeMp4(file, bytes) {
  if (bytes < 24 || bytes > MAX_UPLOAD_BYTES) throw invalidMp4()
  const { CustomSource, EncodedPacketSink, Input, MP4 } = await import('mediabunny')
  try {
    await checkMp4Boxes(file, bytes)
    const input = new Input({
      formats: [MP4],
      source: new CustomSource({ getSize: () => bytes, read: (start, end) => readRange(file, start, end) }),
    })
    try {
      const video = await input.getPrimaryVideoTrack()
      if (!video || !await video.getCodec()) throw invalidMp4()
      const [width, height, duration, audio] = await Promise.all([
        video.getDisplayWidth(), video.getDisplayHeight(), video.computeDuration(), input.getAudioTracks(),
      ])
      for (const track of [video, ...audio]) {
        const packets = new EncodedPacketSink(track)
        const first = await packets.getFirstPacket()
        const last = await packets.getPacket(Infinity)
        if (!first?.byteLength || !last?.byteLength) throw invalidMp4()
      }
      const durationMs = Math.round(duration * 1_000)
      if (![width, height, durationMs].every((value) => Number.isSafeInteger(value) && value > 0)) throw invalidMp4()
      return { durationMs, width, height }
    } finally {
      input.dispose()
    }
  } catch {
    throw invalidMp4()
  }
}

function sourcePath(tmpDir, tempPath) {
  if (typeof tempPath !== 'string' || !isAbsolute(tempPath) || dirname(resolve(tempPath)) !== tmpDir) {
    throw ClipDomainError.pathDenied('export upload must be a file in the clip upload directory')
  }
  const source = resolve(tempPath)
  if (!lstatSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw ClipDomainError.pathDenied('export upload must be a regular file')
  }
  return source
}

function serializeProjectWrite(key, write) {
  const previous = projectWrites.get(key) ?? Promise.resolve()
  const result = previous.then(write)
  const tail = result.then(() => undefined, () => undefined)
  projectWrites.set(key, tail)
  return result.finally(() => {
    if (projectWrites.get(key) === tail) projectWrites.delete(key)
  })
}

/**
 * Host-only job API. Call begin with the identity fixed by trusted command
 * dispatch. Keep its one-time uploadToken in the targeted claim response.
 * Only the authenticated raw-upload handler may supply tempPath.
 */
export function createExportJobs({ paths, getWorkflowClip }) {
  const jobsDir = join(resolve(paths.exportsDir), 'jobs')
  mkdirSync(jobsDir, { recursive: true, mode: 0o700 })
  const root = realpathSync(jobsDir)
  const tmpDir = resolve(paths.tmpDir)
  const indexPath = join(root, 'requests.json')
  const readJobs = () => readJson(indexPath) ?? []
  const versionDir = (id) => join(root, String(id))
  const savedFile = (id) => readJson(join(versionDir(id), 'file.json'))
  const failedPath = (id) => join(root, `${id}.failed.json`)
  const cancelledPath = (id) => join(root, `${id}.cancelled.json`)
  const canvasPath = (id) => join(versionDir(id), 'canvas.json')

  function requireJob(id) {
    const exportJobId = normalizeJobId(id)
    const job = readJobs()[exportJobId - 1]
    if (!job || job.exportJobId !== exportJobId) throw ClipDomainError.notFound('export job not found')
    return job
  }

  function receipt(job) {
    const { exportJobId, requestId, projectId, projectRevision, revisionEpoch, binding, uploadExpiresAt } = job
    const file = savedFile(exportJobId)
    const canvas = file && binding ? readJson(canvasPath(exportJobId)) : null
    const failure = file ? null : readJson(failedPath(exportJobId))
    let status = Date.now() >= uploadExpiresAt ? 'expired' : 'awaiting-upload'
    if (failure) status = 'upload-failed'
    if (readJson(cancelledPath(exportJobId))) status = 'cancelled'
    if (file) status = canvas?.status ?? (file.superseded ? 'superseded' : 'file-saved')
    return {
      exportJobId, requestId, projectId, projectRevision,
      ...(revisionEpoch !== undefined ? { revisionEpoch } : {}),
      ...(binding ? { binding } : {}),
      status,
      fileSaved: Boolean(file),
      canvasCommitted: canvas?.status === 'committed',
      ...(file ? { bytes: file.bytes, output: file.output } : {}),
      ...(canvas?.workspaceVersion !== undefined ? { workspaceVersion: canvas.workspaceVersion } : {}),
      ...(failure || canvas?.error ? { error: failure ?? canvas.error } : {}),
    }
  }

  function begin({ requestId, projectId, projectRevision, revisionEpoch, draftWriterId, editorInstanceId, binding, manualWindowId }) {
    assertProjectId(projectId)
    if (!isClipToken(requestId) || !isClipRevision(projectRevision)
      || (revisionEpoch !== undefined && !isClipRevision(revisionEpoch))
      || (draftWriterId !== undefined && !isClipToken(draftWriterId))
      || (editorInstanceId !== undefined && !isClipToken(editorInstanceId))
      || (manualWindowId !== undefined && !isClipToken(manualWindowId))) {
      throw ClipDomainError.invalidJson('invalid export request identity or project revision')
    }
    binding = bindingFor(binding, projectId)
    // The Host owns allocation. Read and atomically replace the index in the
    // same synchronous section so duplicate dispatches also share the original ID.
    const jobs = readJobs()
    const existing = jobs.find((job) => job.requestId === requestId)
    if (existing) {
      if (existing.projectId !== projectId || existing.projectRevision !== projectRevision || existing.manualWindowId !== manualWindowId
        || (existing.revisionEpoch ?? 0) !== (revisionEpoch ?? 0)
        || existing.binding?.workspaceId !== binding?.workspaceId || existing.binding?.nodeId !== binding?.nodeId) {
        throw new ClipDomainError('export-request-mismatch', 'This request already identifies a different export.')
      }
      return receipt(existing)
    }
    const uploadToken = randomBytes(32).toString('base64url')
    const job = {
      exportJobId: jobs.length + 1, requestId, projectId, projectRevision,
      ...(revisionEpoch !== undefined ? {
        revisionEpoch, exportGeneration: reserveGeneration(jobs, { projectId, revisionEpoch, draftWriterId, editorInstanceId }),
        ...(draftWriterId ? { draftWriterId } : editorInstanceId ? { editorInstanceId } : {}),
      } : {}),
      ...(binding ? { binding } : {}),
      ...(manualWindowId ? { manualWindowId } : {}),
      uploadDigest: uploadDigest(uploadToken), uploadExpiresAt: Date.now() + UPLOAD_TTL_MS,
    }
    writeJson(indexPath, [...jobs, job])
    return { ...receipt(job), uploadToken, uploadExpiresAt: job.uploadExpiresAt }
  }

  // A completed version directory carries both the media and its receipt. The
  // newest selected directory is the project's current export across restarts.
  function latestFor(projectId) {
    let latest = null
    for (const candidate of readJobs().reverse()) {
      if (candidate.projectId !== projectId || (latest && generationOf(candidate) <= generationOf(latest))) continue
      const file = savedFile(candidate.exportJobId)
      if (!file || file.superseded) continue
      latest = candidate
    }
    return latest
  }

  async function commitCanvas(job) {
    const current = receipt(job)
    if (!current.fileSaved || !job.binding || current.canvasCommitted || current.status === 'superseded') return current
    const { exportJobId, projectId, projectRevision, revisionEpoch, exportGeneration, binding } = job
    if (latestFor(projectId)?.exportJobId !== exportJobId) {
      writeJson(canvasPath(exportJobId), { status: 'superseded' })
      return receipt(job)
    }
    let outcome
    try {
      const workflow = getWorkflowClip?.()
      if (!workflow?.commitExport) {
        outcome = { status: 'canvas-failed', error: { code: 'canvas-unavailable', message: 'The canvas service is unavailable.' } }
      } else {
        const result = await workflow.commitExport({
          ...binding, exportJobId, projectRevision, output: current.output,
          ...(revisionEpoch !== undefined ? { revisionEpoch, exportGeneration } : {}),
        })
        if (result?.status === 'superseded' && result.canvasCommitted === false) outcome = { status: 'superseded' }
        else if (result?.status === 'committed' && result.canvasCommitted === true) {
          outcome = { status: 'committed', workspaceVersion: result.workspaceVersion }
        }
      }
    } catch (error) {
      if (error?.code === 'clip-binding-mismatch') {
        outcome = { status: 'canvas-failed', error: { code: 'clip-binding-mismatch', message: 'The clip project no longer matches its original canvas node.' } }
      }
    }
    writeJson(canvasPath(exportJobId), outcome ?? {
      status: 'canvas-failed', error: { code: 'canvas-commit-failed', message: 'The MP4 was saved. Retry the canvas commit using the same export job.' },
    })
    return receipt(job)
  }

  function persistFile(job, source, stat, media) {
    const { exportJobId, projectId } = job
    // This check and the durable rename form the cancellation boundary. No
    // asynchronous work may be added between them and the canvas commit call.
    assertNotCancelled(job)
    const actual = lstatSync(source, { throwIfNoEntry: false })
    if (!actual?.isFile() || actual.dev !== stat.dev || actual.ino !== stat.ino
      || actual.size !== stat.size || actual.mtimeMs !== stat.mtimeMs) throw invalidMp4()
    const latest = latestFor(projectId)
    const superseded = Boolean(latest && isSuperseded(job, latest))
    const finalDir = versionDir(exportJobId)
    const stage = mkdtempSync(join(root, '.upload-'))
    try {
      const output = { videoPath: join(finalDir, 'video.mp4'), revision: `${stat.mtimeMs}:${stat.size}`, ...media }
      writeJson(join(stage, 'file.json'), { bytes: stat.size, output, superseded })
      renameSync(source, join(stage, 'video.mp4'))
      renameSync(stage, finalDir)
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  }

  function requireUploadProof({ exportJobId, uploadToken, projectId }) {
    const job = requireJob(exportJobId)
    const { uploadDigest: expected, uploadExpiresAt } = job
    if (job.projectId !== projectId || typeof uploadToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(uploadToken)
      || !timingSafeEqual(Buffer.from(uploadDigest(uploadToken), 'hex'), Buffer.from(expected, 'hex'))
      || Date.now() >= uploadExpiresAt) {
      throw ClipDomainError.pathDenied('export upload authorization is invalid or expired')
    }
    return job
  }

  function assertNotCancelled(job) {
    if (readJson(cancelledPath(job.exportJobId))) {
      throw new ClipDomainError('export-cancelled', 'This manual export was cancelled.')
    }
  }

  function cancel(credentials) {
    const job = requireUploadProof(credentials)
    if (!job.manualWindowId) throw ClipDomainError.pathDenied('Only a manual export can be cancelled here.')
    const current = receipt(job)
    if (current.status !== 'awaiting-upload') return current
    writeJson(cancelledPath(job.exportJobId), { cancelled: true })
    return receipt(job)
  }

  function requireUpload(credentials) {
    const job = requireUploadProof(credentials)
    assertNotCancelled(job)
    if (uploadsInFlight.has(versionDir(job.exportJobId)) || savedFile(job.exportJobId) || readJson(failedPath(job.exportJobId))) {
      throw new ClipDomainError('export-upload-used', 'This export upload has already been used. Read the existing job status.')
    }
    return job
  }

  function authorizeUpload(credentials) {
    requireUpload(credentials)
  }

  async function upload({ exportJobId, uploadToken, projectId, tempPath }) {
    const job = requireUpload({ exportJobId, uploadToken, projectId })
    const source = sourcePath(tmpDir, tempPath)
    const pendingKey = versionDir(job.exportJobId)
    uploadsInFlight.add(pendingKey)
    try {
      const file = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let stat
      let media
      try {
        stat = await file.stat()
        if (!stat.isFile()) throw invalidMp4()
        media = await probeMp4(file, stat.size)
      } finally {
        await file.close()
      }
      return await serializeProjectWrite(join(root, projectId), async () => {
        persistFile(job, source, stat, media)
        return commitCanvas(job)
      })
    } catch (error) {
      assertNotCancelled(job)
      if (error instanceof ClipDomainError && error.code === 'invalid-export-media') {
        writeJson(failedPath(job.exportJobId), { code: error.code, message: error.message })
      }
      throw error
    } finally {
      uploadsInFlight.delete(pendingKey)
    }
  }

  function get(exportJobId) {
    return receipt(requireJob(exportJobId))
  }

  /** A trusted retry uses the persisted MP4 and never needs an upload proof. */
  function retryCanvas(exportJobId) {
    const job = requireJob(exportJobId)
    return serializeProjectWrite(join(root, job.projectId), () => commitCanvas(job))
  }

  return { begin, authorizeUpload, upload, cancel, get, retryCanvas }
}
