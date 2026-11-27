import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { guideZh, guideEn } from '../catalog.js'

const require = createRequire(import.meta.url)

const EXPECTED_ZH_LABELS = ['全部', '视频创作', '爆款复刻', '商品视觉', '市场洞察', '营销增长', '效率工具']
const EXPECTED_EN_LABELS = ['All', 'Video Creation', 'Viral Replication', 'Product Visuals', 'Market Insights', 'Growth Marketing', 'Editing & Tools']

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

function assertPureLabelChips(host, expectedLabels, contextLabel) {
  const chips = Array.from(host.querySelectorAll('.omnimux-skills-chip'))
  assert.equal(chips.length, 7, `${contextLabel}：应渲染 1 个全选 + 6 个垂直场景胶囊`)
  assert.equal(host.querySelectorAll('.omnimux-skills-chip-count').length, 0, `${contextLabel}：不得渲染 .omnimux-skills-chip-count 数字角标`)

  const actualLabels = chips.map((chip) => chip.textContent.trim())
  assert.deepEqual(actualLabels, expectedLabels, `${contextLabel}：分类胶囊文本应仅包含名称，不包含计数数字`)
  for (const label of actualLabels) {
    assert.equal(/\d/.test(label), false, `${contextLabel}：分类胶囊 "${label}" 不得包含数字`)
  }
}

test('e2e: 会话引导 SkillsPanel（默认、chipsOnly、中英双语）分类胶囊仅展示名称，不渲染数字统计角标', async () => {
  const { SkillsPanel } = await loadComponent('./SkillsPanel.jsx')
  const env = withDom(FIXTURE_HTML)
  const host = document.querySelector('#root')
  const root = createRoot(host.querySelector('#seat'))

  const zhMap = new Map(Object.entries(guideZh))
  const enMap = new Map(Object.entries(guideEn))
  const tZh = (key, fallback) => zhMap.get(key) || fallback || key
  const tEn = (key, fallback) => enMap.get(key) || fallback || key

  try {
    await act(async () => {
      root.render(React.createElement(SkillsPanel, {
        t: tZh,
        onSelectSkill: () => {},
      }))
    })
    assertPureLabelChips(host, EXPECTED_ZH_LABELS, '中文完整面板')

    await act(async () => {
      root.render(React.createElement(SkillsPanel, {
        t: tZh,
        chipsOnly: true,
        onSelectSkill: () => {},
      }))
    })
    assertPureLabelChips(host, EXPECTED_ZH_LABELS, '中文 chipsOnly 模式')

    await act(async () => {
      root.render(React.createElement(SkillsPanel, {
        t: tEn,
        onSelectSkill: () => {},
      }))
    })
    assertPureLabelChips(host, EXPECTED_EN_LABELS, '英文完整面板')

    const stylesSource = readFileSync(new URL('../styles.js', import.meta.url), 'utf8')
    assert.equal(stylesSource.includes('.omnimux-skills-chip-count'), false, 'styles.js 不得残留无用 .omnimux-skills-chip-count 样式')
  } finally {
    await act(async () => { root.unmount() })
    env.restore()
  }
})
