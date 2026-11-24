import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SKILL_ORIGIN_FILENAME, reclaimLegacyManagedPluginSkills } from './legacy-skill-reclaim.js'

function writeSkill(root, id, marker) {
  const dir = join(root, 'skills', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: fixture\n---\nBody\n`, 'utf8')
  if (marker !== undefined) {
    writeFileSync(
      join(dir, SKILL_ORIGIN_FILENAME),
      typeof marker === 'string' ? marker : `${JSON.stringify(marker, null, 2)}\n`,
      'utf8',
    )
  }
  return dir
}

test('reclaimLegacyManagedPluginSkills removes only plugin-origin managed copies and preserves user/market/symlinked skills', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'omx-reclaim-home-'))
  const external = mkdtempSync(join(tmpdir(), 'omx-reclaim-ext-'))
  t.after(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  })

  // Should be reclaimed: valid plugin:* markers with matching directory id
  const legacyClip = writeSkill(home, 'clip-craft', { id: 'clip-craft', origin: 'plugin:omnimux-clip' })
  const legacyEcom = writeSkill(home, 'omnimux-ecom-market-research', {
    id: 'omnimux-ecom-market-research',
    origin: 'plugin:omnimux-market',
  })

  // Must NEVER be deleted:
  const userSkill = writeSkill(home, 'my-custom-skill') // no marker
  const marketManual = writeSkill(home, 'community-pdf', { id: 'community-pdf', origin: 'market:skillhub' }) // non-plugin origin
  const renamedCopy = writeSkill(home, 'forked-clip', { id: 'clip-craft', origin: 'plugin:omnimux-clip' }) // mismatched id
  const corruptMarker = writeSkill(home, 'broken-json', '{not valid json')
  const emptyPluginOrigin = writeSkill(home, 'empty-origin', { id: 'empty-origin', origin: 'plugin:' })
  const keptSkill = writeSkill(home, 'kept-staged', { id: 'kept-staged', origin: 'plugin:fixture' })

  // Symlinked directory pointing to external dir with plugin marker must NOT be deleted
  const extDir = join(external, 'linked-skill')
  mkdirSync(extDir, { recursive: true })
  writeFileSync(join(extDir, 'SKILL.md'), '---\nname: linked-skill\ndescription: x\n---\n', 'utf8')
  writeFileSync(join(extDir, SKILL_ORIGIN_FILENAME), JSON.stringify({ id: 'linked-skill', origin: 'plugin:omnimux-market' }), 'utf8')
  const symlinkDir = join(home, 'skills', 'linked-skill')
  symlinkSync(extDir, symlinkDir, 'dir')

  // Symlinked marker file inside a user directory must NOT trigger deletion
  const symlinkMarkerDir = writeSkill(home, 'symlink-marker')
  const extMarker = join(external, 'ext-marker.json')
  writeFileSync(extMarker, JSON.stringify({ id: 'symlink-marker', origin: 'plugin:omnimux-market' }), 'utf8')
  symlinkSync(extMarker, join(symlinkMarkerDir, SKILL_ORIGIN_FILENAME))

  const warnings = []
  const result = await reclaimLegacyManagedPluginSkills(home, {
    keepIds: ['kept-staged'],
    logger: { warn: (...args) => warnings.push(args) },
  })

  assert.deepEqual(result.reclaimed, ['clip-craft', 'omnimux-ecom-market-research'])
  assert.equal(existsSync(legacyClip), false)
  assert.equal(existsSync(legacyEcom), false)

  // Every protected skill remains intact
  for (const dir of [userSkill, marketManual, renamedCopy, corruptMarker, emptyPluginOrigin, keptSkill, symlinkDir, extDir, symlinkMarkerDir]) {
    assert.equal(existsSync(dir), true, `protected path must remain untouched: ${dir}`)
  }
  assert.match(readFileSync(join(userSkill, 'SKILL.md'), 'utf8'), /my-custom-skill/)
  assert.equal(warnings.length, 1, 'corrupted marker logs one warning instead of failing')

  // Idempotent on second run
  const second = await reclaimLegacyManagedPluginSkills(home, { keepIds: ['kept-staged'] })
  assert.deepEqual(second.reclaimed, [])
})

test('reclaimLegacyManagedPluginSkills skips symlinked skills root and missing home cleanly', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'omx-reclaim-rootlink-'))
  const realRoot = mkdtempSync(join(tmpdir(), 'omx-reclaim-target-'))
  t.after(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(realRoot, { recursive: true, force: true })
  })

  const nested = join(realRoot, 'clip-craft')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, SKILL_ORIGIN_FILENAME), JSON.stringify({ id: 'clip-craft', origin: 'plugin:omnimux-clip' }), 'utf8')
  symlinkSync(realRoot, join(home, 'skills'), 'dir')

  const result = await reclaimLegacyManagedPluginSkills(home)
  assert.deepEqual(result.reclaimed, [])
  assert.equal(existsSync(nested), true, 'symlinked skills root must never be traversed or mutated')

  const missing = await reclaimLegacyManagedPluginSkills(join(home, 'nonexistent'))
  assert.deepEqual(missing.reclaimed, [])
})
