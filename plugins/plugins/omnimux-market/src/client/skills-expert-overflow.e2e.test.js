import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'

const source = readFileSync(new URL('./css.js', import.meta.url), 'utf8')
const match = /const CSS = `([\s\S]*?)`;/.exec(source)
assert.ok(match, '市场样式源必须包含 CSS 模板')

test('技能专家页 .sh-mkt 不产生横向溢出，五列卡片保留右侧留白', () => {
  const result = runStyleDomProbe({
    name: 'market-skills-overflow',
    // 真实页面没有全局 border-box 重置；用零优先级规则还原宿主默认盒模型。
    styles: `:where(.omnimux-no-reset,.omnimux-no-reset *){box-sizing:content-box}\n${match[1]}`,
    html: `
      <div class="omnimux-no-reset sh-plaza-body" style="width:1400px">
        <div class="sh-mkt">
          <div class="nav-bar">
            <div class="search-box"><input placeholder="搜索全部 Skill"></div>
          </div>
          <div class="featured-grid cards-grid">
            ${Array.from({ length: 5 }, (_, index) => `<div class="omnimux-creatify-card omnimux-creatify-card-grad-${index}">卡片 ${index + 1}</div>`).join('')}
          </div>
        </div>
      </div>`,
    measure: () => {
      const body = document.querySelector('.sh-plaza-body')
      const mkt = document.querySelector('.sh-mkt')
      const grid = document.querySelector('.cards-grid')
      const lastCard = grid.children[4]
      const bodyRect = body.getBoundingClientRect()
      const lastCardRect = lastCard.getBoundingClientRect()
      return {
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        overflow: body.scrollWidth - body.clientWidth,
        boxSizing: getComputedStyle(mkt).boxSizing,
        lastCardGap: Math.round(bodyRect.right - lastCardRect.right),
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      }
    },
  })

  assert.equal(result.boxSizing, 'border-box', '容器自身必须使用 border-box')
  assert.equal(result.overflow, 0, `内容区仍横向溢出 ${result.overflow}px`)
  assert.equal(result.bodyScrollWidth, result.bodyClientWidth)
  assert.equal(result.columns, 5, '宽视口下应保持五列')
  assert.equal(result.lastCardGap, 20, `第五列右侧应保留 20px 留白，实际 ${result.lastCardGap}px`)
})
