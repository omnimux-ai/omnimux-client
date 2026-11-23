import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetCurrentSnapshotResolver, setCurrentSnapshotResolver } from '../catalog/cloud/current.js'
import { normalizePricingPayload } from '../catalog/cloud/snapshot.js'
import { executeOmnimuxMedia } from './execute.js'
import { createMediaTaskRecord, findMediaTaskByUpstreamId, saveMediaTaskRecord } from './task-store.js'

describe('媒体任务生命周期收取与误判消除测试', () => {
  let tempHomeDir
  let origDshHome

  beforeEach(() => {
    origDshHome = process.env.DSH_HOME
    tempHomeDir = mkdtempSync(join(tmpdir(), 'media-lifecycle-test-home-'))
    process.env.DSH_HOME = tempHomeDir
  })

  afterEach(() => {
    if (origDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = origDshHome
    if (tempHomeDir && existsSync(tempHomeDir)) {
      rmSync(tempHomeDir, { recursive: true, force: true })
    }
  })
  it('契约 1: 当主会话处于 agent 模式且未配置媒体时，凭借有效 taskRef 轮询取结果绝不报 omnimux-unconfigured', async () => {
    const record = createMediaTaskRecord({
      capability: 'video',
      model: 'minimax-h3',
      providerId: 'omnimux',
      protocol: 'openai-media',
      baseUrl: 'https://api.omnimux.ai/v1',
      wireModel: 'minimax-h3',
      group: 'default',
      taskPath: 'video/generations',
      requestKey: 'req-test-agent-bypass',
    })
    record.upstreamTaskId = 'task-remote-12345'
    record.status = 'submitted'
    saveMediaTaskRecord(record)

    let networkPolled = false
    const mockFetcher = async (url) => {
      networkPolled = true
      return new Response(JSON.stringify({
        status: 'completed',
        output: { video_url: 'https://cdn.test/video.mp4' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    try {
      await executeOmnimuxMedia('video', {
        dest: '/tmp/test-out.mp4',
        taskRef: record.taskRef,
        taskId: record.upstreamTaskId,
        runtimeSettings: {
          runtimeMode: 'agent', // 本机 CLI 模式，且未配置 BYOK
        },
        env: {
          OMNIMUX_API_KEY: 'test-token',
        },
        fetcher: mockFetcher,
        wait: true,
      })
      assert.equal(networkPolled, true, 'taskRef 轮询取回产物必须触发上游网络状态查询')
    } catch (err) {
      // 核心断言：绝对不能被“本机助手只承接文字”误拦！
      assert.notEqual(
        err.message,
        '本机助手只承接文字，图片、视频和音频需要配置媒体生成提供商或改用官方',
        '轮询请求绝对不能被新生成准入规则误拦截'
      )
    }
  })

  it('契约 2: 仅传 taskId 且在账本中唯一定位时，同样免除 agent 模式未配置媒体拦截', async () => {
    const record = createMediaTaskRecord({
      capability: 'video',
      model: 'minimax-h3',
      providerId: 'omnimux',
      protocol: 'openai-media',
      baseUrl: 'https://api.omnimux.ai/v1',
      wireModel: 'minimax-h3',
      group: 'default',
      taskPath: 'video/generations',
      requestKey: 'req-test-legacy-task-id',
    })
    record.upstreamTaskId = 'task-legacy-99999'
    record.status = 'submitted'
    saveMediaTaskRecord(record)

    const mockFetcher = async () => new Response(JSON.stringify({
      status: 'completed',
      output: { video_url: 'https://cdn.test/video-legacy.mp4' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

    try {
      await executeOmnimuxMedia('video', {
        dest: '/tmp/test-out.mp4',
        taskId: 'task-legacy-99999', // 没有 model，没有 taskRef
        runtimeSettings: {
          runtimeMode: 'agent',
        },
        env: {
          OMNIMUX_API_KEY: 'test-token',
        },
        fetcher: mockFetcher,
        wait: true,
      })
    } catch (err) {
      assert.notEqual(
        err.message,
        '本机助手只承接文字，图片、视频和音频需要配置媒体生成提供商或改用官方',
        '旧版仅传 taskId 也必须免除 agent 误判'
      )
    }
  })

  it('recovers unrecorded task IDs without adding the published default group to GET', async (t) => {
    const baseUrl = 'https://gateway.example.test/v1'
    const taskId = 'task-from-another-install'
    const models = ['seedance-2-5', 'muse-video', 'gpt-image-2.5']
    const { snapshot } = normalizePricingPayload({ data: models.map(model => ({
      model_name: model, enable_groups: ['default'], group_order: ['default'], default_group: 'default',
    })) })
    setCurrentSnapshotResolver(() => ({ snapshot }))
    t.after(resetCurrentSnapshotResolver)

    for (const { capability, model, path, taskPath } of [
      { capability: 'video', model: 'seedance-2-5', path: 'video/generations' },
      { capability: 'video', model: 'muse-video', path: 'videos' },
      { capability: 'image', model: 'gpt-image-2.5', path: 'images/generations' },
      { capability: 'image', model: 'gpt-image-2.5', path: 'images/tasks', taskPath: 'images/tasks' },
    ]) {
      const pollUrl = `${baseUrl}/${path}/${taskId}`
      const extension = capability === 'video' ? 'mp4' : 'png'
      const assetUrl = `https://assets.example.test/result.${extension}`
      const dest = join(tempHomeDir, `result.${extension}`)
      const calls = []
      const result = await executeOmnimuxMedia(capability, {
        taskId, dest, taskPath,
        env: { OMNIMUX_API_KEY: 'sk-test', OMNIMUX_BASE_URL: baseUrl, OMNIMUX_IMAGE_MODEL: model, OMNIMUX_VIDEO_MODEL: model },
        fetcher: async (url, init) => {
          const headers = new Headers(init.headers)
          const group = headers.get('X-Omnimux-Group')
          calls.push({ path: String(url), method: init.method ?? 'GET', group })
          if (url === pollUrl) {
            if (headers.get('Authorization') !== 'Bearer sk-test') return new Response(null, { status: 401 })
            if (group !== null) return Response.json({ error: { message: 'fixture group forbidden' } }, { status: 403 })
            return Response.json({ status: 'completed', url: assetUrl })
          }
          if (url === assetUrl) return new Response('fixture artifact', { headers: { 'content-type': `${capability}/${extension}` } })
          return new Response(null, { status: 400 })
        },
      })
      assert.deepEqual(result, { mode: 'live', taskId, url: assetUrl })
      assert.deepEqual(calls, [
        { path: pollUrl, method: 'GET', group: null },
        { path: assetUrl, method: 'GET', group: null },
      ])
      assert.equal(readFileSync(dest, 'utf8'), 'fixture artifact')
      assert.equal(findMediaTaskByUpstreamId(taskId), null)
    }
  })

  it('契约 3: 相同 requestKey 发起新生成提交时，直接复用已存在的任务记录，严禁触发二次上游 POST', async () => {
    const testKey = `req-idempotent-repeat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const record = createMediaTaskRecord({
      capability: 'video',
      model: 'minimax-h3',
      providerId: 'omnimux',
      protocol: 'openai-media',
      baseUrl: 'https://api.omnimux.ai/v1',
      wireModel: 'minimax-h3',
      group: 'default',
      taskPath: 'video/generations',
      requestKey: testKey,
    })
    record.upstreamTaskId = 'task-first-submit-777'
    record.status = 'submitted'
    saveMediaTaskRecord(record)

    let postCallCount = 0
    const mockFetcher = async () => {
      postCallCount++
      return new Response('{}', { status: 200 })
    }

    const res = await executeOmnimuxMedia('video', {
      dest: '/tmp/test-repeat.mp4',
      model: 'minimax-h3',
      prompt: 'a cinematic video',
      requestKey: testKey,
      runtimeSettings: { runtimeMode: 'official' },
      env: { OMNIMUX_API_KEY: 'test-token' },
      fetcher: mockFetcher,
      wait: false,
    })

    assert.equal(res.mode, 'submitted')
    assert.equal(res.taskId, 'task-first-submit-777')
    assert.equal(res.taskRef, record.taskRef)
    assert.equal(postCallCount, 0, '命中有记录的 requestKey 必须短路，严禁发生二次生成请求')
  })
})
