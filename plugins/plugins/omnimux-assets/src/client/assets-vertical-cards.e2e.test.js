import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { ASSETS_CSS } from './styles.js'

const here = dirname(fileURLToPath(import.meta.url))
// 真实加载 dsh-ui-kit MediaCard 样式（还原编译后的 .dshUk-MediaCard-* 类名），验证层叠特异性胜出。
const MEDIA_CARD_KIT_CSS = readFileSync(
  join(here, '../../../../packages/dsh-ui-kit/src/card/MediaCard.module.css'),
  'utf8',
).replace(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g, '.dshUk-MediaCard-$1')

const TOKEN_CSS = `
:root {
  --dsw-alias-bg-base: rgb(255, 255, 255);
  --dsw-alias-bg-layer-1: rgb(255, 255, 255);
  --dsw-alias-bg-module-platform: rgb(245, 246, 247);
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.08);
  --dsw-alias-border-l4: rgba(0, 0, 0, 0.2);
  --dsw-alias-label-primary: rgb(24, 24, 27);
  --dsw-alias-label-secondary: rgb(82, 82, 91);
  --dsw-alias-label-tertiary: rgb(113, 113, 122);
  --dsw-alias-button-primary-fill: rgb(24, 24, 27);
  --dsw-alias-label-primary-foreground: rgb(255, 255, 255);
}
[data-ds-dark-theme] {
  --dsw-alias-bg-base: rgb(21, 21, 23);
  --dsw-alias-bg-layer-1: rgb(33, 34, 36);
  --dsw-alias-bg-module-platform: rgb(53, 54, 56);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l4: rgba(255, 255, 255, 0.24);
  --dsw-alias-label-primary: rgb(244, 244, 245);
  --dsw-alias-label-secondary: rgb(212, 212, 216);
  --dsw-alias-label-tertiary: rgb(161, 161, 170);
}
`

const portraitSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='540' height='960'%3E%3Crect width='540' height='960' fill='%23332255'/%3E%3C/svg%3E"
const wideCharSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='720'%3E%3Crect width='960' height='720' fill='%231e3540'/%3E%3C/svg%3E"
const landscapeSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'%3E%3Crect width='1280' height='720' fill='%23121c33'/%3E%3C/svg%3E"
const squareSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Crect width='600' height='600' fill='%23d2c7b7'/%3E%3C/svg%3E"

