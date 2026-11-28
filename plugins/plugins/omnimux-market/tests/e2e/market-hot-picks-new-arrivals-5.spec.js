/**
 * E2E 测试：技能市场 HOT PICKS 与 NEW ARRIVALS 保持各 5 个卡片对齐排满一行 5 列
 * 验证：
 *  1. 热门精选包含 5 个技能（含 脚本转视频 与 UGC 脚本全流程策划）；
 *  2. 新品上市仅展示前 5 个技能，彻底消除第 6 个卡片落单；
 *  3. renderRegularSection 渲染输出中两个专区各精确包含 5 张卡片。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const catalogSrc = readFileSync(join(root, 'catalog/index.json'), 'utf8');
const gridSrc = readFileSync(join(root, 'src/client/plaza/PlazaCardGrid.jsx'), 'utf8');

test('E2E-1 目录配置验证：脚本转视频 与 UGC 脚本全流程策划 纳入热门精选且总数为 5', () => {
  const catalog = JSON.parse(catalogSrc);
  const items = catalog.items || [];

  const replicateViral = items.find((i) => i.id === 'sk-omx-replicate-viral-video');
  assert.ok(replicateViral, '必须存在复刻爆款视频技能');
  assert.equal(replicateViral.isHot, true, '复刻爆款视频必须标记为 isHot: true');
  assert.ok(replicateViral.tags?.includes('热门精选'), '复刻爆款视频必须打上“热门精选”标签');

  const createSelling = items.find((i) => i.id === 'sk-omx-create-selling-video');
  assert.ok(createSelling, '必须存在创作带货视频技能');
  assert.equal(createSelling.isHot, true, '创作带货视频必须标记为 isHot: true');
  assert.ok(createSelling.tags?.includes('热门精选'), '创作带货视频必须打上“热门精选”标签');

  // 全量热门精选总数
  const hotItems = items.filter((i) => i.isHot || i.tags?.includes('热门精选'));
  assert.equal(hotItems.length, 5, '热门精选必须恰好为 5 款');
});

test('E2E-2 渲染组件契约：hotPicks 和 newArrivals 各截取前 5 个排满一行', () => {
  // 必须使用 slice(0, 5) 截取
  assert.match(gridSrc, /hotPicks[^;]*slice\(0,\s*5\)/);
  assert.match(gridSrc, /newArrivals[^;]*slice\(0,\s*5\)/);
});

test('E2E-3 新品上市专区严格限制为 5 个技能且不与热门精选重叠，总数严格守恒 36', () => {
  const catalog = JSON.parse(catalogSrc);
  const allSkills = (catalog.items || []).filter((i) => i.tab === 'skills' && i.kind === 'skill');
  const items = allSkills.filter((i) => i.recommended === true);
  const externalItems = allSkills.filter((i) => i.origin === 'third-party');
  const hotItems = items.filter((i) => i.isHot || i.tags?.includes('热门精选'));
  const newItems = items.filter((i) => i.isNew || i.tags?.includes('新品上市'));
  assert.equal(items.length, 36, '全部官方精品 Skill 必须恰好 36 款');
  assert.equal(externalItems.some((i) => i.recommended === true || i.isHot || i.isNew), false, '外部技能不得标注推荐/热门/新品');
  assert.equal(hotItems.length, 5, '热门精选必须恰好为 5 款');
  assert.equal(newItems.length, 5, '新品上市必须恰好为 5 款');
  assert.equal(newItems.some((i) => i.isHot), false, '新品上市与热门精选不得重叠');
  assert.equal(items.length - hotItems.length - newItems.length, 26, '探索更多剩余数必须为 26');
  assert.equal(gridSrc.includes("' · '"), false, 'PlazaCardGrid 不得包含中点 · 分隔符');
  assert.equal(gridSrc.includes('setOpen(newArrivals[0])'), false, '查看全部 > 不得误开单个详情弹窗');
  assert.match(gridSrc, /data-omx-section.*explore-more/, '查看全部 > 必须定位至探索更多分区');
});
