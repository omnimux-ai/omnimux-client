import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { DOM_RENDER_LOADERS } from '../../tests/fixtures/dom-render-build.mjs'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { zh } from './locales.js'
import { detectPostVariant, headlessStageLocaleKey, matchHeadlessSkillEvent } from './post-detail.js'
import { IMPORT_POLL_INTERVAL_MS } from './import-status.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const sectionEntry = join(here, 'InspirationSection.jsx')
const detailEntry = join(here, 'InspirationPostDetail.jsx')
const shimEntry = join(here, '../../tests/fixtures', 'ui-kit-shim.mjs')
const cacheDir = join(here, '.esbuild-cache', 'sidebar-views')

let bundleSeq = 0

async function bundleEntry(entryPath, prefix) {
  mkdirSync(cacheDir, { recursive: true })
  const outFile = join(cacheDir, `${prefix}-${bundleSeq}.mjs`)
  bundleSeq += 1
  const result = await esbuild.build({
    loader: DOM_RENDER_LOADERS,
    absWorkingDir: join(here, '..', '..'),
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    plugins: [{
      name: 'ui-kit-shim',
      setup(build) {
        build.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: shimEntry }))
      },
    }],
  })
  const code = result.outputFiles?.[0]?.text
  if (!code) throw new Error(`esbuild produced no bundle for ${entryPath}`)
  writeFileSync(outFile, code)
  return outFile
}

