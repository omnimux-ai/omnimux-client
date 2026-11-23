import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifySkillHygiene } from './verify-skill-hygiene.mjs'

const PLUGINS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function makeFixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'omx-skill-hygiene-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const market = join(root, 'plugins', 'omnimux-market')
  mkdirSync(join(market, 'catalog', 'skills', 'alpha-skill'), { recursive: true })
  mkdirSync(join(market, 'catalog', 'skills', 'beta-skill'), { recursive: true })
  writeFileSync(
    join(market, 'catalog', 'skills', 'alpha-skill', 'SKILL.md'),
    '---\nname: alpha-skill\ndescription: Alpha\n---\n\n# Alpha\n',
  )
  writeFileSync(
    join(market, 'catalog', 'skills', 'beta-skill', 'SKILL.md'),
    '---\nname: beta-skill\ndescription: Beta\n---\n\n# Beta\n',
  )
  writeFileSync(
    join(market, 'catalog', 'index.json'),
    JSON.stringify({
      items: [{ id: 'sk-alpha', tab: 'skills', kind: 'skill', skill: 'alpha-skill' }],
    }),
  )
  writeFileSync(
    join(market, 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [{ slug: 'beta-skill', role: 'preset-shelf', owner: 'omnimux-market' }],
    }),
  )
  return root
}

test('real repository passes verifySkillHygiene with zero violations', () => {
  const result = verifySkillHygiene(PLUGINS_ROOT)
  assert.deepEqual(result.issues, [], `unexpected hygiene issues: ${JSON.stringify(result.issues, null, 2)}`)
  assert.equal(result.ok, true)
  assert.equal(result.stats.catalogDirCount, result.stats.indexedCount + result.stats.bundledCount)
})

test('rejects product plugin duplicating upstream DSH Cordis skill', (t) => {
  const root = makeFixtureRoot(t)
  const dupDir = join(root, 'plugins', 'omnimux', 'skills', 'cordis-plugin-development')
  mkdirSync(dupDir, { recursive: true })
  writeFileSync(join(dupDir, 'SKILL.md'), '---\nname: cordis-plugin-development\n---\n')
  writeFileSync(
    join(root, 'plugins', 'omnimux', 'dsh.manifest.json'),
    JSON.stringify({ id: 'omnimux', skills: ['skills/cordis-plugin-development/SKILL.md'] }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  const codes = result.issues.map((i) => i.code)
  assert.equal(codes.filter((c) => c === 'upstream-collision').length, 2)
})

test('rejects symlink inside catalog/skills/', (t) => {
  const root = makeFixtureRoot(t)
  const skillsDir = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills')
  symlinkSync('alpha-skill', join(skillsDir, 'alpha-alias'))

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'symlink-forbidden' && i.path?.includes('alpha-alias')))
})

test('rejects unclaimed orphan directory in catalog/skills/', (t) => {
  const root = makeFixtureRoot(t)
  const orphan = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'orphan-stub')
  mkdirSync(orphan, { recursive: true })
  writeFileSync(join(orphan, 'SKILL.md'), '---\nname: orphan-stub\n---\n')

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'unclaimed-catalog-dir' && i.path?.includes('orphan-stub')))
})

test('rejects overlap between index.json and bundled-skills.json', (t) => {
  const root = makeFixtureRoot(t)
  writeFileSync(
    join(root, 'plugins', 'omnimux-market', 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [
        { slug: 'alpha-skill', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'beta-skill', role: 'preset-shelf', owner: 'omnimux-market' },
      ],
    }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'overlap-bundled-and-indexed'))
})

test('rejects dangling bundled-skills.json entry and byte-identical SKILL.md duplicates', (t) => {
  const root = makeFixtureRoot(t)
  const gamma = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'gamma-dup')
  mkdirSync(gamma, { recursive: true })
  writeFileSync(join(gamma, 'SKILL.md'), '---\nname: beta-skill\ndescription: Beta\n---\n\n# Beta\n')
  writeFileSync(
    join(root, 'plugins', 'omnimux-market', 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [
        { slug: 'beta-skill', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'gamma-dup', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'ghost-skill', role: 'preset-shelf', owner: 'omnimux-market' },
      ],
    }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'duplicate-skill-content'))
  assert.ok(result.issues.some((i) => i.code === 'dangling-bundled-entry'))
})
