/**
 * 回归测试：ConfigPanelShell 始终内联附着于选中节点下方 12px，
 * 按画布缩放反向缩放并保持 .wf-canvas-editor 与 .react-flow 完整高度（禁止 Portal 停靠上下分栏）。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inverseScaleForZoom } from '../../../utils/nodeVisualMath.ts';

const here = dirname(fileURLToPath(import.meta.url));
const workflowRequire = createRequire(join(here, '../../../../../../..', 'package.json'));
const React = workflowRequire('react');
const { createRoot } = workflowRequire('react-dom/client');
const { flushSync } = workflowRequire('react-dom');
const { JSDOM } = workflowRequire('jsdom');

async function loadConfigPanelShell(mockZoomRef) {
  const compiled = await build({
    entryPoints: [join(here, 'ConfigPanelShell.tsx')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react', 'react-dom', '@xyflow/react'],
  });
  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === '@xyflow/react') {
      return {
        useViewport: () => ({ x: 0, y: 0, zoom: mockZoomRef.current }),
      };
    }
    return workflowRequire(specifier);
  };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    customRequire,
    mod,
    mod.exports,
  );
  return mod.exports.default;
}

describe('ConfigPanelShell follow-node restoration', () => {
  it('mounts inline inside owner node below card (+12px) and never mutates .wf-canvas-editor into dock split mode', async () => {
    const zoomRef = { current: 1 };
    const ConfigPanelShell = await loadConfigPanelShell(zoomRef);
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div class="wf-canvas-editor">
          <div class="react-flow">
            <div class="react-flow__node react-flow__node-group" data-id="g-1"></div>
            <div class="react-flow__node selected" data-id="n-1">
              <div class="wf-material-node__card"></div>
              <div id="mount"></div>
            </div>
          </div>
        </div>
      </body></html>`,
      { url: 'http://127.0.0.1/' },
    );

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    const mountEl = dom.window.document.getElementById('mount');
    const editorEl = dom.window.document.querySelector('.wf-canvas-editor');
    const ownerNodeEl = dom.window.document.querySelector('[data-id="n-1"]');
    const root = createRoot(mountEl);

    try {
      flushSync(() => {
        root.render(
          React.createElement(
            ConfigPanelShell,
            null,
            React.createElement('div', { 'data-testid': 'panel-body' }, 'Prompt body'),
          ),
        );
      });

      const shell = ownerNodeEl.querySelector('.wf-panel-shell');
      assert.ok(shell, 'ConfigPanelShell 必须直接渲染在所属节点 DOM 内');
      assert.equal(
        editorEl.querySelector(':scope > .wf-panel-shell'),
        null,
        '不得通过 Portal 挂载到 .wf-canvas-editor 顶层',
      );
      assert.equal(editorEl.dataset.configPanelPlacement, undefined, '不得设置 dock 分栏标记');
      assert.equal(editorEl.style.getPropertyValue('--wf-config-dock-reserve'), '', '不得写入底部预留区高度变量');
      assert.equal(shell.dataset.placement, undefined);
      assert.equal(shell.style.top, 'calc(100% + 12px)');
      assert.equal(shell.style.left, '50%');
      assert.equal(shell.style.width, '480px');
      assert.equal(shell.style.marginLeft, '-240px');
      assert.equal(shell.style.transformOrigin, 'top center');
      assert.equal(shell.style.transform, `scale(${inverseScaleForZoom(1)})`);
      assert.equal(shell.classList.contains('nodrag'), true);
      assert.equal(shell.classList.contains('nowheel'), true);
      assert.equal(shell.classList.contains('nopan'), true);
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 20));
      globalThis.window = prevWindow;
      globalThis.document = prevDocument;
      dom.window.close();
    }
  });

  it('counter-scales with viewport zoom and stops click propagation so node stays selected', async () => {
    const zoomRef = { current: 0.54 };
    const ConfigPanelShell = await loadConfigPanelShell(zoomRef);
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div class="wf-canvas-editor">
          <div class="react-flow__node selected" id="owner"><div id="mount"></div></div>
        </div>
      </body></html>`,
      { url: 'http://127.0.0.1/' },
    );

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    const ownerEl = dom.window.document.getElementById('owner');
    const mountEl = dom.window.document.getElementById('mount');
    let parentClicks = 0;
    ownerEl.addEventListener('click', () => {
      parentClicks += 1;
    });

    const root = createRoot(mountEl);
    try {
      flushSync(() => {
        root.render(
          React.createElement(
            ConfigPanelShell,
            { width: 520 },
            React.createElement('button', { id: 'inner-btn', type: 'button' }, 'Run'),
          ),
        );
      });

      const shell = ownerEl.querySelector('.wf-panel-shell');
      assert.ok(shell);
      assert.equal(shell.style.width, '520px');
      assert.equal(shell.style.marginLeft, '-260px');
      assert.equal(shell.style.transform, `scale(${inverseScaleForZoom(0.54)})`);

      const innerBtn = dom.window.document.getElementById('inner-btn');
      innerBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(parentClicks, 0, '面板内点击不得冒泡到节点/画布造成误清选');

      zoomRef.current = 1.5;
      flushSync(() => {
        root.render(
          React.createElement(
            ConfigPanelShell,
            { width: 520 },
            React.createElement('button', { id: 'inner-btn', type: 'button' }, 'Run'),
          ),
        );
      });
      assert.equal(shell.style.transform, `scale(${inverseScaleForZoom(1.5)})`);
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 20));
      globalThis.window = prevWindow;
      globalThis.document = prevDocument;
      dom.window.close();
    }
  });
});
