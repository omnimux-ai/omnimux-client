/**
 * The pairing HTTP surface: request → approve → status, plus the bare approval
 * page. Split out of `index.ts` so the routing stays readable and testable on
 * its own.
 *
 * Admission rules live in `pairing.ts`; this file only wires them to routes.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  BRIDGE_PAIR_PATH,
  BRIDGE_PAIR_APPROVE_PATH,
  BRIDGE_PAIR_CANCEL_PATH,
  BRIDGE_PAIR_REQUEST_PATH,
  BRIDGE_PAIR_STATUS_PATH,
} from './protocol.ts'
import { PairingRequests, pairingApprovalAllowed, pairingPageHtml, pairingRequestAllowed, shortCode } from './pairing.ts'

/** What the routes need from the host. */
export interface PairingRouteDeps {
  /** The host's own port, used for the approval-origin check and the page URL. */
  port: () => number
  /** The bridge token handed out once a request is approved. */
  token: () => string
  /** Loopback predicate (injected so tests can drive both sides). */
  isLoopback: (address: string | undefined) => boolean
  /**
   * Host session admission check (`connection.requestRejection`).
   * Fails closed with 503 when absent or throwing.
   */
  authorizeHost?: (req: IncomingMessage) => 401 | 403 | 503 | undefined
}

