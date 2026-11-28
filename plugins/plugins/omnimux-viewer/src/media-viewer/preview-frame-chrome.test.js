/**
 * 图像生成右侧预览图去黑边、去浅灰光晕与真圆角修复回归单元测试 (Issue #434)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { MEDIA_VIEWER_CSS } from '../../../omnimux/src/client/media-viewer/styles.js';

function extractCssRule(source, selector) {
  const idx = source.indexOf(selector);
  assert.notEqual(idx, -1, `样式表必须包含选择器: ${selector}`);
  const open = source.indexOf('{', idx);
  assert.notEqual(open, -1, `选择器 ${selector} 必须包含规则体`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`选择器 ${selector} 规则体未闭合`);
}

describe('预览图去黑边、去外围光晕与真圆角契约 (Issue #434)', () => {
  it('MediaViewerTab 将完成态媒体与占位态解耦，并接入 ResizeObserver 舞台净高同步', () => {
    const src = readFileSync(new URL('./MediaViewerTab.jsx', import.meta.url), 'utf8');

    // 1. 完成态图片与视频使用 .omx-media-slot--media，不再强加固定 data-ratio 锁定比例
    assert.match(
      src,
      /activeItem\?\.type === 'video'\s*\?\s*\(\s*<div className="omx-media-slot omx-media-slot--media">/s,
      '完成态视频必须使用 omx-media-slot--media 且不挂固定 data-ratio'
    );
    assert.match(
      src,
      /activeItem\?\.url\s*\?\s*\(\s*<div className="omx-media-slot omx-media-slot--media">\s*<div className="omx-media-result omx-media-result--media active">\s*<img/s,
      '完成态图片必须使用 omx-media-slot--media 与 omx-media-result--media 且不挂固定 data-ratio'
    );

    // 2. 生成中与失败卡槽继续保留 data-ratio 占位规格
    assert.match(
      src,
      /activeItem\?\.status === 'generating'[\s\S]*?<div\s+className="omx-media-slot"\s+data-ratio=\{activeItem\?\.aspectRatio \|\| '1:1'\}/s,
      '生成中占位态必须保留 data-ratio'
    );
    assert.match(
      src,
      /activeItem\?\.status === 'failed'[\s\S]*?<div\s+className="omx-media-slot"\s+data-ratio=\{activeItem\?\.aspectRatio \|\| '1:1'\}/s,
      '失败占位态必须保留 data-ratio'
    );

    // 3. ResizeObserver 同步舞台与悬浮输入框避让变量
    assert.match(src, /data-has-thumbnails=\{hasThumbnails \? 'true' : 'false'\}/);
    assert.match(src, /--omx-mv-stage-max-w/);
    assert.match(src, /--omx-mv-stage-max-h/);
    assert.match(src, /--omx-mv-stage-pad-bottom/);
    assert.match(src, /\.omx-mv-composer-outer/);
  });

  it('MEDIA_VIEWER_CSS 彻底移除预览大框浅灰发光晕并统一使用 --dsw-radius-md 真圆角', () => {
    const displayRule = extractCssRule(MEDIA_VIEWER_CSS, '.omx-mv-display {');
    assert.match(displayRule, /box-shadow:\s*none;/, '.omx-mv-display 必须移除外围投影 (box-shadow: none)');
    assert.doesNotMatch(displayRule, /--dsw-alias-bg-layer-1/, '.omx-mv-display 严禁使用 --dsw-alias-bg-layer-1 作阴影');
    assert.match(displayRule, /overflow:\s*visible;/, '.omx-mv-display 必须保持 overflow: visible 以免裁切边缘打点气泡');
    assert.match(displayRule, /border-radius:\s*var\(--dsw-radius-md,\s*12px\);/);

    const displayImgRule = extractCssRule(MEDIA_VIEWER_CSS, '.omx-mv-display img {');
    assert.match(displayImgRule, /border-radius:\s*var\(--dsw-radius-md,\s*12px\);/);

    const slotRule = extractCssRule(MEDIA_VIEWER_CSS, '.omx-media-slot {');
    assert.match(slotRule, /box-shadow:\s*none;/, '.omx-media-slot 必须移除外围投影 (box-shadow: none)');
    assert.doesNotMatch(slotRule, /--dsw-alias-bg-layer-1/, '.omx-media-slot 严禁使用 --dsw-alias-bg-layer-1 作阴影');
    assert.match(slotRule, /border-radius:\s*var\(--dsw-radius-md,\s*12px\);/);

    const completedSlotRule = extractCssRule(MEDIA_VIEWER_CSS, '.omx-media-slot.omx-media-slot--media {');
    assert.match(completedSlotRule, /width:\s*auto;/);
    assert.match(completedSlotRule, /height:\s*auto;/);
    assert.match(completedSlotRule, /overflow:\s*hidden;/);
    assert.match(completedSlotRule, /border-radius:\s*var\(--dsw-radius-md,\s*12px\);/);
    assert.match(completedSlotRule, /box-shadow:\s*none;/);

    const completedImgRule = extractCssRule(
      MEDIA_VIEWER_CSS,
      '.omx-media-slot.omx-media-slot--media > .omx-media-result > img,\n.omx-media-slot.omx-media-slot--media > .omx-media-result > video {'
    );
    assert.match(completedImgRule, /width:\s*auto;/);
    assert.match(completedImgRule, /height:\s*auto;/);
    assert.match(completedImgRule, /border-radius:\s*inherit;/);
    assert.match(completedImgRule, /max-height:\s*var\(--omx-mv-stage-max-h,/);
  });

  it('占位卡槽补齐 3:4 / 2:3 / 3:2 / 21:9 比例并受舞台净高约束', () => {
    for (const ratio of ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']) {
      assert.equal(
        MEDIA_VIEWER_CSS.includes(`.omx-media-slot:not(.omx-media-slot--media)[data-ratio="${ratio}"]`),
        true,
        `缺少占位比例规则: ${ratio}`
      );
    }
  });
});
