import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPairingRoutes } from '../src/pairing-routes.ts'
import { pairingPageHtml, pairingRequestAllowed } from '../src/pairing.ts'
import { isLoopbackAddress } from '../src/server.ts'

const TOKEN = 'test-bridge-token-0123456789abcdef'

async function startPairingServer(authorizeHost?: (req: { headers: Record<string, unknown> }) => 401 | 403 | 503 | undefined) {
  let port = 0
  const routes = createPairingRoutes({
    port: () => port,
    token: () => TOKEN,
    isLoopback: isLoopbackAddress,
    ...(authorizeHost ? { authorizeHost: authorizeHost as never } : {}),
  })
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = routes.find((r) => r.kind === 'exact' && r.path === url.pathname)
    if (!route) { res.writeHead(404).end('not found'); return }
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  port = (server.address() as AddressInfo).port
  return { server, port, base: `http://127.0.0.1:${port}`, routes }
}

describe('pairing route Host session auth, anti-CSRF, and clickjacking protection (issue #366)', () => {
  let active: Awaited<ReturnType<typeof startPairingServer>>

  beforeAll(async () => {
    active = await startPairingServer((req) => (req.headers.cookie === 'dsh=valid' ? undefined : 401))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => { active.server.close(() => { resolve() }) })
  })

  it('marks /ext/pair, /ext/pair/approve, and /ext/pair/cancel as auth: required', () => {
    const byPath = new Map(active.routes.map((r) => [r.path, r.auth]))
    expect(byPath.get('/ext/pair')).toBe('required')
    expect(byPath.get('/ext/pair/approve')).toBe('required')
    expect(byPath.get('/ext/pair/cancel')).toBe('required')
    expect(byPath.get('/ext/pair/request')).toBe('anonymous')
    expect(byPath.get('/ext/pair/status')).toBe('anonymous')
  })

  it('rejects unauthenticated requests to /ext/pair, /ext/pair/approve, and /ext/pair/cancel with 401', async () => {
    const created = await (await fetch(`${active.base}/ext/pair/request`, { method: 'POST' })).json() as { requestId: string }

    const unauthPage = await fetch(`${active.base}/ext/pair?request=${encodeURIComponent(created.requestId)}`)
    expect(unauthPage.status).toBe(401)

    const unauthApprove = await fetch(`${active.base}/ext/pair/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: active.base },
      body: JSON.stringify({ requestId: created.requestId, csrfToken: 'anything' }),
    })
    expect(unauthApprove.status).toBe(401)

    const unauthCancel = await fetch(`${active.base}/ext/pair/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: active.base },
      body: JSON.stringify({ requestId: created.requestId, csrfToken: 'anything' }),
    })
    expect(unauthCancel.status).toBe(401)
  })

  it('requires valid per-request CSRF token and emits anti-clickjacking headers on /ext/pair', async () => {
    const created = await (await fetch(`${active.base}/ext/pair/request`, { method: 'POST' })).json() as { requestId: string }

    const pageRes = await fetch(`${active.base}/ext/pair?request=${encodeURIComponent(created.requestId)}`, {
      headers: { cookie: 'dsh=valid' },
    })
    expect(pageRes.status).toBe(200)
    expect(pageRes.headers.get('x-frame-options')).toBe('DENY')
    expect(pageRes.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(pageRes.headers.get('x-content-type-options')).toBe('nosniff')
    const html = await pageRes.text()
    const csrf = /const csrfToken = "([^"]+)";/.exec(html)?.[1] ?? ''
    expect(csrf.length).toBeGreaterThanOrEqual(20)

    // Missing or wrong CSRF token must be rejected with 403 even with valid session cookie & same-origin
    const missingCsrf = await fetch(`${active.base}/ext/pair/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: active.base, cookie: 'dsh=valid' },
      body: JSON.stringify({ requestId: created.requestId }),
    })
    expect(missingCsrf.status).toBe(403)

    const wrongCsrf = await fetch(`${active.base}/ext/pair/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: active.base, cookie: 'dsh=valid' },
      body: JSON.stringify({ requestId: created.requestId, csrfToken: 'wrong-token-value' }),
    })
    expect(wrongCsrf.status).toBe(403)

    // Cross-site Sec-Fetch-Site must be rejected even with valid CSRF token
    const crossSite = await fetch(`${active.base}/ext/pair/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: active.base,
        cookie: 'dsh=valid',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ requestId: created.requestId, csrfToken: csrf }),
    })
    expect(crossSite.status).toBe(403)

    // Valid session + same-origin + bound CSRF token succeeds once
    const approved = await fetch(`${active.base}/ext/pair/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: active.base, cookie: 'dsh=valid' },
      body: JSON.stringify({ requestId: created.requestId, csrfToken: csrf }),
    })
    expect(approved.status).toBe(200)

    // Single-use CSRF token: replaying cancel/approve after decision must fail and cannot flip state
    const flipCancel = await fetch(`${active.base}/ext/pair/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: active.base, cookie: 'dsh=valid' },
      body: JSON.stringify({ requestId: created.requestId, csrfToken: csrf }),
    })
    expect(flipCancel.status).toBe(404)

    // After approval, /ext/pair must no longer re-emit a usable CSRF token
    const postApprovePage = await fetch(`${active.base}/ext/pair?request=${encodeURIComponent(created.requestId)}`, {
      headers: { cookie: 'dsh=valid' },
    })
    const postApproveHtml = await postApprovePage.text()
    expect(postApproveHtml).toContain('const csrfToken = "";')

    // Non-GET methods on /ext/pair/status must return 405 without consuming the approved token
    const headStatus = await fetch(`${active.base}/ext/pair/status?request=${encodeURIComponent(created.requestId)}`, {
      method: 'HEAD',
    })
    expect(headStatus.status).toBe(405)

    const status = await (await fetch(`${active.base}/ext/pair/status?request=${encodeURIComponent(created.requestId)}`)).json() as {
      state: string; token?: string
    }
    expect(status).toEqual({ state: 'approved', token: TOKEN })
  })

  it('escapes inline script breakout characters in pairingPageHtml and rejects Origin: null / cross-site requests', async () => {
    const html = pairingPageHtml('</script><script>alert(1)</script>', 'A<&>B', 'tok</script>')
    expect(html).not.toContain('</script><script>')
    expect(html).toContain('\\u003c/script\\u003e')

    expect(pairingRequestAllowed('127.0.0.1', 'null', isLoopbackAddress)).toBe(false)
    expect(pairingRequestAllowed('127.0.0.1', 'file://', isLoopbackAddress)).toBe(false)
    expect(pairingRequestAllowed('127.0.0.1', 'data:text/html,hi', isLoopbackAddress)).toBe(false)
    expect(pairingRequestAllowed('127.0.0.1', 'chrome-extension://abcdefghijklmnop', isLoopbackAddress)).toBe(true)

    const crossSiteReq = await fetch(`${active.base}/ext/pair/request`, {
      method: 'POST',
      headers: { origin: 'null', 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSiteReq.status).toBe(403)

    const sameSitePage = await fetch(`${active.base}/ext/pair?request=test`, {
      headers: { cookie: 'dsh=valid', 'sec-fetch-site': 'same-site' },
    })
    expect(sameSitePage.status).toBe(403)

    const headPage = await fetch(`${active.base}/ext/pair?request=test`, {
      method: 'HEAD',
      headers: { cookie: 'dsh=valid' },
    })
    expect(headPage.status).toBe(200)
    expect(await headPage.text()).toBe('')
  })

  it('fails closed with 503 when Host authorization service is absent or throws', async () => {
    const noAuth = await startPairingServer(undefined)
    try {
      const created = await (await fetch(`${noAuth.base}/ext/pair/request`, { method: 'POST' })).json() as { requestId: string }
      const page = await fetch(`${noAuth.base}/ext/pair?request=${encodeURIComponent(created.requestId)}`)
      expect(page.status).toBe(503)
      const approve = await fetch(`${noAuth.base}/ext/pair/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: noAuth.base },
        body: JSON.stringify({ requestId: created.requestId, csrfToken: 'x' }),
      })
      expect(approve.status).toBe(503)
    } finally {
      await new Promise<void>((resolve) => { noAuth.server.close(() => { resolve() }) })
    }
  })
})
