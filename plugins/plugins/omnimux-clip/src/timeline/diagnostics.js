import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const DEFAULT_FS = { existsSync }
const GAP_THRESHOLD_MS = 80

/**
 * Walk a TimelineSchema and report timeline_gap / clip_overlap / media_missing.
 * Does not throw — `clip_diagnostics` returns the issue list so the agent can
 * decide whether to auto-fix. Individual issues still use the frozen codes.
 *
 * @param {object} schema
 * @param {{ fs?: { existsSync: Function }, checkMedia?: boolean }} [opts]
 */
export function diagnoseTimeline(schema, opts = {}) {
  const fs = opts.fs ?? DEFAULT_FS
  const checkMedia = opts.checkMedia !== false
  /** @type {Array<{ code: string, message: string, trackId?: string, clipId?: string, fromMs?: number, toMs?: number, path?: string }>} */
  const issues = []

  for (const track of schema.tracks || []) {
    const clips = [...(track.clips || [])].sort((a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0))
    let prevEnd = 0
    let prevId = null
    for (const clip of clips) {
      const start = clip.startTimeMs || 0
      const end = start + (clip.durationMs || 0)
      if (prevId && start < prevEnd - 1) {
        issues.push({
          code: 'clip_overlap',
          message: `clip ${clip.id} overlaps ${prevId} on track ${track.id} (${start}ms < ${prevEnd}ms)`,
          trackId: track.id,
          clipId: clip.id,
          fromMs: start,
          toMs: prevEnd,
        })
      } else if (prevId && start - prevEnd >= GAP_THRESHOLD_MS && track.type === 'video') {
        issues.push({
          code: 'timeline_gap',
          message: `black-frame gap on track ${track.id} between ${prevId} and ${clip.id} (${prevEnd}ms–${start}ms)`,
          trackId: track.id,
          clipId: clip.id,
          fromMs: prevEnd,
          toMs: start,
        })
      }
      prevEnd = Math.max(prevEnd, end)
      prevId = clip.id
    }
  }

  if (checkMedia) {
    const seen = new Set()
    const candidates = []
    for (const item of schema.media || []) {
      if (item?.path) candidates.push({ path: item.path, clipId: item.id, kind: 'media' })
    }
    for (const track of schema.tracks || []) {
      for (const clip of track.clips || []) {
        if (clip.mediaType === 'text') continue
        const path = clip.sourceUrl || ''
        if (path) candidates.push({ path, clipId: clip.id, kind: 'clip' })
      }
    }
    for (const item of candidates) {
      const path = String(item.path)
      if (!path || path.startsWith('blob:') || path.startsWith('data:')) continue
      const key = `${item.clipId}:${path}`
      if (seen.has(key)) continue
      seen.add(key)
      if (looksLikeMissing(path, fs)) {
        issues.push({
          code: 'media_missing',
          message: `media file is missing: ${path}`,
          clipId: item.clipId,
          path,
        })
      }
    }
  }

  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
  }
}

/**
 * @param {string} path
 * @param {{ existsSync: Function }} fs
 */
function looksLikeMissing(path, fs) {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://')) {
    return false
  }
  if (!isAbsolute(path)) return false
  try {
    return !fs.existsSync(path)
  } catch {
    return true
  }
}
