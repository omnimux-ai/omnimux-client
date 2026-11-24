import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { apply } from '../index.js'
import { parseVideoConfig } from '../config.js'
import { VideoError } from '../errors.js'
import { executeVideoAnalyze } from './analyze.js'
import { assertLocalVideo } from './pack-video.js'
import { executeVideoReversePrompt, resolveIdentityMode } from './reverse.js'
import { renderAnalyzeMarkdown } from './schemas.js'

const UNDERSTAND = { ...parseVideoConfig(undefined).understand, defaultModel: 'gemini-3.8-flash' }

function tinyMp4(dir) {
  const dest = join(dir, 'clip.mp4')
  writeFileSync(dest, Buffer.from('ftypisomfake-mp4-bytes'))
  return dest
}

const ANALYZE_DATA = {
  summary: '红底短片讲产品卖点',
  goal: { primary_goal: '转化', core_style: 'UGC', emotional_tone: '松弛', evidence: '开场手持', virality_factors: ['强钩子'] },
  hook: { time_range: '0-2s', means: '直接展示结果', evidence: '画面出现成品', script: '看这个' },
  impact: { explicit_selling_points: ['省时'], implicit_value: { identity: '专业感' } },
  narrative: { vehicle: '演示', persona: '达人', performance_style: '自然', vocal_dna: {}, structure: { hook: '钩子', body: '展示', cta: '引导' } },
  visual: { environment: '室内', cinematography: '中近景', character_sheet: '成年达人' },
  replication: { formula: '钩子 + 演示', soul: ['真实感'], shell: [{ variable: '{Product}', meaning: '商品' }] },
  shots: [
    { index: 1, time_range: '0-2s', start_seconds: 0, end_seconds: 2, shot_type: '中近景', description: '手持展示', action: '举起产品', script: '看这个', prompt: 'adult creator, indoor, soft light, 9:16' },
  ],
}

const REVERSE_DATA = {
  prompt: '以参考图像锁定外观，生成5秒9:16；人物全程不说话、禁止口播对白。',
  appendix: '1) 节拍表',
  beats: [
    { index: 1, start_seconds: 0, end_seconds: 2.5, performance: '静持对镜头', emotion: '冷静', camera: '固定中近景' },
  ],
  counts: { main_shots: 1, hard_cuts: 0 },
}

function fakeHeadless(run) {
  return { run }
}

describe('understand pack + seams', () => {
  it('rejects relative video paths', async () => {
    await assert.rejects(
      () => assertLocalVideo('rel/clip.mp4'),
      (error) => error instanceof VideoError && error.code === 'video-invalid-input',
    )
  })

  it('accepts an absolute mp4 and leaves transport sizing to Hub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-u-'))
    try {
      const path = tinyMp4(dir)
      const packed = await assertLocalVideo(path)
      assert.equal(packed.kind, 'path')
      assert.equal(packed.video, path)
      assert.equal(packed.bytes, Buffer.byteLength('ftypisomfake-mp4-bytes'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects https URLs instead of downloading them locally', async () => {
    await assert.rejects(
      () => assertLocalVideo('https://example.com/a.mp4'),
      (error) => error instanceof VideoError && error.code === 'video-invalid-input',
    )
  })
})

