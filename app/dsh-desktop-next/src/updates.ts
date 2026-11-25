/** Thin adapter preserving the `NextUpdates` entrypoint over the standalone OmniMux update coordinator. */

import {
  OmniMuxUpdateCoordinator,
  type OmniMuxUpdateChannel,
  type OmniMuxUpdateEnvironment,
  type UpdateArtifactRequest,
  type UpdateHttpRequest,
} from './omnimux-updater/index.ts'
import type { UpdateArch } from './update-arch.ts'

export interface NextUpdateOptions {
  version: string
  platform: string
  packaged: boolean
  /** A Windows copy run from the portable ZIP: Setup cannot replace it, so its updates are downloaded by hand. */
  portable?: boolean
  /** Explicit running environment; inferred from packaged/platform/portable when omitted. */
  environment?: OmniMuxUpdateEnvironment
  /** Active release channel (defaults to `stable`). */
  channel?: OmniMuxUpdateChannel
  /** Installed executable path for macOS App Translocation and permission preflight checks. */
  executablePath?: string
  /** Running OS version string for `minOsVersion` enforcement. */
  osVersion?: string
  userData: string
  /** Directory for downloaded installers; defaults to the update state directory in userData. */
  downloads?: string
  /** CPU of this Mac, used to select `darwin-arm64` or `darwin-x64` directly from Manifest v2. */
  arch?: UpdateArch
  /** Fetch adapter for manifest and signature checks. */
  request: UpdateHttpRequest
  /** Installer transport; owns redirect following and per-hop HTTPS verification. */
  artifactRequest: UpdateArtifactRequest
  manifestBaseUrl?: string
  legacyBaseUrl?: string
  downloadBaseUrl?: string
  allowedHosts?: readonly string[]
  publicKeys?: Readonly<Record<string, string>>
  requireSignature?: boolean
  idleTimeoutMs?: number
  maxChunkRetries?: number
  retryBaseDelayMs?: number
  preflight?: (requiredArtifactBytes: number, downloadDir: string) => Promise<void>
  changed(): void
  available?(version: string): void
  log(error: unknown): void
  prepare(path: string, version: string, directory: string, signal: AbortSignal): Promise<void>
  install(): Promise<boolean | void>
}

function resolveEnvironment(options: NextUpdateOptions): OmniMuxUpdateEnvironment {
  if (options.environment !== undefined) return options.environment
  if (options.platform === 'linux') return 'linux'
  if (options.portable === true) return 'portable'
  return options.packaged ? 'production' : 'source'
}

export class NextUpdates extends OmniMuxUpdateCoordinator {
  constructor(options: NextUpdateOptions) {
    super({
      ...options,
      environment: resolveEnvironment(options),
      executablePath: options.executablePath ?? process.execPath,
      channel: options.channel ?? 'stable',
    })
  }
}
