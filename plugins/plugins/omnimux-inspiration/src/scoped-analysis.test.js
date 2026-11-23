import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLocalStore } from './local-store.js'
import { createLocalInspirationDispatcher } from './http-routes.js'
import { analysisInputFingerprint, sourceFingerprint } from './analysis-input.js'
import { analyzeInspirationVideo } from './analyzer.js'
import { handleGetItem } from './http-handlers.js'
import { INSPIRATION_DECONSTRUCT_SKILL, INSPIRATION_TRANSLATE_SKILL } from './inspiration-skills.js'
import { INSPIRATION_ANALYSIS_SCHEMA, INSPIRATION_TRANSLATION_SCHEMA } from './analysis-schema.js'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function defaultHeadlessResponse(req) {
  if (req.skillName === INSPIRATION_TRANSLATE_SKILL) {
    return {
      mode: 'live',
      jobId: 'job-translate-1',
      skillName: req.skillName,
      model: 'test-model',
      data: { text: 'Translated original body', segments: [] },
    }
  }
  return {
    mode: 'live',
    jobId: 'job-analyze-1',
    skillName: req.skillName,
    model: 'test-model',
    data: {
      summary: '来自实际输入的分析。',
      content_type: 'video',
      hook_highlight: '前三秒冲突开场',
      sections: [
        { id: 'sec_1', direction: 'expression', title: '表达方法', analysis: '结构紧凑，开场信息密度高。' },
      ],
      shots: [],
    },
  }
}

function world(runImpl = async (req) => defaultHeadlessResponse(req)) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'inspiration-scope-'))); dirs.push(dir)
  const paths = { dir, libraryFile: join(dir, 'library.json'), mediaDir: join(dir, 'media'), videosDir: join(dir, 'media/videos'), imagesDir: join(dir, 'media/images'), coversDir: join(dir, 'media/covers') }
  for (const root of [paths.videosDir, paths.imagesDir, paths.coversDir]) mkdirSync(root, { recursive: true })
  const video = join(paths.videosDir, 'first.mp4'); const second = join(paths.videosDir, 'second.mp4'); const image = join(paths.imagesDir, 'photo.jpg')
  for (const path of [video, second, image]) writeFileSync(path, 'saved asset')
  const store = createLocalStore({ paths })
  const row = store.add({ title: '短标题', content: '完整原始正文\n第二段，保留原文', type: 'video', source_url: 'https://x.com/creator/status/12345', local_paths: { video, video_2: second, image_1: image }, media_items: [
    { type: 'video', url: '/omnimux/inspiration/local/media/videos/first.mp4' },
    { type: 'image', url: '/omnimux/inspiration/local/media/images/photo.jpg' },
    { type: 'video', url: '/omnimux/inspiration/local/media/videos/second.mp4' },
  ] })
  const calls = []
  const cancelledJobIds = []
  const activeJobs = []
  const headlessSkill = {
    async run(req) {
      calls.push({ req })
      const job = { jobId: `job-${calls.length}`, ownerPlugin: req.ownerPlugin, targetId: req.targetId, status: 'running' }
      activeJobs.push(job)
      try {
        return await runImpl(req)
      } finally {
        job.status = 'done'
      }
    },
    listJobs(filter = {}) {
      return activeJobs.filter((job) => (
        (!filter.ownerPlugin || job.ownerPlugin === filter.ownerPlugin)
        && (!filter.targetId || job.targetId === filter.targetId)
      ))
    },
    cancel(jobId) {
      cancelledJobIds.push(jobId)
      return true
    },
  }
  const dispatcher = createLocalInspirationDispatcher({ localStore: store, headlessSkill })
  const send = (action, body, signal) => dispatcher.dispatch({ method: 'POST', url: `/omnimux/inspiration/local/${row.id}/${action}`, body, signal })
  return { paths, row, store, calls, cancelledJobIds, headlessSkill, send, video, second, image }
}

