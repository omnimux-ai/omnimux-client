import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  INSPIRATION_DECONSTRUCT_SKILL,
  INSPIRATION_TRANSLATE_SKILL,
  loadBundledInspirationSkills,
  registerInspirationSkills,
} from './inspiration-skills.js'
import {
  INSPIRATION_ANALYSIS_SCHEMA,
  INSPIRATION_TRANSLATION_SCHEMA,
  normalizeStructuredAnalysisResult,
} from './analysis-schema.js'

describe('bundled inspiration skills and schema normalization', () => {
  it('loads bundled SKILL.md files with valid frontmatter and non-empty body', () => {
    const skills = loadBundledInspirationSkills()
    assert.equal(skills.length, 2)
    assert.deepEqual(
      skills.map((s) => s.name).sort(),
      [INSPIRATION_DECONSTRUCT_SKILL, INSPIRATION_TRANSLATE_SKILL].sort(),
    )
    for (const skill of skills) {
      assert.equal(skill.source, 'bundled')
      assert.ok(skill.content.length > 50)
      assert.ok(skill.description.length > 5)
      assert.equal(skill.resourceBase.kind, 'directory')
    }
  })

  it('registers bundled skills via registerProvider at BUNDLED_SKILL_RANK (600) and supports register() fallback', async () => {
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
    registerInspirationSkills(providerCtx)
    assert.ok(provider, 'must register bundled SkillProvider when registerProvider is available')
    assert.equal(provider.name, 'omnimux-inspiration')
    const candidates = await provider.list({})
    assert.equal(candidates.length, 2)
    for (const candidate of candidates) {
      assert.equal(candidate.rank, 600, 'bundled plugin skills must use BUNDLED_SKILL_RANK 600')
      assert.equal(candidate.source, 'bundled')
      assert.deepEqual(candidate.invocation, { modelInvocable: false, userInvocable: true })
      const loaded = await provider.get(candidate, {})
      assert.ok(loaded?.content?.length > 50)
      assert.deepEqual(loaded?.invocation, { modelInvocable: false, userInvocable: true })
    }

    // Minimal fallback registry with register() only
    const registered = new Map()
    const fallbackCtx = {
      inject(deps, fn) {
        assert.deepEqual(deps, ['skills'])
        fn({
          skills: {
            register(entry) {
              registered.set(entry.name, entry)
              return () => registered.delete(entry.name)
            },
          },
        })
      },
    }
    registerInspirationSkills(fallbackCtx)
    assert.equal(registered.has(INSPIRATION_DECONSTRUCT_SKILL), true)
    assert.equal(registered.has(INSPIRATION_TRANSLATE_SKILL), true)
  })

  it('normalizes structured JSON Schema output into sections, shots, segments, and markdown without regexes', () => {
    assert.equal(INSPIRATION_ANALYSIS_SCHEMA.additionalProperties, false)
    assert.equal(INSPIRATION_TRANSLATION_SCHEMA.additionalProperties, false)
    const normalized = normalizeStructuredAnalysisResult({
      summary: '高对比度痛点开场带来强停留',
      content_type: 'video',
      hook_highlight: '前 2 秒直接展示失败案例',
      target_goal: '提升私信咨询率',
      narrative_strategy: '痛点 -> 反转 -> 步骤拆解',
      visual_breakdown: '紧凑近景切换配合字幕重点色',
      replication_action: '保留前 2 秒反差结构，替换为自身品类实测',
      sections: [
        { id: 's1', direction: 'expression', title: '表达钩子', quote: '别再这么做了', analysis: '否定式开场激发纠错欲' },
      ],
      shots: [
        { id: 'shot_1', time_range: '00:00 - 00:03', stage: 'Hook', title: '反差特写', description: '手持特写镜头', script: '别再这么做了', prompt: 'closeup' },
      ],
    }, { scope: 'post', directions: ['expression'] })

    assert.equal(normalized.schema_version, 2)
    assert.equal(normalized.content_type, 'video')
    assert.equal(normalized.sections.length, 1)
    assert.equal(normalized.sections[0].quote, '别再这么做了')
    assert.equal(normalized.shots.length, 1)
    assert.equal(normalized.shots[0].start_seconds, 0)
    assert.equal(normalized.shots[0].end_seconds, 3)
    assert.equal(normalized.segments.length, 1)
    assert.equal(normalized.segments[0].text, '别再这么做了')
    assert.equal(normalized.structure.length, 5)
    assert.match(normalized.markdown, /高对比度痛点开场/)
  })
})
