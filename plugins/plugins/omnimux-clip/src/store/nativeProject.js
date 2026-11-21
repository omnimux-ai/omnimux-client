import { createHash } from 'node:crypto'
import { ClipDomainError } from '../errors.js'
import { canvasWorkspaceMediaUrl, finite, isRecord, isReferenceId, items, MEDIA_TYPES, OVERLAY_FIELDS, reconnectMediaUrl, sha256Digest, sourceIdentity, TRACK_TYPES } from '../timeline/nativeProjectFields.js'

const DEFAULT_SETTINGS = { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 }
const RUNTIME_FIELDS = new Set(['blob', 'fileHandle', 'waveformData', 'thumbnailUrl', 'filmstripThumbnails'])
const UNSAVED_FIELDS = new Set([
  '__proto__', 'constructor', 'prototype', 'approved', 'trusted', 'code', 'script', 'glsl', 'generatedShaders',
])

export function createNativeProject(id, name = id, now = Date.now()) {
  return {
    id, name: typeof name === 'string' && name.trim() ? name : id, createdAt: now, modifiedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
    mediaLibrary: { items: [] },
  }
}

export function nativeTransform({ x = 0, y = 0, opacity = 1, fitMode } = {}) {
  return {
    position: { x, y }, scale: { x: 1, y: 1 }, rotation: 0,
    anchor: { x: 0.5, y: 0.5 }, opacity,
    ...(fitMode ? { fitMode } : {}),
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function isNativeProject(value) {
  return isRecord(value) && isRecord(value.timeline) && isRecord(value.mediaLibrary)
}

// Native projects carry more editable state than the agent projection. Keep
// JSON-native geometry and parameters, with runtime and executable data removed.
function cloneProjectData(value, depth = 0) {
  if (depth > 100) throw ClipDomainError.invalidJson('project nesting is too deep')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    return value.map((item) => cloneProjectData(item ?? null, depth + 1))
  }
  if (!isRecord(value)) throw ClipDomainError.invalidJson('project data must be JSON serializable')
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || UNSAVED_FIELDS.has(key) || RUNTIME_FIELDS.has(key)) continue
    result[key] = cloneProjectData(child, depth + 1)
  }
  if (value.type === 'expression') result.enabled = false
  return result
}

function requireFields(condition, field) {
  if (!condition) throw ClipDomainError.invalidJson(`invalid OpenReel project ${field}`)
}

export function contentVersionOf(value) {
  const version = value?.contentVersion ?? value?.revision
  return Number.isSafeInteger(version) && version >= 0 ? version : isReferenceId(version) ? version : undefined
}

function sourceFingerprint(item) {
  const source = [item.nativeSource?.path, item.sourceFile?.path, item.path, item.originalUrl]
    .find((value) => typeof value === 'string' && value && !/^(?:blob|data):/i.test(value))
  return source ? sha256(source) : undefined
}

