/** Type declarations for build-info.mjs shared by packaging scripts. */

export interface BuildInfo {
  readonly product: string
  readonly version: string
  readonly channel: string
  readonly builtAt: string
  readonly repo: {
    readonly branch: string | null
    readonly commit: string | null
    readonly commitShort: string | null
    readonly dirty: boolean
  }
  readonly upstream: {
    readonly main: string | null
    readonly master: string | null
  }
  readonly dsh: {
    readonly packageSpec: string | null
    readonly submodule: string | null
  }
}

export interface BuildInfoOptions {
  readonly packageDir?: string
  readonly repoRoot?: string
}

export function currentBuildInfo(channel: string, options?: BuildInfoOptions): BuildInfo
export function writeAppBuildInfo(appPath: string, channel?: string, options?: BuildInfoOptions): BuildInfo
