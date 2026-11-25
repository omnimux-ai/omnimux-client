import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PIBROWSE_TOOL_NAMES } from './constants.js'
import { createConfigStore } from './config-store.js'
import { createPibrowseDispatcher } from './dispatcher.js'
import { assertLocalWrite, createHttpHandler, sendJson } from './http-routes.js'
import { apply } from './index.js'
import { createInstaller } from './installer.js'
import { createMcpBridge } from './mcp-bridge.js'
import { resolvePibrowsePaths } from './paths.js'
import { redactAny } from './redact.js'
import { createTeamClient } from './team-client.js'

test('all 8 pibrowse_* tools register cleanly, return lossless JSON offline, and enforce confirm: true guards', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-tools-'))
  try {
    const tools = new Map()
    const effects = []
    const ctx = {
      logger: { info() {}, warn() {} },
      tools: {
        register(def) {
          tools.set(def.name, def)
          return () => tools.delete(def.name)
        },
        list() {
          return [...tools.values()]
        },
      },
      effect(fn) {
        const d = fn()
        if (typeof d === 'function') effects.push(d)
      },
      inject() {},
    }

    apply(ctx, {
      rootDir: tmp,
      socketDir: tmp,
      platform: 'linux',
      arch: 'x64',
      autoRegisterMcp: false,
    })

    assert.deepEqual([...tools.keys()].sort(), [...PIBROWSE_TOOL_NAMES].sort())

    // Status tool works fast offline and produces lossless JSON
    const status = await tools.get('pibrowse_runtime_status').execute({})
    assert.equal(status.ok, true)
    assert.equal(status.platform.prebuiltSupported, false)
    assert.deepEqual(JSON.parse(JSON.stringify(status)), status)

    // Destructive guards refuse when confirm is omitted or false
    const delProxy = await tools.get('pibrowse_delete_proxy').execute({ proxyId: 'px-1' })
    assert.equal(delProxy.ok, false)
    assert.equal(delProxy.error, 'confirmation-required')

    const clearCache = await tools.get('pibrowse_manage_runtime').execute({ action: 'clear_cache' })
    assert.equal(clearCache.ok, false)
    assert.equal(clearCache.error, 'confirmation-required')

    const purgeProf = await tools.get('pibrowse_manage_profiles').execute({ action: 'purge', profileId: 'p1' })
    assert.equal(purgeProf.ok, false)
    assert.equal(purgeProf.error, 'confirmation-required')

    const disconnectTeam = await tools.get('pibrowse_team_sync').execute({ action: 'disconnect' })
    assert.equal(disconnectTeam.ok, false)
    assert.equal(disconnectTeam.error, 'confirmation-required')

    for (const d of effects.reverse()) d()
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('HTTP routes & dispatcher scrub proxy passwords, block cross-site writes, and prevent deleting referenced proxies', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-http-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const deletedProxies = []
    const mockIpc = {
      async ping() {
        return { ok: true, info: { version: '0.5.5' } }
      },
      async call(method, params) {
        if (method === 'proxies.list') {
          return [
            {
              id: 'px-in-use',
              name: 'US-Res',
              scheme: 'socks5',
              host: 'us.proxy.example',
              port: 1080,
              username: 'alice',
              password: 'plaintext-secret-password-999',
              rotate_url: 'https://rotate.example/ip?key=top-secret-key',
            },
            {
              id: 'px-free',
              name: 'DE-Free',
              scheme: 'http',
              host: 'de.proxy.example',
              port: 8080,
            },
          ]
        }
        if (method === 'profiles.list') {
          return [{ id: 'pf-1', name: 'Store-1', proxy_id: 'px-in-use', proxy: { id: 'px-in-use', password: 'plaintext-secret-password-999' } }]
        }
        if (method === 'proxies.delete') {
          deletedProxies.push(params.id)
          return { deleted: params.id }
        }
        if (method === 'proxies.check') {
          throw new Error('dial failed for socks5://alice:inline-err-secret@us.proxy.example:1080')
        }
        if (method === 'geoip.status') return { loaded: false }
        return []
      },
    }
    const mockSidecar = {
      getStatus: () => ({ running: true, state: 'running', pid: 1234, recentLogs: [] }),
      start: async () => ({ running: true, state: 'running', pid: 1234 }),
      stop: async () => ({ running: false, state: 'stopped', pid: null }),
      restart: async () => ({ running: true, state: 'running', pid: 1234 }),
      dispose: async () => {},
    }
    const dispatcher = createPibrowseDispatcher({
      paths,
      configStore,
      ipcClient: mockIpc,
      installer: createInstaller({ paths, configStore }),
      sidecar: mockSidecar,
      mcpBridge: createMcpBridge({ paths, configStore, getMcpManager: () => null }),
      teamClient: createTeamClient({ paths, configStore, ipcClient: mockIpc }),
    })
    const http = createHttpHandler(dispatcher)

    // 1. Proxies list strips password & rotate_url while keeping boolean flags
    const pxRes = await http.dispatch({ method: 'GET', url: '/omnimux/pibrowse/proxies' })
    assert.equal(pxRes.status, 200)
    const serialized = JSON.stringify(pxRes.body)
    assert.equal(serialized.includes('plaintext-secret-password-999'), false)
    assert.equal(serialized.includes('top-secret-key'), false)
    assert.equal(pxRes.body.proxies[0].hasPassword, true)
    assert.equal(pxRes.body.proxies[0].hasRotateUrl, true)

    // 2. Deleting proxy referenced by active profile returns 409 proxy-in-use
    const inUseRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/proxies/delete',
      body: { proxyId: 'px-in-use', confirm: true },
    })
    assert.equal(inUseRes.status, 409)
    assert.equal(inUseRes.body.error, 'proxy-in-use')

    // 3. Deleting unreferenced proxy with confirm: true succeeds
    const freeRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/proxies/delete',
      body: { proxyId: 'px-free', confirm: true },
    })
    assert.equal(freeRes.status, 200)
    assert.deepEqual(deletedProxies, ['px-free'])

    // 4. Cross-site, same-site, and cross-port localhost writes blocked with 403
    assert.throws(
      () => assertLocalWrite({ origin: 'https://evil.example', secFetchSite: 'cross-site' }),
      (err) => err.code === 'not-local',
    )
    assert.throws(
      () => assertLocalWrite({ host: '127.0.0.1:45120', origin: 'http://127.0.0.1:9999', secFetchSite: 'same-site' }),
      (err) => err.code === 'not-local',
    )
    assert.throws(
      () => assertLocalWrite({ host: '127.0.0.1:45120', origin: 'http://127.0.0.1:9999' }),
      (err) => err.code === 'not-local',
    )
    assert.doesNotThrow(() =>
      assertLocalWrite({ host: '127.0.0.1:45120', origin: 'http://127.0.0.1:45120', secFetchSite: 'same-origin' }),
    )

    // 5. Error messages containing inline proxy URL credentials are redacted in HTTP responses
    const errRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/proxies/check',
      body: { proxyId: 'px-in-use', action: 'check' },
    })
    assert.equal(errRes.status, 500)
    assert.equal(JSON.stringify(errRes.body).includes('inline-err-secret'), false)
    assert.ok(errRes.body.message.includes('alice:***@'))

    // 6. CamelCase secret keys are scrubbed by redactAny
    const scrubbed = redactAny({
      sessionToken: 'tok-abc',
      wrappedOrk: 'ork-blob',
      rotateUrl: 'https://rotate.example/x?k=1',
      safe: 'keep',
    })
    assert.equal('sessionToken' in scrubbed, false)
    assert.equal('wrappedOrk' in scrubbed, false)
    assert.equal('rotateUrl' in scrubbed, false)
    assert.equal(scrubbed.hasRotateUrl, true)
    assert.equal(scrubbed.safe, 'keep')

    // 7. sendJson secret guard blocks leaked API keys and inline proxy credentials
    let writtenStatus = 0
    let writtenBody = ''
    const syntheticKey = `${'sk'}-${'0000testguard1234567890'}`
    sendJson(
      {
        writeHead(code) { writtenStatus = code },
        end(txt) { writtenBody = txt },
      },
      200,
      { leak: syntheticKey },
    )
    assert.equal(writtenStatus, 500)
    assert.equal(writtenBody.includes('testguard'), false)

    writtenStatus = 0
    writtenBody = ''
    sendJson(
      {
        writeHead(code) { writtenStatus = code },
        end(txt) { writtenBody = txt },
      },
      200,
      { url: 'socks5://u:plainpass123@proxy.example:1080' },
    )
    assert.equal(writtenStatus, 500)
    assert.equal(writtenBody.includes('plainpass123'), false)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
