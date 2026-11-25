import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { readCanvasCatalog } from '../../workflow/seam/canvasCatalog.ts';
import { shouldReplaceCatalogCache } from '../editor/hooks/catalogCache.ts';
import { groupPickerCandidates } from '../editor/components/MaterialNode/ConfigPanel/modelPickerCandidates.ts';
import { buildFilteredModelOptions } from '../../shared/validation/operationUi.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const requireHub = createRequire(new URL('../../../../omnimux/package.json', import.meta.url));
const { JSDOM } = requireHub('jsdom');

function makeHubCatalog({ brandName = 'Acme Labs', iconPath = 'M12 2L22 20H2Z' } = {}) {
  return {
    source: 'omnimux',
    schemaVersion: '1.1',
    fingerprint: 'exec-fp-stable-001',
    presentationFingerprint: `pres-fp-${brandName}-${iconPath}`,
    brands: {
      openai: { id: 'openai', name: 'OpenAI' },
      'acme-labs': { id: 'acme-labs', name: brandName, iconPath },
      'evil-labs': { id: 'evil-labs', name: 'Evil Labs', iconPath: '<svg onload=alert(1)>' },
    },
    defaults: { image: 'gpt-acme-vision' },
    models: [
      {
        id: 'gpt-acme-vision',
        label: 'Acme Vision',
        source: 'gateway',
        executionStatus: 'ready',
        visible: true,
        selectable: true,
        family: 'acme-labs',
        familyLabel: brandName,
        brandId: 'acme-labs',
        brandName,
        brandIconPath: iconPath,
        operations: [
          {
            id: 'text_to_image',
            label: '文生图',
            listed: true,
            inputs: [{ slot: 'prompt', type: 'text', role: 'prompt', required: true, min: 1, max: 1 }],
            output: { type: 'image' },
            implementation: { status: 'ready' },
            execution: { status: 'ready' },
          },
        ],
      },
      {
        id: 'evil-model-1',
        label: 'Evil Model',
        source: 'gateway',
        executionStatus: 'ready',
        visible: true,
        selectable: true,
        family: 'evil-labs',
        brandId: 'evil-labs',
        brandName: 'Evil Labs',
        brandIconPath: '<svg onload=alert(1)>',
        operations: [
          {
            id: 'text_to_image',
            label: '文生图',
            listed: true,
            inputs: [{ slot: 'prompt', type: 'text', role: 'prompt', required: true, min: 1, max: 1 }],
            output: { type: 'image' },
            implementation: { status: 'ready' },
            execution: { status: 'ready' },
          },
        ],
      },
    ],
    text: [],
    image: [
      {
        id: 'gpt-acme-vision',
        label: 'Acme Vision',
        source: 'gateway',
        executionStatus: 'ready',
        visible: true,
        selectable: true,
        family: 'acme-labs',
        familyLabel: brandName,
        brandId: 'acme-labs',
        brandName,
        brandIconPath: iconPath,
      },
      {
        id: 'evil-model-1',
        label: 'Evil Model',
        source: 'gateway',
        executionStatus: 'ready',
        visible: true,
        selectable: true,
        family: 'evil-labs',
        brandId: 'evil-labs',
        brandName: 'Evil Labs',
        brandIconPath: '<svg onload=alert(1)>',
      },
    ],
    video: [],
    audio: [],
  };
}

