/**
 * fetch wrapper over the plugin's local HTTP routes. Every call resolves to
 * `{ ok, status, body }`; the UI only renders `body.error` / `body.message`.
 *
 * Catalog *metadata* is the one thing that is not necessarily local: the two
 * read-only page routes resolve their base through `cloud-source.js`, so a
 * build pointed at the production gateway reads its manifest and pages from
 * there, and still falls back to the Host when the gateway cannot answer.
 * Media, search and save stay on the Host routes below.
 */
import { requestFilePicker } from 'dsh-ui-kit/native-file-picker'
import { cloudManifestUrl, cloudPageUrl, resolveCloudBase } from './cloud-source.js'
import { defaultRequestCoalescer } from './request-coalescer.js'

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export async function assetsRequest(path, opts = {}) {
  const response = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  })
  let json = {}
  try {
    json = await response.json()
  } catch (error) {
    json = { error: `HTTP ${String(response.status)}`, detail: error instanceof Error ? error.message : String(error) }
  }
  return { ok: response.ok, status: response.status, body: json }
}

/**
 * Fetch wrapper for raw UTF-8 text endpoints (`GET /library/text`, `GET /library/text/version`).
 * On non-OK status, parses the structured JSON error body.
 * @param {string} path
 * @param {{ signal?: AbortSignal }} [opts]
 */
async function assetsTextRequest(path, opts = {}) {
  const response = await fetch(path, { method: 'GET', signal: opts.signal })
  if (!response.ok) {
    let body = {}
    try {
      body = await response.json()
    } catch (error) {
      body = { error: `HTTP ${String(response.status)}`, detail: error instanceof Error ? error.message : String(error) }
    }
    return { ok: false, status: response.status, text: '', headers: response.headers, body }
  }
  const text = await response.text()
  return { ok: true, status: response.status, text, headers: response.headers, body: null }
}

/** @param {string} value */
function safeDecodeHeader(value) {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch (error) {
    console.warn('[omnimux-assets] failed to decode header value:', error?.message || error)
    return value
  }
}

/**
 * Cheap polling state. Pass current revisions to get `unchanged: true`
 * when nothing moved; omit them for a full snapshot.
 * @param {number | undefined} [mrev]
 * @param {number | undefined} [arev]
 */
export function getState(mrev, arev) {
  const query = new URLSearchParams()
  if (Number.isFinite(/** @type {number} */ (mrev))) query.set('lrev', String(mrev))
  if (Number.isFinite(/** @type {number} */ (arev))) query.set('arev', String(arev))
  const suffix = query.toString() ? `?${query}` : ''
  return assetsRequest(`/omnimux/assets/state${suffix}`)
}

/**
 * @param {{ name: string, type?: string, description?: string, tags?: string[], files?: { real_path: string }[] }} body
 */
export function createAsset(body) {
  return assetsRequest('/omnimux/assets/library', { method: 'POST', body })
}

/**
 * @param {string} id
 * @param {{ name?: string, type?: string, description?: string, tags?: string[], files?: { real_path: string }[] }} patch
 */
export function updateAsset(id, patch) {
  return assetsRequest('/omnimux/assets/library/update', { method: 'POST', body: { id, ...patch } })
}

/**
 * Deletes the library record and recycles data/files/<id>/. User originals stay.
 * @param {string} id
 */
export function deleteAsset(id) {
  return assetsRequest('/omnimux/assets/library/delete', { method: 'POST', body: { id } })
}

/**
 * @param {string} path
 * @param {string} name
 */
export function addMapping(path, name) {
  return assetsRequest('/omnimux/assets/mappings', { method: 'POST', body: { path, name } })
}

/**
 * @param {string} id
 * @param {string} name
 */
export function renameMapping(id, name) {
  return assetsRequest('/omnimux/assets/mappings/rename', { method: 'POST', body: { id, name } })
}

/**
 * Only deletes the registry record — real files stay untouched.
 * @param {string} id
 */
export function deleteMapping(id) {
  return assetsRequest('/omnimux/assets/mappings/delete', { method: 'POST', body: { id } })
}

/**
 * Open the OS chooser. Body is `{ path, paths }` — `path` stays for older
 * callers; `paths` is the full multi-select list (empty on cancel).
 * @param {'file' | 'directory'} kind
 */
export function pickPath(kind) {
  const prompt = kind === 'directory' ? '选择要添加的文件夹' : '选择要添加的文件'
  return requestFilePicker({ kind, multiple: true, prompt }, () =>
    assetsRequest('/omnimux/assets/pick', { method: 'POST', body: { kind } }))
}

/**
 * One-layer listing of an asset file/folder ref. Folders are not flattened.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} [subPath]
 */
export function listAssetFiles(assetId, fileId, subPath = '') {
  const query = new URLSearchParams({ id: assetId, file: fileId })
  if (subPath !== '') query.set('path', subPath)
  return assetsRequest(`/omnimux/assets/library/files?${query}`)
}

