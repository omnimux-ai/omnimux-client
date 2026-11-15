/** Test-only API surface for mounting InspirationPostDetail without network. */
export function hostMediaSrc(url) {
  if (typeof url !== 'string' || !url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/omnimux/inspiration/media/')) return url
  return `/omnimux/inspiration/media/${url.replace(/^\/+/, '')}`
}

export function pickVideoSrc() { return '' }
export function pickCoverSrc(row) { return row?.cover_key || '' }
export function resolveTikTokEmbedUrl() { return '' }

export async function getAnalysisService() {
  return { ok: true, body: { imageToolConfigured: true, channel: 'official', revision: 1 } }
}
export async function confirmOfficialAnalysisService() { return { ok: true, body: {} } }
export async function getLocalInspiration() { return { ok: false, status: 404, body: {} } }
export async function ensureLocalInspiration(item) { return item }
export async function triggerAnalyzeInspiration() { return { ok: true, body: {} } }
export async function translateInspiration() { return { ok: true, body: {} } }
export async function saveCreationDraft() { return { ok: true, body: {} } }
export async function prepareCreationReferences() { return { ok: true, body: {} } }
