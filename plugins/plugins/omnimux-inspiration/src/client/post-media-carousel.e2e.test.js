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
const sourceEntry = join(here, 'PostMediaCarousel.jsx')
const shimEntry = join(here, '../../tests/fixtures', 'ui-kit-shim.mjs')
const cacheDir = join(here, '.esbuild-cache', 'post-carousel')
let bundleCounter = 0

async function bundleCarousel() {
  mkdirSync(cacheDir, { recursive: true })
  const outFile = join(cacheDir, `post-carousel-${bundleCounter}.mjs`)
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
      name: 'ui-kit-shim',
      setup(build) {
        build.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: shimEntry }))
      },
    }],
  })
  const code = result.outputFiles?.[0]?.text
  if (!code) throw new Error('esbuild produced no bundle for PostMediaCarousel.jsx')
  writeFileSync(outFile, code)
  return outFile
}

const ASSETS = [1, 2, 3].map(number => ({
  id: `media:${number - 1}`,
  index: number - 1,
  label: `图片 ${number}`,
  title: `图片 ${number}`,
  url: `/omnimux/inspiration/media/slides/slide-${number}.jpg`,
}))

async function mountCarousel(options = {}) {
  const module = await import(`${await bundleCarousel()}?mount=${bundleCounter}`)
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', { url: 'http://localhost:3000' })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const opened = []
  const container = dom.window.document.getElementById('host')
  const reactRoot = createRoot(container)
  const t = (key) => zh[key] || key
  await act(async () => {
    reactRoot.render(React.createElement(module.PostMediaCarousel, {
      assets: ASSETS,
      dimensions: {},
      t,
      onOpen: asset => opened.push(asset),
      onDimension: () => {},
      onImageError: () => {},
      onAnalyze: () => {},
      onToggleReference: () => {},
      hasReference: () => false,
      ...options,
    }))
  })
  return {
    document: dom.window.document,
    container,
    opened,
    async click(selector) {
      const node = container.querySelector(selector)
      assert.ok(node, `missing ${selector}`)
      await act(async () => { node.click() })
    },
    async press(key) {
      const node = container.querySelector('.omnimux-post-carousel-viewport')
      await act(async () => {
        node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))
      })
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

describe('PostMediaCarousel render gate — swipeable gallery', () => {
  it('renders every slide and opens the matching asset', async () => {
    const mounted = await mountCarousel()
    try {
      const slides = mounted.container.querySelectorAll('.omnimux-post-carousel-slide')
      assert.equal(slides.length, 3, 'all media_keys slides must reach the carousel')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '1 / 3')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-dot.is-active')?.getAttribute('aria-label'), '图片 1')
      assert.match(mounted.container.querySelector('.omnimux-post-asset-footer')?.textContent || '', /图片 1/)

      await mounted.click('.omnimux-post-carousel-slide:nth-child(2) .omnimux-post-image-open')
      assert.equal(mounted.opened.length, 1)
      assert.equal(mounted.opened[0].label, '图片 2')
    } finally {
      await mounted.unmount()
      mounted.close()
    }
  })

  it('moves with the next button and the dot, keeping the footer on the visible slide', async () => {
    const mounted = await mountCarousel()
    try {
      await mounted.click('button[aria-label="下一张"]')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '2 / 3')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-track')?.style.transform, 'translateX(-100%)')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-dot.is-active')?.getAttribute('aria-label'), '图片 2')
      assert.match(mounted.container.querySelector('.omnimux-post-asset-footer')?.textContent || '', /图片 2/)

      await mounted.click('.omnimux-post-carousel-dot[aria-label="图片 3"]')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '3 / 3')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-track')?.style.transform, 'translateX(-200%)')
    } finally {
      await mounted.unmount()
      mounted.close()
    }
  })

  it('changes slides with the left and right arrow keys', async () => {
    const mounted = await mountCarousel()
    try {
      await mounted.press('ArrowRight')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '2 / 3')
      await mounted.press('ArrowLeft')
      assert.equal(mounted.container.querySelector('.omnimux-post-carousel-counter')?.textContent, '1 / 3')
    } finally {
      await mounted.unmount()
      mounted.close()
    }
  })
})