/**
 * Read-only image/video preview URL for an asset file or a folder child.
 * @param {string} assetId
 * @param {string} [fileId]
 * @param {string} [subPath]
 */
export function previewUrl(assetId, fileId = '', subPath = '') {
  const query = new URLSearchParams({ id: assetId })
  if (fileId) query.set('file', fileId)
  if (subPath !== '') query.set('path', subPath)
  return `/omnimux/assets/library/preview?${query}`
}

/**
 * Ask the Host to show one library entry in the platform file manager.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} [subPath]
 */
export function revealAssetEntry(assetId, fileId, subPath = '') {
  return assetsRequest('/omnimux/assets/library/reveal', {
    method: 'POST',
    body: { id: assetId, file: fileId, path: subPath },
  })
}

/**
 * Read a managed text document and its header metadata.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} [subPath]
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function readAssetText(assetId, fileId, subPath = '', opts = {}) {
  const query = new URLSearchParams({ id: assetId, file: fileId })
  if (subPath !== '') query.set('path', subPath)
  const result = await assetsTextRequest(`/omnimux/assets/library/text?${query}`, opts)
  if (!result.ok) {
    return { ok: false, status: result.status, body: result.body }
  }
  const h = result.headers
  return {
    ok: true,
    status: result.status,
    content: result.text,
    etag: h.get('etag') || '',
    editable: h.get('x-asset-text-editable') !== 'false',
    mtime: h.get('x-asset-text-mtime') || '',
    size: Number(h.get('x-asset-text-size')) || result.text.length,
    name: safeDecodeHeader(h.get('x-asset-text-name') || ''),
    relativePath: safeDecodeHeader(h.get('x-asset-text-path') || ''),
    ext: h.get('x-asset-text-ext') || '',
    isMarkdown: h.get('x-asset-text-markdown') === 'true',
  }
}

/**
 * Save UTF-8 content back to the asset's managed copy.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} [subPath]
 * @param {{ content: string, expectedEtag?: string, force?: boolean }} [payload]
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function saveAssetText(assetId, fileId, subPath = '', payload = { content: '' }, opts = {}) {
  return assetsRequest('/omnimux/assets/library/text', {
    method: 'POST',
    body: {
      id: assetId,
      file: fileId,
      path: subPath,
      content: payload.content,
      expectedEtag: payload.expectedEtag,
      force: payload.force === true,
    },
    signal: opts.signal,
  })
}

/**
 * List metadata-only version snapshots for a managed text file.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} [subPath]
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function listAssetTextVersions(assetId, fileId, subPath = '', opts = {}) {
  const query = new URLSearchParams({ id: assetId, file: fileId })
  if (subPath !== '') query.set('path', subPath)
  return assetsRequest(`/omnimux/assets/library/text/versions?${query}`, opts)
}

/**
 * Fetch the raw UTF-8 content of one snapshot for diffing or preview.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} subPath
 * @param {string} versionId
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function readAssetTextVersion(assetId, fileId, subPath, versionId, opts = {}) {
  const query = new URLSearchParams({ id: assetId, file: fileId, versionId })
  if (subPath !== '') query.set('path', subPath)
  const result = await assetsTextRequest(`/omnimux/assets/library/text/version?${query}`, opts)
  if (!result.ok) {
    return { ok: false, status: result.status, body: result.body }
  }
  const h = result.headers
  return {
    ok: true,
    status: result.status,
    content: result.text,
    id: h.get('x-asset-version-id') || versionId,
    name: safeDecodeHeader(h.get('x-asset-version-name') || ''),
    timestamp: Number(h.get('x-asset-version-timestamp')) || 0,
    source: h.get('x-asset-version-source') || 'manual',
  }
}

/**
 * Create a named version snapshot.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} subPath
 * @param {{ name?: string, content: string, source?: string }} payload
 */
export function createAssetTextVersion(assetId, fileId, subPath, payload) {
  return assetsRequest('/omnimux/assets/library/text/versions', {
    method: 'POST',
    body: {
      id: assetId,
      file: fileId,
      path: subPath,
      name: payload.name,
      content: payload.content,
      source: payload.source,
    },
  })
}

/**
 * Revert the managed file to a stored snapshot and log a revert record.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} subPath
 * @param {{ versionId: string, expectedEtag?: string, force?: boolean }} payload
 */
export function revertAssetTextVersion(assetId, fileId, subPath, payload) {
  return assetsRequest('/omnimux/assets/library/text/versions/revert', {
    method: 'POST',
    body: {
      id: assetId,
      file: fileId,
      path: subPath,
      versionId: payload.versionId,
      expectedEtag: payload.expectedEtag,
      force: payload.force === true,
    },
  })
}

/**
 * Delete a stored version snapshot.
 * @param {string} assetId
 * @param {string} fileId
 * @param {string} subPath
 * @param {string} versionId
 */
export function deleteAssetTextVersion(assetId, fileId, subPath, versionId) {
  return assetsRequest('/omnimux/assets/library/text/versions/delete', {
    method: 'POST',
    body: {
      id: assetId,
      file: fileId,
      path: subPath,
      versionId,
    },
  })
}

