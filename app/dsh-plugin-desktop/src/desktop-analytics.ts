/** Asynchronous Desktop lifecycle telemetry for the configured Umami collector. */

import { lstat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseDesktopInstallationId, type DesktopInstallationIdentity } from './desktop-installation-id.ts'
import type { DesktopLogger } from './desktop-logger.ts'
import type { DesktopLifecycleSummary } from './lifecycle-events.ts'
import { DEFAULT_ANALYTICS_HOSTNAME, DEFAULT_ANALYTICS_URL, DEFAULT_ANALYTICS_USER_AGENT, umamiEventRequest } from './umami-event.ts'

export { DEFAULT_ANALYTICS_HOSTNAME, DEFAULT_ANALYTICS_URL, DEFAULT_ANALYTICS_USER_AGENT } from './umami-event.ts'

export const DESKTOP_LAUNCH_TIMEOUT_MS = 3_000
export const DEFAULT_ANALYTICS_TIMEOUT_MS = 5_000
export const EXIT_ANALYTICS_TIMEOUT_MS = 1_500
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000

// Keep the historical filename so an existing first-run marker still counts on upgrade.
export const FIRST_RUN_REPORTED_RELATIVE_PATH = join('identity', 'first-run-reported')

const DESKTOP_LAUNCH_EVENT = 'desktop_app_launch'
const PRIVATE_FILE_MODE = 0o600

type AnalyticsFetchRequest = (url: string, init: RequestInit) => Promise<Response>
type DesktopAnalyticsEvent = typeof DESKTOP_LAUNCH_EVENT | 'app-startup' | 'app-session'
type DesktopAnalyticsLogger = Pick<DesktopLogger, 'info' | 'error'>

export interface DesktopAnalyticsOptions {
  readonly endpoint?: string
  readonly websiteId?: string
  readonly timeoutMs?: number
  readonly disabled?: boolean
  readonly userDataDir: string
  readonly logger?: DesktopAnalyticsLogger
  readonly request?: AnalyticsFetchRequest
  readonly monotonicNow?: () => number
}

interface AnalyticsDestination {
  readonly endpoint: string
  readonly websiteId: string
}

interface DesktopLaunchAnalyticsData {
  readonly appVersion: string
  readonly platform: NodeJS.Platform
  readonly osVersion: string
}

export interface DesktopStartupAnalyticsData {
  readonly appVersion: string
  readonly platform: string
  readonly arch: string
  readonly finalStage?: string | undefined
  readonly rendererStatus?: string | undefined
  readonly totalDurationMs?: number | undefined
  readonly electronReadyMs?: number | undefined
  readonly shellEnvironmentMs?: number | undefined
  readonly runtimeBootstrapMs?: number | undefined
  readonly profileSelectionMs?: number | undefined
  readonly profileCompositionMs?: number | undefined
  readonly hostBootMs?: number | undefined
  readonly rendererStartupMs?: number | undefined
  readonly healthCommitMs?: number | undefined
  readonly stages?: Record<string, number | undefined> | undefined
}

export interface DesktopSessionAnalyticsData {
  readonly durationMs: number
  readonly cleanExit: boolean
  readonly appVersion: string
  readonly platform: string
  readonly arch: string
}

export class DesktopAnalyticsClient {
  private readonly destination: AnalyticsDestination | undefined
  private readonly defaultTimeoutMs: number
  private readonly userDataDir: string
  private readonly logger: DesktopAnalyticsLogger | undefined
  private readonly request: AnalyticsFetchRequest
  private readonly monotonicNow: () => number
  private readonly sessionStartTime: number
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private launchAttempted = false
  private sessionReported = false

  constructor(options: DesktopAnalyticsOptions) {
    this.logger = options.logger
    this.destination = this.configuredDestination(options)
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_ANALYTICS_TIMEOUT_MS
    this.userDataDir = options.userDataDir
    this.request = options.request ?? ((url, init) => globalThis.fetch(url, init))
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.sessionStartTime = this.monotonicNow()
  }

  private configuredDestination(options: DesktopAnalyticsOptions): AnalyticsDestination | undefined {
    const env = process.env
    const disabled = options.disabled ?? (env.OMNIMUX_ANALYTICS_DISABLED === '1' || env.OMNIMUX_ANALYTICS_DISABLED === 'true')
    if (disabled) return undefined
    const endpoint = (options.endpoint ?? env.OMNIMUX_ANALYTICS_ENDPOINT)?.trim()
    const websiteId = (options.websiteId ?? env.OMNIMUX_ANALYTICS_WEBSITE_ID)?.trim()
    if (!endpoint && !websiteId) return undefined
    const url = endpoint ? URL.parse(endpoint) : null
    if (!websiteId || !url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      this.logger?.error('desktop-analytics: collector configuration is incomplete or invalid')
      return undefined
    }
    return { endpoint: url.href, websiteId }
  }

