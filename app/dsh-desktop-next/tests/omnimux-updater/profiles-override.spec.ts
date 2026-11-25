import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Profile } from '@deepseek-ai/dsh-app-boot'
import { applyProfileLocalBundleOverrides, OMNIMUX_PRODUCT_BUNDLES } from '../../src/profiles.ts'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeBundle(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version,
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
}

it('prevents stale Profile-local OmniMux plugins from shadowing upgraded packaged app.asar bundles', () => {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-profile-override-')); roots.push(root)
  const productPkg = OMNIMUX_PRODUCT_BUNDLES[0]!
  const bundledDir = join(root, 'app.asar', 'node_modules', ...productPkg.split('/'))
  const profileDir = join(root, 'profile')
  const localDir = join(profileDir, 'node_modules', ...productPkg.split('/'))
  const archivedAnchor = join(root, 'app.asar', 'package.json')

  writeBundle(bundledDir, productPkg, '1.2.0')
  writeBundle(localDir, productPkg, '1.1.0')

  const profile: Profile = {
    name: 'desktop',
    dir: profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
    skippedBundles: [],
    layers: [{ packageName: productPkg, packageDir: bundledDir, patchPaths: [], patches: [] }],
  } as unknown as Profile

  applyProfileLocalBundleOverrides(profile, profileDir, archivedAnchor)
  expect(profile.layers[0]!.packageDir).toBe(bundledDir)

  // Equal version also stays on the bundled copy.
  writeBundle(localDir, productPkg, '1.2.0')
  applyProfileLocalBundleOverrides(profile, profileDir, archivedAnchor)
  expect(profile.layers[0]!.packageDir).toBe(bundledDir)

  // Newer local hotfix version is still honored.
  writeBundle(localDir, productPkg, '1.3.0')
  applyProfileLocalBundleOverrides(profile, profileDir, archivedAnchor)
  expect(profile.layers[0]!.packageDir).toBe(localDir)

  // Missing or non-SemVer local package.json version fails closed to the bundled copy.
  profile.layers[0]!.packageDir = bundledDir
  writeBundle(localDir, productPkg, 'not-a-semver')
  applyProfileLocalBundleOverrides(profile, profileDir, archivedAnchor)
  expect(profile.layers[0]!.packageDir).toBe(bundledDir)

  writeFileSync(join(localDir, 'package.json'), JSON.stringify({
    name: productPkg,
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  applyProfileLocalBundleOverrides(profile, profileDir, archivedAnchor)
  expect(profile.layers[0]!.packageDir).toBe(bundledDir)
})

it('preserves local Profile overrides in packaged OmniMux Dev.app, unarchived Dev mode, or with OMNIMUX_ALLOW_LOCAL_PLUGIN_OVERRIDE=1', () => {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-profile-dev-')); roots.push(root)
  const productPkg = OMNIMUX_PRODUCT_BUNDLES[0]!
  const bundledDir = join(root, 'app.asar', 'node_modules', ...productPkg.split('/'))
  const profileDir = join(root, 'profile')
  const localDir = join(profileDir, 'node_modules', ...productPkg.split('/'))

  writeBundle(bundledDir, productPkg, '1.2.0')
  writeBundle(localDir, productPkg, '1.1.0')

  const makeProfile = (): Profile => ({
    name: 'desktop',
    dir: profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
    skippedBundles: [],
    layers: [{ packageName: productPkg, packageDir: bundledDir, patchPaths: [], patches: [] }],
  } as unknown as Profile)

  // Unarchived (source) allows local override regardless of version.
  const sourceProfile = makeProfile()
  applyProfileLocalBundleOverrides(sourceProfile, profileDir, join(root, 'unpacked', 'package.json'))
  expect(sourceProfile.layers[0]!.packageDir).toBe(localDir)

  // Packaged OmniMux Dev.app allows local override via explicit releaseChannel='development'.
  const devChannelProfile = makeProfile()
  applyProfileLocalBundleOverrides(devChannelProfile, profileDir, join(root, 'app.asar', 'package.json'), 'development')
  expect(devChannelProfile.layers[0]!.packageDir).toBe(localDir)

  // Packaged OmniMux Dev.app also allows local override when Resources/build-info.json beside app.asar marks development.
  writeFileSync(join(root, 'build-info.json'), JSON.stringify({ channel: 'package-dev', releaseChannel: 'development' }))
  const devBuildInfoProfile = makeProfile()
  applyProfileLocalBundleOverrides(devBuildInfoProfile, profileDir, join(root, 'app.asar', 'package.json'))
  expect(devBuildInfoProfile.layers[0]!.packageDir).toBe(localDir)
  rmSync(join(root, 'build-info.json'))

  // Archived with explicit env opt-in also allows local override.
  vi.stubEnv('OMNIMUX_ALLOW_LOCAL_PLUGIN_OVERRIDE', '1')
  const optedProfile = makeProfile()
  applyProfileLocalBundleOverrides(optedProfile, profileDir, join(root, 'app.asar', 'package.json'))
  expect(optedProfile.layers[0]!.packageDir).toBe(localDir)
})
