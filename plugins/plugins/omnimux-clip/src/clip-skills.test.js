import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUNDLED_SKILL_RANK,
  CLIP_CRAFT_SKILL,
  PROVIDER_NAME,
  loadBundledClipSkills,
  registerClipSkills,
} from './clip-skills.js'

describe('bundled clip skills native provider (#236)', () => {
  it('loads clip-craft SKILL.md as core global model-invocable skill', () => {
    const skills = loadBundledClipSkills()
    assert.equal(skills.length, 1)
    const [skill] = skills
    assert.equal(skill.name, CLIP_CRAFT_SKILL)
    assert.equal(skill.source, 'bundled')
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(skill.resourceBase.kind, 'directory')
    assert.ok(skill.content.length > 100)
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
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].name, CLIP_CRAFT_SKILL)
    assert.equal(candidates[0].rank, BUNDLED_SKILL_RANK)
    assert.equal(candidates[0].source, 'bundled')
    assert.deepEqual(candidates[0].invocation, { modelInvocable: true, userInvocable: true })
    const def = await provider.get(candidates[0], {})
    assert.equal(def?.name, CLIP_CRAFT_SKILL)
    assert.deepEqual(def?.invocation, { modelInvocable: true, userInvocable: true })
    assert.ok((def?.content?.length ?? 0) > 100)

    const registered = new Map()
    registerClipSkills({
      inject(deps, fn) {
        assert.deepEqual(deps, ['skills'])
        fn({ skills: { register(entry) { registered.set(entry.name, entry) } } })
      },
    })
    assert.equal(registered.has(CLIP_CRAFT_SKILL), true)
  })
})