  /** Report once after native mount and healthy renderer boot. */
  async reportLaunch(identity: DesktopInstallationIdentity, metadata: DesktopLaunchAnalyticsData): Promise<void> {
    if (this.launchAttempted) return
    this.launchAttempted = true
    const deviceId = parseDesktopInstallationId(identity.id)
    if (deviceId === undefined) {
      this.logger?.error(`desktop-analytics: ${DESKTOP_LAUNCH_EVENT} failed (reason=identity)`)
      return
    }
    if (this.destination !== undefined) this.logger?.info(`desktop-analytics: ${DESKTOP_LAUNCH_EVENT} window-ready`)

    let isFirstLaunch: boolean
    try {
      // Complete the local claim before sending, even if the collector is unavailable or disabled.
      isFirstLaunch = identity.isNew && await this.claimFirstLaunch()
    } catch {
      this.logger?.error(`desktop-analytics: ${DESKTOP_LAUNCH_EVENT} failed (reason=first-launch-marker)`)
      return
    }
    await this.sendEvent(DESKTOP_LAUNCH_EVENT, {
      is_first_launch: isFirstLaunch,
      app_version: metadata.appVersion,
      os: metadata.platform,
      os_version: metadata.osVersion,
      device_id: deviceId,
    }, DESKTOP_LAUNCH_TIMEOUT_MS)
  }

