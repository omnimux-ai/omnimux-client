import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'
import { afterEach, expect, it } from 'vitest'
import { archivedPayload, auditNextPayload, nextPackagingTarget } from '../scripts/packaged-payload.ts'
import { loadNextProfile, NextProfiles } from '../src/profiles.ts'
import { completeApplication, writeApplication } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('declares omnimux-*/skills/**/* in build.asarUnpack so bundled plugin skills are readable on disk', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    build: { asarUnpack: string[] }
  }
  expect(manifest.build.asarUnpack).toContain('**/node_modules/omnimux-*/skills/**/*')
})

it('auditNextPayload requires omnimux-*/skills files to be unpacked beside app.asar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-next-skill-unpack-'))
  roots.push(root)
  const target = nextPackagingTarget(process.platform, process.arch)

  const app = join(root, 'payload')
  writeApplication(app)
  completeApplication(app)
  mkdirSync(join(app, 'node_modules', 'omnimux-market', 'skills', 'omnimux-social-data'), { recursive: true })
  writeFileSync(
    join(app, 'node_modules', 'omnimux-market', 'skills', 'omnimux-social-data', 'SKILL.md'),
    '---\nname: omnimux-social-data\ndescription: fixture\n---\nBody\n',
  )

  const packedResources = join(root, 'resources-packed')
  mkdirSync(packedResources)
  await createPackageWithOptions(app, join(packedResources, 'app.asar'), {
    unpackDir: '{scripts/node-bin,assets,build,node_modules/pnpm}',
  })
  const packed = archivedPayload(packedResources)
  try {
    expect(auditNextPayload(packed, target)).toContain(
      'node_modules/omnimux-market/skills/omnimux-social-data/SKILL.md: must be unpacked beside app.asar',
    )
  } finally {
    packed.close()
  }

  const unpackedResources = join(root, 'resources-unpacked')
  mkdirSync(unpackedResources)
  await createPackageWithOptions(app, join(unpackedResources, 'app.asar'), {
    unpackDir: '{scripts/node-bin,assets,build,node_modules/pnpm,node_modules/omnimux-*/skills}',
  })
  const unpacked = archivedPayload(unpackedResources)
  try {
    expect(auditNextPayload(unpacked, target)).toEqual([])
  } finally {
    unpacked.close()
  }
})

it('loadNextProfile reclaims legacy plugin-managed skill copies in <home>/skills without touching user or symlinked skills', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-next-reclaim-home-'))
  const external = mkdtempSync(join(tmpdir(), 'dsh-next-reclaim-ext-'))
  roots.push(home, external)

  const skillsRoot = join(home, 'skills')
  // Legacy plugin-managed copy left by pre-Phase-3 dsh-plugin-desktop -> must be reclaimed
  const legacyDir = join(skillsRoot, 'omnimux-ecom-market-research')
  mkdirSync(legacyDir, { recursive: true })
  writeFileSync(join(legacyDir, 'SKILL.md'), '---\nname: omnimux-ecom-market-research\n---\n')
  writeFileSync(
    join(legacyDir, 'omnimux-skill.json'),
    `${JSON.stringify({ id: 'omnimux-ecom-market-research', origin: 'plugin:omnimux-market' })}\n`,
  )

  // User-authored skill (no marker) -> must stay untouched
  const userDir = join(skillsRoot, 'my-own-workflow')
  mkdirSync(userDir, { recursive: true })
  writeFileSync(join(userDir, 'SKILL.md'), '---\nname: my-own-workflow\n---\n')

  // Market manual install (non-plugin origin) -> must stay untouched
  const marketDir = join(skillsRoot, 'community-skill')
  mkdirSync(marketDir, { recursive: true })
  writeFileSync(join(marketDir, 'SKILL.md'), '---\nname: community-skill\n---\n')
  writeFileSync(
    join(marketDir, 'omnimux-skill.json'),
    `${JSON.stringify({ id: 'community-skill', origin: 'market:skillhub' })}\n`,
  )

  // Symlinked directory pointing outside -> must never be deleted
  const extDir = join(external, 'linked-plugin-skill')
  mkdirSync(extDir, { recursive: true })
  writeFileSync(join(extDir, 'SKILL.md'), '---\nname: linked-plugin-skill\n---\n')
  writeFileSync(
    join(extDir, 'omnimux-skill.json'),
    `${JSON.stringify({ id: 'linked-plugin-skill', origin: 'plugin:omnimux-market' })}\n`,
  )
  const symlinkDir = join(skillsRoot, 'linked-plugin-skill')
  symlinkSync(extDir, symlinkDir, 'dir')

  const manager = new NextProfiles(home)
  const profileDir = manager.ensure('desktop')
  loadNextProfile(profileDir, home)

  expect(existsSync(legacyDir)).toBe(false)
  expect(existsSync(join(userDir, 'SKILL.md'))).toBe(true)
  expect(existsSync(join(marketDir, 'SKILL.md'))).toBe(true)
  expect(existsSync(symlinkDir)).toBe(true)
  expect(existsSync(join(extDir, 'SKILL.md'))).toBe(true)
})
