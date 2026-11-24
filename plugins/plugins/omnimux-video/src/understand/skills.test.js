import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUNDLED_SKILL_RANK,
  loadBundledVideoSkills,
  registerVideoSkills,
  VIDEO_ANALYZE_SKILL,
  VIDEO_REVERSE_PROMPT_SKILL,
} from './skills.js'

function fakeSkillsRegistry() {
  const state = { provider: null, registered: [] }
  return {
    state,
    registerProvider(factory) {
      state.provider = factory()
    },
    register(entry) {
      state.registered.push(entry)
    },
  }
}

describe('bundled video skills', () => {
  it('loads both domain-prefixed skills from their SKILL.md source', () => {
    const skills = loadBundledVideoSkills()
    assert.deepEqual(skills.map((skill) => skill.name), [VIDEO_ANALYZE_SKILL, VIDEO_REVERSE_PROMPT_SKILL])
    for (const skill of skills) {
      assert.ok(skill.content.length > 500, `${skill.name} body must carry the full methodology`)
      assert.equal(skill.source, 'bundled')
      assert.equal(skill.resourceBase.kind, 'directory')
      assert.ok(skill.path.endsWith(`${skill.name}/SKILL.md`))
      assert.ok(skill.description.length > 10)
    }
    const analyze = skills.find((skill) => skill.name === VIDEO_ANALYZE_SKILL)
    const reverse = skills.find((skill) => skill.name === VIDEO_REVERSE_PROMPT_SKILL)
    assert.match(analyze.content, /JSON/)
    assert.match(analyze.content, /分镜/)
    assert.match(reverse.content, /禁止.*口播/)
    assert.match(reverse.content, /beats/)
  })

  it('registers through skills.registerProvider at rank 600 (user overrides win)', async () => {
    const registry = fakeSkillsRegistry()
    registerVideoSkills({ get: () => registry })

    assert.ok(registry.state.provider, 'a bundled SkillProvider must be registered')
    assert.equal(registry.state.provider.name, 'omnimux-video')
    const listed = await registry.state.provider.list()
    assert.deepEqual(listed.map((entry) => entry.name), [VIDEO_ANALYZE_SKILL, VIDEO_REVERSE_PROMPT_SKILL])
    assert.ok(listed.every((entry) => entry.rank === BUNDLED_SKILL_RANK))
    assert.equal(BUNDLED_SKILL_RANK, 600)

    const fetched = await registry.state.provider.get({ name: VIDEO_REVERSE_PROMPT_SKILL })
    assert.equal(fetched.name, VIDEO_REVERSE_PROMPT_SKILL)
    assert.match(fetched.content, /I2V/)
    assert.equal(await registry.state.provider.get({ name: 'unknown' }), undefined)
  })

  it('injects the skills service lazily like the other bundled plugin skills', () => {
    const registry = fakeSkillsRegistry()
    let injected = null
    registerVideoSkills({
      inject(names, callback) {
        injected = names
        callback({ skills: registry })
      },
    })
    assert.deepEqual(injected, ['skills'])
    assert.ok(registry.state.provider)
  })

  it('projects disable-model-invocation into a global 0-token invocation policy', async () => {
    const skills = loadBundledVideoSkills()
    assert.equal(skills.length, 2)
    for (const skill of skills) {
      assert.deepEqual(
        skill.invocation,
        { modelInvocable: false, userInvocable: true },
        `${skill.name} must stay out of the global model context and remain slash-invocable`,
      )
    }

    const registry = fakeSkillsRegistry()
    registerVideoSkills({ get: () => registry })
    const listed = await registry.state.provider.list()
    for (const entry of listed) {
      assert.deepEqual(entry.invocation, { modelInvocable: false, userInvocable: true })
    }
    const fetched = await registry.state.provider.get({ name: VIDEO_ANALYZE_SKILL })
    assert.deepEqual(fetched.invocation, { modelInvocable: false, userInvocable: true })
  })

  it('falls back to skills.register for minimal registries', () => {
    const registry = fakeSkillsRegistry()
    delete registry.registerProvider
    registerVideoSkills({ get: () => registry })
    assert.equal(registry.state.registered.length, 2)
    assert.deepEqual(registry.state.registered.map((entry) => entry.name), [VIDEO_ANALYZE_SKILL, VIDEO_REVERSE_PROMPT_SKILL])
  })
})