/**
 * @param {string} id
 */
export function rescanMapping(id) {
  return assetsRequest('/omnimux/assets/mappings/rescan', { method: 'POST', body: { id } })
}

/**
 * @param {string} id
 * @param {string} [subPath] relative sub directory for drill-down ('' = root)
 */
export function listFiles(id, subPath = '') {
  const query = new URLSearchParams({ id })
  if (subPath !== '') query.set('path', subPath)
  return assetsRequest(`/omnimux/assets/mappings/files?${query}`)
}

/**
 * @param {string} [type]
 * @param {number | undefined} [arev]
 */
export function listArtifacts(type, arev) {
  const query = new URLSearchParams()
  if (type) query.set('type', type)
  if (Number.isFinite(/** @type {number} */ (arev))) query.set('arev', String(arev))
  const suffix = query.toString() ? `?${query}` : ''
  return assetsRequest(`/omnimux/assets/artifacts${suffix}`)
}

/**
 * @param {string} id
 */
export function artifactDetail(id) {
  return assetsRequest(`/omnimux/assets/artifacts/detail?id=${encodeURIComponent(id)}`)
}

/**
 * Direct stream preview URL for a generated artifact.
 * @param {string} id
 */
export function artifactPreviewUrl(id) {
  return `/omnimux/assets/artifacts/preview?id=${encodeURIComponent(id)}`
}

// ---------------------------------------------------------------------------
// cloud assets — a prebuilt static catalog: pages from the gateway, media and
// writes through the local Host
// ---------------------------------------------------------------------------

/**
 * Total control file: categories, sub-categories, and per-scope page counts.
 * @param {{ force?: boolean }} [options] `force` re-probes the gateway, for a
 *   manual refresh after the network changed.
 */
export async function cloudManifest(options = {}) {
  const base = await resolveCloudBase(options)
  return assetsRequest(cloudManifestUrl(base))
}

/**
 * One page of cloud assets. `scope` is `category` or `category/sub_category`;
 * pages are zero-based and 24 rows each.
 * @param {string} scope
 * @param {number} page
 */
export async function cloudPage(scope, page) {
  const base = await resolveCloudBase()
  const url = cloudPageUrl(base, scope, page)
  return defaultRequestCoalescer.coalesce(url, () => assetsRequest(url))
}

/**
 * Catalog-wide search. Only called from the search box, never while paging.
 *
 * Always answered by the Host, even when the pages come from the gateway: search
 * scans the flat `index.json` that only the Host has loaded, so there is one
 * implementation instead of two that could disagree.
 *
 * `dims` carries the 角色 filter bar's selection. The search box narrows what the
 * chips already narrowed, so a row outside the selected dimensions is never a
 * match however well its name fits the query.
 * @param {{ q: string, category?: string, subCategory?: string, dims?: string[], limit?: number, offset?: number }} query
 */
export function cloudSearch(query) {
  const params = new URLSearchParams()
  params.set('q', query.q)
  if (query.category) params.set('category', query.category)
  if (query.subCategory) params.set('sub_category', query.subCategory)
  for (const token of query.dims ?? []) params.append('dims', token)
  if (Number.isFinite(query.limit)) params.set('limit', String(query.limit))
  if (Number.isFinite(query.offset)) params.set('offset', String(query.offset))
  return assetsRequest(`/omnimux/assets/cloud/search?${params}`)
}

/**
 * One page of 角色 rows filtered by the eight professional dimensions.
 *
 * Like search, this is always the Host: the dimensions describe thousands of
 * combinations, so there is no shard set to point a gateway at and the index the
 * Host holds is the only place the query can be answered. The envelope is the
 * same one a page shard carries, so the pager treats both the same way.
 * @param {{ tokens: string[], limit?: number, offset?: number }} query
 */
export function cloudFilter(query) {
  const params = new URLSearchParams()
  for (const token of query.tokens ?? []) params.append('dims', token)
  if (Number.isFinite(query.limit)) params.set('limit', String(query.limit))
  if (Number.isFinite(query.offset)) params.set('offset', String(query.offset))
  const url = `/omnimux/assets/cloud/filter?${params}`
  return defaultRequestCoalescer.coalesce(url, () => assetsRequest(url))
}

/**
 * Read-only preview URL for a cloud asset. `which=cover` asks for the thumbnail,
 * `which=media` for the playable original.
 * @param {string} id
 * @param {'media' | 'cover'} [which]
 */
export function cloudMediaUrl(id, which = 'media') {
  const params = new URLSearchParams({ id, which })
  return `/omnimux/assets/cloud/media?${params}`
}

/**
 * Copy one cloud asset into the local library so it appears under the local tab.
 * @param {string} id
 * @param {{ name?: string, type?: string }} [options]
 */
export function cloudSaveToLocal(id, options = {}) {
  return assetsRequest('/omnimux/assets/cloud/save', { method: 'POST', body: { id, ...options } })
}
