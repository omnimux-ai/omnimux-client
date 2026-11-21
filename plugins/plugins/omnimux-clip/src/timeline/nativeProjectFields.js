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

function isRelativeMediaPath(value) {
  return typeof value === 'string' && value.split('/').every(part => part && part !== '.' && part !== '..'
    && !/[\\:\x00-\x1f\x7f]/u.test(part))
}

export function reconnectMediaUrl(value) {
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
    if (/^\/omnimux-workflow\/api\/workspaces\/ws_[A-Za-z0-9_-]{1,128}\/file$/u.test(pathname)
      && isRelativeMediaPath(searchParams.get('rel'))) return value
  } catch {
    return undefined
  }
  return undefined
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
