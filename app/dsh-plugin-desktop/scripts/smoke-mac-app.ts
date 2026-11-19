/** Launch a packaged macOS app in an isolated home/userData tree and wait for a live renderer. */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Options for the isolated GUI startup smoke. */
export interface MacAppSmokeOptions {
  /** Directory used for every home and user-data env var. */
  readonly tempRoot?: string
  /** Upper bound for the readiness wait; readiness returns earlier. */
  readonly settleMs?: number
  /** Read-only port used to diagnose a failed launch. */
  readonly remoteDebuggingPort?: number
}

interface CdpTarget {
  readonly type?: string
  readonly url?: string
  readonly webSocketDebuggerUrl?: string
}

interface RendererState {
  readonly readyState: string
  readonly visibilityState: string
  readonly rootPresent: boolean
  readonly rootChildren: number
  readonly textLength: number
}

function findDevToolsActivePort(root: string): string | undefined {
  const candidates = [
    join(root, 'electron-user-data', 'DevToolsActivePort'),
    join(root, 'DevToolsActivePort'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  const visit = (directory: string, depth: number): string | undefined => {
    if (depth > 3) return undefined
    let names: string[]
    try { names = readdirSync(directory) } catch { return undefined }
    for (const name of names) {
      const path = join(directory, name)
      let isDirectory = false
      try { isDirectory = statSync(path).isDirectory() } catch { continue }
      if (!isDirectory && name === 'DevToolsActivePort') return path
      if (isDirectory && name !== 'node_modules') {
        const nested = visit(path, depth + 1)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }
  return visit(root, 0)
}

async function waitFor<T>(label: string, timeoutMs: number, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out after ${String(timeoutMs)}ms${lastError === undefined ? '' : `: ${lastError instanceof Error ? lastError.message : String(lastError)}`}`)
}

async function cdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${String(response.status)}`)
  const parsed = await response.json()
  return Array.isArray(parsed) ? parsed as CdpTarget[] : []
}

async function evaluateRenderer(webSocketUrl: string): Promise<RendererState> {
  return new Promise<RendererState>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('CDP renderer evaluation timed out'))
    }, 5_000)
    const finish = (error: Error | undefined, state?: RendererState): void => {
      clearTimeout(timer)
      socket.close()
      if (error === undefined && state !== undefined) resolve(state)
      else reject(error ?? new Error('CDP renderer evaluation returned no state'))
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          awaitPromise: true,
          returnByValue: true,
          expression: `(() => {
            const root = document.querySelector('#root,[data-dsh-product-stage]');
            return {
              readyState: document.readyState,
              visibilityState: document.visibilityState,
              rootPresent: root !== null,
              rootChildren: root === null ? 0 : root.childElementCount,
              textLength: root === null ? 0 : (root.textContent || '').trim().length,
            };
          })()`,
        },
      }))
    })
    socket.addEventListener('message', event => {
      let message: { id?: unknown; result?: { result?: { value?: unknown } }; error?: unknown }
      try { message = JSON.parse(String(event.data)) as typeof message } catch { return }
      if (message.id !== 1) return
      if (message.error !== undefined) {
        finish(new Error(`CDP Runtime.evaluate failed: ${JSON.stringify(message.error)}`))
        return
      }
      const value = message.result?.result?.value
      if (value === null || typeof value !== 'object') {
        finish(new Error('CDP Runtime.evaluate returned no renderer state'))
        return
      }
      finish(undefined, value as RendererState)
    })
    socket.addEventListener('error', () => finish(new Error('CDP WebSocket connection failed')))
  })
}

async function waitForRenderer(port: number, timeoutMs: number): Promise<RendererState> {
  const deadline = Date.now() + timeoutMs
  const target = await waitFor('CDP page target', Math.min(10_000, Math.max(1, deadline - Date.now())), async () => {
    const targets = await cdpTargets(port)
    return targets.find(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl !== undefined)
      ?? targets.find(candidate => candidate.webSocketDebuggerUrl !== undefined)
  })
  if (target.webSocketDebuggerUrl === undefined) throw new Error('CDP page target has no WebSocket URL')
  return waitFor('renderer ready', Math.max(1, deadline - Date.now()), async () => {
    const state = await evaluateRenderer(target.webSocketDebuggerUrl!)
    return state.readyState === 'complete'
      && state.visibilityState === 'visible'
      && state.rootPresent
      && (state.rootChildren > 0 || state.textLength > 0)
      ? state
      : undefined
  })
}

function writeIsolatedPreferences(home: string): void {
  writeFileSync(join(home, 'desktop-preferences.json'), `${JSON.stringify({ port: 0 })}\n`, { mode: 0o600 })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, timeoutMs)
    child.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Launch the packaged executable with isolated userData/DSH_HOME and verify that a real
 * renderer reaches the ready/visible state. A fixed 20s sleep is only the fallback budget;
 * the smoke returns as soon as CDP reports the window is usable.
 * @param appPath - Path to the packaged `.app` bundle.
 * @param options - Temporary directory and timeout overrides.
 */
export async function smokeMacApp(appPath: string, options: MacAppSmokeOptions = {}): Promise<void> {
  const executable = join(appPath, 'Contents', 'MacOS', 'OmniMux')
  const root = options.tempRoot ?? mkdtempSync(join(tmpdir(), 'omnimux-gui-smoke-'))
  const home = join(root, 'home')
  const dshHome = join(root, 'dsh-home')
  const tmp = join(root, 'tmp')
  mkdirSync(home, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(tmp, { recursive: true })
  writeIsolatedPreferences(home)
  const settleMs = options.settleMs ?? 20_000
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    TMPDIR: tmp,
    DSH_HOME: dshHome,
    DSH_DESKTOP_NEXT_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  const started = Date.now()
  let child: ChildProcess | undefined
  try {
    child = spawn(executable, ['--remote-debugging-port=0'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    if (child.exitCode !== null) {
      throw new Error(`macOS GUI smoke exited before launch: status=${String(child.exitCode)} stdout=${JSON.stringify(stdout.trim())} stderr=${JSON.stringify(stderr.trim())}`)
    }
    const deadline = Date.now() + settleMs
    const portFile = await waitFor('DevToolsActivePort', Math.max(1, deadline - Date.now()), () => findDevToolsActivePort(root))
    const port = Number.parseInt(readFileSync(portFile, 'utf8').split('\n')[0] ?? '', 10)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`macOS GUI smoke: invalid DevToolsActivePort at ${portFile}`)
    const state = await waitForRenderer(port, Math.max(1, deadline - Date.now()))
    console.log(`macOS GUI smoke passed in ${String(Date.now() - started)}ms: ${executable} port=${String(port)} `
      + `readyState=${state.readyState} visibilityState=${state.visibilityState} rootChildren=${String(state.rootChildren)} textLength=${String(state.textLength)}`)
  } finally {
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM')
      await waitForExit(child, 5_000)
    }
    if (options.tempRoot === undefined) rmSync(root, { recursive: true, force: true })
  }
}
