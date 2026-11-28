import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUNDLED_SKILL_RANK,
  CLIP_CRAFT_SKILL,
  CLIP_RECREATE_SKILL,
  PROVIDER_NAME,
  loadBundledClipSkills,
  registerClipSkills,
} from './clip-skills.js'

describe('bundled clip skills native provider (#236)', () => {
  it('loads clip-craft SKILL.md as core global model-invocable skill', () => {
    const skills = loadBundledClipSkills()
    assert.equal(skills.length, 2)
    assert.deepEqual(skills.map((s) => s.name), [CLIP_CRAFT_SKILL, CLIP_RECREATE_SKILL])
    const craft = skills.find((s) => s.name === CLIP_CRAFT_SKILL)
    const recreate = skills.find((s) => s.name === CLIP_RECREATE_SKILL)
    assert.ok(craft)
    assert.equal(craft.source, 'bundled')
    assert.deepEqual(craft.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(craft.resourceBase.kind, 'directory')
    assert.ok(craft.content.length > 100)
    assert.ok(recreate)
    assert.equal(recreate.source, 'bundled')
    assert.deepEqual(recreate.invocation, { modelInvocable: false, userInvocable: true })
    assert.equal(recreate.resourceBase.kind, 'directory')
    assert.ok(recreate.content.length > 100)
  })

  it('registers via ctx.skills.registerProvider at BUNDLED_SKILL_RANK (600) and supports register() fallback', async () => {
    let provider = null
    const providerCtx = {
      inject(deps, fn) {
        assert.deepEqual(deps, ['skills'])
        fn({
          skills: {
            registerProvider(factory) {
              provider = factory()
              return () => { provider = null }
            },
          },
        })
      },
    }
    registerClipSkills(providerCtx)
    assert.ok(provider)
    assert.equal(provider.name, PROVIDER_NAME)
    const candidates = await provider.list({})
    assert.equal(candidates.length, 2)
    assert.deepEqual(candidates.map((c) => c.name), [CLIP_CRAFT_SKILL, CLIP_RECREATE_SKILL])
    const craftCandidate = candidates.find((c) => c.name === CLIP_CRAFT_SKILL)
    const recreateCandidate = candidates.find((c) => c.name === CLIP_RECREATE_SKILL)
    assert.ok(craftCandidate)
    assert.equal(craftCandidate.rank, BUNDLED_SKILL_RANK)
    assert.equal(craftCandidate.source, 'bundled')
    assert.deepEqual(craftCandidate.invocation, { modelInvocable: true, userInvocable: true })
    const craftDef = await provider.get(craftCandidate, {})
    assert.equal(craftDef?.name, CLIP_CRAFT_SKILL)
    assert.deepEqual(craftDef?.invocation, { modelInvocable: true, userInvocable: true })
    assert.ok((craftDef?.content?.length ?? 0) > 100)

    assert.ok(recreateCandidate)
    assert.equal(recreateCandidate.rank, BUNDLED_SKILL_RANK)
    assert.equal(recreateCandidate.source, 'bundled')
    assert.deepEqual(recreateCandidate.invocation, { modelInvocable: false, userInvocable: true })
    const recreateDef = await provider.get(recreateCandidate, {})
    assert.equal(recreateDef?.name, CLIP_RECREATE_SKILL)
    assert.deepEqual(recreateDef?.invocation, { modelInvocable: false, userInvocable: true })
    assert.ok((recreateDef?.content?.length ?? 0) > 100)

    const registered = new Map()
    registerClipSkills({
      inject(deps, fn) {
        assert.deepEqual(deps, ['skills'])
        fn({ skills: { register(entry) { registered.set(entry.name, entry) } } })
      },
    })
    assert.equal(registered.has(CLIP_CRAFT_SKILL), true)
    assert.equal(registered.has(CLIP_RECREATE_SKILL), true)
  })
})
