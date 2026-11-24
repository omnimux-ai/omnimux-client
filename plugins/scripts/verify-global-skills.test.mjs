import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS,
  GLOBAL_MODEL_INVOCABLE_BUDGET,
  verifyGlobalSkills,
} from './verify-global-skills.mjs'

function createPluginFixture(
  pluginsDir,
  pluginId,
  {
    skills = [],
    includeProvider = true,
  } = {},
) {
  const pluginDir = join(pluginsDir, pluginId)
  mkdirSync(join(pluginDir, 'src'), { recursive: true })
  writeFileSync(
    join(pluginDir, 'dsh.manifest.json'),
    `${JSON.stringify({ id: pluginId, skills: skills.map((s) => `skills/${s.slug}/SKILL.md`) }, null, 2)}\n`,
    'utf8',
  )
  if (includeProvider) {
    writeFileSync(
      join(pluginDir, 'src', 'bundled-skills.js'),
      [
        'export const BUNDLED_SKILL_RANK = 600',
        'export function registerBundled(ctx) {',
        "  ctx.inject(['skills'], (sub) => {",
        "    const flag = 'disable-model-invocation'",
        '    sub.skills.registerProvider(() => ({ name: flag, list: async () => [{ rank: BUNDLED_SKILL_RANK }], get: async () => undefined }))',
        '  })',
        '}',
      ].join('\n'),
      'utf8',
    )
  }
  for (const s of skills) {
    const skillDir = join(pluginDir, 'skills', s.slug)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), s.content, 'utf8')
  }
}

test('real workspace passes verifyGlobalSkills with all bundled-skill plugins and <= 4 global modelInvocable skills', () => {
  const res = verifyGlobalSkills()
  assert.equal(res.valid, true, `unexpected issues:\n${res.issues.map((i) => `[${i.code}] ${i.message}`).join('\n')}`)
  for (const requiredPlugin of [
    'omnimux-clip',
    'omnimux-inspiration',
    'omnimux-market',
    'omnimux-products',
    'omnimux-tiktok-selection',
    'omnimux-workflow',
  ]) {
    assert.equal(
      res.pluginsChecked.includes(requiredPlugin),
      true,
      `expected ${requiredPlugin} to be checked by verifyGlobalSkills`,
    )
  }
  assert.equal(res.totalBundledSkills >= 28, true, `expected >= 28 bundled skills, got ${res.totalBundledSkills}`)
  assert.equal(res.globalModelInvocable.length <= GLOBAL_MODEL_INVOCABLE_BUDGET, true)
  assert.deepEqual(res.globalModelInvocable, [...ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS].sort())
  assert.equal(res.zeroTokenSkills.length, res.totalBundledSkills - res.globalModelInvocable.length)
})

test('rejects unapproved globally modelInvocable bundled skill', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omx-global-skills-unapproved-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  createPluginFixture(root, 'omnimux-sample', {
    skills: [
      {
        slug: 'random-vertical-sop',
        content: '---\nname: random-vertical-sop\ndescription: vertical sop\n---\nBody\n',
      },
    ],
  })

  const res = verifyGlobalSkills({ pluginsDir: root })
  assert.equal(res.valid, false)
  assert.equal(res.issues.some((i) => i.code === 'unapproved-global-model-invocable'), true)
})

test('rejects global modelInvocable count exceeding budget', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omx-global-skills-budget-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const fiveAllowed = new Set(['s1', 's2', 's3', 's4', 's5'])
  createPluginFixture(root, 'omnimux-sample', {
    skills: [...fiveAllowed].map((slug) => ({
      slug,
      content: `---\nname: ${slug}\ndescription: fixture\n---\nBody\n`,
    })),
  })

  const res = verifyGlobalSkills({
    pluginsDir: root,
    budget: GLOBAL_MODEL_INVOCABLE_BUDGET,
    allowedGlobalSkills: fiveAllowed,
  })
  assert.equal(res.valid, false)
  assert.equal(res.issues.some((i) => i.code === 'global-model-invocable-budget-exceeded'), true)
})

test('rejects plugin declaring skills in dsh.manifest.json without ctx.skills.registerProvider at rank 600', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omx-global-skills-noprovider-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  createPluginFixture(root, 'omnimux-legacy', {
    includeProvider: false,
    skills: [
      {
        slug: 'legacy-headless',
        content: '---\nname: legacy-headless\ndescription: x\ndisable-model-invocation: true\n---\nBody\n',
      },
    ],
  })

  const res = verifyGlobalSkills({ pluginsDir: root })
  assert.equal(res.valid, false)
  assert.equal(res.issues.some((i) => i.code === 'missing-bundled-skill-provider'), true)
})

test('rejects DSH-forbidden legacy camelCase frontmatter keys and non-boolean invocation flags', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omx-global-skills-frontmatter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  createPluginFixture(root, 'omnimux-bad-fm', {
    skills: [
      {
        slug: 'bad-camel',
        content: '---\nname: bad-camel\ndescription: x\ndisableModelInvocation: true\ndisable-model-invocation: true\n---\nBody\n',
      },
      {
        slug: 'bad-bool',
        content: '---\nname: bad-bool\ndescription: x\ndisable-model-invocation: maybe\n---\nBody\n',
      },
    ],
  })

  const res = verifyGlobalSkills({ pluginsDir: root })
  assert.equal(res.valid, false)
  assert.equal(res.issues.some((i) => i.code === 'forbidden-frontmatter-key' && i.message.includes('disableModelInvocation')), true)
  assert.equal(res.issues.some((i) => i.code === 'invalid-invocation-boolean' && i.message.includes('maybe')), true)
})
