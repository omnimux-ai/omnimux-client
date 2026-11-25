/**
 * 真实渲染 + CSS 层叠回归测试：
 * 锁定画布底部工具栏仅保留既有 5 颗纯图标按钮（零文本）、同心圆「+」按钮、
 * 指针模式聚合触发器与悬浮切换菜单交互，以及同页加载 omnimux-market 样式时的样式隔离。
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

test('真实渲染回归：底栏 5 颗按钮纯图标零文本、指针模式浮层交互完整，且与 omnimux-market 样式同页加载不串扰', async () => {
  const Toolbar = await loadToolbarComponent();
  const workflowRequire = createRequire(workflowPkgPath);
  const pluginsRequire = createRequire(pluginsPkgPath);
  const React = workflowRequire('react');
  const { createRoot } = workflowRequire('react-dom/client');
  const { JSDOM } = pluginsRequire('jsdom');

  const dom = new JSDOM(
    `<!doctype html><html><head><style>${marketCss}</style><style>${themeSrc}</style></head><body><div class="wf-canvas-root"><div id="mount"></div></div></body></html>`,
    { url: 'http://127.0.0.1/' },
  );

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const modeChanges = [];
  let assetsClicks = 0;
  let helpClicks = 0;
  const mount = dom.window.document.getElementById('mount');
  const root = createRoot(mount);

  const renderToolbar = async (pointerMode = 'select') => {
    await React.act(async () => {
      root.render(
        React.createElement(Toolbar, {
          onAddNode: () => {},
          pointerMode,
          onPointerModeChange: (mode) => modeChanges.push(mode),
          onOpenAssets: () => { assetsClicks += 1; },
          onOpenHelp: () => { helpClicks += 1; },
          onInsertTemplate: () => {},
          templates: [],
        }),
      );
    });
  };

  try {
    await renderToolbar('select');

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

    // 2. 主「+」按钮在同页加载 omnimux-market CSS 时仍保持 40x40 同心圆与浅/暗高对比
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

    // 3. 指针模式聚合触发器 + 悬浮切换菜单交互
    const modeTrigger = toolbar.querySelector('button.wf-canvas-toolbar__mode-trigger');
    assert.ok(modeTrigger, 'missing pointer mode trigger');
    assert.equal(modeTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(modeTrigger.getAttribute('data-pointer-mode'), 'select');
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null);

    await React.act(async () => {
      modeTrigger.click();
    });
    assert.equal(modeTrigger.getAttribute('aria-expanded'), 'true');
    assert.equal(modeTrigger.classList.contains('wf-canvas-toolbar__mode-trigger--open'), true);

    const modeMenu = toolbar.querySelector('.wf-canvas-toolbar__mode-menu');
    assert.ok(modeMenu, 'pointer mode popover must open on trigger click');
    assert.equal(modeMenu.getAttribute('role'), 'menu');

    const options = [...modeMenu.querySelectorAll('button[role="menuitemradio"]')];
    assert.equal(options.length, 2, 'pointer mode popover must expose exactly Select and Hand options');
    assert.equal(options[0].getAttribute('data-mode'), 'select');
    assert.equal(options[0].getAttribute('aria-checked'), 'true');
    assert.equal(options[0].querySelector('.wf-canvas-toolbar__mode-check svg') !== null, true);
    assert.equal(options[0].querySelector('.wf-canvas-toolbar__mode-kbd')?.textContent, 'V');
    assert.equal(options[1].getAttribute('data-mode'), 'pan');
    assert.equal(options[1].getAttribute('aria-checked'), 'false');
    assert.equal(options[1].querySelector('.wf-canvas-toolbar__mode-check svg'), null);
    assert.equal(options[1].querySelector('.wf-canvas-toolbar__mode-kbd')?.textContent, 'H');

    // 点击「抓手」切换模式并立即关闭菜单
    await React.act(async () => {
      options[1].click();
    });
    assert.deepEqual(modeChanges, ['pan']);
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null);
    assert.equal(modeTrigger.getAttribute('aria-expanded'), 'false');

    // 重新渲染为 pan 模式，确认选中态与触发器属性同步，且打开「+」菜单时互斥关闭指针菜单
    await renderToolbar('pan');
    assert.equal(modeTrigger.getAttribute('data-pointer-mode'), 'pan');
    await React.act(async () => {
      modeTrigger.click();
    });
    assert.equal(
      toolbar.querySelector('.wf-canvas-toolbar__mode-option[data-mode="pan"]')?.getAttribute('aria-checked'),
      'true',
    );
    await React.act(async () => {
      primaryAdd.click();
    });
    assert.equal(toolbar.querySelector('.wf-canvas-toolbar__mode-menu'), null, 'opening add menu must close pointer menu');
    assert.ok(toolbar.querySelector('.wf-node-menu'), 'add node menu must open');
    assert.equal(assetsClicks, 0);
    assert.equal(helpClicks, 0);
  } finally {
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
