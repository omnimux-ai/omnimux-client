/** Main-process OmniMux update coordinator: polling, backoff, channel switching, cancel, and install handoff. */

import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getOrCreateDesktopInstallationId } from '../../../dsh-plugin-desktop/src/desktop-installation-id.ts'
import { atomicJson, privateDirectory, readPrivateFile } from '../private-files.ts'
import type { UpdateArch } from '../update-arch.ts'
import { downloadOmniMuxArtifact, omnimuxInstallerFilename } from './downloader.ts'
import { checkOmniMuxManifest, OmniMuxUpdateError } from './manifest.ts'
import { OmniMuxUpdateJournal } from './journal.ts'
import { runUpdatePreflight } from './preflight.ts'
import { compareSemVer } from './semver.ts'
import type {
  NextUpdateState,
  OmniMuxUpdateChannel,
  OmniMuxUpdateEnvironment,
  OmniMuxUpdateErrorCode,
  ResolvedUpdateCheck,
  UpdateArtifactRequest,
  UpdateHttpRequest,
} from './types.ts'

const INITIAL_POLL_DELAY_MS = 30_000
const NORMAL_POLL_INTERVAL_MS = 6 * 60 * 60_000
const FAILURE_BASE_BACKOFF_MS = 10 * 60_000
const POLL_JITTER_RATIO = 0.2

interface PersistedUpdaterState {
  notifiedVersion?: string
  lastLaunchedVersion?: string
}

export interface OmniMuxUpdateCoordinatorOptions {
  readonly version: string
  readonly platform: string
  readonly executablePath: string
  readonly environment: OmniMuxUpdateEnvironment
  readonly channel?: OmniMuxUpdateChannel
  readonly userData: string
  readonly downloads?: string
  readonly arch?: UpdateArch
  readonly osVersion?: string
  readonly request: UpdateHttpRequest
  readonly artifactRequest: UpdateArtifactRequest
  readonly manifestBaseUrl?: string
  readonly legacyBaseUrl?: string
  readonly downloadBaseUrl?: string
  readonly allowedHosts?: readonly string[]
  readonly publicKeys?: Readonly<Record<string, string>>
  readonly requireSignature?: boolean
  readonly idleTimeoutMs?: number
  readonly maxChunkRetries?: number
  readonly retryBaseDelayMs?: number
  readonly random?: () => number
  readonly preflight?: (requiredArtifactBytes: number, downloadDir: string) => Promise<void>
  readonly changed: () => void
  readonly available?: (version: string) => void
  readonly log: (error: unknown) => void
  readonly prepare: (path: string, version: string, directory: string, signal: AbortSignal) => Promise<void>
  /** Returns false if the user cancelled installation (e.g. active task warning); throws on install failure. */
  readonly install: () => Promise<boolean | void>
}

function legacyBucketFor(code: OmniMuxUpdateErrorCode, stage: 'check' | 'download' | 'prepare' | 'install'): NextUpdateState['error'] {
  if (stage === 'check') return 'service'
  if (stage === 'prepare') return 'prepare'
  if (stage === 'install') return 'install'
  if (code === 'PREPARE_FAILED') return 'prepare'
  if (code === 'INSTALL_FAILED' || code === 'ACTIVE_TASKS_BLOCKED') return 'install'
  return 'download'
}

