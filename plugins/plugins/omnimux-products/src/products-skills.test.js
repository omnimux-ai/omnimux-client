import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { apply } from './index.js'
import {
  PRODUCTS_BRAND_STRATEGY_SKILL,
  PRODUCTS_PHYSICAL_IMPORT_SKILL,
  PRODUCTS_SKILL_PROVIDER_NAME,
  PRODUCTS_SKILL_RANK,
  loadBundledProductsSkills,
  registerProductsSkills,
} from './products-skills.js'

const DSH_MUSTACHE = /\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/

describe('products-skills · bundled SKILL.md source of truth', () => {
  it('loads both bundled product analysis skills with clean frontmatter and body', () => {
    const skills = loadBundledProductsSkills()
    assert.deepEqual(
      skills.map((entry) => entry.name),
      [PRODUCTS_BRAND_STRATEGY_SKILL, PRODUCTS_PHYSICAL_IMPORT_SKILL],
    )

    for (const entry of skills) {
      assert.equal(entry.source, 'bundled')
      assert.ok(entry.description.length > 10, `${entry.name} must carry a description`)
      assert.ok(entry.content.length > 100, `${entry.name} must carry methodology content`)
      assert.equal(existsSync(entry.path), true)
      assert.equal(entry.resourceBase.kind, 'directory')
      assert.equal(existsSync(join(entry.resourceBase.path, 'SKILL.md')), true)
      assert.doesNotMatch(entry.content, DSH_MUSTACHE, `${entry.name} must not leak raw DSH mustache slots`)
      assert.equal(entry.content.includes('请访问'), false, `${entry.name} must never instruct fake fetching`)
    }

    const brand = skills.find((entry) => entry.name === PRODUCTS_BRAND_STRATEGY_SKILL)
    assert.match(brand.content, /brand_basic_info/)
    assert.match(brand.content, /content_angles/)
    assert.match(brand.content, /target_audience/)
    assert.match(brand.content, /JSON Schema/)

    const physical = skills.find((entry) => entry.name === PRODUCTS_PHYSICAL_IMPORT_SKILL)
    assert.match(physical.content, /selling_points/)
    assert.match(physical.content, /categories/)
    assert.match(physical.content, /JSON Schema/)
  })

  it('registers provider at rank 600 via ctx.inject(["skills"])', async () => {
    /** @type {Array<{ deps: string[], fn: Function }>} */
    const injected = []
    /** @type {Array<() => any>} */
    const factories = []

    const ctx = {
      inject(deps, fn) {
        injected.push({ deps, fn })
        fn({
          skills: {
            registerProvider(factory) {
              factories.push(factory)
            },
          },
        })
      },
    }

    registerProductsSkills(ctx)
    assert.equal(injected.length, 1)
    assert.deepEqual(injected[0].deps, ['skills'])
    assert.equal(factories.length, 1)

    const provider = factories[0]()
    assert.equal(provider.name, PRODUCTS_SKILL_PROVIDER_NAME)

    const candidates = await provider.list()
    assert.equal(candidates.length, 2)
    for (const candidate of candidates) {
      assert.equal(candidate.rank, PRODUCTS_SKILL_RANK)
      assert.equal(candidate.rank, 600)
      assert.equal(candidate.provider, PRODUCTS_SKILL_PROVIDER_NAME)
      assert.equal(candidate.source, 'bundled')
      assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })

      const loaded = await provider.get(candidate)
      assert.ok(loaded, `provider.get must resolve ${candidate.name}`)
      assert.equal(loaded.name, candidate.name)
      assert.equal(loaded.source, 'bundled')
      assert.ok(loaded.content.length > 100)
    }

    assert.equal(await provider.get({ name: 'non-existent-skill' }), undefined)
  })

  it('falls back to skills.register for minimal test registries', () => {
    /** @type {any[]} */
    const registered = []
    registerProductsSkills({
      get(name) {
        if (name !== 'skills') return undefined
        return {
          register(entry) {
            registered.push(entry)
          },
        }
      },
    })
    assert.deepEqual(
      registered.map((entry) => entry.name),
      [PRODUCTS_BRAND_STRATEGY_SKILL, PRODUCTS_PHYSICAL_IMPORT_SKILL],
    )
  })

  it('wires bundled skill provider registration inside plugin apply(ctx)', async () => {
    /** @type {Array<() => any>} */
    const factories = []
    const ctx = {
      tools: { register() {} },
      systemPrompt: { section() {} },
      inject(deps, fn) {
        if (deps.includes('skills')) {
          fn({
            skills: {
              registerProvider(factory) {
                factories.push(factory)
              },
            },
          })
        }
      },
    }

    apply(ctx)
    assert.equal(factories.length, 1)
    const candidates = await factories[0]().list()
    assert.deepEqual(
      candidates.map((c) => c.name),
      [PRODUCTS_BRAND_STRATEGY_SKILL, PRODUCTS_PHYSICAL_IMPORT_SKILL],
    )
    assert.ok(candidates.every((c) => c.rank === 600))
  })
})
