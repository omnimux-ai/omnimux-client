/**
 * canvasDismissLayer 单元与 JSDOM 行为测试：
 * 覆盖画布瞬态浮层逐层关闭的一阶、二阶、三阶交互契约。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createCanvasDismissCoordinator,
  isCanvasBlankSurface,
} from './canvasDismissLayer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const workflowRequire = createRequire(join(here, '../../../../..', 'package.json'));
const { JSDOM } = workflowRequire('jsdom');

function createDomEnv() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="wf-canvas-editor">
      <div class="react-flow">
        <div class="react-flow__pane" id="pane">
          <svg class="react-flow__background" id="bg"><pattern id="bg-child"></pattern></svg>
          <div class="react-flow__nodes">
            <div class="wf-group-node" id="group-open"></div>
            <div class="wf-group-node wf-group-node--collapsed" id="group-collapsed"></div>
            <div class="wf-material-node" id="node-a">
              <div class="wf-panel-shell">
                <div class="wf-prompt-token-editor" id="prompt"></div>
                <button id="model-trigger" type="button">Model</button>
                <button id="param-trigger" type="button">Params</button>
              </div>
            </div>
            <div class="wf-material-node" id="node-b"></div>
          </div>
        </div>
      </div>
    </div>
    <div id="model-popover" class="wf-model-cascade-popover"></div>
    <div id="param-popover" class="wf-cfg-popover">
      <button id="select-trigger" type="button">FPS</button>
    </div>
    <div id="select-dropdown" class="wf-custom-select-dropdown"></div>
  </body></html>`, { url: 'http://127.0.0.1/' });

  const { window } = dom;
  const { document } = window;
  let clock = 1000;
  const coordinator = createCanvasDismissCoordinator({
    host: window,
    now: () => clock,
  });

  const dispatchPointer = (target, type, init = {}) => {
    const evt = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    if (init.pointerId !== undefined) {
      Object.defineProperty(evt, 'pointerId', { value: init.pointerId });
    }
    target.dispatchEvent(evt);
    return evt;
  };

  const fullClick = (target, init = {}) => {
    dispatchPointer(target, 'pointerdown', { pointerId: 1, ...init });
    dispatchPointer(target, 'mousedown', init);
    dispatchPointer(target, 'pointerup', { pointerId: 1, ...init });
    dispatchPointer(target, 'mouseup', init);
    dispatchPointer(target, 'click', init);
  };

  return {
    dom,
    window,
    document,
    coordinator,
    advance: (ms) => { clock += ms; },
    dispatchPointer,
    fullClick,
    el: (id) => document.getElementById(id),
    cleanup: () => {
      coordinator.destroy();
      window.close();
    },
  };
}

test('isCanvasBlankSurface 精确区分空白面与交互节点/折叠分组', () => {
  const env = createDomEnv();
  try {
    assert.equal(isCanvasBlankSurface(env.el('pane')), true);
    assert.equal(isCanvasBlankSurface(env.el('bg')), true);
    assert.equal(isCanvasBlankSurface(env.el('bg-child')), true);
    assert.equal(isCanvasBlankSurface(env.el('group-open')), true);
    assert.equal(isCanvasBlankSurface(env.el('group-collapsed')), false);
    assert.equal(isCanvasBlankSurface(env.el('node-a')), false);
    assert.equal(isCanvasBlankSurface(env.el('node-b')), false);
    assert.equal(isCanvasBlankSurface(env.el('prompt')), false);
    assert.equal(isCanvasBlankSurface(null), false);
  } finally {
    env.cleanup();
  }
});

test('核心路径：空白点击第 1 次仅关闭浮层并拦截 Pane 失选，第 2 次正常透传取消选中', () => {
  const env = createDomEnv();
  try {
    const pane = env.el('pane');
    const modelPopover = env.el('model-popover');
    const modelTrigger = env.el('model-trigger');

    const paneEvents = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      pane.addEventListener(type, () => paneEvents.push(type));
    }

    const reasons = [];
    let unregister = null;
    unregister = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t) || modelTrigger.contains(t),
      onDismiss: (reason) => {
        reasons.push(reason);
        unregister?.();
      },
    }));

    // 第 1 次点击空白画布：关浮层，且 Pane 收不到任何导致 resetSelectedElements 的事件
    env.fullClick(pane);
    assert.deepEqual(reasons, ['outside-pointer']);
    assert.deepEqual(paneEvents, []);
    assert.equal(env.coordinator.hasActiveLayers(), false);

    // 第 2 次点击空白画布（即使仅隔 20ms）：正常透传到 Pane，触发取消选中
    env.advance(20);
    env.fullClick(pane);
    assert.deepEqual(paneEvents, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  } finally {
    env.cleanup();
  }
});

test('三阶防线：快速连点空白两次（关浮层 + 取消选中）拦截误触 dblclick 缩放，超时后正常放行', () => {
  const env = createDomEnv();
  try {
    const pane = env.el('pane');
    const modelPopover = env.el('model-popover');

    let dblClickReachedPane = 0;
    pane.addEventListener('dblclick', () => { dblClickReachedPane += 1; });

    let unregister = null;
    unregister = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      onDismiss: () => { unregister?.(); },
    }));

    // Click 1：关闭浮层
    env.fullClick(pane);
    // Click 2（150ms 后）：正常取消选中，随后浏览器合成 dblclick
    env.advance(150);
    env.fullClick(pane);
    env.dispatchPointer(pane, 'dblclick');
    assert.equal(dblClickReachedPane, 0, '连点关浮层+取消选中不得误触 dblclick 双击缩放');

    // 之后用户真正双击空白画布（间隔 > 500ms）：应正常放行
    env.advance(600);
    env.dispatchPointer(pane, 'dblclick');
    assert.equal(dblClickReachedPane, 1);
  } finally {
    env.cleanup();
  }
});

test('二阶防线：展开分组空白底板保护子节点选中，折叠分组卡片一次点击直达选中', () => {
  const env = createDomEnv();
  try {
    const groupOpen = env.el('group-open');
    const groupCollapsed = env.el('group-collapsed');
    const modelPopover = env.el('model-popover');

    let openClicks = 0;
    let collapsedClicks = 0;
    groupOpen.addEventListener('click', () => { openClicks += 1; });
    groupCollapsed.addEventListener('click', () => { collapsedClicks += 1; });

    let unreg1 = null;
    unreg1 = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      onDismiss: () => { unreg1?.(); },
    }));
    env.fullClick(groupOpen);
    assert.equal(openClicks, 0, '点击展开分组空白底板应仅收起浮层，不切选分组');

    let unreg2 = null;
    unreg2 = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      onDismiss: () => { unreg2?.(); },
    }));
    env.fullClick(groupCollapsed);
    assert.equal(collapsedClicks, 1, '点击折叠分组胶囊应关闭浮层并一次直达选中');
  } finally {
    env.cleanup();
  }
});

test('非空白目标一次直达：点击提示词 / 参数胶囊 / 另一节点立即关闭模型浮层且透传目标点击', () => {
  const env = createDomEnv();
  try {
    const modelPopover = env.el('model-popover');
    const prompt = env.el('prompt');
    const paramTrigger = env.el('param-trigger');
    const nodeB = env.el('node-b');

    for (const target of [prompt, paramTrigger, nodeB]) {
      let dismissed = 0;
      let targetClicks = 0;
      const onClick = () => { targetClicks += 1; };
      target.addEventListener('click', onClick);

      let unreg = null;
      unreg = env.coordinator.register(() => ({
        containsTarget: (t) => modelPopover.contains(t),
        onDismiss: () => {
          dismissed += 1;
          unreg?.();
        },
      }));

      env.fullClick(target);
      target.removeEventListener('click', onClick);
      assert.equal(dismissed, 1, `点击 ${target.id} 应关闭模型浮层`);
      assert.equal(targetClicks, 1, `点击 ${target.id} 应一次直达不吞事件`);
    }
  } finally {
    env.cleanup();
  }
});

test('嵌套浮层（CfgPopoverShell + CustomSelect）：点击规则与 Escape 严格 LIFO 逐层退栈', () => {
  const env = createDomEnv();
  try {
    const paramPopover = env.el('param-popover');
    const paramTrigger = env.el('param-trigger');
    const selectTrigger = env.el('select-trigger');
    const selectDropdown = env.el('select-dropdown');

    let paramOpen = true;
    let selectOpen = true;
    let unregParam = null;
    let unregSelect = null;

    unregParam = env.coordinator.register(() => ({
      containsTarget: (t) => paramPopover.contains(t) || paramTrigger.contains(t),
      excludeSelectors: ['.wf-custom-select-dropdown'],
      onDismiss: () => {
        paramOpen = false;
        unregParam?.();
      },
    }));
    unregSelect = env.coordinator.register(() => ({
      containsTarget: (t) => selectDropdown.contains(t) || selectTrigger.contains(t),
      onDismiss: () => {
        selectOpen = false;
        unregSelect?.();
      },
    }));

    // 点子下拉内部：两层都保持打开
    env.fullClick(selectDropdown);
    assert.equal(selectOpen, true);
    assert.equal(paramOpen, true);

    // 模拟画布快捷键冒泡监听
    let canvasEscapeCount = 0;
    env.window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') canvasEscapeCount += 1;
    });

    // Escape 第 1 次：仅关闭顶层 CustomSelect，不关参数浮层，不触发画布 Escape
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(selectOpen, false);
    assert.equal(paramOpen, true);
    assert.equal(canvasEscapeCount, 0);

    // Escape 第 2 次：关闭参数浮层，仍不触发画布 Escape
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(paramOpen, false);
    assert.equal(canvasEscapeCount, 0);

    // Escape 第 3 次（无浮层）：正常到达画布快捷键
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(canvasEscapeCount, 1);
  } finally {
    env.cleanup();
  }
});

test('二阶防线：中键平移与右键菜单不阻断，手势中断/pointercancel/blur 不误吞下一次空白点击', () => {
  const env = createDomEnv();
  try {
    const pane = env.el('pane');
    const modelPopover = env.el('model-popover');

    let middleDown = 0;
    let rightDown = 0;
    pane.addEventListener('pointerdown', (e) => {
      if (e.button === 1) middleDown += 1;
      if (e.button === 2) rightDown += 1;
    });

    // 中键按下：关闭浮层但不阻断画布中键平移
    let unreg1 = null;
    unreg1 = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      onDismiss: () => { unreg1?.(); },
    }));
    env.dispatchPointer(pane, 'pointerdown', { button: 1, pointerId: 1 });
    assert.equal(middleDown, 1);

    // 右键按下：关闭浮层但不阻断右键菜单/右键平移
    let unreg2 = null;
    unreg2 = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      onDismiss: () => { unreg2?.(); },
    }));
    env.dispatchPointer(pane, 'pointerdown', { button: 2, pointerId: 2 });
    assert.equal(rightDown, 1);

    // 左键按下后触发 pointercancel（未产生 click）：下一次正常左键点击必须透传
    let normalClicks = 0;
    pane.addEventListener('click', () => { normalClicks += 1; });

    let unreg3 = null;
    unreg3 = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      onDismiss: () => { unreg3?.(); },
    }));
    env.dispatchPointer(pane, 'pointerdown', { button: 0, pointerId: 3 });
    env.dispatchPointer(pane, 'pointercancel', { pointerId: 3 });

    env.advance(10);
    env.fullClick(pane);
    assert.equal(normalClicks, 1, '被中断的手势绝不能滞留吞掉下一次空白点击');
  } finally {
    env.cleanup();
  }
});

test('兼容仅派发 mousedown 的测试环境 + shouldHandleEscape 让位与 IME 组字保护', () => {
  const env = createDomEnv();
  try {
    const pane = env.el('pane');
    const modelPopover = env.el('model-popover');

    let paneClicks = 0;
    pane.addEventListener('click', () => { paneClicks += 1; });

    let dismissed = 0;
    let allowEscape = false;
    let unreg = null;
    unreg = env.coordinator.register(() => ({
      containsTarget: (t) => modelPopover.contains(t),
      shouldHandleEscape: () => allowEscape,
      onDismiss: () => {
        dismissed += 1;
        unreg?.();
      },
    }));

    // IME 组字态 Escape 不关闭
    const imeEsc = new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    Object.defineProperty(imeEsc, 'isComposing', { value: true });
    env.window.dispatchEvent(imeEsc);
    assert.equal(dismissed, 0);

    // shouldHandleEscape 返回 false（如内联重命名）时让位不关闭
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(dismissed, 0);

    // 仅派发 mousedown + click（无 pointerdown）仍能正确关闭并拦截空白 click
    env.dispatchPointer(pane, 'mousedown', { button: 0 });
    env.dispatchPointer(pane, 'click', { button: 0 });
    assert.equal(dismissed, 1);
    assert.equal(paneClicks, 0);
  } finally {
    env.cleanup();
  }
});

test('全局一致性契约：所有画布瞬态浮层均接入统一协调器，被动悬停预览不阻断空白失选', () => {
  const mustAdopt = [
    '../components/MaterialNode/ConfigPanel/ModelCascadeMenu.tsx',
    '../components/MaterialNode/ConfigPanel/cfg/CfgPopoverShell.tsx',
    '../../ui/CustomSelect.tsx',
    '../../ui/CustomDropdown.tsx',
    '../components/PromptTokenEditor/MentionPopover.tsx',
    '../components/FloatingTopPill.tsx',
    '../components/FloatingSelectionToolbar.tsx',
    '../components/GroupNode/GroupTopBar.tsx',
    '../components/ContextMenu.tsx',
    '../components/CanvasNodeActionMenu.tsx',
    '../components/CanvasPageHeader.tsx',
    '../components/WorkflowTemplatePanel.tsx',
    '../hooks/useClickOutside.ts',
    '../components/assets/popovers/TypeFilterPopover.tsx',
    '../components/assets/popovers/TagFilterPopover.tsx',
    '../components/assets/popovers/SortFilterPopover.tsx',
    '../components/assets/popovers/TimeFilterPopover.tsx',
    '../components/assets/menus/AssetItemContextMenu.tsx',
    '../components/assets/menus/FolderContextMenu.tsx',
    '../components/assets/menus/CanvasItemContextMenu.tsx',
  ];

  for (const rel of mustAdopt) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /useCanvasDismissLayer\(/, `${rel} 必须接入 useCanvasDismissLayer`);
  }

  // 被动悬停预览不接入空白拦截，避免悬停移出后 180ms 内点空白失选被吞
  const hoverSrc = readFileSync(
    join(here, '../components/MaterialNode/ConfigPanel/SlotWells/SlotHoverPreview.tsx'),
    'utf8',
  );
  assert.doesNotMatch(hoverSrc, /useCanvasDismissLayer\(/);
});
