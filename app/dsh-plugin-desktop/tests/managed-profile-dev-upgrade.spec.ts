import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import {
  MANAGED_GRAPH_ENTRIES,
  inspectDevProfileSources,
  managedDependencySpec,
  managedSourcePath,
  prepareManagedProfile,
  rebuildManagedProfile,
} from '../src/managed-profile.ts'

const OWNED_PACKAGES = ['dsh-ui-kit'] as const
const RECOVERED = '@fixture/recovered'
const PRESERVED = 'other-managed-plugin'
const BUNDLES = [RECOVERED, PRESERVED, ...OWNED_PACKAGES]
const recoverySpec = managedDependencySpec(RECOVERED)
const nestedFile = 'node_modules/vendor/index.js'
const fixtures: string[] = []

function writePackage(directory: string, name: string, body: string, dependencies?: Record<string, string>): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js', dependencies }))
  writeFileSync(join(directory, 'index.js'), `module.exports = ${JSON.stringify(body)}\n`)
}

function fixture({ spec = recoverySpec, lockedVersion = '1.0.0', directory = recoverySpec.slice(5) } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'managed-profile-dev-upgrade-'))
  fixtures.push(root)
  const profileDir = join(root, 'dev-home', 'profiles', 'omnimux')
  const presetDir = join(root, 'preset')
  const legacy = join(profileDir, 'node_modules', RECOVERED)
  const kit = 'dsh-ui-kit'
  const kitSpec = managedDependencySpec(kit)
  writePackage(join(presetDir, 'plugins', kit), kit, 'frozen-preset')
  writePackage(managedSourcePath(profileDir, kit), kit, 'old-owned-source')
  writePackage(managedSourcePath(profileDir, PRESERVED), PRESERVED, 'existing-managed-source')
  writePackage(legacy, RECOVERED, 'independent-plugin', { [kit]: 'file:../../dsh-ui-kit' })
  mkdirSync(dirname(join(legacy, nestedFile)), { recursive: true })
  writeFileSync(join(legacy, nestedFile), 'module.exports = "bundled-dependency"\n')

  const manifest = {
    name: 'fixture-profile',
    dsh: { profile: { bundles: BUNDLES } },
    dependencies: { [kit]: kitSpec, [RECOVERED]: spec, [PRESERVED]: managedDependencySpec(PRESERVED) },
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages: [.]\n')
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), stringify({
    lockfileVersion: '9.0',
    importers: { '.': { dependencies: { [RECOVERED]: { specifier: spec, version: `${spec}(${kit}@${kitSpec})` } } } },
    packages: { [`${RECOVERED}@${spec}`]: { resolution: { type: 'directory', directory }, version: lockedVersion } },
  }))
  const options = {
    profileDir,
    presetDir,
    ownedPackages: OWNED_PACKAGES,
    mode: 'dev-upgrade' as const,
    async packedFiles(sourceDir: string) {
      const files = ['package.json', 'index.js']
      if (existsSync(join(sourceDir, nestedFile))) files.push(nestedFile)
      return files
    },
    async materialize(candidateDir: string) {
      for (const name of BUNDLES) {
        const destination = join(candidateDir, 'node_modules', name)
        mkdirSync(dirname(destination), { recursive: true })
        cpSync(managedSourcePath(candidateDir, name), destination, { recursive: true })
      }
    },
  }
  return { root, profileDir, legacy, presetDir, options }
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Dev Profile candidate preparation', () => {
  it('recovers the locked installed payload without changing the active graph or dropping enabled bundles', async () => {
    const { root, profileDir, presetDir, options } = fixture()
    const before = readFileSync(join(profileDir, 'package.json'), 'utf8')
    expect(inspectDevProfileSources(profileDir, presetDir, OWNED_PACKAGES)).toEqual({
      packageCount: 3,
      preservedManagedSources: [PRESERVED],
      recoveredInstalledSources: [RECOVERED],
      droppedLegacySources: [],
    })
    const prepared = await prepareManagedProfile(options)
    try {
      expect(dirname(prepared.candidateDir)).toBe(root)
      expect(prepared.result.recoveredInstalledSources).toEqual([RECOVERED])
      for (const path of MANAGED_GRAPH_ENTRIES) expect(existsSync(join(prepared.candidateDir, path))).toBe(true)
      const candidateManifest = JSON.parse(readFileSync(join(prepared.candidateDir, 'package.json'), 'utf8'))
      expect(candidateManifest.dsh.profile.bundles).toEqual(BUNDLES)
      expect(readFileSync(join(managedSourcePath(prepared.candidateDir, 'dsh-ui-kit'), 'index.js'), 'utf8')).toContain('frozen-preset')
      expect(readFileSync(join(managedSourcePath(prepared.candidateDir, RECOVERED), nestedFile), 'utf8')).toContain('bundled-dependency')
      expect(readFileSync(join(profileDir, 'package.json'), 'utf8')).toBe(before)
      expect(existsSync(managedSourcePath(profileDir, RECOVERED))).toBe(false)
      expect(readFileSync(join(managedSourcePath(profileDir, 'dsh-ui-kit'), 'index.js'), 'utf8')).toContain('old-owned-source')
      expect(() => prepared.verify(prepared.candidateDir)).not.toThrow()
      writeFileSync(join(prepared.candidateDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
      expect(() => prepared.verify(prepared.candidateDir)).toThrow('pnpm-lock.yaml hash changed')
    } finally {
      prepared.dispose()
    }
    expect(readdirSync(root).sort()).toEqual(['dev-home', 'preset'])
  })

  it('rejects installed payloads when either the lock directory or the recorded version disagrees', async () => {
    const badDirectory = fixture({ directory: '.materialize-snapshots/plugins/unrelated' })
    await expect(prepareManagedProfile(badDirectory.options)).rejects.toThrow('lockfile does not match managed source')
    const badVersion = fixture({ lockedVersion: '2.0.0' })
    await expect(prepareManagedProfile(badVersion.options)).rejects.toThrow('installed version does not match package identity')
  })

  it('rejects an installed package with a symlink anywhere in its payload', async () => {
    const { legacy, options } = fixture()
    symlinkSync('index.js', join(legacy, 'alias.js'))
    await expect(prepareManagedProfile(options)).rejects.toThrow('managed source contains symbolic link')
  })

  it('requires external recovery and refuses to drop a legacy declaration', async () => {
    const good = fixture()
    await expect(rebuildManagedProfile(good.options)).rejects.toThrow('requires an external recovery transaction')
    await expect(prepareManagedProfile({ ...good.options, stagingParent: good.profileDir })).rejects.toThrow('must be outside')
    const old = fixture({ spec: `file:./node_modules/${RECOVERED}` })
    await expect(prepareManagedProfile(old.options)).rejects.toThrow('would drop legacy package')
  })
})
