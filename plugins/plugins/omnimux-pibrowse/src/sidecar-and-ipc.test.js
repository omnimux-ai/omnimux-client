import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createConfigStore } from './config-store.js'
import { createIpcClient } from './ipc-client.js'
import { resolvePibrowsePaths } from './paths.js'
import { createSidecarSupervisor } from './sidecar.js'

const MOCK_AGENT_SCRIPT = `#!/usr/bin/env node
import { createServer } from 'node:net'
import { appendFileSync, rmSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('mock fury-agent help')
  process.exit(0)
}

const socketPath = process.env.FURY_SOCKET
const auditLog = process.env.MOCK_AUDIT_FILE
const running = new Set(['pf-active-1'])

function record(obj) {
  if (auditLog) appendFileSync(auditLog, JSON.stringify(obj) + '\\n')
}

record({
  event: 'boot',
  furyHome: process.env.FURY_HOME || null,
  furySocket: socketPath || null,
  hasApiPort: Boolean(process.env.FURY_API_PORT),
})

try { rmSync(socketPath, { force: true }) } catch {}

const server = createServer((conn) => {
  let buf = ''
  conn.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    const nl = buf.indexOf('\\n')
    if (nl === -1) return
    const req = JSON.parse(buf.slice(0, nl))
    record({ event: 'rpc', method: req.method, params: req.params })
    if (req.method === 'status') {
      conn.end(JSON.stringify({ id: req.id, ok: { version: '0.5.5', pid: process.pid } }) + '\\n')
      return
    }
    if (req.method === 'profiles.list') {
      conn.end(JSON.stringify({ id: req.id, ok: [...running].map((id) => ({ id, running: true })) }) + '\\n')
      return
    }
    if (req.method === 'profile.stop') {
      running.delete(req.params?.id)
      conn.end(JSON.stringify({ id: req.id, ok: { stopped: req.params?.id } }) + '\\n')
      return
    }
    if (req.method === 'profiles.clone' && req.params?.id === 'missing') {
      conn.end(JSON.stringify({ id: req.id, err: 'profile not found', code: 'not_found' }) + '\\n')
      return
    }
    if (req.method === 'agent.shutdown') {
      conn.end(JSON.stringify({ id: req.id, ok: true }) + '\\n', () => {
        server.close(() => {
          try { rmSync(socketPath, { force: true }) } catch {}
          process.exit(0)
        })
      })
      return
    }
    conn.end(JSON.stringify({ id: req.id, ok: { echo: req.method } }) + '\\n')
  })
})

server.listen(socketPath)
`

test('sidecar starts real Unix socket IPC, propagates Coded errors, and cleanly tears down processes & socket', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-sc-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, socketDir: tmp, platform: process.platform })
    await mkdir(paths.binDir, { recursive: true })
    const auditFile = join(tmp, 'audit.jsonl')
    process.env.MOCK_AUDIT_FILE = auditFile

    await writeFile(paths.managedAgentPath, MOCK_AGENT_SCRIPT, 'utf8')
    await chmod(paths.managedAgentPath, 0o755)

    const configStore = createConfigStore({ configFile: paths.configFile })
    const ipcClient = createIpcClient({ socketPath: paths.socketPath, defaultTimeoutMs: 5000 })
    const sidecar = createSidecarSupervisor({
      paths,
      configStore,
      ipcClient,
      startupTimeoutMs: 5000,
      shutdownTimeoutMs: 2000,
    })

    const started = await sidecar.start()
    assert.equal(started.running, true)
    assert.ok(Number.isInteger(started.pid) && started.pid > 0)
    const spawnedPid = started.pid

    // Verify IPC Coded error propagation
    await assert.rejects(
      () => ipcClient.call('profiles.clone', { id: 'missing' }),
      (err) => err.code === 'not-found' && /profile not found/.test(err.message),
    )

    // Dispose must stop active profile, invoke agent.shutdown, terminate child, and remove socket
    await sidecar.dispose()
    assert.equal(sidecar.getStatus().running, false)

    // Verify spawned child process is no longer alive
    let stillAlive = false
    try {
      process.kill(spawnedPid, 0)
      stillAlive = true
    } catch {
      stillAlive = false
    }
    assert.equal(stillAlive, false, 'sidecar child process must not remain after dispose()')

    // Verify stale socket file cleaned up
    await assert.rejects(() => access(paths.socketPath))

    // Verify isolated env & shutdown sequence from audit log
    const events = (await readFile(auditFile, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    const boot = events.find((e) => e.event === 'boot')
    assert.equal(boot.furyHome, paths.dataDir)
    assert.equal(boot.furySocket, paths.socketPath)
    assert.equal(boot.hasApiPort, false, 'FURY_API_PORT must never be exposed')
    assert.ok(events.some((e) => e.event === 'rpc' && e.method === 'profile.stop' && e.params?.id === 'pf-active-1'))
    assert.ok(events.some((e) => e.event === 'rpc' && e.method === 'agent.shutdown'))
  } finally {
    delete process.env.MOCK_AUDIT_FILE
    await rm(tmp, { recursive: true, force: true })
  }
})
