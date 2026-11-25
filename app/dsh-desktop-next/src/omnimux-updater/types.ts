/** Shared types for the standalone OmniMux desktop updater subsystem. */

export type OmniMuxUpdateChannel = 'stable' | 'beta'

export type OmniMuxUpdateEnvironment = 'production' | 'dev' | 'source' | 'portable' | 'linux'

export type OmniMuxArtifactTarget = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

export type OmniMuxUpdateUrgency = 'normal' | 'critical'

export type OmniMuxUpdateErrorCode =
  | 'OFFLINE'
  | 'HTTP_ERROR'
  | 'MANIFEST_INVALID'
  | 'SIGNATURE_INVALID'
  | 'CHANNEL_MISMATCH'
  | 'UNSUPPORTED_OS'
  | 'INSUFFICIENT_SPACE'
  | 'APP_TRANSLOCATED'
  | 'PERMISSION_DENIED'
  | 'DOWNLOAD_TIMEOUT'
  | 'DOWNLOAD_ABORTED'
  | 'CHECKSUM_MISMATCH'
  | 'PREPARE_FAILED'
  | 'ACTIVE_TASKS_BLOCKED'
  | 'INSTALL_FAILED'

export interface OmniMuxArtifactEntry {
  readonly url: string
  readonly sha256: string
  readonly size: number
  readonly minOsVersion?: string
}

export interface OmniMuxReleaseNotes {
  readonly zh: readonly string[]
  readonly en: readonly string[]
}

export interface OmniMuxRolloutPolicy {
  readonly percentage: number
  readonly salt: string
}

export interface OmniMuxManifestV2 {
  readonly schemaVersion: 2
  readonly product: 'omnimux'
  readonly channel: OmniMuxUpdateChannel
  readonly version: string
  readonly publishedAt: string
  readonly dshVersion?: string
  readonly minSupportedVersion?: string
  readonly urgency: OmniMuxUpdateUrgency
  readonly rollout: OmniMuxRolloutPolicy
  readonly releaseNotesUrl: string
  readonly notes: OmniMuxReleaseNotes
  readonly artifacts: Readonly<Partial<Record<OmniMuxArtifactTarget, OmniMuxArtifactEntry>>>
}

export interface OmniMuxSignatureEnvelope {
  readonly schemaVersion: 1
  readonly algorithm: 'ed25519'
  readonly keyId: string
  readonly signature: string
  readonly signedAt: string
}

export interface ResolvedUpdateCheck {
  readonly status: 'up-to-date' | 'update-available'
  readonly source: 'v2' | 'v1-legacy'
  readonly currentVersion: string
  readonly latestVersion: string
  readonly channel: OmniMuxUpdateChannel
  readonly mandatory: boolean
  readonly minSupportedVersion?: string
  readonly releaseNotesUrl: string
  readonly notes: OmniMuxReleaseNotes
  readonly artifact?: OmniMuxArtifactEntry
  readonly target?: OmniMuxArtifactTarget
  readonly deferredByRollout?: boolean
}

/** Serializable update progress shared by settings, sidebar, overlay, recovery, and tray. */
export interface NextUpdateState {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'preparing' | 'ready' | 'installing' | 'error'
  version?: string
  received?: number
  total?: number
  /** Legacy high-level error bucket kept for compatibility with existing UI/tests. */
  error?: 'service' | 'download' | 'prepare' | 'install' | 'development' | 'unsupported'
  /** Structured diagnostic error code for actionable user guidance and update journal. */
  errorCode?: OmniMuxUpdateErrorCode
  /** Safe, non-secret technical detail (e.g. HTTP status, required MiB, min OS version). */
  errorDetail?: string
  installable: boolean
  /** A Windows copy run from the portable ZIP, which Setup cannot replace. */
  portable?: boolean
  /** Running packaging/deployment form of this client. */
  environment?: OmniMuxUpdateEnvironment
  /** Active update channel. */
  channel?: OmniMuxUpdateChannel
  /** Whether the discovered update is mandatory (current < minSupportedVersion or critical urgency). */
  mandatory?: boolean
  minSupportedVersion?: string
  /** In-app release notes highlights for the discovered or latest release. */
  releaseNotes?: OmniMuxReleaseNotes
  releaseNotesUrl?: string
  /** Expected byte size of the target installer artifact. */
  artifactSize?: number
  /** Set once after launching with `--updated` when version advanced, until dismissed. */
  justUpdatedFrom?: string
}

export type UpdateHttpRequest = (url: string, init: RequestInit) => Promise<Response>

export interface UpdateArtifactResponse {
  readonly response: Response
  readonly finalUrl: string
}

export type UpdateArtifactRequest = (url: string, init: RequestInit) => Promise<UpdateArtifactResponse>
