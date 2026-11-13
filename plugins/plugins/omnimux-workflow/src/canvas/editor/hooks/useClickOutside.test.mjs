/**
 * W2 T2.6 测试：useClickOutside exclude 判定（纯逻辑，计划 §8）。
 *
 * isOutsideClickTarget 设计为鸭式接口（closest/contains），用最小 fake
 * 对象即可完整覆盖判定分支——不依赖 jsdom（npm 在该 workspace 安装
 * jsdom 受 prepare 脚本/浅安装限制，且 fake 已覆盖全部逻辑路径）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS,
  isOutsideClickTarget,
} from './useClickOutside.ts';

/** 构造命中指定选择器的事件目标（closest 命中返回非 null） */
function fakeTarget(matchedSelector = null) {
  return {
    closest: (selector) => (selector === matchedSelector ? { matched: selector } : null),
  };
}

/** 构造 contains 结果固定的浮层容器 */
function fakeContainer(containsResult) {
  return { contains: () => containsResult };
}

test('exclude 白名单：默认包含 antd Select 下拉与 Slider 滑块（计划 §9 坑#4）', () => {
  assert.ok(DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS.includes('.ant-select-dropdown'));
  assert.ok(DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS.includes('.ant-slider-thumb'));
  assert.ok(DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS.includes('.wf-modal-overlay'));
});

test('点击面板自身内部 → 不关闭', () => {
  const panel = fakeContainer(true);
  assert.equal(isOutsideClickTarget(fakeTarget(), [panel]), false);
});

test('点击面板外部 → 关闭', () => {
  const panel = fakeContainer(false);
  assert.equal(isOutsideClickTarget(fakeTarget(), [panel]), true);
});

test('点击 antd Select 下拉选项 → 不关闭（下拉渲染在面板 DOM 之外）', () => {
  const panel = fakeContainer(false);
  assert.equal(
    isOutsideClickTarget(fakeTarget('.ant-select-dropdown'), [panel]),
    false,
  );
});

test('点击 antd Slider 滑块 → 不关闭', () => {
  const panel = fakeContainer(false);
  assert.equal(isOutsideClickTarget(fakeTarget('.ant-slider-thumb'), [panel]), false);
});

test('自定义 excludeSelectors 生效', () => {
  const panel = fakeContainer(false);
  assert.equal(
    isOutsideClickTarget(fakeTarget('.custom-pop'), [panel], ['.custom-pop']),
    false,
  );
  // 默认白名单不含的选择器仍判外部
  assert.equal(
    isOutsideClickTarget(fakeTarget('.custom-pop'), [panel], []),
    true,
  );
});

test('空 target / 空容器边界', () => {
  assert.equal(isOutsideClickTarget(null, [fakeContainer(false)]), false);
  assert.equal(isOutsideClickTarget(undefined, []), false);
  // 无容器时任何非空 target 都是外部
  assert.equal(isOutsideClickTarget(fakeTarget(), []), true);
});

test('多容器：任一容器包含即不关闭', () => {
  assert.equal(
    isOutsideClickTarget(fakeTarget(), [fakeContainer(false), fakeContainer(true)]),
    false,
  );
  assert.equal(
    isOutsideClickTarget(fakeTarget(), [fakeContainer(false), fakeContainer(false)]),
    true,
  );
});
