import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createHubToolExecutor,
  createTextCompleteAdapter,
  createVideoAnalyzeAdapter,
} from './hub-tools.js'

describe('createTextCompleteAdapter', () => {
  it('passes the caller signal inside the single Hub request object', async () => {
    let captured
    const adapter = createTextCompleteAdapter({
      resolveTextComplete: () => ({
        async execute(req) {
          captured = req
          return { text: 'structured result' }
        },
      }),
    })
    const controller = new AbortController()
    const result = await adapter.execute(
      { prompt: 'split this script', maxTokens: 1200 },
      { signal: controller.signal },
    )
    assert.deepEqual(result, { text: 'structured result' })
    assert.equal(captured.prompt, 'split this script')
    assert.equal(captured.maxTokens, 1200)
    assert.equal(captured.signal, controller.signal)
  })

  it('fails explicitly when the textComplete seam is absent', async () => {
    const adapter = createTextCompleteAdapter({ resolveTextComplete: () => undefined })
    await assert.rejects(
      () => adapter.execute({ prompt: 'split this script' }),
      /omnimux_text_complete 未就绪/,
    )
  })
})

describe('createVideoAnalyzeAdapter', () => {
  it('dispatches one batch call through ctx.tools.execute and unwraps value by callId', async () => {
    const controller = new AbortController()
    const calls = []
    const tools = {
      async execute(input) {
        calls.push(input)
        return {
          results: [
            { callId: 'other', result: { isError: false, value: { mode: 'wrong' } } },
            { callId: 'video-call', result: { isError: false, content: [], value: { mode: 'live', report: '# real report', model: 'video-model' } } },
          ],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const adapter = createVideoAnalyzeAdapter({ resolveTools: () => tools, idFactory: () => 'video-call' })
    const result = await adapter.execute(
      { video: '/tmp/clip.mp4', notes: 'analyze the hook' },
      { signal: controller.signal },
    )

    assert.equal(calls.length, 1)
    assert.equal(calls[0].signal, controller.signal)
    assert.deepEqual(calls[0].calls, [{
      type: 'tool-call',
      id: 'video-call',
      name: 'video_analyze',
      arguments: JSON.stringify({ video: '/tmp/clip.mp4', notes: 'analyze the hook' }),
    }])
    assert.deepEqual(result, { mode: 'live', report: '# real report', model: 'video-model' })
  })

  it('keeps the actionable video-plugin message when ctx.tools.execute is absent', async () => {
    const adapter = createVideoAnalyzeAdapter({ resolveTools: () => ({}) })
    await assert.rejects(
      () => adapter.execute({ video: '/tmp/clip.mp4' }),
      /多模态视频分析工具 \(video_analyze\) 未就绪，请检查 omnimux-video 插件是否加载/,
    )
  })

  it('maps an UNKNOWN_TOOL batch result to the same actionable message', async () => {
    const tools = {
      async execute(input) {
        return {
          results: [{
            callId: input.calls[0].id,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'UNKNOWN_TOOL: video_analyze' }],
              error: { message: 'UNKNOWN_TOOL', info: { code: 'UNKNOWN_TOOL' } },
            },
          }],
        }
      },
    }
    const adapter = createVideoAnalyzeAdapter({ resolveTools: () => tools })
    await assert.rejects(
      () => adapter.execute({ video: '/tmp/clip.mp4' }),
      /多模态视频分析工具 \(video_analyze\) 未就绪，请检查 omnimux-video 插件是否加载/,
    )
  })
})

describe('createHubToolExecutor', () => {
  it('supports the frozen 0.2.1 single-call contract without reading a tool definition', async () => {
    const calls = []
    const tools = {
      executionMode: () => 'single',
      async execute(input) {
        calls.push(input)
        return { isError: false, content: [], value: { ok: true } }
      },
    }
    const executor = createHubToolExecutor({ resolveTools: () => tools, idFactory: () => 'legacy-call' })
    const result = await executor.execute('video_analyze', { video: '/tmp/clip.mp4' }, { signal: new AbortController().signal })

    assert.deepEqual(result, { ok: true })
    assert.equal(calls[0].callId, 'legacy-call')
    assert.equal(calls[0].name, 'video_analyze')
    assert.deepEqual(calls[0].arguments, { video: '/tmp/clip.mp4' })
    assert.equal('calls' in calls[0], false)
  })

  it('rejects non-object return values on the 0.2.1 single-call fallback instead of returning raw payload heuristics', async () => {
    const tools = {
      executionMode: () => 'single',
      async execute() {
        return { mode: 'raw-without-envelope' }
      },
    }
    const executor = createHubToolExecutor({ resolveTools: () => tools, idFactory: () => 'legacy-raw' })
    const value = await executor.execute('video_analyze', { video: '/tmp/clip.mp4' })
    assert.equal(value, undefined)

    const invalidTools = {
      executionMode: () => 'single',
      async execute() {
        return null
      },
    }
    const invalidExecutor = createHubToolExecutor({ resolveTools: () => invalidTools })
    await assert.rejects(
      () => invalidExecutor.execute('video_analyze', { video: '/tmp/clip.mp4' }),
      /未返回结果对象/,
    )
  })

  it('maps AbortError, ABORT_ERR, ABORTED, and ABORTED_BEFORE_DISPATCH batch errors to AbortError', async () => {
    const cases = [
      { name: 'AbortError', code: undefined },
      { name: 'Error', code: 'ABORT_ERR' },
      { name: 'Error', code: 'ABORTED' },
      { name: 'Error', code: 'ABORTED_BEFORE_DISPATCH' },
    ]
    for (const info of cases) {
      const tools = {
        async execute(input) {
          return {
            results: [{
              callId: input.calls[0].id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'aborted by caller' }],
                error: { message: 'aborted by caller', info },
              },
            }],
          }
        },
      }
      const executor = createHubToolExecutor({ resolveTools: () => tools })
      await assert.rejects(
        () => executor.execute('video_analyze', { video: '/tmp/clip.mp4' }),
        (err) => err instanceof Error && err.name === 'AbortError' && err.code === 'ABORT_ERR',
      )
    }

    const controller = new AbortController()
    controller.abort()
    const throwingTools = {
      async execute() {
        throw new Error('socket closed')
      },
    }
    const abortExecutor = createHubToolExecutor({ resolveTools: () => throwingTools })
    await assert.rejects(
      () => abortExecutor.execute('video_analyze', { video: '/tmp/clip.mp4' }, { signal: controller.signal }),
      (err) => err instanceof Error && err.name === 'AbortError' && err.code === 'ABORT_ERR',
    )
  })
})
