import { createStore, delMany, get, getMany, keys, set, setMany, update } from 'idb-keyval'
import { safeClipLabel } from '../../errors.js'
import { mediaContentDigest } from '../../timeline/nativeProjectFields.js'
import { CLIP_API_PREFIX } from '../host/projectApi.js'

const TIMEOUT_MS = 3500
const draftKey = (projectId, writerId) => `draft:${projectId}:${writerId}`

export class LiveClipError extends Error {
  constructor(code, message, details) {
    super(message)
    this.code = code
    if (details) this.details = details
  }
}

export function liveError(error) {
  const fallback = 'The editor operation failed.'
  if (typeof error?.code !== 'string') return { code: 'EDIT_FAILED', message: fallback }
  const { currentRevision, operationIndex } = error.details ?? {}
  return {
    code: error.code,
    message: safeClipLabel(error.message, fallback),
    details: {
      ...(Number.isSafeInteger(currentRevision) ? { currentRevision } : {}),
      ...(Number.isSafeInteger(operationIndex) ? { operationIndex } : {}),
    },
  }
}

export async function requestClip(path, { fetcher = fetch, method = 'GET', body, headers, signal, timeout = TIMEOUT_MS } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeout)
  let response
  try {
    response = await fetcher(`${CLIP_API_PREFIX}${path}`, {
      method,
      redirect: 'error',
      headers: { ...(body === undefined || body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined || body instanceof Blob ? body : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    })
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (typeof error?.code === 'string') throw error
    throw new LiveClipError('EDITOR_OFFLINE', 'Clip Host is unreachable.')
  }
  if (response.ok) {
    if (response.status === 204) return null
    return response.json()
  }
  const payload = await response.json().catch(() => null)
  if ([502, 503, 504].includes(response.status)) throw new LiveClipError('EDITOR_OFFLINE', 'Clip Host is unreachable.')
  throw new LiveClipError(
    payload?.code ?? payload?.error?.code ?? payload?.error ?? (response.status === 404 ? 'not-found' : 'HOST_REQUEST_FAILED'),
    payload?.message ?? payload?.error?.message ?? `Clip Host returned HTTP ${response.status}.`,
    payload?.details ?? payload?.error?.details ?? (payload?.currentRevision !== undefined ? { currentRevision: payload.currentRevision } : undefined),
  )
}

function draftWriter(window) {
  const key = 'omnimux-clip:draft-writer'
  try {
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const id = crypto.randomUUID()
    window.sessionStorage.setItem(key, id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export function createClipPersistence(window) {
  const db = createStore('omnimux-clip-projects', 'drafts')
  const writerId = draftWriter(window)
  const projectPath = id => `/projects/${encodeURIComponent(id)}`
  const withWindow = async (path, init) => {
    const events = window.__omnimuxHubEvents
    const id = events?.getWindowId?.()
    if (!id || !events.windowFetch) throw new LiveClipError('EDITOR_OFFLINE', 'The Clip window is offline.')
    return events.windowFetch(path, init, id)
  }
  const studioKey = key => `omnimux-clip:studio:${key}`
  return {
    studioProject(key) {
      try { return window.sessionStorage.getItem(studioKey(key)) } catch { return null }
    },
    rememberStudioProject(key, projectId) {
      try { window.sessionStorage.setItem(studioKey(key), projectId) } catch (error) {
        console.debug('[Clip] Could not remember the current Studio project.', error.name)
      }
    },
    async readLocal(id) {
      const own = await get(draftKey(id, writerId), db)
      if (own) return own
      const prefix = `draft:${id}:`
      const candidates = (await keys(db)).filter(key => typeof key === 'string' && key.startsWith(prefix))
      const pending = (await Promise.all(candidates.map(key => get(key, db))))
        .filter(value => value && value.revision > value.localBaseRevision)
      // A cold restart can recover an unambiguous draft. Different editors keep independent versions.
      return pending.length === 1 ? pending[0] : null
    },
    writeLocal(record, receipt) {
      const key = draftKey(record.project.id, writerId)
      return receipt ? setMany([[key, record], [`receipt:${receipt.requestId}`, receipt]], db) : set(key, record, db)
    },
    backupLocal(record) {
      return set(`backup:${record.project.id}:${crypto.randomUUID()}`, record, db)
    },
    saveReceipt(requestId, receipt) {
      return set(`receipt:${requestId}`, receipt, db)
    },
    readReceipt(requestId) {
      return get(`receipt:${requestId}`, db)
    },
    markReceiptDelivered(requestId) {
      return update(`receipt:${requestId}`, value => value ? { ...value, delivered: true } : value, db)
    },
    async recoverReceipts(sessionId, cutoff) {
      const receiptKeys = (await keys(db)).filter(key => typeof key === 'string' && key.startsWith('receipt:'))
      const receipts = await getMany(receiptKeys, db)
      const expired = receiptKeys.filter((_, index) => !(receipts[index]?.createdAt >= cutoff))
      if (expired.length) await delMany(expired, db)
      return receipts.filter(receipt => receipt?.createdAt >= cutoff && receipt.sessionId === sessionId && !receipt.delivered)
    },
    readHost: async (id) => {
      try {
        return await requestClip(projectPath(id))
      } catch (error) {
        if (['not-found', 'project-not-materialized'].includes(error.code)) return null
        throw error
      }
    },
    async materialize(target) {
      await window.__omnimuxHubEvents?.pushViewport?.()
      return requestClip(`${projectPath(target.projectId)}/materialize`, {
        fetcher: withWindow, method: 'POST', body: { binding: target.binding, draftSchema: target.draftSchema, title: target.title },
      })
    },
    writeHost: (record, options = {}) => requestClip(projectPath(record.project.id), {
      ...(record.binding ? { fetcher: withWindow } : {}),
      method: 'PUT',
      body: {
        project: record.project,
        expectedRevision: options.expectedRevision ?? record.localBaseRevision,
        revision: options.revision ?? record.revision,
        binding: record.binding,
        ...(options.backupCurrent ? { backupCurrent: true } : {}),
      },
    }),
  }
}

function mediaVersion(item) {
  const source = item.omnimuxSource
  const ref = item.sourceRef
  const file = item.sourceFile
  return JSON.stringify([source?.id, source?.version, source?.digest, ref?.fingerprint, ref?.contentVersion,
    file?.name, file?.size, file?.lastModified, item.type, item.metadata?.fileSize])
}

export function fromHost(host, local) {
  const media = Object.create(null)
  if (local?.project.id === host.project.id) {
    const previous = new Map((local.project.mediaLibrary?.items ?? []).map(item => [item.id, item]))
    const sameSnapshot = local.project === host.project
      || (Number.isSafeInteger(host.revision) && local.revision === host.revision && local.localBaseRevision === host.revision)
    for (const item of host.project.mediaLibrary?.items ?? []) {
      const old = previous.get(item.id)
      const blob = local.media[item.id]
      if (!old || !(blob instanceof Blob) || !blob.size) continue
      // The loader checks the actual bytes against an explicit digest. Older
      // records can only reuse bytes from the same confirmed snapshot.
      if (mediaContentDigest(item) || (sameSnapshot && mediaVersion(old) === mediaVersion(item))) {
        media[item.id] = blob
      }
    }
  }
  return {
    project: host.project,
    binding: host.binding,
    revision: host.revision,
    localBaseRevision: host.revision,
    media,
    updatedAt: host.updatedAt,
  }
}

export function syncDisposition(local, host) {
  if (!local || local.revision <= local.localBaseRevision) return 'host'
  const remoteRevision = host?.revision ?? 0
  if (remoteRevision === local.localBaseRevision) return 'push'
  if (remoteRevision === local.revision) return 'retry'
  return 'conflict'
}
