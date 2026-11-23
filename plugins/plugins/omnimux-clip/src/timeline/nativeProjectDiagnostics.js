import { finite, isReferenceId, items, mediaIsMissing, nativeClipsByTrack } from './nativeProjectFields.js'

const TIME_EPSILON = 1e-9
const GAP_THRESHOLD_SEC = 0.08
const MIGRATION_MESSAGES = {
  'legacy-track-unmapped': 'A legacy track could not be mapped.',
  'legacy-clip-unmapped': 'A legacy clip could not be mapped.',
  'legacy-media-unmapped': 'A legacy media item could not be mapped.',
  'legacy-media-ambiguous': 'A legacy clip matched multiple source references.',
  'legacy-transition-unmapped': 'A legacy transition could not be mapped.',
}

function compoundIdOf(clip) {
  if (isReferenceId(clip.metadata?.compoundClipId)) return clip.metadata.compoundClipId
  return clip.mediaId?.startsWith('compound:') ? clip.mediaId.slice('compound:'.length) : undefined
}

/** Diagnose stored timing and reference state using project data alone. */
export function diagnoseNativeProject(envelope) {
  const { projectId, project, revision } = envelope
  const { timeline, mediaLibrary } = project
  const byTrack = nativeClipsByTrack(project)
  const media = new Map(mediaLibrary.items.map((item) => [item.id, item]))
  const compounds = new Set([...items(project.sequences), ...items(project.compoundClips)].map((item) => item.id))
  const referencedMedia = new Set()
  const visualIntervals = []
  const issues = []
  for (const track of timeline.tracks) {
    let furthest
    for (const { clip, kind } of byTrack.get(track.id)) {
      const ids = { trackId: track.id, clipId: clip.id }
      const start = clip.startTime
      const end = start + clip.duration
      if (start < -TIME_EPSILON || clip.duration <= 0 || end > timeline.duration + TIME_EPSILON) {
        issues.push({ code: 'clip_out_of_bounds', message: 'Clip is outside the timeline bounds.', scope: 'timeline', ...ids, fromSec: start, toSec: end })
      }
      if (furthest && clip.duration > 0 && start + TIME_EPSILON < furthest.end) {
        issues.push({ code: 'clip_overlap', message: 'Clips overlap on the same track.', ...ids, otherClipId: furthest.id, fromSec: start, toSec: Math.min(end, furthest.end) })
      }
      if (clip.duration > 0 && (!furthest || end > furthest.end)) furthest = { id: clip.id, end }
      if (kind !== 'media') continue

      const compoundId = compoundIdOf(clip)
      const source = media.get(clip.mediaId)
      if (!compoundId && clip.mediaId) referencedMedia.add(clip.mediaId)
      if (compoundId ? !compounds.has(compoundId) : mediaIsMissing(source)) {
        issues.push({ code: 'media_missing', message: 'Clip source is unavailable.', ...ids, ...(isReferenceId(clip.mediaId) ? { mediaId: clip.mediaId } : {}) })
      }
      const inPoint = finite(clip.inPoint, 0)
      const outPoint = finite(clip.outPoint, inPoint)
      const duration = source?.metadata?.duration
      if (inPoint < -TIME_EPSILON || outPoint + TIME_EPSILON < inPoint
        || (source?.type !== 'image' && duration > 0 && outPoint > duration + TIME_EPSILON)) {
        issues.push({ code: 'clip_out_of_bounds', message: 'Trim is outside the source bounds.', scope: 'source', ...ids, fromSec: inPoint, toSec: outPoint })
      }
      const visual = source ? source.type === 'image' || (source.type === 'video' && source.metadata?.hasVideo !== false)
        : track.type === 'video' || track.type === 'image'
      if (!track.hidden && visual && end > 0 && start < timeline.duration && clip.duration > 0) {
        visualIntervals.push({ start: Math.max(0, start), end: Math.min(timeline.duration, end) })
      }
    }
  }
  for (const item of media.values()) {
    if (mediaIsMissing(item) && !referencedMedia.has(item.id)) {
      issues.push({ code: 'media_missing', message: 'Media source is unavailable.', mediaId: item.id })
    }
  }
  if (visualIntervals.length > 0) {
    let end = 0
    function addGap(start) {
      if (start - end + TIME_EPSILON >= GAP_THRESHOLD_SEC) {
        issues.push({ code: 'timeline_gap', message: 'No visible video covers this interval.', fromSec: end, toSec: start })
      }
    }
    for (const interval of visualIntervals.sort((a, b) => a.start - b.start)) {
      addGap(interval.start)
      end = Math.max(end, interval.end)
    }
    addGap(timeline.duration)
  }
  for (const issue of items(project.migrationIssues)) {
    if (!Object.hasOwn(MIGRATION_MESSAGES, issue?.code)) continue
    issues.push({
      code: issue.code,
      message: MIGRATION_MESSAGES[issue.code],
      ...(isReferenceId(issue.trackId) ? { trackId: issue.trackId } : {}),
      ...(isReferenceId(issue.clipId) ? { clipId: issue.clipId } : {}),
      ...(isReferenceId(issue.mediaId) ? { mediaId: issue.mediaId } : {}),
    })
  }
  return { projectId, revision, ok: issues.length === 0, issueCount: issues.length, issues }
}

