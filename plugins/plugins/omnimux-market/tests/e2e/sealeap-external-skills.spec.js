import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import * as esbuild from 'esbuild';
import React from 'react';
import catalog from '../../catalog/index.json' with { type: 'json' };
import * as SkillShelf from '../../src/client/skill-picker-logic.js';
import * as plazaUtils from '../../src/client/plaza/plazaUtils.js';
import * as auroraGradients from '../../src/client/plaza/auroraGradients.js';
import * as cardCoversData from '../../src/client/plaza/cardCoversData.js';

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
