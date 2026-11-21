import { randomUUID } from 'node:crypto'
import * as nodeFs from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { ClipDomainError } from '../errors.js'
import { assertProjectId, ensureClipDirs, projectJsonPath } from '../paths.js'
import { isCanvasClipBinding } from '../client/clip-events.js'
import { aspectRatioOf, finite, isRecord, nativeClipsByTrack, projectMode, safeText } from '../timeline/nativeProjectFields.js'
import { isLegacyTimeline, migrateLegacyTimeline } from './legacyProject.js'
import { createNativeProject, isNativeProject, normalizeNativeProject, sha256 } from './nativeProject.js'

const READ_REGULAR_FILE = nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW | nodeFs.constants.O_NONBLOCK

function readJson(bytes, id) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw ClipDomainError.invalidJson(`project ${id} is not valid JSON`)
  }
}

function encodeJson(data) {
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`)
}

function assertRevision(value, field, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw ClipDomainError.invalidJson(`${field} must be a safe integer of at least ${min}`)
  }
  return value
}

function revisionConflict(id, expectedRevision, currentRevision) {
  return ClipDomainError.revisionConflict(currentRevision,
    `Project ${id} expected revision ${expectedRevision}, current revision is ${currentRevision}.`)
}

function normalizeBinding(id, binding) {
  if (binding === undefined) return undefined
  if (!isCanvasClipBinding(binding) || binding.projectId !== id) {
    throw new ClipDomainError('invalid-clip-binding', 'Invalid canvas project binding.')
  }
  const { workspaceId, nodeId, projectId } = binding
  return { workspaceId, nodeId, projectId }
}

function matchBinding(id, current, requested, { allowAssociate = false } = {}) {
  if (current?.binding && !isDeepStrictEqual(current.binding, requested)) {
    throw new ClipDomainError('clip-binding-mismatch', 'Canvas project binding does not match the stored binding.')
  }
  if (current && !current.binding && requested && !allowAssociate) {
    throw new ClipDomainError('clip-binding-mismatch', 'Materialize this project with its canvas binding before saving.')
  }
  if (id.startsWith('clip_node_') && !requested) {
    throw new ClipDomainError('invalid-clip-binding', 'Canvas projects require a binding.')
  }
  return requested
}

function envelopeFor(id, project, revision, updatedAt, binding) {
  return { id, projectId: id, project, revision, updatedAt, ...(binding ? { binding } : {}) }
}

function timestampOf(raw, native) {
  const timestamp = typeof raw.updatedAt === 'string' ? Date.parse(raw.updatedAt) : raw.updatedAt
  return finite(timestamp, finite(native?.modifiedAt, 0))
}

function decodeEnvelope(raw, id, { title, allowDraftRekey = false } = {}) {
  if (!isRecord(raw)) throw ClipDomainError.invalidJson(`project ${id} is not a JSON object`)
  const bareNative = isNativeProject(raw)
  const canonical = !bareNative && Object.hasOwn(raw, 'project') && Object.hasOwn(raw, 'revision')
  if ((!bareNative && raw.id !== undefined && raw.id !== id) || (raw.projectId !== undefined && raw.projectId !== id)) {
    throw ClipDomainError.invalidId('Saved project identity does not match its project ID.')
  }
  if (canonical && raw.projectId !== id) throw ClipDomainError.invalidId('Saved project ID is missing.')
  const sources = [raw.project, raw.openreel?.project, raw.openreel, raw.schema?.project, raw.schema, raw]
  const native = canonical ? raw.project : sources.find(isNativeProject)
  const legacy = !native && !canonical ? sources.find(isLegacyTimeline) : undefined
  if (!native && !legacy) throw ClipDomainError.invalidJson(`project ${id} is missing an OpenReel project or legacy timeline`)
  if (legacy?.projectId !== undefined && legacy.projectId !== id) {
    throw ClipDomainError.invalidId('Legacy timeline identity does not match its project ID.')
  }
  const revision = raw.revision === undefined ? 1 : assertRevision(raw.revision, 'revision', 1)
  const updatedAt = timestampOf(raw, native)
  const binding = normalizeBinding(id, raw.binding)
  const project = native ?? migrateLegacyTimeline(legacy, { id, title: raw.title || title, updatedAt, playheadMs: raw.playheadMs })
  const normalized = normalizeNativeProject(project, id, {
    allowRekey: !canonical && ((!bareNative && raw.projectId === id) || allowDraftRekey),
    allowMediaStatus: canonical && !allowDraftRekey,
  })
  const envelope = envelopeFor(id, normalized, revision, updatedAt, binding)
  return { envelope, needsMigration: !canonical || !isDeepStrictEqual(raw, envelope) }
}

/** Decode persisted versions without rewriting the source or probing its media. */
export function unwrapProjectEnvelope(raw, id) {
  return decodeEnvelope(raw, assertProjectId(id)).envelope
}

/** All compare-and-replace steps run synchronously in the owning Host process. */
export function createProjectStore(deps) {
  const fs = deps.fs ? { ...nodeFs, ...deps.fs } : nodeFs
  const paths = ensureClipDirs(deps.paths, fs)
  const backupDir = join(paths.projectsDir, '.backups')

  function readRegularFile(file) {
    const descriptor = fs.openSync(file, READ_REGULAR_FILE)
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new Error('expected a regular file')
      return fs.readFileSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
  }

  function readEntry(id, file) {
    let bytes
    try {
      bytes = readRegularFile(file)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw ClipDomainError.projectUnreadable(id)
    }
    return { bytes, ...decodeEnvelope(readJson(bytes, id), id) }
  }

  function load(id, { binding } = {}) {
    const file = projectJsonPath(paths, id)
    const requested = normalizeBinding(id, binding)
    const entry = readEntry(id, file)
    if (!entry) {
      if (id.startsWith('clip_node_')) throw ClipDomainError.projectNotMaterialized(id)
      throw ClipDomainError.notFound(`project not found: ${id}`)
    }
    if (requested) matchBinding(id, entry.envelope, requested)
    return entry.envelope
  }

  function exists(id) {
    return fs.existsSync(projectJsonPath(paths, id))
  }

  function writeAtomic(file, bytes, publish) {
    const temp = join(dirname(file), `.clip-${randomUUID()}.tmp`)
    // Keep staging in the destination's directory so rename/link is atomic.
    const descriptor = fs.openSync(temp, 'wx', 0o600)
    try {
      try {
        fs.writeFileSync(descriptor, bytes)
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      publish(temp, file)
    } finally {
      fs.rmSync(temp, { force: true })
    }
  }

  function saveBackup(id, type, bytes) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    if (!fs.lstatSync(backupDir).isDirectory()) throw new Error('expected a backup directory')
    const file = join(backupDir, `${id}.${type}-${sha256(bytes)}.json`)
    function publish(temp, destination) {
      try {
        fs.linkSync(temp, destination)
      } catch (error) {
        if (error?.code !== 'EEXIST' || !bytes.equals(readRegularFile(destination))) throw error
      }
    }
    writeAtomic(file, bytes, publish)
  }

  function commit(file, envelope, { previous, backUpPrevious = false, draftBytes } = {}) {
    const { id } = envelope
    try {
      if (previous && (previous.needsMigration || backUpPrevious)) {
        saveBackup(id, previous.needsMigration ? 'original' : `revision-${previous.envelope.revision}`, previous.bytes)
      }
      if (draftBytes) saveBackup(id, 'canvas-draft', draftBytes)
      writeAtomic(file, encodeJson(envelope), (temp, destination) => fs.renameSync(temp, destination))
    } catch {
      throw new ClipDomainError('project-unreadable', `Could not persist project ${id}.`)
    }
    return envelope
  }

  function save(id, project, opts = {}) {
    const file = projectJsonPath(paths, id)
    const expectedRevision = assertRevision(opts.expectedRevision, 'expectedRevision')
    const revision = assertRevision(opts.revision === undefined ? expectedRevision + 1 : opts.revision, 'revision', 1)
    if (revision <= expectedRevision) throw ClipDomainError.invalidJson('revision must exceed expectedRevision')
    const requested = normalizeBinding(id, opts.binding)
    const previous = readEntry(id, file)
    const current = previous?.envelope
    const binding = matchBinding(id, current, requested)
    const currentRevision = current?.revision ?? 0
    if (expectedRevision !== currentRevision && revision !== currentRevision) {
      throw revisionConflict(id, expectedRevision, currentRevision)
    }
    const normalized = normalizeNativeProject(project, id, { allowMediaStatus: true })
    if (expectedRevision !== currentRevision) {
      if (!previous.needsMigration && isDeepStrictEqual(current.project, normalized)) return current
      throw revisionConflict(id, expectedRevision, currentRevision)
    }
    const envelope = envelopeFor(id, normalized, revision, Date.now(), binding)
    return commit(file, envelope, { previous, backUpPrevious: opts.backupCurrent === true })
  }

  /** Prefer the saved project; attach its first canvas binding and/or migrate once. */
  function materialize(id, { binding, draftSchema, title } = {}) {
    const file = projectJsonPath(paths, id)
    const requested = normalizeBinding(id, binding)
    const previous = readEntry(id, file)
    const current = previous?.envelope
    const bound = matchBinding(id, current, requested, { allowAssociate: true })
    if (current) {
      const attaching = bound && !current.binding
      if (!previous.needsMigration && !attaching) return current
      const revision = assertRevision(current.revision + (attaching && !previous.needsMigration ? 1 : 0), 'revision', 1)
      const envelope = envelopeFor(id, current.project, revision, current.updatedAt, bound)
      return commit(file, envelope, { previous, backUpPrevious: Boolean(attaching) })
    }
    if (draftSchema == null) {
      const now = Date.now()
      return commit(file, envelopeFor(id, createNativeProject(id, title || id, now), 1, now, bound))
    }
    const draftBytes = typeof draftSchema === 'string' ? Buffer.from(draftSchema) : encodeJson(draftSchema)
    const { envelope: draft } = decodeEnvelope(readJson(draftBytes, id), id, { title, allowDraftRekey: Boolean(bound) })
    if (draft.binding && !isDeepStrictEqual(draft.binding, bound)) {
      throw new ClipDomainError('clip-binding-mismatch', 'Draft project binding does not match the requested binding.')
    }
    const envelope = envelopeFor(id, draft.project, draft.revision, draft.updatedAt || Date.now(), bound)
    return commit(file, envelope, { draftBytes })
  }

  /** Idempotent initialization. Existing projects always win. */
  function create(id, project, { binding } = {}) {
    if (project === undefined || isLegacyTimeline(project)) return materialize(id, { binding, draftSchema: project })
    const file = projectJsonPath(paths, id)
    const requested = normalizeBinding(id, binding)
    const entry = readEntry(id, file)
    const bound = matchBinding(id, entry?.envelope, requested)
    if (entry) return entry.envelope
    const normalized = normalizeNativeProject(project, id, { allowMediaStatus: true })
    return commit(file, envelopeFor(id, normalized, 1, Date.now(), bound))
  }

  function list({ limit = 50 } = {}) {
    limit = Math.max(1, Math.min(100, limit || 50))
    const projects = []
    const unavailableProjects = []
    for (const file of fs.readdirSync(paths.projectsDir).sort()) {
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -5)
      try {
        const envelope = load(id)
        const { timeline, name, settings } = envelope.project
        const clips = nativeClipsByTrack(envelope.project)
        projects.push({
          id,
          projectName: safeText(name) || id,
          updatedAt: envelope.updatedAt,
          durationMs: Math.round(timeline.duration * 1000),
          aspectRatio: aspectRatioOf(settings),
          trackCount: timeline.tracks.length,
          clipCount: [...clips.values()].reduce((count, trackClips) => count + trackClips.length, 0),
          revision: envelope.revision,
          mode: projectMode(envelope),
        })
      } catch (error) {
        if (!(error instanceof ClipDomainError)) throw error
        unavailableProjects.push({ id, code: error.code, message: error.message })
      }
    }
    return {
      projects: projects.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit),
      unavailableProjects: unavailableProjects.slice(0, limit),
      unavailableCount: unavailableProjects.length,
    }
  }

  return { load, save, create, materialize, exists, list, paths }
}
