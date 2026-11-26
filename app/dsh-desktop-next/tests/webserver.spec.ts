import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { configureNextBrowserAccess } from '../src/desktop-browser-access.ts'
import NextWebServer from '../src/webserver.ts'
import type { WebRegistration } from '../src/upstream-family.ts'

const RENDERER_TOKEN = Buffer.alloc(32, 9).toString('base64url')
const contexts: Context[] = []

afterEach(async () => {
  configureNextBrowserAccess(undefined, false)
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
})

async function startNextWebServer(options: {
  ordinaryBrowserEnabled?: boolean
  requestRejection?: (request: { readonly headers: Record<string, unknown> }) => 401 | 403 | undefined
} = {}): Promise<NextWebServer> {
  configureNextBrowserAccess(RENDERER_TOKEN, options.ordinaryBrowserEnabled ?? true)
  const context = new Context()
  contexts.push(context)
  if (options.requestRejection !== undefined) {
    context.provide('connection', {
      requestRejection: options.requestRejection,
    } as never)
  }
  await context.plugin(NextWebServer, { host: '127.0.0.1', port: 0 })
  const server = context.get('webServer')
  if (!(server instanceof NextWebServer)) throw new Error('NextWebServer did not start')
  return server
}

async function requestUpgrade(port: number, path: string, headers: Readonly<Record<string, string>> = {}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let response = ''
    socket.setTimeout(2_000)
    socket.once('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${String(port)}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
      ].join('\r\n'))
    })
    socket.on('data', chunk => { response += chunk.toString('utf8') })
    socket.once('end', () => resolve(response))
    socket.once('error', reject)
    socket.once('timeout', () => { socket.destroy(); reject(new Error('upgrade timed out')) })
  })
}

describe('NextWebServer route.auth enforcement', () => {
  it('enforces connection.requestRejection for routes declaring auth: required even when browser access is enabled', async () => {
    let calls = 0
    const server = await startNextWebServer({
      ordinaryBrowserEnabled: true,
      requestRejection: req => req.headers.cookie === 'dsh=valid' ? undefined : 401,
    })
    server.register({
      kind: 'exact',
      path: '/omnimux/protected',
      auth: 'required',
      handler: (_req, res) => {
        calls += 1
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('ok')
      },
    } as WebRegistration)

    const unauth = await fetch(`http://127.0.0.1:${String(server.port)}/omnimux/protected`, { method: 'POST' })
    expect(unauth.status).toBe(401)
    expect(calls).toBe(0)

    const authed = await fetch(`http://127.0.0.1:${String(server.port)}/omnimux/protected`, {
      method: 'POST',
      headers: { cookie: 'dsh=valid' },
    })
    expect(authed.status).toBe(200)
    expect(await authed.text()).toBe('ok')
    expect(calls).toBe(1)
  })

  it('fails closed with 503 on auth: required routes when connection service is absent', async () => {
    const server = await startNextWebServer({ ordinaryBrowserEnabled: true })
    server.register({
      kind: 'exact',
      path: '/omnimux/no-conn',
      auth: 'required',
      handler: (_req, res) => { res.end('should-not-run') },
    } as WebRegistration)

    const response = await fetch(`http://127.0.0.1:${String(server.port)}/omnimux/no-conn`)
    expect(response.status).toBe(503)
  })

  it('rejects auth: deny routes with 403 even with valid session credentials', async () => {
    const server = await startNextWebServer({
      ordinaryBrowserEnabled: true,
      requestRejection: () => undefined,
    })
    server.register({
      kind: 'exact',
      path: '/omnimux/denied',
      auth: 'deny',
      handler: (_req, res) => { res.end('should-not-run') },
    } as WebRegistration)

    const response = await fetch(`http://127.0.0.1:${String(server.port)}/omnimux/denied`)
    expect(response.status).toBe(403)
  })

  it('allows auth: anonymous and unannotated routes without forcing connection.requestRejection', async () => {
    const server = await startNextWebServer({
      ordinaryBrowserEnabled: true,
      requestRejection: () => 401,
    })
    server.register({
      kind: 'exact',
      path: '/ext/public',
      auth: 'anonymous',
      handler: (_req, res) => { res.end('anon-ok') },
    } as WebRegistration)
    server.register({
      kind: 'exact',
      path: '/upstream-public',
      handler: (_req, res) => { res.end('upstream-ok') },
    })

    const anon = await fetch(`http://127.0.0.1:${String(server.port)}/ext/public`)
    expect(anon.status).toBe(200)
    expect(await anon.text()).toBe('anon-ok')

    const upstream = await fetch(`http://127.0.0.1:${String(server.port)}/upstream-public`)
    expect(upstream.status).toBe(200)
    expect(await upstream.text()).toBe('upstream-ok')
  })

  it('enforces auth: required on resource routes and upgrade routes', async () => {
    const server = await startNextWebServer({
      ordinaryBrowserEnabled: true,
      requestRejection: req => req.headers.cookie === 'dsh=valid' ? undefined : 401,
    })
    server.register({
      kind: 'exact',
      path: '/omnimux/resource',
      auth: 'required',
      resource: async () => new Response('resource-ok', { status: 200 }),
    } as WebRegistration)
    server.registerUpgrade({
      path: '/omnimux/ws',
      auth: 'required',
      handler: (_req, socket) => {
        socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      },
    } as Parameters<NextWebServer['registerUpgrade']>[0])

    const unauthRes = await fetch(`http://127.0.0.1:${String(server.port)}/omnimux/resource`)
    expect(unauthRes.status).toBe(401)

    const authedRes = await fetch(`http://127.0.0.1:${String(server.port)}/omnimux/resource`, {
      headers: { cookie: 'dsh=valid' },
    })
    expect(authedRes.status).toBe(200)
    expect(await authedRes.text()).toBe('resource-ok')

    const unauthWs = await requestUpgrade(server.port!, '/omnimux/ws')
    expect(unauthWs).toMatch(/^HTTP\/1\.1 401 Unauthorized/u)

    const authedWs = await requestUpgrade(server.port!, '/omnimux/ws', { Cookie: 'dsh=valid' })
    expect(authedWs).toMatch(/^HTTP\/1\.1 101 Switching Protocols/u)
  })
})
