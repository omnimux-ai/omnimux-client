import { execFileSync, spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

type Run = (command: string, args: readonly string[], options: SpawnSyncOptions) => { status: number | null; error?: Error }
const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const repoRoot = resolve(packageRoot, '..', '..')
const packageDevUrl = new URL('../scripts/package-dev.mjs', import.meta.url).href
const { packageNextDev } = await import(packageDevUrl) as {
  packageNextDev(options: {
    platform: NodeJS.Platform
    arch?: string
    run: Run
    renameBundle?: (src: string, dst: string) => void
  }): string
}
const stampScript = fileURLToPath(new URL('../scripts/stamp-dev-app.mjs', import.meta.url))

describe('Next development app packaging', () => {
  it.each(['arm64', 'x64'])('builds, stamps, renames, ad-hoc signs and strictly verifies %s OmniMux Dev.app', arch => {
    const run = vi.fn<Run>().mockReturnValue({ status: 0 })
    const renameBundle = vi.fn()
    const appPath = packageNextDev({ platform: 'darwin', arch, run, renameBundle })
    const macDir = join(packageRoot, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac')
    const rawApp = join(macDir, 'OmniMux.app')
    const devApp = join(macDir, 'OmniMux Dev.app')

    expect(appPath).toBe(devApp)
    expect(renameBundle).toHaveBeenCalledWith(rawApp, devApp)
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [process.execPath, [join(repoRoot, 'scripts', 'prepare-local-plugins.mjs')]],
      ['corepack', ['yarn', 'run', 'build']],
      [process.execPath, [join(packageRoot, 'scripts', 'package.ts'), 'dir']],
      [process.execPath, [stampScript, rawApp]],
      ['codesign', ['--force', '--deep', '--sign', '-', devApp]],
      ['/usr/bin/codesign', ['--verify', '--deep', '--strict', devApp]],
    ])
    expect(run.mock.calls[2]![2]?.env).toMatchObject({
      DSH_BUILD_CHANNEL: 'package-dev',
      DSH_MAC_SMOKE_ARCH: arch,
    })
  })

  it('rejects non-macOS hosts before running any step', () => {
    const run = vi.fn<Run>()
    expect(() => packageNextDev({ platform: 'linux', arch: 'x64', run })).toThrow('native macOS')
    expect(run).not.toHaveBeenCalled()
  })
})

function makeBundle(root: string, buildInfo?: Record<string, unknown> | string): { appPath: string; plistPath: string } {
  const appPath = join(root, 'OmniMux.app')
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  mkdirSync(resourcesDir, { recursive: true })
  writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.omnimux.desktop</string>
<key>CFBundleDisplayName</key><string>OmniMux</string>
</dict></plist>
`)
  if (buildInfo !== undefined) {
    writeFileSync(
      join(resourcesDir, 'build-info.json'),
      typeof buildInfo === 'string' ? buildInfo : JSON.stringify(buildInfo),
    )
  }
  return { appPath, plistPath }
}

describe('Next Dev stamp-dev-app fail-closed guard', () => {
  it.each([
    ['missing', undefined],
    ['malformed', '{broken'],
    ['stable channel', { channel: 'package-dir', releaseChannel: 'stable', shell: 'dsh-desktop-next' }],
    ['wrong shell', { channel: 'package-dev', releaseChannel: 'development', shell: 'dsh-plugin-desktop' }],
  ])('refuses to stamp when build-info.json is %s', (_label, buildInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'next-dev-stamp-'))
    try {
      const { appPath, plistPath } = makeBundle(root, buildInfo)
      const before = readFileSync(plistPath)
      const result = spawnSync(process.execPath, [stampScript, appPath], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('rebuild with corepack yarn package:dev')
      expect(readFileSync(plistPath)).toEqual(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'darwin')('stamps Dev Bundle ID, display name and LSEnvironment on macOS', () => {
    const root = mkdtempSync(join(tmpdir(), 'next-dev-stamp-'))
    try {
      const { appPath, plistPath } = makeBundle(root, {
        channel: 'package-dev',
        releaseChannel: 'development',
        shell: 'dsh-desktop-next',
      })
      execFileSync(process.execPath, [stampScript, appPath])
      expect(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plistPath], { encoding: 'utf8' }).trim()).toBe('ai.omnimux.desktop.dev')
      expect(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleDisplayName', plistPath], { encoding: 'utf8' }).trim()).toBe('OmniMux Dev')
      expect(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSEnvironment:OMNIMUX_CHANNEL', plistPath], { encoding: 'utf8' }).trim()).toBe('dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