test('本地资产统一 16:10 横版托盘展台：等高网格、全类型 contain 内圆角、无框底栏与高屏效', () => {
  const result = runStyleDomProbe({
    name: 'assets-horizontal-tray-geometry',
    viewportHeight: 860,
    styles: `${TOKEN_CSS}\n${MEDIA_CARD_KIT_CSS}\n${ASSETS_CSS}`,
    html: `
      <div class="omnimux-assets-stage" style="width: 1280px; padding: 20px;">
        <div class="omnimux-assets-local-grid">
          <div class="dshUk-MediaCard-card dshUk-MediaCard-selected omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray omnimux-assets-card--character" aria-selected="true">
            <div class="dshUk-MediaCard-coverWrapper">
              <div class="omnimux-assets-card-thumb">
                <img src="${portraitSvg}" class="omnimux-assets-card-media char-portrait" alt="" />
              </div>
            </div>
            <div class="dshUk-MediaCard-body omnimux-assets-card-body">
              <div class="omnimux-assets-card-head">
                <span class="omnimux-assets-card-title">科技 Vlogger-粉衣女郎 Yuna</span>
                <div class="omnimux-assets-card-more"><button class="omnimux-assets-card-more-btn">...</button></div>
              </div>
              <div class="dshUk-MediaCard-subtitle omnimux-assets-card-desc">1小时前</div>
            </div>
          </div>
          <div class="dshUk-MediaCard-card omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray omnimux-assets-card--character">
            <div class="dshUk-MediaCard-coverWrapper">
              <div class="omnimux-assets-card-thumb">
                <img src="${wideCharSvg}" class="omnimux-assets-card-media char-wide" alt="" />
              </div>
            </div>
            <div class="dshUk-MediaCard-body omnimux-assets-card-body">
              <div class="omnimux-assets-card-head"><span class="omnimux-assets-card-title">双人户外剧照</span></div>
              <div class="dshUk-MediaCard-subtitle omnimux-assets-card-desc">2小时前</div>
            </div>
          </div>
          <div class="dshUk-MediaCard-card omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray omnimux-assets-card--scene">
            <div class="dshUk-MediaCard-coverWrapper scene-cover">
              <div class="omnimux-assets-card-thumb">
                <img src="${landscapeSvg}" class="omnimux-assets-card-media scene-media" alt="" />
              </div>
            </div>
            <div class="dshUk-MediaCard-body omnimux-assets-card-body">
              <div class="omnimux-assets-card-head"><span class="omnimux-assets-card-title">雨夜东京街景</span></div>
              <div class="dshUk-MediaCard-subtitle omnimux-assets-card-desc">3小时前</div>
            </div>
          </div>
          <div class="dshUk-MediaCard-card omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray omnimux-assets-card--prop">
            <div class="dshUk-MediaCard-coverWrapper prop-cover">
              <div class="omnimux-assets-card-thumb">
                <img src="${squareSvg}" class="omnimux-assets-card-media prop-media" alt="" />
              </div>
            </div>
            <div class="dshUk-MediaCard-body omnimux-assets-card-body">
              <div class="omnimux-assets-card-head"><span class="omnimux-assets-card-title">精华瓶棚拍</span></div>
              <div class="dshUk-MediaCard-subtitle omnimux-assets-card-desc">5小时前</div>
            </div>
          </div>
          <div class="dshUk-MediaCard-card omnimux-assets-focusable omnimux-assets-card omnimux-assets-card--tray omnimux-assets-card--knowledge">
            <div class="dshUk-MediaCard-coverWrapper knowledge-cover">
              <div class="omnimux-assets-card-thumb">
                <div class="omnimux-assets-card-placeholder">DOC</div>
              </div>
            </div>
            <div class="dshUk-MediaCard-body omnimux-assets-card-body">
              <div class="omnimux-assets-card-head"><span class="omnimux-assets-card-title">无封面知识包</span></div>
              <div class="dshUk-MediaCard-subtitle omnimux-assets-card-desc">1天前</div>
            </div>
          </div>
        </div>
        <div class="omnimux-assets-card omnimux-assets-cloud-skeleton" style="width: 240px;"></div>
      </div>
    `,
    measure: () => {
      const stage = document.querySelector('.omnimux-assets-stage')
      const cards = Array.from(document.querySelectorAll('.omnimux-assets-local-grid .omnimux-assets-card'))
      const thumbs = cards.map((c) => c.querySelector('.omnimux-assets-card-thumb'))
      const thumbRects = thumbs.map((t) => t.getBoundingClientRect())
      const cardRects = cards.map((c) => c.getBoundingClientRect())
      const firstRowTop = thumbRects[0].top
      const firstRowCols = thumbRects.filter((r) => Math.abs(r.top - firstRowTop) < 1.5).length
      const maxThumbHeight = thumbRects.reduce((acc, r) => (r.height > acc ? r.height : acc), -Infinity)
      const minThumbHeight = thumbRects.reduce((acc, r) => (r.height < acc ? r.height : acc), Infinity)
      const maxThumbHeightDiff = maxThumbHeight - minThumbHeight
      const maxCardHeight = cardRects.reduce((acc, r) => (r.height > acc ? r.height : acc), -Infinity)
      const minCardHeight = cardRects.reduce((acc, r) => (r.height < acc ? r.height : acc), Infinity)
      const maxCardHeightDiff = maxCardHeight - minCardHeight
      const ratios = thumbRects.map((r) => +(r.width / r.height).toFixed(2))

      const charPortrait = document.querySelector('.char-portrait')
      const charWide = document.querySelector('.char-wide')
      const sceneMedia = document.querySelector('.scene-media')
      const propMedia = document.querySelector('.prop-media')
      const card0Cs = getComputedStyle(cards[0])
      const thumb0Cs = getComputedStyle(thumbs[0])
      const titleCs = getComputedStyle(document.querySelector('.omnimux-assets-card-title'))
      const desc = document.querySelector('.omnimux-assets-card-desc')
      const descCs = getComputedStyle(desc)
      const lightBaseBg = getComputedStyle(stage).backgroundColor
      const lightTrayBg = thumb0Cs.backgroundColor

      // Switch to dark theme and sample tray separation
      stage.setAttribute('data-ds-dark-theme', '')
      const darkBaseBg = getComputedStyle(stage).backgroundColor
      const darkTrayBg = getComputedStyle(thumbs[0]).backgroundColor
      stage.removeAttribute('data-ds-dark-theme')

      // Estimate visible rows under typical desktop header (~220px) in 860px viewport
      const visibleRows = +((860 - 220) / (cardRects[0].height + 20)).toFixed(2)

      const cloudSkeleton = document.querySelector('.omnimux-assets-cloud-skeleton')
      const cloudSkeletonCs = getComputedStyle(cloudSkeleton)

      return {
        firstRowCols,
        ratios,
        maxThumbHeightDiff: +maxThumbHeightDiff.toFixed(2),
        maxCardHeightDiff: +maxCardHeightDiff.toFixed(2),
        visibleRows,
        cardBorderWidth: card0Cs.borderTopWidth,
        cardBg: card0Cs.backgroundColor,
        cardBoxShadow: card0Cs.boxShadow,
        cloudSkeletonBorderWidth: cloudSkeletonCs.borderTopWidth,
        thumbAspectRatio: thumb0Cs.aspectRatio,
        thumbPadding: thumb0Cs.padding,
        thumbRadius: thumb0Cs.borderRadius,
        charPortraitFit: getComputedStyle(charPortrait).objectFit,
        charPortraitRadius: getComputedStyle(charPortrait).borderRadius,
        charWideFit: getComputedStyle(charWide).objectFit,
        sceneFit: getComputedStyle(sceneMedia).objectFit,
        propFit: getComputedStyle(propMedia).objectFit,
        portraitRenderedRatio: +(charPortrait.getBoundingClientRect().width / charPortrait.getBoundingClientRect().height).toFixed(2),
        wideCharRenderedRatio: +(charWide.getBoundingClientRect().width / charWide.getBoundingClientRect().height).toFixed(2),
        titleFontWeight: titleCs.fontWeight,
        titleFontSize: titleCs.fontSize,
        descFontSize: descCs.fontSize,
        descText: desc.textContent.trim(),
        lightBaseBg,
        lightTrayBg,
        darkBaseBg,
        darkTrayBg,
        hasPlaceholder: Boolean(document.querySelector('.omnimux-assets-card-placeholder')),
      }
    },
  })

  // 1. 常规桌面宽度呈 4–5 列，同排托盘与卡片高度严格齐平，首屏可见 >= 2.5 行
  assert.equal(result.firstRowCols, 5)
  assert.deepEqual(result.ratios, [1.6, 1.6, 1.6, 1.6, 1.6])
  assert.equal(result.maxThumbHeightDiff < 1, true, `同排托盘高度差应 < 1px，实际 ${result.maxThumbHeightDiff}`)
  assert.equal(result.maxCardHeightDiff < 1, true, `同排卡片高度差应 < 1px，实际 ${result.maxCardHeightDiff}`)
  assert.equal(result.visibleRows >= 2.5, true, `首屏可见行数应 >= 2.5，实际 ${result.visibleRows}`)

  // 2. 托盘样式：独立 12px 圆角 + 8px 呼吸内边距 + 无外卡边框/阴影（覆盖 MediaCard.selected），且不污染公共云端骨架卡
  assert.equal(result.thumbAspectRatio, '16 / 10')
  assert.equal(result.thumbPadding, '8px')
  assert.equal(result.thumbRadius, '12px')
  assert.equal(result.cardBorderWidth, '0px')
  assert.equal(result.cardBg, 'rgba(0, 0, 0, 0)')
  assert.equal(result.cardBoxShadow, 'none')
  assert.equal(result.cloudSkeletonBorderWidth, '1px')

  // 3. 全类型统一 contain 居中 + 8px 独立内圆角，角色图保持原始构图不裁切
  assert.equal(result.charPortraitFit, 'contain')
  assert.equal(result.charPortraitRadius, '8px')
  assert.equal(result.charWideFit, 'contain')
  assert.equal(result.sceneFit, 'contain')
  assert.equal(result.propFit, 'contain')
  assert.equal(Math.abs(result.portraitRenderedRatio - 540 / 960) < 0.04, true, `9:16 竖图应保持原比例，实际 ${result.portraitRenderedRatio}`)
  assert.equal(Math.abs(result.wideCharRenderedRatio - 960 / 720) < 0.04, true, `4:3 角色图应保持原比例不裁切，实际 ${result.wideCharRenderedRatio}`)

  // 4. 亮/暗主题托盘均与底色有柔和对比（无生硬纯黑边）
  assert.notEqual(result.lightTrayBg, result.lightBaseBg)
  assert.notEqual(result.darkTrayBg, result.darkBaseBg)

  // 5. 轻量化无框底栏（单行标题 13px/500 + 相对时间 12px）与无封面知识包占位
  assert.equal(result.titleFontSize, '13px')
  assert.equal(result.titleFontWeight, '500')
  assert.equal(result.descFontSize, '12px')
  assert.equal(result.descText, '1小时前')
  assert.equal(result.hasPlaceholder, true)
})
