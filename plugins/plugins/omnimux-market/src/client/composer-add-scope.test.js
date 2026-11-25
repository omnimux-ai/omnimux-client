import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'css.js'), 'utf8')
const match = /const CSS = `([\s\S]*?)`;/.exec(source)
assert.ok(match, 'omnimux-market css.js must contain CSS template')
const cssText = match[1]

test('composer add-button rules are scoped to [data-composer-card] and never leak globally', () => {
  const occurrences = [...cssText.matchAll(/button\[class\*="add"\]/g)]
  assert.ok(occurrences.length >= 4, `expected composer add rules, got ${occurrences.length}`)

  for (const hit of occurrences) {
    const prefix = cssText.slice(Math.max(0, hit.index - 24), hit.index)
    assert.match(
      prefix,
      /\[data-composer-card\]\s+$/,
      `bare global button[class*="add"] leaks into other plugins; prefix was ${JSON.stringify(prefix)}`,
    )
  }
})

test('CSS cascade: market styles apply inside [data-composer-card] and .Q7WfXG_add without affecting canvas primary-add', () => {
  const pluginsRequire = createRequire(join(here, '../../../../package.json'))
  const { JSDOM } = pluginsRequire('jsdom')
  const dom = new JSDOM(
    `<!doctype html><html><head><style>
      .wf-canvas-toolbar__item--primary-add { width: 40px; height: 40px; border-radius: 50%; background: rgb(255, 255, 255); }
      ${cssText}
    </style></head><body>
      <div data-composer-card>
        <button type="button" class="composer_add"><svg></svg></button>
      </div>
      <button type="button" class="Q7WfXG_add"><svg></svg></button>
      <div class="wf-canvas-root">
        <button type="button" class="wf-canvas-toolbar__item wf-canvas-toolbar__item--primary-add"><svg></svg></button>
      </div>
    </body></html>`,
    { url: 'http://127.0.0.1/' },
  )

  try {
    const { window } = dom
    const composerAdd = window.document.querySelector('[data-composer-card] button.composer_add')
    const legacyQ7Add = window.document.querySelector('button.Q7WfXG_add')
    const canvasAdd = window.document.querySelector('button.wf-canvas-toolbar__item--primary-add')

    assert.equal(window.getComputedStyle(composerAdd).width, '28px')
    assert.equal(window.getComputedStyle(composerAdd).height, '28px')
    assert.equal(window.getComputedStyle(legacyQ7Add).width, '28px')

    assert.equal(window.getComputedStyle(canvasAdd).width, '40px')
    assert.equal(window.getComputedStyle(canvasAdd).height, '40px')
    assert.equal(window.getComputedStyle(canvasAdd).borderRadius, '50%')
    assert.equal(window.getComputedStyle(canvasAdd).backgroundColor, 'rgb(255, 255, 255)')
  } finally {
    dom.window.close()
  }
})
