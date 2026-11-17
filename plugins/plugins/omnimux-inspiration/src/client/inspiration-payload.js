/**
 * Inspiration → composer attachment payload.
 *
 * Pure data shaping only. Shared by the one-click replicate CTA and by any
 * future "用 Agent 分析" entry that attaches the same inspiration to a session,
 * so both features hand the composer exactly one payload shape.
 */

/**
 * Cover fallback copied from CoverCard's pickCoverSrc usage; do not import api.js.
 * @param {object | null | undefined} row
 * @returns {string}
 */
export function pickReplicationPreviewUrl(row) {
  if (!row || typeof row !== 'object') return ''
  const rec = /** @type {Record<string, unknown>} */ (row)
  const raw = rec.cover_key ?? rec.cover_url
  if (typeof raw !== 'string' || raw === '') return ''
  if (raw.includes('..')) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/omnimux/inspiration/local/media/')) return raw
  if (raw.startsWith('/omnimux/inspiration/media/')) return raw
  if (raw.startsWith('/api/inspiration/v1/media/')) {
    return `/omnimux/inspiration/media/${raw.slice('/api/inspiration/v1/media/'.length)}`
  }
  return `/omnimux/inspiration/media/${raw.replace(/^\/+/, '')}`
}

/**
 * Attachment payload for inspiration cards.
 * @param {object} row
 */
export function buildInspirationPayload(row) {
  const id = row?.id
  const decon = row?.deconstruction && typeof row.deconstruction === 'object' ? row.deconstruction : {}
  const shots = Array.isArray(decon.shots) ? decon.shots : (Array.isArray(row?.shots) ? row.shots : [])
  const structure = Array.isArray(decon.structure) ? decon.structure : []
  return {
    sourcePlugin: 'omnimux-inspiration',
    kind: 'inspiration',
    entityId: id,
    title: row?.title || row?.source_url || '灵感素材',
    extension: 'INSPIRATION',
    relativePath: row?.local_paths?.video || row?.local_paths?.cover || `inspiration/${id}`,
    previewUrl: pickReplicationPreviewUrl(row),
    metadata: {
      inspiration_id: id,
      source_url: row?.source_url,
      source_platform: row?.source_platform,
      hook: decon.hook || decon.hook_highlight || '',
      summary: decon.summary || '',
      shots,
      structure,
    },
  }
}
