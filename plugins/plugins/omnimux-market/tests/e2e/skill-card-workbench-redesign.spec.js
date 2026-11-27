/**
 * E2E 回归测试（Issue #410）：方案 A 氛围微光 + 常驻左对齐工作台技能卡
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const marketRoot = join(here, '../..');
const pluginsRoot = join(marketRoot, '..');

const cssFileSrc = readFileSync(join(marketRoot, 'src/client/css.js'), 'utf8');
const marketCss = /const CSS = `([\s\S]*)`\s*;/.exec(cssFileSrc)?.[1] || '';
const cardStart = marketCss.indexOf('.omnimux-creatify-card {');
const cardEnd = marketCss.indexOf('/* 插件专栏', cardStart);
const cardBlock = marketCss.slice(cardStart, cardEnd > cardStart ? cardEnd : undefined);

const omnimuxStylesSrc = readFileSync(join(pluginsRoot, 'omnimux/src/client/session-guide/styles.js'), 'utf8');
const featuredSrc = readFileSync(join(marketRoot, 'src/client/plaza/FeaturedCard.jsx'), 'utf8');

const built = await build({
  entryPoints: [join(marketRoot, 'src/client/plaza/FeaturedCard.jsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react'],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const { renderFeaturedCard } = mod.exports;

const sampleItem = {
  id: 'sk-omx-content-strategy',
  slug: 'content-strategy',
  title: '规划内容策略',
  titleZh: '规划内容策略',
  titleEn: 'Content Strategy',
  summary: '规划跨平台内容方向、发布日历与选题排期',
  summaryZh: '规划跨平台内容方向、发布日历与选题排期',
  summaryEn: 'Plan cross-platform content pillars, calendars, and topics.',
  scenario: 'scene-growth',
  isHot: true,
  downloads: 290,
};

test('regression(Issue #410): css.js 与 FeaturedCard.jsx 彻底消除 P0 CSS/SVG/未定义变量缺陷并隔离跨插件样式', () => {
  assert.equal(/inset-x\s*:/.test(marketCss), false, 'css.js 不得包含非标准属性 inset-x:');
  assert.equal(/--dsw-alias-border-hover/.test(cardBlock), false, '方案 A 卡片样式块不得引用宿主未定义的 --dsw-alias-border-hover');
  assert.equal(/--dsw-alias-mask-92|--dsw-alias-mask-55/.test(marketCss), false, 'css.js 不得引用未定义遮罩变量');
  assert.equal(/\.omnimux-creatify-card-hover-drawer/.test(marketCss), false, 'css.js 应移除旧悬停抽屉规则');
  assert.equal(/\.omnimux-creatify-card-hover-drawer/.test(featuredSrc), false, 'FeaturedCard 不得再渲染黑底遮罩抽屉');
  assert.equal(/omnimux-creatify-drawer-uses/.test(featuredSrc), false, 'FeaturedCard 不得再渲染虚假/下载图标使用次数栏');
  assert.equal(/transition\s*:\s*all\b/.test(cardBlock), false, '方案 A 卡片样式块禁止使用 transition: all');
  assert.match(cardBlock, /corner-shape:\s*round/, '圆形/胶囊快速按钮必须配对 corner-shape: round');
  assert.match(cardBlock, /:focus-visible/, '卡片必须声明清晰的键盘 :focus-visible 焦点框');

  // 跨插件隔离：omnimux/styles.js 不得再声明裸 .omnimux-creatify-card 污染 omnimux-market
  assert.equal(
    /(?:^|\n)\s*\.omnimux-creatify-card(?::hover|\.is-active|\s*\{)/.test(omnimuxStylesSrc),
    false,
    'omnimux styles.js 不得保留裸 .omnimux-creatify-card 选择器跨插件覆盖市场卡片',
  );
});

test('regression(Issue #410): 工作台卡片静息态即左对齐展示标题、2 行简介、低对比场景名与>=28px试用按钮且支持键盘可达性', () => {
  const trZh = (k) => ({
    locale: 'zh',
    'cat.scene-growth': '营销增长',
    'workshop.badgeNew': '新',
    'workshop.hotPicks': '热门精选',
    'workshop.try': '去对话中试试',
    'workshop.tryShort': '去试试',
    'workshop.tryTooltip': '去对话试试',
  }[k] || k);

  let opened = 0;
  let tried = 0;
  const vnode = renderFeaturedCard(sampleItem, {
    tr: trZh,
    onOpen: () => { opened += 1; },
    onTry: () => { tried += 1; },
  });

  const treeText = JSON.stringify(vnode);
  assert.equal(vnode.props.role, 'button');
  assert.equal(vnode.props.tabIndex, 0);
  assert.equal(treeText.includes('290 次使用'), false, '卡片表面不显示数字使用次数');
  assert.equal(treeText.includes('100+'), false, '卡片表面不显示编造的 100+ 次数');
  assert.equal(treeText.includes('营销增长'), true, '底部左侧应保留简洁场景分类名');
  assert.equal(treeText.includes('去试试'), true, '底部右侧应渲染清晰的 去试试 CTA');

  let prevented = false;
  vnode.props.onKeyDown({
    target: vnode,
    currentTarget: vnode,
    key: 'Enter',
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(opened, 1);
  assert.equal(tried, 0);

  // 真实浏览器探测双样式注入零冲突、左对齐几何、无横向溢出且紧凑圆钮 >= 28px
  const omnimuxCss = /const STYLES = `([\s\S]*)`;/.exec(omnimuxStylesSrc)?.[1] || '';
  const probe = runStyleDomProbe({
    name: 'plan-a-market-card-e2e',
    styles: `${marketCss}\n${omnimuxCss}`,
    html: `
      <div class="sh-plaza-body" style="width:1360px">
        <div class="sh-mkt">
          <div class="featured-grid cards-grid">
            <div class="featured-card omnimux-creatify-card omx-skill-card" role="button" tabindex="0">
              <div class="omnimux-creatify-card-bg-img omx-skill-card-aura"></div>
              <div class="omnimux-creatify-dot-overlay"></div>
              <div class="omx-skill-card-header">
                <h3 class="omnimux-creatify-center-title omx-skill-card-title"><span>规划内容策略</span></h3>
                <div class="omx-skill-card-badges"><span class="omnimux-creatify-badge-hot">H</span></div>
              </div>
              <p class="omx-skill-card-desc">规划跨平台内容方向、发布日历与选题排期</p>
              <div class="omx-skill-card-footer">
                <span class="omx-skill-card-category">营销增长</span>
                <button type="button" class="omnimux-creatify-quick-try-btn" title="去对话试试" aria-label="去对话试试">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"></svg>
                  <span class="omnimux-creatify-quick-try-label">去试试</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`,
    measure: () => {
      const card = document.querySelector('.omx-skill-card');
      const title = card.querySelector('.omx-skill-card-title');
      const desc = card.querySelector('.omx-skill-card-desc');
      const btn = card.querySelector('.omnimux-creatify-quick-try-btn');
      const cRect = card.getBoundingClientRect();
      const tRect = title.getBoundingClientRect();
      const dRect = desc.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      return {
        textAlign: getComputedStyle(title).textAlign,
        titleLeftDelta: Math.round(tRect.left - cRect.left),
        descLeftDelta: Math.round(dRect.left - cRect.left),
        gapTitleDesc: Math.round(dRect.top - tRect.bottom),
        descOpacity: getComputedStyle(desc).opacity,
        btnW: Math.round(bRect.width),
        btnH: Math.round(bRect.height),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    },
  });

  assert.equal(probe.textAlign, 'left');
  assert.equal(probe.titleLeftDelta, probe.descLeftDelta, '标题与简介必须共享同一左对齐轴线');
  assert.equal(probe.gapTitleDesc >= 4, true, `标题与简介之间必须保留 >=4px 呼吸间距，实际 ${probe.gapTitleDesc}`);
  assert.equal(probe.descOpacity, '1', '静息态简介必须直接可见');
  assert.equal(probe.btnH >= 28 && probe.btnW >= 28, true, '按钮热区不得小于 28px');
  assert.equal(probe.overflowX, 0);
});