after(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('post-detail polymorphic & hubEvents helpers (#211)', () => {
  it('classifies video, carousel, single image, text-only and empty items', () => {
    assert.equal(
      detectPostVariant({ media_items: [{ type: 'video', url: '/omnimux/inspiration/media/v.mp4' }] }),
      'video',
    )
    assert.equal(
      detectPostVariant({
        media_items: [
          { type: 'image', url: '/omnimux/inspiration/media/a.jpg' },
          { type: 'image', url: '/omnimux/inspiration/media/b.jpg' },
        ],
      }),
      'carousel',
    )
    assert.equal(
      detectPostVariant({ media_items: [{ type: 'image', url: '/omnimux/inspiration/media/a.jpg' }] }),
      'image',
    )
    assert.equal(detectPostVariant({ content: '纯文案帖子正文' }), 'text')
    assert.equal(detectPostVariant({}), 'empty')
  })

  it('filters omnimux:headless-skill events by ownerPlugin and item targetId', () => {
    assert.equal(matchHeadlessSkillEvent({ type: 'other', payload: {} }, 'item-1'), null)
    assert.equal(
      matchHeadlessSkillEvent({
        type: 'omnimux:headless-skill',
        payload: { ownerPlugin: 'omnimux-products', targetId: 'item-1:post', status: 'running', stage: 'executing' },
      }, 'item-1'),
      null,
    )
    assert.equal(
      matchHeadlessSkillEvent({
        type: 'omnimux:headless-skill',
        payload: { ownerPlugin: 'omnimux-inspiration', targetId: 'item-1:translate:body', status: 'running', stage: 'executing' },
      }, 'item-1'),
      null,
    )
    const matched = matchHeadlessSkillEvent({
      type: 'omnimux:headless-skill',
      payload: {
        jobId: 'job-42',
        ownerPlugin: 'omnimux-inspiration',
        targetId: 'item-1:media:0',
        status: 'repairing',
        stage: 'repairing-schema',
        model: 'gpt-4o',
      },
    }, 'item-1')
    assert.deepEqual(matched, {
      targetKey: 'media:0',
      status: 'repairing',
      stage: 'repairing-schema',
      jobId: 'job-42',
      model: 'gpt-4o',
      error: '',
      errorCode: '',
      terminal: false,
    })
    assert.equal(headlessStageLocaleKey(matched.stage, matched.status), 'post.stage.repairing-schema')
    assert.equal(headlessStageLocaleKey('preparing-media', 'running'), 'post.stage.preparing-media')
  })
})

describe('InspirationSection gallery/list dual views & docked polymorphic sidebar (#211)', () => {
  it('switches between gallery and list views, opens docked polymorphic sidebar without middle dots, and expands to modal', async () => {
    const mod = await import(`${await bundleEntry(sectionEntry, 'section')}?m=${bundleSeq}`)
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', {
      url: 'http://localhost:3000',
    })
    const prev = {
      window: globalThis.window,
      document: globalThis.document,
      fetch: globalThis.fetch,
      IntersectionObserver: globalThis.IntersectionObserver,
      ResizeObserver: globalThis.ResizeObserver,
      act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    dom.window.__omnimuxAuth = { ensureLogin() {} }
    globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

    const items = [
      {
        id: 'vid-1',
        title: '爆款短视频素材',
        content: '黄金三秒开场钩子拆解',
        source_platform: 'tiktok',
        type: 'video',
        is_local: true,
        cover_key: '/omnimux/inspiration/media/vid-1.jpg',
        media_items: [{ type: 'video', url: '/omnimux/inspiration/media/vid-1.mp4' }],
        stats: { views: 12500 },
        created_at: new Date().toISOString(),
        analysis_results: {
          post: {
            scope: 'post',
            status: 'done',
            source: 'live',
            model: 'test-vlm',
            result: { summary: '结构化拆解摘要', sections: [{ id: 'hook', title: '开场钩子', analysis: '前两秒制造冲突' }], shots: [] },
          },
        },
      },
      {
        id: 'txt-2',
        title: '纯文案运营复盘',
        content: '这是一段用于列表与右侧停靠栏多态展示的纯文案灵感正文内容。',
        source_platform: 'x',
        type: 'text',
        is_local: true,
        created_at: new Date().toISOString(),
      },
      {
        id: 'car-3',
        title: '小红书多图轮播笔记',
        content: '五张对比图展示步骤',
        source_platform: 'xiaohongshu',
        type: 'image',
        is_local: true,
        cover_key: '/omnimux/inspiration/media/c1.jpg',
        media_items: [
          { type: 'image', url: '/omnimux/inspiration/media/c1.jpg' },
          { type: 'image', url: '/omnimux/inspiration/media/c2.jpg' },
        ],
        created_at: new Date().toISOString(),
      },
    ]

    globalThis.fetch = async (url) => {
      const text = String(url)
      if (text.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      if (text.includes('/omnimux/inspiration/local/collections')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [] } }) }
      }
      const itemMatch = text.match(/\/omnimux\/inspiration\/local\/([^/?]+)$/)
      if (itemMatch) {
        const found = items.find((entry) => entry.id === itemMatch[1])
        return found
          ? { ok: true, status: 200, json: async () => ({ success: true, data: found }) }
          : { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
      }
      if (text.includes('/omnimux/inspiration/local')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              items,
              total: items.length,
              platforms: [{ name: 'tiktok', count: 1 }, { name: 'x', count: 1 }, { name: 'xiaohongshu', count: 1 }],
            },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items, total: items.length } }) }
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    const t = (key) => zh[key] || key

    try {
      await act(async () => {
        root.render(React.createElement(mod.InspirationSection, { t, active: true }))
      })
      for (let i = 0; i < 40; i += 1) {
        if (container.querySelector('.omnimux-inspiration-grid')) break
        await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
      }

      // 1. Default gallery view renders masonry without middle dots in card metadata
      assert.ok(container.querySelector('.omnimux-inspiration-grid'), 'gallery view should render by default')
      assert.equal(container.querySelector('.omnimux-inspiration-list'), null)
      for (const meta of container.querySelectorAll('.omnimux-inspiration-card-meta')) {
        assert.equal(meta.textContent.includes('·'), false, `card meta must not contain middle dot: ${meta.textContent}`)
      }

      // 2. Switch to compact list view via toolbar toggle
      const listBtn = container.querySelector(`button[aria-label="${zh['feedView.list']}"]`)
      assert.ok(listBtn, 'toolbar must expose list view toggle')
      await act(async () => { listBtn.click() })
      assert.ok(container.querySelector('.omnimux-inspiration-list'), 'list view must render')
      assert.equal(container.querySelector('.omnimux-inspiration-grid'), null)
      assert.equal(dom.window.localStorage.getItem('omnimux-inspiration:view-mode'), 'list')

      const rows = [...container.querySelectorAll('.omnimux-inspiration-list-row')]
      assert.equal(rows.length, 3)
      for (const rowNode of rows) {
        assert.equal(rowNode.textContent.includes('·'), false, `list row must not contain middle dot: ${rowNode.textContent}`)
      }

      // 3. Click video row -> opens docked sidebar in video variant (not full-screen modal)
      await act(async () => { rows[0].click() })
      let sidebar = container.querySelector('.omnimux-inspiration-detail-sidebar')
      assert.ok(sidebar, 'clicking a list row must open the docked detail sidebar')
      assert.equal(container.querySelector('.omnimux-inspiration-modal-backdrop'), null, 'must not open blocking full-screen modal')
      assert.equal(sidebar.getAttribute('data-post-variant'), 'video')
      assert.equal(rows[0].getAttribute('data-active'), 'true')
      assert.equal(sidebar.textContent.includes('·'), false, `sidebar content must not contain middle dot: ${sidebar.textContent}`)

      // 4. Click text row -> switches sidebar polymorphically to text variant without closing
      await act(async () => { rows[1].click() })
      sidebar = container.querySelector('.omnimux-inspiration-detail-sidebar')
      assert.ok(sidebar)
      assert.equal(sidebar.getAttribute('data-post-variant'), 'text')
      assert.equal(sidebar.getAttribute('data-item-id'), 'txt-2')
      assert.equal(rows[1].getAttribute('data-active'), 'true')

      // 5. Click carousel row -> switches sidebar to carousel variant without middle dots
      await act(async () => { rows[2].click() })
      sidebar = container.querySelector('.omnimux-inspiration-detail-sidebar')
      assert.ok(sidebar)
      assert.equal(sidebar.getAttribute('data-post-variant'), 'carousel')
      assert.equal(sidebar.querySelector('.omnimux-post-carousel-chip')?.textContent, `${zh['post.carousel']} 2`)

      // 6. Click expand-to-modal button -> promotes to InspirationPreviewModal cleanly
      const expandBtn = sidebar.querySelector(`button[aria-label="${zh['sidebar.expandModal']}"]`)
      assert.ok(expandBtn)
      await act(async () => { expandBtn.click() })
      assert.equal(container.querySelector('.omnimux-inspiration-detail-sidebar'), null)
      assert.ok(container.querySelector('.omnimux-inspiration-modal-backdrop'), 'expand button must open full modal')
    } finally {
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.IntersectionObserver = prev.IntersectionObserver
      globalThis.ResizeObserver = prev.ResizeObserver
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })
})

