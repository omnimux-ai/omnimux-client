// The subset shared by saved and live snapshots. Keep these reads aligned with
// OpenReel core/types/project.ts, core/timeline/timeline-items.ts and agent/serialize.ts.
export const TRACK_TYPES = ['video', 'audio', 'image', 'text', 'graphics']
export const MEDIA_TYPES = ['video', 'audio', 'image']
export const OVERLAY_FIELDS = {
  textClips: 'text',
  shapeClips: 'shape',
  svgClips: 'svg',
  stickerClips: 'sticker',
  adjustmentLayers: 'adjustment',
  motionInstances: 'motion',
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

export function isReferenceId(value) {
  return typeof value === 'string' && /^[\p{L}\p{N}_.:-]{1,256}$/u.test(value)
    && !/^(?:blob|data|file|javascript|https?):/i.test(value)
}

export function sourceIdentity(value) {
  return isRecord(value) && isReferenceId(value.id) && isReferenceId(value.version)
    ? { id: value.id, version: value.version } : undefined
}

export function sourceProjection(value) {
  const base = sourceIdentity(value)
  if (!base) return undefined
  const scope = MEDIA_HANDLE_SCOPES.includes(value.handle?.scope)
    ? value.handle.scope
    : (MEDIA_HANDLE_SCOPES.includes(value.scope) ? value.scope : undefined)
  return scope ? { ...base, scope } : base
}

export function sha256Digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : undefined
}

export const MEDIA_HANDLE_SCOPES = ['project-asset', 'library-file', 'clip-vault', 'canvas-node']

const HANDLE_WORKSPACE_RE = /^ws_[A-Za-z0-9_-]{1,128}$/u
const HANDLE_MIME_RE = /^(?:video|audio|image)\/[a-z0-9.+-]+$/iu
const LIBRARY_PREVIEW_PATH = '/omnimux/assets/library/preview'

export function normalizeMediaHandle(value, workspaceId) {
  if (!isRecord(value) || value.v !== 1 || !MEDIA_HANDLE_SCOPES.includes(value.scope)) return undefined
  const sha256 = value.sha256 === undefined ? undefined : sha256Digest(value.sha256)
  if (value.sha256 !== undefined && !sha256) return undefined
  if (value.scope === 'project-asset') {
    if (typeof value.workspaceId !== 'string' || !HANDLE_WORKSPACE_RE.test(value.workspaceId)) return undefined
    if (workspaceId !== undefined && value.workspaceId !== workspaceId) return undefined
    if (!isRelativeMediaPath(value.rel) || value.rel.length > 2048) return undefined
    if (value.assetId !== undefined && !isReferenceId(value.assetId)) return undefined
    return {
      v: 1,
      scope: 'project-asset',
      workspaceId: value.workspaceId,
      ...(value.assetId !== undefined ? { assetId: value.assetId } : {}),
      rel: value.rel,
      ...(sha256 ? { sha256 } : {}),
    }
  }
  if (value.scope === 'library-file') {
    if (!isReferenceId(value.libraryAssetId) || !isReferenceId(value.fileId)) return undefined
    return {
      v: 1,
      scope: 'library-file',
      libraryAssetId: value.libraryAssetId,
      fileId: value.fileId,
      ...(sha256 ? { sha256 } : {}),
    }
  }
  if (value.scope === 'clip-vault') {
    if (!sha256 || typeof value.mimeType !== 'string' || !HANDLE_MIME_RE.test(value.mimeType)
      || /^image\/svg/iu.test(value.mimeType) || !Number.isSafeInteger(value.size) || value.size <= 0) {
      return undefined
    }
    return { v: 1, scope: 'clip-vault', sha256, mimeType: value.mimeType.toLowerCase(), size: value.size }
  }
  if (typeof value.workspaceId !== 'string' || !HANDLE_WORKSPACE_RE.test(value.workspaceId)) return undefined
  if (workspaceId !== undefined && value.workspaceId !== workspaceId) return undefined
  if (!isReferenceId(value.nodeId)) return undefined
  const outputIndex = value.outputIndex === undefined ? 0 : value.outputIndex
  if (!Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex > 256) return undefined
  return {
    v: 1,
    scope: 'canvas-node',
    workspaceId: value.workspaceId,
    nodeId: value.nodeId,
    outputIndex,
    ...(sha256 ? { sha256 } : {}),
  }
}

