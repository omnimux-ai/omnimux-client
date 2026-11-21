import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWorkbenchContextMessage, mountWorkbenchContextInjector } from './context-injector.js'
import { createWindowRegistry } from '../events/windows.js'

describe('Workbench Context Injector', () => {
  it('refreshes the authenticated Clip viewport before the first step, preserving canvas context on exit', async () => {
    const windows = createWindowRegistry()
    let now = 1000
    let active = true
    const byMode = mode => ({
      schemaVersion: 1, sessionId: 's1', ok: true, capturedAt: now,
      surface: { tabId: mode === 'standalone' ? 'omnimux-clip:studio' : 'omnimux-workflow:canvas', panelOpen: true },
      view: { extra: { workspaceId: 'ws_fixture', ...(active ? { clip: {
        mode, workspaceId: 'ws_fixture', nodeId: 'node_a', projectId: 'clip_a',
        title: 'Timeline', revision: 4, durationSec: 3, playheadSec: 1.25,
        selectedClips: [{ id: 'clip_1', trackId: 'video_1', name: 'Subtitle', startSec: 1, endSec: 2 }],
        unlisted: 'file:///private/never-in-context.mp4',
      } } : {}) } },
    })
    let mode = 'canvas'
    let snapshots = 0
    const credentials = windows.attachWindow({
      isAuthenticated: () => true,
      send(event) {
        assert.equal(event.type, 'omnimux:viewport:refresh')
        ++snapshots
        const update = { ...byMode(mode), refreshId: event.payload.requestId }
        void windows.updateWindowViewport(request, update)
        return true
      },
    })
    const request = { headers: { 'x-omnimux-window-proof': credentials.proof } }
    const stale = byMode(mode)
    assert.equal(await windows.updateWindowViewport(request, stale, id => id === 's1'), true)
    let handler
    mountWorkbenchContextInjector({ on(_event, callback) { handler = callback } }, {
      mailbox: { getActiveView: () => ({ uiContext: stale }) }, hubEvents: windows,
    })
    const start = async () => {
      ++now
      const { messages } = await handler({ agent: { session: { id: 's1' } }, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
      return messages.map(message => message.content[0].text).join('\n')
    }
    const first = await start()
    assert.match(first, /mode: canvas.*projectId: clip_a.*revision: 4.*playheadSec: 1\.25.*workspaceId: ws_fixture.*nodeId: node_a/)
    assert.match(first, /selectedClips:.*Subtitle/)
    assert.doesNotMatch(first, /never-in-context/)
    mode = 'standalone'
    assert.match(await start(), /mode: standalone.*projectId: clip_a/)
    mode = 'canvas'
    active = false
    const afterExit = await start()
    assert.match(afterExit, /workspace: ws_fixture/)
    assert.doesNotMatch(afterExit, /clip_a|selectedClips/)
    assert.equal(snapshots, 3)
    credentials.dispose()
  })

  it('creates native DSH context user message with correct snapshot structure', () => {
    const text = '<ui_context schema="1">\ntab: omnimux-assets:library\n</ui_context>'
    const msg = createWorkbenchContextMessage(text)

    assert.equal(msg.role, 'user')
    assert.equal(typeof msg.id, 'string')
    assert.deepEqual(msg.content, [{ type: 'text', text }])
    assert.equal(msg.source.kind, 'omnimux-workbench')
    assert.equal(msg.source.plugin, 'omnimux-workbench')
    assert.equal(msg.source.form, 'snapshot')
    assert.deepEqual(msg.source.sections, [{
      name: 'workbench-viewport',
      text,
    }])
  })

  it('skips injection on step > 1', async () => {
    const listeners = new Map()
    const ctx = {
      on: (ev, fn) => { listeners.set(ev, fn); return () => {} },
    }
    const mailbox = {
      getActiveView: () => ({
        ok: true,
        uiContext: {
          surface: { tabId: 'omnimux-assets:library', panelOpen: true },
        },
      }),
    }

    mountWorkbenchContextInjector(ctx, { mailbox })
    const handler = listeners.get('agent/pre-step')

    const decision = await handler(
      { agent: { session: { id: 's1' } }, turn: 1, step: 2, signal: {} },
      async () => ({ kind: 'enter', messages: [] }),
    )

    assert.equal(decision.messages.length, 0)
  })

  it('skips injection when panel is closed or tabId is missing', async () => {
    const listeners = new Map()
    const ctx = {
      on: (ev, fn) => { listeners.set(ev, fn); return () => {} },
    }
    let panelOpen = false
    let tabId = 'omnimux-assets:library'
    const mailbox = {
      getActiveView: () => ({
        ok: true,
        uiContext: {
          surface: { tabId, panelOpen },
        },
      }),
    }

    mountWorkbenchContextInjector(ctx, { mailbox })
    const handler = listeners.get('agent/pre-step')

    // 1. Panel closed
    const res1 = await handler(
      { agent: { session: { id: 's1' } }, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages: [] }),
    )
    assert.equal(res1.messages.length, 0)

    // 2. TabId empty
    panelOpen = true
    tabId = null
    const res2 = await handler(
      { agent: { session: { id: 's1' } }, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages: [] }),
    )
    assert.equal(res2.messages.length, 0)
  })

  it('injects context message when panel is open on step 1', async () => {
    const listeners = new Map()
    const ctx = {
      on: (ev, fn) => { listeners.set(ev, fn); return () => {} },
    }
    const mailbox = {
      getActiveView: (sessionId) => ({
        ok: true,
        sessionId,
        uiContext: {
          schemaVersion: 1,
          ok: true,
          capturedAt: Date.now(),
          surface: { tabId: 'omnimux-inspiration:library', title: '灵感社区', panelOpen: true, focus: 'split' },
          view: { kind: 'grid' },
        },
      }),
    }

    mountWorkbenchContextInjector(ctx, { mailbox })
    const handler = listeners.get('agent/pre-step')

    const userMsg = { role: 'user', content: [{ type: 'text', text: '分析视频 https://example.com' }] }
    const decision = await handler(
      { agent: { session: { id: 'session-xyz' } }, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages: [userMsg] }),
    )

    assert.equal(decision.messages.length, 2)
    assert.equal(decision.messages[0], userMsg) // Original user message untouched!
    const contextMsg = decision.messages[1]
    assert.equal(contextMsg.source.kind, 'omnimux-workbench')
    assert.equal(contextMsg.source.plugin, 'omnimux-workbench')
    assert.equal(contextMsg.source.form, 'snapshot')
    assert.ok(contextMsg.content[0].text.includes('tab: omnimux-inspiration:library (灵感社区)'))
    assert.ok(contextMsg.content[0].text.includes('panel: open | focus: split'))
  })

  it('injects attached reference context natively while keeping user message pristine', async () => {
    const listeners = new Map()
    const ctx = {
      on: (ev, fn) => { listeners.set(ev, fn); return () => {} },
    }
    const mailbox = {
      getActiveView: (sessionId) => ({
        ok: true,
        sessionId,
        uiContext: {
          schemaVersion: 1,
          ok: true,
          capturedAt: Date.now(),
          surface: { panelOpen: false },
          attachedContextText: '### 会话关联上下文 (Attached Context):\n- [产品] 降噪耳机 (@.omnimux/products/prod_1.json)',
        },
      }),
    }

    mountWorkbenchContextInjector(ctx, { mailbox })
    const handler = listeners.get('agent/pre-step')

    const userMsg = { role: 'user', content: [{ type: 'text', text: '说说你分别收到的' }] }
    const decision = await handler(
      { agent: { session: { id: 'session-clean' } }, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages: [userMsg] }),
    )

    // 验证：用户消息 100% 保持原始文本，且原生注入附件上下文消息
    assert.equal(decision.messages.length, 2)
    assert.equal(decision.messages[0].content[0].text, '说说你分别收到的')
    assert.match(decision.messages[1].content[0].text, /### 会话关联上下文/)
    assert.equal(decision.messages[1].source.kind, 'omnimux-workbench')
    assert.equal(decision.messages[1].source.form, 'snapshot')
  })

  it('carries the recommended action with the material when attached context has a unified reference', async () => {
    const listeners = new Map()
    const ctx = {
      on: (ev, fn) => { listeners.set(ev, fn); return () => {} },
    }
    const attachedContextText = [
      '### 会话关联上下文 (Attached Context):',
      '- [视频] She really woke up and chose GTA-style chaos. (`MP4`): @inspiration/insp_ad704927.mp4',
    ].join('\n')
    const mailbox = {
      getActiveView: (sessionId) => ({
        ok: true,
        sessionId,
        uiContext: {
          schemaVersion: 1,
          ok: true,
          capturedAt: Date.now(),
          surface: { panelOpen: false },
          attachedContextText,
        },
      }),
    }

    mountWorkbenchContextInjector(ctx, { mailbox })
    const handler = listeners.get('agent/pre-step')

    const userMsg = { role: 'user', content: [{ type: 'text', text: '/video-deconstruct 复刻这条爆款视频' }] }
    const decision = await handler(
      { agent: { session: { id: 'session-nav' } }, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages: [userMsg] }),
    )

    // 消息条数与用户气泡保持原状，导航只落在同一条上下文消息内
    assert.equal(decision.messages.length, 2)
    assert.equal(decision.messages[0], userMsg)
    const injected = decision.messages[1].content[0].text
    assert.ok(injected.startsWith(attachedContextText))
    assert.match(injected, /<reference_navigation>/)
    assert.match(injected, /@inspiration\/insp_ad704927\.mp4/)
    assert.match(injected, /video_breakdown_analyze/)
  })

  it('leaves attached context without a unified reference byte-identical', async () => {
    const listeners = new Map()
    const ctx = {
      on: (ev, fn) => { listeners.set(ev, fn); return () => {} },
    }
    const attachedContextText = '### 会话关联上下文 (Attached Context):\n- [产品] 降噪耳机 (@.omnimux/products/prod_1.json)'
    const mailbox = {
      getActiveView: (sessionId) => ({
        ok: true,
        sessionId,
        uiContext: { schemaVersion: 1, ok: true, capturedAt: Date.now(), surface: { panelOpen: false }, attachedContextText },
      }),
    }

    mountWorkbenchContextInjector(ctx, { mailbox })
    const handler = listeners.get('agent/pre-step')

    const decision = await handler(
      { agent: { session: { id: 'session-plain' } }, turn: 1, step: 1, signal: {} },
      async () => ({ kind: 'enter', messages: [] }),
    )

    assert.equal(decision.messages.length, 1)
    assert.equal(decision.messages[0].content[0].text, attachedContextText)
  })
})