describe('InspirationPostDetail hubEvents live stage & cancel (#211)', () => {
  it('streams headless stages without blind polling when hubEvents is healthy, supports cancel, and falls back on disconnect', async () => {
    const mod = await import(`${await bundleEntry(detailEntry, 'detail')}?m=${bundleSeq}`)
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', {
      url: 'http://localhost:3000',
    })
    const prev = {
      window: globalThis.window,
      document: globalThis.document,
      fetch: globalThis.fetch,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    const pollTimers = new Map()
    globalThis.setTimeout = (fn, ms, ...args) => {
      if (ms !== IMPORT_POLL_INTERVAL_MS) return prev.setTimeout(fn, ms, ...args)
      const token = {}
      pollTimers.set(token, () => fn(...args))
      return token
    }
    globalThis.clearTimeout = (token) => {
      if (pollTimers.delete(token)) return
      prev.clearTimeout(token)
    }

    const listeners = new Set()
    let healthy = true
    const emitHubEvent = (ev) => {
      for (const listener of [...listeners]) listener(ev)
    }
    dom.window.__omnimuxHubEvents = {
      isHealthy: () => healthy,
      subscribe: (_topic, fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }

    let item = {
      id: 'live-1',
      title: '无头分析测试项',
      content: '测试正文内容',
      is_local: true,
      analysis_results: {
        post: { scope: 'post', directions: ['content', 'expression', 'creative'], status: 'running', source: 'live', result: null },
      },
    }
    const cancelCalls = []
    let getCalls = 0
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      if (text.endsWith('/analyze/cancel') && init.method === 'POST') {
        cancelCalls.push(JSON.parse(init.body || '{}'))
        item = {
          ...item,
          analysis_results: {
            post: { ...item.analysis_results.post, status: 'failed', error: '分析已取消，可重新分析' },
          },
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, cancelled: ['job-99'], data: item }) }
      }
      if (text.endsWith(`/omnimux/inspiration/local/${item.id}`)) {
        getCalls += 1
        return { ok: true, status: 200, json: async () => ({ data: structuredClone(item) }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: item }) }
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    const t = (key) => zh[key] || key
    const renderDetail = async (nextItem) => {
      await act(async () => {
        root.render(React.createElement(mod.InspirationPostDetail, {
          item: nextItem,
          t,
          mode: 'sidebar',
          onItemUpdated: (updated) => {
            item = updated
            root.render(React.createElement(mod.InspirationPostDetail, {
              item: updated,
              t,
              mode: 'sidebar',
              onItemUpdated: () => {},
            }))
          },
        }))
        await new Promise((r) => prev.setTimeout(r, 0))
      })
    }

    try {
      await renderDetail(item)
      assert.equal(getCalls, 1, 'initial mount performs one authoritative read')
      assert.equal(pollTimers.size, 0, 'healthy hubEvents must NOT schedule blind poll timers')

      // Push live stages over hubEvents
      await act(async () => {
        emitHubEvent({
          type: 'omnimux:headless-skill',
          payload: {
            jobId: 'job-99',
            ownerPlugin: 'omnimux-inspiration',
            targetId: 'live-1:post',
            status: 'running',
            stage: 'preparing-media',
          },
        })
      })
      assert.equal(container.querySelector('.omnimux-post-live-stage')?.textContent, zh['post.stage.preparing-media'])

      await act(async () => {
        emitHubEvent({
          type: 'omnimux:headless-skill',
          payload: {
            jobId: 'job-99',
            ownerPlugin: 'omnimux-inspiration',
            targetId: 'live-1:post',
            status: 'repairing',
            stage: 'repairing-schema',
          },
        })
      })
      assert.equal(container.querySelector('.omnimux-post-live-stage')?.textContent, zh['post.stage.repairing-schema'])
      assert.equal(pollTimers.size, 0, 'still zero blind poll timers while hubEvents streams stages')

      // Click cancel button -> hits /analyze/cancel with active job_id and scope
      const cancelBtn = [...container.querySelectorAll('.omnimux-post-analysis button')]
        .find((node) => node.textContent.trim() === zh['post.cancelAnalysis'])
      assert.ok(cancelBtn, 'cancel button must be available while analysis is running')
      await act(async () => {
        cancelBtn.click()
        await new Promise((r) => prev.setTimeout(r, 0))
      })
      assert.equal(cancelCalls.length, 1)
      assert.deepEqual(cancelCalls[0], { scope: 'post', job_id: 'job-99' })

      // Simulate hubEvents disconnect while another run is active -> fallback poller activates
      item = {
        ...item,
        analysis_results: {
          post: { scope: 'post', directions: ['content', 'expression', 'creative'], status: 'running', source: 'live', result: null },
        },
      }
      await renderDetail(item)
      await act(async () => {
        healthy = false
        emitHubEvent({ type: 'omnimux:disconnected' })
      })
      assert.ok(pollTimers.size > 0, 'disconnect must engage fallback polling while analysis runs')

      // Reconnect stops fallback polling and terminal event fetches persisted result once
      await act(async () => {
        healthy = true
        emitHubEvent({ type: 'omnimux:connected' })
      })
      assert.equal(pollTimers.size, 0, 'reconnecting hubEvents must stop fallback poll timer')

      const beforeTerminalReads = getCalls
      item = {
        ...item,
        analysis_results: {
          post: {
            scope: 'post',
            directions: ['content', 'expression', 'creative'],
            status: 'done',
            source: 'live',
            model: 'headless-vlm',
            result: { summary: '事件驱动更新成功', sections: [], shots: [] },
          },
        },
      }
      await act(async () => {
        emitHubEvent({
          type: 'omnimux:headless-skill',
          payload: {
            jobId: 'job-100',
            ownerPlugin: 'omnimux-inspiration',
            targetId: 'live-1:post',
            status: 'done',
            stage: 'done',
          },
        })
        await new Promise((r) => prev.setTimeout(r, 0))
      })
      assert.equal(getCalls, beforeTerminalReads + 1, 'terminal event triggers one authoritative GET refresh')
    } finally {
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.setTimeout = prev.setTimeout
      globalThis.clearTimeout = prev.clearTimeout
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })
})
