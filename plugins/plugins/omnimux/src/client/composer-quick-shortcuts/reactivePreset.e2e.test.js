import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  isTikTokAgentPreset,
  subscribeActivePreset,
  AGENT_PRESET_CHANGED_EVENT,
} from './isTikTokAgentPreset.js'

test('E2E: TikTok Agent 快捷指令响应式感知预设变动与角色限定联动', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>OmniMux Role Gating</title></head>
      <body>
        <div data-composer-seat>
          <button type="button" data-omnimux-preset-seat="cordis">
            <span class="seatLabel">创建Agent</span>
          </button>
        </div>
        <div data-slot="conversation.input.dock"></div>
      </body>
    </html>
  `
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document

  try {
    globalThis.window = dom.window
    globalThis.document = dom.window.document

    let changeNotifiedCount = 0
    const unsubscribe = subscribeActivePreset(() => {
      changeNotifiedCount++
    })

    // 场景 1：初始状态为「创建Agent」(cordis)，断言不展示内容电商快捷入口
    dom.window.__omnimuxActivePreset = 'cordis'
    assert.equal(isTikTokAgentPreset(null, {}), false, 'cordis 创造模式必须返回 false')

    // 场景 2：用户在界面中切换为默认内容电商 Agent「OmniMux」(omni-agent)
    dom.window.__omnimuxActivePreset = 'omni-agent'
    const seatBtn = dom.window.document.querySelector('[data-omnimux-preset-seat]')
    seatBtn.setAttribute('data-omnimux-preset-seat', 'omni-agent')
    const label = dom.window.document.querySelector('.seatLabel')
    label.textContent = 'OmniMux'

    // 派发切换事件
    dom.window.dispatchEvent(
      new dom.window.CustomEvent(AGENT_PRESET_CHANGED_EVENT, {
        detail: { id: 'omni-agent' },
      })
    )

    assert.equal(changeNotifiedCount, 1, '切换到 OmniMux 时应收到 1 次变动通知')
    assert.equal(isTikTokAgentPreset(null, {}), true, '切换到 OmniMux 后必须判定为 true')

    // 场景 3：用户切换回「创建Agent」(cordis)
    dom.window.__omnimuxActivePreset = 'cordis'
    seatBtn.setAttribute('data-omnimux-preset-seat', 'cordis')
    label.textContent = '创建Agent'

    dom.window.dispatchEvent(
      new dom.window.CustomEvent(AGENT_PRESET_CHANGED_EVENT, {
        detail: { id: 'cordis' },
      })
    )

    assert.equal(changeNotifiedCount, 2, '切换到 cordis 时应收到第 2 次变动通知')
    assert.equal(isTikTokAgentPreset(null, {}), false, '切换到 cordis 后必须返回 false')

    // 场景 4：非内容电商预设保持隔离
    dom.window.__omnimuxActivePreset = 'standard'
    seatBtn.setAttribute('data-omnimux-preset-seat', 'standard')
    label.textContent = '标准模式'

    dom.window.dispatchEvent(
      new dom.window.CustomEvent(AGENT_PRESET_CHANGED_EVENT, {
        detail: { id: 'standard' },
      })
    )

    assert.equal(changeNotifiedCount, 3, '切换到 standard 时应收到第 3 次变动通知')
    assert.equal(isTikTokAgentPreset(null, {}), false, '切换到 standard 后必须返回 false')

    // 场景 5：再次切回「OmniMux」(omni-agent) 或历史「tiktok-agent」
    dom.window.__omnimuxActivePreset = 'tiktok-agent'
    seatBtn.setAttribute('data-omnimux-preset-seat', 'tiktok-agent')
    label.textContent = 'TikTok运营专家团'

    dom.window.dispatchEvent(
      new dom.window.CustomEvent(AGENT_PRESET_CHANGED_EVENT, {
        detail: { id: 'tiktok-agent' },
      })
    )

    assert.equal(changeNotifiedCount, 4, '再次切回兼容别名时应收到第 4 次变动通知')
    assert.equal(isTikTokAgentPreset(null, {}), true, '历史 TikTok 别名后必须恢复判定为 true')

    unsubscribe()
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
  }
})
