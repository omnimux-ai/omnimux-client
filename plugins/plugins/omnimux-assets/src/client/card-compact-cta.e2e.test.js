import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { ASSETS_CSS } from './styles.js'

const here = dirname(fileURLToPath(import.meta.url))
const gridSource = readFileSync(join(here, 'AssetGrid.jsx'), 'utf8')

const html = (badgeText, longTitle, widths) => `
<div class="omnimux-assets-stage" style="width:1600px;padding:20px">
  <div class="probe-card omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray" data-widths='${JSON.stringify(widths)}' style="width:260px">
    <div class="dshUk-MediaCard-coverWrapper">
      <div class="omnimux-assets-card-thumb">
        <button class="omnimux-assets-check" data-selected="true" aria-label="选择"><svg width="12" height="12"></svg></button>
        <div class="omnimux-assets-card-corner">
          <button class="omnimux-assets-quick-add" data-added="true" aria-label="添加到会话"><svg width="13" height="13"></svg></button>
          <span class="omnimux-assets-badge">${badgeText}</span>
        </div>
      </div>
    </div>
    <div class="dshUk-MediaCard-body omnimux-assets-card-body">
      <div class="omnimux-assets-card-head">
        <span class="omnimux-assets-card-title">${longTitle}</span>
        <div class="omnimux-assets-card-more">
          <button class="omnimux-assets-card-more-btn" aria-label="操作">...</button>
        </div>
      </div>
      <div class="dshUk-MediaCard-subtitle omnimux-assets-card-desc">12分钟前</div>
    </div>
  </div>
</div>`

function probeCardWidths(badgeText, longTitle, widths) {
  return runStyleDomProbe({
    name: 'assets-tray-controls',
    styles: ASSETS_CSS,
    html: html(badgeText, longTitle, widths),
    measure: () => {
      const card = document.querySelector('.probe-card')
      const probeList = JSON.parse(card.getAttribute('data-widths') || '[]')
      const thumb = card.querySelector('.omnimux-assets-card-thumb')
      const check = card.querySelector('.omnimux-assets-check')
      const quickAdd = card.querySelector('.omnimux-assets-quick-add')
      const badge = card.querySelector('.omnimux-assets-badge')
      const head = card.querySelector('.omnimux-assets-card-head')
      const title = card.querySelector('.omnimux-assets-card-title')
      const moreBtn = card.querySelector('.omnimux-assets-card-more-btn')
      const rows = []
      for (const w of probeList) {
        card.style.width = `${w}px`
        const tr = thumb.getBoundingClientRect()
        const cr = check.getBoundingClientRect()
        const qr = quickAdd.getBoundingClientRect()
        const br = badge.getBoundingClientRect()
        const hr = head.getBoundingClientRect()
        const mr = moreBtn.getBoundingClientRect()
        const titleCs = getComputedStyle(title)
        rows.push({
          cardWidth: w,
          quickAddSize: [Math.round(qr.width), Math.round(qr.height)],
          moreBtnSize: [Math.round(mr.width), Math.round(mr.height)],
          controlsInsideTray: cr.left >= tr.left && qr.left >= cr.right + 4 && br.right <= tr.right + 0.5,
          moreBtnInsideHead: mr.right <= hr.right + 0.5 && mr.left >= hr.left,
          titleEllipsis: titleCs.textOverflow === 'ellipsis' && titleCs.whiteSpace === 'nowrap',
          headOverflowX: head.scrollWidth > Math.ceil(hr.width) + 1,
        })
      }
      return rows
    },
  })
}

test('资产库托盘卡片：角标、右上角快捷动作与标题行 ... 在窄宽与常规宽度下均不挤压溢出', () => {
  for (const [locale, badgeText, longTitle] of [
    ['zh', '知识包', '2026 春季新品发布会赛博女郎高清四视图与话术合规知识包终版'],
    ['en', 'Knowledge', '2026 Spring Campaign High-Resolution Character Turnaround & Copy Pack Final'],
  ]) {
    const rows = probeCardWidths(badgeText, longTitle, [200, 220, 250, 280, 340])
    assert.equal(rows.length, 5)
    for (const row of rows) {
      assert.deepEqual(row.quickAddSize, [24, 24], `${locale} ${row.cardWidth}px: 快捷加入按钮尺寸固定 24x24`)
      assert.deepEqual(row.moreBtnSize, [24, 24], `${locale} ${row.cardWidth}px: 更多按钮尺寸固定 24x24`)
      assert.equal(row.controlsInsideTray, true, `${locale} ${row.cardWidth}px: 顶部左右角标不得重叠或越出托盘`)
      assert.equal(row.moreBtnInsideHead, true, `${locale} ${row.cardWidth}px: ... 按钮不得被长标题挤出标题行`)
      assert.equal(row.titleEllipsis, true, `${locale} ${row.cardWidth}px: 标题行必须单行省略`)
      assert.equal(row.headOverflowX, false, `${locale} ${row.cardWidth}px: 标题行不得横向溢出`)
    }
  }
})

test('资产库托盘卡片：移除旧版全屏毛玻璃遮罩，保留完整无障碍与交互入口', () => {
  assert.equal(/\.omnimux-assets-card-overlay\b/.test(ASSETS_CSS), false, '不得残留遮挡画面的全屏毛玻璃遮罩样式')
  assert.equal(/@container asset-card/.test(ASSETS_CSS), false, '不得残留旧遮罩容器查询')
  assert.match(gridSource, /className="omnimux-assets-quick-add"/)
  assert.match(gridSource, /aria-label=\{addLabel\}/)
  assert.match(gridSource, /className="omnimux-assets-card-more-btn"/)
  assert.match(gridSource, /aria-label=\{t\('card\.actions'\)\}/)
  assert.match(gridSource, /aria-haspopup="menu"/)
  assert.match(gridSource, /aria-label=\{t\('select\.toggle'\)\}/)
})
