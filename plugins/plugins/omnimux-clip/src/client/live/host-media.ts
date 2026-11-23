import { CLIP_API_PREFIX } from '../host/projectApi.js'
import { sha256Digest } from '../../timeline/nativeProjectFields.js'
import { verifiedMediaBlob } from './media-source'

export interface HostMediaFetchResult {
  ok: boolean
  status: number
  code?: string
  blob?: Blob
  digest?: string
}

function hubEvents() {
  return (globalThis as {
    __omnimuxHubEvents?: {
      getWindowId?: () => string | null | undefined
      windowFetch?: (url: string, init?: RequestInit, windowId?: string) => Promise<Response>
    }
  }).__omnimuxHubEvents
}

export function hasAuthenticatedClipHost(): boolean {
  const events = hubEvents()
  return Boolean(events?.getWindowId?.() && typeof events?.windowFetch === 'function')
}

function sameOriginFetch(path: string, init: RequestInit): Promise<Response> {
  const events = hubEvents()
  const windowId = events?.getWindowId?.()
  if (windowId && typeof events?.windowFetch === 'function') {
    return events.windowFetch(path, init, windowId)
  }
  return fetch(path, init)
}

/**
 * Fetch verified media bytes for a persisted project item from the Clip Host
 * (`/omnimux-clip/api/projects/:id/media/:mediaId/bytes`).
 *
 * When the authenticated same-origin Host returns `X-Content-SHA256`, the Host
 * has already performed 256 KiB block-level SHA-256 verification on disk, so
 * the browser does not have to read large videos into an ArrayBuffer in RAM.
 */
export async function fetchHostMediaBlob(
  projectId: string,
  mediaId: string,
  options: { expectedDigest?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HostMediaFetchResult> {
  const { expectedDigest, signal, timeoutMs = 45_000 } = options
  const url = `${CLIP_API_PREFIX}/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/bytes`
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const response = await sameOriginFetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    mode: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal: combined,
  })
  if (!response.ok) {
    let code: string | undefined
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = await response.json().catch((error: unknown) => {
        console.debug('[Clip] Could not parse media error payload.', (error as Error)?.name)
        return null
      }) as { error?: string; code?: string } | null
      code = body?.code ?? body?.error
    }
    return { ok: false, status: response.status, code }
  }
  const headerDigest = sha256Digest(response.headers.get('x-content-sha256') ?? undefined)
  if (expectedDigest && headerDigest && headerDigest !== expectedDigest) {
    return { ok: false, status: 409, code: 'media-version-mismatch' }
  }
  const blob = await response.blob()
  if (!blob.size || /^image\/svg/iu.test(blob.type)) {
    return { ok: false, status: 415, code: 'unsupported-media' }
  }
  if (expectedDigest && !headerDigest) {
    const verified = await verifiedMediaBlob(blob, expectedDigest)
    if (!verified) return { ok: false, status: 409, code: 'media-version-mismatch' }
  }
  return {
    ok: true,
    status: response.status,
    blob,
    digest: headerDigest ?? expectedDigest,
  }
}
