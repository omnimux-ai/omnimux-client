import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createCanvasDismissCoordinator, isCanvasBlankSurface } from '../utils/canvasDismissLayer.ts';

async function loadCanvasStore() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../../store/canvasStore.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    mod,
    mod.exports,
  );
  return mod.exports.useCanvasStore;
}

const here = dirname(fileURLToPath(import.meta.url));
const toolbarSrc = readFileSync(join(here, 'Toolbar.tsx'), 'utf8');
const headerControlsSrc = readFileSync(join(here, 'HeaderControls.tsx'), 'utf8');
const canvasEditorSrc = readFileSync(join(here, '../CanvasEditor.tsx'), 'utf8');
const materialNodeSrc = readFileSync(join(here, 'MaterialNode/index.tsx'), 'utf8');
const shellSrc = readFileSync(join(here, 'MaterialNode/ConfigPanel/ConfigPanelShell.tsx'), 'utf8');
const popoverShellSrc = readFileSync(join(here, 'MaterialNode/ConfigPanel/cfg/CfgPopoverShell.tsx'), 'utf8');
const cascadeSrc = readFileSync(join(here, 'MaterialNode/ConfigPanel/ModelCascadeMenu.tsx'), 'utf8');
const selectSrc = readFileSync(join(here, '../../ui/CustomSelect.tsx'), 'utf8');
const themeCss = readFileSync(join(here, '../../theme/workbench-theme.css'), 'utf8');
const componentsCss = readFileSync(join(here, '../../theme/components.css'), 'utf8');

