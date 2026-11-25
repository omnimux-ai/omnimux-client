/**
 * E2E 回归：创作画布配置面板恢复为跟随节点下方 12px 居中反缩放展示，
 * 不再通过 Portal 停靠到底部、不压缩 .react-flow 高度、不绘制上下分栏横线。
 *
 * 覆盖：
 * 1. 真实渲染 ConfigPanelShell（包含分组节点 .react-flow__node-group 同在画布的场景），
 *    确认面板直接挂载在选中节点 DOM 内并随 zoom 反向缩放；
 * 2. 样式契约确认 components.css 不存在 dock 分栏裁切规则与通栏 ::after 分隔线，
 *    同时保留 .wf-panel-shell / .wf-panel-shell__card 既有外壳定位与内边距样式；
 * 3. 子浮层（CfgPopoverShell / ModelCascadeMenu / CustomSelect）无废弃 dock 位移事件残留。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inverseScaleForZoom } from '../src/canvas/editor/utils/nodeVisualMath.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const workflowRequire = createRequire(join(pkgRoot, 'package.json'));
const React = workflowRequire('react');
const { createRoot } = workflowRequire('react-dom/client');
const { flushSync } = workflowRequire('react-dom');
const { JSDOM } = workflowRequire('jsdom');

const shellPath = join(pkgRoot, 'src/canvas/editor/components/MaterialNode/ConfigPanel/ConfigPanelShell.tsx');
const componentsCssPath = join(pkgRoot, 'src/canvas/theme/components.css');
const popoverShellPath = join(pkgRoot, 'src/canvas/editor/components/MaterialNode/ConfigPanel/cfg/CfgPopoverShell.tsx');
const cascadePath = join(pkgRoot, 'src/canvas/editor/components/MaterialNode/ConfigPanel/ModelCascadeMenu.tsx');
const selectPath = join(pkgRoot, 'src/canvas/ui/CustomSelect.tsx');

const shellSrc = readFileSync(shellPath, 'utf8');
const componentsCss = readFileSync(componentsCssPath, 'utf8');
const popoverShellSrc = readFileSync(popoverShellPath, 'utf8');
const cascadeSrc = readFileSync(cascadePath, 'utf8');
const selectSrc = readFileSync(selectPath, 'utf8');

async function loadCompiledShell(zoomRef) {
  const compiled = await build({
    entryPoints: [shellPath],
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
        useViewport: () => ({ x: 0, y: 0, zoom: zoomRef.current }),
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

describe('E2E: 创作画布配置面板跟随节点下方且无上下分栏', () => {
  it('选中分组内节点时面板直接渲染于节点正下方 12px，画布无 dock 属性与预留高度变量', async () => {
    const zoomRef = { current: 0.75 };
    const ConfigPanelShell = await loadCompiledShell(zoomRef);
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div class="wf-canvas-editor" style="position: relative; height: 720px;">
          <div class="react-flow" style="height: 100%;">
            <div class="react-flow__node react-flow__node-group" data-id="group-1"></div>
            <div class="react-flow__node react-flow__node-material selected" data-id="video-1">
              <div class="wf-material-node__card"></div>
              <div id="slot"></div>
            </div>
          </div>
          <div class="wf-canvas-toolbar"></div>
        </div>
      </body></html>`,
      { url: 'http://127.0.0.1/' },
    );

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    const editorEl = dom.window.document.querySelector('.wf-canvas-editor');
    const ownerNodeEl = dom.window.document.querySelector('[data-id="video-1"]');
    const slotEl = dom.window.document.getElementById('slot');
    const root = createRoot(slotEl);

    try {
      flushSync(() => {
        root.render(
          React.createElement(
            ConfigPanelShell,
            null,
            React.createElement('div', { className: 'wf-config-panel' }, '补充要求（可选）'),
          ),
        );
      });

      const inlineShell = ownerNodeEl.querySelector('.wf-panel-shell');
      assert.ok(inlineShell, '配置面板必须直接挂载在选中节点 DOM 内');
      assert.equal(editorEl.querySelector(':scope > .wf-panel-shell'), null, '不得 Portal 挂载到 .wf-canvas-editor 顶层');
      assert.equal(editorEl.getAttribute('data-config-panel-placement'), null, '不得把画布标记为 dock 分栏态');
      assert.equal(editorEl.style.getPropertyValue('--wf-config-dock-reserve'), '', '不得设置底部预留区高度压缩 .react-flow');
      assert.equal(inlineShell.style.top, 'calc(100% + 12px)');
      assert.equal(inlineShell.style.left, '50%');
      assert.equal(inlineShell.style.marginLeft, '-240px');
      assert.equal(inlineShell.style.transform, `scale(${inverseScaleForZoom(0.75)})`);
      assert.equal(inlineShell.style.transformOrigin, 'top center');
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 20));
      globalThis.window = prevWindow;
      globalThis.document = prevDocument;
      dom.window.close();
    }
  });

  it('CSS 与浮层源码不存在上下分栏裁切、通栏横线与 dock 位移事件残留', () => {
    assert.doesNotMatch(shellSrc, /createPortal\(/, 'ConfigPanelShell 不得使用 createPortal 脱离节点');
    assert.doesNotMatch(componentsCss, /\.wf-canvas-editor\[data-config-panel-placement='dock'\]\s*>\s*\.react-flow/);
    assert.doesNotMatch(componentsCss, /\.wf-canvas-editor\[data-config-panel-placement='dock'\]::after/);
    assert.doesNotMatch(componentsCss, /--wf-config-dock-reserve/);
    assert.doesNotMatch(componentsCss, /\.wf-panel-shell\[data-placement='dock'\]/);
    assert.match(componentsCss, /\.wf-panel-shell\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*50;/);
    assert.match(componentsCss, /\.wf-panel-shell__card\s*\{[^}]*padding:\s*12px 14px;/);
    assert.doesNotMatch(popoverShellSrc, /CONFIG_PANEL_POSITION_EVENT|omnimux:config-panel-position/);
    assert.doesNotMatch(cascadeSrc, /omnimux:config-panel-position/);
    assert.doesNotMatch(selectSrc, /omnimux:config-panel-position/);
  });
});