function mediaReference(item, originalProjectId, workspaceId) {
  const ref = item.sourceRef
  const fingerprint = sha256Digest(ref?.fingerprint) ?? sourceFingerprint(item)
  const contentVersion = contentVersionOf(ref) ?? contentVersionOf(item)
  const projectId = originalProjectId ?? (isReferenceId(ref?.projectId) ? ref.projectId : undefined)
  const digest = sha256Digest(ref?.digest)
  const url = ref?.kind === 'legacy' ? canvasWorkspaceMediaUrl(ref.url, workspaceId) : undefined
  return {
    ...(ref?.kind === 'legacy' ? { kind: 'legacy' } : { kind: 'indexeddb', key: item.id }),
    ...(projectId && ref?.kind !== 'legacy' ? { projectId } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    ...(contentVersion === undefined ? {} : { contentVersion }),
    ...(digest ? { digest } : {}),
    ...(url ? { url } : {}),
  }
}

function normalizeMedia(item, { allowMediaStatus, originalProjectId, workspaceId }) {
  requireFields(isRecord(item) && isReferenceId(item.id) && MEDIA_TYPES.includes(item.type), 'media item')
  const {
    nativeSource, originalUrl, sourceFile, copiedFrom, proxy, path, url,
    sourceRef, omnimuxSource, blob, fileHandle, thumbnailUrl, waveformData, filmstripThumbnails, ...data
  } = item
  const source = sourceIdentity(omnimuxSource)
  const safeUrl = source ? reconnectMediaUrl(omnimuxSource.url, workspaceId) : undefined
  const digest = sha256Digest(omnimuxSource?.digest)
  // Availability is confirmed by the active editor for an explicit IDB key.
  // A raw import (including JSON's {} for Blob) cannot attest to local bytes.
  const missing = !(allowMediaStatus && sourceRef?.kind === 'indexeddb' && sourceRef.key === item.id
    && blob == null && fileHandle == null && item.missing === false && item.isPlaceholder !== true)
  const fileName = typeof sourceFile?.name === 'string' ? sourceFile.name.split(/[/\\]/u).at(-1) : undefined
  const idbProxy = proxy?.storage === 'idb' && proxy.path === `proxy:${item.id}` ? proxy : undefined
  return {
    ...data,
    name: typeof item.name === 'string' ? item.name : item.id,
    metadata: {
      duration: 0, width: 0, height: 0, frameRate: 0, codec: '', sampleRate: 0, channels: 0, fileSize: 0,
      ...(isRecord(item.metadata) ? item.metadata : {}),
    },
    ...(fileName ? { sourceFile: { name: fileName, size: finite(sourceFile.size, 0), lastModified: finite(sourceFile.lastModified, 0) } } : {}),
    ...(idbProxy ? { proxy: { ...idbProxy, previewPath: undefined } } : {}),
    ...(source ? { omnimuxSource: { ...source, ...(safeUrl ? { url: safeUrl } : {}), ...(digest ? { digest } : {}) } } : {}),
    sourceRef: mediaReference(item, originalProjectId, workspaceId),
    missing,
    isPlaceholder: missing,
  }
}

function uniqueIds(entries, field) {
  requireFields(entries.every((entry) => isRecord(entry) && isReferenceId(entry.id)), field)
  requireFields(new Set(entries.map((entry) => entry.id)).size === entries.length, `duplicate ${field} IDs`)
}

function normalizeTimeline(timeline) {
  requireFields(isRecord(timeline) && Array.isArray(timeline.tracks)
    && Number.isFinite(timeline.duration) && timeline.duration >= 0, 'timeline')
  uniqueIds(timeline.tracks, 'track')
  const tracks = timeline.tracks.map((track) => {
    requireFields(TRACK_TYPES.includes(track.type) && Array.isArray(track.clips), 'track')
    return {
      name: track.id, locked: false, hidden: false, muted: false, solo: false,
      ...track,
      transitions: items(track.transitions),
      clips: track.clips.map((clip) => {
        requireFields(isRecord(clip) && isReferenceId(clip.id) && isReferenceId(clip.mediaId)
          && Number.isFinite(clip.startTime) && Number.isFinite(clip.duration), 'clip')
        requireFields(clip.trackId === undefined || clip.trackId === track.id, 'clip track identity')
        requireFields(['inPoint', 'outPoint', 'volume', 'speed'].every((field) => clip[field] === undefined || Number.isFinite(clip[field])), 'clip timing or audio')
        return {
          inPoint: 0, outPoint: clip.duration, volume: 1, transform: nativeTransform(), ...clip,
          effects: items(clip.effects), audioEffects: items(clip.audioEffects), keyframes: items(clip.keyframes),
          trackId: track.id,
        }
      }),
    }
  })
  uniqueIds(tracks.flatMap((track) => track.clips), 'clip')
  const subtitles = items(timeline.subtitles)
  uniqueIds(subtitles, 'subtitle')
  requireFields(subtitles.every((cue) => typeof cue.text === 'string' && Number.isFinite(cue.startTime) && Number.isFinite(cue.endTime)), 'subtitle timing or text')
  return { ...timeline, tracks, subtitles, markers: items(timeline.markers) }
}

export function normalizeNativeProject(project, id, { allowRekey = false, allowMediaStatus = false, workspaceId } = {}) {
  requireFields(isNativeProject(project) && isReferenceId(project.id) && (allowRekey || project.id === id), 'identity')
  requireFields(isRecord(project.settings) && ['width', 'height', 'frameRate'].every((field) => (
    Number.isFinite(project.settings[field]) && project.settings[field] > 0
  )), 'settings')
  requireFields(Array.isArray(project.mediaLibrary.items), 'media library')
  uniqueIds(project.mediaLibrary.items, 'media')

  const { desktopIngest, ...library } = project.mediaLibrary
  const timeline = normalizeTimeline(project.timeline)
  for (const field of Object.keys(OVERLAY_FIELDS)) {
    if (project[field] !== undefined) {
      requireFields(Array.isArray(project[field]), field)
      uniqueIds(project[field], field)
      requireFields(project[field].every((item) => Number.isFinite(item.startTime) && Number.isFinite(item.duration)), field)
    }
  }
  return cloneProjectData({
    ...project,
    id,
    name: typeof project.name === 'string' && project.name.trim() ? project.name : id,
    createdAt: finite(project.createdAt, 0),
    modifiedAt: finite(project.modifiedAt, 0),
    settings: { ...DEFAULT_SETTINGS, ...project.settings },
    timeline,
    mediaLibrary: { ...library, items: library.items.map((item) => normalizeMedia(item, {
      allowMediaStatus, workspaceId, originalProjectId: project.id === id ? undefined : project.id,
    })) },
    ...(Array.isArray(project.sequences) ? { sequences: project.sequences.map((sequence) => {
      requireFields(isRecord(sequence) && isReferenceId(sequence.id), 'sequence')
      return { ...sequence, timeline: normalizeTimeline(sequence.timeline) }
    }) } : {}),
  })
}
