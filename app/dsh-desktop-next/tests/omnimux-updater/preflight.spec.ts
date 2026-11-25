import { expect, it } from 'vitest'
import { isMacAppTranslocated, runUpdatePreflight } from '../../src/omnimux-updater/preflight.ts'

it('detects macOS App Translocation and direct DMG volume launches', async () => {
  expect(isMacAppTranslocated('/private/var/folders/xx/T/AppTranslocation/ABC/d/OmniMux.app/Contents/MacOS/OmniMux')).toBe(true)
  expect(isMacAppTranslocated('/Volumes/OmniMux/OmniMux.app/Contents/MacOS/OmniMux')).toBe(true)
  expect(isMacAppTranslocated('/Applications/OmniMux.app/Contents/MacOS/OmniMux')).toBe(false)

  await expect(runUpdatePreflight({
    platform: 'darwin',
    executablePath: '/private/var/folders/xx/T/AppTranslocation/ABC/d/OmniMux.app/Contents/MacOS/OmniMux',
    downloadDir: '/tmp',
    requiredArtifactBytes: 100 * 1024 * 1024,
  })).rejects.toMatchObject({ code: 'APP_TRANSLOCATED' })
})

it('reports PERMISSION_DENIED when macOS bundle parent is not writable', async () => {
  await expect(runUpdatePreflight({
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    downloadDir: '/tmp',
    requiredArtifactBytes: 10 * 1024 * 1024,
    accessFn: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) },
  })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
})

it('reports INSUFFICIENT_SPACE when free disk bytes fall below platform safety multiplier', async () => {
  const artifactBytes = 100 * 1024 * 1024 // macOS requires 2.5x = 250 MB
  await expect(runUpdatePreflight({
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    downloadDir: '/tmp',
    requiredArtifactBytes: artifactBytes,
    accessFn: async () => {},
    statfsFn: async () => ({ bavail: 200, bsize: 1024 * 1024 }), // only 200 MB
  })).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE', detail: '250 MB' })

  await expect(runUpdatePreflight({
    platform: 'darwin',
    executablePath: '/Applications/OmniMux.app/Contents/MacOS/OmniMux',
    downloadDir: '/tmp',
    requiredArtifactBytes: artifactBytes,
    accessFn: async () => {},
    statfsFn: async () => ({ bavail: 300, bsize: 1024 * 1024 }), // 300 MB OK
  })).resolves.toBeUndefined()
})
