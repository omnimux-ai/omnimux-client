/**
 * Issue #89: `muse-video` submits through the gateway's `openai_video` shape.
 *
 * These tests drive the real submit path (`executeOmnimuxVideo` -> SubmitGuard
 * -> protocol runtime -> fetch) against a loopback mock upstream. The mock
 * keeps the production gateway rule that a `size` outside the Sora enum is a
 * 400 `plugin_usage_invalid`, so a regression back to `size:"adaptive"` fails
 * here instead of passing as a body-only unit assertion.
 */
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after, before, describe, it } from 'node:test'
import { guardSubmit } from '../catalog/contract/submit-guard/index.js'
import { getRuntimeContractIndex } from '../catalog/runtime-index.js'
import { executeOmnimuxVideo, pollVideoTask } from './video.js'
import { mountMedia } from './mount.js'
import { taskPathFor, taskPollPathFor } from './vendors/omnimux.js'
import { findMediaTaskByUpstreamId } from './task-store.js'

// Valid 1x1 PNG. The probe validates the magic bytes and the mock upstream
// must receive this exact URL / byte content for the first-frame case.
const FIRST_FRAME_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const SORA_SIZE_ENUM = ['720x1280', '1280x720', '1792x1024', '1024x1792']

/** A fetch implementation that reaches the loopback mock over real HTTP. */
function nodeFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const headers = init.headers ? Object.fromEntries(new Headers(init.headers)) : {}
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: init.method ?? 'GET',
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers,
      })))
    })
    request.on('error', reject)
    if (init.body !== undefined) request.write(init.body)
    request.end()
  })
}

function startMockUpstream() {
  /** @type {Array<{method: string, path: string, headers: Record<string, string>, rawBody: string, body: any}>} */
  const requests = []
  let servedImage = null
  let taskSeq = 0
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks)
      let body
      try {
        body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : undefined
      } catch {
        body = undefined
      }
      requests.push({
        method: String(request.method || ''),
        path: String(request.url || '').split('?')[0],
        headers: { ...request.headers },
        rawBody: rawBody.toString('utf8'),
        body,
      })

      if (request.method === 'GET' && request.url === '/first.png') {
        servedImage = FIRST_FRAME_PNG
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': FIRST_FRAME_PNG.length })
        response.end(FIRST_FRAME_PNG)
        return
      }
      if (request.method === 'POST' && request.url === '/v1/videos') {
        // Mirrors the production-equivalent gateway: the complete body is
        // forwarded to the terminal mock (same process here) unchanged.
        if (body?.size !== undefined && !SORA_SIZE_ENUM.includes(body.size)) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({
            code: 'plugin_usage_invalid',
            error: { message: 'plugin usage enum is not an allowed value' },
          }))
          return
        }
        taskSeq += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ task_id: `task-mock-${taskSeq}`, status: 'submitted' }))
        return
      }
      if (request.method === 'POST' && request.url === '/v1/video/generations') {
        // Legacy route kept only for old in-flight and invalid-size regression.
        if (body?.size !== undefined && !SORA_SIZE_ENUM.includes(body.size)) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({
            code: 'plugin_usage_invalid',
            error: { message: 'plugin usage enum is not an allowed value' },
          }))
          return
        }
        taskSeq += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ task_id: `task-legacy-${taskSeq}`, status: 'submitted' }))
        return
      }
      if (request.method === 'GET' && /^\/v1\/(videos|video\/generations)\/[^/]+$/.test(request.url || '')) {
        const taskId = String(request.url).split('/').pop()
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'completed', video_url: `https://cdn.example/${taskId}.mp4` }))
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        requests,
        servedImage: () => servedImage,
        reset: () => { requests.length = 0; taskSeq = 0; servedImage = null },
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

