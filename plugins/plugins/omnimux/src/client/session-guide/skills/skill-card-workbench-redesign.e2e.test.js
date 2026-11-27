/**
 * E2E 回归测试（Issue #410）：会话引导与首页探索复用 SkillCard 的方案 A 工作台样式与交互验收
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const here = dirname(fileURLToPath(import.meta.url));
const omnimuxRoot = join(here, '../../../..');
const stylesSrc = readFileSync(join(omnimuxRoot, 'src/client/session-guide/styles.js'), 'utf8');
const cardSrc = readFileSync(join(omnimuxRoot, 'src/client/session-guide/skills/SkillCard.jsx'), 'utf8');
const catalogSrc = readFileSync(join(omnimuxRoot, 'src/client/session-guide/catalog.js'), 'utf8');

const cardBlock = stylesSrc.slice(
  stylesSrc.indexOf('/* Plan A 工作台技能卡片'),
  stylesSrc.indexOf('/* 复合筛选工具栏 */'),
);

const tplItemEntry = join(omnimuxRoot, '..', 'omnimux-inspiration/src/explore/templates/TemplateCardItem.jsx');
const built = await build({
  entryPoints: [join(omnimuxRoot, 'src/client/session-guide/skills/SkillCard.jsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react'],
});
const builtTpl = await build({
  entryPoints: [tplItemEntry],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react', 'react-dom'],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const { SkillCard } = mod.exports;

const tplMod = { exports: {} };
new Function('require', 'module', 'exports', builtTpl.outputFiles[0].text)(
  createRequire(import.meta.url),
  tplMod,
  tplMod.exports,
);
const { TemplateCardItem } = tplMod.exports;

test('e2e(Issue #410): styles.js 作用域隔离且消除 inset-x/未定义边框/白色硬遮罩与 transition: all', () => {
  assert.equal(/inset-x\s*:/.test(stylesSrc), false, 'styles.js 不得包含非标准属性 inset-x:');
  assert.equal(/--dsw-alias-border-hover/.test(cardBlock), false, '工作台卡片样式不得引用未定义的 --dsw-alias-border-hover');
  assert.equal(/\.omnimux-creatify-card-hover-drawer/.test(cardBlock), false, '应移除旧悬停抽屉规则');
  assert.equal(/\.omnimux-creatify-star-btn/.test(cardBlock), false, '应移除非持久化本地星标样式');
  assert.equal(/transition\s*:\s*all\b/.test(cardBlock), false, '工作台卡片样式不得使用 transition: all');
  assert.equal(
    /(?:^|\n)\s*\.omnimux-creatify-card(?::hover|\.is-active|\s*\{)/.test(stylesSrc),
    false,
    '不得保留裸 .omnimux-creatify-card 全局规则以免污染 omnimux-market',
  );
  assert.match(cardBlock, /corner-shape:\s*round/, '按钮圆角须配对 corner-shape: round');
  assert.match(cardBlock, /\.omnimux-skill-card:focus-visible/, '卡片必须包含键盘焦点指示');
  assert.match(cardBlock, /\.omnimux-tpl-card\.is-skill-card\s*\{[^}]*border:0/, 'is-skill-card 包装器不得绘制第二层边框');
  assert.match(stylesSrc, /\.omnimux-tpl-card:not\(\.is-skill-card\):hover/, '模板悬停描边阴影不得命中 is-skill-card');
  assert.equal(/100\+\s*uses/.test(cardSrc), false, 'SkillCard 不得再包含英文硬编码假数据');
  assert.match(catalogSrc, /"skills\.card\.useShort":\s*"使用"/, 'guideZh 必须注册 skills.card.useShort');
  assert.match(catalogSrc, /"skills\.card\.useShort":\s*"Use"/, 'guideEn 必须注册 skills.card.useShort');
  assert.match(catalogSrc, /"skills\.badge\.new":\s*"新"/, 'guideZh 必须注册 skills.badge.new');
  assert.match(catalogSrc, /"skills\.badge\.new":\s*"New"/, 'guideEn 必须注册 skills.badge.new');
});

test('e2e(Issue #410): SkillCard 在会话引导与探索货架双场景下左对齐常驻简介并可点击/键盘触发', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  const prevWindow = global.window;
  const prevDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;

  try {
    const container = dom.window.document.getElementById('root');
    const root = createRoot(container);
    const selected = [];
    const skill = {
      id: 'sk-omx-content-strategy',
      title: '规划内容策略',
      titleZh: '规划内容策略',
      titleEn: 'Content Strategy',
      summary: '规划跨平台内容方向、发布日历与选题排期',
      summaryZh: '规划跨平台内容方向、发布日历与选题排期',
      summaryEn: 'Plan cross-platform content calendars.',
      scenario: 'scene-growth',
      isHot: true,
      downloads: 290,
    };

    await act(async () => {
      root.render(React.createElement(SkillCard, {
        skill,
        t: (_k, fb) => fb || '',
        onSelect: (item) => selected.push(item.id),
      }));
    });

    const card = container.querySelector('.omnimux-skill-card');
    assert.ok(card);
    assert.equal(card.getAttribute('role'), null, '外层容器不设重复 role="button"');
    assert.equal(card.getAttribute('tabindex'), null, '键盘焦点由内部语义按钮单一承载');
    assert.equal(card.querySelectorAll('[role="button"], button').length, 1, '每张卡片仅保留单一语义按钮，禁止嵌套 role="button"');
    assert.equal(card.querySelector('.omnimux-creatify-star-btn'), null, '不渲染非持久化本地星标');
    assert.equal(card.querySelector('.omnimux-creatify-card-hover-drawer'), null, '不渲染遮罩抽屉');
    assert.equal(card.textContent.includes('290'), false, '不渲染数字使用量');
    assert.match(card.querySelector('.omnimux-skill-card-summary')?.textContent || '', /规划跨平台内容方向/);
    assert.match(card.querySelector('.omx-skill-card-category')?.textContent || '', /营销增长/);

    const btn = card.querySelector('.omnimux-skill-card-btn');
    assert.ok(btn, '应渲染显式使用 CTA 按钮');
    assert.match(btn.getAttribute('aria-label') || '', /使用 Skill/);

    await act(async () => {
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(selected.length, 1, '点击 CTA 按钮不得冒泡双触发 onSelect');

    await act(async () => {
      card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(selected.length, 2, '点击卡片正文区域应可触发 onSelect');

    // 验证 TemplateCardItem 包装 is-skill-card 时同样无嵌套 role="button"，英文退路显示 Use
    await act(async () => {
      root.render(React.createElement(TemplateCardItem, {
        template: { ...skill, type: 'skill', categorySlug: 'skills' },
        locale: 'en',
        onSelect: (item) => selected.push(`tpl:${item.id}`),
      }));
    });
    const tplWrap = container.querySelector('.omnimux-tpl-card.is-skill-card');
    assert.ok(tplWrap, '应渲染 is-skill-card 外层容器');
    assert.equal(tplWrap.getAttribute('role'), null, 'is-skill-card 外层不得再带 role="button"');
    assert.equal(tplWrap.querySelectorAll('[role="button"], button').length, 1, '首页探索技能卡片仅保留单个交互按钮');
    assert.equal(tplWrap.querySelector('.omnimux-skill-card-btn-label')?.textContent, 'Use');
  } finally {
    global.window = prevWindow;
    global.document = prevDocument;
  }
});
