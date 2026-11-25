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
})

it('preserves local Profile overrides in non-archived Dev mode or with OMNIMUX_ALLOW_LOCAL_PLUGIN_OVERRIDE=1', () => {
  const root = mkdtempSync(join(tmpdir(), 'omnimux-profile-dev-')); roots.push(root)
  const productPkg = OMNIMUX_PRODUCT_BUNDLES[0]!
  const bundledDir = join(root, 'app.asar', 'node_modules', ...productPkg.split('/'))
  const profileDir = join(root, 'profile')
  const localDir = join(profileDir, 'node_modules', ...productPkg.split('/'))

  writeBundle(bundledDir, productPkg, '1.2.0')
  writeBundle(localDir, productPkg, '1.1.0')

  // Unarchived (Dev) allows local override regardless of version.
  const devProfile = {
    name: 'desktop',
    dir: profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
    skippedBundles: [],
    layers: [{ packageName: productPkg, packageDir: bundledDir, patchPaths: [], patches: [] }],
  } as unknown as Profile
  applyProfileLocalBundleOverrides(devProfile, profileDir, join(root, 'unpacked', 'package.json'))
  expect(devProfile.layers[0]!.packageDir).toBe(localDir)

  // Archived with explicit env opt-in also allows local override.
  vi.stubEnv('OMNIMUX_ALLOW_LOCAL_PLUGIN_OVERRIDE', '1')
  const optedProfile = {
    name: 'desktop',
    dir: profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
    skippedBundles: [],
    layers: [{ packageName: productPkg, packageDir: bundledDir, patchPaths: [], patches: [] }],
  } as unknown as Profile
  applyProfileLocalBundleOverrides(optedProfile, profileDir, join(root, 'app.asar', 'package.json'))
  expect(optedProfile.layers[0]!.packageDir).toBe(localDir)
})
