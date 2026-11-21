import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ClipDomainError } from '../errors.js'
import { ensureClipDirs, projectJsonPath } from '../paths.js'
import { createEmptySchema, structuredCloneSafe } from '../client/store/timelineTypes.js'

const DEFAULT_FS = { existsSync, readdirSync, readFileSync, writeFileSync }
const HISTORY_LIMIT = 80

/**
 * @param {unknown} parsed
 * @param {string} id
 */
export function unwrapProjectEnvelope(parsed, id) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ClipDomainError.invalidJson(`project ${id} is not a JSON object`)
  }
  const raw = /** @type {Record<string, unknown>} */ (parsed)
  const schema = isTimelineSchema(raw.schema) ? raw.schema
    : isTimelineSchema(raw) ? raw
    : null
  if (!schema) {
    if (isOpenReelProject(raw.schema) || isOpenReelProject(raw)) {
      throw ClipDomainError.openReelMigrationRequired(id)
    }
    throw ClipDomainError.invalidJson(`project ${id} is missing a TimelineSchema`)
  }
  const history = raw.history && typeof raw.history === 'object'
    ? /** @type {{ past?: unknown[], future?: unknown[] }} */ (raw.history)
    : { past: [], future: [] }
  return {
    id,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    schema: /** @type {Record<string, unknown>} */ (schema),
    playheadMs: typeof raw.playheadMs === 'number' ? raw.playheadMs : 0,
    isPlaying: Boolean(raw.isPlaying),
    history: {
      past: Array.isArray(history.past) ? history.past : [],
      future: Array.isArray(history.future) ? history.future : [],
    },
  }
}

/**
 * @param {unknown} value
 */
function isTimelineSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rec = /** @type {Record<string, unknown>} */ (value)
  return Array.isArray(rec.tracks)
}

function isOpenReelProject(value) {
  return typeof value?.id === 'string'
    && Array.isArray(value.timeline?.tracks)
    && Array.isArray(value.mediaLibrary?.items)
}

/**
 * Host-side project JSON store. One file per project under `projects/`.
 * A `clip_edit` call is one undo step (the previous schema is pushed to `history.past`).
 *
 * @param {{
 *   paths: ReturnType<typeof import('../paths.js').resolveClipPaths>,
 *   fs?: typeof DEFAULT_FS,
 * }} deps
 */
export function createProjectStore(deps) {
  const paths = ensureClipDirs(deps.paths)
  const fs = deps.fs ?? DEFAULT_FS

  function load(id) {
    const file = projectJsonPath(paths, id)
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (id.startsWith('clip_node_')) throw ClipDomainError.projectNotMaterialized(id)
      throw ClipDomainError.notFound(`project not found: ${id}`)
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw ClipDomainError.invalidJson(`project ${id} is not valid JSON`)
    }
    const envelope = unwrapProjectEnvelope(parsed, id)
    if (!envelope.schema.projectId) envelope.schema.projectId = id
    return envelope
  }

  function exists(id) {
    try {
      return fs.existsSync(projectJsonPath(paths, id))
    } catch (error) {
      if (error instanceof ClipDomainError) throw error
      return false
    }
  }

  /**
   * Persist an envelope. `recordUndo` snapshots the *current disk* schema
   * (not the incoming one) so one save = one undo step.
   * @param {string} id
   * @param {object} schema
   * @param {{ recordUndo?: boolean, playheadMs?: number, isPlaying?: boolean }} [opts]
   */
  function save(id, schema, opts = {}) {
    const file = projectJsonPath(paths, id)
    const nextSchema = structuredCloneSafe(schema)
    nextSchema.projectId = nextSchema.projectId || id
    /** @type {ReturnType<typeof unwrapProjectEnvelope>} */
    let previous
    if (fs.existsSync(file)) {
      previous = load(id)
    } else {
      previous = {
        id,
        updatedAt: 0,
        schema: createEmptySchema({ projectId: id }),
        playheadMs: 0,
        isPlaying: false,
        history: { past: [], future: [] },
      }
    }
    const past = opts.recordUndo
      ? [...previous.history.past, structuredCloneSafe(previous.schema)].slice(-HISTORY_LIMIT)
      : previous.history.past
    const envelope = {
      id,
      updatedAt: Date.now(),
      schema: nextSchema,
      playheadMs: opts.playheadMs ?? previous.playheadMs,
      isPlaying: opts.isPlaying ?? previous.isPlaying,
      history: {
        past,
        future: opts.recordUndo ? [] : previous.history.future,
      },
    }
    fs.writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 })
    return envelope
  }

  /**
   * Create a project if missing. Does not clobber an existing file.
   * @param {string} id
   * @param {object} [schema]
   */
  function create(id, schema) {
    const file = projectJsonPath(paths, id)
    if (fs.existsSync(file)) return load(id)
    return save(id, schema || createEmptySchema({ projectId: id }), { recordUndo: false })
  }

  /**
   * Summarize readable files and report incompatible or invalid entries.
   * @param {{ limit?: number }} [opts]
   */
  function list(opts = {}) {
    const limit = Math.max(1, Math.min(100, opts.limit || 50))
    const projects = []
    const unavailableProjects = []
    if (fs.existsSync(paths.projectsDir)) {
      for (const file of fs.readdirSync(paths.projectsDir).sort()) {
        if (!file.endsWith('.json')) continue
        const id = file.slice(0, -5)
        try {
          const envelope = load(id)
          const tracks = envelope.schema.tracks
          projects.push({
            id,
            projectName: envelope.schema.name || envelope.schema.projectId || id,
            updatedAt: envelope.updatedAt || 0,
            durationMs: envelope.schema.canvasConfig?.durationMs || 0,
            aspectRatio: envelope.schema.canvasConfig?.aspectRatio || '16:9',
            trackCount: tracks.length,
            clipCount: tracks.reduce((count, track) => count + (Array.isArray(track?.clips) ? track.clips.length : 0), 0),
          })
        } catch (error) {
          if (!(error instanceof ClipDomainError)) throw error
          unavailableProjects.push({ id, code: error.code, message: error.message })
        }
      }
    }
    return {
      projects: projects.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit),
      unavailableProjects: unavailableProjects.slice(0, limit),
      unavailableCount: unavailableProjects.length,
    }
  }

  return { load, save, create, exists, list, paths }
}
