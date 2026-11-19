/**
 * Issue #109 保留项回归守卫（评审 P2 补强）：
 * - 画布定位结果直接可见 → 不再回执 Toast；
 * - 无音轨属于失败/阻断语义 → 必须保持 warning，不能降级为 info；
 * - 自备渠道失效横幅是一键恢复入口 → 必须保留。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDrawerSrc = readFileSync(join(here, 'AssetsDrawer.tsx'), 'utf8');
const materialNodeSrc = readFileSync(join(here, 'MaterialNode/index.tsx'), 'utf8');
const configPanelSrc = readFileSync(join(here, 'MaterialNode/ConfigPanel/index.tsx'), 'utf8');

test('Issue #109: 画布定位只执行定位，不追加「已定位」Toast', () => {
  assert.doesNotMatch(assetsDrawerSrc, /已在创作画布中定位/);
  assert.doesNotMatch(assetsDrawerSrc, /toast\.info/);
});

test('Issue #109: 无音轨失败提示保持 warning 语义', () => {
  const noAudioBlock = materialNodeSrc.match(/noAudioStream[\s\S]{0,300}/)?.[0] ?? '';
  assert.match(noAudioBlock, /toast\.warning\(/);
  assert.doesNotMatch(noAudioBlock, /toast\.info\(/);
});

test('Issue #109: 自备渠道失效横幅与一键切换入口保留', () => {
  assert.match(configPanelSrc, /data-testid="wf-channel-fallback-banner"/);
  assert.match(configPanelSrc, /data-testid="wf-channel-fallback-action"/);
});
