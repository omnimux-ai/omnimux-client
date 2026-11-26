import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createConfigStore } from './config-store.js'
import { createPibrowseDispatcher } from './dispatcher.js'
import { createHttpHandler } from './http-routes.js'
import { apply } from './index.js'
import { createInstaller } from './installer.js'
import { createIpcClient } from './ipc-client.js'
import { createMcpBridge } from './mcp-bridge.js'
import { computeSocketPath, ensurePrivateSocketDir, hardenOwnedSocketPermissions, resolvePibrowsePaths, verifySocketTrust } from './paths.js'
import { probeStandaloneAgent, resolveAgentBinary, resolveCoreExecutable, validateAgentBinaryFile, validateCoreExecutableFile } from './platform.js'
import { createSidecarSupervisor } from './sidecar.js'
import { createTeamClient } from './team-client.js'

test('pibrowse_manage_runtime agent tool excludes configure_paths and refuses arbitrary executable overrides (issue #358)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-sec-tool-'))
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

    const instance = apply(ctx, {
      rootDir: tmp,
      socketDir: tmp,
      platform: 'darwin',
      arch: 'arm64',
      autoRegisterMcp: false,
    })

    const runtimeTool = tools.get('pibrowse_manage_runtime')
    assert.ok(runtimeTool)
    const actionEnum = runtimeTool.parameters.properties.action.enum
    assert.equal(actionEnum.includes('configure_paths'), false)
    assert.equal('agentPath' in runtimeTool.parameters.properties, false)
    assert.equal('corePath' in runtimeTool.parameters.properties, false)

    const validAgent = join(tmp, 'fury-agent')
    await writeFile(validAgent, '#!/bin/sh\necho ok\n', { mode: 0o755 })

    // Even if an LLM ignores schema and calls configure_paths directly, runtime rejects with forbidden.
    const blocked = await runtimeTool.execute({ action: 'configure_paths', agentPath: validAgent, confirm: true })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error, 'forbidden')

    const cfg = await instance.configStore.load()
    assert.equal(cfg.agentPath, null)

    for (const d of effects.reverse()) d()
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('HTTP configure_paths requires confirm: true for executable overrides and validates fury-agent binary integrity (issue #358)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-sec-http-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp, platform: 'darwin' })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const mockIpc = {
      async ping() { return { ok: false } },
      async call() { return [] },
    }
    const mockSidecar = {
      getStatus: () => ({ running: false, state: 'stopped', pid: null, recentLogs: [] }),
      start: async () => ({ running: true, state: 'running', pid: 1 }),
      stop: async () => ({ running: false, state: 'stopped', pid: null }),
      restart: async () => ({ running: true, state: 'running', pid: 2 }),
      dispose: async () => {},
    }
    const dispatcher = createPibrowseDispatcher({
      paths,
      configStore,
      ipcClient: mockIpc,
      installer: createInstaller({ paths, configStore }),
      sidecar: mockSidecar,
      mcpBridge: createMcpBridge({ paths, configStore, getMcpManager: () => null, platform: 'darwin' }),
      teamClient: createTeamClient({ paths, configStore, ipcClient: mockIpc }),
      platform: 'darwin',
    })
    const http = createHttpHandler(dispatcher)

    const validAgent = join(tmp, 'fury-agent')
    await writeFile(validAgent, '#!/bin/sh\necho ok\n', { mode: 0o755 })

    // 1. Missing confirm: true on HTTP configure_paths for agentPath/corePath -> 400 confirmation-required
    const unconfirmed = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/runtime',
      body: { action: 'configure_paths', agentPath: validAgent },
    })
    assert.equal(unconfirmed.status, 400)
    assert.equal(unconfirmed.body.error, 'confirmation-required')

    // 2. Arbitrary executable basename rejected even with confirm: true
    const evilScript = join(tmp, 'evil.sh')
    await writeFile(evilScript, '#!/bin/sh\nid\n', { mode: 0o755 })
    const badName = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/runtime',
      body: { action: 'configure_paths', agentPath: evilScript, confirm: true },
    })
    assert.equal(badName.status, 400)
    assert.equal(badName.body.error, 'invalid-path')

    // 3. Symlink masquerading as fury-agent rejected
    const symAgent = join(tmp, 'symlink-fury-agent')
    await symlink(evilScript, symAgent)
    const badSym = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/runtime',
      body: { action: 'configure_paths', agentPath: symAgent, confirm: true },
    })
    assert.equal(badSym.status, 400)
    assert.equal(badSym.body.error, 'invalid-path')

    // 4. World-writable fury-agent rejected (POSIX)
    if (process.platform !== 'win32') {
      const writableAgent = join(tmp, 'writable-fury-agent')
      await writeFile(writableAgent, '#!/bin/sh\necho ok\n', { mode: 0o755 })
      await chmod(writableAgent, 0o777)
      const badMode = await http.dispatch({
        method: 'POST',
        url: '/omnimux/pibrowse/runtime',
        body: { action: 'configure_paths', agentPath: writableAgent, confirm: true },
      })
      assert.equal(badMode.status, 400)
      assert.equal(badMode.body.error, 'invalid-path')
      assert.equal((await validateAgentBinaryFile(writableAgent, 'darwin')).ok, false)
    }

    // 5. Legitimate non-symlink 0755 fury-agent succeeds with confirm: true
    const okRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/runtime',
      body: { action: 'configure_paths', agentPath: validAgent, confirm: true },
    })
    assert.equal(okRes.status, 200)
    assert.equal(okRes.body.ok, true)
    assert.equal(okRes.body.config.agentPath, validAgent)

    // 6. geoipPath update without executable override still works without confirm
    const geoRes = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/runtime',
      body: { action: 'configure_paths', geoipPath: '/tmp/GeoLite2-City.mmdb' },
    })
    assert.equal(geoRes.status, 200)

    // 7. resolveAgentBinary refuses tampered config.json pointing to arbitrary binary or symlink
    const badResolved = await resolveAgentBinary({ paths, config: { agentPath: evilScript }, platform: 'darwin' })
    assert.equal(badResolved.installed, false)
    assert.equal(badResolved.path, null)

    const symResolved = await resolveAgentBinary({ paths, config: { agentPath: symAgent }, platform: 'darwin' })
    assert.equal(symResolved.installed, false)
    assert.equal(symResolved.path, null)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('Unix socket uses a user-private 0700 directory and refuses adoption/IPC on untrusted dir, mode, symlink, or UID (issue #358)', async () => {
  if (process.platform === 'win32') return
  const tmp = await mkdtemp(join(tmpdir(), 'pb-sec-sock-'))
  try {
    // 1. Default socket path lives inside per-user omx-pb-<uid> directory and stays < 100 bytes
    const defaultSock = computeSocketPath(join(tmp, 'data'), { platform: 'darwin', uid: 501 })
    assert.ok(dirname(defaultSock).endsWith('omx-pb-501'), `unexpected socket dir: ${defaultSock}`)
    assert.ok(Buffer.byteLength(defaultSock, 'utf8') < 100)

    // 2. ensurePrivateSocketDir creates 0700 directory
    const privateSock = join(tmp, 'priv-dir', 'pb.sock')
    await ensurePrivateSocketDir(privateSock)
    const dirInfo = await lstat(dirname(privateSock))
    assert.equal(dirInfo.mode & 0o777, 0o700)

    // 3. Shared/loose directory (0755) is rejected by both ensurePrivateSocketDir and verifySocketTrust
    const looseDir = join(tmp, 'loose-dir')
    await mkdir(looseDir, { mode: 0o755 })
    await chmod(looseDir, 0o755)
    const looseSock = join(looseDir, 'pb.sock')
    await assert.rejects(
      () => ensurePrivateSocketDir(looseSock),
      (err) => err.code === 'insecure-socket',
    )
    await assert.rejects(
      () => verifySocketTrust(looseSock),
      (err) => err.code === 'insecure-socket',
    )

    // 4. Symlink directory is rejected
    const symDir = join(tmp, 'sym-dir')
    await symlink(dirname(privateSock), symDir)
    await assert.rejects(
      () => verifySocketTrust(join(symDir, 'pb.sock')),
      (err) => err.code === 'insecure-socket',
    )

    // 5. Real listening socket in 0700 dir passes verifySocketTrust unless world-writable or UID mismatches
    const server = createServer((conn) => {
      conn.once('data', () => {
        conn.end(`${JSON.stringify({ id: 1, ok: { version: '0.5.5' } })}\n`)
      })
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(privateSock, resolve)
    })
    try {
      await chmod(privateSock, 0o600)
      const okTrust = await verifySocketTrust(privateSock)
      assert.equal(okTrust.exists, true)

      // World-writable socket (0666) must be refused by verifySocketTrust, ipcClient, and sidecar.start()
      await chmod(privateSock, 0o666)
      await assert.rejects(
        () => verifySocketTrust(privateSock),
        (err) => err.code === 'insecure-socket',
      )

      const ipcClient = createIpcClient({ socketPath: privateSock })
      await assert.rejects(
        () => ipcClient.call('status'),
        (err) => err.code === 'insecure-socket',
      )

      const paths = resolvePibrowsePaths({ rootDir: tmp, socketPath: privateSock })
      const configStore = createConfigStore({ configFile: paths.configFile })
      let pinged = false
      const sidecar = createSidecarSupervisor({
        paths,
        configStore,
        ipcClient: {
          async ping() { pinged = true; return { ok: true, info: {} } },
          async call() { return [] },
        },
      })
      await assert.rejects(
        () => sidecar.start(),
        (err) => err.code === 'insecure-socket',
      )
      assert.equal(pinged, false, 'sidecar must refuse untrusted socket BEFORE calling ipcClient.ping')

      // Mismatched UID on existing socket must be refused before adoption
      await chmod(privateSock, 0o600)
      const foreignUid = (process.geteuid?.() ?? 501) + 999
      await assert.rejects(
        () => verifySocketTrust(privateSock, { uid: foreignUid }),
        (err) => err.code === 'insecure-socket',
      )
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('corePath, managedAgentPath, standaloneAgent, and installer reject arbitrary executables and symlinks (issue #358)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-sec-core-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp, platform: 'darwin' })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const evilSh = join(tmp, 'evil.sh')
    await writeFile(evilSh, '#!/bin/sh\necho pwn\n', { mode: 0o755 })

    // 1. resolveCoreExecutable refuses arbitrary executable files, symlinks, and symlinked subdirectories
    assert.equal(await resolveCoreExecutable(evilSh, 'darwin'), null)
    const symCore = join(tmp, 'Fury')
    await symlink(evilSh, symCore)
    assert.equal(await resolveCoreExecutable(symCore, 'darwin'), null)

    const bundleDir = join(tmp, 'core.bundle')
    const realTargetDir = join(tmp, 'outside')
    await mkdir(join(realTargetDir, 'Fury.app', 'Contents', 'MacOS'), { recursive: true })
    await writeFile(join(realTargetDir, 'Fury.app', 'Contents', 'MacOS', 'Fury'), '#!/bin/sh\necho ok\n', { mode: 0o755 })
    await mkdir(bundleDir, { recursive: true })
    await symlink(realTargetDir, join(bundleDir, 'linked-sub'))
    assert.equal(await resolveCoreExecutable(bundleDir, 'darwin'), null)

    // Legitimate Fury executable passes validateCoreExecutableFile
    const goodCore = join(realTargetDir, 'Fury.app', 'Contents', 'MacOS', 'Fury')
    assert.equal((await validateCoreExecutableFile(goodCore, 'darwin')).ok, true)

    // 2. HTTP configure_paths rejects arbitrary file or symlink as corePath
    const mockIpc = { async ping() { return { ok: false } }, async call() { return [] } }
    const mockSidecar = {
      getStatus: () => ({ running: false, state: 'stopped', pid: null, recentLogs: [] }),
      start: async () => ({ running: true, state: 'running', pid: 1 }),
      stop: async () => ({ running: false, state: 'stopped', pid: null }),
      restart: async () => ({ running: true, state: 'running', pid: 2 }),
      dispose: async () => {},
    }
    const installer = createInstaller({
      paths,
      configStore,
      platform: 'darwin',
      execFileImpl: async () => { throw new Error('execFile must not run on invalid binary') },
    })
    const dispatcher = createPibrowseDispatcher({
      paths,
      configStore,
      ipcClient: mockIpc,
      installer,
      sidecar: mockSidecar,
      mcpBridge: createMcpBridge({ paths, configStore, getMcpManager: () => null, platform: 'darwin' }),
      teamClient: createTeamClient({ paths, configStore, ipcClient: mockIpc }),
      platform: 'darwin',
    })
    const http = createHttpHandler(dispatcher)
    const badCoreHttp = await http.dispatch({
      method: 'POST',
      url: '/omnimux/pibrowse/runtime',
      body: { action: 'configure_paths', corePath: evilSh, confirm: true },
    })
    assert.equal(badCoreHttp.status, 400)
    assert.equal(badCoreHttp.body.error, 'invalid-path')

    // 3. managedAgentPath symlink & probeStandaloneAgent & installer reject untrusted binaries
    await mkdir(paths.binDir, { recursive: true })
    await symlink(evilSh, paths.managedAgentPath)
    const resolvedManaged = await resolveAgentBinary({ paths, config: {}, platform: 'darwin' })
    assert.equal(resolvedManaged.installed, false)

    const standaloneBad = await probeStandaloneAgent({ platform: 'darwin', standaloneCandidates: [evilSh] })
    assert.equal(standaloneBad.found, false)

    const probeBad = await installer.probeAgentBinary(evilSh)
    assert.equal(probeBad.ok, false)
    assert.equal(probeBad.code, 'agent-not-installed')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('fresh-install missing socketDir, mcpBridge trust gate, symlink non-chmod, and umask 0002 socket tightening (issue #358)', async () => {
  if (process.platform === 'win32') return
  const tmp = await mkdtemp(join(tmpdir(), 'pb-sec-edge-'))
  try {
    // 1. Fresh install with non-existent socketDir: ipcClient reports sidecar-offline, stop/dispose succeed cleanly
    const missingSock = join(tmp, 'never-created', 'pb.sock')
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketPath: missingSock, platform: process.platform })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const ipcClient = createIpcClient({ socketPath: missingSock, platform: process.platform })

    await assert.rejects(
      () => ipcClient.call('status'),
      (err) => err.code === 'sidecar-offline',
    )
    const sidecar = createSidecarSupervisor({ paths, configStore, ipcClient, platform: process.platform })
    const stopped = await sidecar.stop()
    assert.equal(stopped.state, 'stopped')
    await sidecar.dispose()

    // 2. ensurePrivateSocketDir refuses symlink dir WITHOUT mutating target directory permissions
    const targetDir = join(tmp, 'victim-dir')
    await mkdir(targetDir, { mode: 0o755 })
    await chmod(targetDir, 0o755)
    const symSocketDir = join(tmp, 'symlink-sock-dir')
    await symlink(targetDir, symSocketDir)
    await assert.rejects(
      () => ensurePrivateSocketDir(join(symSocketDir, 'pb.sock')),
      (err) => err.code === 'insecure-socket',
    )
    const victimStat = await lstat(targetDir)
    assert.equal(victimStat.mode & 0o777, 0o755, 'ensurePrivateSocketDir must never chmod through a symlink')

    // 3. mcpBridge.sync refuses untrusted socket dir before calling manager.register
    await mkdir(paths.binDir, { recursive: true })
    await writeFile(paths.managedAgentPath, '#!/bin/sh\necho ok\n', { mode: 0o755 })
    let registeredCount = 0
    const badMcpPaths = resolvePibrowsePaths({ rootDir: tmp, socketPath: join(targetDir, 'pb.sock'), platform: process.platform })
    const mcpBridge = createMcpBridge({
      paths: badMcpPaths,
      configStore,
      platform: process.platform,
      getMcpManager: () => ({ register() { registeredCount += 1 }, list: () => [] }),
    })
    const badStatus = await mcpBridge.sync({ force: true })
    assert.equal(badStatus.registered, false)
    assert.equal(badStatus.state, 'error')
    assert.equal(registeredCount, 0)

    // 4. hardenOwnedSocketPermissions tightens a umask-0002 (0775) owned socket inside a 0700 dir to 0600
    const privSock = join(tmp, 'priv-upg', 'pb.sock')
    await ensurePrivateSocketDir(privSock)
    const server = createServer()
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(privSock, resolve) })
    try {
      await chmod(privSock, 0o775)
      await hardenOwnedSocketPermissions(privSock)
      const tightened = await lstat(privSock)
      assert.equal(tightened.mode & 0o777, 0o600)
      const trust = await verifySocketTrust(privSock)
      assert.equal(trust.exists, true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
