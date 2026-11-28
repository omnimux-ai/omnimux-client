import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import * as esbuild from 'esbuild';
import React from 'react';
import catalog from '../../catalog/index.json' with { type: 'json' };
import * as SkillShelf from '../../src/client/skill-picker-logic.js';
import * as plazaUtils from '../../src/client/plaza/plazaUtils.js';
import { updateInstalledItemsList } from '../../src/client/plaza/usePlazaFilter.js';
import * as auroraGradients from '../../src/client/plaza/auroraGradients.js';
import * as cardCoversData from '../../src/client/plaza/cardCoversData.js';
import { loadClientModule } from '../helpers/client-esm-loader.mjs';
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs';

const featuredCardSrc = readFileSync(new URL('../../src/client/plaza/FeaturedCard.jsx', import.meta.url), 'utf8');
const compiledFeaturedCard = esbuild.transformSync(featuredCardSrc, { loader: 'jsx', format: 'cjs' }).code;
const featuredCardModule = { exports: {} };
new Function('require', 'module', 'exports', compiledFeaturedCard)(
  (id) => {
    if (id === 'react') return React;
    if (id.includes('plazaUtils')) return plazaUtils;
    if (id.includes('cardCoversData')) return cardCoversData;
    if (id.includes('auroraGradients')) return auroraGradients;
    return {};
  },
  featuredCardModule,
  featuredCardModule.exports,
);

const plazaCardGridSrc = readFileSync(new URL('../../src/client/plaza/PlazaCardGrid.jsx', import.meta.url), 'utf8');
const compiledPlazaCardGrid = esbuild.transformSync(plazaCardGridSrc, { loader: 'jsx', format: 'cjs' }).code;
const plazaCardGridModule = { exports: {} };
new Function('require', 'module', 'exports', compiledPlazaCardGrid)(
  (id) => {
    if (id === 'react') return React;
    if (id.includes('plazaUtils')) return plazaUtils;
    if (id.includes('FeaturedCard')) return featuredCardModule.exports;
    return {};
  },
  plazaCardGridModule,
  plazaCardGridModule.exports,
);
const { renderRegularSection } = plazaCardGridModule.exports;

function collectNodes(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectNodes(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  const children = node.props?.children;
  if (children) collectNodes(children, predicate, out);
  return out;
}

function collectText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object') return collectText(node.props?.children);
  return '';
}

const sealeapSkills = catalog.items.filter((item) => item.kind === 'skill' && item.origin === 'third-party' && String(item.id).startsWith('sk-sealeap-'));

test('SeaLeap 目录入库完整性：195 项准确映射至市场洞察 (44) 与营销增长 (151)', () => {
  assert.equal(sealeapSkills.length, 195);
  assert.equal(sealeapSkills.filter((s) => s.scenario === 'scene-research').length, 44);
  assert.equal(sealeapSkills.filter((s) => s.scenario === 'scene-growth').length, 151);

  const platforms = new Set(sealeapSkills.map((s) => s.subtitle));
  assert.deepEqual(
    [...platforms].sort(),
    ['Etsy', 'OZON', 'Shopify', 'TikTok Shop', 'Walmart', 'Wayfair', 'eBay', '美客多'].sort(),
  );

  for (const s of sealeapSkills) {
    assert.equal(s.recommended, false);
    assert.equal(s.license, 'MIT');
    assert.equal(s.owner, 'SeaLeap');
    assert.equal(s.author, 'SeaLeap');
    assert.equal(s.source?.type, 'git');
    assert.equal(s.source?.repo, 'xjli360/sealeap-ecommerce-skills');
    assert.equal(s.source?.ref, 'main');
    assert.ok(String(s.source?.path || '').startsWith('sealeap-amazon-skills/'));
  }
});

