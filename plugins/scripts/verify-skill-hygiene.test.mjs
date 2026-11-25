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
      items: [
        {
          id: 'sk-alpha',
          tab: 'skills',
          kind: 'skill',
          skill: 'alpha-skill',
          origin: 'first-party',
          license: 'MIT',
          owner: 'omnimux-market',
          author: 'OmniMux',
          source: { type: 'bundled', path: 'catalog/skills/alpha-skill' },
        },
      ],
    }),
  )
  writeFileSync(
    join(market, 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [{ slug: 'beta-skill', role: 'preset-shelf', origin: 'first-party', license: 'MIT', owner: 'omnimux-market' }],
    }),
  )
  return root
}

test('real repository passes verifySkillHygiene with zero violations', () => {
  const result = verifySkillHygiene(PLUGINS_ROOT)
  assert.deepEqual(result.issues, [], `unexpected hygiene issues: ${JSON.stringify(result.issues, null, 2)}`)
  assert.equal(result.ok, true)
  assert.equal(result.stats.catalogDirCount, result.stats.indexedCount + result.stats.bundledCount)
  assert.ok(result.stats.catalogItemCount >= 140)
  assert.ok(result.stats.pluginSkillCount > 0)
  assert.equal(result.stats.manifestMetadataCount, result.stats.pluginSkillCount)
  assert.equal(result.stats.bundledThirdPartyCount, 1)
  assert.equal(result.stats.quickShortcutCount, 4)
  assert.ok(result.stats.presetSkillRefCount >= 120, `expected >= 120 preset/shelf refs, got ${result.stats.presetSkillRefCount}`)
  assert.ok(result.stats.builtinExpertSkillRefCount >= 18, `expected >= 18 expert refs, got ${result.stats.builtinExpertSkillRefCount}`)
  assert.ok(result.stats.registeredToolCount >= 100, `expected >= 100 registered tools, got ${result.stats.registeredToolCount}`)
  assert.ok(result.stats.toolCheckedSkillCount >= 24, `expected >= 24 tool-checked skills, got ${result.stats.toolCheckedSkillCount}`)
})

