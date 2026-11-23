import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountHeadlessSkill } from './mount.js'
import { HEADLESS_SKILL_EVENT_TYPE } from './queue.js'
import { extractJsonPayload, validateAgainstSchema } from './schema.js'
import { INLINE_REQUEST_BYTES, prepareHeadlessTransport } from './transport.js'
import { OmnimuxError } from '../media/errors.js'

const BREAKDOWN_SCHEMA = {
  type: 'object',
  required: ['hook', 'structure', 'shots'],
  additionalProperties: false,
  properties: {
    hook: { type: 'string', minLength: 1 },
    structure: { type: 'string', minLength: 1 },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['time_range', 'title'],
        additionalProperties: false,
        properties: {
          time_range: { type: 'string' },
          title: { type: 'string' },
          start_seconds: { type: 'number', minimum: 0 },
        },
      },
    },
  },
}

function createMockEnv({ skills = {}, onExecute } = {}) {
  const provided = new Map()
  const events = []
  const disposers = []

  const skillsService = {
    async get(name) {
      return Object.hasOwn(skills, name) ? skills[name] : null
    },
  }
  const textComplete = {
    async execute(req) {
      return onExecute(req)
    },
  }
  const hubEvents = {
    emit(event) {
      events.push(event)
      return event
    },
  }

  const ctx = {
    provide(name, value) {
      provided.set(name, value)
    },
    get(name) {
      if (name === 'skills') return skillsService
      if (name === 'textComplete') return textComplete
      if (name === 'hubEvents') return hubEvents
      return provided.get(name)
    },
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') disposers.push(cleanup)
    },
  }

  return { ctx, provided, events, disposers }
}

describe('headless schema helpers', () => {
  it('extracts JSON from fenced code block and prose wrappers', () => {
    const fenced = extractJsonPayload('Here is the result:\n```json\n{"hook":"a","structure":"b","shots":[]}\n```')
    assert.equal(fenced.ok, true)
    assert.deepEqual(fenced.value, { hook: 'a', structure: 'b', shots: [] })

    const balanced = extractJsonPayload('Summary: {"hook":"h","structure":"s","shots":[]} done.')
    assert.equal(balanced.ok, true)
    assert.deepEqual(balanced.value, { hook: 'h', structure: 's', shots: [] })
  })

  it('reports exact schema path violations', () => {
    const errors = validateAgainstSchema(
      { hook: '', structure: 'ok', shots: [{ time_range: '00:00-00:03', title: 'open', start_seconds: -1 }], extra: 1 },
      BREAKDOWN_SCHEMA,
    )
    assert.ok(errors.some((e) => e.includes('$.hook')))
    assert.ok(errors.some((e) => e.includes('$.shots[0].start_seconds')))
    assert.ok(errors.some((e) => e.includes('$.extra')))
  })
})

