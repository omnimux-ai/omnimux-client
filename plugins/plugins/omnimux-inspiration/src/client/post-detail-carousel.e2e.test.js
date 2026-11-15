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

const here = fileURLToPath(new URL('.', import.meta.url))
const sourceEntry = join(here, 'InspirationPostDetail.jsx')
const shimEntry = join(here, '../../tests/fixtures', 'ui-kit-shim.mjs')
const apiStubEntry = join(here, '../../tests/fixtures', 'post-detail-api-stub.mjs')
const cacheDir = join(here, '.esbuild-cache', 'post-detail-carousel')
let bundleCounter = 0

async function bundleDetail() {
  mkdirSync(cacheDir, { recursive: true })
  const outFile = join(cacheDir, `detail-${bundleCounter}.mjs`)
  bundleCounter += 1
  const result = await esbuild.build({
    loader: DOM_RENDER_LOADERS,
    absWorkingDir: join(here, '..', '..'),
    entryPoints: [sourceEntry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    plugins: [{
      name: 'render-fixtures',
      setup(build) {
        build.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: shimEntry }))
        build.onResolve({ filter: /\/api\.js$/ }, args => (
          /(?:InspirationPostDetail\.jsx|\/post-detail\.js)$/.test(args.importer) ? { path: apiStubEntry } : null
        ))
      },
    }],
  })
  const code = result.outputFiles?.[0]?.text
  if (!code) throw new Error('esbuild produced no bundle for InspirationPostDetail.jsx')
  writeFileSync(outFile, code)
  return outFile
}

const KEYS = [1, 2, 3].map(number => `/omnimux/inspiration/media/r2/slides/slide-${number}.jpg`)

async function mountDetail() {
  const module = await import(`${await bundleDetail()}?mount=${bundleCounter}`)
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', { url: 'http://localhost:3000' })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = dom.window.document.getElementById('host')
  const reactRoot = createRoot(container)
  const t = (key) => zh[key] || key
  await act(async () => {
    reactRoot.render(React.createElement(module.InspirationPostDetail, {
      item: {
        id: '907',
        type: 'image',
        content_shape: 'gallery',
        title: 'glow up secrets dialogue series',
        content: '#beauty #beautytips',
        media_keys: KEYS,
        is_local: false,
      },
      t,
      onClose: () => {},
    }))
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (container.querySelector('.omnimux-post-carousel')) break
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  }
  return {
    container,
    async click(selector) {
      const node = container.querySelector(selector)
      assert.ok(node, `missing ${selector}`)
      await act(async () => { node.click() })
    },
    async unmount() {
      await act(async () => reactRoot.unmount())
      globalThis.window = previousWindow
      globalThis.document = previousDocument
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    },
    close() { dom.window.close() },
  }
}

after(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('InspirationPostDetail carousel integration', () => {
  it('renders media_keys as a carousel and lets the lightbox step between images', async () => {
    const mounted = await mountDetail()
    try {
      assert.equal(mounted.container.querySelectorAll('.omnimux-post-carousel-slide').length, 3)
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '1 / 3')

      await mounted.click('button[aria-label="下一张"]')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '2 / 3')

      await mounted.click('.omnimux-post-carousel-slide:nth-child(2) .omnimux-post-image-open')
      const lightbox = mounted.container.querySelector('.omnimux-post-lightbox')
      assert.ok(lightbox, 'clicking the current slide must open the lightbox')
      assert.match(lightbox.textContent || '', /图片 2/)
      assert.equal(lightbox.querySelector('.omnimux-post-lightbox-counter')?.textContent, '2 / 3')

      await mounted.click('.omnimux-post-lightbox [aria-label="下一张"]')
      assert.match(lightbox.textContent || '', /图片 3/)
      assert.equal(lightbox.querySelector('.omnimux-post-lightbox-counter')?.textContent, '3 / 3')
    } finally {
      await mounted.unmount()
      mounted.close()
    }
  })
})
