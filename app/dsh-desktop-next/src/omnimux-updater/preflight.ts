/** Pre-download environment checks: macOS App Translocation, write permissions, and free disk space. */

import { constants } from 'node:fs'
import { access, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { OmniMuxUpdateError } from './manifest.ts'

export interface UpdatePreflightOptions {
  readonly platform: string
  readonly executablePath: string
  readonly downloadDir: string
  readonly requiredArtifactBytes: number
  readonly accessFn?: (path: string, mode?: number) => Promise<void>
  readonly statfsFn?: (path: string) => Promise<{ bavail: number; bsize: number }>
}

/** Detect macOS Gatekeeper App Translocation or direct execution from a mounted read-only DMG volume. */
export function isMacAppTranslocated(executablePath: string): boolean {
  const normalized = executablePath.replaceAll('\\', '/')
  return normalized.includes('/AppTranslocation/') || normalized.startsWith('/Volumes/')
}

/** Locate the enclosing `.app` bundle directory from a macOS executable path. */
export function macBundleFromExecutable(executablePath: string): string | undefined {
  const normalized = executablePath.replaceAll('\\', '/')
  const idx = normalized.indexOf('/Contents/MacOS/')
  if (idx <= 0) return undefined
  const bundle = executablePath.slice(0, idx)
  return bundle.endsWith('.app') ? bundle : undefined
}

async function nearestExistingDirectory(path: string, accessFn: (p: string, mode?: number) => Promise<void>): Promise<string> {
  let current = path
  for (let depth = 0; depth < 12; depth += 1) {
    try {
      await accessFn(current, constants.F_OK)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return path
}

/**
 * Run fast local safety checks before downloading hundreds of megabytes.
 * Throws a typed `OmniMuxUpdateError` so the UI can guide the user immediately.
 */
export async function runUpdatePreflight(options: UpdatePreflightOptions): Promise<void> {
  const accessFn = options.accessFn ?? ((path, mode) => access(path, mode))
  const statfsFn = options.statfsFn ?? ((path) => statfs(path))

  if (options.platform === 'darwin') {
    if (isMacAppTranslocated(options.executablePath)) {
      throw new OmniMuxUpdateError(
        'APP_TRANSLOCATED',
        'OmniMux is running from a disk image or translocated path; move it to Applications first.',
      )
    }
    const bundle = macBundleFromExecutable(options.executablePath)
    if (bundle !== undefined) {
      try {
        await accessFn(dirname(bundle), constants.W_OK)
        await accessFn(bundle, constants.W_OK)
      } catch (cause) {
        throw new OmniMuxUpdateError(
          'PERMISSION_DENIED',
          'Insufficient permission to replace the installed OmniMux application bundle.',
          { detail: dirname(bundle), cause },
        )
      }
    }
  }

  if (options.requiredArtifactBytes > 0) {
    const multiplier = options.platform === 'darwin' ? 2.5 : 2.0
    const requiredBytes = Math.ceil(options.requiredArtifactBytes * multiplier)
    try {
      const targetDir = await nearestExistingDirectory(options.downloadDir, accessFn)
      const stats = await statfsFn(targetDir)
      const availableBytes = Number(stats.bavail) * Number(stats.bsize)
      if (Number.isFinite(availableBytes) && availableBytes >= 0 && availableBytes < requiredBytes) {
        const requiredMiB = Math.ceil(requiredBytes / (1024 * 1024))
        const availableMiB = Math.floor(availableBytes / (1024 * 1024))
        throw new OmniMuxUpdateError(
          'INSUFFICIENT_SPACE',
          `Need at least ${String(requiredMiB)} MB free space, only ${String(availableMiB)} MB available.`,
          { detail: `${String(requiredMiB)} MB` },
        )
      }
    } catch (error) {
      if (error instanceof OmniMuxUpdateError) throw error
      // If the filesystem cannot report statfs (e.g. exotic network mount), do not falsely block.
    }
  }
}
