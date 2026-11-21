import assert from 'node:assert/strict'
import test from 'node:test'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { ASSETS_CSS } from './styles.js'

/**
 * 无封面视频卡（钩子目录的全部行）必须由首帧撑开版面。
 *
 * 数据源只给 `media_url`（MP4），没有 `cover_url` / `thumb_url`；卡片走
 * `bareClip` 分支把 `<video>` 当作门面。如果这条规则是绝对定位，父容器
 * `height:auto + min-height:0` 没有任何在流内容，实测高度为 0，整张卡只剩
 * 50px 的标题行——这正是「钩子分类没有画面」的根因。
 */
test('无封面视频卡片按视频宽高比撑开缩略图，不再塌成 0 高', () => {
  const result = runStyleDomProbe({
    name: 'cloud-bare-video-card',
    styles: ASSETS_CSS,
    html: `
      <style>
        :root {
          --dsw-alias-bg-layer-1: #f7f7f8;
          --dsw-alias-bg-base: #ffffff;
          --dsw-alias-bg-elevated: #eeeeee;
          --dsw-alias-bg-module-platform: #eeeeee;
          --dsw-alias-label-primary: #111111;
          --dsw-alias-label-secondary: #444444;
          --dsw-alias-label-tertiary: #777777;
          --dsw-alias-border-l2: #dddddd;
          --dsw-alias-bg-mask-1: rgba(0, 0, 0, .10);
          --dsw-alias-bg-mask-2: rgba(0, 0, 0, .20);
        }
      </style>
      <div class="omnimux-assets-grid omnimux-assets-cloud-grid" style="width: 260px;">
        <div class="omnimux-assets-card omnimux-assets-cloud-card omnimux-assets-cloud-card--media"
             data-kind="media" data-media-type="video">
          <div class="omnimux-assets-card-thumb omnimux-assets-cloud-thumb">
            <video class="omnimux-assets-cloud-preview omnimux-assets-cloud-preview--bare"
                   width="9" height="16" muted loop playsinline preload="metadata"></video>
          </div>
          <div class="omnimux-assets-cloud-card-mask" aria-hidden="true"></div>
          <div class="omnimux-assets-card-body">
            <p class="omnimux-assets-card-title">Woman Activity</p>
          </div>
        </div>
      </div>`,
    measure: () => {
      const card = document.querySelector('.omnimux-assets-cloud-card')
      const thumb = document.querySelector('.omnimux-assets-cloud-thumb')
      const video = document.querySelector('.omnimux-assets-cloud-preview--bare')
      const body = document.querySelector('.omnimux-assets-card-body')
      const thumbRect = thumb.getBoundingClientRect()
      return {
        cardHeight: card.getBoundingClientRect().height,
        thumbWidth: thumbRect.width,
        thumbHeight: thumbRect.height,
        bodyHeight: body.getBoundingClientRect().height,
        videoPosition: getComputedStyle(video).position,
        videoDisplay: getComputedStyle(video).display,
        videoHeight: video.getBoundingClientRect().height,
      }
    },
  })

  assert.equal(result.videoPosition, 'static', '裸视频必须回到文档流，绝对定位无法撑开父容器')
  assert.equal(result.videoDisplay, 'block')
  assert.ok(result.thumbHeight > 200, `缩略图高度应随 9:16 视频展开，实际 ${result.thumbHeight}px`)
  assert.ok(Math.abs(result.thumbHeight - (result.thumbWidth * 16) / 9) < 2,
    `缩略图高度应约等于宽度 × 16/9，实际 ${result.thumbHeight}px / 宽 ${result.thumbWidth}px`)
  assert.ok(Math.abs(result.videoHeight - result.thumbHeight) < 1, '视频应铺满缩略图高度')
  assert.ok(result.cardHeight > result.bodyHeight + 200, `卡片不能被压成标题条，实际 ${result.cardHeight}px`)
})