const RECONCILE_ISSUE_MESSAGES = {
  legacy_unsigned_exact: 'Media item has no content digest but matches a unique connected canvas source and can be upgraded.',
  source_drifted: 'Media source content changed since it was imported. Relink with allowVersionUpdate=true to adopt the latest version.',
  legacy_ambiguous: 'Media item matched multiple or duration-mismatched canvas sources and requires explicit relinking.',
  missing_unlinked: 'Media file is missing on Host and has no matching connected canvas source.',
}

function diagnosticMetaForReconcile(entry) {
  if (!entry) return undefined
  const state = entry.reconcileState
  const scope = entry.canonicalHandle?.scope
  const suggested = isReferenceId(entry.suggestedSourceNodeId) ? entry.suggestedSourceNodeId : undefined
  if (state === 'online_exact') {
    return {
      reason: 'cache_miss_recoverable',
      recoverable: true,
      ...(suggested ? { suggestedSourceNodeId: suggested } : {}),
      ...(scope ? { scope } : {}),
    }
  }
  if (state === 'legacy_unsigned_exact') {
    return {
      reason: 'legacy_unsigned_exact',
      recoverable: true,
      ...(suggested ? { suggestedSourceNodeId: suggested } : {}),
      ...(scope ? { scope } : {}),
    }
  }
  if (state === 'source_drifted') {
    return {
      reason: 'source_drifted',
      recoverable: true,
      ...(suggested ? { suggestedSourceNodeId: suggested } : {}),
      ...(scope ? { scope } : {}),
    }
  }
  if (state === 'legacy_ambiguous') {
    return {
      reason: 'legacy_ambiguous',
      recoverable: false,
      ...(suggested ? { suggestedSourceNodeId: suggested } : {}),
      ...(scope ? { scope } : {}),
    }
  }
  return {
    reason: 'missing_unlinked',
    recoverable: false,
    ...(scope ? { scope } : {}),
  }
}

/**
 * Enrich static `diagnoseNativeProject` output with Host-verified reconcile reasons.
 * Produces zero host absolute paths; surfaces drifted or missing Host media even
 * when the saved project JSON predates the disk change.
 */
export function enrichDiagnosticsWithReconcile(report, reconcileReport) {
  if (!reconcileReport || !Array.isArray(reconcileReport.items)) return report
  const byMediaId = new Map(reconcileReport.items.map((entry) => [entry.mediaId, entry]))
  const coveredMediaIds = new Set()
  const issues = report.issues.map((issue) => {
    if (issue.code !== 'media_missing' || !issue.mediaId) return issue
    const entry = byMediaId.get(issue.mediaId)
    if (!entry) return issue
    coveredMediaIds.add(issue.mediaId)
    return { ...issue, ...diagnosticMetaForReconcile(entry) }
  })
  for (const entry of reconcileReport.items) {
    if (coveredMediaIds.has(entry.mediaId)) continue
    if (entry.reconcileState === 'online_exact') continue
    issues.push({
      code: 'media_missing',
      message: RECONCILE_ISSUE_MESSAGES[entry.reconcileState] ?? 'Media source is unavailable.',
      mediaId: entry.mediaId,
      ...diagnosticMetaForReconcile(entry),
    })
  }
  return {
    ...report,
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
  }
}