describe('scoped post analysis', () => {
  it('persists the real service failure and clears it after a successful retry', async () => {
    let ready = false
    const w = world(async (req) => {
      if (!ready) throw Object.assign(new Error('素材理解服务尚未确认，请选择分析服务'), { code: 'analysis-service-unconfigured' })
      return {
        mode: 'live',
        jobId: 'job-retry',
        skillName: req.skillName,
        model: 'fixture-model',
        data: { summary: '已恢复的分析。', sections: [], shots: [] },
      }
    })
    const failed = await w.send('analyze', { scope: 'post' })
    assert.equal(failed.status, 502)
    assert.equal(failed.body.error, '素材理解服务尚未确认，请选择分析服务')
    const stored = createLocalStore({ paths: w.paths }).get(w.row.id).analysis_results.post
    assert.equal(stored.error_code, 'analysis-service-unconfigured')
    assert.doesNotMatch(stored.error, /API Key/)
    ready = true
    const success = await w.send('analyze', { scope: 'post' })
    assert.equal(success.status, 200)
    assert.equal(success.body.data.analysis_results.post.error_code, null)
    assert.equal(success.body.data.analysis_results.post.error, null)
    assert.equal(success.body.data.analysis_results.post.result.summary, '已恢复的分析。')
  })

  it('sends complete ordered inputs and only selected directions, preserving real source and model', async () => {
    const w = world(); const selection = { scope: 'post', directions: ['expression', 'creative'] }
    const res = await w.send('analyze', selection)
    assert.equal(res.status, 200)
    assert.equal(w.calls[0].req.skillName, INSPIRATION_DECONSTRUCT_SKILL)
    assert.equal(w.calls[0].req.outputSchema, INSPIRATION_ANALYSIS_SCHEMA)
    assert.equal(w.calls[0].req.ownerPlugin, 'omnimux-inspiration')
    assert.equal(w.calls[0].req.targetId, `${w.row.id}:post`)
    assert.deepEqual(w.calls[0].req.references.map((ref) => ref.pathOrUrl), [w.video, w.image, w.second])
    assert.match(w.calls[0].req.input, /完整原始正文\n第二段/)
    assert.match(w.calls[0].req.input, /expression（表达方法）/)
    assert.doesNotMatch(w.calls[0].req.input, /content（内容理解）/)
    const entry = res.body.data.analysis_results.post
    assert.equal(entry.status, 'done'); assert.equal(entry.source, 'live'); assert.equal(entry.model, 'test-model')
    assert.equal(entry.result.schema_version, 2)
    assert.equal(entry.result.summary, '来自实际输入的分析。')
    assert.equal(entry.input_fingerprint, analysisInputFingerprint(w.row, selection))
    assert.equal(createLocalStore({ paths: w.paths }).get(w.row.id).analysis_results.post.input_fingerprint, entry.input_fingerprint)
  })

  it('isolates body, selected image and second video without accepting a supplied path', async () => {
    const w = world()
    for (const selection of [{ scope: 'body' }, { scope: 'media', media_index: 1, path: '/etc/passwd' }, { scope: 'media', media_index: 2 }]) assert.equal((await w.send('analyze', selection)).status, 200)
    assert.deepEqual(w.calls.map((call) => call.req.references.map((ref) => ref.pathOrUrl)), [[], [w.image], [w.second]])
    assert.deepEqual(Object.keys(w.store.get(w.row.id).analysis_results), ['body', 'media:1', 'media:2'])
    assert.equal(w.store.get(w.row.id).deconstruction, undefined)
  })

  it('analyzes a legacy photo saved as its owned local cover', async () => {
    const w = world()
    const cover = join(w.paths.coversDir, 'legacy-photo.jpg')
    writeFileSync(cover, 'saved photo')
    w.store.update(w.row.id, { type: 'image', media_items: [], media_urls: [], cover_url: '/omnimux/inspiration/local/media/covers/legacy-photo.jpg', local_paths: { cover } })
    const response = await w.send('analyze', { scope: 'media', media_index: 0 })
    assert.equal(response.status, 200)
    assert.deepEqual(w.calls[0].req.references, [{ type: 'image', pathOrUrl: cover }])
    assert.equal(response.body.data.analysis_results['media:0'].status, 'done')
  })

  it('refuses a video poster disguised as an attachment and an external legacy cover', async () => {
    const w = world()
    const cover = join(w.paths.coversDir, 'poster.jpg')
    writeFileSync(cover, 'poster')
    w.store.update(w.row.id, { type: 'video', media_items: [{ type: 'image', url: '/omnimux/inspiration/local/media/covers/poster.jpg' }], local_paths: { cover } })
    assert.equal((await w.send('analyze', { scope: 'media', media_index: 0 })).status, 422)
    rmSync(cover); symlinkSync('/etc/hosts', cover)
    w.store.update(w.row.id, { type: 'image', media_items: [], media_urls: [], cover_url: '/omnimux/inspiration/local/media/covers/poster.jpg', local_paths: { cover } })
    assert.equal((await w.send('analyze', { scope: 'media', media_index: 0 })).status, 422)
    assert.equal(w.calls.length, 0)
  })

  it('rejects invalid scope, directions and indices before calling the tool', async () => {
    const w = world()
    for (const selection of [{ scope: 'unknown' }, { scope: 'media', media_index: -1 }, { scope: 'media', media_index: 9 }, { scope: 'post', directions: [] }, { scope: 'body', directions: ['bad'] }]) assert.equal((await w.send('analyze', selection)).status, 400)
    assert.equal(w.calls.length, 0)
  })

  it('marks missing or external files partial instead of analyzing a subset', async () => {
    const w = world(); rmSync(w.image); symlinkSync('/etc/hosts', w.image)
    assert.equal((await w.send('analyze', { scope: 'post' })).status, 422)
    assert.equal(w.calls.length, 0); assert.equal(w.store.get(w.row.id).analysis_results.post.status, 'partial')
  })

  it('merges concurrent scopes and rejects duplicate in-flight requests', async () => {
    let release; const gate = new Promise((resolve) => { release = resolve })
    const w = world(async (req) => { await gate; return defaultHeadlessResponse(req) })
    const body = w.send('analyze', { scope: 'body' }); const media = w.send('analyze', { scope: 'media', media_index: 1 })
    assert.equal(w.store.get(w.row.id).analysis_results.body.status, 'running')
    assert.equal(handleGetItem({ id: w.row.id, store: w.store, headlessSkill: w.headlessSkill }).body.data.analysis_results.body.status, 'running', 'a live executor must survive status reads')
    assert.equal((await w.send('analyze', { scope: 'body' })).status, 409)
    release(); await Promise.all([body, media])
    const results = w.store.get(w.row.id).analysis_results
    assert.equal(results.body.status, 'done'); assert.equal(results['media:1'].status, 'done')
  })

  it('recovers interrupted persisted scopes on read while preserving completed results', async () => {
    const w = world()
    await w.send('analyze', { scope: 'body' })
    const completed = w.store.get(w.row.id).analysis_results.body
    w.store.updateAnalysis(w.row.id, 'post', { scope: 'post', status: 'running', result: null })
    w.store.updateAnalysis(w.row.id, 'media:1', { scope: 'media', media_index: 1, status: 'running', result: null })
    const row = handleGetItem({ id: w.row.id, store: w.store, headlessSkill: w.headlessSkill }).body.data
    assert.equal(row.analysis_results.post.status, 'failed')
    assert.match(row.analysis_results.post.error, /已中断/)
    assert.equal(row.analysis_results['media:1'].status, 'failed')
    assert.deepEqual(row.analysis_results.body, completed)
    assert.equal(createLocalStore({ paths: w.paths }).get(w.row.id).analysis_results.post.status, 'failed')
    assert.equal((await w.send('analyze', { scope: 'body' })).status, 200)
  })

  it('records errors, empty and non-live results without fabricated success', async () => {
    for (const runImpl of [async () => { throw new Error('provider unavailable') }, async () => ({ mode: 'live', data: null }), async () => ({ mode: 'mock', data: { summary: 'template', sections: [], shots: [] } })]) {
      const w = world(runImpl); assert.equal((await w.send('analyze', { scope: 'body' })).status, 502)
      const entry = w.store.get(w.row.id).analysis_results.body
      assert.equal(entry.status, 'failed'); assert.equal(entry.result, null); assert.equal(entry.source, 'legacy_unknown')
    }
  })

  it('preserves previous actual output on failed retry', async () => {
    let n = 0
    const w = world(async (req) => {
      if (++n > 1) throw new Error('temporarily unavailable')
      return {
        mode: 'live',
        jobId: 'job-prior',
        skillName: req.skillName,
        model: 'test-model',
        data: { summary: 'prior real result', sections: [], shots: [] },
      }
    })
    await w.send('analyze', { scope: 'body' }); await w.send('analyze', { scope: 'body' })
    const entry = w.store.get(w.row.id).analysis_results.body
    assert.equal(entry.status, 'failed')
    assert.equal(entry.result.summary, 'prior real result')
    assert.match(entry.result.markdown, /prior real result/)
  })

  it('rejects results for content edited during a request', async () => {
    const w = world(async (req) => {
      w.store.update(w.row.id, { content: 'changed' })
      return defaultHeadlessResponse(req)
    })
    const response = await w.send('analyze', { scope: 'body' })
    assert.equal(response.status, 409)
    assert.equal(response.body.data.analysis_results.body.status, 'partial')
    assert.equal(response.body.data.analysis_results.body.result, null)
  })

  it('propagates cancellation and saves retryable failure', async () => {
    const controller = new AbortController()
    const w = world(async (req) => {
      assert.ok(req.signal instanceof AbortSignal)
      controller.abort()
      assert.equal(req.signal.aborted, true)
      return defaultHeadlessResponse(req)
    })
    assert.equal((await w.send('analyze', { scope: 'body' }, controller.signal)).status, 499)
    const entry = w.store.get(w.row.id).analysis_results.body
    assert.equal(entry.status, 'failed'); assert.equal(entry.result, null); assert.match(entry.error, /取消/)
  })

  it('supports explicit POST /:id/analyze/cancel to abort an active headless run', async () => {
    let observedSignal = null
    const w = world(async (req) => {
      observedSignal = req.signal
      await new Promise((_resolve, reject) => {
        req.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'headless-skill-cancelled' })), { once: true })
      })
    })
    const running = w.send('analyze', { scope: 'post' })
    const cancelRes = await w.send('analyze/cancel', { scope: 'post' })
    assert.equal(cancelRes.status, 200)
    assert.equal(cancelRes.body.ok, true)
    assert.ok(cancelRes.body.cancelled.length > 0)
    assert.equal(observedSignal?.aborted, true)
    const finalRes = await running
    assert.equal(finalRes.status, 499)
    const entry = w.store.get(w.row.id).analysis_results.post
    assert.equal(entry.status, 'failed')
    assert.equal(entry.error_code, 'analysis-cancelled')
  })
})

