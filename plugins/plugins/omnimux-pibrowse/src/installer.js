import { execFile as execFileCb } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { PINNED_UPSTREAM } from './constants.js'
import { PibrowseError } from './errors.js'
import { getPlatformInfo, pathAccessible, validateAgentBinaryFile } from './platform.js'

const defaultExecFile = promisify(execFileCb)

/**
 * Parse the first mounted volume mount-point from `hdiutil attach -plist` XML output.
 * @param {string} plistXml
 * @returns {string | null}
 */
export function parseHdiutilMountPoint(plistXml) {
  if (typeof plistXml !== 'string') return null
  const match = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/i.exec(plistXml)
  return match ? match[1].trim() : null
}

/**
 * Stream a remote URL to disk while computing SHA-256 on the fly.
 * Deletes the temporary file immediately on network error or SHA-256 mismatch.
 *
 * @param {{
 *   url: string,
 *   destPath: string,
 *   expectedSha256: string,
 *   fetchImpl?: typeof fetch,
 *   onProgress?: (progress: { downloadedBytes: number, totalBytes: number | null, percent: number | null }) => void,
 * }} opts
 */
export async function downloadAndVerifyFile(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new PibrowseError('install-failed', 'Global fetch is unavailable in this Node runtime')
  }
  await mkdir(dirname(opts.destPath), { recursive: true, mode: 0o700 })
  const partPath = `${opts.destPath}.part.${process.pid}.${Date.now()}`
  const expected = String(opts.expectedSha256 || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new PibrowseError('invalid-input', 'A 64-character SHA-256 digest is required for verified downloads')
  }

  try {
    const response = await fetchImpl(opts.url, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new PibrowseError(
        'install-failed',
        `Download failed with HTTP ${response.status} from ${opts.url}`,
        { status: response.status },
      )
    }
    const contentLengthHeader = response.headers?.get?.('content-length')
    const totalBytes = contentLengthHeader && Number.isFinite(Number(contentLengthHeader))
      ? Number(contentLengthHeader)
      : null

    const hash = createHash('sha256')
    const writer = createWriteStream(partPath, { mode: 0o600 })
    let downloadedBytes = 0

    try {
      for await (const chunk of response.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        hash.update(buf)
        downloadedBytes += buf.length
        if (!writer.write(buf)) {
          await new Promise((resolve, reject) => {
            const onDrain = () => {
              writer.off('error', onError)
              resolve()
            }
            const onError = (writeErr) => {
              writer.off('drain', onDrain)
              reject(writeErr)
            }
            writer.once('drain', onDrain)
            writer.once('error', onError)
          })
        }
        opts.onProgress?.({
          downloadedBytes,
          totalBytes,
          percent: totalBytes && totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
        })
      }
      await new Promise((resolve, reject) => {
        writer.once('error', reject)
        writer.end(resolve)
      })
    } catch (streamErr) {
      writer.destroy()
      throw streamErr
    }

    const actualSha256 = hash.digest('hex').toLowerCase()
    if (expected && actualSha256 !== expected) {
      throw new PibrowseError(
        'checksum-mismatch',
        `SHA-256 verification failed for ${opts.url}: expected ${expected}, got ${actualSha256}`,
        { expected, actual: actualSha256 },
      )
    }

    await rename(partPath, opts.destPath)
    return {
      path: opts.destPath,
      sha256: actualSha256,
      sizeBytes: downloadedBytes,
    }
  } catch (err) {
    await rm(partPath, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Create the PiBrowse binary & Chromium Core installer manager.
 *
 * @param {{
 *   paths: ReturnType<import('./paths.js').resolvePibrowsePaths>,
 *   configStore: ReturnType<import('./config-store.js').createConfigStore>,
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   fetchImpl?: typeof fetch,
 *   execFileImpl?: (file: string, args: string[], opts?: object) => Promise<{ stdout: string, stderr: string }>,
 *   logger?: { warn?: Function, info?: Function },
 * }} opts
 */
export function createInstaller(opts) {
  const execFile = opts.execFileImpl ?? defaultExecFile
  const state = {
    agent: { status: 'idle', progress: null, error: null, updatedAt: null },
    core: { status: 'idle', progress: null, error: null, updatedAt: null },
  }
  let agentInFlight = null
  let coreInFlight = null

  function getStatus() {
    return {
      agent: { ...state.agent },
      core: { ...state.core },
    }
  }

  /**
   * Probe a `fury-agent` binary with `--help` to verify executability and detect
   * macOS Gatekeeper / ad-hoc signature blocks without bypassing OS protections.
   * @param {string} binaryPath
   */
  async function probeAgentBinary(binaryPath) {
    const check = await validateAgentBinaryFile(binaryPath, opts.platform ?? process.platform)
    if (!check.ok) {
      return {
        ok: false,
        code: 'agent-not-installed',
        gatekeeperBlocked: false,
        message: check.reason || `fury-agent binary invalid at ${binaryPath}`,
      }
    }
    try {
      const env = { ...process.env }
      delete env.FURY_API_PORT
      delete env.FURY_API_TOKEN
      env.FURY_HOME = opts.paths.dataDir
      env.FURY_SOCKET = opts.paths.socketPath
      const { stdout, stderr } = await execFile(binaryPath, ['--help'], {
        timeout: 5000,
        env,
      })
      const text = `${stdout || ''}\n${stderr || ''}`.trim()
      return {
        ok: true,
        code: null,
        gatekeeperBlocked: false,
        helpPreview: text.slice(0, 240),
      }
    } catch (err) {
      const signal = err && typeof err === 'object' && 'signal' in err ? String(err.signal || '') : ''
      const errno = err && typeof err === 'object' && 'code' in err ? String(err.code || '') : ''
      const msg = err instanceof Error ? err.message : String(err)
      opts.logger?.warn?.('omnimux-pibrowse: fury-agent probe failed', { binaryPath, signal, errno, message: msg })
      const isGatekeeper =
        (opts.platform ?? process.platform) === 'darwin' &&
        (signal === 'SIGKILL' || /killed|quarantine|code signature|damaged|operation not permitted/i.test(msg))
      if (isGatekeeper) {
        return {
          ok: false,
          code: 'gatekeeper-blocked',
          gatekeeperBlocked: true,
          message:
            'macOS blocked execution of the ad-hoc signed fury-agent preview binary. Open System Settings -> Privacy & Security and click "Allow Anyway", then retry.',
        }
      }
      return {
        ok: false,
        code: errno === 'EACCES' ? 'gatekeeper-blocked' : 'install-failed',
        gatekeeperBlocked: errno === 'EACCES',
        message: `Failed to execute fury-agent: ${msg}`,
      }
    }
  }

  /**
   * Extract `PiBrowse.app/Contents/MacOS/fury-agent` from a verified macOS DMG
   * using read-only `hdiutil attach`, guaranteeing `hdiutil detach` in `finally`.
   * @param {string} dmgPath
   * @param {string} relativeAgentPath
   * @param {string} destAgentPath
   */
  async function extractAgentFromDmg(dmgPath, relativeAgentPath, destAgentPath) {
    let mountPoint = null
    try {
      const { stdout } = await execFile('hdiutil', [
        'attach',
        '-nobrowse',
        '-readonly',
        '-plist',
        dmgPath,
      ])
      mountPoint = parseHdiutilMountPoint(stdout)
      if (!mountPoint) {
        throw new PibrowseError('install-failed', 'hdiutil attach did not return a mount-point')
      }
      const sourceAgent = join(mountPoint, relativeAgentPath)
      if (!(await pathAccessible(sourceAgent))) {
        throw new PibrowseError(
          'install-failed',
          `Expected binary "${relativeAgentPath}" was not found inside mounted DMG`,
        )
      }
      await mkdir(dirname(destAgentPath), { recursive: true, mode: 0o700 })
      const tmpDest = `${destAgentPath}.tmp.${process.pid}`
      try {
        await copyFile(sourceAgent, tmpDest)
        await chmod(tmpDest, 0o755)
        await rename(tmpDest, destAgentPath)
      } catch (copyErr) {
        await rm(tmpDest, { force: true }).catch(() => {})
        throw copyErr
      }
      return destAgentPath
    } finally {
      if (mountPoint) {
        await execFile('hdiutil', ['detach', mountPoint, '-quiet']).catch(async () => {
          await execFile('hdiutil', ['detach', mountPoint, '-force', '-quiet']).catch((detachErr) => {
            opts.logger?.warn?.('omnimux-pibrowse: failed to detach dmg mount point', {
              mountPoint,
              error: detachErr instanceof Error ? detachErr.message : String(detachErr),
            })
          })
        })
      }
    }
  }

  /**
   * Download, SHA-256 verify, and install `fury-agent` on supported prebuilt targets (`darwin-arm64`).
   */
  async function installAgent() {
    if (agentInFlight) return agentInFlight
    const info = getPlatformInfo({ platform: opts.platform, arch: opts.arch })
    if (!info.prebuiltSupported) {
      throw new PibrowseError('unsupported-platform', info.unsupportedGuidance)
    }
    const asset = PINNED_UPSTREAM.assets[info.targetKey].dmg
    const dmgPath = join(opts.paths.downloadsDir, asset.filename)

    agentInFlight = (async () => {
      state.agent = { status: 'downloading', progress: { downloadedBytes: 0, totalBytes: asset.sizeBytes, percent: 0 }, error: null, updatedAt: Date.now() }
      try {
        const verified = await downloadAndVerifyFile({
          url: asset.url,
          destPath: dmgPath,
          expectedSha256: asset.sha256,
          fetchImpl: opts.fetchImpl,
          onProgress: (progress) => {
            state.agent = { status: 'downloading', progress, error: null, updatedAt: Date.now() }
          },
        })
        state.agent = { status: 'extracting', progress: { downloadedBytes: verified.sizeBytes, totalBytes: verified.sizeBytes, percent: 100 }, error: null, updatedAt: Date.now() }
        try {
          await extractAgentFromDmg(verified.path, asset.appRelativeAgentPath, opts.paths.managedAgentPath)
        } finally {
          await rm(verified.path, { force: true }).catch(() => {})
        }
        const probe = await probeAgentBinary(opts.paths.managedAgentPath)
        state.agent = {
          status: probe.ok ? 'installed' : 'needs-authorization',
          progress: { downloadedBytes: verified.sizeBytes, totalBytes: verified.sizeBytes, percent: 100 },
          error: probe.ok ? null : probe.message,
          updatedAt: Date.now(),
        }
        return {
          ok: true,
          path: opts.paths.managedAgentPath,
          sha256: verified.sha256,
          probe,
        }
      } catch (err) {
        state.agent = {
          status: 'error',
          progress: state.agent.progress,
          error: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now(),
        }
        throw err
      } finally {
        agentInFlight = null
      }
    })()

    return agentInFlight
  }

  /**
   * Download, SHA-256 verify, and install the pinned Chromium 157 Core archive via
   * `fury-agent install-core <archive>` under isolated `FURY_HOME`.
   * @param {{ agentBinaryPath: string }} params
   */
  function installCore({ agentBinaryPath } = {}) {
    if (coreInFlight) return coreInFlight
    const info = getPlatformInfo({ platform: opts.platform, arch: opts.arch })
    if (!info.prebuiltSupported) {
      return Promise.reject(new PibrowseError('unsupported-platform', info.unsupportedGuidance))
    }
    if (!agentBinaryPath) {
      return Promise.reject(new PibrowseError('agent-not-installed', 'Install or configure fury-agent before installing Chromium Core'))
    }
    const asset = PINNED_UPSTREAM.assets[info.targetKey].core
    const archivePath = join(opts.paths.downloadsDir, asset.filename)

    // Transition synchronously so background callers observe `downloading` immediately.
    state.core = { status: 'downloading', progress: { downloadedBytes: 0, totalBytes: asset.sizeBytes, percent: 0 }, error: null, updatedAt: Date.now() }

    coreInFlight = (async () => {
      try {
        const agentCheck = await validateAgentBinaryFile(agentBinaryPath, opts.platform ?? process.platform)
        if (!agentCheck.ok) {
          throw new PibrowseError('agent-not-installed', agentCheck.reason || 'Install or configure fury-agent before installing Chromium Core')
        }
        const verified = await downloadAndVerifyFile({
          url: asset.url,
          destPath: archivePath,
          expectedSha256: asset.sha256,
          fetchImpl: opts.fetchImpl,
          onProgress: (progress) => {
            state.core = { status: 'downloading', progress, error: null, updatedAt: Date.now() }
          },
        })
        state.core = { status: 'extracting', progress: { downloadedBytes: verified.sizeBytes, totalBytes: verified.sizeBytes, percent: 100 }, error: null, updatedAt: Date.now() }
        const coreEnv = { ...process.env }
        delete coreEnv.FURY_API_PORT
        delete coreEnv.FURY_API_TOKEN
        coreEnv.FURY_HOME = opts.paths.dataDir
        coreEnv.FURY_SOCKET = opts.paths.socketPath
        try {
          await execFile(agentBinaryPath, ['install-core', verified.path], {
            env: coreEnv,
            timeout: 180_000,
          })
        } finally {
          await rm(verified.path, { force: true }).catch(() => {})
        }
        state.core = {
          status: 'installed',
          progress: { downloadedBytes: verified.sizeBytes, totalBytes: verified.sizeBytes, percent: 100 },
          error: null,
          updatedAt: Date.now(),
        }
        return {
          ok: true,
          sha256: verified.sha256,
          chromiumVersion: PINNED_UPSTREAM.chromiumVersion,
        }
      } catch (err) {
        state.core = {
          status: 'error',
          progress: state.core.progress,
          error: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now(),
        }
        throw err
      } finally {
        coreInFlight = null
      }
    })()

    return coreInFlight
  }

  /**
   * Clear temporary downloads and extracted Core cache under isolated `$DSH_HOME/omnimux/pibrowse/`.
   * Never touches browser profile data.
   */
  async function clearCache() {
    await rm(opts.paths.downloadsDir, { recursive: true, force: true })
    await rm(join(opts.paths.dataDir, 'core.bundle'), { recursive: true, force: true })
    await rm(join(opts.paths.dataDir, 'core'), { recursive: true, force: true })
    await mkdir(opts.paths.downloadsDir, { recursive: true, mode: 0o700 })
    state.core = { status: 'idle', progress: null, error: null, updatedAt: Date.now() }
    return {
      ok: true,
      clearedDownloads: true,
      clearedCore: true,
    }
  }

  return {
    getStatus,
    probeAgentBinary,
    extractAgentFromDmg,
    installAgent,
    installCore,
    clearCache,
  }
}
