import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUNDLED_SKILL_RANK,
  PROVIDER_NAME,
  TIKTOK_SELECTION_RISK_AUDIT_SKILL,
  TIKTOK_SELECTION_VIDEO_SCRIPT_SKILL,
  loadBundledSelectionSkills,
  registerSelectionSkills,
} from './selection-skills.js'

describe('bundled tiktok selection skills native provider (#236)', () => {
  it('loads both headless skills with disable-model-invocation: true (0-token global policy)', () => {
    const skills = loadBundledSelectionSkills()
    assert.equal(skills.length, 2)
    assert.deepEqual(
      skills.map((s) => s.name).sort(),
      [TIKTOK_SELECTION_RISK_AUDIT_SKILL, TIKTOK_SELECTION_VIDEO_SCRIPT_SKILL].sort(),
    )
    for (const skill of skills) {
      assert.equal(skill.source, 'bundled')
      assert.deepEqual(skill.invocation, { modelInvocable: false, userInvocable: true })
      assert.equal(skill.resourceBase.kind, 'directory')
      assert.ok(skill.content.length > 80)
    }
  })

  it('registers via ctx.skills.registerProvider at BUNDLED_SKILL_RANK (600) so headlessSkill resolves cleanly', async () => {
    let provider = null
    registerSelectionSkills({
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
    })
    assert.ok(provider)
    assert.equal(provider.name, PROVIDER_NAME)
    const candidates = await provider.list({})
    assert.equal(candidates.length, 2)
    for (const candidate of candidates) {
      assert.equal(candidate.rank, BUNDLED_SKILL_RANK)
      assert.equal(candidate.source, 'bundled')
      assert.deepEqual(candidate.invocation, { modelInvocable: false, userInvocable: true })
      const def = await provider.get(candidate, {})
      assert.equal(def?.name, candidate.name)
      assert.deepEqual(def?.invocation, { modelInvocable: false, userInvocable: true })
      assert.ok((def?.content?.length ?? 0) > 80)
    }
  })
})
