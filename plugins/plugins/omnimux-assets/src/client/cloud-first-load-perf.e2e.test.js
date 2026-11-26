/**
 * Issue #324 资产中心「公共 → 全部」首次加载性能优化端到端浏览器几何与渲染契约。
 *
 * 在真实 Chromium 渲染探针中验证（暗/亮双主题 + 720px 窄屏）：
 * 1. `content-visibility: auto` 与 `contain-intrinsic-size` 挂在 `.omnimux-assets-cloud-row-cards`
 *    （而非 `.omnimux-assets-cloud-row-section`），保证左右 `-12px` 翻页箭头不被 `contain: paint` 裁切；
 * 2. manifest 加载期首屏骨架容器与 9:16 / 16:9 骨架卡保持精确尺寸，无高度塌陷；
 * 3. 单行放满 10 张卡片时，横向滚动被收拢在 `.omnimux-assets-cloud-row-cards` 内，
 *    外层 `.omnimux-assets-cloud`（不设人为 overflow-x:hidden）无横向溢出。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { ASSETS_CSS } from './styles.js'

const THEME_TOKENS = {
  dark: `
    --dsw-alias-bg-base: #111317;
    --dsw-alias-bg-elevated: #22262e;
    --dsw-alias-bg-layer-1: #181b21;
    --dsw-alias-bg-layer-2: #20242c;
    --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.52);
    --dsw-alias-border: #2b303a;
    --dsw-alias-border-l2: #2e3440;
    --dsw-alias-label-primary: #f2f4f8;
    --dsw-alias-label-secondary: #a8b0bd;
    --dsw-alias-label-tertiary: #7a8290;
  `,
  light: `
    --dsw-alias-bg-base: #f7f8fa;
    --dsw-alias-bg-elevated: #ffffff;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #eef1f6;
    --dsw-alias-bg-mask-1: rgba(15, 23, 42, 0.24);
    --dsw-alias-border: #d9dfe8;
    --dsw-alias-border-l2: #c9d1de;
    --dsw-alias-label-primary: #151922;
    --dsw-alias-label-secondary: #4c5566;
    --dsw-alias-label-tertiary: #6e7787;
  `,
}

function buildSkeletonCards(count) {
  return Array.from({ length: count }, (_, idx) => `
    <div class="omnimux-assets-card omnimux-assets-cloud-card omnimux-assets-cloud-skeleton omnimux-assets-cloud-row-skeleton" data-idx="${idx}">
      <div class="omnimux-assets-cloud-skeleton-thumb"></div>
      <div class="omnimux-assets-cloud-skeleton-line"></div>
    </div>`).join('')
}

for (const theme of ['dark', 'light']) {
  test(`公共资产单行流首屏性能优化 CSS 契约（${theme} 主题 + 720px 窄屏）：箭头不裁切、横向滚动收敛、骨架精确几何 (Issue #324)`, () => {
    const result = runStyleDomProbe({
      name: `assets-cloud-first-load-perf-${theme}`,
      styles: ASSETS_CSS,
      html: `
        <style>
          :root { ${THEME_TOKENS[theme]} }
          body { margin: 0; padding: 24px; background: var(--dsw-alias-bg-base); }
        </style>
        <div class="omnimux-assets-cloud" style="width:720px">
          <div class="omnimux-assets-cloud-scroll omnimux-assets-cloud-rows-scroll" data-skeleton="true" aria-busy="true">
            <section class="omnimux-assets-cloud-row-section" data-category="character" data-activated="true">
              <div class="omnimux-assets-cloud-row-wrapper">
                <button class="omnimux-assets-cloud-row-arrow omnimux-assets-cloud-row-arrow--left" type="button">‹</button>
                <div class="omnimux-assets-cloud-row-cards">${buildSkeletonCards(10)}</div>
                <button class="omnimux-assets-cloud-row-arrow omnimux-assets-cloud-row-arrow--right" type="button">›</button>
              </div>
            </section>
            <section class="omnimux-assets-cloud-row-section" data-category="material" data-activated="false">
              <div class="omnimux-assets-cloud-row-wrapper">
                <div class="omnimux-assets-cloud-row-cards">${buildSkeletonCards(6)}</div>
              </div>
            </section>
            <section class="omnimux-assets-cloud-row-section" data-category="style" data-activated="false">
              <div class="omnimux-assets-cloud-row-wrapper">
                <div class="omnimux-assets-cloud-row-cards">${buildSkeletonCards(6)}</div>
              </div>
            </section>
          </div>
        </div>`,
      measure: () => {
        const root = document.querySelector('.omnimux-assets-cloud')
        const charSec = document.querySelector('section[data-category="character"]')
        const charWrapper = charSec.querySelector('.omnimux-assets-cloud-row-wrapper')
        const charCards = charSec.querySelector('.omnimux-assets-cloud-row-cards')
        const styleCards = document.querySelector('section[data-category="style"] .omnimux-assets-cloud-row-cards')
        const leftArrow = charSec.querySelector('.omnimux-assets-cloud-row-arrow--left')
        const rightArrow = charSec.querySelector('.omnimux-assets-cloud-row-arrow--right')
        const charSkeleton = charSec.querySelector('.omnimux-assets-cloud-row-skeleton')
        const styleSkeleton = document.querySelector('section[data-category="style"] .omnimux-assets-cloud-row-skeleton')

        const secStyle = getComputedStyle(charSec)
        const wrapperStyle = getComputedStyle(charWrapper)
        const charCardsStyle = getComputedStyle(charCards)
        const styleCardsStyle = getComputedStyle(styleCards)
        const wrapperRect = charWrapper.getBoundingClientRect()
        const leftRect = leftArrow.getBoundingClientRect()
        const rightRect = rightArrow.getBoundingClientRect()

        // 验证左右箭头外露区域可被真实命中（未被 contain: paint 裁切）
        const leftEdgeHit = document.elementFromPoint(leftRect.left + 4, leftRect.top + leftRect.height / 2)
        const rightEdgeHit = document.elementFromPoint(rightRect.right - 4, rightRect.top + rightRect.height / 2)

        return {
          secContentVisibility: secStyle.contentVisibility,
          secContain: secStyle.contain,
          wrapperContain: wrapperStyle.contain,
          charCardsContentVisibility: charCardsStyle.contentVisibility,
          charIntrinsicHeight: charCardsStyle.containIntrinsicBlockSize || charCardsStyle.containIntrinsicHeight,
          styleIntrinsicHeight: styleCardsStyle.containIntrinsicBlockSize || styleCardsStyle.containIntrinsicHeight,
          charSkeletonWidth: Math.round(charSkeleton.getBoundingClientRect().width),
          charSkeletonHeight: Math.round(charSkeleton.getBoundingClientRect().height),
          styleSkeletonWidth: Math.round(styleSkeleton.getBoundingClientRect().width),
          styleSkeletonHeight: Math.round(styleSkeleton.getBoundingClientRect().height),
          cardsScrollableX: charCards.scrollWidth > charCards.clientWidth,
          rootOverflowBeyondArrows: root.scrollWidth > root.clientWidth + 24,
          leftArrowWidth: Math.round(leftRect.width),
          rightArrowWidth: Math.round(rightRect.width),
          leftArrowProtrusion: Math.round(wrapperRect.left - leftRect.left),
          rightArrowProtrusion: Math.round(rightRect.right - wrapperRect.right),
          leftEdgeClickable: leftEdgeHit === leftArrow,
          rightEdgeClickable: rightEdgeHit === rightArrow,
        }
      },
    })

    // section 与 wrapper 不得启 content-visibility / paint containment，否则会裁切 -12px 箭头
    assert.equal(result.secContentVisibility, 'visible')
    assert.equal(result.secContain, 'none')
    assert.equal(result.wrapperContain, 'none')
    assert.equal(result.charCardsContentVisibility, 'auto')
    assert.match(result.charIntrinsicHeight, /358px/)
    assert.match(result.styleIntrinsicHeight, /189px/)
    assert.equal(result.charSkeletonWidth, 190)
    assert.equal(result.charSkeletonHeight, 338)
    assert.equal(result.styleSkeletonWidth, 300)
    assert.equal(result.styleSkeletonHeight, 169)
    // 10 张 190px 卡片必然撑开内部横滚，同时不把外层容器撑爆
    assert.equal(result.cardsScrollableX, true)
    assert.equal(result.rootOverflowBeyondArrows, false)
    // 左右箭头完整 36px，外露 12px 均可真实 elementFromPoint 命中
    assert.equal(result.leftArrowWidth, 36)
    assert.equal(result.rightArrowWidth, 36)
    assert.equal(result.leftArrowProtrusion, 12)
    assert.equal(result.rightArrowProtrusion, 12)
    assert.equal(result.leftEdgeClickable, true)
    assert.equal(result.rightEdgeClickable, true)
  })
}