describe('video_analyze', () => {
  it('routes through headlessSkill and writes the legacy markdown dest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-a-'))
    const video = tinyMp4(dir)
    const dest = join(dir, 'out.md')
    const seen = []
    try {
      const result = await executeVideoAnalyze({
        video,
        dest,
        understand: UNDERSTAND,
        headlessSkill: fakeHeadless(async (request) => {
          seen.push(request)
          return { mode: 'live', model: 'gemini-3.8-flash', jobId: 'job-1', repaired: false, data: ANALYZE_DATA }
        }),
      })
      assert.equal(result.kind, 'analyze')
      assert.equal(result.dest, dest)
      assert.equal(result.data, ANALYZE_DATA)
      assert.equal(result.jobId, 'job-1')
      assert.match(result.text, /一句话视频描述/)
      assert.match(result.text, /核心目标/)
      assert.match(result.text, /逐帧拆解/)
      assert.match(readFileSync(dest, 'utf8'), /核心目标/)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].references[0].pathOrUrl, video)
      assert.equal(seen[0].model, 'gemini-3.8-flash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps a missing headlessSkill seam to needs-provider', async () => {
    await assert.rejects(
      () => executeVideoAnalyze({ video: '/tmp/x.mp4', understand: UNDERSTAND }),
      (error) => error instanceof VideoError && error.code === 'needs-provider',
    )
  })

  it('maps hub video-unsupported to video-understand-unsupported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-a2-'))
    try {
      const video = tinyMp4(dir)
      await assert.rejects(
        () => executeVideoAnalyze({
          video,
          understand: UNDERSTAND,
          headlessSkill: fakeHeadless(async () => {
            const err = new Error("model 'grok-4.6' does not accept video input")
            err.code = 'omnimux-invalid-request'
            throw err
          }),
        }),
        (error) => error instanceof VideoError && error.code === 'video-understand-unsupported',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a live result without structured data instead of faking markdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-a3-'))
    try {
      const video = tinyMp4(dir)
      await assert.rejects(
        () => executeVideoAnalyze({
          video,
          understand: UNDERSTAND,
          headlessSkill: fakeHeadless(async () => ({ mode: 'live', text: 'legacy markdown only' })),
        }),
        (error) => error instanceof VideoError && error.code === 'video-analyze-failed',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('video_reverse_prompt', () => {
  it('resolves identity modes A/B/C', () => {
    assert.equal(resolveIdentityMode('A'), 'character_lock_upload_image')
    assert.equal(resolveIdentityMode('B'), 'describe_anonymous')
    assert.equal(resolveIdentityMode('C'), 'structure_only')
  })

  it('routes through headlessSkill and writes prompt plus appendix dests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-r-'))
    const video = tinyMp4(dir)
    const dest = join(dir, 'prompt.txt')
    const appendixDest = join(dir, 'appendix.txt')
    try {
      const result = await executeVideoReversePrompt({
        video,
        dest,
        appendixDest,
        identityMode: 'A',
        understand: UNDERSTAND,
        headlessSkill: fakeHeadless(async () => ({
          mode: 'live',
          model: 'gemini-3.8-flash',
          jobId: 'job-2',
          data: REVERSE_DATA,
        })),
      })
      assert.equal(result.parsed, true)
      assert.equal(result.identityMode, 'character_lock_upload_image')
      assert.match(result.prompt, /禁止口播对白/)
      assert.equal(result.jobId, 'job-2')
      assert.match(readFileSync(dest, 'utf8'), /禁止口播对白/)
      assert.match(readFileSync(appendixDest, 'utf8'), /节拍表/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('surfaces an upstream schema failure instead of swallowing it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-r2-'))
    try {
      const video = tinyMp4(dir)
      await assert.rejects(
        () => executeVideoReversePrompt({
          video,
          understand: UNDERSTAND,
          headlessSkill: fakeHeadless(async () => {
            const err = new Error('schema invalid after repair')
            err.code = 'headless-skill-schema-invalid'
            throw err
          }),
        }),
        (error) => error instanceof VideoError && error.code === 'headless-skill-schema-invalid',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tool registration', () => {
  it('registers process + understand + depth tools and drops retired prompt overrides', () => {
    const tools = {}
    apply({
      tools: { register(tool) { tools[tool.name] = tool } },
      provide() {},
      get() { return undefined },
    })
    assert.ok(tools.video_process)
    assert.ok(tools.video_analyze)
    assert.ok(tools.video_reverse_prompt)
    assert.ok(tools.video_depth)
    assert.equal(tools.video_process.parameters.properties.capability.enum.includes('video_analyze'), false)
    assert.ok(tools.video_process.parameters.properties.capability.enum.includes('video_depth'))
    assert.ok(tools.video_reverse_prompt.parameters.properties.identity_mode.enum.includes('A'))
    assert.equal(tools.video_analyze.parameters.properties.prompt_path, undefined)
    assert.equal(tools.video_reverse_prompt.parameters.properties.prompt_path, undefined)
  })

  it('declares tools injection (not textComplete) and executes through ctx.get("headlessSkill")', async () => {
    const { inject } = await import('../index.js')
    assert.ok(Array.isArray(inject))
    assert.ok(inject.includes('tools'))
    assert.equal(inject.includes('textComplete'), false, 'understanding now runs through headlessSkill')

    let calledWith = null
    const headlessSkill = {
      async run(request) {
        calledWith = request
        return { mode: 'live', model: request.model, data: ANALYZE_DATA }
      },
    }

    const tools = {}
    const { apply } = await import('../index.js')
    apply({
      tools: { register(tool) { tools[tool.name] = tool } },
      provide() {},
      get(name) { return name === 'headlessSkill' ? headlessSkill : undefined },
    })

    assert.ok(tools.video_analyze)
    const result = await tools.video_analyze.execute({
      video: 'data:video/mp4;base64,AAAAHGZ0eXBpc29t',
      model: 'gemini-3.8-flash',
    })
    assert.equal(result.kind, 'analyze')
    assert.equal(result.data, ANALYZE_DATA)
    assert.equal(calledWith.model, 'gemini-3.8-flash')
    assert.equal(calledWith.skillName, 'video-analyze')
  })
})

/**
 * A Cordis-like context: reading any service that is neither provided nor listed
 * in `inject` throws, exactly like `@deepseek-ai/cordis`. This is the shape that
 * turns `ctx.headlessSkill ?? ctx.get('headlessSkill')` into a hard crash, since
 * the `??` right-hand side is unreachable once the left side throws.
 */
function guardedCordisContext({ seats = {}, tools = {} } = {}) {
  const known = new Set(['tools', 'provide', 'inject', 'effect', 'on', 'get', 'logger'])
  const target = {
    tools,
    provide() {},
    inject() {},
    effect() {},
    on() {},
    get(name) {
      return seats[name]
    },
  }
  return new Proxy(target, {
    get(object, prop) {
      if (typeof prop === 'symbol' || known.has(prop)) return Reflect.get(object, prop)
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

describe('host seat resolution under Cordis inject guards', () => {
  const VIDEO = 'data:video/mp4;base64,AAAAHGZ0eXBpc29t'

  it('routes both tools through the headlessSkill seat on a guarded context', async () => {
    const registered = {}
    const calls = []
    const headlessSkill = {
      async run(request) {
        calls.push(request)
        return {
          mode: 'live',
          model: request.model,
          data: request.skillName === 'video-analyze' ? ANALYZE_DATA : REVERSE_DATA,
        }
      },
    }
    apply(guardedCordisContext({
      seats: { headlessSkill },
      tools: { register(tool) { registered[tool.name] = tool } },
    }))

    const analyzed = await registered.video_analyze.execute({ video: VIDEO })
    assert.equal(analyzed.kind, 'analyze')
    assert.equal(analyzed.data, ANALYZE_DATA)

    const reversed = await registered.video_reverse_prompt.execute({ video: VIDEO })
    assert.equal(reversed.kind, 'reverse_prompt')
    assert.equal(reversed.data, REVERSE_DATA)

    assert.deepEqual(calls.map((call) => call.skillName), ['video-analyze', 'video-reverse-prompt'])
  })

  it('reports needs-provider instead of leaking the cordis without-inject error', async () => {
    const registered = {}
    apply(guardedCordisContext({ tools: { register(tool) { registered[tool.name] = tool } } }))

    for (const name of ['video_analyze', 'video_reverse_prompt']) {
      await assert.rejects(
        () => registered[name].execute({ video: VIDEO }),
        (error) => error instanceof VideoError && error.code === 'needs-provider',
        `${name} must map a missing headlessSkill seat to needs-provider`,
      )
    }
  })
})

describe('renderAnalyzeMarkdown hook projection', () => {
  it('keeps data.hook readable by the legacy breakdown parser', () => {
    const markdown = renderAnalyzeMarkdown(ANALYZE_DATA)
    assert.match(markdown, /## ⚡ 黄金 3 秒 HOOK/)
    assert.match(markdown, /\[0-3秒\] 黄金钩子 \(Hook\)/)
    assert.match(markdown, /- \*\*钩子手段\*\*: 直接展示结果/)
    assert.match(markdown, /- \*\*证据点\*\*: 画面出现成品/)
    assert.match(markdown, /- \*\*口播脚本\*\*: 看这个/)

    // Same alternatives as the legacy parser in the inspiration plugin; inlined
    // so this unit never imports another plugin's internals.
    const match = markdown.match(/\*?\*?\[0-3秒\]\s*黄金钩子[^\n]*\n+([\s\S]*?)(?=\n\s*\*?\*?\[中段\]|\n##|$)/i)
      || markdown.match(/##\s*III\.\s*叙事分析[\s\S]*?(?:Hook|黄金钩子)[^\n]*\n+([\s\S]*?)(?=\n###|\n##|$)/i)
      || markdown.match(/⚡\s*黄金\s*3\s*秒\s*HOOK[^\n]*\n+([\s\S]*?)(?=\n##|$)/i)
    assert.ok(match, 'legacy hook regex must match the projected report')
    assert.match(match[1], /直接展示结果/)
    assert.match(match[1], /画面出现成品/)
  })
})
