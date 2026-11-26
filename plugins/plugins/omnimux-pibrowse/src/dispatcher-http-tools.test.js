import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('dispatcher normalizes upstream v0.5.5 Profile/Proxy/Extension/Reseed IPC payloads strictly', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-ipc-schema-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const calls = []
    const storedProfiles = new Map()
    const storedProxies = new Map()

    // Strict mirror of upstream v0.5.5 Rust serde required fields in agent/src/store.rs
    function assertRustProfileStruct(p, { allowEmptyPersona = false } = {}) {
      for (const field of ['id', 'name', 'notes', 'tags', 'persona_id', 'fp_seed', 'start_urls']) {
        assert.ok(field in p, `missing field \`${field}\``)
      }
      assert.equal(typeof p.id, 'string')
      assert.equal(typeof p.name, 'string')
      assert.equal(typeof p.notes, 'string')
      assert.ok(Array.isArray(p.tags))
      assert.equal(typeof p.persona_id, 'string')
      if (!allowEmptyPersona) assert.ok(p.persona_id.length > 0, 'persona_id must be non-empty for profiles.upsert')
      assert.equal(typeof p.fp_seed, 'number')
      assert.ok(Array.isArray(p.start_urls))
      assert.equal(p.proxy, null, 'profiles.upsert must use proxy_id and keep proxy null on write')
    }

    function assertRustProxyStruct(px) {
      for (const field of ['id', 'name', 'kind', 'host', 'port', 'username', 'password', 'last_country', 'last_ip', 'last_location']) {
        assert.ok(field in px, `missing field \`${field}\``)
      }
      assert.equal(typeof px.id, 'string')
      assert.equal(typeof px.kind, 'string')
      assert.equal(typeof px.port, 'number')
    }

    const mockIpc = {
      async ping() {
        return { ok: true, info: { version: '0.5.5' } }
      },
      async call(method, params) {
        calls.push({ method, params })
        if (method === 'personas.list') {
          return [
            { id: 'win11-iris-xe-1920x1080', os: 'Windows 11', screen: '1920x1080' },
            { id: 'macos-m3-1512x982', os: 'macOS 15', screen: '1512x982' },
          ]
        }
        if (method === 'profiles.list') {
          return [...storedProfiles.values()]
        }
        if (method === 'profiles.upsert') {
          assertRustProfileStruct(params)
          const id = params.id || `prof-${storedProfiles.size + 1}`
          const saved = { ...params, id, fp_seed: params.fp_seed || 424242 }
          storedProfiles.set(id, saved)
          return { id }
        }
        if (method === 'profiles.createMany') {
          assert.equal(typeof params.count, 'number')
          assert.ok(params.name_pattern.includes('{n}'))
          assertRustProfileStruct(params.template, { allowEmptyPersona: true })
          return { created: ['batch-1', 'batch-2'], failed: [] }
        }
        if (method === 'profiles.reseed') {
          assert.ok(params.id)
          return { id: params.id, fp_seed: 999999 }
        }
        if (method === 'profiles.randomize') {
          throw new Error('unknown method "profiles.randomize"')
        }
        if (method === 'proxies.list') {
          return [...storedProxies.values()]
        }
        if (method === 'proxies.upsert') {
          assertRustProxyStruct(params)
          const id = params.id || `px-${storedProxies.size + 1}`
          storedProxies.set(id, { ...params, id })
          return { id }
        }
        if (method === 'proxies.check') {
          return { ip: '1.2.3.4', country: 'US', url_checked: params.url }
        }
        if (method === 'extensions.list_all') {
          return [{ id: 'a'.repeat(32), name: 'TestExt', profiles: [{ id: 'prof-1' }] }]
        }
        if (method === 'extensions.remove') {
          assert.ok(params.profile_id, 'extensions.remove requires profile_id')
          assert.equal(params.id, 'a'.repeat(32))
          return { removed: true }
        }
        return []
      },
    }
    const mockSidecar = {
      getStatus: () => ({ running: true, state: 'running', pid: 4321, recentLogs: [] }),
      start: async () => ({ running: true, state: 'running', pid: 4321 }),
      stop: async () => ({ running: false, state: 'stopped', pid: null }),
      restart: async () => ({ running: true, state: 'running', pid: 4321 }),
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
      platform: 'darwin',
    })

    // 1. Minimal UI payload `{ name: 'TikTok01' }` creates valid Rust Profile with host-OS persona & allow_no_proxy
    const created = await dispatcher.upsertProfile({ name: 'TikTok01', start_url: 'https://tiktok.com' })
    assert.equal(created.ok, true)
    assert.equal(created.id, 'prof-1')
    assert.equal(created.profile.persona_id, 'macos-m3-1512x982')
    assert.equal(created.profile.allow_no_proxy, true)
    assert.deepEqual(created.profile.start_urls, ['https://tiktok.com'])

    // 2. Binding blocklists preserves existing full Profile fields rather than sending partial `{ id, blocklists }`
    const bound = await dispatcher.manageBlocklists({ action: 'bind', profileId: 'prof-1', blocklists: ['ads'] })
    assert.equal(bound.ok, true)
    assert.deepEqual(storedProfiles.get('prof-1').blocklists, ['ads'])
    assert.equal(storedProfiles.get('prof-1').name, 'TikTok01')

    // 3. Batch creation uses upstream profiles.createMany with full template
    const batch = await dispatcher.batchCreateProfiles({ prefix: 'Shop', count: 2 })
    assert.equal(batch.ok, true)
    assert.equal(batch.count, 2)

    // 4. rerandomize calls upstream profiles.reseed (not non-existent profiles.randomize)
    const reseeded = await dispatcher.manageProfiles({ action: 'rerandomize', profileId: 'prof-1' })
    assert.equal(reseeded.ok, true)
    assert.equal(calls.some((c) => c.method === 'profiles.reseed'), true)

    // 5. Proxy upsert maps scheme -> kind, preserves password when undefined, and checkProxy passes id + socks5 kind + checker_url
    const px = await dispatcher.upsertProxy({
      scheme: 'socks5',
      host: '10.0.0.2',
      port: 1080,
      name: 'S5',
      password: 'keep-me-secret',
      checker_url: 'https://custom-checker.example/json',
    })
    assert.equal(px.ok, true)
    await dispatcher.upsertProxy({ id: 'px-1', name: 'S5-Renamed', password: undefined })
    assert.equal(storedProxies.get('px-1').password, 'keep-me-secret', 'undefined password must preserve stored secret')

    const check = await dispatcher.checkProxy({ proxyId: 'px-1', action: 'check' })
    assert.equal(check.ok, true)
    const checkCall = calls.find((c) => c.method === 'proxies.check')
    assert.equal(checkCall.params.id, 'px-1', 'proxies.check must pass id so fury-agent persists exit IP/country/timezone')
    assert.equal(checkCall.params.checker_url, 'https://custom-checker.example/json')
    assert.ok(checkCall.params.url.startsWith('socks5://'))

    // 6. Extension remove resolves profile_id via extensions.list_all when omitted, and unsupported folder source fails clearly
    const rmExt = await dispatcher.manageExtensionsAndMirror({
      action: 'remove_extension',
      extensionId: 'a'.repeat(32),
      confirm: true,
    })
    assert.equal(rmExt.ok, true)
    await assert.rejects(
      () =>
        dispatcher.manageExtensionsAndMirror({
          action: 'install_extension',
          source: '/tmp/unpacked-ext',
        }),
      (err) => err.code === 'invalid-input',
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('Core missing launch error maps to 503 core-not-installed, configure_paths restarts sidecar, and install_core uses verified installer', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-core-flow-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp, platform: 'darwin' })
    await mkdir(paths.binDir, { recursive: true })
    await writeFile(paths.managedAgentPath, '#!/bin/sh\necho ok\n', { mode: 0o755 })
    const configStore = createConfigStore({ configFile: paths.configFile })

    const ipcCalls = []
    let sidecarRestarts = 0
    let failNextRestart = false
    let mcpSyncCalls = 0
    let statusCoreOverride = null
    let resolveDownload = null
    let coreInstallCalledWith = null

    const mockIpc = {
      async ping() {
        return { ok: true, info: { version: '0.5.5' } }
      },
      async call(method, params) {
        ipcCalls.push({ method, params })
        if (method === 'status') {
          return {
            version: '0.5.5',
            core: statusCoreOverride,
            core_problem: statusCoreOverride ? null : 'FURY_CORE missing',
            core_download: { running: false, downloaded: 0, total: 0, installed: null, error: null },
          }
        }
        if (method === 'profile.launch') {
          throw new Error(
            "no core binary found. Install one with 'fury-agent install-core <file>', build it, or point FURY_CORE at one",
          )
        }
        if (method === 'core.download') {
          throw new Error('unverified IPC core.download must not be called by default')
        }
        return []
      },
    }

    const mockSidecar = {
      getStatus: () => ({ running: true, state: 'running', pid: 5555, recentLogs: [] }),
      start: async () => ({ running: true, state: 'running', pid: 5555 }),
      stop: async () => ({ running: false, state: 'stopped', pid: null }),
      restart: async () => {
        sidecarRestarts += 1
        if (failNextRestart) {
          failNextRestart = false
          throw new Error('simulated sidecar restart failure')
        }
        return { running: true, state: 'running', pid: 5555 + sidecarRestarts }
      },
      dispose: async () => {},
    }

    const baseMcpBridge = createMcpBridge({ paths, configStore, getMcpManager: () => null, platform: 'darwin' })
    const trackedMcpBridge = {
      ...baseMcpBridge,
      async sync(opts) {
        mcpSyncCalls += 1
        return baseMcpBridge.sync(opts)
      },
    }

    const installerState = {
      agent: { status: 'idle', progress: null, error: null, updatedAt: null },
      core: { status: 'idle', progress: null, error: null, updatedAt: null },
    }
    const mockInstaller = {
      getStatus: () => ({ agent: { ...installerState.agent }, core: { ...installerState.core } }),
      installCore: ({ agentBinaryPath }) => {
        coreInstallCalledWith = agentBinaryPath
        installerState.core = {
          status: 'downloading',
          progress: { downloadedBytes: 0, totalBytes: 119633052, percent: 0 },
          error: null,
          updatedAt: Date.now(),
        }
        return new Promise((resolve) => {
          resolveDownload = () => {
            installerState.core = {
              status: 'installed',
              progress: { downloadedBytes: 119633052, totalBytes: 119633052, percent: 100 },
              error: null,
              updatedAt: Date.now(),
            }
            resolve({ ok: true, chromiumVersion: '157.0.8103.39' })
          }
        })
      },
      installAgent: async () => ({ ok: true }),
      probeAgentBinary: async () => ({ ok: true }),
      clearCache: async () => ({ ok: true }),
    }

    const dispatcher = createPibrowseDispatcher({
      paths,
      configStore,
      ipcClient: mockIpc,
      installer: mockInstaller,
      sidecar: mockSidecar,
      mcpBridge: trackedMcpBridge,
      teamClient: createTeamClient({ paths, configStore, ipcClient: mockIpc }),
      platform: 'darwin',
      arch: 'arm64',
    })
    const http = createHttpHandler(dispatcher)

    // 1. launchProfile & detect_suite map raw upstream error to HTTP 503 core-not-installed
    const launchRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/profiles/pf-1/launch',
      body: {},
    })
    assert.equal(launchRes.status, 503)
    assert.equal(launchRes.body.error, 'core-not-installed')
    assert.match(launchRes.body.message, /Chromium 157/)

    const detectRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/profiles/manage',
      body: { action: 'detect_suite', profileId: 'pf-1' },
    })
    assert.equal(detectRes.status, 503)
    assert.equal(detectRes.body.error, 'core-not-installed')

    // 2. getOverview merges sidecar status core_problem and core_download
    const ov = await dispatcher.getOverview()
    assert.equal(ov.core.installed, false)
    assert.equal(ov.core.problem, 'FURY_CORE missing')
    assert.equal(ov.installer.ipcCoreDownload.running, false)

    // 3. install_core with background: true uses verified installer (not IPC core.download) and reports downloading immediately
    const bgRes = await dispatcher.manageRuntime({ action: 'install_core', background: true })
    assert.equal(bgRes.ok, true)
    assert.equal(bgRes.started, true)
    assert.equal(bgRes.mode, 'verified-installer')
    assert.equal(bgRes.installer.core.status, 'downloading')
    assert.equal(coreInstallCalledWith, paths.managedAgentPath)
    assert.equal(ipcCalls.some((c) => c.method === 'core.download'), false)
    resolveDownload()

    // 4. configure_paths changing geoipPath does NOT restart sidecar; changing corePath DOES restart sidecar
    await dispatcher.manageRuntime({ action: 'configure_paths', geoipPath: '/tmp/GeoLite2-City.mmdb' })
    assert.equal(sidecarRestarts, 0)

    const cfgRes = await dispatcher.manageRuntime({ action: 'configure_paths', corePath: '/tmp/Fury.app' })
    assert.equal(cfgRes.ok, true)
    assert.equal(sidecarRestarts, 1)
    assert.equal(cfgRes.sidecar.pid, 5556)

    // 5. Empty/invalid configured corePath stays installed: false with actionable problem even if sidecar status echoes raw dir
    const emptyApp = join(tmp, 'Empty.app')
    await mkdir(emptyApp, { recursive: true })
    await dispatcher.manageRuntime({ action: 'configure_paths', corePath: emptyApp })
    statusCoreOverride = emptyApp
    const ovInvalidCore = await dispatcher.getOverview()
    assert.equal(ovInvalidCore.core.installed, false)
    assert.match(ovInvalidCore.core.problem, /FURY_CORE/)

    // 6. If sidecar.restart() throws during configure_paths, mcpBridge.sync() STILL executes in finally
    const syncBefore = mcpSyncCalls
    failNextRestart = true
    await assert.rejects(
      () => dispatcher.manageRuntime({ action: 'configure_paths', corePath: null }),
      /simulated sidecar restart failure/,
    )
    assert.equal(mcpSyncCalls, syncBefore + 1, 'mcpBridge.sync must still run even when sidecar.restart throws')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