export function mediaHandleFromLocator(url, workspaceId, sha256) {
  if (typeof url !== 'string' || !/^\/(?!\/)/u.test(url) || /[\\#\x00-\x20\x7f]/u.test(url)) return undefined
  if (typeof URL.canParse === 'function' && !URL.canParse(url, 'https://clip.invalid')) return undefined
  const parsed = new URL(url, 'https://clip.invalid')
  const digest = sha256Digest(sha256)
  if (parsed.pathname === LIBRARY_PREVIEW_PATH) {
    const libraryAssetId = parsed.searchParams.get('id')
    const fileId = parsed.searchParams.get('file')
    return normalizeMediaHandle({ v: 1, scope: 'library-file', libraryAssetId, fileId, ...(digest ? { sha256: digest } : {}) })
  }
  const wsMatch = WORKSPACE_MEDIA_PATH.exec(parsed.pathname)
  if (wsMatch) {
    const wsId = wsMatch[1]
    const rel = parsed.searchParams.get('rel')
    const rev = parsed.searchParams.get('rev')
    const revDigest = rev?.startsWith('sha256:') ? sha256Digest(rev.slice('sha256:'.length)) : undefined
    return normalizeMediaHandle(
      { v: 1, scope: 'project-asset', workspaceId: wsId, rel, ...(digest ?? revDigest ? { sha256: digest ?? revDigest } : {}) },
      workspaceId,
    )
  }
  return undefined
}

export function mediaHandleOf(item, workspaceId) {
  const explicit = normalizeMediaHandle(item?.omnimuxSource?.handle, workspaceId)
  if (explicit) return explicit
  const digest = mediaContentDigest(item)
  return mediaHandleFromLocator(item?.omnimuxSource?.url, workspaceId, digest)
    ?? mediaHandleFromLocator(item?.sourceRef?.url, workspaceId, digest)
}

export function mediaContentDigest(item) {
  return sha256Digest(item?.sourceRef?.digest)
    ?? sha256Digest(item?.omnimuxSource?.digest)
    ?? sha256Digest(item?.omnimuxSource?.handle?.sha256)
}

const WORKSPACE_MEDIA_PATH = /^\/omnimux-workflow\/api\/workspaces\/(ws_[A-Za-z0-9_-]{1,128})\/file$/u

function isRelativeMediaPath(value) {
  return typeof value === 'string' && value.split('/').every(part => part && part !== '.' && part !== '..'
    && !/[\\:\x00-\x1f\x7f]/u.test(part))
}

export function reconnectMediaUrl(value, workspaceId) {
  if (typeof value !== 'string' || value.length > 4096 || !/^\/(?!\/)/u.test(value) || /[\\#\x00-\x20\x7f]/u.test(value)) return undefined
  const [pathname] = value.split('?')
  try {
    const { searchParams } = new URL(value, 'https://clip.invalid')
    const queryKeys = ['rel', 'rev', 'v']
    if (![...searchParams].every(([name, token]) => queryKeys.includes(name) && token)
      || queryKeys.some(name => searchParams.getAll(name).length > 1)) return undefined
    for (const name of ['rev', 'v']) {
      if (searchParams.has(name) && !isReferenceId(searchParams.get(name))) return undefined
    }
    const media = /^\/(?:omnimux-workflow\/)?media\/(.+)$/.exec(pathname)
    if (media && !searchParams.has('rel') && isRelativeMediaPath(decodeURIComponent(media[1]))) return value
    // The workspace route independently verifies the path against its project root.
    const workspace = WORKSPACE_MEDIA_PATH.exec(pathname)
    if (workspace && (workspaceId === undefined || workspace[1] === workspaceId)
      && isRelativeMediaPath(searchParams.get('rel'))) return value
  } catch {
    return undefined
  }
  return undefined
}

export function canvasWorkspaceMediaUrl(value, workspaceId) {
  return workspaceId && typeof value === 'string' && WORKSPACE_MEDIA_PATH.test(value.split('?')[0])
    ? reconnectMediaUrl(value, workspaceId) : undefined
}

export function workspaceMediaDigest(value, workspaceId) {
  const url = canvasWorkspaceMediaUrl(value, workspaceId)
  if (!url) return undefined
  const revision = new URL(url, 'https://clip.invalid').searchParams.get('rev')
  return revision?.startsWith('sha256:') ? sha256Digest(revision.slice('sha256:'.length)) : undefined
}

export function items(value) {
  return Array.isArray(value) ? value : []
}

export function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

export function projectMode(envelope) {
  return envelope.binding || envelope.projectId.startsWith('clip_node_') ? 'canvas' : 'standalone'
}

export function mediaIsMissing(item) {
  if (!item || item.isPlaceholder === true) return true
  if (typeof Blob !== 'undefined' && item.blob instanceof Blob && item.blob.size > 0) return false
  return !(item.fileHandle || item.nativeSource || item.missing === false)
}

export function aspectRatioOf({ width, height }) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return `${width}:${height}`
  let a = width
  let b = height
  while (b) [a, b] = [b, a % b]
  return `${width / a}:${height / a}`
}

export function safeText(value, limit = 160) {
  if (typeof value !== 'string') return undefined
  return value
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/giu, '')
    .replace(/\b(?:https?|file|blob|data|javascript):[^\s"'<>]+/giu, '[redacted]')
    .replace(/(^|[\s"'(<:=])(?:[a-z]:[/\\]|~?\/(?!\s)|\\\\)[^\r\n"'<>]+/giu, '$1[redacted]')
    .replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ')
    .trim()
    .slice(0, limit)
}

export function nativeClipsByTrack(project) {
  const byTrack = new Map(project.timeline.tracks.map((track) => [track.id, []]))
  for (const [field, kind] of Object.entries(OVERLAY_FIELDS)) {
    for (const clip of items(project[field])) {
      byTrack.get(clip.trackId)?.push({ clip, kind })
    }
  }
  for (const track of project.timeline.tracks) {
    const clips = byTrack.get(track.id)
    const overlayIds = new Set(clips.map(({ clip }) => clip.id))
    for (const clip of track.clips) {
      // Older motion projects can include a render proxy for the overlay.
      if (!overlayIds.has(clip.id) && !overlayIds.has(clip.metadata?.motionInstanceId)) clips.push({ clip, kind: 'media' })
    }
    clips.sort((a, b) => a.clip.startTime - b.clip.startTime || a.clip.id.localeCompare(b.clip.id))
  }
  return byTrack
}
