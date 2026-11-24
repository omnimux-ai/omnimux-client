import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_OMNIMUX_PROFILE,
  loadNextProfile,
  NextProfiles,
  readNextProfilePatches,
} from '../src/profiles.ts'

const roots: string[] = []
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'next-legacy-profile-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function seedLegacyOmnimuxProfile(home: string, extraBundles: readonly string[] = ['omnimux', 'omnimux-clip']): string {
  const dir = join(home, 'profiles', LEGACY_OMNIMUX_PROFILE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-omnimux',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...extraBundles],
      },
    },
  }, null, 2))
  return dir
}

describe('legacy profiles/omnimux adoption & persistence', () => {
  it('adopts existing profiles/omnimux, persists desktop-next.json, and stays pinned across repeated restarts', () => {
    const home = tempHome()
    seedLegacyOmnimuxProfile(home)

    const firstBoot = new NextProfiles(home)
    expect(existsSync(join(home, 'desktop-next.json'))).toBe(false)
    expect(firstBoot.active).toBe('omnimux')
    expect(firstBoot.resolveAndPersistActive()).toBe('omnimux')

    const persisted = JSON.parse(readFileSync(join(home, 'desktop-next.json'), 'utf8')) as { version: number; active: string }
    expect(persisted).toEqual({ version: 1, active: 'omnimux' })

    // Even if profiles/desktop is created later, subsequent launches must stay on omnimux.
    firstBoot.ensure('desktop')
    const secondBoot = new NextProfiles(home)
    expect(secondBoot.resolveAndPersistActive()).toBe('omnimux')
    const thirdBoot = new NextProfiles(home)
    expect(thirdBoot.active).toBe('omnimux')
  })

  it('keeps fresh homes on desktop without writing desktop-next.json and respects explicit switches', () => {
    const home = tempHome()
    const fresh = new NextProfiles(home)
    expect(fresh.resolveAndPersistActive()).toBe('desktop')
    expect(existsSync(join(home, 'desktop-next.json'))).toBe(false)

    // Explicit switch overrides legacy adoption.
    seedLegacyOmnimuxProfile(home)
    fresh.ensure('desktop')
    fresh.select('desktop')
    expect(new NextProfiles(home).resolveAndPersistActive()).toBe('desktop')
  })
})

describe('profile-local external bundle override (zero app.asar mutation)', () => {
  it('prefers profile-local node_modules/<plugin> cordis.patch.yml over the installation copy while keeping @deepseek-ai/* pinned', () => {
    const home = tempHome()
    const profileDir = seedLegacyOmnimuxProfile(home, ['omnimux-clip'])

    // Materialize an external override for omnimux-clip inside the profile's node_modules.
    const localClipDir = join(profileDir, 'node_modules', 'omnimux-clip')
    mkdirSync(localClipDir, { recursive: true })
    writeFileSync(join(localClipDir, 'package.json'), JSON.stringify({
      name: 'omnimux-clip',
      version: '0.1.2-override',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
      },
    }, null, 2))
    writeFileSync(join(localClipDir, 'cordis.patch.yml'), '- insert:\n    - id: omnimux-clip-override-marker\n      name: omnimux-clip\n')

    // Also attempt to plant a fake @deepseek-ai/dsh-base override inside profile node_modules;
    // core packages must NEVER be overridden by profile-local copies.
    const fakeCoreDir = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-base')
    mkdirSync(fakeCoreDir, { recursive: true })
    writeFileSync(join(fakeCoreDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-base',
      version: '0.0.1-hijack',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, null, 2))
    writeFileSync(join(fakeCoreDir, 'cordis.patch.yml'), '- insert:\n    - id: core-hijack-marker\n      name: fake-core\n')

    const loaded = loadNextProfile(profileDir, home)
    const clipLayer = loaded.layers.find(layer => layer.packageName === 'omnimux-clip')
    const baseLayer = loaded.layers.find(layer => layer.packageName === '@deepseek-ai/dsh-base')

    expect(clipLayer).toBeDefined()
    expect(clipLayer!.packageDir).toBe(localClipDir)
    expect(JSON.stringify(clipLayer!.patches)).toContain('omnimux-clip-override-marker')

    expect(baseLayer).toBeDefined()
    expect(baseLayer!.packageDir).not.toBe(fakeCoreDir)
    expect(JSON.stringify(baseLayer!.patches)).not.toContain('core-hijack-marker')

    // Recomposition via readNextProfilePatches must honor the same override.
    const recomposed = readNextProfilePatches(profileDir, home, [])
    expect(JSON.stringify(recomposed)).toContain('omnimux-clip-override-marker')
    expect(JSON.stringify(recomposed)).not.toContain('core-hijack-marker')
  })
})