describe('muse-video openai_video submit contract', () => {
  let mock
  let baseUrl
  let requests

  before(async () => {
    mock = await startMockUpstream()
    baseUrl = mock.baseUrl
    requests = mock.requests
  })

  after(async () => {
    await new Promise((resolve) => mock.server.close(resolve))
  })

  function reset() {
    mock.reset()
  }

  function execute(overrides = {}) {
    return executeOmnimuxVideo({
      prompt: 'a cat on a wall',
      dest: join(tmpdir(), `muse-video-${Date.now()}.mp4`),
      model: 'muse-video',
      operation: 'first_frame',
      references: [{ type: 'image', role: 'first_frame', pathOrUrl: `${baseUrl}/first.png` }],
      duration: 10,
      aspectRatio: 'adaptive',
      wait: false,
      env: { OMNIMUX_API_KEY: 'sk-test', OMNIMUX_BASE_URL: `${baseUrl}/v1` },
      fetcher: nodeFetch,
      ...overrides,
    })
  }

  function mountVideoEntry() {
    const tools = []
    mountMedia({
      tools: { register(tool) { tools.push(tool) } },
      provide() {},
      get() { return undefined },
    }, {
      kind: 'video',
      // The tool is the real client entry; inject the loopback fetcher only at
      // the test boundary (the suite preloads a network guard that blocks
      // global fetch even for loopback).
      execute: (request) => executeOmnimuxVideo({ ...request, fetcher: nodeFetch }),
      media: {
        defaultProvider: 'omnimux',
        providers: {
          omnimux: {
            protocol: 'openai-media',
            baseUrl: `${baseUrl}/v1`,
            apiKey: 'sk-test',
            models: { video: 'muse-video' },
          },
        },
      },
      jsonOut: {},
    })
    assert.equal(tools.length, 1)
    return tools[0]
  }

  it('submits first_frame as POST /v1/videos with image + aspect_ratio + duration', async () => {
    reset()
    const result = await execute()
    assert.equal(result.mode, 'submitted')
    assert.equal(result.taskId, 'task-mock-1')

    const posts = requests.filter((row) => row.method === 'POST')
    assert.equal(posts.length, 1)
    const [post] = posts
    assert.equal(post.path, '/v1/videos')
    assert.equal(post.headers['content-type'], 'application/json')
    assert.equal(post.headers.authorization, 'Bearer sk-test')
    assert.deepEqual(post.body, {
      prompt: 'a cat on a wall',
      operation: 'first_frame',
      image: `${baseUrl}/first.png`,
      duration: 10,
      aspect_ratio: 'adaptive',
      output_format: 'mp4',
      model: 'muse-video',
    })
    assert.equal('size' in post.body, false)
    assert.equal('image_with_roles' in post.body, false)

    const imageGets = requests.filter((row) => row.method === 'GET' && row.path === '/first.png')
    assert.equal(imageGets.length, 1)
    assert.ok(mock.servedImage())
    assert.equal(Buffer.compare(mock.servedImage(), FIRST_FRAME_PNG), 0)
    assert.equal(post.body.image, `${baseUrl}/first.png`)
  })

  it('submits text_to_video with aspect_ratio and no size', async () => {
    reset()
    const result = await execute({
      operation: 'text_to_video',
      references: [],
      duration: 5,
      aspectRatio: '16:9',
    })
    assert.equal(result.mode, 'submitted')
    assert.equal(result.taskId, 'task-mock-1')

    const posts = requests.filter((row) => row.method === 'POST')
    assert.equal(posts.length, 1)
    assert.equal(posts[0].path, '/v1/videos')
    assert.deepEqual(posts[0].body, {
      prompt: 'a cat on a wall',
      operation: 'text_to_video',
      duration: 5,
      aspect_ratio: '16:9',
      output_format: 'mp4',
      model: 'muse-video',
    })
    assert.equal('size' in posts[0].body, false)
  })

  it('keeps the mock gateway enum guard: legacy size:adaptive still returns 400', async () => {
    reset()
    const response = await nodeFetch(`${baseUrl}/v1/video/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test' },
      body: JSON.stringify({
        prompt: 'a cat',
        operation: 'first_frame',
        image_with_roles: [{ url: `${baseUrl}/first.png`, role: 'first_frame' }],
        duration: 10,
        size: 'adaptive',
        output_format: 'mp4',
        model: 'muse-video',
      }),
    })
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.code, 'plugin_usage_invalid')
    assert.match(payload.error.message, /enum is not an allowed value/)
    assert.equal('task_id' in payload, false)
  })

  it('polls muse-video at GET /v1/videos/<task_id>', async () => {
    reset()
    const result = await pollVideoTask({
      baseUrl: `${baseUrl}/v1`, apiKey: 'sk-test', taskId: 'task-mock-1',
      taskPath: 'videos', fetcher: nodeFetch, sleep: async () => {},
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.video_url, 'https://cdn.example/task-mock-1.mp4')
    const get = requests.find((row) => row.method === 'GET' && row.path === '/v1/videos/task-mock-1')
    assert.ok(get, 'muse-video poll must use /v1/videos/<task_id>')
  })

  it('keeps old in-flight task polls on the legacy path', async () => {
    reset()
    const result = await pollVideoTask({
      baseUrl: `${baseUrl}/v1`, apiKey: 'sk-test', taskId: 'old-task-1',
      taskPath: 'video/generations', fetcher: nodeFetch, sleep: async () => {},
    })
    assert.equal(result.status, 'completed')
    const get = requests.find((row) => row.method === 'GET' && row.path === '/v1/video/generations/old-task-1')
    assert.ok(get, 'old in-flight tasks keep the old submit path')
  })

  it('limits the videos route to exact muse-video; other video models stay legacy', () => {
    assert.equal(taskPathFor('video', 'muse-video'), 'videos')
    assert.equal(taskPollPathFor('video', 'muse-video'), 'videos')
    assert.equal(taskPathFor('video', 'seedance-2-5'), 'video/generations')
    assert.equal(taskPollPathFor('video', 'seedance-2-5'), 'video/generations')
    assert.equal(taskPathFor('video', 'wan-3.0'), 'video/generations')
  })

  it('real client media entry submits first_frame via /v1/videos without a group header', async () => {
    reset()
    const tool = mountVideoEntry()
    const result = await tool.execute({
      prompt: 'a cat on a wall',
      dest: join(tmpdir(), `muse-video-entry-${Date.now()}.mp4`),
      model: 'muse-video',
      operation: 'first_frame',
      references: [{ type: 'image', role: 'first_frame', pathOrUrl: `${baseUrl}/first.png` }],
      duration: 10,
      aspectRatio: 'adaptive',
      wait: false,
    }, {})
    assert.equal(result.mode, 'submitted')
    assert.equal(result.taskId, 'task-mock-1')
    assert.equal(findMediaTaskByUpstreamId('task-mock-1')?.taskPath, 'videos')
    const post = requests.find((row) => row.method === 'POST' && row.path === '/v1/videos')
    assert.ok(post, 'real client entry must use /v1/videos')
    assert.equal(post.headers['x-omnimux-group'], undefined)
    assert.deepEqual(post.body, {
      prompt: 'a cat on a wall',
      operation: 'first_frame',
      image: `${baseUrl}/first.png`,
      duration: 10,
      aspect_ratio: 'adaptive',
      output_format: 'mp4',
      model: 'muse-video',
    })
  })

  it('real client media entry keeps explicit group routing on /v1/videos', async () => {
    reset()
    const tool = mountVideoEntry()
    const result = await tool.execute({
      prompt: 'a cat on a wall',
      dest: join(tmpdir(), `muse-video-group-${Date.now()}.mp4`),
      model: 'muse-video',
      operation: 'text_to_video',
      duration: 5,
      aspectRatio: '16:9',
      group: 'pool',
      wait: false,
    }, {})
    assert.equal(result.mode, 'submitted')
    const post = requests.find((row) => row.method === 'POST' && row.path === '/v1/videos')
    assert.ok(post)
    assert.equal(post.headers['x-omnimux-group'], 'pool')
    assert.equal(post.body.aspect_ratio, '16:9')
    assert.equal(post.body.model, 'muse-video')
  })

  it('maps first_frame without explicit aspectRatio to the fixed adaptive value', () => {
    const runtime = getRuntimeContractIndex()
    const result = guardSubmit({
      model: 'muse-video',
      operation: 'first_frame',
      prompt: 'a cat',
      duration: 10,
      references: [{ type: 'image', role: 'first_frame', pathOrUrl: 'https://f.example/first.png', mime: 'image/png', sizeBytes: 100 }],
    }, { index: runtime.index, seam: 'videoGenerate', capability: 'video', outputType: 'video' })
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(result.vendorPayload, {
      prompt: 'a cat',
      operation: 'first_frame',
      image: 'https://f.example/first.png',
      duration: 10,
      aspect_ratio: 'adaptive',
      output_format: 'mp4',
    })
  })

  it('keeps seedance-2-5 frame and text payloads on the existing image_with_roles + size shape', () => {
    const runtime = getRuntimeContractIndex()
    const firstFrame = guardSubmit({
      model: 'seedance-2-5',
      operation: 'first_frame',
      prompt: 'x',
      duration: 5,
      resolution: '720p',
      aspectRatio: 'adaptive',
      references: [{ type: 'image', role: 'first_frame', pathOrUrl: 'https://f.example/first.png', mime: 'image/png', sizeBytes: 100 }],
    }, { index: runtime.index, seam: 'videoGenerate', capability: 'video', outputType: 'video' })
    assert.equal(firstFrame.ok, true, firstFrame.message)
    assert.deepEqual(firstFrame.vendorPayload, {
      prompt: 'x',
      operation: 'first_frame',
      image_with_roles: [{ url: 'https://f.example/first.png', role: 'first_frame' }],
      duration: 5,
      size: 'adaptive',
      resolution: '720p',
      generate_audio: true,
      watermark: false,
      output_format: 'mp4',
      return_last_frame: false,
      nsfw_check: false,
    })

    const textToVideo = guardSubmit({
      model: 'seedance-2-5',
      operation: 'text_to_video',
      prompt: 'x',
      duration: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    }, { index: runtime.index, seam: 'videoGenerate', capability: 'video', outputType: 'video' })
    assert.equal(textToVideo.ok, true, textToVideo.message)
    assert.deepEqual(textToVideo.vendorPayload, {
      prompt: 'x',
      operation: 'text_to_video',
      duration: 5,
      size: '16:9',
      resolution: '720p',
      generate_audio: true,
      watermark: false,
      output_format: 'mp4',
      return_last_frame: false,
      nsfw_check: false,
    })
  })

  it('keeps wan-3.0 text payload on the existing size shape', () => {
    const runtime = getRuntimeContractIndex()
    const result = guardSubmit({
      model: 'wan-3.0',
      operation: 'text_to_video',
      prompt: 'x',
      duration: 5,
      resolution: '720P',
      aspectRatio: 'adaptive',
    }, { index: runtime.index, seam: 'videoGenerate', capability: 'video', outputType: 'video' })
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(result.vendorPayload, {
      prompt: 'x',
      operation: 'text_to_video',
      duration: 5,
      size: 'adaptive',
      resolution: '720P',
      audio: true,
      watermark: false,
      nsfw_check: false,
    })
  })
})
