import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { registerPluginRoutes } from '../plugins/http-routes.js'
import { registerAppsRoutes } from '../apps/http-routes.js'
import { registerAvatarRoutes } from '../avatar/routes.js'
import { registerComposerAttachmentRoutes } from './composer-attachments-http.js'
import { registerTemplatesRoutes } from '../templates/http.js'
import { registerSessionModelRoutes } from '../session/http.js'
import { createSessionModelPreference } from '../session/model-preference.js'
import { registerByokRoutes } from '../byok/http.js'
import { registerAgentRoutes } from '../agents/http.js'

function mockRes() {
  const res = {
    status: 0,
    headers: {},
    bodyText: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    writeHead(status, headers = {}) {
      this.status = status
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v
    },
    end(text = '') { this.bodyText = String(text) },
  }
  return res
}

function mockReq(method, url, body) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  stream.method = method
  stream.url = url
  // Omit Origin/Referer/Sec-Fetch-Site to simulate non-browser loopback or LAN-proxied clients.
  stream.headers = {}
  return stream
}

function captureRoutes(registerFn) {
  const routes = new Map()
  const webServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  registerFn(webServer)
  return routes
}

describe('omnimux hub HTTP route Host session auth (issue #355)', () => {
  const cases = [
    {
      name: 'POST /omnimux/plugins',
      path: '/omnimux/plugins',
      method: 'POST',
      url: '/omnimux/plugins',
      body: { spec: 'example-pkg' },
      mount: (ws, getConnection) => registerPluginRoutes(ws, { dispatch: () => ({ status: 200, body: { ok: true } }) }, { getConnection }),
    },
    {
      name: 'GET /omnimux/apps',
      path: '/omnimux/apps',
      method: 'GET',
      url: '/omnimux/apps',
      mount: (ws, getConnection) => registerAppsRoutes(ws, { dispatch: async () => ({ status: 200, body: { apps: [] } }) }, { getConnection }),
    },
    {
      name: 'GET /omnimux/avatar',
      path: '/omnimux/avatar',
      method: 'GET',
      url: '/omnimux/avatar',
      mount: (ws, getConnection) => registerAvatarRoutes(ws, { dispatch: async () => ({ status: 200, body: {} }) }, { getConnection }),
    },
    {
      name: 'POST /omnimux/composer/attachments/instantiate',
      path: '/omnimux/composer/attachments',
      method: 'POST',
      url: '/omnimux/composer/attachments/instantiate',
      body: { sessionId: 's1', assetIds: [] },
      mount: (ws, getConnection) => registerComposerAttachmentRoutes(ws, { dispatch: async () => ({ status: 200, body: { results: [] } }) }, { getConnection }),
    },
    {
      name: 'GET /omnimux/templates/creative',
      path: '/omnimux/templates',
      method: 'GET',
      url: '/omnimux/templates/creative',
      mount: (ws, getConnection) => registerTemplatesRoutes(ws, { dispatch: () => ({ status: 200, body: { items: [] } }) }, { getConnection }),
    },
    {
      name: 'POST /omnimux/session-model',
      path: '/omnimux/session-model',
      method: 'POST',
      url: '/omnimux/session-model',
      body: { sessionId: 's1', auto: true },
      mount: (ws, getConnection) => registerSessionModelRoutes(ws, { preference: createSessionModelPreference(), getConnection }),
    },
    {
      name: 'PUT /omnimux/byok/config',
      path: '/omnimux/byok/config',
      method: 'PUT',
      url: '/omnimux/byok/config',
      body: {},
      mount: (ws, getConnection) => registerByokRoutes(ws, { getConnection }),
    },
    {
      name: 'GET /omnimux/analysis/service',
      path: '/omnimux/analysis/service',
      method: 'GET',
      url: '/omnimux/analysis/service',
      mount: (ws, getConnection) => registerByokRoutes(ws, { getConnection }),
    },
    {
      name: 'PUT /omnimux/runtime/mode',
      path: '/omnimux/runtime/mode',
      method: 'PUT',
      url: '/omnimux/runtime/mode',
      body: { mode: 'official' },
      mount: (ws, getConnection) => registerByokRoutes(ws, { getConnection }),
    },
    {
      name: 'POST /omnimux/byok/test',
      path: '/omnimux/byok/test',
      method: 'POST',
      url: '/omnimux/byok/test',
      body: {},
      mount: (ws, getConnection) => registerByokRoutes(ws, { getConnection }),
    },
    {
      name: 'GET /omnimux/agents',
      path: '/omnimux/agents',
      method: 'GET',
      url: '/omnimux/agents',
      mount: (ws, getConnection) => registerAgentRoutes(ws, { scan: async () => [], getConnection }),
    },
    {
      name: 'POST /omnimux/agents/update',
      path: '/omnimux/agents/update',
      method: 'POST',
      url: '/omnimux/agents/update',
      body: { id: 'claude' },
      mount: (ws, getConnection) => registerAgentRoutes(ws, { getConnection }),
    },
  ]

  for (const tc of cases) {
    it(`${tc.name} rejects unauthenticated headerless requests with 401 and missing connection with 503`, async () => {
      const deniedRoutes = captureRoutes(ws => tc.mount(ws, () => ({ requestRejection: () => 401 })))
      const route = deniedRoutes.get(tc.path)
      assert.equal(route.auth, 'required')
      const res401 = mockRes()
      await route.handler(mockReq(tc.method, tc.url, tc.body), res401)
      assert.equal(res401.status, 401)

      const missingRoutes = captureRoutes(ws => tc.mount(ws, undefined))
      const res503 = mockRes()
      await missingRoutes.get(tc.path).handler(mockReq(tc.method, tc.url, tc.body), res503)
      assert.equal(res503.status, 503)
    })
  }
})
