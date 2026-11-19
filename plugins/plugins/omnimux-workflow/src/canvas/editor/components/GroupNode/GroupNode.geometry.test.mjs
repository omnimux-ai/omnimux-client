import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const compiled = await build({
  stdin: {
    contents: "export { GroupNode } from './GroupNode'; export { useCanvasStore } from '../../../store/canvasStore';",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
const mod = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  require, mod, mod.exports,
);
const { GroupNode, useCanvasStore } = mod.exports;
const { ReactFlowProvider } = require('@xyflow/react');

const { window } = new JSDOM('<div id="root"></div>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const container = document.getElementById('root');
const root = createRoot(container);
after(() => {
  act(() => root.unmount());
  window.close();
});

function renderGroup({ width, height, isCollapsed = false }, previousMeasurement) {
  const group = {
    id: 'group',
    type: 'group',
    position: { x: 32, y: 72 },
    width,
    height,
    data: { title: '示例分组', isCollapsed },
  };
  act(() => {
    useCanvasStore.getState().setNodes([group]);
    root.render(createElement(ReactFlowProvider, null, createElement(GroupNode, {
      id: group.id,
      data: group.data,
      selected: true,
      ...previousMeasurement,
    })));
  });
  return container.querySelector('.wf-group-node');
}

function groupDimensions(element) {
  return [element.style.width, element.style.height];
}

test('folded group stays compact even when React Flow reports the prior expanded measurement', () => {
  const group = renderGroup({ width: 220, height: 44, isCollapsed: true }, { width: 844, height: 592 });
  assert.deepEqual(groupDimensions(group), ['220px', '44px']);
  assert.equal(group.querySelector('.wf-group-resize-handles'), null);
});

test('expanded group uses its custom width and height despite the prior folded measurement', () => {
  const group = renderGroup({ width: 844, height: 592 }, { width: 220, height: 44 });
  assert.deepEqual(groupDimensions(group), ['844px', '592px']);
  assert.ok(group.querySelector('.wf-group-resize-handles'));
});

test('legacy group falls back to the React Flow measurement for an undeclared axis', () => {
  const group = renderGroup({ width: 360 }, { width: 220, height: 250 });
  assert.deepEqual(groupDimensions(group), ['360px', '250px']);
});
