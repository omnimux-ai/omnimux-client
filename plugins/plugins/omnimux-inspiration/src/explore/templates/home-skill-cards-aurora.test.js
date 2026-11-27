import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveSkillAuroraStyle, AURORA_PRESETS } from '../../../../omnimux/src/client/session-guide/skills/auroraGradients.js';

// 使用 esbuild 即时编译 ExploreTemplatesSection.jsx
const output = await build({
  entryPoints: [new URL('./ExploreTemplatesSection.jsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react', 'react-dom'],
});

const compiledModule = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiledModule,
  compiledModule.exports
);
const { ExploreTemplatesSection } = compiledModule.exports;

test('极光流光算法：确定性散列与 14 套炫彩流光完整性', () => {
  assert.equal(AURORA_PRESETS.length, 14, '必须具备 14 套精选极光色彩流光预设');
  const style1 = resolveSkillAuroraStyle({ id: 'sk-omx-replicate-viral-video', title: '复刻爆款视频' });
  const style2 = resolveSkillAuroraStyle({ id: 'sk-omx-cinematic', title: '电影级' });
  const style3 = resolveSkillAuroraStyle({ id: 'sk-omx-create-selling-video', title: '创作带货视频' });

  assert.ok(style1?.bg?.includes('radial-gradient'), '复刻爆款视频必须计算出高饱和度流光');
  assert.ok(style2?.bg?.includes('radial-gradient'), '电影级必须计算出高饱和度流光');
  assert.ok(style3?.bg?.includes('radial-gradient'), '创作带货视频必须计算出高饱和度流光');
});

test('首页 Skills 技能库货架卡片：100% 对齐图 2 技能插件高颜值极光样式', () => {
  const html = renderToStaticMarkup(
    React.createElement(ExploreTemplatesSection, {
      onApplyTemplate: () => {},
      onApplySkill: () => {},
    })
  );

  // 1. 验证 Skills 技能库货架行存在
  assert.ok(html.includes('data-shelf-slug="skills"'), '必须渲染 Skills 技能库货架行');
  assert.ok(html.includes('Skills 技能库'), '货架标题必须为 Skills 技能库');

  // 2. 验证 Skills 卡片具备极光流光和点阵网格（图 2 核心特征）
  assert.ok(html.includes('is-skill-card'), '技能卡片必须打上 is-skill-card 标识');
  assert.ok(html.includes('omnimux-creatify-card'), '技能卡片必须具备 creatify 卡片类名');
  assert.ok(html.includes('omnimux-creatify-dot-overlay'), '技能卡片必须渲染点阵覆盖层');
  assert.ok(html.includes('radial-gradient'), '技能卡片必须携带 radial-gradient 极光流光背景');

  // 3. 验证方案 A 工作台结构（左对齐标题行、常驻 2 行简介、低对比场景分类、无本地伪星标与伪使用数）
  assert.ok(html.includes('omx-skill-card-header'), '技能卡片必须渲染左对齐标题行');
  assert.ok(html.includes('omnimux-skill-card-summary'), '技能卡片必须渲染常驻摘要描述');
  assert.ok(html.includes('omx-skill-card-category'), '技能卡片必须渲染底栏场景分类标签');
  assert.equal(html.includes('omnimux-creatify-star-btn'), false, '必须移除非持久化本地星标');
  assert.equal(html.includes('omnimux-creatify-card-hover-drawer'), false, '必须移除旧悬停遮罩抽屉');
  assert.equal(html.includes('omnimux-creatify-drawer-uses'), false, '必须移除伪使用次数统计');

  // 4. 验证左对齐标题（兼容 .omnimux-creatify-center-title 类名）
  assert.ok(html.includes('omnimux-creatify-center-title'), '必须保留标题类名契约');
  assert.ok(html.includes('复刻爆款视频'), '必须正确渲染前置核心技能 复刻爆款视频');
  assert.ok(html.includes('电影级'), '必须正确渲染核心技能 电影级');

  // 5. 验证常驻底部 SkillCard 的使用 CTA
  assert.ok(html.includes('omnimux-skill-card-btn'), '必须具备 SkillCard 使用按键');
  assert.ok(/使用/.test(html), '使用按键必须带「使用」语义');

  // 6. 验证彻底消除单调灰黑占位符
  assert.ok(!html.includes('omnimux-tpl-placeholder"><span class="omnimux-tpl-ph-icon'), '技能卡片严禁降级为黑灰占位符');
});