test('rejects product plugin duplicating upstream DSH Cordis skill via disk or relative manifest path', (t) => {
  const root = makeFixtureRoot(t)
  const dupDir = join(root, 'plugins', 'omnimux', 'skills', 'cordis-plugin-development')
  mkdirSync(dupDir, { recursive: true })
  writeFileSync(join(dupDir, 'SKILL.md'), '---\nname: cordis-plugin-development\n---\n')
  const altDir = join(root, 'plugins', 'omnimux', 'bundled', 'editing-cordis-compositions')
  mkdirSync(altDir, { recursive: true })
  writeFileSync(join(altDir, 'SKILL.md'), '---\nname: editing-cordis-compositions\n---\n')
  writeFileSync(
    join(root, 'plugins', 'omnimux', 'dsh.manifest.json'),
    JSON.stringify({
      id: 'omnimux',
      skills: [
        './skills/cordis-plugin-development/SKILL.md',
        'bundled/editing-cordis-compositions/SKILL.md',
      ],
    }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  const upstreamIssues = result.issues.filter((i) => i.code === 'upstream-collision')
  assert.equal(upstreamIssues.length, 3)
})

test('rejects dangling manifest skill, undeclared plugin skill, and cross-plugin duplicate slug', (t) => {
  const root = makeFixtureRoot(t)
  mkdirSync(join(root, 'plugins', 'plugin-a', 'skills', 'shared-skill'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'plugin-a', 'skills', 'shared-skill', 'SKILL.md'), '# A\n')
  mkdirSync(join(root, 'plugins', 'plugin-a', 'skills', 'undeclared-skill'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'plugin-a', 'skills', 'undeclared-skill', 'SKILL.md'), '# U\n')
  writeFileSync(
    join(root, 'plugins', 'plugin-a', 'dsh.manifest.json'),
    JSON.stringify({
      id: 'plugin-a',
      skills: ['skills/shared-skill/SKILL.md', 'skills/missing-skill/SKILL.md'],
    }),
  )

  mkdirSync(join(root, 'plugins', 'plugin-b', 'skills', 'shared-skill'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'plugin-b', 'skills', 'shared-skill', 'SKILL.md'), '# B\n')
  writeFileSync(
    join(root, 'plugins', 'plugin-b', 'dsh.manifest.json'),
    JSON.stringify({
      id: 'plugin-b',
      skills: ['skills/shared-skill/SKILL.md'],
    }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'dangling-manifest-skill'))
  assert.ok(result.issues.some((i) => i.code === 'undeclared-plugin-skill'))
  assert.ok(result.issues.some((i) => i.code === 'cross-plugin-duplicate-skill'))
})

test('rejects direct and nested symlinks inside catalog/skills/ and plugins/*/skills/', (t) => {
  const root = makeFixtureRoot(t)
  const skillsDir = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills')
  symlinkSync('alpha-skill', join(skillsDir, 'alpha-alias'))

  const nestedDir = join(skillsDir, 'alpha-skill', 'references')
  mkdirSync(nestedDir, { recursive: true })
  symlinkSync('../SKILL.md', join(nestedDir, 'linked.md'))

  const pluginSkills = join(root, 'plugins', 'omnimux-clip', 'skills')
  mkdirSync(join(pluginSkills, 'real-skill'), { recursive: true })
  writeFileSync(join(pluginSkills, 'real-skill', 'SKILL.md'), '# Real\n')
  symlinkSync('real-skill', join(pluginSkills, 'linked-skill'))

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  const symlinkPaths = result.issues.filter((i) => i.code === 'symlink-forbidden').map((i) => i.path)
  assert.ok(symlinkPaths.some((p) => p?.includes('alpha-alias')))
  assert.ok(symlinkPaths.some((p) => p?.includes('alpha-skill/references/linked.md')))
  assert.ok(symlinkPaths.some((p) => p?.includes('omnimux-clip/skills/linked-skill')))
})

test('rejects unclaimed orphan directory and upstream slug in catalog/skills/', (t) => {
  const root = makeFixtureRoot(t)
  const orphan = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'orphan-stub')
  mkdirSync(orphan, { recursive: true })
  writeFileSync(join(orphan, 'SKILL.md'), '---\nname: orphan-stub\n---\n')

  const upstreamInCatalog = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'office-xlsx')
  mkdirSync(upstreamInCatalog, { recursive: true })
  writeFileSync(join(upstreamInCatalog, 'SKILL.md'), '---\nname: office-xlsx\n---\n')

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'unclaimed-catalog-dir' && i.path?.includes('orphan-stub')))
  assert.ok(result.issues.some((i) => i.code === 'upstream-collision' && i.path?.includes('office-xlsx')))
})

test('handles index.json remote git skills without false positive, while catching duplicates, bad paths, and dangling bundled skills', (t) => {
  const root = makeFixtureRoot(t)
  writeFileSync(
    join(root, 'plugins', 'omnimux-market', 'catalog', 'index.json'),
    JSON.stringify({
      items: [
        {
          id: 'sk-alpha',
          tab: 'skills',
          kind: 'skill',
          skill: 'alpha-skill',
          source: { type: 'bundled', path: 'catalog/skills/wrong-dir' },
        },
        {
          id: 'sk-alpha-dup',
          tab: 'skills',
          kind: 'skill',
          skill: 'alpha-skill',
          source: { type: 'bundled', path: 'catalog/skills/alpha-skill' },
        },
        {
          id: 'sk-remote-ok',
          tab: 'skills',
          kind: 'skill',
          skill: 'remote-git-skill',
          source: { type: 'git', repo: 'example/repo', path: 'skills/remote-git-skill' },
        },
        {
          id: 'sk-missing-local',
          tab: 'skills',
          kind: 'skill',
          skill: 'missing-bundled-skill',
          source: { type: 'bundled', path: 'catalog/skills/missing-bundled-skill' },
        },
      ],
    }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'invalid-indexed-source-path'))
  assert.ok(result.issues.some((i) => i.code === 'duplicate-indexed-skill'))
  assert.ok(result.issues.some((i) => i.code === 'dangling-indexed-entry' && i.message.includes('missing-bundled-skill')))
  assert.equal(
    result.issues.some((i) => i.message.includes('remote-git-skill')),
    false,
    'remote git skill must not trigger dangling-indexed-entry false positive',
  )
})

