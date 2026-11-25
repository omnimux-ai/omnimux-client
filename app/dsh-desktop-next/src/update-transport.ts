/** Installer transport: Chromium `net.request` follows redirects one hop at a time with HTTPS enforcement. */
import { Readable } from 'node:stream'
import { net, session } from 'electron'
import { assertSecureHttpsUrl } from './omnimux-updater/manifest.ts'
import type { UpdateArtifactRequest, UpdateArtifactResponse } from './omnimux-updater/types.ts'

/** Redirect hops accepted before the transport reports a loop. */
const MAX_REDIRECTS = 8

/**
 * Non-persistent partition for installer traffic. It starts with an empty
 * cookie jar and stores nothing (`credentials: 'omit'`).
 */
export const UPDATE_PARTITION = 'omnimux-update'

/** HTTP statuses whose Response must be constructed without a body stream. */
const NULL_BODY_STATUSES = new Set([204, 205, 304])

/**
 * Build the artifact transport for installer downloads.
 *
 * `net.fetch` cannot follow redirects manually, whereas `net.request` emits a
 * `redirect` event so every hop passes through HTTPS validation and only Range /
 * If-Range headers are forwarded to redirect targets.
 */
export function createArtifactRequest(): UpdateArtifactRequest {
  return (url, init) => requestArtifact(url, init)
}

function requestArtifact(url: string, init: RequestInit): Promise<UpdateArtifactResponse> {
  return new Promise<UpdateArtifactResponse>((resolve, reject) => {
    const signal = init.signal ?? undefined
    let current: Electron.ClientRequest | undefined
    let hops = 0
    let settled = false

    const release = (): void => { signal?.removeEventListener('abort', onAbort) }
    const finish = (value: UpdateArtifactResponse): void => {
      if (settled) return
      settled = true
      release()
      resolve(value)
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      release()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    function onAbort(): void {
      const request = current
      current = undefined
      fail(Object.assign(new Error('The update download was cancelled.'), { name: 'AbortError' }))
      try { request?.abort() } catch { /* already finished */ }
    }
    if (signal?.aborted === true) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })

    const open = (target: string): void => {
      if (settled) return
      let secure: URL
      try { secure = assertSecureHttpsUrl(target) } catch { fail(new Error('Update downloads must settle on HTTPS without credentials')); return }
      if (hops >= MAX_REDIRECTS) { fail(new Error('Too many update redirects')); return }
      hops += 1

      const headers = new Headers(hops === 1 ? init.headers : { Accept: 'application/octet-stream' })
      if (hops > 1 && init.headers !== undefined) {
        const initialHeaders = new Headers(init.headers)
        const range = initialHeaders.get('range')
        const ifRange = initialHeaders.get('if-range')
        if (range !== null) headers.set('range', range)
        if (ifRange !== null) headers.set('if-range', ifRange)
      }
      headers.set('cache-control', 'no-cache')

      const request = net.request({
        url: secure.href,
        method: 'GET',
        redirect: 'manual',
        session: session.fromPartition(UPDATE_PARTITION),
      })
      current = request
      headers.forEach((value, key) => request.setHeader(key, value))
      let closing = false

      request.on('redirect', (_status, _method, redirectUrl) => {
        closing = true
        try { request.abort() } catch { /* already released */ }
        let next: string
        try { next = new URL(redirectUrl, secure.href).href } catch { fail(new Error('Update redirect has no usable location')); return }
        open(next)
      })
      request.on('response', incoming => {
        if (settled) return
        const status = incoming.statusCode
        if (status === undefined) { fail(new Error('The update download response carried no HTTP status.')); return }
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item)
        }
        try {
          finish({
            response: new Response(
              NULL_BODY_STATUSES.has(status)
                ? null
                : Readable.toWeb(incoming as unknown as Readable) as unknown as ReadableStream<Uint8Array>,
              { status, headers: responseHeaders },
            ),
            finalUrl: secure.href,
          })
        } catch (error) { fail(error) }
      })
      request.on('abort', () => {
        if (!closing && !settled) fail(new Error('The update download request was aborted.'))
      })
      request.on('error', error => fail(error))
      request.end()
    }

    open(url)
  })
}
