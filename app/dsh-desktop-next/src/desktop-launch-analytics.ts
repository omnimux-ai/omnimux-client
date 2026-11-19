/** Reports the launch of a usable OmniMux Desktop window when a collector is configured. */
import {
  getOrCreateDesktopInstallationIdentity,
  type DesktopInstallationIdentity,
} from '../../dsh-plugin-desktop/src/desktop-installation-id.ts'
import {
  DEFAULT_ANALYTICS_HOSTNAME,
  DEFAULT_ANALYTICS_URL,
  DEFAULT_ANALYTICS_USER_AGENT,
  umamiEventRequest,
} from '../../dsh-plugin-desktop/src/umami-event.ts'
import type { LogInput } from './log-record.ts'

const LAUNCH_TIMEOUT_MS = 3_000

interface LaunchDestination {
  endpoint: string
  websiteId: string
}

interface DesktopLaunchAnalyticsOptions {
  identityDirectory: string
  previousUserData: readonly string[]
  hadPreviousRun: boolean
  appVersion: string
  platform: string
  systemVersion(): string
  environment: NodeJS.ProcessEnv
  request(url: string, init: RequestInit): Promise<Response>
  record(input: LogInput): void
}

export class DesktopLaunchAnalytics {
  private readonly destination: LaunchDestination | undefined
  private readonly identity: Promise<DesktopInstallationIdentity | undefined>
  private attempted = false

  constructor(private readonly options: DesktopLaunchAnalyticsOptions) {
    this.destination = this.configuredDestination()
    // Persist the installation before any request, including on offline or disabled launches.
    this.identity = getOrCreateDesktopInstallationIdentity(options.identityDirectory, {
      migrateFrom: options.previousUserData,
    }).catch(() => {
      this.failure('identity')
      return undefined
    })
  }

  async reportReady(): Promise<void> {
    if (this.attempted || !this.destination) return
    this.attempted = true
    this.options.record({ source: 'desktop', event: 'analytics.launch.window-ready' })
    const identity = await this.identity
    if (!identity) return

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LAUNCH_TIMEOUT_MS)
    timer.unref()
    const started = performance.now()
    try {
      const request = umamiEventRequest({
        website: this.destination.websiteId,
        hostname: DEFAULT_ANALYTICS_HOSTNAME,
        url: DEFAULT_ANALYTICS_URL,
        name: 'desktop_app_launch',
        data: {
          is_first_launch: identity.isNew && !this.options.hadPreviousRun,
          app_version: this.options.appVersion,
          os: this.options.platform,
          os_version: this.options.systemVersion(),
          device_id: identity.id,
        },
      }, DEFAULT_ANALYTICS_USER_AGENT, controller.signal)
      const response = await this.options.request(this.destination.endpoint, {
        ...request,
        credentials: 'omit',
        redirect: 'error',
      })
      await response.body?.cancel()
      const durationMs = Math.round(performance.now() - started)
      if (!response.ok) this.failure('http', { durationMs, status: response.status })
      else this.options.record({ source: 'desktop', event: 'analytics.launch.sent', fields: { durationMs, status: response.status } })
    } catch {
      const durationMs = Math.round(performance.now() - started)
      this.failure(controller.signal.aborted ? 'timeout' : 'network', { durationMs })
    } finally {
      clearTimeout(timer)
    }
  }

  private configuredDestination(): LaunchDestination | undefined {
    const env = this.options.environment
    if (env.OMNIMUX_ANALYTICS_DISABLED === '1' || env.OMNIMUX_ANALYTICS_DISABLED === 'true') return undefined
    const endpoint = env.OMNIMUX_ANALYTICS_ENDPOINT?.trim()
    const websiteId = env.OMNIMUX_ANALYTICS_WEBSITE_ID?.trim()
    if (!endpoint && !websiteId) return undefined
    const url = endpoint ? URL.parse(endpoint) : null
    if (!websiteId || !url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      this.failure('configuration')
      return undefined
    }
    return { endpoint: url.href, websiteId }
  }

  private failure(reason: string, fields?: { durationMs: number; status?: number }): void {
    this.options.record({
      source: 'desktop',
      event: 'analytics.launch.failed',
      level: 'warn',
      fields: { reason, ...fields },
    })
  }
}
