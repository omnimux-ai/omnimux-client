import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataDirectoryChange } from '../../src/data-directory.ts'
import {
  DESKTOP_NEXT_LAST_HOME_FILE,
  DEV_BUNDLE_IDENTIFIER,
  DEV_USER_DATA_DIRECTORY_NAME,
  NEXT_SHELL_NAME,
  writeDesktopNextLastHome,
} from '../../scripts/next-profile-upgrade.ts'
import { runDevProfileUpgrade } from '../../scripts/rebuild-managed-profile.ts'

const roots: string[] = []

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'omnimux-upgrade-last-home-')))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeSyntheticAsar(asarPath: string, files: Record<string, string>): void {
  const header: { files: Record<string, unknown> } = { files: {} }
  const chunks: Buffer[] = []
  let offset = 0

  for (const [relPath, text] of Object.entries(files)) {
    const buf = Buffer.from(text, 'utf8')
    const parts = relPath.split('/').filter(Boolean)
    let cursor = header.files
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i]!
      if (!cursor[segment]) cursor[segment] = { files: {} }
      cursor = (cursor[segment] as { files: Record<string, unknown> }).files
    }
    cursor[parts[parts.length - 1]!] = { size: buf.length, offset: String(offset) }
    chunks.push(buf)
    offset += buf.length
  }

  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const alignedJsonSize = Math.ceil(json.length / 4) * 4
  const paddedJson = Buffer.concat([json, Buffer.alloc(alignedJsonSize - json.length)])
  const headerPickle = Buffer.alloc(16)
  headerPickle.writeUInt32LE(4, 0)
  headerPickle.writeUInt32LE(alignedJsonSize + 8, 4)
  headerPickle.writeUInt32LE(alignedJsonSize + 4, 8)
  headerPickle.writeUInt32LE(json.length, 12)

  mkdirSync(dirname(asarPath), { recursive: true })
  writeFileSync(asarPath, Buffer.concat([headerPickle, paddedJson, ...chunks]))
}