test('广场「全部」视图严格守恒 36 项，零外部技能泄露；单场景官方置顶在先', () => {
  const all = SkillShelf.plazaDiscoverySections([], { category: '' });
  const totalInAll = new Map([...all.featured, ...all.regular].map((i) => [i.slug || i.id, i]));
  assert.equal(totalInAll.size, 36);
  assert.equal([...totalInAll.values()].some((i) => plazaUtils.isExternalCatalogSkill(i)), false);

  const research = SkillShelf.plazaDiscoverySections([], { category: 'scene-research' });
  const researchMerged = [...research.featured, ...research.regular];
  const researchFirstExternal = researchMerged.findIndex((i) => plazaUtils.isExternalCatalogSkill(i));
  assert.ok(researchFirstExternal === 8, `市场洞察应先排 8 个官方技能，实际首外部索引为 ${researchFirstExternal}`);
  assert.equal(researchMerged.slice(0, researchFirstExternal).some((i) => plazaUtils.isExternalCatalogSkill(i)), false);
  assert.equal(researchMerged.filter((i) => plazaUtils.isExternalCatalogSkill(i)).length, 44);

  const growth = SkillShelf.plazaDiscoverySections([], { category: 'scene-growth' });
  const growthMerged = [...growth.featured, ...growth.regular];
  const growthFirstExternal = growthMerged.findIndex((i) => plazaUtils.isExternalCatalogSkill(i));
  assert.equal(growthFirstExternal, 8, '营销增长应先排 8 个官方技能');
  assert.equal(growthMerged.filter((i) => plazaUtils.isExternalCatalogSkill(i)).length, 151);
});

test('PlazaCardGrid 平台二级筛选与未安装/已安装外部卡片 CTA 表现正常', () => {
  const tr = (k) => (k === 'locale' ? 'zh' : k);
  const research = SkillShelf.plazaDiscoverySections([], { category: 'scene-research' });
  const researchMerged = [...research.featured, ...research.regular];
  const treeAll = renderRegularSection({
    category: 'scene-research',
    hasQuery: false,
    regularItems: researchMerged,
    status: 'ready',
    page: 1,
    err: '',
    tr,
    platformFilter: '',
    onInstallExternal: () => {},
  });

  const chips = collectNodes(treeAll, (n) => typeof n.props?.className === 'string' && n.props.className.includes('omx-platform-chip'));
  const chipLabels = chips.map((c) => collectText(c));
  assert.ok(chipLabels.includes('OZON'));
  assert.ok(chipLabels.includes('美客多'));
  assert.ok(chipLabels.includes('Shopify'));

  const ozonOnly = renderRegularSection({
    category: 'scene-research',
    hasQuery: false,
    regularItems: researchMerged,
    status: 'ready',
    page: 1,
    err: '',
    tr,
    platformFilter: 'OZON',
    onInstallExternal: () => {},
  });
  const ozonCards = collectNodes(ozonOnly, (n) => typeof n.props?.className === 'string' && n.props.className.includes('omx-skill-card-install-btn'));
  assert.equal(ozonCards.length, researchMerged.filter((i) => i.subtitle === 'OZON').length);
  const headerCounts = collectNodes(ozonOnly, (n) => n.props?.className === 'regular-title-count');
  assert.equal(collectText(headerCounts[0]), String(ozonCards.length), '单平台筛选头部总数必须仅统计当前可见卡片，不得计入隐藏官方技能');

  // 标记已安装后应出现已启用角标与去试试按钮，不再展示安装按钮
  const installedResearch = researchMerged.map((i) => (
    i.slug === 'sealeap-shopify-product-selection' ? { ...i, installed: true } : i
  ));
  const shopifyInstalledTree = renderRegularSection({
    category: 'scene-research',
    hasQuery: false,
    regularItems: installedResearch,
    status: 'ready',
    page: 1,
    err: '',
    tr,
    platformFilter: 'Shopify',
    onInstallExternal: () => {},
  });
  assert.equal(collectNodes(shopifyInstalledTree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('omx-skill-card-badge-enabled')).length, 1);
});

test('DetailCard 不得对未安装外部技能展示伪造视频脚手架步骤文案', () => {
  const skillsUiSrc = readFileSync(new URL('../../src/client/skills-ui.js', import.meta.url), 'utf8');
  assert.equal(skillsUiSrc.includes('Intake and Lock the Core Brief'), false, '必须移除伪造的视频步骤占位文案');
  assert.ok(skillsUiSrc.includes('omx-external-preview-card'), 'DetailCard 必须包含外部技能诚实预览面板');
});

