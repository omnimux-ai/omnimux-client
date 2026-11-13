/**
 * Resolve a real Node binary + a headless spawn environment for this package's
 * scripts, so they never boot the DSH Desktop app binary as a GUI app.
 *
 * Background: DSH Desktop injects `runtime-commands/bin` (an
 * `ELECTRON_RUN_AS_NODE` shim) at the front of PATH. Under it, `process.execPath`
 * (and often `command -v node`) resolves to the DSH Desktop app binary, and the
 * `clear-env.mjs` the shim preloads *removes* `ELECTRON_RUN_AS_NODE` from the
 * child. So if a script does `spawn(process.execPath, [other.mjs])`, Electron may
 * boot as a **GUI app** — flashing Dock icons and foreground-activation loops.
 *
 * The robust fix is to spawn a *real* Node binary (not the DSH shim) and force
 * Electron's node mode on it anyway. This module resolves such a binary and
 * builds a safe child environment.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** True when a path points at the DSH Desktop app binary (a GUI-capable Electron). */
function isDshAppBinary(path) {
  return typeof path === 'string' && /DSH Desktop\.app\/Contents\/MacOS/.test(path)
}

/**
 * Absolute path to a real Node binary.
 *
 * Resolution order (each skipped if unset / non-executable / a DSH shim):
 *   1. `process.env.OMNIMUX_NODE`   — omnimux-env.sh / dev-env.sh export
 *   2. `process.env.NVM_BIN/node`   — nvm (real Mach-O node)
 *   3. `process.env.NODE`           — DSH may set this; skip if it's a DSH shim
 *   4. `command -v node` absolute   — skip if it resolves under a DSH shim dir
 *   5. `process.execPath`           — real node in a normal (non-DSH) shell
 */
export function realNode() {
  const candidates = [
    process.env.OMNIMUX_NODE,
    process.env.NVM_BIN ? join(process.env.NVM_BIN, 'node') : undefined,
    process.env.NODE,
  ]
  for (const candidate of candidates) {
    if (candidate && !isDshAppBinary(candidate) && !/runtime-commands/.test(candidate)) {
      try {
        execFileSync(candidate, ['--version'], { stdio: 'ignore' })
        return candidate
      } catch {}
    }
  }
  // `command -v node`: skip anything under DSH runtime-commands.
  try {
    const found = execFileSync('command', ['-v', 'node'], { encoding: 'utf8' }).trim()
    if (found && !isDshAppBinary(found) && !/runtime-commands/.test(found)) return found
  } catch {}
  return process.execPath
}

/** Environment for spawning a child Node/JS script headlessly. */
export function nodeEnv(base = process.env) {
  return {
    ...base,
    // Force Electron's node mode so even a DSH-binary-resolved node never boots GUI.
    ELECTRON_RUN_AS_NODE: '1',
    NODE: realNode(),
  }
}

export default { realNode, nodeEnv }
