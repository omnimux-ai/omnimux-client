import { isReferenceId, reconnectMediaUrl } from '../../timeline/nativeProjectFields.js'

const LIBRARY_PREVIEW = '/omnimux/assets/library/preview'
export const LOCAL_FILE_MEDIA_ROUTE = '/omnimux-workflow/api/local-file'
const ABSOLUTE_FILE = /^(?:\/[^/]|[A-Za-z]:[\\/]|\\\\[^\\])/u

function hasOnly(params, keys) {
  return [...params].every(([key, value]) => keys.includes(key) && value && params.getAll(key).length === 1)
}

export function localFileLocator(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^\/(?!\/)/u.test(value)
    || /[\\#\x00-\x20\x7f]/u.test(value)) return undefined
  try {
    const { pathname, searchParams } = new URL(value, 'https://clip.invalid')
    if (pathname !== value.split('?')[0] || pathname !== LOCAL_FILE_MEDIA_ROUTE) return undefined
    if (!hasOnly(searchParams, ['path', 'rev', 'v'])) return undefined
    const path = searchParams.get('path')
    const safeVersion = ['rev', 'v'].every(key => !searchParams.has(key) || isReferenceId(searchParams.get(key)))
    return path && ABSOLUTE_FILE.test(path) && !/[\x00-\x1f\x7f]/u.test(path) && safeVersion ? value : undefined
  } catch {
    return undefined
  }
}

export function bridgeMediaLocator(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^\/(?!\/)/u.test(value)
    || /[\\#\x00-\x20\x7f]/u.test(value)) return undefined
  try {
    const { pathname, searchParams } = new URL(value, 'https://clip.invalid')
    // Reject paths normalized by URL parsing before handing them to an API.
    if (pathname !== value.split('?')[0]) return undefined
    if (pathname === LIBRARY_PREVIEW && hasOnly(searchParams, ['id', 'file'])
      && isReferenceId(searchParams.get('id')) && isReferenceId(searchParams.get('file'))) return value
    const localFile = localFileLocator(value)
    if (localFile) return localFile
    return reconnectMediaUrl(value)
  } catch {
    return undefined
  }
}

export function readReturnedMedia(rows) {
  if (!Array.isArray(rows)) return undefined
  const media = []
  for (const row of rows) {
    const locator = bridgeMediaLocator(row?.url)
    if (!locator || locator.startsWith(`${LIBRARY_PREVIEW}?`) || !isReferenceId(row.id)
      || (row.version !== undefined && !isReferenceId(row.version))
      || !['video', 'image', 'audio'].includes(row.type)
      || typeof row.name !== 'string' || !row.name.trim()) return undefined
    const name = row.name.split(/[/\\]/u).at(-1).trim().slice(0, 256)
    if (!name) return undefined
    media.push({ id: row.id, name, url: locator, type: row.type, ...(row.version !== undefined ? { version: row.version } : {}) })
  }
  return media
}
