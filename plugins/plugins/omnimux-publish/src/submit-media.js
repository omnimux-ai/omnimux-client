import { PublishError } from './publish-error.js'
/** @typedef {{ agent?: unknown, signal?: AbortSignal }} ExecutionOptions */
/** @typedef {ReturnType<typeof import('./store.js').createRecordStore>} RecordStore */
/** @typedef {ReturnType<typeof import('./media.js').createMediaStore>} MediaStore */
/** @typedef {ReturnType<typeof import('./hubtools.js').createHubChannel>} HubChannel */

/** @param {{ title?: string, description?: string, topics?: string[] }} record */
export function composeContent(record) {
  const lines = []
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  if (title) lines.push(title)
  if (description && description !== title) lines.push(description)
  const topics = Array.isArray(record.topics) ? record.topics.filter((t) => typeof t === 'string' && t.trim() !== '') : []
  if (topics.length > 0) lines.push(topics.map((t) => `#${t.replace(/^#/, '')}`).join(' '))
  return lines.join('\n')
}

/** @param {{ store: RecordStore, media: MediaStore, channel: HubChannel }} deps */
export function createSubmitMedia({ store, media, channel }) {
  /** @param {{ media_ids?: string[] }} record */
  function mediaRowsOf(record) {
    return (record.media_ids || []).map((id) => {
      let row = media.get(id)
      if (!row) throw new PublishError('media-not-found', `media ${id} not found（草稿引用的媒体已被移出媒体仓）`)
      if (row.kind === 'video' && row.duration_sec === undefined && typeof media.probeDuration === 'function') {
        row = media.probeDuration(id) ?? row
      }
      return {
        id: row.id,
        kind: row.kind,
        filename: row.filename,
        content_type: row.content_type,
        ...(row.duration_sec !== undefined ? { duration_sec: row.duration_sec } : {}),
      }
    })
  }

  /** @param {import('./record-types.js').PublishRecord} record @param {ExecutionOptions} [opts] @returns {Promise<Record<string, string>>} */
  async function ensureUploaded(record, opts = {}) {
    const uploads = { ...record.uploads }
    const missing = record.media_ids.filter((id) => !uploads[id])
    for (const mediaId of missing) {
      const { buffer, meta } = media.open(mediaId)
      const ticket = await channel.presign(
        { filename: String(meta.filename || 'media'), content_type: String(meta.content_type || 'application/octet-stream') }, opts,
      )
      await channel.putBytes(ticket.upload_url, buffer, String(meta.content_type || 'application/octet-stream'), opts, {
        headers: ticket.headers,
        upload_method: ticket.upload_method,
      })
      uploads[mediaId] = ticket.public_url
    }
    if (missing.length > 0) store.setUploads(record.id, uploads)
    return uploads
  }
  return { mediaRowsOf, ensureUploaded }
}