const NO_STORE = { 'cache-control': 'no-store' } as const
const PAGE_SECURITY_HEADERS = {
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const

/** Read one small JSON body; pairing payloads are ids and anti-CSRF tokens. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk as Buffer)
      size += buffer.length
      if (size > 2048) return null
      chunks.push(buffer)
    }
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', ...NO_STORE })
  res.end(JSON.stringify(body))
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE })
  res.end(body)
}

function hostRejectionStatus(deps: PairingRouteDeps, req: IncomingMessage): number | undefined {
  if (typeof deps.authorizeHost !== 'function') return 503
  try {
    const raw = deps.authorizeHost(req)
    if (raw === undefined) return undefined
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 403
  } catch {
    return 503
  }
}

function secFetchSiteAllowed(req: IncomingMessage): boolean {
  const raw = req.headers['sec-fetch-site']
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase()
  if (value === undefined || value === '') return true
  return value === 'same-origin' || value === 'none'
}

export type PairingWebRoute = WebRoute & { auth: 'anonymous' | 'required' }

/**
 * Build the pairing routes.
 *
 * @param deps - host port, token source, loopback predicate, and Host session guard.
 * @returns the routes to register on the host web server.
 */
export function createPairingRoutes(deps: PairingRouteDeps): PairingWebRoute[] {
  const requests = new PairingRequests()

  /** The page the user approves from; requires an authenticated Host session and embeds a one-time CSRF token. */
  const pageRoute: PairingWebRoute = {
    kind: 'exact',
    path: BRIDGE_PAIR_PATH,
    auth: 'required',
    handler: (req, res) => {
      const rejection = hostRejectionStatus(deps, req)
      if (rejection !== undefined) {
        sendText(res, rejection, rejection === 503 ? 'auth unavailable' : 'unauthorized')
        return
      }
      if (!pairingRequestAllowed(req.socket.remoteAddress, req.headers.origin, deps.isLoopback)) {
        sendText(res, 403, 'forbidden')
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'method not allowed')
        return
      }
      const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('request') ?? ''
      // A stale or unknown id still renders the page: the click then fails
      // closed, and the extension's next poll reports `unknown`.
      const live = requests.poll(id) === 'pending' || requests.poll(id) === 'approved'
      const csrfToken = live ? (requests.csrfTokenFor(id) ?? '') : ''
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...NO_STORE, ...PAGE_SECURITY_HEADERS })
      res.end(pairingPageHtml(live ? id : '', live ? shortCode(id) : '——————', csrfToken))
    },
  }

  const requestRoute: PairingWebRoute = {
    kind: 'exact',
    path: BRIDGE_PAIR_REQUEST_PATH,
    auth: 'anonymous',
    handler: (req, res) => {
      if (!pairingRequestAllowed(req.socket.remoteAddress, req.headers.origin, deps.isLoopback)) {
        sendText(res, 403, 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        sendText(res, 405, 'method not allowed')
        return
      }
      const request = requests.create()
      sendJson(res, 200, {
        requestId: request.id,
        code: shortCode(request.id),
        approveUrl: `http://127.0.0.1:${deps.port()}${BRIDGE_PAIR_PATH}?request=${encodeURIComponent(request.id)}`,
      })
    },
  }

  const approveRoute: PairingWebRoute = {
    kind: 'exact',
    path: BRIDGE_PAIR_APPROVE_PATH,
    auth: 'required',
    handler: (req, res) => {
      const rejection = hostRejectionStatus(deps, req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: rejection === 503 ? 'auth-unavailable' : 'unauthorized' })
        return
      }
      // Only the host's own authenticated page may approve: same-origin, loopback, and valid bound CSRF token.
      if (!secFetchSiteAllowed(req) || !pairingApprovalAllowed(req.socket.remoteAddress, req.headers.origin, deps.port(), deps.isLoopback)) {
        sendText(res, 403, 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        sendText(res, 405, 'method not allowed')
        return
      }
      void readJson(req).then((body) => {
        const id = typeof body?.requestId === 'string' ? body.requestId : ''
        const csrfToken = typeof body?.csrfToken === 'string' ? body.csrfToken : ''
        if (id === '') {
          sendJson(res, 404, { error: 'unknown-request' })
          return
        }
        const outcome = requests.approveWithCsrf(id, csrfToken)
        if (outcome === 'invalid-csrf') {
          sendJson(res, 403, { error: 'invalid-csrf' })
          return
        }
        if (outcome === 'unknown') {
          sendJson(res, 404, { error: 'unknown-request' })
          return
        }
        sendJson(res, 200, { approved: true })
      })
    },
  }

  const cancelRoute: PairingWebRoute = {
    kind: 'exact',
    path: BRIDGE_PAIR_CANCEL_PATH,
    auth: 'required',
    handler: (req, res) => {
      const rejection = hostRejectionStatus(deps, req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: rejection === 503 ? 'auth-unavailable' : 'unauthorized' })
        return
      }
      if (!secFetchSiteAllowed(req) || !pairingApprovalAllowed(req.socket.remoteAddress, req.headers.origin, deps.port(), deps.isLoopback)) {
        sendText(res, 403, 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        sendText(res, 405, 'method not allowed')
        return
      }
      void readJson(req).then((body) => {
        const id = typeof body?.requestId === 'string' ? body.requestId : ''
        const csrfToken = typeof body?.csrfToken === 'string' ? body.csrfToken : ''
        if (id === '') {
          sendJson(res, 404, { error: 'unknown-request' })
          return
        }
        const outcome = requests.cancelWithCsrf(id, csrfToken)
        if (outcome === 'invalid-csrf') {
          sendJson(res, 403, { error: 'invalid-csrf' })
          return
        }
        if (outcome === 'unknown') {
          sendJson(res, 404, { error: 'unknown-request' })
          return
        }
        sendJson(res, 200, { cancelled: true })
      })
    },
  }

  const statusRoute: PairingWebRoute = {
    kind: 'exact',
    path: BRIDGE_PAIR_STATUS_PATH,
    auth: 'anonymous',
    handler: (req, res) => {
      if (!pairingRequestAllowed(req.socket.remoteAddress, req.headers.origin, deps.isLoopback)) {
        sendText(res, 403, 'forbidden')
        return
      }
      const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('request') ?? ''
      const state = requests.poll(id)
      if (state === 'cancelled') {
        requests.consume(id)
        sendJson(res, 200, { state })
        return
      }
      if (state === 'approved') {
        // Single delivery: the id is spent the moment the token leaves the host.
        requests.consume(id)
        sendJson(res, 200, { state, token: deps.token() })
        return
      }
      sendJson(res, 200, { state })
    },
  }

  return [pageRoute, requestRoute, approveRoute, cancelRoute, statusRoute]
}
