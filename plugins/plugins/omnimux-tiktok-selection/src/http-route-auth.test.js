import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { registerSelectionRoutes } from './http-routes.js'

function mockRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(text = '') { this.body = String(text) },
  }
}

describe('omnimux-tiktok-selection HTTP route Host session auth (issue #355)', () => {
  it('rejects unauthenticated requests with 401 and missing connection with 503', async () => {
    let route = null
    registerSelectionRoutes(
      { register(r) { route = r; return () => {} } },
      { getOverview: async () => ({ ok: true }) },
      undefined,
      { getConnection: () => ({ requestRejection: () => 401 }) },
    )
    assert.equal(route.auth, 'required')
    const res401 = mockRes()
    await route.handler({ method: 'GET', url: '/omnimux/tiktok-selection/overview', headers: {} }, res401)
    assert.equal(res401.status, 401)

    let routeMissing = null
    registerSelectionRoutes(
      { register(r) { routeMissing = r; return () => {} } },
      { getOverview: async () => ({ ok: true }) },
    )
    const res503 = mockRes()
    await routeMissing.handler({ method: 'GET', url: '/omnimux/tiktok-selection/overview', headers: {} }, res503)
    assert.equal(res503.status, 503)
  })
})
