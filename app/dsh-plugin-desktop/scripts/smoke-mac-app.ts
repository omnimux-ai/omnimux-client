/** Launch a packaged macOS app in an isolated home/userData tree and fail if it exits before settling. */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Options for the isolated GUI startup smoke. */
export interface MacAppSmokeOptions {
  /** Directory used for every home and user-data env var. */
  readonly tempRoot?: string
  /** How long the app must stay alive before the smoke is considered started. */
  readonly settleMs?: number
}

/**
 * Launch the packaged executable with isolated userData/DSH_HOME and verify it does not exit.
 * @param appPath - Path to the packaged `.app` bundle.
 * @param options - Temporary directory and settle-time overrides.
 */
export function smokeMacApp(appPath: string, options: MacAppSmokeOptions = {}): void {
  const executable = join(appPath, 'Contents', 'MacOS', 'OmniMux')
  const root = options.tempRoot ?? mkdtempSync(join(tmpdir(), 'omnimux-gui-smoke-'))
  const home = join(root, 'home')
  const dshHome = join(root, 'dsh-home')
  const tmp = join(root, 'tmp')
  mkdirSync(home, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(tmp, { recursive: true })
  const settleMs = options.settleMs ?? 20_000
  let result: ReturnType<typeof spawnSync>
  try {
    result = spawnSync(executable, [], {
      env: {
        ...process.env,
        HOME: home,
        TMPDIR: tmp,
        DSH_HOME: dshHome,
        DSH_DESKTOP_NEXT_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: settleMs,
      encoding: 'utf8',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM'
  if (result.error !== undefined && !timedOut) {
    throw new Error(`macOS GUI smoke could not start ${executable}`, { cause: result.error })
  }
  if (!timedOut) {
    const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout?.toString() ?? ''
    const stderr = typeof result.stderr === 'string' ? result.stderr : result.stderr?.toString() ?? ''
    throw new Error(
      `macOS GUI smoke exited before ${String(settleMs)}ms: status=${String(result.status)} signal=${String(result.signal)} `
      + `stdout=${JSON.stringify(stdout.trim())} stderr=${JSON.stringify(stderr.trim())}`,
    )
  }
  console.log(`macOS GUI smoke passed: ${executable} stayed alive for ${String(settleMs)}ms with isolated userData/DSH_HOME`)
}