  private async claimFirstLaunch(): Promise<boolean> {
    const marker = join(this.userDataDir, FIRST_RUN_REPORTED_RELATIVE_PATH)
    const directory = await lstat(dirname(marker))
    if (!directory.isDirectory()) throw new Error('Desktop identity directory is not an ordinary directory')
    try {
      // Exclusive creation never follows or replaces an existing marker.
      await writeFile(marker, '1\n', { flag: 'wx', mode: PRIVATE_FILE_MODE })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  }

  /**
   * Report application startup metrics (success or failure).
   */
  async reportStartup(data: DesktopStartupAnalyticsData): Promise<void> {
    await this.sendEvent('app-startup', {
      appVersion: data.appVersion,
      platform: data.platform,
      arch: data.arch,
      ...(data.finalStage ? { finalStage: data.finalStage } : {}),
      ...(data.rendererStatus ? { rendererStatus: data.rendererStatus } : {}),
      ...(typeof data.totalDurationMs === 'number' ? { totalDurationMs: data.totalDurationMs } : {}),
      ...(typeof data.electronReadyMs === 'number' ? { electronReadyMs: data.electronReadyMs } : {}),
      ...(typeof data.shellEnvironmentMs === 'number' ? { shellEnvironmentMs: data.shellEnvironmentMs } : {}),
      ...(typeof data.runtimeBootstrapMs === 'number' ? { runtimeBootstrapMs: data.runtimeBootstrapMs } : {}),
      ...(typeof data.profileSelectionMs === 'number' ? { profileSelectionMs: data.profileSelectionMs } : {}),
      ...(typeof data.profileCompositionMs === 'number' ? { profileCompositionMs: data.profileCompositionMs } : {}),
      ...(typeof data.hostBootMs === 'number' ? { hostBootMs: data.hostBootMs } : {}),
      ...(typeof data.rendererStartupMs === 'number' ? { rendererStartupMs: data.rendererStartupMs } : {}),
      ...(typeof data.healthCommitMs === 'number' ? { healthCommitMs: data.healthCommitMs } : {}),
    })
  }

  /**
   * Report app session heartbeat or clean exit.
   */
  async reportSession(data: DesktopSessionAnalyticsData, timeoutMs = this.defaultTimeoutMs): Promise<void> {
    await this.sendEvent('app-session', {
      durationMs: Math.max(0, Math.round(data.durationMs)),
      cleanExit: data.cleanExit,
      appVersion: data.appVersion,
      platform: data.platform,
      arch: data.arch,
    }, timeoutMs)
  }

  /**
   * Start periodic session heartbeat.
   */
  startHeartbeat(metadata: { appVersion: string; platform: string; arch: string }, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS): void {
    if (this.destination === undefined || this.heartbeatTimer !== undefined) return
    this.heartbeatTimer = setInterval(() => {
      const elapsedMs = this.monotonicNow() - this.sessionStartTime
      void this.reportSession({
        durationMs: elapsedMs,
        cleanExit: false,
        appVersion: metadata.appVersion,
        platform: metadata.platform,
        arch: metadata.arch,
      })
    }, intervalMs)
    if (typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      this.heartbeatTimer.unref()
    }
  }

  /**
   * Stop periodic session heartbeat.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  /**
   * Report session exit during application shutdown with bounded timeout.
   */
  async reportSessionExit(metadata: { appVersion: string; platform: string; arch: string }): Promise<void> {
    if (this.destination === undefined || this.sessionReported) return
    this.sessionReported = true
    this.stopHeartbeat()
    const elapsedMs = this.monotonicNow() - this.sessionStartTime
    await this.reportSession({
      durationMs: elapsedMs,
      cleanExit: true,
      appVersion: metadata.appVersion,
      platform: metadata.platform,
      arch: metadata.arch,
    }, EXIT_ANALYTICS_TIMEOUT_MS)
  }

  /**
   * Core send logic with Umami headers and payload format.
   */
  private async sendEvent(name: DesktopAnalyticsEvent, data: Record<string, unknown>, timeoutMs = this.defaultTimeoutMs): Promise<void> {
    const destination = this.destination
    if (destination === undefined) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref()
    const started = this.monotonicNow()
    const elapsed = () => Math.round(this.monotonicNow() - started)
    try {
      const response = await this.request(destination.endpoint, {
        ...umamiEventRequest({
          website: destination.websiteId,
          hostname: DEFAULT_ANALYTICS_HOSTNAME,
          url: DEFAULT_ANALYTICS_URL,
          name,
          data,
        }, DEFAULT_ANALYTICS_USER_AGENT, controller.signal),
        credentials: 'omit',
        redirect: 'manual',
      })
      await response.body?.cancel()
      if (!response.ok) {
        this.logger?.error(`desktop-analytics: ${name} failed (reason=http status=${response.status} durationMs=${elapsed()})`)
      } else if (name === DESKTOP_LAUNCH_EVENT) {
        this.logger?.info(`desktop-analytics: ${name} sent (status=${response.status} durationMs=${elapsed()})`)
      }
    } catch {
      const reason = controller.signal.aborted ? 'timeout' : 'network'
      this.logger?.error(`desktop-analytics: ${name} failed (reason=${reason} durationMs=${elapsed()})`)
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Helper to build DesktopStartupAnalyticsData from DesktopLifecycleSummary.
 */
export function extractStartupAnalyticsFromSummary(
  summary: DesktopLifecycleSummary,
  metadata: { appVersion: string; platform: string; arch: string },
): DesktopStartupAnalyticsData {
  const stageDurations: Record<string, number | undefined> = {}
  for (const stage of summary.stages) {
    if (stage.durationMs !== undefined) {
      stageDurations[stage.stageId] = stage.durationMs
    }
  }

  const getStage = (id: string) => typeof stageDurations[id] === 'number' ? stageDurations[id] : undefined

  return {
    appVersion: metadata.appVersion,
    platform: metadata.platform,
    arch: metadata.arch,
    ...(summary.finalStage ? { finalStage: summary.finalStage } : {}),
    ...(summary.rendererStatus ? { rendererStatus: summary.rendererStatus } : {}),
    ...(summary.totalDurationMs !== undefined ? { totalDurationMs: summary.totalDurationMs } : {}),
    ...(getStage('electron-ready') !== undefined ? { electronReadyMs: getStage('electron-ready') } : {}),
    ...(getStage('shell-environment') !== undefined ? { shellEnvironmentMs: getStage('shell-environment') } : {}),
    ...(getStage('runtime-bootstrap') !== undefined ? { runtimeBootstrapMs: getStage('runtime-bootstrap') } : {}),
    ...(getStage('profile-selection') !== undefined ? { profileSelectionMs: getStage('profile-selection') } : {}),
    ...(getStage('profile-composition') !== undefined ? { profileCompositionMs: getStage('profile-composition') } : {}),
    ...(getStage('host-boot') !== undefined ? { hostBootMs: getStage('host-boot') } : {}),
    ...(getStage('renderer-startup') !== undefined ? { rendererStartupMs: getStage('renderer-startup') } : {}),
    ...(getStage('health-commit') !== undefined ? { healthCommitMs: getStage('health-commit') } : {}),
    stages: stageDurations,
  }
}