describe('Issue #111: P1 / P2 / P3 contract tests', () => {
  it('P1: Toolbar exposes visible Add Node text and direct side-by-side Select/Hand mode buttons', () => {
    assert.match(toolbarSrc, /wf-canvas-toolbar__add-text[^>]*>\{t\('menu\.addNode'\)\}/);
    assert.match(toolbarSrc, /role="group"/);
    assert.match(toolbarSrc, /data-mode="select"/);
    assert.match(toolbarSrc, /data-mode="pan"/);
    assert.match(toolbarSrc, /aria-keyshortcuts="V"/);
    assert.match(toolbarSrc, /aria-keyshortcuts="H"/);
    assert.match(toolbarSrc, /aria-pressed=\{pointerMode === 'select'\}/);
    assert.match(toolbarSrc, /aria-pressed=\{pointerMode === 'pan'\}/);
    assert.doesNotMatch(toolbarSrc, /<CustomDropdown/);
    assert.match(themeCss, /\.wf-canvas-toolbar__item:focus-visible/);
    assert.match(themeCss, /\.wf-canvas-toolbar__mode-btn\[aria-pressed='true'\]/);
    assert.match(headerControlsSrc, /aria-pressed=\{isMinimapOpen\}/);
    assert.match(componentsCss, /\.wf-header-controls > \.wf-header-capsule \+ \.wf-header-capsule/);
    assert.match(componentsCss, /\.wf-header-capsule__btn:focus-visible/);
  });

  it('P2: Node header uses WCAG AA primary/secondary tokens and card defines distinct hover/selected/dragging outlines', () => {
    assert.match(
      componentsCss,
      /\.wf-node-header__label\s*\{[^}]*color:\s*var\(--dsw-alias-label-primary,\s*var\(--wb-text-primary\)\)/,
    );
    assert.match(
      componentsCss,
      /\.wf-node-header__icon\s*\{[^}]*color:\s*var\(--dsw-alias-label-secondary,\s*var\(--wb-text-secondary\)\)/,
    );
    assert.match(materialNodeSrc, /wf-material-node--dragging/);

    const hoverIdx = componentsCss.indexOf('.react-flow__node:hover .wf-material-node__card');
    const selectedIdx = componentsCss.indexOf('.react-flow__node.selected .wf-material-node__card');
    const draggingIdx = componentsCss.indexOf('.react-flow__node.dragging .wf-material-node__card');
    assert.ok(hoverIdx > 0 && selectedIdx > hoverIdx && draggingIdx > selectedIdx, 'hover < selected < dragging cascade order');
    assert.match(
      componentsCss.slice(hoverIdx, selectedIdx),
      /outline:\s*1px solid/,
    );
    assert.match(
      componentsCss.slice(selectedIdx, draggingIdx),
      /outline:\s*2px solid var\(--wb-node-ring\)/,
    );
    assert.match(
      componentsCss.slice(draggingIdx, draggingIdx + 320),
      /outline:\s*2px dashed var\(--wb-beam-start\)/,
    );
  });

  it('P3: ConfigPanelShell portals into .wf-canvas-editor, notifies popovers on reposition, and blank dock margin is recognized', () => {
    assert.match(shellSrc, /createPortal\(/);
    assert.match(shellSrc, /closest\('\.wf-canvas-editor'\)/);
    assert.match(shellSrc, /MutationObserver/);
    assert.match(shellSrc, /ResizeObserver/);
    assert.match(shellSrc, /CONFIG_PANEL_POSITION_EVENT/);
    assert.match(popoverShellSrc, /CONFIG_PANEL_POSITION_EVENT/);
    assert.match(cascadeSrc, /omnimux:config-panel-position/);
    assert.match(selectSrc, /omnimux:config-panel-position/);
    assert.match(canvasEditorSrc, /data-pointer-mode=\{pointerMode\}/);
    assert.match(componentsCss, /\.wf-canvas-editor\[data-config-panel-placement='dock'\] > \.react-flow/);
    assert.match(componentsCss, /\.wf-panel-shell\[data-placement='dock'\] \.wf-panel-shell__card/);

    const fakeEditor = {
      classList: { contains: (cls) => cls === 'wf-canvas-editor' },
      closest: () => null,
    };
    assert.equal(isCanvasBlankSurface(fakeEditor), true);
    assert.match(
      canvasEditorSrc,
      /handleEditorBackdropClick[\s\S]*?event\.target !== event\.currentTarget[\s\S]*?clearSelection\(\)[\s\S]*?handlePaneClick\(\)/,
    );
    assert.match(canvasEditorSrc, /onClick=\{handleEditorBackdropClick\}/);
  });

  it('P3: useCanvasStore.clearSelection atomically clears node, edge, and selectedElement states without pushing undo history', async () => {
    const useCanvasStore = await loadCanvasStore();
    const store = useCanvasStore.getState();
    store.resetStore();
    try {
      store.hydrateGraph(
        [
          { id: 'n1', type: 'material', position: { x: 0, y: 0 }, selected: true, data: { materialType: 'video' } },
          { id: 'n2', type: 'material', position: { x: 240, y: 0 }, selected: false, data: { materialType: 'image' } },
        ],
        [
          { id: 'e1', source: 'n2', target: 'n1', selected: true },
        ],
      );
      store.setSelectedElement('node', 'n1');
      const pastBefore = useCanvasStore.getState().past.length;

      useCanvasStore.getState().clearSelection();

      const after = useCanvasStore.getState();
      assert.equal(after.nodes.every((n) => n.selected === false), true);
      assert.equal(after.edges.every((e) => e.selected === false), true);
      assert.deepEqual(after.selectedElement, { type: 'none', id: null });
      assert.equal(after.past.length, pastBefore, 'clearing selection must not push an undo snapshot');
    } finally {
      useCanvasStore.getState().resetStore();
    }
  });

  it('P3: dock blank margin click clears selection in 1 click without popover, and dismisses popover first then selection with popover open', async () => {
    const workflowRequire = createRequire(join(here, '../../../../..', 'package.json'));
    const { JSDOM } = workflowRequire('jsdom');
    const useCanvasStore = await loadCanvasStore();
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="wf-canvas-editor">
        <div class="react-flow"><div class="react-flow__pane" id="pane"></div></div>
      </div>
      <div id="model-popover" class="wf-model-cascade-popover"></div>
      <button id="model-trigger" type="button">Model</button>
    </body></html>`, { url: 'http://127.0.0.1/' });

    const { window } = dom;
    const { document } = window;
    let clock = 1000;
    const coordinator = createCanvasDismissCoordinator({ host: window, now: () => clock });

    const dispatchPointer = (target, type, init = {}) => {
      const evt = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
      if (init.pointerId !== undefined) Object.defineProperty(evt, 'pointerId', { value: init.pointerId });
      target.dispatchEvent(evt);
    };
    const fullClick = (target) => {
      dispatchPointer(target, 'pointerdown', { pointerId: 1 });
      dispatchPointer(target, 'mousedown');
      dispatchPointer(target, 'pointerup', { pointerId: 1 });
      dispatchPointer(target, 'mouseup');
      dispatchPointer(target, 'click');
    };

    useCanvasStore.getState().resetStore();
    try {
      const editor = document.querySelector('.wf-canvas-editor');
      const modelPopover = document.getElementById('model-popover');
      const modelTrigger = document.getElementById('model-trigger');
      assert.ok(editor && modelPopover && modelTrigger);

      const seedSelection = () => {
        const store = useCanvasStore.getState();
        store.hydrateGraph(
          [{ id: 'n-dock', type: 'material', position: { x: 0, y: 0 }, selected: true, data: { materialType: 'video' } }],
          [{ id: 'e-dock', source: 'n-src', target: 'n-dock', selected: true }],
        );
        store.setSelectedElement('node', 'n-dock');
      };

      let backdropClears = 0;
      editor.addEventListener('click', (event) => {
        if (event.target !== event.currentTarget) return;
        useCanvasStore.getState().clearSelection();
        backdropClears += 1;
      });

      // (1) No open popover: single click on .wf-canvas-editor dock margin clears selection immediately
      seedSelection();
      fullClick(editor);
      assert.equal(backdropClears, 1);
      assert.equal(useCanvasStore.getState().nodes[0].selected, false);
      assert.equal(useCanvasStore.getState().edges[0].selected, false);
      assert.deepEqual(useCanvasStore.getState().selectedElement, { type: 'none', id: null });

      // (2) Open popover: first click dismisses only the popover; second click clears selection
      seedSelection();
      let popoverOpen = true;
      let unregister = null;
      unregister = coordinator.register(() => ({
        containsTarget: (target) => modelPopover.contains(target) || modelTrigger.contains(target),
        onDismiss: () => {
          popoverOpen = false;
          unregister?.();
          unregister = null;
        },
      }));

      fullClick(editor);
      assert.equal(popoverOpen, false);
      assert.equal(backdropClears, 1);
      assert.equal(useCanvasStore.getState().nodes[0].selected, true);
      assert.deepEqual(useCanvasStore.getState().selectedElement, { type: 'node', id: 'n-dock' });

      clock += 120;
      fullClick(editor);
      assert.equal(backdropClears, 2);
      assert.equal(useCanvasStore.getState().nodes[0].selected, false);
      assert.equal(useCanvasStore.getState().edges[0].selected, false);
      assert.deepEqual(useCanvasStore.getState().selectedElement, { type: 'none', id: null });
    } finally {
      useCanvasStore.getState().resetStore();
      coordinator.destroy();
      window.close();
    }
  });
});
