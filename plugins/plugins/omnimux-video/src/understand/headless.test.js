import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseVideoConfig } from '../config.js'
import { executeVideoAnalyze } from './analyze.js'
import { executeVideoReversePrompt } from './reverse.js'
import { VIDEO_ANALYZE_SCHEMA, VIDEO_REVERSE_PROMPT_SCHEMA } from './schemas.js'
import { VIDEO_ANALYZE_SKILL, VIDEO_REVERSE_PROMPT_SKILL } from './skills.js'

const UNDERSTAND = { ...parseVideoConfig(undefined).understand }

function tinyMp4(dir) {
  const dest = join(dir, 'clip.mp4')
  writeFileSync(dest, Buffer.from('ftypisomfake-mp4-bytes'))
  return dest
}

const ANALYZE_DATA = {
  summary: '摘要 A',
  goal: { primary_goal: '转化', core_style: 'UGC', emotional_tone: '松弛', evidence: '开场', virality_factors: ['钩子'] },
  hook: { time_range: '0-2s', means: '结果前置', evidence: '成品特写' },
  impact: { explicit_selling_points: ['省时'], implicit_value: {} },
  narrative: { vehicle: '演示', persona: '达人', performance_style: '自然', vocal_dna: {}, structure: { hook: '钩子', body: '展示', cta: '引导' } },
  visual: { environment: '室内', cinematography: '中近景', character_sheet: '成年达人' },
  replication: { formula: '钩子+演示', soul: ['真实'], shell: [] },
  shots: [{ index: 1, time_range: '0-2s', start_seconds: 0, end_seconds: 2, description: '手持展示' }],
}

const REVERSE_DATA = {
  prompt: '以参考图锁定外观，生成5秒9:16；人物全程禁止口播对白。',
  appendix: '节拍表 1',
  beats: [{ index: 1, start_seconds: 0, end_seconds: 2.5, performance: '静持', emotion: '冷静', camera: '固定中近景' }],
}

describe('headlessSkill request contract', () => {
  it('video_analyze sends the bundled skill, strict schema and ordered video reference', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-h-'))
    const video = tinyMp4(dir)
    const seen = []
    try {
      await executeVideoAnalyze({
        video,
        understand: UNDERSTAND,
        model: 'gemini-3.8-flash',
        maxTokens: 2048,
        targetId: 'asset:42',
        headlessSkill: {
          async run(request) {
            seen.push(request)
            return { mode: 'live', model: 'gemini-3.8-flash', data: ANALYZE_DATA }
          },
        },
      })
      const request = seen[0]
      assert.equal(request.skillName, VIDEO_ANALYZE_SKILL)
      assert.equal(request.skillName, 'video-analyze')
      assert.equal(request.outputSchema, VIDEO_ANALYZE_SCHEMA)
      assert.deepEqual(request.references, [{ type: 'video', pathOrUrl: video }])
      assert.equal(request.modality, 'video')
      assert.equal(request.ownerPlugin, 'omnimux-video')
      assert.equal(request.targetId, 'asset:42')
      assert.equal(request.model, 'gemini-3.8-flash')
      assert.equal(request.maxTokens, 2048)
      assert.match(request.label, /五维拆解/)
      assert.doesNotMatch(request.input, /<<<PROMPT>>>/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('video_reverse_prompt sends its own skill, schema and identity mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-h2-'))
    const video = tinyMp4(dir)
    const seen = []
    try {
      await executeVideoReversePrompt({
        video,
        identityMode: 'B',
        duration: 6,
        aspect: '9:16',
        understand: UNDERSTAND,
        headlessSkill: {
          async run(request) {
            seen.push(request)
            return { mode: 'live', data: REVERSE_DATA }
          },
        },
      })
      const request = seen[0]
      assert.equal(request.skillName, VIDEO_REVERSE_PROMPT_SKILL)
      assert.equal(request.skillName, 'video-reverse-prompt')
      assert.equal(request.outputSchema, VIDEO_REVERSE_PROMPT_SCHEMA)
      assert.equal(request.modality, 'video')
      assert.match(request.input, /identity_mode: describe_anonymous/)
      assert.match(request.input, /target_duration_sec: 6/)
      assert.match(request.input, /aspect_ratio: 9:16/)
      assert.match(request.input, /JSON/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('projects validated JSON into the legacy dest files, never the raw model text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-h3-'))
    const video = tinyMp4(dir)
    const analyzeDest = join(dir, 'analyze.md')
    const promptDest = join(dir, 'prompt.txt')
    const appendixDest = join(dir, 'appendix.txt')
    try {
      await executeVideoAnalyze({
        video,
        dest: analyzeDest,
        understand: UNDERSTAND,
        headlessSkill: { async run() { return { mode: 'live', data: ANALYZE_DATA } } },
      })
      await executeVideoReversePrompt({
        video,
        dest: promptDest,
        appendixDest,
        understand: UNDERSTAND,
        headlessSkill: { async run() { return { mode: 'live', data: REVERSE_DATA } } },
      })
      const markdown = readFileSync(analyzeDest, 'utf8')
      assert.match(markdown, /摘要 A/)
      assert.match(markdown, /\| 0-2s \|/)
      assert.equal(readFileSync(promptDest, 'utf8'), REVERSE_DATA.prompt)
      assert.equal(readFileSync(appendixDest, 'utf8'), REVERSE_DATA.appendix)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('structured schemas are strict contracts', () => {
  it('video-analyze requires the five dimensions plus the shot array and forbids extra fields', () => {
    assert.equal(VIDEO_ANALYZE_SCHEMA.type, 'object')
    assert.equal(VIDEO_ANALYZE_SCHEMA.additionalProperties, false)
    for (const key of ['summary', 'goal', 'hook', 'impact', 'narrative', 'visual', 'replication', 'shots']) {
      assert.ok(VIDEO_ANALYZE_SCHEMA.required.includes(key), `analyze schema must require ${key}`)
      assert.ok(VIDEO_ANALYZE_SCHEMA.properties[key], `analyze schema must describe ${key}`)
    }
    const shots = VIDEO_ANALYZE_SCHEMA.properties.shots
    assert.equal(shots.type, 'array')
    assert.ok(shots.items.required.includes('time_range'))
    assert.ok(shots.items.required.includes('description'))
  })

  it('video-reverse-prompt requires prompt + beats and constrains identity modes', () => {
    assert.equal(VIDEO_REVERSE_PROMPT_SCHEMA.type, 'object')
    assert.equal(VIDEO_REVERSE_PROMPT_SCHEMA.additionalProperties, false)
    assert.deepEqual(VIDEO_REVERSE_PROMPT_SCHEMA.required, ['prompt', 'beats'])
    assert.deepEqual(VIDEO_REVERSE_PROMPT_SCHEMA.properties.identity_mode.enum, [
      'character_lock_upload_image',
      'describe_anonymous',
      'structure_only',
    ])
    const beats = VIDEO_REVERSE_PROMPT_SCHEMA.properties.beats
    assert.equal(beats.type, 'array')
    for (const key of ['start_seconds', 'end_seconds', 'performance', 'camera']) {
      assert.ok(beats.items.required.includes(key), `beat must require ${key}`)
    }
  })
})