describe('body translation and retained contracts', () => {
  it('translates raw body, preserves script translation/draft and marks legacy provenance', async () => {
    const w = world(async (req) => ({
      mode: 'live',
      jobId: 'job-tr',
      skillName: req.skillName,
      model: 'test',
      data: { text: 'Translated original body', segments: [] },
    }))
    w.store.update(w.row.id, { deconstruction: { segments: [{ text: '生成台词' }] }, script_translation: { text: 'old script translation' }, creation_draft: { text: 'user draft' } })
    const response = await w.send('translate', { scope: 'body', lang: 'en' })
    assert.equal(response.status, 200)
    assert.equal(w.calls[0].req.skillName, INSPIRATION_TRANSLATE_SKILL)
    assert.equal(w.calls[0].req.outputSchema, INSPIRATION_TRANSLATION_SCHEMA)
    assert.match(w.calls[0].req.input, /完整原始正文/)
    assert.doesNotMatch(w.calls[0].req.input, /生成台词/)
    assert.equal(response.body.data.body_translation.source_fingerprint, sourceFingerprint(w.row.content))
    assert.equal(response.body.data.script_translation.text, 'old script translation')
    const fresh = createLocalStore({ paths: w.paths }).get(w.row.id)
    await w.store.replace(w.row.id, { ...fresh, title: 'replacement' })
    assert.equal(w.store.get(w.row.id).creation_draft.text, 'user draft'); assert.equal(w.store.get(w.row.id).body_translation.text, 'Translated original body')
    assert.equal(w.store.get(w.row.id).deconstruction.source, 'legacy_unknown')
  })

  it('routes script translation through headlessSkill with segment IDs preserved', async () => {
    const w = world(async (req) => ({
      mode: 'live',
      jobId: 'job-script-tr',
      skillName: req.skillName,
      model: 'test-model',
      data: { text: 'Line 1\nLine 2', segments: [{ id: 'seg_1', text: 'Line 1' }, { id: 'seg_2', text: 'Line 2' }] },
    }))
    w.store.update(w.row.id, { deconstruction: { segments: [{ id: 'seg_1', text: '第一句' }, { id: 'seg_2', text: '第二句' }] } })
    const response = await w.send('translate', { lang: 'en' })
    assert.equal(response.status, 200)
    assert.equal(w.calls[0].req.skillName, INSPIRATION_TRANSLATE_SKILL)
    assert.match(w.calls[0].req.input, /seg_1/)
    assert.equal(response.body.data.script_translation.text, 'Line 1\nLine 2')
    assert.equal(response.body.data.script_translation.segments.length, 2)
  })

  it('rejects stale translation after body changes', async () => {
    const w = world(async (req) => {
      w.store.update(w.row.id, { content: 'changed' })
      return defaultHeadlessResponse(req)
    })
    assert.equal((await w.send('translate', { scope: 'body' })).status, 409)
    assert.equal(w.store.get(w.row.id).body_translation, undefined)
  })

  it('does not label empty JSON as a translation or reuse the original body as a successful translation', async () => {
    const w = world(async (req) => ({ mode: 'live', skillName: req.skillName, data: { text: '', segments: [] } }))
    assert.equal((await w.send('translate', { scope: 'body' })).status, 502)
    assert.equal(w.store.get(w.row.id).body_translation, undefined)
  })

  it('preserves a user draft when media is reimported and invalidates scope identities when order changes', async () => {
    const w = world()
    await w.send('analyze', { scope: 'media', media_index: 1 })
    const old = w.store.get(w.row.id).analysis_results['media:1']
    w.store.update(w.row.id, { creation_draft: { text: 'keep my words', edited: true } })
    const changed = { ...w.row, media_items: [w.row.media_items[1], w.row.media_items[0], w.row.media_items[2]] }
    assert.notEqual(analysisInputFingerprint(changed, old), old.input_fingerprint)
    await w.store.replace(w.row.id, changed)
    assert.equal(w.store.get(w.row.id).creation_draft.text, 'keep my words')
  })

  it('marks legacy remote attachments incomplete rather than analyzing only their caption', async () => {
    const w = world()
    w.store.update(w.row.id, { media_items: [], local_paths: {}, media_urls: ['https://example.com/old.mp4'] })
    assert.equal((await w.send('analyze', { scope: 'post' })).status, 422)
    assert.equal(w.calls.length, 0)
  })

  it('normalizes actual cancellation when the translation tool reports an ordinary error', async () => {
    const controller = new AbortController()
    const w = world(async () => { controller.abort('user cancelled'); throw new Error('network closed') })
    assert.equal((await w.send('translate', { scope: 'body' }, controller.signal)).status, 499)
    assert.equal(w.store.get(w.row.id).body_translation, undefined)
  })

  it('legacy video analyzer reports actual failure instead of inventing beauty scenes', async () => {
    const response = await analyzeInspirationVideo({ videoPath: '/unused', videoAnalyzeTool: { execute: async () => { throw new Error('video failed') } } })
    assert.equal(response.deconstruction, null); assert.equal(response.error, 'video failed')
    assert.equal((await analyzeInspirationVideo({ videoPath: '/unused', videoAnalyzeTool: { execute: async () => ({ text: 'unverified' }) } })).deconstruction, null)
  })

  it('routes unscoped POST /analyze through headlessSkill and mirrors deconstruction without calling legacy tools', async () => {
    const w = world()
    let legacyToolCalls = 0
    const dispatcher = createLocalInspirationDispatcher({
      localStore: w.store,
      headlessSkill: () => w.headlessSkill,
      videoAnalyzeTool: { execute: async () => { legacyToolCalls += 1; throw new Error('must not call legacy videoAnalyzeTool') } },
      textComplete: { execute: async () => { legacyToolCalls += 1; throw new Error('must not call legacy textComplete') } },
    })
    const res = await dispatcher.dispatch({
      method: 'POST',
      url: `/omnimux/inspiration/local/${w.row.id}/analyze`,
      body: {},
    })
    assert.equal(res.status, 200)
    assert.equal(legacyToolCalls, 0)
    assert.equal(w.calls.length, 1)
    assert.equal(w.calls[0].req.skillName, INSPIRATION_DECONSTRUCT_SKILL)
    assert.equal(w.calls[0].req.outputSchema, INSPIRATION_ANALYSIS_SCHEMA)
    assert.equal(res.body.data.analysis_results['media:0'].status, 'done')
    assert.equal(res.body.data.deconstruction.summary, '来自实际输入的分析。')
    assert.equal(res.body.data.deconstruction.hook, '前三秒冲突开场')
  })

  it('routes URL import auto_analyze through headlessSkill instead of legacy videoAnalyzeTool', async () => {
    const w = world()
    let legacyToolCalls = 0
    const dispatcher = createLocalInspirationDispatcher({
      localStore: w.store,
      headlessSkill: () => w.headlessSkill,
      videoAnalyzeTool: { execute: async () => { legacyToolCalls += 1; throw new Error('must not call legacy videoAnalyzeTool') } },
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      socialFetcher: async () => ({
        platform: 'tiktok',
        capability: 'video',
        data: {
          title: 'Headless Auto Analyze Video',
          desc: '自动解构正文',
          cover_url: 'https://example.com/cover.jpg',
          video_url: 'https://example.com/clip.mp4',
        },
      }),
      fetcher: async () => ({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'video/mp4']]),
        arrayBuffer: async () => Buffer.from('fake-mp4-video-bytes'),
      }),
    })
    const res = await dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/inspiration/local/import-url',
      body: {
        url: 'https://www.tiktok.com/@creator/video/20260416001',
        auto_analyze: true,
      },
    })
    assert.equal(res.status, 200)
    assert.equal(legacyToolCalls, 0)
    assert.equal(w.calls.length, 1)
    assert.equal(w.calls[0].req.skillName, INSPIRATION_DECONSTRUCT_SKILL)
    assert.equal(w.calls[0].req.outputSchema, INSPIRATION_ANALYSIS_SCHEMA)
    assert.equal(res.body.data.deconstruction.summary, '来自实际输入的分析。')
    assert.equal(res.body.data.analysis_results['media:0'].status, 'done')
    assert.equal(res.body.data.analysis_results['media:0'].source, 'live')
  })

  it('immediately settles running status in store on POST /analyze/cancel without race', async () => {
    let release
    const started = new Promise((resolve) => { release = resolve })
    const w = world(async (req) => {
      release()
      await new Promise((_, reject) => {
        req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })), { once: true })
      })
    })
    const pending = w.send('analyze', { scope: 'body' })
    await started
    const cancelRes = await w.send('analyze/cancel', { scope: 'body' })
    assert.equal(cancelRes.status, 200)
    assert.equal(cancelRes.body.data.analysis_results.body.status, 'failed')
    assert.equal(cancelRes.body.data.analysis_results.body.error_code, 'analysis-cancelled')
    const analyzeRes = await pending
    assert.equal(analyzeRes.status, 499)
  })

  it('rejects cross-item and cross-plugin job_id cancellation with 403 without cancelling foreign jobs', async () => {
    const cancelledIds = []
    const foreignJobs = new Map([
      ['job-other-item', { jobId: 'job-other-item', ownerPlugin: 'omnimux-inspiration', targetId: 'other-item:post', status: 'running' }],
      ['job-other-plugin', { jobId: 'job-other-plugin', ownerPlugin: 'omnimux-products', targetId: 'p1:brand', status: 'running' }],
    ])
    const w = world()
    const dispatcher = createLocalInspirationDispatcher({
      localStore: w.store,
      headlessSkill: {
        run: w.headlessSkill.run,
        listJobs: () => [...foreignJobs.values()],
        getJob: (id) => foreignJobs.get(id) || null,
        cancel: (id) => { cancelledIds.push(id); return true },
      },
    })
    for (const badId of ['job-other-item', 'job-other-plugin', 'nonexistent-job']) {
      const res = await dispatcher.dispatch({
        method: 'POST',
        url: `/omnimux/inspiration/local/${w.row.id}/analyze/cancel`,
        body: { job_id: badId },
      })
      assert.equal(res.status, 403, `must reject unauthorized job_id ${badId}`)
    }
    assert.deepEqual(cancelledIds, [], 'must never call headlessSkill.cancel for foreign job IDs')
  })

  it('allows immediate retry after POST /analyze/cancel while prior run unwinds without 409 or clobbering', async () => {
    let callCount = 0
    let releaseFirstStart
    const firstStarted = new Promise((resolve) => { releaseFirstStart = resolve })
    let releaseFirstUnwind
    const firstUnwindGate = new Promise((resolve) => { releaseFirstUnwind = resolve })

    const w = world(async (req) => {
      callCount += 1
      if (callCount === 1) {
        releaseFirstStart()
        await firstUnwindGate
        throw Object.assign(new Error('late abort unwind'), { name: 'AbortError', code: 'ABORT_ERR' })
      }
      return {
        mode: 'live',
        jobId: 'job-retry-2',
        skillName: req.skillName,
        model: 'test-model',
        data: { summary: '重试后成功结果', sections: [], shots: [] },
      }
    })

    const firstPending = w.send('analyze', { scope: 'body' })
    await firstStarted
    const cancelRes = await w.send('analyze/cancel', { scope: 'body' })
    assert.equal(cancelRes.status, 200)

    // Retry immediately BEFORE the first promise finishes unwinding: must NOT return 409.
    const retryRes = await w.send('analyze', { scope: 'body' })
    assert.equal(retryRes.status, 200)
    assert.equal(retryRes.body.data.analysis_results.body.status, 'done')
    assert.equal(retryRes.body.data.analysis_results.body.result.summary, '重试后成功结果')

    // Now let the first aborted run unwind; it must NOT overwrite the newer done result.
    releaseFirstUnwind()
    const firstRes = await firstPending
    assert.equal(firstRes.status, 499)
    const after = w.store.get(w.row.id)
    assert.equal(after.analysis_results.body.status, 'done')
    assert.equal(after.analysis_results.body.result.summary, '重试后成功结果')
  })

  it('enforces inputFingerprint 409 and deleted-item 404 guards on script translation', async () => {
    const wStale = world(async (req) => {
      assert.ok(req.inputFingerprint, 'script translation must supply inputFingerprint')
      assert.equal(typeof req.verifyFingerprint, 'function')
      wStale.store.update(wStale.row.id, { deconstruction: { segments: [{ id: 'seg_1', text: '被修改的新台词' }] } })
      return { mode: 'live', jobId: 'j1', skillName: req.skillName, model: 'm', data: { text: 'Old', segments: [{ id: 'seg_1', text: 'Old' }] } }
    })
    wStale.store.update(wStale.row.id, { deconstruction: { segments: [{ id: 'seg_1', text: '原始台词' }] } })
    const staleRes = await wStale.send('translate', { lang: 'en' })
    assert.equal(staleRes.status, 409)
    assert.equal(wStale.store.get(wStale.row.id).script_translation, undefined)

    const wDeleted = world(async (req) => {
      wDeleted.store.delete(wDeleted.row.id)
      return { mode: 'live', jobId: 'j2', skillName: req.skillName, model: 'm', data: { text: 'Translated', segments: [] } }
    })
    const delRes = await wDeleted.send('translate', { lang: 'en' })
    assert.equal(delRes.status, 404)
  })

  it('maps headless-skill-transport-exceeded to HTTP 422 with localized message', async () => {
    const w = world(async () => {
      throw Object.assign(new Error('raw transport error'), { code: 'headless-skill-transport-exceeded' })
    })
    const res = await w.send('analyze', { scope: 'post' })
    assert.equal(res.status, 422)
    assert.match(res.body.error, /传输容量/)
  })
})
