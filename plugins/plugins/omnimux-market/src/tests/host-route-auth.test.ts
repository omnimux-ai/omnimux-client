import assert from 'node:assert/strict'
import test from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { withDefaults } from '../config-store.js'
import { apply } from '../host.js'

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value },
    writeHead(status: number, headers: Record<string, string> = {}) {
      this.statusCode = status
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v
    },
    end(chunk?: string | Buffer) { this.body = chunk ? String(chunk) : '' },
  }
  return res
}

function mountHost(connection: { requestRejection?: (req: IncomingMessage) => unknown } | undefined) {
  const routes = new Map<string, { auth?: string; handler: (req: IncomingMessage, res: ServerResponse, peer?: unknown) => Promise<void> | void }>()
  const webServer = {
    register(route: { path: string; auth?: string; handler: (req: IncomingMessage, res: ServerResponse, peer?: unknown) => Promise<void> | void }) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const ctx = {
    webServer,
    get(name: string) {
      if (name === 'connection') return connection
      return undefined
    },
    inject(deps: string[], fn: (c: unknown) => void) {
      if (deps.length === 1 && deps[0] === 'webServer') fn(ctx)
    },
    effect() {},
    tools: { register() {} },
  }
  apply(ctx as never, withDefaults({}))
  return routes
}

test('omnimux-market enforces connection.requestRejection on /omnimux-market and /omnimux-market/icon', async () => {
  const denied = mountHost({ requestRejection: () => 401 })
  for (const path of ['/omnimux-market', '/omnimux-market/icon']) {
    const route = denied.get(path)
    assert.ok(route, `expected route ${path}`)
    assert.equal(route.auth, 'required')
    const res = mockRes()
    await route.handler({ method: 'POST', url: path, headers: {} } as IncomingMessage, res as unknown as ServerResponse)
    assert.equal(res.statusCode, 401)
  }

  const noConn = mountHost(undefined)
  for (const path of ['/omnimux-market', '/omnimux-market/icon']) {
    const res = mockRes()
    await noConn.get(path)!.handler({ method: 'GET', url: path, headers: {} } as IncomingMessage, res as unknown as ServerResponse)
    assert.equal(res.statusCode, 503)
  }
})