test('Chromium 实测：外部卡片安装按钮 pointer-events 与层叠命中优先于平铺触发器，MIT 徽章不使用未定义 Token', () => {
  const cssFileSrc = readFileSync(new URL('../../src/client/css.js', import.meta.url), 'utf8');
  const marketCss = /const CSS = `([\s\S]*?)`\s*;/.exec(cssFileSrc)?.[1] || '';
  assert.ok(marketCss.includes('.omx-skill-card-install-btn'), 'css.js 必须包含外部安装按钮规则');
  const extBadgeMatch = /\.omx-skill-card-badge-external\s*\{([^}]*)\}/.exec(marketCss);
  assert.ok(extBadgeMatch, 'css.js 必须包含 .omx-skill-card-badge-external 规则');
  assert.equal(extBadgeMatch[1].includes('--dsw-alias-bg-elevated'), false, '.omx-skill-card-badge-external 不得引用宿主未定义的 --dsw-alias-bg-elevated');

  const html = `
    <style>
      :root {
        --dsw-alias-bg-layer-2: rgb(36, 38, 45);
        --dsw-alias-border-l2: rgba(255, 255, 255, 0.14);
        --dsw-alias-brand-primary: rgb(111, 89, 255);
        --dsw-alias-label-primary-foreground: rgb(255, 255, 255);
        --dsw-alias-label-secondary: rgb(161, 161, 170);
      }
    </style>
    <div class="sh-plaza-body" style="width:960px">
      <div class="sh-mkt">
        <div class="featured-grid cards-grid">
          <div class="featured-card omnimux-creatify-card omx-skill-card">
            <div class="omnimux-creatify-card-bg-img omx-skill-card-aura"></div>
            <div class="omnimux-creatify-dot-overlay"></div>
            <button type="button" class="omx-skill-card-open-trigger" aria-label="Shopify 爆品发现"></button>
            <div class="omx-skill-card-header">
              <h3 class="omnimux-creatify-center-title omx-skill-card-title"><span>Shopify 爆品发现</span></h3>
              <div class="omx-skill-card-badges"><span class="omx-skill-card-badge-external">MIT</span></div>
            </div>
            <p class="omx-skill-card-desc">多维度分析 Shopify 利基市场与爆品潜力</p>
            <div class="omx-skill-card-footer">
              <span class="omx-skill-card-category">Shopify</span>
              <button type="button" class="omx-skill-card-install-btn" aria-label="安装 Shopify 爆品发现">安装</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const probe = runStyleDomProbe({
    name: 'sealeap-external-card-hit-test',
    styles: marketCss,
    html,
    measure: () => {
      const btn = document.querySelector('.omx-skill-card-install-btn');
      const desc = document.querySelector('.omx-skill-card-desc');
      const badge = document.querySelector('.omx-skill-card-badge-external');
      const bRect = btn.getBoundingClientRect();
      const dRect = desc.getBoundingClientRect();
      const btnHit = document.elementFromPoint(bRect.left + bRect.width / 2, bRect.top + bRect.height / 2);
      const descHit = document.elementFromPoint(dRect.left + dRect.width / 2, dRect.top + dRect.height / 2);
      const btnCs = getComputedStyle(btn);
      const badgeCs = getComputedStyle(badge);
      return {
        pointerEvents: btnCs.pointerEvents,
        zIndex: btnCs.zIndex,
        btnHeight: Math.round(bRect.height),
        btnHitsInstallBtn: Boolean(btnHit && btnHit.closest && btnHit.closest('.omx-skill-card-install-btn')),
        descHitsOpenTrigger: Boolean(descHit && descHit.classList && descHit.classList.contains('omx-skill-card-open-trigger')),
        badgeBg: badgeCs.backgroundColor,
      };
    },
  });

  assert.equal(probe.pointerEvents, 'auto');
  assert.ok(Number(probe.zIndex) >= 3, `zIndex 应 >= 3，实际为 ${probe.zIndex}`);
  assert.ok(probe.btnHeight >= 28, `按钮高度应 >= 28px，实际为 ${probe.btnHeight}`);
  assert.equal(probe.btnHitsInstallBtn, true, '点击外部安装按钮中心点必须命中 .omx-skill-card-install-btn');
  assert.equal(probe.descHitsOpenTrigger, true, '点击简介区必须命中平铺详情按钮');
  assert.equal(probe.badgeBg, 'rgb(36, 38, 45)', 'MIT 徽章底色必须走已定义的 --dsw-alias-bg-layer-2');
});

test('updatePlazaItemInstalled 卸载时同步清理 providerSlugs，DetailCard 从我的 Skill 卸载后保留外部预览元数据', async () => {
  let items = [{ id: 'sk-sealeap-1', slug: 'sealeap-shopify-product-selection', installed: true }];
  let installedItems = [{ slug: 'sealeap-shopify-product-selection', installed: true }];
  let providerSlugs = ['sealeap-shopify-product-selection', 'video-hook-analysis'];
  let openItem = { slug: 'sealeap-shopify-product-selection', installed: true };
  plazaUtils.updatePlazaItemInstalled(
    { id: 'sk-sealeap-1', slug: 'sealeap-shopify-product-selection' },
    false,
    {
      setItems: (fn) => { items = fn(items); },
      setInstalledItems: (fn) => { installedItems = fn(installedItems); },
      setProviderSlugs: (fn) => { providerSlugs = fn(providerSlugs); },
      setOpen: (fn) => { openItem = fn(openItem); },
    },
    updateInstalledItemsList,
  );
  assert.equal(items[0].installed, false);
  assert.equal(installedItems.length, 0);
  assert.deepEqual(providerSlugs, ['video-hook-analysis']);
  assert.equal(openItem.installed, false);

  const vh = (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.flat() } });
  const stateSlots = new Map();
  const effectSlots = new Map();
  let hookIdx = 0;
  let effectIdx = 0;
  let pendingEffects = [];
  let detailCalls = 0;
  const ReactMock = {
    useContext: () => (k) => k,
    useState: (init) => {
      const idx = hookIdx++;
      if (!stateSlots.has(idx)) stateSlots.set(idx, init);
      const setter = (next) => {
        const cur = stateSlots.get(idx);
        stateSlots.set(idx, typeof next === 'function' ? next(cur) : next);
      };
      return [stateSlots.get(idx), setter];
    },
    useEffect: (fn, deps) => {
      const idx = effectIdx++;
      const prev = effectSlots.get(idx);
      const changed = !deps || !prev || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]));
      if (changed) {
        effectSlots.set(idx, { deps: deps || null });
        pendingEffects.push(fn);
      }
    },
    useRef: () => ({ current: null }),
    createContext: () => ({ Provider: 'Provider' }),
  };
  const { Drawer: renderDrawer } = loadClientModule('./skills-ui.js', {
    globals: {
      document: { body: { style: {} } },
      window: { addEventListener: () => {}, removeEventListener: () => {} },
    },
    modules: {
      './boot.js': {
        h: vh,
        React: ReactMock,
        useState: ReactMock.useState,
        useEffect: ReactMock.useEffect,
        Button: (props) => vh('button', props, props.children),
        IconButton: (props) => vh('button', props, props.children),
      },
      './portal.js': { createPortal: (node) => node, fallbackPortal: null },
      './i18n.js': {
        useTr: () => (k) => k,
        lookup: (k) => k,
        catLabel: () => '市场洞察',
        skillDesc: (x) => x?.description || x?.summary || '',
        skillTitle: (x) => x?.name || x?.title || '',
      },
      './api.js': {
        api: async (method) => {
          if (method === 'detail') {
            detailCalls += 1;
            return {
              ok: true,
              installed: true,
              card: {
                slug: 'sealeap-shopify-product-selection',
                installed: true,
                origin: 'third-party',
                subtitle: 'Shopify',
                license: 'MIT',
                author: 'SeaLeap',
                source: { type: 'git', repo: 'xjli360/sealeap-ecommerce-skills', path: 'sealeap-amazon-skills/s1', ref: 'main' },
              },
            };
          }
          if (method === 'skillContent') {
            return { ok: true, found: false, external: true };
          }
          return { ok: true };
        },
      },
      './session-create.js': { trySkillInSession: async () => ({ ok: true }) },
    },
  });

  const expand = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props || {}));
    const children = node.props?.children;
    return { ...node, props: { ...(node.props || {}), children: children ? expand(children) : children } };
  };
  const renderWithItem = (propItem) => {
    hookIdx = 0;
    effectIdx = 0;
    pendingEffects = [];
    return expand(renderDrawer({ item: propItem, onClose: () => {} }));
  };
  const flushEffects = async () => {
    for (const fn of [...pendingEffects]) await fn();
  };

  renderWithItem({ slug: 'sealeap-shopify-product-selection', installed: true });
  await flushEffects();
  renderWithItem({ slug: 'sealeap-shopify-product-selection', installed: true });
  await flushEffects();

  // 模拟从「我的 Skill」卸载后父级传入不含 origin/source 的精简对象（同 slug 不重调 detail）
  renderWithItem({ slug: 'sealeap-shopify-product-selection', installed: false });
  await flushEffects();
  const afterTree = renderWithItem({ slug: 'sealeap-shopify-product-selection', installed: false });
  assert.equal(detailCalls, 1, '同 slug 属性更新不应重新拉取 detail');
  const previewNodes = collectNodes(afterTree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('omx-external-preview-card'));
  assert.equal(previewNodes.length, 1, '从我的 Skill 卸载后重渲染必须保留 origin/source 并渲染诚实外部预览面板');
});
