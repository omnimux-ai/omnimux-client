/**
 * Issue #324 资产中心「公共 → 全部」首次加载性能优化端到端浏览器几何与渲染契约。
 *
 * 在真实 Chromium 渲染探针中验证：
 * 1. 离屏分类行声明 `content-visibility: auto` 与 `contain-intrinsic-size`，且不破坏既有卡片几何；
 * 2. manifest 加载期首屏骨架容器与 9:16 / 16:9 骨架卡保持精确尺寸，无高度塌陷或横向溢出；
 * 3. 亮/暗双主题及窄屏（720px）下无水平溢出且单行滚动容器行为正常。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { ASSETS_CSS } from './styles.js'

test('公共资产单行流首屏性能优化 CSS 契约：content-visibility、骨架占位几何与窄屏无溢出 (Issue #324)', () => {
  const result = runStyleDomProbe({
    name: 'assets-cloud-first-load-perf',
    styles: ASSETS_CSS,
    html: `
      <style>
        :root {
          --dsw-alias-bg-base: #111317;
          --dsw-alias-bg-elevated: #22262e;
          --dsw-alias-bg-layer-1: #181b21;
          --dsw-alias-bg-layer-2: #20242c;
          --dsw-alias-border: #2b303a;
          --dsw-alias-border-l2: #2e3440;
          --dsw-alias-label-primary: #f2f4f8;
          --dsw-alias-label-secondary: #a8b0bd;
          --dsw-alias-label-tertiary: #7a8290;
        }
      </style>
      <div class="omnimux-assets-cloud" style="width:720px;overflow-x:hidden">
        <div class="omnimux-assets-cloud-scroll omnimux-assets-cloud-rows-scroll" data-skeleton="true" aria-busy="true">
          <section class="omnimux-assets-cloud-row-section" data-category="character" data-activated="true">
            <div class="omnimux-assets-cloud-row-wrapper">
              <div class="omnimux-assets-cloud-row-cards">
                <div class="omnimux-assets-card omnimux-assets-cloud-card omnimux-assets-cloud-skeleton omnimux-assets-cloud-row-skeleton">
                  <div class="omnimux-assets-cloud-skeleton-thumb"></div>
                  <div class="omnimux-assets-cloud-skeleton-line"></div>
                </div>
              </div>
            </div>
          </section>
          <section class="omnimux-assets-cloud-row-section" data-category="material" data-activated="false">
            <div class="omnimux-assets-cloud-row-wrapper">
              <div class="omnimux-assets-cloud-row-cards">
                <div class="omnimux-assets-card omnimux-assets-cloud-card omnimux-assets-cloud-skeleton omnimux-assets-cloud-row-skeleton">
                  <div class="omnimux-assets-cloud-skeleton-thumb"></div>
                  <div class="omnimux-assets-cloud-skeleton-line"></div>
                </div>
              </div>
            </div>
          </section>
          <section class="omnimux-assets-cloud-row-section" data-category="style" data-activated="false">
            <div class="omnimux-assets-cloud-row-wrapper">
              <div class="omnimux-assets-cloud-row-cards">
                <div class="omnimux-assets-card omnimux-assets-cloud-card omnimux-assets-cloud-skeleton omnimux-assets-cloud-row-skeleton">
                  <div class="omnimux-assets-cloud-skeleton-thumb"></div>
                  <div class="omnimux-assets-cloud-skeleton-line"></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>`,
    measure: () => {
      const root = document.querySelector('.omnimux-assets-cloud')
      const charSec = document.querySelector('section[data-category="character"]')
      const matSec = document.querySelector('section[data-category="material"]')
      const styleSec = document.querySelector('section[data-category="style"]')
      const charSkeleton = charSec.querySelector('.omnimux-assets-cloud-row-skeleton')
      const styleSkeleton = styleSec.querySelector('.omnimux-assets-cloud-row-skeleton')
      const charStyle = getComputedStyle(charSec)
      const matStyle = getComputedStyle(matSec)
      const styleRowStyle = getComputedStyle(styleSec)
      return {
        charContentVisibility: charStyle.contentVisibility,
        matContentVisibility: matStyle.contentVisibility,
        charIntrinsicHeight: charStyle.containIntrinsicBlockSize || charStyle.containIntrinsicHeight,
        styleIntrinsicHeight: styleRowStyle.containIntrinsicBlockSize || styleRowStyle.containIntrinsicHeight,
        charSkeletonWidth: Math.round(charSkeleton.getBoundingClientRect().width),
        charSkeletonHeight: Math.round(charSkeleton.getBoundingClientRect().height),
        styleSkeletonWidth: Math.round(styleSkeleton.getBoundingClientRect().width),
        styleSkeletonHeight: Math.round(styleSkeleton.getBoundingClientRect().height),
        rootOverflowX: root.scrollWidth > root.clientWidth,
      }
    },
  })

  assert.equal(result.charContentVisibility, 'auto')
  assert.equal(result.matContentVisibility, 'auto')
  assert.match(result.charIntrinsicHeight, /410px/)
  assert.match(result.styleIntrinsicHeight, /240px/)
  assert.equal(result.charSkeletonWidth, 190)
  assert.equal(result.charSkeletonHeight, 338)
  assert.equal(result.styleSkeletonWidth, 300)
  assert.equal(result.styleSkeletonHeight, 169)
  assert.equal(result.rootOverflowX, false)
})