test('rejects overlap, duplicate/invalid/dangling bundled entries, and byte-identical SKILL.md duplicates', (t) => {
  const root = makeFixtureRoot(t)
  const gamma = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'gamma-dup')
  mkdirSync(gamma, { recursive: true })
  writeFileSync(join(gamma, 'SKILL.md'), '---\nname: beta-skill\ndescription: Beta\n---\n\n# Beta\n')
  writeFileSync(
    join(root, 'plugins', 'omnimux-market', 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [
        { slug: '' },
        { slug: 'alpha-skill', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'beta-skill', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'beta-skill', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'gamma-dup', role: 'preset-shelf', owner: 'omnimux-market' },
        { slug: 'ghost-skill', role: 'preset-shelf', owner: 'omnimux-market' },
      ],
    }),
  )

  const result = verifySkillHygiene(root)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'invalid-bundled-entry'))
  assert.ok(result.issues.some((i) => i.code === 'overlap-bundled-and-indexed'))
  assert.ok(result.issues.some((i) => i.code === 'duplicate-bundled-entry'))
  assert.ok(result.issues.some((i) => i.code === 'duplicate-skill-content'))
  assert.ok(result.issues.some((i) => i.code === 'dangling-bundled-entry'))
})

test('rejects missing/empty/directory SKILL.md and missing catalog files or empty catalog root', (t) => {
  const root = makeFixtureRoot(t)
  const noMd = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'no-md')
  const emptyMd = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'empty-md')
  const dirMd = join(root, 'plugins', 'omnimux-market', 'catalog', 'skills', 'dir-md')
  mkdirSync(noMd, { recursive: true })
  mkdirSync(emptyMd, { recursive: true })
  writeFileSync(join(emptyMd, 'SKILL.md'), '   \n')
  mkdirSync(join(dirMd, 'SKILL.md'), { recursive: true })
  writeFileSync(
    join(root, 'plugins', 'omnimux-market', 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [
        { slug: 'beta-skill' },
        { slug: 'no-md' },
        { slug: 'empty-md' },
        { slug: 'dir-md' },
      ],
    }),
  )

  const res1 = verifySkillHygiene(root)
  assert.equal(res1.ok, false)
  assert.ok(res1.issues.some((i) => i.code === 'missing-skill-md'))
  assert.ok(res1.issues.some((i) => i.code === 'empty-skill-md'))
  assert.ok(res1.issues.some((i) => i.code === 'invalid-skill-md'))

  const emptyRoot = mkdtempSync(join(tmpdir(), 'omx-skill-hygiene-empty-'))
  t.after(() => rmSync(emptyRoot, { recursive: true, force: true }))
  const resMissing = verifySkillHygiene(emptyRoot)
  assert.equal(resMissing.ok, false)
  assert.ok(resMissing.issues.some((i) => i.code === 'missing-catalog-index'))
  assert.ok(resMissing.issues.some((i) => i.code === 'missing-bundled-manifest'))
  assert.ok(resMissing.issues.some((i) => i.code === 'missing-catalog-skills-dir'))

  mkdirSync(join(emptyRoot, 'plugins', 'omnimux-market', 'catalog', 'skills'), { recursive: true })
  writeFileSync(join(emptyRoot, 'plugins', 'omnimux-market', 'catalog', 'index.json'), JSON.stringify({ items: [] }))
  writeFileSync(join(emptyRoot, 'plugins', 'omnimux-market', 'catalog', 'bundled-skills.json'), JSON.stringify({ skills: [] }))
  const resEmpty = verifySkillHygiene(emptyRoot)
  assert.equal(resEmpty.ok, false)
  assert.ok(resEmpty.issues.some((i) => i.code === 'empty-catalog-skills-dir'))
})

