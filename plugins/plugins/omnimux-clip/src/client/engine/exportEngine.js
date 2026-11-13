/**
 * Self-contained composition export — OpenReel WebCodecs pipeline.
 *   TimelineSchema → OpenReel WebCodecs Exporter → ISO-BMFF mux
 *   → POST /omnimux-clip/api/projects/:id/save-export
 */

import { exportTimelineWithWebCodecs } from './openreel/index.js'
import { stripRuntimeUrls } from '../store/timelineTypes.js'
import { normalizeSchemaTextColors } from '../theme/colors.js'

export const CLIP_API_PREFIX = '/omnimux-clip/api'

export async function exportTimeline(schema, opts = {}) {
  // Token 适配：成片导出与预览同规则，var 链在进入引擎前落为具体色。
  const encoded = await exportTimelineWithWebCodecs(normalizeSchemaTextColors(schema), opts)
  return {
    bytes: encoded.mp4Blob,
    base64: encoded.base64,
    durationMs: encoded.durationMs,
    width: encoded.width,
    height: encoded.height,
    thumbnail: encoded.thumbnail,
    blob: encoded.mp4Blob,
  }
}

export async function persistExport(projectId, result, { schema } = {}) {
  const id = projectId || schema?.projectId
  if (!id) throw new Error('invalid-id: missing projectId')
  const payload = {
    base64: result.base64,
    mime: 'video/mp4',
    durationMs: result.durationMs,
    width: result.width,
    height: result.height,
  }
  const response = await fetch(`${CLIP_API_PREFIX}/projects/${encodeURIComponent(id)}/save-export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.message || body.error || 'export persist failed')
  }
  if (schema) {
    await fetch(`${CLIP_API_PREFIX}/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: stripRuntimeUrls(schema) }),
    }).catch(() => {})
  }
  return {
    path: body.path,
    bytes: body.bytes,
    thumbnailPath: result.thumbnail,
  }
}
