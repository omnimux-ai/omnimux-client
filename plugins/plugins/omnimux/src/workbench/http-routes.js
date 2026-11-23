/**
 * HTTP Routes for Agent-Workbench sync:
 * - POST /omnimux/workbench/viewport (client heartbeat)
 * - POST /omnimux/workbench/rpc/ack (RPC acknowledgement)
 */

import { requestRejection } from '../host/request-authorization.js'
import { readJsonBody, sendJson } from '../auth/http-routes.js'
import { WINDOW_PROOF_HEADER } from '../events/windows.js'

export function isLocalRequest(req) {
  const origin = req.headers?.origin || ''
  const referer = req.headers?.referer || ''
  const secFetchSite = req.headers?.['sec-fetch-site'] || ''

  if (secFetchSite === 'cross-site') return false

  const hostCandidate = origin || referer
  if (!hostCandidate) return true // local non-browser tool/curl

  try {
    const parsed = new URL(hostCandidate)
    const hostname = parsed.hostname.toLowerCase()
    return (
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}

export function registerWorkbenchHttpRoutes(webServer, deps) {
  if (!webServer || typeof webServer.register !== 'function') return () => {}
  const mailbox = deps.mailbox
  const disposers = []

  // Viewport Post: POST /omnimux/workbench/viewport
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/omnimux/workbench/viewport',
    auth: 'required',
    handler: async (req, res, peer) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      const rejection = requestRejection(req, deps.getConnection, peer)
      if (rejection !== undefined) return sendJson(res, rejection, { ok: false, error: 'request-denied' })

      const body = await readJsonBody(req)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid-json' })
        return
      }

      if (req.headers?.[WINDOW_PROOF_HEADER] !== undefined) {
        const accepted = await deps.hubEvents?.updateWindowViewport(req, body, deps.verifySession)
        if (!accepted) return sendJson(res, 403, { ok: false, error: 'window-not-authorized' })
      }
      // Routing hints belong to the authenticated window registry. The shared
      // workbench mailbox also backs a model tool and receives only its envelope.
      const envelope = { ...body }
      delete envelope.viewportDetails
      const result = mailbox.updateViewport(envelope)
      sendJson(res, result.ok ? 200 : 400, result)
    },
  }))

  // RPC Ack: POST /omnimux/workbench/rpc/ack
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/omnimux/workbench/rpc/ack',
    auth: 'required',
    handler: async (req, res, peer) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      const rejection = requestRejection(req, deps.getConnection, peer)
      if (rejection !== undefined) return sendJson(res, rejection, { ok: false, error: 'request-denied' })

      const body = await readJsonBody(req)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid-json' })
        return
      }

      const result = mailbox.handleRpcAck(body)
      sendJson(res, result.ok ? 200 : 400, result)
    },
  }))

  return () => {
    for (const d of disposers) {
      if (typeof d === 'function') d()
    }
  }
}
