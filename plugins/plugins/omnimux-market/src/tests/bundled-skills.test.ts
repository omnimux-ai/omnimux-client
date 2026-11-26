import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  BUNDLED_SKILL_RANK,
  MARKET_BUNDLED_PROVIDER_NAME,
  loadBundledMarketSkills,
  parseInvocationPolicy,
  registerBundledMarketSkills,
  resolvePhysicalDir,
} from '../bundled-skills.js'
import { apply as applyExpertSkills } from '../expert-skills-plugin.js'
import { DEFAULT_MARKET_EXPERTS } from '../expert-market.js'
import { buildMarketExpertPresetDefinition } from '../expert-runtime.js'
import { packageRoot } from '../expert/paths.js'

test('loadBundledMarketSkills loads all 20 manifest-declared skills with layered invocation policy', () => {
  const pkgRoot = packageRoot()
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'dsh.manifest.json'), 'utf8'))
  const expectedSlugs = manifest.skills
    .map((rel: string) => rel.replace(/^skills\//, '').replace(/\/SKILL\.md$/, ''))
    .sort()

  const skills = loadBundledMarketSkills(pkgRoot)
  const actualSlugs = skills.map((s) => s.name).sort()
  assert.deepEqual(actualSlugs, expectedSlugs)
  assert.equal(skills.length, 20)

  const modelInvocable = skills.filter((s) => s.invocation.modelInvocable).map((s) => s.name)
  assert.deepEqual(
    modelInvocable,
    ['omnimux-social-data'],
    'only omnimux-social-data stays globally modelInvocable; 19 vertical SOP skills default to 0-Token',
  )

  for (const skill of skills) {
    assert.equal(skill.source, 'bundled')
    assert.equal(skill.invocation.userInvocable, true, `${skill.name} stays user-invocable via / menu`)
    assert.equal(skill.resourceBase.kind, 'directory')
    assert.equal(existsSync(skill.resourceBase.path), true)
    assert.equal(existsSync(skill.path), true)
    assert.ok(skill.description.length > 0)
    assert.ok(skill.content.length > 50)
  }
})

test('registerBundledMarketSkills registers provider at BUNDLED_SKILL_RANK (600) with working list/get and dispose', async () => {
  let providerFactory: (() => any) | null = null
  let disposed = false
  const ctx = {
    skills: {
      registerProvider(factory: () => any) {
        providerFactory = factory
        return () => {
          disposed = true
        }
      },
    },
  }

  const dispose = registerBundledMarketSkills(ctx)
  assert.equal(typeof providerFactory, 'function')
  const provider = providerFactory!()
  assert.equal(provider.name, MARKET_BUNDLED_PROVIDER_NAME)

  const candidates = await provider.list()
  assert.equal(candidates.length, 20)
  for (const c of candidates) {
    assert.equal(c.rank, BUNDLED_SKILL_RANK)
    assert.equal(c.source, 'bundled')
    assert.equal(c.provider, MARKET_BUNDLED_PROVIDER_NAME)
    assert.equal(c.resourceBase?.kind, 'directory')
  }

  const socialData = candidates.find((c: any) => c.name === 'omnimux-social-data')
  assert.deepEqual(socialData?.invocation, { modelInvocable: true, userInvocable: true })

  const ecomResearch = candidates.find((c: any) => c.name === 'omnimux-ecom-market-research')
  assert.deepEqual(ecomResearch?.invocation, { modelInvocable: false, userInvocable: true })

  const loaded = await provider.get({ name: 'omnimux-ecom-market-research' })
  assert.ok(loaded)
  assert.equal(loaded.name, 'omnimux-ecom-market-research')
  assert.equal(loaded.provider, MARKET_BUNDLED_PROVIDER_NAME)
  assert.match(loaded.content, /analyze_market\.py/)

  dispose()
  assert.equal(disposed, true)
})

test('registerBundledMarketSkills supports deferred ctx.inject(["skills"]) mounting', async () => {
  let registeredName = ''
  const ctx = {
    inject(deps: string[], fn: (sub: any) => void) {
      assert.deepEqual(deps, ['skills'])
      fn({
        skills: {
          registerProvider(factory: () => any) {
            registeredName = factory().name
            return () => {}
          },
        },
      })
    },
  }
  registerBundledMarketSkills(ctx)
  assert.equal(registeredName, MARKET_BUNDLED_PROVIDER_NAME)
})

test('expert-skills plugin promotes ONLY the hired expert bound skills to modelInvocable: true', async () => {
  for (const exp of DEFAULT_MARKET_EXPERTS) {
    const def = buildMarketExpertPresetDefinition(exp)
    const expertSkillsRow = def.plugins.find((row) => row.id === 'expert-skills')
    assert.ok(expertSkillsRow, `${exp.id} must include expert-skills row`)
    assert.equal(expertSkillsRow!.name, 'omnimux-market/expert-skills')
    assert.deepEqual((expertSkillsRow!.config as any)?.skills, exp.skills)

    let registeredProvider: any = null
    const mockCtx = {
      skills: {
        registerProvider(factory: () => any) {
          registeredProvider = factory()
          return () => {}
        },
      },
    }
    applyExpertSkills(mockCtx, expertSkillsRow!.config as any)
    assert.ok(registeredProvider, `${exp.id} must register scoped provider`)
    assert.equal(registeredProvider.name, `omnimux-expert-skills:${exp.id}`)

    const candidates = await registeredProvider.list()
    const expectedMarketSkills = exp.skills.filter((slug) => slug !== 'clip-craft')
    assert.deepEqual(
      candidates.map((c: any) => c.name).sort(),
      [...expectedMarketSkills].sort(),
      `${exp.id} must promote only its bound omnimux-market skills (skipping clip-craft owned by omnimux-clip)`,
    )
    for (const c of candidates) {
      assert.equal(c.rank, BUNDLED_SKILL_RANK)
      assert.deepEqual(c.invocation, { modelInvocable: true, userInvocable: true })
      const loaded = await registeredProvider.get({ name: c.name })
      assert.ok(loaded && loaded.content.length > 50)
      assert.deepEqual(loaded.invocation, { modelInvocable: true, userInvocable: true })
    }
  }
})

test('resolvePhysicalDir prefers app.asar.unpacked when present and falls back cleanly otherwise', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omx-asar-unpacked-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const asarPath = join(root, 'app.asar', 'node_modules', 'omnimux-market', 'skills', 'tiktok-growth')
  const unpackedPath = join(root, 'app.asar.unpacked', 'node_modules', 'omnimux-market', 'skills', 'tiktok-growth')

  assert.equal(resolvePhysicalDir(asarPath), asarPath, 'keeps original path when unpacked sibling does not exist')
  mkdirSync(unpackedPath, { recursive: true })
  assert.equal(resolvePhysicalDir(asarPath), unpackedPath, 'rewrites to app.asar.unpacked when sibling exists')
})

test('parseInvocationPolicy respects YAML booleans and string tokens', () => {
  assert.deepEqual(parseInvocationPolicy({}), { modelInvocable: true, userInvocable: true })
  assert.deepEqual(parseInvocationPolicy({ 'disable-model-invocation': true }), { modelInvocable: false, userInvocable: true })
  assert.deepEqual(parseInvocationPolicy({ 'disable-model-invocation': 'true', 'user-invocable': 'false' }), { modelInvocable: false, userInvocable: false })
  assert.deepEqual(parseInvocationPolicy({ 'disable-model-invocation': false, 'user-invocable': true }), { modelInvocable: true, userInvocable: true })
})
