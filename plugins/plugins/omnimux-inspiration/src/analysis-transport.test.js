import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { mkdtempSync, writeFileSync, truncateSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleScopedAnalysis } from './scoped-analysis.js'
import { createLocalStore } from './local-store.js'
import { INSPIRATION_DECONSTRUCT_SKILL } from './inspiration-skills.js'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function asset(size, name = 'source.mp4') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'inspiration-transport-test-')))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, 'original')
  truncateSync(path, size)
  return path
}

test('delegates 98MB video references to lazy Hub headlessSkill seam and handles done/failed/cancel', async () => {
  for (const outcome of ['done', 'failed', 'cancel']) {
    const source = asset(98_376_196)
    const root = join(source, '..')
    const paths = { dir: root, libraryFile: join(root, 'library.json'), videosDir: root, imagesDir: join(root, 'images'), coversDir: join(root, 'covers'), mediaDir: root }
    const store = createLocalStore({ paths })
    const row = store.add({ title: 'saved post', content: 'complete body', type: 'video', local_paths: { video: source }, media_items: [{ type: 'video', url: '/omnimux/inspiration/local/media/videos/source.mp4' }] })
    let calls = 0
    const controller = new AbortController()
    const work = handleScopedAnalysis({
      id: row.id,
      store,
      paths,
      signal: controller.signal,
      req: { body: { scope: 'post' } },
      headlessSkill: () => ({
        async run(req) {
          calls += 1
          assert.equal(req.skillName, INSPIRATION_DECONSTRUCT_SKILL)
          assert.equal(req.references[0].pathOrUrl, source)
          assert.equal(existsSync(source), true)
          if (outcome === 'failed') throw Object.assign(new Error('完整视频准备未满足分析容量，未提交不完整分析'), { code: 'headless-skill-transport-exceeded' })
          if (outcome === 'cancel') controller.abort()
          return {
            mode: 'live',
            jobId: 'job-video-98mb',
            skillName: req.skillName,
            model: 'gemini-2.5-pro',
            data: { summary: 'actual analysis', content_type: 'video', sections: [], shots: [] },
          }
        },
      }),
    })
    if (outcome === 'cancel') await assert.rejects(work, { name: 'AbortError' })
    else assert.equal((await work).status, outcome === 'done' ? 200 : 502)
    assert.equal(calls, 1)
    assert.equal(existsSync(source), true)
    assert.equal(store.get(row.id).analysis_results.post.status, outcome === 'done' ? 'done' : 'failed')
  }
})

test('fails loudly with 503 when Hub headlessSkill seam is unavailable', async () => {
  const source = asset(1024)
  const root = join(source, '..')
  const paths = { dir: root, libraryFile: join(root, 'library.json'), videosDir: root, imagesDir: join(root, 'images'), coversDir: join(root, 'covers'), mediaDir: root }
  const store = createLocalStore({ paths })
  const row = store.add({ title: 'saved post', content: 'complete body', type: 'video', local_paths: { video: source }, media_items: [{ type: 'video', url: '/omnimux/inspiration/local/media/videos/source.mp4' }] })
  const res = await handleScopedAnalysis({
    id: row.id,
    store,
    paths,
    req: { body: { scope: 'post' } },
  })
  assert.equal(res.status, 503)
  assert.match(res.body.error, /headlessSkill/)
  assert.equal(store.get(row.id).analysis_results.post.error_code, 'headless-skill-unavailable')
})
