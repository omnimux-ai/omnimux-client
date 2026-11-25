/**
 * 真实渲染 + CSS 层叠 + 键盘/受控互斥回归测试：
 * 锁定画布底部工具栏仅保留既有 5 颗纯图标按钮（零文本）、同心圆「+」按钮、
 * 指针模式聚合触发器与悬浮切换菜单交互（含 StrictMode 受控互斥、方向键导航、Escape/选切焦点回归），
 * 以及同页加载 omnimux-market 样式时的样式隔离。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const themeSrc = readFileSync(join(here, '../../theme/workbench-theme.css'), 'utf8');
const componentsSrc = readFileSync(join(here, '../../theme/components.css'), 'utf8');
const marketCssSrc = readFileSync(
  join(here, '../../../../../omnimux-market/src/client/css.js'),
  'utf8',
);
const marketCssMatch = /const CSS = `([\s\S]*?)`;/.exec(marketCssSrc);
assert.ok(marketCssMatch, 'omnimux-market css.js must expose CSS template');
const marketCss = marketCssMatch[1];

const workflowPkgPath = join(here, '../../../../package.json');
const pluginsPkgPath = join(here, '../../../../../../package.json');

async function loadToolbarComponent() {
  const workflowRequire = createRequire(workflowPkgPath);
  const tempDir = mkdtempSync(join(tmpdir(), 'wf-toolbar-icon-only-'));
  const outfile = join(tempDir, 'toolbar.cjs');
  try {
    await build({
      entryPoints: [join(here, 'Toolbar.tsx')],
      bundle: true,
      outfile,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      plugins: [
        {
          name: 'resolve-workflow-react',
          setup(b) {
            b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
              path: workflowRequire.resolve(args.path),
              external: true,
            }));
          },
        },
      ],
      nodePaths: [
        join(here, '../../../../node_modules'),
        join(here, '../../../../../../node_modules'),
      ],
      loader: { '.css': 'text' },
    });
    const loaded = workflowRequire(outfile);
    return loaded.default;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test('真实渲染回归：底栏 5 颗按钮纯图标零文本、StrictMode 受控互斥与键盘焦点完整，且与 omnimux-market 样式同页加载不串扰', async () => {
  const Toolbar = await loadToolbarComponent();
  const workflowRequire = createRequire(workflowPkgPath);
  const pluginsRequire = createRequire(pluginsPkgPath);
  const React = workflowRequire('react');
  const { createRoot } = workflowRequire('react-dom/client');
  const { JSDOM } = pluginsRequire('jsdom');

  const dom = new JSDOM(
    `<!doctype html><html><head><style>${marketCss}</style><style>${themeSrc}</style><style>${componentsSrc}</style></head><body><div class="wf-canvas-root"><div id="mount"></div></div></body></html>`,
    { url: 'http://127.0.0.1/' },
  );

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };

  let rafQueue = [];
  const flushRaf = () => {
    const callbacks = rafQueue;
    rafQueue = [];
    for (const cb of callbacks) cb(Date.now());
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    requestAnimationFrame: (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const consoleErrors = [];
  const origConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => String(a)).join(' '));
  };

  const modeChanges = [];
  let assetsClicks = 0;
  let helpClicks = 0;
  let setExternalAddOpen = null;
  let setExternalMode = null;

  function ControlledHost() {
    const [isAddMenuOpen, setIsAddMenuOpen] = React.useState(false);
    const [pointerMode, setPointerMode] = React.useState('select');
    setExternalAddOpen = setIsAddMenuOpen;
    setExternalMode = setPointerMode;

    return React.createElement(Toolbar, {
      onAddNode: () => {},
      pointerMode,
      onPointerModeChange: (mode) => {
        modeChanges.push(mode);
        setPointerMode(mode);
      },
      isAddMenuOpen,
      onToggleAddMenu: () => setIsAddMenuOpen((prev) => !prev),
      onOpenAssets: () => { assetsClicks += 1; },
      onOpenHelp: () => { helpClicks += 1; },
      onInsertTemplate: () => {},
      templates: [],
    });
  }

  const mount = dom.window.document.getElementById('mount');
  const root = createRoot(mount);

  try {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(ControlledHost)));
    });

    const { window } = dom;
    const { document } = window;
    const toolbar = document.querySelector('.wf-canvas-toolbar');
    assert.ok(toolbar, 'missing .wf-canvas-toolbar root');

    // 1. 底栏仅保留既有 5 颗纯图标按钮（不新增功能、零文本）
    const dockButtons = [
      ...toolbar.querySelectorAll(':scope > button, :scope > .wf-canvas-toolbar__anchor > button'),
    ];
    assert.equal(dockButtons.length, 5, `expected 5 dock buttons, got ${dockButtons.length}`);

    for (const btn of dockButtons) {
      assert.equal(
        (btn.textContent || '').trim(),
        '',
        `dock button must stay icon-only without text, found "${btn.textContent}" on ${btn.className}`,
      );
      assert.ok(btn.querySelectorAll('svg').length >= 1, `dock button must render icon svg: ${btn.className}`);
      assert.ok((btn.getAttribute('aria-label') || '').trim().length > 0, `missing aria-label on ${btn.className}`);
      assert.ok((btn.getAttribute('title') || '').trim().length > 0, `missing title on ${btn.className}`);
    }

    // 2. 主「+」按钮在同页加载 omnimux-market CSS + theme + components 时保持 40x40 同心圆与浅/暗高对比
    const primaryAdd = toolbar.querySelector('button.wf-canvas-toolbar__item--primary-add');
    assert.ok(primaryAdd, 'missing primary add button');
    const lightStyle = window.getComputedStyle(primaryAdd);
    assert.equal(lightStyle.width, '40px', `expected primary add width 40px, got ${lightStyle.width}`);
    assert.equal(lightStyle.height, '40px', `expected primary add height 40px, got ${lightStyle.height}`);
    assert.equal(lightStyle.borderRadius, '50%');
    assert.equal(lightStyle.padding, '0px');
    assert.equal(lightStyle.backgroundColor, 'rgb(24, 25, 28)');

    document.body.setAttribute('data-ds-dark-theme', '');
    const darkStyle = window.getComputedStyle(primaryAdd);
    assert.equal(darkStyle.width, '40px');
    assert.equal(darkStyle.height, '40px');
    assert.equal(darkStyle.backgroundColor, 'rgb(255, 255, 255)');
    assert.equal(darkStyle.color, 'rgb(24, 25, 28)');

    // 3. 受控 StrictMode 互斥：先开「+」菜单，再点指针模式触发器，必须关闭「+」菜单且不双触发/不报渲染期更新错
    const modeTrigger = toolbar.querySelector('button.wf-canvas-toolbar__mode-trigger');
    assert.ok(modeTrigger, 'missing pointer mode trigger');

    await React.act(async () => {
      primaryAdd.click();
    });
    assert.ok(toolbar.querySelector('.wf-node-menu'), 'add node menu must open');

    await React.act(async () => {
      modeTrigger.click();
    });
    assert.equal(toolbar.querySelector('.wf-node-menu'), null, 'opening pointer menu under StrictMode must close controlled add menu');
    assert.ok(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), 'pointer menu must open');
    assert.equal(modeTrigger.getAttribute('aria-expanded'), 'true');
    assert.equal(modeTrigger.classList.contains('wf-canvas-toolbar__mode-trigger--open'), true);

    const options = [...toolbar.querySelectorAll('.wf-canvas-toolbar__mode-menu button[role="menuitemradio"]')];
    assert.equal(options.length, 2);
    assert.equal(options[0].getAttribute('data-mode'), 'select');
    assert.equal(options[0].getAttribute('aria-checked'), 'true');
    assert.equal(options[0].querySelector('.wf-canvas-toolbar__mode-check svg') !== null, true);
    assert.equal(options[0].querySelector('.wf-canvas-toolbar__mode-kbd')?.textContent, 'V');
    assert.equal(options[1].getAttribute('data-mode'), 'pan');
    assert.equal(options[1].getAttribute('aria-checked'), 'false');
    assert.equal(options[1].querySelector('.wf-canvas-toolbar__mode-check svg'), null);
    assert.equal(options[1].querySelector('.wf-canvas-toolbar__mode-kbd')?.textContent, 'H');

    // 4. 外部受控打开「+」菜单（模拟画布全局快捷键 N）必须互斥关闭指针菜单
    await React.act(async () => {
      setExternalAddOpen(true);
    });
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null, 'external controlled add open (hotkey N) must close pointer menu');
    assert.ok(toolbar.querySelector('.wf-node-menu'));

    await React.act(async () => {
      setExternalAddOpen(false);
    });

    // 5. 键盘可达：触发器上按 ArrowDown 展开并聚焦第一项 → ArrowDown 移到抓手 → 回车/点击切换且焦点回触发器
    await React.act(async () => {
      modeTrigger.focus();
      modeTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    const openOptions = [...toolbar.querySelectorAll('.wf-canvas-toolbar__mode-menu button[role="menuitemradio"]')];
    assert.equal(openOptions.length, 2, 'ArrowDown on closed trigger must open pointer menu');
    assert.equal(document.activeElement, openOptions[0], 'ArrowDown must focus first option');

    await React.act(async () => {
      openOptions[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    assert.equal(document.activeElement, openOptions[1], 'ArrowDown must cycle focus to Hand option');

    await React.act(async () => {
      openOptions[1].click();
    });
    await Promise.resolve();
    assert.deepEqual(modeChanges, ['pan']);
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null);
    assert.equal(modeTrigger.getAttribute('data-pointer-mode'), 'pan');
    assert.equal(document.activeElement, modeTrigger, 'selecting option from menu must return focus to trigger');

    // 6. post-rAF canvasDismissLayer Escape 关闭并将焦点归还触发器
    await React.act(async () => {
      modeTrigger.click();
      flushRaf();
    });
    const postRafOptions = [...toolbar.querySelectorAll('.wf-canvas-toolbar__mode-menu button[role="menuitemradio"]')];
    assert.equal(postRafOptions.length, 2);
    await React.act(async () => {
      postRafOptions[1].focus();
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await Promise.resolve();
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null, 'Escape via canvasDismissLayer must close pointer menu');
    assert.equal(document.activeElement, modeTrigger, 'Escape must restore focus to pointer trigger');

    // 7. 同模式按键（已是 pan 再按 H）也能收起菜单
    await React.act(async () => {
      modeTrigger.click();
    });
    await React.act(async () => {
      modeTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    });
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null, 'pressing H on open menu must close menu even when already pan');

    // 切回 select 验证零渲染期错误
    await React.act(async () => {
      setExternalMode('select');
    });
    assert.equal(assetsClicks, 0);
    assert.equal(helpClicks, 0);
    assert.equal(
      consoleErrors.filter((msg) => msg.includes('Cannot update a component')).length,
      0,
      `unexpected React cross-component update error: ${consoleErrors.join('\n')}`,
    );
  } finally {
    console.error = origConsoleError;
    await React.act(async () => {
      root.unmount();
    });
    dom.window.close();
    for (const [key, val] of Object.entries(prevGlobals)) {
      if (val === undefined) delete globalThis[key];
      else globalThis[key] = val;
    }
  }
});