function makeCandidateNextDevApp(root: string): string {
  const app = join(root, 'candidate', 'OmniMux Dev.app')
  const executable = join(app, 'Contents', 'MacOS', 'OmniMux')
  const pnpmBin = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  mkdirSync(dirname(executable), { recursive: true })
  mkdirSync(dirname(pnpmBin), { recursive: true })
  writeFileSync(executable, '')
  writeFileSync(pnpmBin, '')
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${DEV_BUNDLE_IDENTIFIER}</string></dict></plist>\n`,
  )
  writeFileSync(
    join(app, 'Contents', 'Resources', 'build-info.json'),
    JSON.stringify({
      product: 'OmniMux',
      version: '2.0.25',
      channel: 'package-dev',
      releaseChannel: 'development',
      shell: NEXT_SHELL_NAME,
      repo: { commit: 'b'.repeat(40), dirty: false },
      dsh: { packageSpec: '0.2.2-rc.5' },
    }, null, 2),
  )
  writeSyntheticAsar(join(app, 'Contents', 'Resources', 'app.asar'), {
    'package.json': JSON.stringify({
      name: NEXT_SHELL_NAME,
      version: '2.0.25',
      dependencies: {
        '@deepseek-ai/dsh': '0.2.2-rc.5',
        'omnimux': 'link:../../plugins/plugins/omnimux',
      },
    }),
    'node_modules/dsh-ui-kit/package.json': JSON.stringify({ name: 'dsh-ui-kit', version: '0.1.0', main: 'lib/index.js' }),
    'node_modules/dsh-ui-kit/lib/index.js': 'export const kit = true;\n',
  })
  return app
}

function makeIsolatedUpgradeFixture() {
  const root = tempRoot()
  const candidateApp = makeCandidateNextDevApp(root)
  const installedApp = join(root, 'installed', 'OmniMux Dev.app')
  const homeDir = join(root, 'user-home', '.omnimux-dev')
  const profileDir = join(homeDir, 'profiles', 'omnimux')
  const appSupport = join(root, 'Application Support')
  const devUserDataDir = join(appSupport, DEV_USER_DATA_DIRECTORY_NAME)
  const prodUserDataDir = join(appSupport, 'OmniMux')
  const recoveryDir = join(root, 'recovery-batch')

  mkdirSync(installedApp, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(devUserDataDir, { recursive: true })
  mkdirSync(prodUserDataDir, { recursive: true })
  mkdirSync(recoveryDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-omnimux',
    dsh: { profile: { bundles: ['omnimux'] } },
  }))

  const staleHome = join(root, 'omnimux-dev-migration-e2e-stale', 'clean-gui-home', '.omnimux-dev')
  const devLocationRoot = join(devUserDataDir, 'home')
  const devLastHomePath = join(devLocationRoot, DESKTOP_NEXT_LAST_HOME_FILE)
  mkdirSync(devLocationRoot, { recursive: true })
  writeFileSync(devLastHomePath, JSON.stringify({ home: staleHome }))

  const prodLocationRoot = join(prodUserDataDir, 'home')
  const prodLastHomePath = join(prodLocationRoot, DESKTOP_NEXT_LAST_HOME_FILE)
  mkdirSync(prodLocationRoot, { recursive: true })
  const prodHome = join(root, 'user-home', '.omnimux')
  writeFileSync(prodLastHomePath, JSON.stringify({ home: prodHome }))

  return {
    root,
    candidateApp,
    installedApp,
    homeDir,
    devUserDataDir,
    devLocationRoot,
    devLastHomePath,
    prodUserDataDir,
    prodLastHomePath,
    prodHome,
    staleHome,
    recoveryDir,
  }
}

describe('upgrade-dev desktop-next-last-home.json calibration & safety boundaries', () => {
  it('calibrates Dev desktop-next-last-home.json cleanly while preserving Next mismatch guard semantics', () => {
    const fixture = makeIsolatedUpgradeFixture()

    // Before calibration, stale temp path triggers Next's "data directory differs" guard.
    const before = dataDirectoryChange(fixture.devLocationRoot, fixture.homeDir, undefined, dirname(fixture.homeDir), '.omnimux-dev')
    expect(before).toEqual({ previous: resolve(fixture.staleHome), reachable: false })

    const written = writeDesktopNextLastHome(fixture.devUserDataDir, fixture.homeDir)
    expect(written).toBe(fixture.devLastHomePath)
    expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual({ home: resolve(fixture.homeDir) })
    if (process.platform !== 'win32') {
      expect(lstatSync(written).mode & 0o777).toBe(0o600)
    }

    // After calibration, booting with the committed Dev homeDir clears the guard.
    const afterTarget = dataDirectoryChange(fixture.devLocationRoot, fixture.homeDir, undefined, dirname(fixture.homeDir), '.omnimux-dev')
    expect(afterTarget).toBeUndefined()

    // Safety guard semantics remain intact: switching to an unexpected directory still triggers warning.
    const unexpectedHome = join(fixture.root, 'other-home', '.omnimux-dev')
    const afterMismatch = dataDirectoryChange(fixture.devLocationRoot, unexpectedHome, undefined, dirname(fixture.homeDir), '.omnimux-dev')
    expect(afterMismatch).toEqual({ previous: resolve(fixture.homeDir), reachable: true })

    // Production last-home file is untouched.
    expect(JSON.parse(readFileSync(fixture.prodLastHomePath, 'utf8'))).toEqual({ home: fixture.prodHome })
  })

  it('refuses production OmniMux userDataDir, production .omnimux homeDir, relative paths, and symlinks', () => {
    const fixture = makeIsolatedUpgradeFixture()

    expect(() => writeDesktopNextLastHome(fixture.prodUserDataDir, fixture.homeDir))
      .toThrow(/outside OmniMux-Dev/u)
    expect(() => writeDesktopNextLastHome(fixture.devUserDataDir, fixture.prodHome))
      .toThrow(/production home/u)
    expect(() => writeDesktopNextLastHome('relative/OmniMux-Dev', fixture.homeDir))
      .toThrow(/absolute path/u)
    expect(() => writeDesktopNextLastHome(fixture.devUserDataDir, '.omnimux-dev'))
      .toThrow(/absolute path/u)

    // Production record remains completely untouched after rejected calls.
    expect(JSON.parse(readFileSync(fixture.prodLastHomePath, 'utf8'))).toEqual({ home: fixture.prodHome })

    // Symlink target must be rejected fail-closed.
    rmSync(fixture.devLastHomePath, { force: true })
    symlinkSync(fixture.prodLastHomePath, fixture.devLastHomePath)
    expect(() => writeDesktopNextLastHome(fixture.devUserDataDir, fixture.homeDir))
      .toThrow(/linked or non-file/u)
    expect(JSON.parse(readFileSync(fixture.prodLastHomePath, 'utf8'))).toEqual({ home: fixture.prodHome })
  })

  it('never writes desktop-next-last-home.json during --dry-run or when upgradeDevWithRecovery fails', async () => {
    const fixture = makeIsolatedUpgradeFixture()
    const paths = {
      appPath: fixture.installedApp,
      homeDir: fixture.homeDir,
      userDataDir: fixture.devUserDataDir,
    }
    const baseHooks = {
      verifySignature: () => {},
      inspect: () => ({ ok: true } as never),
      confirmStopped: () => {},
      assertElectronRuntime: () => '44.7.0',
      materializeNext: async (candidateDir: string) => {
        mkdirSync(join(candidateDir, 'node_modules', 'dsh-ui-kit'), { recursive: true })
        writeFileSync(join(candidateDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
      },
    }

    // 1. --dry-run must never touch desktop-next-last-home.json or desktop-next.json.
    await runDevProfileUpgrade(
      { app: fixture.candidateApp, recoveryDir: fixture.recoveryDir, dryRun: true },
      paths,
      baseHooks,
    )
    expect(JSON.parse(readFileSync(fixture.devLastHomePath, 'utf8'))).toEqual({ home: fixture.staleHome })
    expect(existsSync(join(fixture.homeDir, 'desktop-next.json'))).toBe(false)

    // 2. Failed/aborted upgrade transaction must not overwrite desktop-next-last-home.json prematurely.
    await expect(runDevProfileUpgrade(
      { app: fixture.candidateApp, recoveryDir: fixture.recoveryDir, dryRun: false },
      paths,
      {
        ...baseHooks,
        upgrade: async () => { throw new Error('simulated cutover abort before commit') },
      },
    )).rejects.toThrow(/simulated cutover abort before commit/u)
    expect(JSON.parse(readFileSync(fixture.devLastHomePath, 'utf8'))).toEqual({ home: fixture.staleHome })
    expect(existsSync(join(fixture.homeDir, 'desktop-next.json'))).toBe(false)

    // 3. Committed upgrade calibrates Dev desktop-next-last-home.json and desktop-next.json, leaving prod untouched.
    const result = await runDevProfileUpgrade(
      { app: fixture.candidateApp, recoveryDir: fixture.recoveryDir, dryRun: false },
      paths,
      {
        ...baseHooks,
        upgrade: async () => undefined,
      },
    ) as { status: string; activeConfig: string; lastHomeConfig: string }

    expect(result.status).toBe('switched')
    expect(result.lastHomeConfig).toBe(fixture.devLastHomePath)
    expect(JSON.parse(readFileSync(fixture.devLastHomePath, 'utf8'))).toEqual({ home: resolve(fixture.homeDir) })
    expect(JSON.parse(readFileSync(result.activeConfig, 'utf8'))).toEqual({ version: 1, active: 'omnimux' })
    expect(JSON.parse(readFileSync(fixture.prodLastHomePath, 'utf8'))).toEqual({ home: fixture.prodHome })
  })
})
