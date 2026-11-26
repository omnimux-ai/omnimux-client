import { spawn as defaultSpawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { PibrowseError } from './errors.js'
import { ensurePibrowseDirs } from './paths.js'
import { resolveAgentBinary, resolveCoreExecutable } from './platform.js'
import { redactLogLine } from './redact.js'

const MAX_LOG_LINES = 60

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Supervise the out-of-process `fury-agent serve` sidecar using isolated
 * `FURY_HOME` and local `FURY_SOCKET` (Unix socket / Named Pipe).
 * Explicitly omits `FURY_API_PORT` so no local TCP HTTP port is opened.
 *
 * @param {{
 *   paths: ReturnType<import('./paths.js').resolvePibrowsePaths>,
 *   configStore: ReturnType<import('./config-store.js').createConfigStore>,
 *   ipcClient: ReturnType<import('./ipc-client.js').createIpcClient>,
 *   spawnImpl?: typeof defaultSpawn,
 *   platform?: NodeJS.Platform,
 *   startupTimeoutMs?: number,
 *   shutdownTimeoutMs?: number,
 *   logger?: { info?: Function, warn?: Function },
 *   onStateChange?: (status: ReturnType<any>) => void,
 * }} opts
 */
export function createSidecarSupervisor(opts) {
  const spawn = opts.spawnImpl ?? defaultSpawn
  const platform = opts.platform ?? process.platform
  const startupTimeoutMs = opts.startupTimeoutMs ?? 12_000
  const shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 2_500

  let child = null
  let state = 'stopped' // stopped | starting | running | stopping | error
  let pid = null
  let binaryPath = null
  let startedAt = null
  let lastError = null
  let lastExitCode = null
  let lastExitSignal = null
  const logs = []
  let lifecycleQueue = Promise.resolve()

  function pushLog(stream, rawText) {
    const lines = String(rawText || '').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      logs.push({
        ts: new Date().toISOString(),
        stream,
        message: redactLogLine(trimmed),
      })
      if (logs.length > MAX_LOG_LINES) logs.shift()
    }
  }

  function buildSpawnEnv(config, resolvedCorePath) {
    const env = { ...process.env }
    delete env.FURY_API_PORT
    delete env.FURY_API_TOKEN
    env.FURY_HOME = opts.paths.dataDir
    env.FURY_SOCKET = opts.paths.socketPath
    const effectiveCore = resolvedCorePath || config.corePath
    if (effectiveCore) {
      env.FURY_CORE = effectiveCore
    } else {
      delete env.FURY_CORE
    }
    return env
  }

  function getStatus() {
    return {
      state,
      running: state === 'running',
      pid,
      binaryPath,
      socketPath: opts.paths.socketPath,
      dataDir: opts.paths.dataDir,
      startedAt,
      lastError,
      lastExitCode,
      lastExitSignal,
      recentLogs: logs.slice(-20),
    }
  }

  function notifyChange() {
    opts.onStateChange?.(getStatus())
  }

  async function removeStaleSocket() {
    if (platform === 'win32') return
    await rm(opts.paths.socketPath, { force: true }).catch(() => {})
  }

  function enqueue(fn) {
    const next = lifecycleQueue.then(fn, fn)
    lifecycleQueue = next.catch(() => {})
    return next
  }

  async function waitUntilReady(proc) {
    const deadline = Date.now() + startupTimeoutMs
    let exitedEarly = null
    const onEarlyExit = (code, signal) => {
      exitedEarly = { code, signal }
    }
    proc.once('exit', onEarlyExit)
    try {
      while (Date.now() < deadline) {
        if (exitedEarly) {
          const isGatekeeper =
            platform === 'darwin' &&
            (exitedEarly.signal === 'SIGKILL' || logs.some((l) => /quarantine|signature|not permitted/i.test(l.message)))
          throw new PibrowseError(
            isGatekeeper ? 'gatekeeper-blocked' : 'sidecar-offline',
            isGatekeeper
              ? 'fury-agent was terminated by macOS Gatekeeper (SIGKILL). Allow it in System Settings -> Privacy & Security and retry.'
              : `fury-agent exited before becoming ready (code=${exitedEarly.code}, signal=${exitedEarly.signal})`,
            exitedEarly,
          )
        }
        const pingRes = await opts.ipcClient.ping(500)
        if (pingRes.ok) {
          return pingRes.info
        }
        await sleep(100)
      }
      throw new PibrowseError(
        'ipc-timeout',
        `fury-agent sidecar did not respond on ${opts.paths.socketPath} within ${startupTimeoutMs}ms`,
      )
    } finally {
      proc.off('exit', onEarlyExit)
    }
  }

  function start() {
    return enqueue(async () => {
      if (state === 'running' && child && child.exitCode === null) {
        const alive = await opts.ipcClient.ping(1000)
        if (alive.ok) return getStatus()
      }

      // If an agent on our exact isolated socket is already healthy (e.g. spawned by MCP), adopt status.
      const existingPing = await opts.ipcClient.ping(600)
      if (existingPing.ok) {
        const config = await opts.configStore.load()
        const resolved = await resolveAgentBinary({ paths: opts.paths, config, platform })
        binaryPath = resolved.path
        state = 'running'
        lastError = null
        startedAt = startedAt || new Date().toISOString()
        notifyChange()
        return getStatus()
      }

      const config = await opts.configStore.load()
      const resolved = await resolveAgentBinary({ paths: opts.paths, config, platform })
      if (!resolved.installed || !resolved.path) {
        state = 'stopped'
        lastError = 'fury-agent is not installed'
        notifyChange()
        throw new PibrowseError(
          'agent-not-installed',
          'fury-agent binary is not installed or configured. Install or specify a local path in Environment settings.',
        )
      }

      await ensurePibrowseDirs(opts.paths)
      await removeStaleSocket()

      state = 'starting'
      lastError = null
      lastExitCode = null
      lastExitSignal = null
      binaryPath = resolved.path
      notifyChange()

      const resolvedCorePath = config.corePath
        ? await resolveCoreExecutable(config.corePath, platform)
        : null
      const env = buildSpawnEnv(config, resolvedCorePath)
      const proc = spawn(resolved.path, ['serve'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      child = proc
      pid = proc.pid ?? null

      proc.stdout?.on('data', (chunk) => pushLog('stdout', chunk))
      proc.stderr?.on('data', (chunk) => pushLog('stderr', chunk))
      proc.on('error', (err) => {
        pushLog('stderr', `spawn error: ${err.message}`)
        lastError = err.message
      })
      proc.on('exit', (code, signal) => {
        lastExitCode = code
        lastExitSignal = signal
        if (child === proc) {
          child = null
          pid = null
          if (state !== 'stopping') {
            state = code === 0 ? 'stopped' : 'error'
            if (code !== 0) {
              lastError = `fury-agent exited unexpectedly (code=${code}, signal=${signal})`
            }
          } else {
            state = 'stopped'
          }
          notifyChange()
        }
      })

      try {
        await waitUntilReady(proc)
        state = 'running'
        startedAt = new Date().toISOString()
        lastError = null
        notifyChange()
        return getStatus()
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        state = 'error'
        try {
          proc.kill('SIGTERM')
        } catch (killErr) {
          opts.logger?.warn?.('omnimux-pibrowse: failed to kill unhealthy sidecar', {
            error: killErr instanceof Error ? killErr.message : String(killErr),
          })
        }
        notifyChange()
        throw err
      }
    })
  }

  /**
   * Stop running profiles inside this isolated `FURY_HOME`, request graceful
   * `agent.shutdown`, wait for exit, escalate to SIGTERM/SIGKILL if needed,
   * and unlink any leftover Unix domain socket file.
   */
  function stop({ stopProfiles = true } = {}) {
    return enqueue(async () => {
      state = 'stopping'
      notifyChange()

      if (stopProfiles) {
        try {
          const profiles = await opts.ipcClient.call('profiles.list', {}, { timeoutMs: 1500 })
          const profileArr = Array.isArray(profiles)
            ? profiles
            : profiles && typeof profiles === 'object' && Array.isArray(profiles.profiles)
              ? profiles.profiles
              : []
          const ids = profileArr.filter((p) => p && p.running === true && p.id).map((p) => p.id)
          for (const id of ids) {
            await opts.ipcClient.call('profile.stop', { id }, { timeoutMs: 2000 }).catch(() => {})
          }
        } catch (err) {
          if (!(err instanceof PibrowseError && err.code === 'sidecar-offline')) {
            opts.logger?.warn?.('omnimux-pibrowse: failed stopping active profiles during shutdown', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      }

      await opts.ipcClient.call('agent.shutdown', {}, { timeoutMs: 1500 }).catch(() => {})

      const proc = child
      if (proc && proc.exitCode === null) {
        const exited = await new Promise((resolve) => {
          let done = false
          const onExit = () => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve(true)
          }
          const timer = setTimeout(() => {
            if (done) return
            done = true
            proc.off('exit', onExit)
            resolve(false)
          }, shutdownTimeoutMs)
          proc.once('exit', onExit)
        })

        if (!exited && proc.exitCode === null) {
          try {
            proc.kill('SIGTERM')
          } catch (err) {
            opts.logger?.warn?.('omnimux-pibrowse: SIGTERM failed', { error: err instanceof Error ? err.message : String(err) })
          }
          await sleep(400)
          if (proc.exitCode === null) {
            try {
              proc.kill('SIGKILL')
            } catch (err) {
              opts.logger?.warn?.('omnimux-pibrowse: SIGKILL failed', { error: err instanceof Error ? err.message : String(err) })
            }
          }
        }
      }

      await removeStaleSocket()
      child = null
      pid = null
      state = 'stopped'
      notifyChange()
      return getStatus()
    })
  }

  async function restart() {
    await stop({ stopProfiles: false })
    return start()
  }

  async function dispose() {
    await stop({ stopProfiles: true })
  }

  return {
    getStatus,
    start,
    stop,
    restart,
    dispose,
  }
}
