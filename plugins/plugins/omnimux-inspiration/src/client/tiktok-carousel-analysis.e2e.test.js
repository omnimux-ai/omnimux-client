import '../../tests/fixtures/dom-bootstrap.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { zh } from './locales.js'
import { DOM_RENDER_LOADERS } from '../../tests/fixtures/dom-render-build.mjs'
import { uiKitShimPlugin } from '../../tests/fixtures/ui-kit-shim-plugin.mjs'
import { createLocalStore } from '../local-store.js'
import { createLocalInspirationDispatcher } from '../http-routes.js'
import { createSocialFetcher } from '../index.js'
import { createInspirationCatalogApi } from '../../../omnimux/src/official/inspiration.js'
import { resolveSocialDataModel } from '../../../omnimux/src/official/social-data.js'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const zhMap = new Map(Object.entries(zh))
const t = (key) => zhMap.get(key) || key
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

async function loadSidebar() {
  const result = await build({
    absWorkingDir: join(here, '../..'),
    stdin: {
      contents: `export { InspirationDetailSidebar } from './src/client/InspirationDetailSidebar.jsx'`,
      resolveDir: join(here, '../..'),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    loader: DOM_RENDER_LOADERS,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    plugins: [uiKitShimPlugin],
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports.InspirationDetailSidebar
}

function makePaths(tmp) {
  return {
    dir: tmp,
    libraryFile: join(tmp, 'library.json'),
    mediaDir: join(tmp, 'media'),
    coversDir: join(tmp, 'media', 'covers'),
    videosDir: join(tmp, 'media', 'videos'),
    imagesDir: join(tmp, 'media', 'images'),
  }
}

async function waitForCondition(check, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
  }
  assert.ok(check(), `timed out waiting for: ${label}`)
}

describe('TikTok photo carousel cloud analysis E2E (#454)', () => {
  const tempDirs = []

  after(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  })

  it('Belt 2: localizes a 6-slide cloud TikTok carousel via inspirationCatalog without calling socialFetcher and renders analysis', async () => {
    const InspirationDetailSidebar = await loadSidebar()
    const tmp = mkdtempSync(join(tmpdir(), 'omnimux-e2e-belt2-'))
    tempDirs.push(tmp)
    const store = createLocalStore({ paths: makePaths(tmp) })

    let socialFetcherCalls = 0
    const analyzeRequests = []
    const importRequests = []
    const headlessCalls = []

    const catalog = createInspirationCatalogApi({
      client: {
        withPat: async () => ({
          success: true,
          data: {
            item: {
              id: 'cloud_kateestills_6slides',
              type: 'image',
              content_shape: 'gallery',
              title: 'Relationship Mindset Shift: Red Fl...',
              content: 'social media convinced me that these were red flags',
              source_platform: 'tiktok',
              source_url: 'https://www.tiktok.com/@kateestills/photo/7555186216296008990?is_from_webapp=1',
              cover_key: '/api/inspiration/v1/media/kate/slide1.jpg',
              media_keys: Array.from({ length: 6 }, (_, i) => `/api/inspiration/v1/media/kate/slide${i + 1}.jpg`),
              author: { name: 'kateestills', handle: 'kateestills' },
            },
          },
        }),
        withPatRaw: async () => new Response(JPEG_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
      },
    })

    const dispatcher = createLocalInspirationDispatcher({
      localStore: store,
      inspirationCatalog: () => catalog,
      socialFetcher: async () => {
        socialFetcherCalls += 1
        throw new Error('socialFetcher must not be called when catalog localization succeeds')
      },
      headlessSkill: () => ({
        run: async (args) => {
          headlessCalls.push(args)
          return {
            mode: 'live',
            model: 'test-vlm',
            data: {
              summary: '6张轮播图文并茂分析完成',
              sections: [
                { key: 'content', title: '内容理解', summary: '6张轮播图文并茂分析完成', points: ['第一视角叙事'] },
              ],
              shots: [],
            },
          }
        },
      }),
    })

    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://127.0.0.1:4199/' })
    const prev = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url)
      if (target.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      const parsedBody = init.body ? JSON.parse(init.body) : undefined
      if (target.endsWith('/omnimux/inspiration/local/import-url') && init.method === 'POST') {
        importRequests.push(parsedBody)
      }
      if (/\/omnimux\/inspiration\/local\/[^/]+\/analyze$/.test(target) && init.method === 'POST') {
        analyzeRequests.push(parsedBody)
      }
      const res = await dispatcher.dispatch({
        method: init.method || 'GET',
        url: target,
        body: parsedBody,
      })
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body }
    }

    let currentRow = {
      id: 'cloud_kateestills_6slides',
      is_local: false,
      type: 'image',
      content_shape: 'gallery',
      source_platform: 'tiktok',
      source_url: 'https://www.tiktok.com/@kateestills/photo/7555186216296008990?is_from_webapp=1',
      title: 'Relationship Mindset Shift: Red Fl...',
      content: 'social media convinced me that these were red flags',
      cover_key: '/omnimux/inspiration/media/kate/slide1.jpg',
      media_keys: Array.from({ length: 6 }, (_, i) => `/omnimux/inspiration/media/kate/slide${i + 1}.jpg`),
      author: { name: 'kateestills', handle: 'kateestills' },
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    const renderSidebar = () => {
      root.render(React.createElement(InspirationDetailSidebar, {
        key: String(currentRow.source_url || currentRow.id),
        row: currentRow,
        t,
        onClose: () => {},
        onExpandModal: () => {},
        onItemUpdated: (next) => {
          currentRow = next
          renderSidebar()
        },
      }))
    }

    try {
      await act(async () => {
        renderSidebar()
        await new Promise((r) => setTimeout(r, 15))
      })

      const analyzeBtn = [...container.querySelectorAll('.omnimux-post-analysis button')]
        .find((node) => node.textContent.trim() === zh['post.analyzeTarget'])
      assert.ok(analyzeBtn, '开始分析 button must render for cloud TikTok carousel')

      await act(async () => {
        analyzeBtn.click()
      })
      await waitForCondition(
        () => analyzeRequests.length === 1 && container.textContent.includes('6张轮播图文并茂分析完成'),
        'Belt 2 analysis summary rendered',
      )

      assert.equal(importRequests.length, 1)
      assert.equal(importRequests[0].cloud_id, 'cloud_kateestills_6slides')
      assert.equal(importRequests[0].url, 'https://www.tiktok.com/@kateestills/photo/7555186216296008990?is_from_webapp=1')
      assert.equal(socialFetcherCalls, 0)
      assert.equal(analyzeRequests.length, 1)
      assert.equal(analyzeRequests[0].scope, 'post')
      assert.equal(headlessCalls.length, 1)
      assert.equal(headlessCalls[0].references.length, 6)
      assert.notEqual(currentRow.id, 'cloud_kateestills_6slides')
      assert.notEqual(currentRow.is_local, false)
      assert.equal(currentRow.type, 'image')
      assert.equal(currentRow.content_shape, 'gallery')
      assert.equal(currentRow.media_items.length, 6)
      assert.equal(store.get(currentRow.id)?.media_items.length, 6)
      assert.equal(dom.window.document.querySelector('[role="alert"]'), null)
      assert.match(container.textContent, /6张轮播图文并茂分析完成/)
    } finally {
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })

  it('Belt 1: falls back to real socialFetcher + resolveSocialDataModel on /photo/ carousel when cloud catalog fails', async () => {
    const InspirationDetailSidebar = await loadSidebar()
    const tmp = mkdtempSync(join(tmpdir(), 'omnimux-e2e-belt1-'))
    tempDirs.push(tmp)
    const store = createLocalStore({ paths: makePaths(tmp) })

    const resolvedModels = []
    const socialFetcher = createSocialFetcher({
      resolveSocialData: () => ({
        fetch: async ({ platform, capability, url }) => {
          const resolved = resolveSocialDataModel({ platform, capability, url })
          resolvedModels.push(resolved)
          return {
            platform,
            capability,
            data: {
              data: {
                aweme_detail: {
                  aweme_type: 150,
                  desc: 'Fallback carousel content',
                  statistics: { digg_count: 1000, comment_count: 50 },
                  video: {
                    play_addr: { url_list: ['https://v16-webapp.tiktokcdn.com/bgm-only.mp3'] },
                    cover: { url_list: ['https://p16-sign.tiktokcdn.com/cover.heic', 'https://p16-sign.tiktokcdn.com/cover.jpeg'] },
                  },
                  image_post_info: {
                    images: [
                      { display_image: { url_list: ['https://p16-sign.tiktokcdn.com/slide1.heic', 'https://p16-sign.tiktokcdn.com/slide1.jpeg'] } },
                      { display_image: { url_list: ['https://p16-sign.tiktokcdn.com/slide2.jpeg'] } },
                    ],
                  },
                },
              },
            },
          }
        },
      }),
    })

    const dispatcher = createLocalInspirationDispatcher({
      localStore: store,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      fetcher: async () => ({ ok: true, status: 200, arrayBuffer: async () => JPEG_BYTES }),
      inspirationCatalog: () => ({
        getItem: async () => { throw new Error('catalog edge unavailable') },
        fetchMedia: async () => { throw new Error('unreachable') },
      }),
      socialFetcher,
      headlessSkill: () => ({
        run: async () => ({
          mode: 'live',
          model: 'test-vlm',
          data: {
            summary: '回退解析轮播分析完成',
            sections: [{ key: 'content', title: '内容理解', summary: '回退解析轮播分析完成', points: ['跳过 HEIC 与 BGM'] }],
            shots: [],
          },
        }),
      }),
    })

    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://127.0.0.1:4199/' })
    const prev = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    globalThis.fetch = async (url, init = {}) => {
      const target = String(url)
      if (target.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      const parsedBody = init.body ? JSON.parse(init.body) : undefined
      const res = await dispatcher.dispatch({
        method: init.method || 'GET',
        url: target,
        body: parsedBody,
      })
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body }
    }

    let currentRow = {
      id: 'cloud_kateestills_fallback',
      is_local: false,
      type: 'image',
      content_shape: 'gallery',
      source_platform: 'tiktok',
      source_url: 'https://www.tiktok.com/@kateestills/photo/7555186216296008990',
      title: 'Relationship Mindset Shift: Red Fl...',
      content: 'Fallback carousel content',
      cover_key: '/omnimux/inspiration/media/kate/cover.jpg',
      media_keys: ['/omnimux/inspiration/media/kate/s1.jpg', '/omnimux/inspiration/media/kate/s2.jpg'],
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    const renderSidebar = () => {
      root.render(React.createElement(InspirationDetailSidebar, {
        key: String(currentRow.source_url || currentRow.id),
        row: currentRow,
        t,
        onClose: () => {},
        onExpandModal: () => {},
        onItemUpdated: (next) => {
          currentRow = next
          renderSidebar()
        },
      }))
    }

    try {
      await act(async () => {
        renderSidebar()
        await new Promise((r) => setTimeout(r, 15))
      })

      const analyzeBtn = [...container.querySelectorAll('.omnimux-post-analysis button')]
        .find((node) => node.textContent.trim() === zh['post.analyzeTarget'])
      assert.ok(analyzeBtn, '开始分析 button must render for fallback carousel test')

      await act(async () => {
        analyzeBtn.click()
      })
      await waitForCondition(
        () => resolvedModels.length === 1 && container.textContent.includes('回退解析轮播分析完成'),
        'Belt 1 fallback analysis summary rendered',
      )

      assert.equal(resolvedModels.length, 1)
      assert.equal(resolvedModels[0].model, 'tiktok-video')
      assert.equal(resolvedModels[0].field, 'aweme_id')
      assert.equal(resolvedModels[0].value, '7555186216296008990')
      assert.equal(currentRow.type, 'image')
      assert.equal(currentRow.content_shape, 'gallery')
      assert.equal(currentRow.media_items.length, 2)
      assert.equal(dom.window.document.querySelector('[role="alert"]'), null)
      assert.match(container.textContent, /回退解析轮播分析完成/)
    } finally {
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })
})