function classifyError(error: unknown, fallbackCode: OmniMuxUpdateErrorCode): { code: OmniMuxUpdateErrorCode; detail?: string } {
  if (error instanceof OmniMuxUpdateError) {
    return { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOSPC/u.test(message)) return { code: 'INSUFFICIENT_SPACE', detail: 'ENOSPC' }
  if (/EACCES|EPERM/u.test(message)) return { code: 'PERMISSION_DENIED', detail: 'EACCES' }
  return { code: fallbackCode }
}

export class OmniMuxUpdateCoordinator {
  private state: NextUpdateState
  private channel: OmniMuxUpdateChannel
  private result?: ResolvedUpdateCheck
  private operation?: Promise<void>
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private directory?: string
  private persisted: PersistedUpdaterState = {}
  private persistedLoaded = false
  private cacheReady?: Promise<void>
  private revision = 0
  private consecutiveFailures = 0
  private disposed = false
  private readonly journal: OmniMuxUpdateJournal

  constructor(private readonly options: OmniMuxUpdateCoordinatorOptions) {
    this.channel = options.channel ?? 'stable'
    const portable = options.environment === 'portable'
    const installable = options.environment === 'production' && ['darwin', 'win32'].includes(options.platform)
    this.journal = new OmniMuxUpdateJournal(options.userData, options.version)
    this.state = {
      phase: 'idle',
      installable,
      environment: options.environment,
      channel: this.channel,
      ...(portable ? { portable: true } : {}),
    }
  }

  snapshot(): NextUpdateState {
    return { ...this.state }
  }

  get activeChannel(): OmniMuxUpdateChannel {
    return this.channel
  }

  /** Apply persisted channel preference at startup before polling begins (no network check). */
  setInitialChannel(channel: OmniMuxUpdateChannel): void {
    if (this.disposed || this.operation !== undefined || this.state.phase !== 'idle') return
    if (channel === this.channel) return
    this.channel = channel
    this.state = { ...this.state, channel }
  }

  private get stateDir(): string {
    return join(this.options.userData, 'omnimux-updates')
  }

  private get legacyStateDir(): string {
    return join(this.options.userData, 'next-updates')
  }

  private get downloads(): string {
    return this.options.downloads ?? this.stateDir
  }

  private loadPersistedSync(): void {
    if (this.persistedLoaded) return
    this.persistedLoaded = true
    for (const candidate of [join(this.stateDir, 'state.json'), join(this.legacyStateDir, 'state.json')]) {
      try {
        const text = readPrivateFile(candidate, 4096)
        if (!text) continue
        const parsed = JSON.parse(text) as PersistedUpdaterState
        if (typeof parsed.notifiedVersion === 'string' && this.persisted.notifiedVersion === undefined) {
          this.persisted.notifiedVersion = parsed.notifiedVersion
        }
        if (typeof parsed.lastLaunchedVersion === 'string' && this.persisted.lastLaunchedVersion === undefined) {
          this.persisted.lastLaunchedVersion = parsed.lastLaunchedVersion
        }
      } catch (error) {
        this.options.log(error)
      }
    }
  }

  private initializeCache(): Promise<void> {
    this.loadPersistedSync()
    return this.cacheReady ??= (async () => {
      if (this.disposed) return
      privateDirectory(this.stateDir)
      // Clean leftover staging directories from earlier launches.
      for (const directory of new Set([this.stateDir, this.legacyStateDir, this.downloads])) {
        if (this.disposed) return
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw error
        })
        if (this.disposed) return
        for (const entry of entries) {
          if (entry.isDirectory() && /^download-[A-Za-z0-9]+$/u.test(entry.name)) {
            await rm(join(directory, entry.name), { recursive: true, force: true }).catch(this.options.log)
          }
        }
      }
    })()
  }

  private savePersisted(): void {
    if (this.disposed) return
    try {
      privateDirectory(this.stateDir)
      atomicJson(join(this.stateDir, 'state.json'), this.persisted)
    } catch (error) {
      this.options.log(error)
    }
  }

  /**
   * Call once on startup with `process.argv`: records current version and, when launched with
   * `--updated` after advancing from an older version, surfaces a one-time post-update notice.
   * Executes synchronously so shutdown and Safe Mode teardown never race with background I/O.
   */
  async observeLaunchArguments(argv: readonly string[]): Promise<boolean> {
    if (this.disposed) return false
    this.loadPersistedSync()
    const previous = this.persisted.lastLaunchedVersion
    const launchedAfterUpdate = argv.includes('--updated')
    this.persisted.lastLaunchedVersion = this.options.version
    this.savePersisted()

    if (launchedAfterUpdate && previous !== undefined) {
      const cmp = compareSemVer(this.options.version, previous)
      if (cmp !== null && cmp > 0) {
        this.journal.record({
          event: 'update-completed',
          channel: this.channel,
          previousVersion: previous,
          targetVersion: this.options.version,
        })
        this.set({ justUpdatedFrom: previous })
        return true
      }
    }
    return false
  }

  dismissPostUpdateNotice(): void {
    if (this.state.justUpdatedFrom === undefined) return
    this.set({ justUpdatedFrom: undefined })
  }

  private set(patch: Partial<NextUpdateState>): void {
    if (this.disposed) return
    const next: NextUpdateState = {
      ...this.state,
      error: undefined,
      errorCode: undefined,
      errorDetail: undefined,
      ...patch,
      channel: this.channel,
    }
    if (next.justUpdatedFrom === undefined) delete next.justUpdatedFrom
    if (next.error === undefined) delete next.error
    if (next.errorCode === undefined) delete next.errorCode
    if (next.errorDetail === undefined) delete next.errorDetail
    this.state = next
    this.options.changed()
  }

  private nextPollDelayMs(): number {
    const base = this.consecutiveFailures === 0
      ? NORMAL_POLL_INTERVAL_MS
      : Math.min(NORMAL_POLL_INTERVAL_MS, FAILURE_BASE_BACKOFF_MS * (2 ** Math.min(this.consecutiveFailures - 1, 10)))
    const rand = (this.options.random ?? Math.random)()
    const jittered = Math.round(base * (1 + (rand * 2 - 1) * POLL_JITTER_RATIO))
    return Math.max(60_000, Math.min(NORMAL_POLL_INTERVAL_MS, jittered))
  }

  private schedulePoll(delayMs: number): void {
    if (this.disposed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.disposed) return
      const run = ['idle', 'current', 'error'].includes(this.state.phase)
        ? this.check(true)
        : Promise.resolve()
      void run.finally(() => {
        if (!this.disposed) this.schedulePoll(this.nextPollDelayMs())
      })
    }, delayMs)
    this.timer.unref()
  }

  start(): void {
    if (this.options.environment !== 'production' && this.options.environment !== 'portable' && this.options.environment !== 'linux') {
      return
    }
    if (this.timer !== undefined || this.disposed) return
    void this.initializeCache().catch(this.options.log)
    this.schedulePoll(INITIAL_POLL_DELAY_MS)
  }

  private run(task: (signal: AbortSignal, rev: number) => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.operation !== undefined) return this.operation
    const controller = new AbortController()
    this.controller = controller
    const rev = this.revision
    const op = (async () => {
      try {
        await this.initializeCache()
        controller.signal.throwIfAborted()
        await task(controller.signal, rev)
      } catch (error) {
        if (!controller.signal.aborted && rev === this.revision && !this.disposed) {
          this.options.log(error)
          const classified = classifyError(error, 'OFFLINE')
          this.set({ phase: 'error', error: 'download', errorCode: classified.code, errorDetail: classified.detail })
        }
      }
    })().finally(() => {
      if (this.operation === op) this.operation = undefined
      if (this.controller === controller) this.controller = undefined
    })
    this.operation = op
    return op
  }

  private async query(signal: AbortSignal, manual: boolean): Promise<ResolvedUpdateCheck> {
    let installationId: string | undefined
    if (['production', 'portable'].includes(this.options.environment) && ['darwin', 'win32'].includes(this.options.platform)) {
      try {
        installationId = await getOrCreateDesktopInstallationId(this.options.userData)
      } catch (error) {
        this.options.log(error)
      }
    }
    return checkOmniMuxManifest({
      currentVersion: this.options.version,
      channel: this.channel,
      platform: this.options.platform,
      arch: this.options.arch,
      osVersion: this.options.osVersion,
      installationId,
      manual,
      request: this.options.request,
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      manifestBaseUrl: this.options.manifestBaseUrl,
      legacyBaseUrl: this.options.legacyBaseUrl,
      downloadBaseUrl: this.options.downloadBaseUrl,
      allowedHosts: this.options.allowedHosts,
      publicKeys: this.options.publicKeys,
      requireSignature: this.options.requireSignature,
    })
  }

  check(background = false): Promise<void> {
    if (this.state.phase === 'ready' || this.state.phase === 'installing') return Promise.resolve()
    return this.run(async (signal, rev) => {
      const started = performance.now()
      this.journal.record({ event: 'check-start', channel: this.channel })
      this.set({ phase: 'checking' })
      try {
        const result = await this.query(signal, !background)
        if (rev !== this.revision || this.disposed) return
        this.consecutiveFailures = 0
        this.result = result
        const phase = result.status === 'update-available' ? 'available' : 'current'
        this.journal.record({
          event: 'check-result',
          channel: this.channel,
          phase,
          targetVersion: result.latestVersion,
          durationMs: performance.now() - started,
        })
        this.set({
          phase,
          version: result.latestVersion,
          mandatory: result.mandatory,
          minSupportedVersion: result.minSupportedVersion,
          releaseNotes: result.notes,
          releaseNotesUrl: result.releaseNotesUrl,
          artifactSize: result.artifact && result.artifact.size > 0 ? result.artifact.size : undefined,
        })
        if (result.status === 'update-available') {
          if (background && result.latestVersion !== this.persisted.notifiedVersion) {
            this.persisted.notifiedVersion = result.latestVersion
            this.savePersisted()
            if (!this.disposed) this.options.available?.(result.latestVersion)
          } else if (!background && result.latestVersion !== this.persisted.notifiedVersion) {
            this.persisted.notifiedVersion = result.latestVersion
            this.savePersisted()
          }
        }
      } catch (error) {
        if (signal.aborted || rev !== this.revision || this.disposed) return
        this.consecutiveFailures += 1
        this.options.log(error)
        const classified = classifyError(error, 'OFFLINE')
        this.journal.record({
          event: 'error',
          channel: this.channel,
          phase: 'error',
          errorCode: classified.code,
          detail: classified.detail,
          durationMs: performance.now() - started,
        })
        this.set({
          phase: 'error',
          error: legacyBucketFor(classified.code, 'check'),
          errorCode: classified.code,
          errorDetail: classified.detail,
          // Keep existing mandatory block if already established.
          mandatory: this.state.mandatory,
        })
      }
    })
  }

  download(): Promise<void> {
    if (!this.state.installable) {
      const error = this.options.environment === 'dev' || this.options.environment === 'source'
        ? 'development'
        : 'unsupported'
      this.set({ phase: 'error', error })
      return Promise.resolve()
    }
    if (this.state.phase === 'ready' || this.state.phase === 'installing') return Promise.resolve()
    return this.run(async (signal, rev) => {
      const started = performance.now()
      let stage: 'check' | 'download' | 'prepare' = 'check'
      try {
        this.set({ phase: 'checking' })
        const result = await this.query(signal, true)
        if (rev !== this.revision || this.disposed) return
        this.result = result
        if (result.status !== 'update-available') {
          this.set({
            phase: 'current',
            version: result.latestVersion,
            mandatory: false,
            releaseNotes: result.notes,
            releaseNotesUrl: result.releaseNotesUrl,
          })
          return
        }
        if (result.artifact === undefined) {
          throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest did not include an installer artifact for this platform')
        }
        if (result.latestVersion !== this.persisted.notifiedVersion) {
          this.persisted.notifiedVersion = result.latestVersion
          this.savePersisted()
        }

        stage = 'download'
        const downloadsDir = this.downloads
        await mkdir(downloadsDir, { recursive: true, mode: 0o700 })
        if (this.options.preflight !== undefined) {
          await this.options.preflight(result.artifact.size, downloadsDir)
        } else {
          await runUpdatePreflight({
            platform: this.options.platform,
            executablePath: this.options.executablePath,
            downloadDir: downloadsDir,
            requiredArtifactBytes: result.artifact.size,
          })
        }
        if (this.directory !== undefined) {
          await rm(this.directory, { recursive: true, force: true })
        }
        const directory = this.directory = await mkdtemp(join(downloadsDir, 'download-'))
        this.journal.record({ event: 'download-start', channel: this.channel, targetVersion: result.latestVersion })
        this.set({
          phase: 'downloading',
          version: result.latestVersion,
          received: 0,
          total: result.artifact.size > 0 ? result.artifact.size : undefined,
          mandatory: result.mandatory,
          minSupportedVersion: result.minSupportedVersion,
          releaseNotes: result.notes,
          releaseNotesUrl: result.releaseNotesUrl,
          artifactSize: result.artifact.size > 0 ? result.artifact.size : undefined,
        })

        const platform = this.options.platform as 'darwin' | 'win32'
        let lastProgress = 0
        const filePath = await downloadOmniMuxArtifact({
          url: result.artifact.url,
          platform,
          destinationPath: join(directory, omnimuxInstallerFilename(platform, result.latestVersion, this.options.arch)),
          expectedSha256: result.artifact.sha256,
          expectedSize: result.artifact.size > 0 ? result.artifact.size : undefined,
          request: this.options.artifactRequest,
          allowedHosts: this.options.allowedHosts,
          idleTimeoutMs: this.options.idleTimeoutMs,
          maxChunkRetries: this.options.maxChunkRetries,
          retryBaseDelayMs: this.options.retryBaseDelayMs,
          signal,
          onProgress: (received, total) => {
            if (Date.now() - lastProgress < 250 && received !== total) return
            lastProgress = Date.now()
            this.set({ received, total })
          },
        })
        signal.throwIfAborted()
        if (rev !== this.revision || this.disposed) return

        this.journal.record({
          event: 'download-complete',
          channel: this.channel,
          targetVersion: result.latestVersion,
          durationMs: performance.now() - started,
        })
        stage = 'prepare'
        this.set({ phase: 'preparing' })
        await this.options.prepare(filePath, result.latestVersion, directory, signal)
        signal.throwIfAborted()
        if (rev !== this.revision || this.disposed) return

        this.journal.record({
          event: 'prepare-complete',
          channel: this.channel,
          targetVersion: result.latestVersion,
          durationMs: performance.now() - started,
        })
        this.set({ phase: 'ready' })
      } catch (error) {
        if (rev !== this.revision || this.disposed) return
        const classified = classifyError(error, stage === 'prepare' ? 'PREPARE_FAILED' : stage === 'check' ? 'OFFLINE' : 'OFFLINE')
        if (signal.aborted || classified.code === 'DOWNLOAD_ABORTED') {
          this.journal.record({ event: 'download-cancelled', channel: this.channel, targetVersion: this.state.version })
          if (this.directory !== undefined) {
            await rm(this.directory, { recursive: true, force: true }).catch(this.options.log)
            this.directory = undefined
          }
          // Return cleanly to `available` so the user can restart the download anytime.
          if (this.result?.status === 'update-available') {
            this.set({ phase: 'available', received: undefined, total: undefined })
          } else {
            this.set({ phase: 'idle', received: undefined, total: undefined })
          }
          return
        }
        this.options.log(error)
        this.journal.record({
          event: 'error',
          channel: this.channel,
          phase: 'error',
          targetVersion: this.state.version,
          errorCode: classified.code,
          detail: classified.detail,
          durationMs: performance.now() - started,
        })
        this.set({
          phase: 'error',
          error: legacyBucketFor(classified.code, stage),
          errorCode: classified.code,
          errorDetail: classified.detail,
        })
      }
    })
  }

  /** Cancel an in-progress download or check and clean up partial files. */
  async cancelDownload(): Promise<void> {
    if (this.disposed || this.state.phase !== 'downloading') return
    this.controller?.abort(new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'Cancelled by user'))
    await this.operation
  }

  async install(): Promise<void> {
    if (this.disposed || this.state.phase !== 'ready') return
    this.journal.record({ event: 'install-requested', channel: this.channel, targetVersion: this.state.version })
    this.set({ phase: 'installing' })
    try {
      const proceeded = await this.options.install()
      if (proceeded === false) {
        this.set({ phase: 'ready' })
        return
      }
      this.journal.record({ event: 'install-handoff', channel: this.channel, targetVersion: this.state.version })
    } catch (error) {
      this.options.log(error)
      const classified = classifyError(error, 'INSTALL_FAILED')
      this.journal.record({
        event: 'error',
        channel: this.channel,
        phase: 'error',
        targetVersion: this.state.version,
        errorCode: classified.code,
        detail: classified.detail,
      })
      this.set({
        phase: 'error',
        error: 'install',
        errorCode: classified.code,
        errorDetail: classified.detail,
      })
    }
  }

  /**
   * Switch update channel, retiring any staged download from the previous channel,
   * persisting the choice via `persist`, and immediately checking the new channel.
   */
  async switchChannel(nextChannel: OmniMuxUpdateChannel, persist?: (channel: OmniMuxUpdateChannel) => Promise<void> | void): Promise<void> {
    if (this.disposed || this.state.phase === 'installing') {
      throw new OmniMuxUpdateError('INSTALL_FAILED', 'Cannot switch update channel during installation')
    }
    if (nextChannel === this.channel && this.state.phase !== 'error') return
    await persist?.(nextChannel)
    this.revision += 1
    this.controller?.abort(new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'Channel switched'))
    await this.operation
    if (this.directory !== undefined) {
      await rm(this.directory, { recursive: true, force: true }).catch(this.options.log)
      this.directory = undefined
    }
    this.result = undefined
    this.channel = nextChannel
    this.consecutiveFailures = 0
    this.journal.record({ event: 'channel-switched', channel: nextChannel })
    this.set({
      phase: 'idle',
      version: undefined,
      received: undefined,
      total: undefined,
      mandatory: false,
      minSupportedVersion: undefined,
      releaseNotes: undefined,
      releaseNotesUrl: undefined,
      artifactSize: undefined,
    })
    await this.check(false)
  }

  async dispose(keepInstaller = false): Promise<void> {
    this.disposed = true
    clearTimeout(this.timer)
    this.controller?.abort()
    await this.operation
    if (this.directory !== undefined && !keepInstaller) {
      await rm(this.directory, { recursive: true, force: true }).catch(this.options.log)
      this.directory = undefined
    }
  }
}