describe('mountHeadlessSkill', () => {
  it('resolves Skill from ctx.skills, executes via textComplete, validates JSON Schema, and emits hubEvents', async () => {
    const seen = []
    const env = createMockEnv({
      skills: {
        'short-video-breakdown': { name: 'short-video-breakdown', content: 'You are a video breakdown specialist.' },
      },
      onExecute: async (req) => {
        seen.push(req)
        return {
          mode: 'live',
          model: 'gemini-2.5-pro',
          text: JSON.stringify({
            hook: 'Strong visual contrast in first 2s',
            structure: 'Hook -> Proof -> CTA',
            shots: [{ time_range: '00:00-00:03', title: 'Opening', start_seconds: 0 }],
          }),
        }
      },
    })

    const api = mountHeadlessSkill(env.ctx)
    assert.equal(env.provided.get('headlessSkill'), api)

    const result = await api.run({
      skillName: 'short-video-breakdown',
      input: 'Analyze this clip',
      references: [{ type: 'video', pathOrUrl: '/tmp/clip.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA,
      ownerPlugin: 'omnimux-inspiration',
      targetId: 'insp-42',
      inputFingerprint: 'fp-1',
    })

    assert.equal(result.mode, 'live')
    assert.equal(result.skillName, 'short-video-breakdown')
    assert.equal(result.model, 'gemini-2.5-pro')
    assert.equal(result.repaired, false)
    assert.equal(result.data.shots.length, 1)

    assert.equal(seen.length, 1)
    assert.equal(seen[0].system, 'You are a video breakdown specialist.')
    assert.equal(seen[0].references[0].type, 'video')

    const stages = env.events
      .filter((e) => e.type === HEADLESS_SKILL_EVENT_TYPE)
      .map((e) => e.payload.stage)
    assert.deepEqual(stages, ['queued', 'running', 'resolving-skill', 'executing', 'validating', 'done'])

    const snapshot = api.getJob(result.jobId)
    assert.equal(snapshot.status, 'done')
    assert.equal(snapshot.modality, 'video')
  })

  it('repairs invalid output once using a text-only retry without re-uploading video references', async () => {
    const calls = []
    const env = createMockEnv({
      skills: {
        'short-video-breakdown': { name: 'short-video-breakdown', content: 'Skill instructions' },
      },
      onExecute: async (req) => {
        calls.push(req)
        if (calls.length === 1) {
          return { mode: 'live', model: 'gemini-2.5-pro', text: '{"hook": "missing structure"}' }
        }
        return {
          mode: 'live',
          model: 'gemini-2.5-pro',
          text: '```json\n{"hook":"fixed hook","structure":"fixed structure","shots":[]}\n```',
        }
      },
    })

    const api = mountHeadlessSkill(env.ctx)
    const result = await api.run({
      skillName: 'short-video-breakdown',
      input: 'Analyze clip',
      references: [{ type: 'video', pathOrUrl: '/tmp/big.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA,
    })

    assert.equal(result.repaired, true)
    assert.equal(result.data.hook, 'fixed hook')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].references.length, 1)
    assert.equal(calls[1].references, undefined)
    assert.match(calls[1].prompt, /structure: required property is missing/)
  })

  it('fails loudly with headless-skill-schema-invalid when repair also fails', async () => {
    const env = createMockEnv({
      skills: { 'copy-skill': { name: 'copy-skill', content: 'Analyze copy' } },
      onExecute: async () => ({ mode: 'live', model: 'claude-sonnet', text: 'not json at all' }),
    })
    const api = mountHeadlessSkill(env.ctx)

    await assert.rejects(
      () => api.run({ skillName: 'copy-skill', input: 'hello', outputSchema: BREAKDOWN_SCHEMA }),
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-schema-invalid',
    )
  })

  it('fails loudly with headless-skill-not-found when skill is missing', async () => {
    const env = createMockEnv({ skills: {}, onExecute: async () => ({ mode: 'live', text: '{}' }) })
    const api = mountHeadlessSkill(env.ctx)

    await assert.rejects(
      () => api.run({ skillName: 'missing-skill', input: 'hello', outputSchema: BREAKDOWN_SCHEMA }),
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-not-found',
    )
  })

  it('rejects stale writeback when verifyFingerprint returns false', async () => {
    let currentFingerprint = 'fp-v1'
    const env = createMockEnv({
      skills: { 'copy-skill': { name: 'copy-skill', content: 'Analyze copy' } },
      onExecute: async () => {
        currentFingerprint = 'fp-v2'
        return {
          mode: 'live',
          model: 'claude-sonnet',
          text: JSON.stringify({ hook: 'h', structure: 's', shots: [] }),
        }
      },
    })
    const api = mountHeadlessSkill(env.ctx)

    await assert.rejects(
      () => api.run({
        skillName: 'copy-skill',
        input: 'hello',
        outputSchema: BREAKDOWN_SCHEMA,
        inputFingerprint: 'fp-v1',
        verifyFingerprint: () => currentFingerprint === 'fp-v1',
      }),
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-stale-input',
    )
  })

  it('enforces per-modality concurrency limits and deduplicates identical inflight requests', async () => {
    let activeVideos = 0
    let maxConcurrentVideos = 0
    let execCount = 0
    const gates = []

    const env = createMockEnv({
      skills: { 'video-skill': { name: 'video-skill', content: 'Analyze video' } },
      onExecute: async () => {
        execCount += 1
        activeVideos += 1
        maxConcurrentVideos = Math.max(maxConcurrentVideos, activeVideos)
        await new Promise((resolve) => gates.push(resolve))
        activeVideos -= 1
        return {
          mode: 'live',
          model: 'gemini-2.5-pro',
          text: JSON.stringify({ hook: 'h', structure: 's', shots: [] }),
        }
      },
    })

    const api = mountHeadlessSkill(env.ctx, { concurrency: { video: 2 } })
    const p1 = api.run({
      skillName: 'video-skill', input: 'v1', references: [{ type: 'video', pathOrUrl: '/a.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA, ownerPlugin: 'omnimux-inspiration', targetId: '1', inputFingerprint: 'f1',
    })
    const p1Dup = api.run({
      skillName: 'video-skill', input: 'v1', references: [{ type: 'video', pathOrUrl: '/a.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA, ownerPlugin: 'omnimux-inspiration', targetId: '1', inputFingerprint: 'f1',
    })
    const p2 = api.run({
      skillName: 'video-skill', input: 'v2', references: [{ type: 'video', pathOrUrl: '/b.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA, ownerPlugin: 'omnimux-inspiration', targetId: '2', inputFingerprint: 'f2',
    })
    const p3 = api.run({
      skillName: 'video-skill', input: 'v3', references: [{ type: 'video', pathOrUrl: '/c.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA, ownerPlugin: 'omnimux-inspiration', targetId: '3', inputFingerprint: 'f3',
    })

    await new Promise((r) => setTimeout(r, 20))
    assert.equal(activeVideos, 2)
    assert.equal(api.listJobs({ status: 'queued' }).length, 1)
    assert.equal(api.listJobs().length, 3)

    while (gates.length > 0 || activeVideos > 0) {
      const release = gates.shift()
      if (release) release()
      await new Promise((r) => setTimeout(r, 10))
    }

    const results = await Promise.all([p1, p1Dup, p2, p3])
    assert.equal(execCount, 3)
    assert.equal(maxConcurrentVideos, 2)
    assert.equal(results[0].jobId, results[1].jobId)
  })

  it('cancels queued jobs cleanly and rejects with headless-skill-cancelled', async () => {
    let releaseFirst
    const env = createMockEnv({
      skills: { 'video-skill': { name: 'video-skill', content: 'Analyze video' } },
      onExecute: async () => {
        await new Promise((resolve) => { releaseFirst = resolve })
        return {
          mode: 'live',
          model: 'gemini-2.5-pro',
          text: JSON.stringify({ hook: 'h', structure: 's', shots: [] }),
        }
      },
    })

    const api = mountHeadlessSkill(env.ctx, { concurrency: { video: 1 } })
    const p1 = api.run({
      skillName: 'video-skill', input: 'v1', references: [{ type: 'video', pathOrUrl: '/a.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA, ownerPlugin: 'omnimux-inspiration', targetId: '1',
    })
    const p2 = api.run({
      skillName: 'video-skill', input: 'v2', references: [{ type: 'video', pathOrUrl: '/b.mp4' }],
      outputSchema: BREAKDOWN_SCHEMA, ownerPlugin: 'omnimux-inspiration', targetId: '2',
    })

    await new Promise((r) => setTimeout(r, 15))
    const queued = api.listJobs({ status: 'queued' })
    assert.equal(queued.length, 1)
    assert.equal(api.cancel(queued[0].jobId, 'user cancelled'), true)

    await assert.rejects(
      () => p2,
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-cancelled',
    )
    releaseFirst()
    await p1
  })
})

describe('prepareHeadlessTransport and Hub video preparation', () => {
  const dirs = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempAsset(size, name = 'source.mp4') {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'headless-transport-')))
    dirs.push(dir)
    const file = join(dir, name)
    writeFileSync(file, 'original')
    truncateSync(file, size)
    return file
  }

  it('compresses a 98MB video via videoProcess, preserves timeline/audio, and cleans up after execution', async () => {
    const source = tempAsset(98_376_196)
    let preparedDest = ''
    let seenRef = ''
    let preparedExistedDuringExec = false

    const env = createMockEnv({
      skills: { 'video-skill': { name: 'video-skill', content: 'Analyze video' } },
      onExecute: async (req) => {
        seenRef = req.references?.[0]?.pathOrUrl || ''
        preparedExistedDuringExec = existsSync(seenRef)
        return {
          mode: 'live',
          model: 'gemini-2.5-pro',
          text: JSON.stringify({ hook: 'h', structure: 's', shots: [] }),
        }
      },
    })

    const api = mountHeadlessSkill(env.ctx, {
      videoProcess: {
        async execute(req) {
          assert.equal(req.capability, 'video_inline_analysis_prepare')
          assert.equal(req.input.videoUrl, source)
          assert.equal(req.input.preserveTimeline, true)
          assert.equal(req.input.keepAudio, true)
          assert.ok(req.input.maxRequestBytes < INLINE_REQUEST_BYTES)
          preparedDest = req.dest
          writeFileSync(preparedDest, 'prepared whole video')
          return { mode: 'live', files: [{ path: preparedDest, kind: 'video', meta: { preserveTimeline: true, keepAudio: true } }] }
        },
      },
    })

    const result = await api.run({
      skillName: 'video-skill',
      input: 'Analyze this large clip',
      references: [{ type: 'video', pathOrUrl: source }],
      outputSchema: BREAKDOWN_SCHEMA,
    })

    assert.equal(result.mode, 'live')
    assert.equal(seenRef, preparedDest)
    assert.equal(preparedExistedDuringExec, true)
    assert.equal(existsSync(preparedDest), false, 'temporary prepared file must be cleaned after execution')
    assert.equal(existsSync(source), true, 'original source must stay untouched')
    assert.ok(env.events.some((e) => e.payload?.stage === 'preparing-media'))
  })

  it('shares remaining inline budget across multiple oversized videos and rejects oversized images', async () => {
    const sources = [tempAsset(98_376_196, 'v1.mp4'), tempAsset(50_000_000, 'v2.mp4'), tempAsset(500, 'v3.mp4')]
    const calls = []
    const prepared = await prepareHeadlessTransport(
      { prompt: 'body', references: sources.map((pathOrUrl) => ({ type: 'video', pathOrUrl })) },
      {
        videoProcess: {
          async execute(req) {
            calls.push(req)
            writeFileSync(req.dest, 'compressed')
            truncateSync(req.dest, req.input.maxRequestBytes)
            return { mode: 'live', files: [{ path: req.dest, kind: 'video', meta: { preserveTimeline: true, keepAudio: true } }] }
          },
        },
      },
    )
    assert.equal(calls.length, 2)
    assert.equal(calls[0].input.maxRequestBytes, calls[1].input.maxRequestBytes)
    assert.deepEqual(prepared.references.map((r) => r.pathOrUrl), [calls[0].dest, calls[1].dest, sources[2]])
    await prepared.cleanup()
    assert.equal(existsSync(calls[0].dest), false)

    const bigPhoto = tempAsset(8 * 1024 * 1024, 'photo.jpg')
    await assert.rejects(
      () => prepareHeadlessTransport({ prompt: 'body', references: [{ type: 'image', pathOrUrl: bigPhoto }] }),
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-transport-exceeded',
    )
  })

  it('cleans up temporary files when videoProcess fails or omits required guarantees', async () => {
    const source = tempAsset(98_376_196)
    await assert.rejects(
      () => prepareHeadlessTransport({ prompt: 'body', references: [{ type: 'video', pathOrUrl: source }] }),
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-transport-unavailable',
    )

    let created = ''
    await assert.rejects(
      () => prepareHeadlessTransport(
        { prompt: 'body', references: [{ type: 'video', pathOrUrl: source }] },
        {
          videoProcess: {
            async execute(req) {
              created = req.dest
              writeFileSync(created, 'partial')
              return { mode: 'live', files: [{ path: created, kind: 'video', meta: { preserveTimeline: false, keepAudio: true } }] }
            },
          },
        },
      ),
      (err) => err instanceof OmnimuxError && err.code === 'headless-skill-transport-exceeded',
    )
    assert.equal(existsSync(created), false)
    assert.equal(existsSync(source), true)
  })
})
