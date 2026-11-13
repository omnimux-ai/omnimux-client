/**
 * OpenReel Magnet Snapping Engine.
 * Calculates snap targets (playhead, track clip edges, canvas boundaries) within threshold.
 */

export function computeSnapPoints(tracks, { playheadMs, excludeClipId = null } = {}) {
  const snapPoints = new Set()
  if (typeof playheadMs === 'number' && Number.isFinite(playheadMs) && playheadMs >= 0) {
    snapPoints.add(playheadMs)
  }
  snapPoints.add(0)

  for (const track of tracks || []) {
    for (const clip of track.clips || []) {
      if (excludeClipId && clip.id === excludeClipId) continue
      const start = clip.startTimeMs || 0
      const end = start + (clip.durationMs || 0)
      snapPoints.add(start)
      snapPoints.add(end)
    }
  }

  return Array.from(snapPoints).sort((a, b) => a - b)
}

/**
 * Find the closest snap point for a given time and threshold.
 * @param {number} targetTimeMs
 * @param {number[]} snapPoints
 * @param {number} thresholdMs
 * @returns {{ snappedTimeMs: number, snapped: boolean, diffMs: number }}
 */
export function findSnap(targetTimeMs, snapPoints, thresholdMs = 120) {
  let closest = targetTimeMs
  let minDiff = Infinity
  let snapped = false

  for (const pt of snapPoints) {
    const diff = Math.abs(pt - targetTimeMs)
    if (diff <= thresholdMs && diff < minDiff) {
      minDiff = diff
      closest = pt
      snapped = true
    }
  }

  return {
    snappedTimeMs: snapped ? closest : targetTimeMs,
    snapped,
    diffMs: snapped ? closest - targetTimeMs : 0,
  }
}
