import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

export const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1/' });
const { window } = dom;
Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver']) {
  globalThis[name] = window[name];
}
for (const name of ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[name] = window[name].bind(window);
}
// Fixture nodes have fixed dimensions. JSDOM has no layout observer.
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = window.ResizeObserver = ResizeObserver;
const require = createRequire(import.meta.url);
export const { createRoot } = require('react-dom/client');
export const { ReactFlow } = require('@xyflow/react');

// Compile the real material node and its store together. Isolate the profile
// preference write so that node data updates still use the production path.
const { outputFiles } = await build({
  stdin: {
    contents: "export { default as MaterialNode } from '../index.tsx'; export { useCanvasStore } from '../../../../store/canvasStore';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true, write: false, jsx: 'automatic', platform: 'node', format: 'cjs',
  external: ['react', 'react-dom', '@xyflow/react'],
  loader: { '.css': 'empty' },
  plugins: [{ name: 'generation-preference-fixture', setup(build) {
    build.onResolve({ filter: /\/generationPreferencesStore$/ }, args => args.importer.endsWith('/ConfigPanel/index.tsx')
      ? { path: 'preferences', namespace: 'fixture' } : undefined);
    build.onLoad({ filter: /^preferences$/, namespace: 'fixture' }, () => ({
      contents: 'export const rememberGenerationModel = async () => {};',
    }));
  } }],
});
const output = await mkdtemp(join(tmpdir(), 'omnimux-cascade-interactions-'));
let panel;
try {
  const dependencies = fileURLToPath(new URL('../../../../../../../node_modules', import.meta.url));
  await symlink(dependencies, join(output, 'node_modules'), 'dir');
  const entry = join(output, 'panel.cjs');
  await writeFile(entry, outputFiles[0].contents);
  panel = require(entry);
} finally {
  await rm(output, { recursive: true, force: true });
}
export const { MaterialNode, useCanvasStore } = panel;
