import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const require = createRequire(import.meta.url)

const EXPECTED_LABELS = ['全部', '视频创作', '爆款复刻', '商品视觉', '市场洞察', '营销增长', '效率工具']

const FIXTURE_HTML = `
<!doctype html>
<html>
  <body>
    <div id="root"><div id="seat"></div></div>
  </body>
</html>
`

function withDom(html) {
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Event = dom.window.Event
  globalThis.MouseEvent = dom.window.MouseEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return {
    restore() {
      globalThis.window = previous.window
      globalThis.document = previous.document
      globalThis.HTMLElement = previous.HTMLElement
      globalThis.Event = previous.Event
      globalThis.MouseEvent = previous.MouseEvent
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
      dom.window.close()
    },
  }
}

async function loadComponent(entry) {
  const output = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react'],
    loader: { '.json': 'json' },
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

test('e2e: 会话引导 SkillsPanel 分类胶囊仅展示名称，不渲染数字统计角标', async () => {
  const { SkillsPanel } = await loadComponent('../../src/client/session-guide/skills/SkillsPanel.jsx')
  const env = withDom(FIXTURE_HTML)
  const host = document.querySelector('#root')
  const root = createRoot(host.querySelector('#seat'))

  const labels = new Map([
    ['skills.chips.label', '技能分类筛选'],
    ['skills.category.all', '全部'],
  ])

  try {
    await act(async () => {
      root.render(React.createElement(SkillsPanel, {
        t: (key, fallback) => labels.get(key) || fallback || key,
        onSelectSkill: () => {},
      }))
    })

    const chips = Array.from(host.querySelectorAll('.omnimux-skills-chip'))
    assert.equal(chips.length, 7, '应渲染 1 个全部 + 6 个垂直场景胶囊')
    assert.equal(host.querySelectorAll('.omnimux-skills-chip-count').length, 0, '不得渲染 .omnimux-skills-chip-count 数字角标')

    const actualLabels = chips.map((chip) => chip.textContent.trim())
    assert.deepEqual(actualLabels, EXPECTED_LABELS, '分类胶囊文本应仅包含名称，不包含计数数字')
    for (const label of actualLabels) {
      assert.equal(/\d/.test(label), false, `分类胶囊 "${label}" 不得包含数字`)
    }

    const stylesSource = readFileSync(new URL('../../src/client/session-guide/styles.js', import.meta.url), 'utf8')
    assert.equal(stylesSource.includes('.omnimux-skills-chip-count'), false, 'styles.js 不得残留无用 .omnimux-skills-chip-count 样式')
  } finally {
    await act(async () => { root.unmount() })
    env.restore()
  }
})
