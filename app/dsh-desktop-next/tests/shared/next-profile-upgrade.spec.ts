import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  computeNextProfileBundles,
  DEV_BUNDLE_IDENTIFIER,
  NEXT_SHELL_NAME,
  nextCandidateLayout,
  openPhysicalAsar,
  prepareNextManagedProfileGraph,
  readNextDevBuild,
  writeDesktopNextActiveProfile,
} from '../../scripts/next-profile-upgrade.ts'

const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-next-upgrade-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build a real Chromium ASAR binary file from a relative path → content map. */
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

function makeNextDevApp(root: string, overrides: {
  buildInfo?: Record<string, unknown>
  bundleId?: string
  asarFiles?: Record<string, string>
} = {}): string {
  const app = join(root, 'OmniMux Dev.app')
  const executable = join(app, 'Contents', 'MacOS', 'OmniMux')
  const pnpmBin = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  mkdirSync(dirname(executable), { recursive: true })
  mkdirSync(dirname(pnpmBin), { recursive: true })
  writeFileSync(executable, '')
  writeFileSync(pnpmBin, '')
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${overrides.bundleId ?? DEV_BUNDLE_IDENTIFIER}</string></dict></plist>\n`,
  )
  writeFileSync(
    join(app, 'Contents', 'Resources', 'build-info.json'),
    JSON.stringify({
      product: 'OmniMux',
      version: '2.0.25',
      channel: 'package-dev',
      releaseChannel: 'development',
      shell: NEXT_SHELL_NAME,
      repo: { commit: 'a'.repeat(40), dirty: false },
      dsh: { packageSpec: '0.2.2-rc.5' },
      ...overrides.buildInfo,
    }, null, 2),
  )
  writeSyntheticAsar(join(app, 'Contents', 'Resources', 'app.asar'), overrides.asarFiles ?? {
    'package.json': JSON.stringify({
      name: NEXT_SHELL_NAME,
      version: '2.0.25',
      dependencies: {
        '@deepseek-ai/dsh': '0.2.2-rc.5',
        'dsh-better-sidebar': '^0.32.1',
        'omnimux': 'link:../../plugins/plugins/omnimux',
        'omnimux-clip': 'link:../../plugins/plugins/omnimux-clip',
        'omnimux-workflow': 'link:../../plugins/plugins/omnimux-workflow',
        'dshmarket': '1.73.21',
      },
    }),
    'node_modules/dsh-ui-kit/package.json': JSON.stringify({ name: 'dsh-ui-kit', version: '0.1.0', main: 'lib/index.js' }),
    'node_modules/dsh-ui-kit/lib/index.js': 'export const kit = true;\n',
  })
  return app
}

describe('Desktop Next upgrade-dev layout & graph preparation', () => {
  it('detects a Next Dev bundle, validates its metadata + Dev Bundle ID, and rejects invalid/dirty/mismatched builds', () => {
    const root = tempRoot()
    const validApp = makeNextDevApp(root)

    const layout = nextCandidateLayout(validApp)
    expect(layout?.shell).toBe(NEXT_SHELL_NAME)
    expect(layout?.executable).toBe(join(validApp, 'Contents', 'MacOS', 'OmniMux'))

    const verified = readNextDevBuild(validApp, { verifySignature: () => {} })
    expect(verified).toEqual({
      version: '2.0.25',
      commit: 'a'.repeat(40),
      shell: NEXT_SHELL_NAME,
      dsh: '0.2.2-rc.5',
    })

    const dirtyApp = makeNextDevApp(tempRoot(), { buildInfo: { repo: { commit: 'a'.repeat(40), dirty: true } } })
    expect(() => readNextDevBuild(dirtyApp, { verifySignature: () => {} })).toThrow(/package:dev from a clean commit/u)

    const prodPlistApp = makeNextDevApp(tempRoot(), { bundleId: 'ai.omnimux.desktop' })
    expect(() => readNextDevBuild(prodPlistApp, { verifySignature: () => {} })).toThrow(/CFBundleIdentifier=ai\.omnimux\.desktop\.dev/u)
  })

  it('computes ordered Next bundles keeping core prefix, all bundled product plugins, and valid optional opt-ins while pruning retired legacy bundles', () => {
    const bundles = computeNextProfileBundles(
      {
        dependencies: {
          'omnimux-workflow': 'link:...',
          'omnimux': 'link:...',
          'omnimux-clip': 'link:...',
          'dsh-better-sidebar': '^0.32.1',
          'dshmarket': '1.73.21',
        },
      },
      ['omnimux-studio', 'omnimux-viewer', 'dshmarket', 'omnimux-apps'],
    )
    expect(bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'omnimux',
      'dsh-better-sidebar',
      'omnimux-clip',
      'omnimux-workflow',
      'dshmarket',
    ])
  })

  it('extracts dsh-ui-kit from physical app.asar, drops legacy 0.2.1-rc.3 snapshots, and persists desktop-next.json', async () => {
    const root = tempRoot()
    const app = makeNextDevApp(root)
    const homeDir = join(root, '.omnimux-dev')
    const profileDir = join(homeDir, 'profiles', 'omnimux')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-omnimux',
      dependencies: {
        'dsh-better-sidebar': 'file:.materialize-snapshots/plugins/dsh-better-sidebar',
        'omnimux-studio': 'file:.materialize-snapshots/plugins/omnimux-studio',
      },
      dsh: {
        desktopScheduleBundleRetired: true,
        profile: { bundles: ['omnimux-studio', 'dshmarket'] },
      },
    }))

    const asar = openPhysicalAsar(join(app, 'Contents', 'Resources', 'app.asar'))
    expect(asar.readFile('node_modules/dsh-ui-kit/lib/index.js')?.toString('utf8')).toContain('kit = true')

    const graph = await prepareNextManagedProfileGraph({
      profileDir,
      homeDir,
      asarPath: join(app, 'Contents', 'Resources', 'app.asar'),
      materialize: async candidateDir => {
        mkdirSync(join(candidateDir, 'node_modules', 'dsh-ui-kit'), { recursive: true })
        writeFileSync(join(candidateDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
      },
    })
    try {
      expect(graph.result.hasManagedUiKit).toBe(true)
      const stagedManifest = JSON.parse(readFileSync(join(graph.candidateDir, 'package.json'), 'utf8'))
      expect(stagedManifest.dependencies).toEqual({
        'dsh-ui-kit': 'file:.materialize-snapshots/plugins/dsh-ui-kit',
      })
      // Legacy dsh-better-sidebar@0.28.1 must not remain in profile dependencies.
      expect(stagedManifest.dependencies['dsh-better-sidebar']).toBeUndefined()
      expect(stagedManifest.dsh.desktopNextOnboarding).toEqual({ version: 1, outcome: 'skipped' })
      expect(stagedManifest.dsh.profile.bundles).toContain('omnimux-clip')
      expect(stagedManifest.dsh.profile.bundles).not.toContain('omnimux-studio')
      expect(existsSync(join(graph.candidateDir, '.materialize-snapshots', 'plugins', 'dsh-ui-kit', 'lib', 'index.js'))).toBe(true)
      expect(() => graph.verify(graph.candidateDir)).not.toThrow()
    } finally {
      graph.dispose()
    }

    const activeFile = writeDesktopNextActiveProfile(homeDir, 'omnimux')
    expect(JSON.parse(readFileSync(activeFile, 'utf8'))).toEqual({ version: 1, active: 'omnimux' })
  })
})