test('rejects hollow quick shortcuts, hollow presets/shelves, static installed flags, and hollow builtin experts (#235)', (t) => {
  const root = makeFixtureRoot(t)
  const market = join(root, 'plugins', 'omnimux-market')

  // Quick shortcut referencing one real skill and one hollow skill
  const shortcutsDir = join(root, 'plugins', 'omnimux', 'src', 'client', 'composer-quick-shortcuts')
  mkdirSync(shortcutsDir, { recursive: true })
  writeFileSync(
    join(shortcutsDir, 'catalog.js'),
    "export const QUICK_SHORTCUTS = [{ skillSlug: 'alpha-skill' }, { skillSlug: 'ghost-shortcut' }]\n",
  )

  // presets/omni-agent/skills.json with hollow slug + static installed:true
  mkdirSync(join(root, 'presets', 'omni-agent'), { recursive: true })
  writeFileSync(
    join(root, 'presets', 'omni-agent', 'skills.json'),
    JSON.stringify({
      presetId: 'omni-agent',
      skills: [
        { slug: 'alpha-skill', installed: true },
        { slug: 'ghost-preset-skill' },
      ],
    }),
  )

  // catalog/preset-skills.json with hollow slug + static installed:true
  writeFileSync(
    join(market, 'catalog', 'preset-skills.json'),
    JSON.stringify({
      'tiktok-agent': {
        presetId: 'tiktok-agent',
        skills: [
          { slug: 'beta-skill', installed: true },
          { slug: 'ghost-shelf-skill' },
        ],
      },
    }),
  )

  // Built-in expert referencing hollow skill + bundled expert plugin.json referencing missing skill
  mkdirSync(join(market, 'src'), { recursive: true })
  writeFileSync(
    join(market, 'src', 'expert-market.ts'),
    "export const DEFAULT_MARKET_EXPERTS = [\n  { id: 'exp-a', skills: ['alpha-skill', 'ghost-expert-skill'] },\n]\n",
  )
  mkdirSync(join(market, 'catalog', 'experts', 'demo-team', '.codebuddy-plugin'), { recursive: true })
  writeFileSync(
    join(market, 'catalog', 'experts', 'demo-team', '.codebuddy-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo-team', skills: ['./skills/missing-nested-skill'] }),
  )

  const res = verifySkillHygiene(root)
  assert.equal(res.ok, false)
  assert.ok(res.issues.some((i) => i.code === 'hollow-quick-shortcut-skill' && i.message.includes('ghost-shortcut')))
  assert.ok(res.issues.some((i) => i.code === 'hollow-preset-skill' && i.message.includes('ghost-preset-skill')))
  assert.ok(res.issues.some((i) => i.code === 'hollow-preset-shelf-skill' && i.message.includes('ghost-shelf-skill')))
  assert.ok(res.issues.some((i) => i.code === 'hollow-builtin-expert-skill' && i.message.includes('ghost-expert-skill')))
  assert.ok(res.issues.some((i) => i.code === 'hollow-bundled-expert-skill' && i.message.includes('missing-nested-skill')))
  assert.equal(res.issues.filter((i) => i.code === 'static-installed-forbidden').length, 2)
})

test('rejects unregistered OmniMux runtime tool references in quick-shortcut and plugin SKILL.md (#235)', (t) => {
  const root = makeFixtureRoot(t)
  const market = join(root, 'plugins', 'omnimux-market')

  // Register one real tool in fixture workspace
  mkdirSync(join(root, 'plugins', 'omnimux-video', 'src'), { recursive: true })
  writeFileSync(
    join(root, 'plugins', 'omnimux-video', 'src', 'index.js'),
    "export function apply(ctx) { ctx.tools.register({ name: 'video_analyze', description: 'ok' }) }\n",
  )

  // Quick shortcut pointing to alpha-skill, which references one valid tool, one wildcard, one non-tool id, and one bogus tool
  const shortcutsDir = join(root, 'plugins', 'omnimux', 'src', 'client', 'composer-quick-shortcuts')
  mkdirSync(shortcutsDir, { recursive: true })
  writeFileSync(
    join(shortcutsDir, 'catalog.js'),
    "export const QUICK_SHORTCUTS = [{ skillSlug: 'alpha-skill' }]\n",
  )
  writeFileSync(
    join(market, 'catalog', 'skills', 'alpha-skill', 'SKILL.md'),
    '---\nname: alpha-skill\ndescription: Alpha\n---\n\nUse `video_analyze`, `workflow_*`, `video_inline_analysis_prepare`, and bogus `video_magic_hallucination`.\n',
  )

  const res = verifySkillHygiene(root)
  assert.equal(res.ok, false)
  const toolIssues = res.issues.filter((i) => i.code === 'unregistered-skill-tool-reference')
  assert.equal(toolIssues.length, 1)
  assert.match(toolIssues[0].message, /video_magic_hallucination/)
})

