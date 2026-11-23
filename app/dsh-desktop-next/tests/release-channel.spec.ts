import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataDirectoryLocationRoot, readDataDirectory } from '../src/data-directory.ts'
import { DESKTOP_APP_ID, DESKTOP_DEV_APP_ID, DESKTOP_DEV_IDENTITY, DESKTOP_PRODUCT_IDENTITY } from '../src/product-identity.ts'
import { parseMacInfoPlistStrings, resolveDesktopIdentity } from '../src/release-channel.ts'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'next-release-channel-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface BundleSpec {
  readonly appName: string
  readonly bundleId?: string
  readonly displayName?: string
  readonly lsEnvChannel?: string
  readonly plistRaw?: string
  readonly buildInfo?: Record<string, unknown> | string
}

function makeMacBundle(spec: BundleSpec): { execPath: string; resourcesPath: string; bundleRoot: string } {
  const root = tempDir()
  const bundleRoot = join(root, spec.appName)
  const macosDir = join(bundleRoot, 'Contents', 'MacOS')
  const resourcesPath = join(bundleRoot, 'Contents', 'Resources')
  mkdirSync(macosDir, { recursive: true })
  mkdirSync(resourcesPath, { recursive: true })
  const execPath = join(macosDir, 'OmniMux')
  writeFileSync(execPath, '')

  if (spec.plistRaw !== undefined) {
    writeFileSync(join(bundleRoot, 'Contents', 'Info.plist'), spec.plistRaw)
  } else if (spec.bundleId !== undefined || spec.displayName !== undefined || spec.lsEnvChannel !== undefined) {
    const entries: string[] = []
    if (spec.bundleId !== undefined) entries.push(`<key>CFBundleIdentifier</key><string>${spec.bundleId}</string>`)
    if (spec.displayName !== undefined) entries.push(`<key>CFBundleDisplayName</key><string>${spec.displayName}</string>`)
    if (spec.lsEnvChannel !== undefined) {
      entries.push(`<key>LSEnvironment</key><dict><key>OMNIMUX_CHANNEL</key><string>${spec.lsEnvChannel}</string></dict>`)
    }
    writeFileSync(
      join(bundleRoot, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${entries.join('')}</dict></plist>\n`,
    )
  }

  if (spec.buildInfo !== undefined) {
    writeFileSync(
      join(resourcesPath, 'build-info.json'),
      typeof spec.buildInfo === 'string' ? spec.buildInfo : JSON.stringify(spec.buildInfo, null, 2),
    )
  }
  return { execPath, resourcesPath, bundleRoot }
}

describe('release-channel resolution (fail-closed Dev isolation)', () => {
  it('resolves a packaged Dev .app to .omnimux-dev and OmniMux-Dev with a completely scrubbed environment', () => {
    const { execPath, resourcesPath } = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_DEV_APP_ID,
      displayName: 'OmniMux Dev',
      lsEnvChannel: 'dev',
      buildInfo: { channel: 'package-dev', releaseChannel: 'development', shell: 'dsh-desktop-next' },
    })

    // Scrubbed environment: mirrors `env -u DSH_HOME ... open -a "OmniMux Dev"`.
    const identity = resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath,
      resourcesPath,
      env: {},
    })

    expect(identity).toEqual(DESKTOP_DEV_IDENTITY)
    expect(identity.homeDirectoryName).toBe('.omnimux-dev')
    expect(identity.userDataDirectoryName).toBe('OmniMux-Dev')
    expect(identity.appId).toBe('ai.omnimux.desktop.dev')

    // Verify end-to-end data directory resolution never touches ~/.omnimux.
    const fakeHome = tempDir()
    const fakeAppData = join(fakeHome, 'Library', 'Application Support')
    const locationRoot = dataDirectoryLocationRoot(true, () => fakeAppData, resourcesPath, identity.userDataDirectoryName)
    const location = readDataDirectory(locationRoot, undefined, fakeHome, identity.homeDirectoryName)

    expect(locationRoot).toBe(join(fakeAppData, 'OmniMux-Dev', 'home'))
    expect(location.home).toBe(join(fakeHome, '.omnimux-dev'))
    expect(location.source).toBe('default')
    expect(existsSync(join(fakeHome, '.omnimux'))).toBe(false)
    expect(existsSync(join(fakeAppData, 'OmniMux'))).toBe(false)
  })

  it('keeps packaged stable .app bound to .omnimux and OmniMux with zero regression', () => {
    const { execPath, resourcesPath } = makeMacBundle({
      appName: 'OmniMux.app',
      bundleId: DESKTOP_APP_ID,
      displayName: 'OmniMux',
      buildInfo: { channel: 'dist:mac', releaseChannel: 'stable', shell: 'dsh-desktop-next' },
    })

    const identity = resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath,
      resourcesPath,
      env: {},
    })

    expect(identity).toEqual(DESKTOP_PRODUCT_IDENTITY)
    expect(identity.homeDirectoryName).toBe('.omnimux')
    expect(identity.userDataDirectoryName).toBe('OmniMux')
  })

  it('keeps unpackaged development runs defaulting to stable unless OMNIMUX_CHANNEL=dev is explicit', () => {
    expect(resolveDesktopIdentity({
      packaged: false,
      platform: 'darwin',
      execPath: '/usr/local/bin/electron',
      env: {},
    })).toEqual(DESKTOP_PRODUCT_IDENTITY)

    expect(resolveDesktopIdentity({
      packaged: false,
      platform: 'darwin',
      execPath: '/usr/local/bin/electron',
      env: { OMNIMUX_CHANNEL: 'dev' },
    })).toEqual(DESKTOP_DEV_IDENTITY)
  })

  it('fails closed when a Dev bundle is missing build-info.json instead of falling back to ~/.omnimux', () => {
    const { execPath, resourcesPath } = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_DEV_APP_ID,
      displayName: 'OmniMux Dev',
    })

    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath,
      resourcesPath,
      env: {},
    })).toThrow(/refusing to fall back to production ~\/\.omnimux/u)
  })

  it('fails closed when build-info.json is malformed JSON', () => {
    const { execPath, resourcesPath } = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_DEV_APP_ID,
      buildInfo: '{broken json',
    })

    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath,
      resourcesPath,
      env: {},
    })).toThrow(/Unreadable build-info\.json/u)
  })

  it('fails closed when a stable bundle is renamed to OmniMux Dev.app or carries conflicting Info.plist / build-info.json', () => {
    const renamedStable = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_APP_ID,
      buildInfo: { channel: 'dist:mac', releaseChannel: 'stable' },
    })
    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath: renamedStable.execPath,
      resourcesPath: renamedStable.resourcesPath,
      env: {},
    })).toThrow(/Conflicting OmniMux release-channel metadata/u)

    const mismatchedPlist = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_APP_ID,
      buildInfo: { channel: 'package-dev', releaseChannel: 'development' },
    })
    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath: mismatchedPlist.execPath,
      resourcesPath: mismatchedPlist.resourcesPath,
      env: {},
    })).toThrow(/Conflicting OmniMux release-channel metadata/u)

    const envConflict = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_DEV_APP_ID,
      buildInfo: { channel: 'package-dev', releaseChannel: 'development' },
    })
    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath: envConflict.execPath,
      resourcesPath: envConflict.resourcesPath,
      env: { OMNIMUX_CHANNEL: 'stable' },
    })).toThrow(/Conflicting OmniMux release-channel metadata/u)
  })

  it('fails closed when OMNIMUX_CHANNEL or build-info.json carries an unknown value', () => {
    const valid = makeMacBundle({
      appName: 'OmniMux Dev.app',
      bundleId: DESKTOP_DEV_APP_ID,
      buildInfo: { channel: 'package-dev', releaseChannel: 'development' },
    })
    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath: valid.execPath,
      resourcesPath: valid.resourcesPath,
      env: { OMNIMUX_CHANNEL: 'staging' },
    })).toThrow(/Invalid OMNIMUX_CHANNEL/u)

    const malformedPlist = makeMacBundle({
      appName: 'OmniMux Dev.app',
      plistRaw: 'not-a-plist',
      buildInfo: { channel: 'package-dev', releaseChannel: 'development' },
    })
    expect(() => resolveDesktopIdentity({
      packaged: true,
      platform: 'darwin',
      execPath: malformedPlist.execPath,
      resourcesPath: malformedPlist.resourcesPath,
      env: {},
    })).toThrow(/Malformed macOS Info\.plist/u)
  })

  it('parses CFBundleIdentifier, CFBundleDisplayName and LSEnvironment.OMNIMUX_CHANNEL from XML Info.plist', () => {
    const parsed = parseMacInfoPlistStrings(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>ai.omnimux.desktop.dev</string>
  <key>CFBundleDisplayName</key>
  <string>OmniMux Dev</string>
  <key>LSEnvironment</key>
  <dict>
    <key>OMNIMUX_CHANNEL</key>
    <string>dev</string>
  </dict>
</dict>
</plist>`)
    expect(parsed).toEqual({
      bundleIdentifier: 'ai.omnimux.desktop.dev',
      displayName: 'OmniMux Dev',
      omnimuxChannel: 'dev',
    })
  })
})