describe('Workflow hybrid model-brand propagation, cache decoupling, and DOM rendering', () => {
  it('propagates gateway brand metadata through readCanvasCatalog, operationUi, and groupPickerCandidates without regex hijack', () => {
    const hub = makeHubCatalog();
    const canvasCatalog = readCanvasCatalog((name) => {
      if (name === 'imageGenerate') return { execute: () => {} };
      if (name === 'modelCatalog') return { list: () => hub };
      return undefined;
    });

    assert.equal(canvasCatalog.brands?.['acme-labs']?.name, 'Acme Labs');
    assert.equal(canvasCatalog.brands?.['acme-labs']?.iconPath, 'M12 2L22 20H2Z');
    assert.equal(canvasCatalog.brands?.['evil-labs']?.iconPath, undefined, 'malicious iconPath must be stripped at seam');

    const acmeRow = canvasCatalog.image.find((row) => row.id === 'gpt-acme-vision');
    assert.equal(acmeRow?.brandId, 'acme-labs');
    assert.equal(acmeRow?.brandName, 'Acme Labs');
    assert.equal(acmeRow?.brandIconPath, 'M12 2L22 20H2Z');

    // `body.models[]` must also be sanitized fail-closed at the seam (never leaking raw invalid values into operationUi).
    const evilModelRow = canvasCatalog.models?.find((row) => row.id === 'evil-model-1');
    assert.equal(evilModelRow?.brandId, 'evil-labs');
    assert.equal(evilModelRow?.brandIconPath, undefined, 'malicious iconPath on body.models[] must be stripped at seam');

    const badSeamCatalog = readCanvasCatalog((name) => {
      if (name === 'imageGenerate') return { execute: () => {} };
      if (name === 'modelCatalog') {
        return {
          list: () => ({
            ...hub,
            models: [
              {
                ...hub.models[0],
                id: 'bad-seam-model',
                brandId: 'Bad_ID',
                brandIconPath: '<svg onload=alert(1)>',
              },
            ],
            image: [
              {
                ...hub.image[0],
                id: 'bad-seam-model',
                brandId: 'Bad_ID',
                brandIconPath: '<svg onload=alert(1)>',
              },
            ],
          }),
        };
      }
      return undefined;
    });
    assert.equal(badSeamCatalog.models?.[0]?.brandId, undefined);
    assert.equal(badSeamCatalog.models?.[0]?.brandIconPath, undefined);
    const badFiltered = buildFilteredModelOptions({
      catalog: badSeamCatalog,
      outputType: 'image',
      allowUnassignedInputs: true,
    });
    assert.equal(badFiltered.options[0]?.brandId, undefined, 'invalid brandId on models[] must not leak into options');
    assert.equal(badFiltered.options[0]?.brandIconPath, undefined, 'malicious brandIconPath on models[] must not leak into options');

    const filtered = buildFilteredModelOptions({
      catalog: canvasCatalog,
      outputType: 'image',
      allowUnassignedInputs: true,
    });
    const groups = groupPickerCandidates(filtered.options);
    const acmeGroup = groups.find((g) => g.id === 'acme-labs');
    assert.ok(acmeGroup, 'explicit gateway brandId must not be hijacked to openai by gpt- prefix');
    assert.equal(acmeGroup.name, 'Acme Labs');
    assert.equal(acmeGroup.brandId, 'acme-labs');
    assert.equal(acmeGroup.brandIconPath, 'M12 2L22 20H2Z');
    assert.equal(groups.some((g) => g.id === 'openai'), false);

    // Even if a stale row carries a mismatched family (`openai`), explicit foreign brandId must win over family hijack,
    // while same-vendor product sub-families (`seedream` under `bytedance`) remain grouped properly.
    const mixedGroups = groupPickerCandidates([
      {
        id: 'gpt-acme-vision',
        label: 'Acme Vision',
        family: 'openai',
        familyLabel: 'OpenAI',
        brandId: 'acme-labs',
        brandName: 'Acme Labs',
        brandIconPath: 'M12 2L22 20H2Z',
      },
      {
        id: 'gpt-image-2.5',
        label: 'GPT Image 2.5',
        family: 'openai',
        familyLabel: 'OpenAI',
        brandId: 'openai',
        brandName: 'OpenAI',
      },
      {
        id: 'seedream-5-5',
        label: 'Seedream 5.5',
        family: 'seedream',
        familyLabel: 'Seedream',
        brandId: 'bytedance',
        brandName: 'ByteDance',
      },
    ]);
    assert.deepEqual(
      mixedGroups.map((g) => ({ id: g.id, name: g.name, brandId: g.brandId, rowIds: g.rows.map((r) => r.id) })),
      [
        { id: 'acme-labs', name: 'Acme Labs', brandId: 'acme-labs', rowIds: ['gpt-acme-vision'] },
        { id: 'openai', name: 'OpenAI', brandId: 'openai', rowIds: ['gpt-image-2.5'] },
        { id: 'seedream', name: 'Seedream', brandId: 'bytedance', rowIds: ['seedream-5-5'] },
      ],
    );
  });

  it('decouples catalog cache refresh from graph reconciliation on display-only brand updates', async () => {
    const catV1 = readCanvasCatalog((name) =>
      name === 'modelCatalog'
        ? { list: () => makeHubCatalog({ brandName: 'Acme Labs', iconPath: 'M12 2L22 20H2Z' }) }
        : name === 'imageGenerate' ? { execute: () => {} } : undefined,
    );
    const catV2 = readCanvasCatalog((name) =>
      name === 'modelCatalog'
        ? { list: () => makeHubCatalog({ brandName: 'Acme Studio', iconPath: 'M4 4H20V20H4Z' }) }
        : name === 'imageGenerate' ? { execute: () => {} } : undefined,
    );

    // Execution fingerprint is unchanged; presentationFingerprint changes.
    assert.equal(catV1.fingerprint, catV2.fingerprint);
    assert.notEqual(catV1.presentationFingerprint, catV2.presentationFingerprint);

    // Local cache MUST replace when presentationFingerprint advances.
    assert.equal(
      shouldReplaceCatalogCache({
        cachedFingerprint: catV1.fingerprint,
        nextFingerprint: catV2.fingerprint,
        cachedPresentationFingerprint: catV1.presentationFingerprint,
        nextPresentationFingerprint: catV2.presentationFingerprint,
        force: false,
      }),
      true,
    );
    assert.equal(
      shouldReplaceCatalogCache({
        cachedFingerprint: catV1.fingerprint,
        nextFingerprint: catV1.fingerprint,
        cachedPresentationFingerprint: catV1.presentationFingerprint,
        nextPresentationFingerprint: catV1.presentationFingerprint,
        force: false,
      }),
      false,
    );

    // Real canvasStore: setCatalogRuntime(catV2) updates catalogRuntime without touching nodes/edges!
    const tmpDir = mkdtempSync(join(tmpdir(), 'omnimux-wf-store-brand-'));
    try {
      const storeBundle = join(tmpDir, 'store.mjs');
      buildSync({
        stdin: {
          contents: "export { useCanvasStore } from '../store/canvasStore.ts';",
          resolveDir: here,
          sourcefile: 'store-entry.ts',
        },
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: storeBundle,
      });
      const { useCanvasStore } = await import(pathToFileURL(storeBundle).href);
      const store = useCanvasStore.getState();
      store.resetStore();
      store.hydrateGraph(
        [
          {
            id: 'gen-1',
            type: 'material',
            position: { x: 0, y: 0 },
            data: {
              materialType: 'image',
              source: 'generate',
              params: { model: 'gpt-acme-vision', operation: 'text_to_image', prompt: 'test' },
              compat: { status: 'compatible', catalogFingerprint: catV1.fingerprint },
            },
          },
        ],
        [],
      );
      store.setCatalogRuntime(catV1);
      const nodesBefore = useCanvasStore.getState().nodes;
      const edgesBefore = useCanvasStore.getState().edges;

      store.setCatalogRuntime(catV2);
      const after = useCanvasStore.getState();
      assert.strictEqual(after.catalogRuntime, catV2, 'catalogRuntime must refresh to display new brand metadata');
      assert.strictEqual(after.nodes, nodesBefore, 'display-only brand update must not reconcile or mutate graph nodes');
      assert.strictEqual(after.edges, edgesBefore, 'display-only brand update must not mutate graph edges');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders all 4 tiers in ModelBrandIcon cleanly without raw HTML injection', async () => {
    const src = readFileSync(join(here, 'ModelBrandIcon.tsx'), 'utf8');
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, 'ModelBrandIcon.tsx must not use dangerouslySetInnerHTML');

    const localRequire = createRequire(import.meta.url);
    const React = localRequire('react');
    const reactDomClient = localRequire('react-dom/client');
    const built = buildSync({
      stdin: {
        contents: `
          export { ModelBrandIcon } from './ModelBrandIcon.tsx';
          export { getModelVisuals } from '../editor/components/MaterialNode/ConfigPanel/modelVisuals.tsx';
        `,
        resolveDir: here,
        sourcefile: 'brand-visuals-entry.tsx',
      },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react-dom/client'],
    });
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(localRequire, mod, mod.exports);
    const { ModelBrandIcon, getModelVisuals } = mod.exports;

    // Cross-vendor guard: explicit foreign brandId must not inherit OpenAI's badge/subtitle via LEGACY_ID_RULES,
    // while same-vendor models (e.g. nano-banana under google) retain their badges/subtitles.
    const foreignVisuals = getModelVisuals('gpt-image-acme', {
      kind: 'image',
      family: 'acme-labs',
      brandId: 'acme-labs',
      brandName: 'Acme Labs',
    });
    assert.equal(foreignVisuals.badge, undefined, 'foreign brandId must not inherit OpenAI badge');
    assert.equal(foreignVisuals.subtitle, undefined, 'foreign brandId must not inherit OpenAI subtitle');

    const googleVisuals = getModelVisuals('nano-banana-2-1', {
      kind: 'image',
      family: 'google',
      brandId: 'google',
      brandName: 'Google',
    });
    assert.equal(googleVisuals.badge, 'Yearly -20%');
    assert.equal(googleVisuals.subtitle, 'auto-4K');

    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    const prevWindow = global.window;
    const prevDocument = global.document;
    const prevAct = global.IS_REACT_ACT_ENVIRONMENT;
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const rootEl = dom.window.document.getElementById('root');
    const root = reactDomClient.createRoot(rootEl);
    try {
      await React.act(async () => {
        root.render(
          React.createElement(
            'div',
            null,
            React.createElement(ModelBrandIcon, { key: 't1', modelId: 'gpt-image-2.5', brandId: 'openai', size: 18 }),
            React.createElement(ModelBrandIcon, {
              key: 't2',
              modelId: 'gpt-acme-vision',
              brandId: 'acme-labs',
              brandName: 'Acme Labs',
              brandIconPath: 'M12 2L22 20H2Z',
              size: 18,
            }),
            React.createElement(ModelBrandIcon, { key: 't3', modelId: 'muse-image', size: 18 }),
            React.createElement(ModelBrandIcon, {
              key: 't4-evil',
              modelId: 'evil-1',
              brandId: 'evil-labs',
              brandName: 'Evil Labs',
              brandIconPath: '<svg onload=alert(1)>',
              size: 18,
            }),
            React.createElement(ModelBrandIcon, { key: 't4-unknown', modelId: 'opaque-unknown-99', size: 18 }),
          ),
        );
      });

      const icons = Array.from(rootEl.querySelectorAll('.wf-brand-icon'));
      assert.equal(icons.length, 5);

      // Tier 1: local high-craft vector
      assert.equal(icons[0].getAttribute('data-brand-source'), 'local');
      assert.equal(icons[0].getAttribute('data-brand-id'), 'openai');
      assert.ok(icons[0].querySelector('svg path'));

      // Tier 2: gateway safe monochrome path (NOT hijacked by gpt- prefix!)
      assert.equal(icons[1].getAttribute('data-brand-source'), 'gateway-path');
      assert.equal(icons[1].getAttribute('data-brand-id'), 'acme-labs');
      assert.equal(icons[1].querySelector('svg path')?.getAttribute('d'), 'M12 2L22 20H2Z');

      // Tier 3: legacy regex compatibility
      assert.equal(icons[2].getAttribute('data-brand-source'), 'legacy-regex');
      assert.equal(icons[2].getAttribute('data-brand-id'), 'muse');
      assert.ok(icons[2].querySelector('svg rect'));

      // Tier 4: malicious path rejected fail-closed -> monogram 'E'
      assert.equal(icons[3].getAttribute('data-brand-source'), 'monogram');
      assert.equal(icons[3].getAttribute('data-brand-id'), 'evil-labs');
      assert.equal(icons[3].querySelector('svg'), null);
      assert.equal(icons[3].textContent, 'E');

      // Tier 4: unknown model -> monogram 'O'
      assert.equal(icons[4].getAttribute('data-brand-source'), 'monogram');
      assert.equal(icons[4].getAttribute('data-brand-id'), '');
      assert.equal(icons[4].querySelector('svg'), null);
      assert.equal(icons[4].textContent, 'O');
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
      global.window = prevWindow;
      global.document = prevDocument;
      global.IS_REACT_ACT_ENVIRONMENT = prevAct;
    }
  });
});