test('rejects missing provenance, Official author, manifest skillMetadata drift, third-party notice drift, and external hotlinks (#237)', (t) => {
  const root = makeFixtureRoot(t)
  const market = join(root, 'plugins', 'omnimux-market')

  // 1. Catalog item with forbidden Official author + missing origin/license/owner + bundled non-concrete license
  writeFileSync(
    join(market, 'catalog', 'index.json'),
    JSON.stringify({
      items: [
        {
          id: 'sk-alpha',
          tab: 'skills',
          kind: 'skill',
          skill: 'alpha-skill',
          author: 'Official',
          origin: 'bogus-origin',
          license: 'SEE UPSTREAM',
          owner: '',
          source: { type: 'bundled', path: 'catalog/skills/alpha-skill' },
        },
      ],
    }),
  )

  // 2. Bundled third-party skill missing LICENSE, upstream, noticeRef, and notice entry + stale notice
  writeFileSync(
    join(market, 'catalog', 'bundled-skills.json'),
    JSON.stringify({
      skills: [
        {
          slug: 'beta-skill',
          role: 'session-guide',
          origin: 'third-party',
          license: 'MIT',
          owner: 'omnimux-market',
        },
      ],
    }),
  )
  writeFileSync(
    join(market, 'THIRD_PARTY_NOTICES.md'),
    '# Notices\n\nStale reference to `catalog/skills/removed-third-party/`.\n',
  )

  // 3. External hotlink + legacy source: official + vendor leftover in meta.yaml/SKILL.md
  writeFileSync(
    join(market, 'catalog', 'skills', 'alpha-skill', 'meta.yaml'),
    'cover: "https://cdn.hailuoai.com/demo/video.mp4"\nsource: official\n',
  )
  writeFileSync(
    join(market, 'catalog', 'skills', 'alpha-skill', 'SKILL.md'),
    '---\nname: alpha-skill\ndescription: Alpha\n---\n\nFollow kling-generation-runtime for WorkBuddy.\n',
  )

  // 4. Plugin dsh.manifest.json with license mismatch & stale skillMetadata key
  const clipDir = join(root, 'plugins', 'omnimux-clip')
  mkdirSync(join(clipDir, 'skills', 'clip-craft'), { recursive: true })
  writeFileSync(join(clipDir, 'skills', 'clip-craft', 'SKILL.md'), '---\nname: clip-craft\ndescription: ok\n---\n# ok\n')
  writeFileSync(join(clipDir, 'package.json'), JSON.stringify({ name: 'omnimux-clip', license: 'SEE LICENSE IN LICENSE' }))
  writeFileSync(
    join(clipDir, 'dsh.manifest.json'),
    JSON.stringify({
      id: 'omnimux-clip',
      skills: ['skills/clip-craft/SKILL.md'],
      skillMetadata: {
        'clip-craft': { origin: 'first-party', license: 'MIT', owner: 'omnimux-clip' },
        'stale-ghost': { origin: 'first-party', license: 'SEE LICENSE IN LICENSE', owner: 'omnimux-clip' },
      },
    }),
  )

  const res = verifySkillHygiene(root)
  assert.equal(res.ok, false)
  const codes = new Set(res.issues.map((i) => i.code))
  for (const expectedCode of [
    'official-author-forbidden',
    'invalid-catalog-origin',
    'missing-catalog-owner',
    'non-concrete-bundled-license',
    'missing-third-party-upstream',
    'missing-third-party-notice-ref',
    'missing-third-party-license-file',
    'undocumented-third-party-skill',
    'stale-third-party-notice',
    'external-hotlink-forbidden',
    'legacy-official-source-forbidden',
    'third-party-vendor-leftover',
    'manifest-skill-license-mismatch',
    'stale-manifest-skill-metadata',
  ]) {
    assert.equal(codes.has(expectedCode), true, `expected issue code ${expectedCode}, got [${[...codes].join(', ')}]`)
  }
})
