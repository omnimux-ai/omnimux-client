import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const localRequire = createRequire(import.meta.url);
const React = localRequire('react');
const reactDomClient = localRequire('react-dom/client');
const { JSDOM } = localRequire('jsdom');

function loadModelPicker() {
  const built = buildSync({
    entryPoints: [resolve(here, 'ModelPicker.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/client'],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(localRequire, mod, mod.exports);
  return mod.exports;
}

describe('ModelPicker hybrid brand icon rendering (hub shard gate)', () => {
  it('renders Tier 1 local mono SVG, Tier 2 safe gateway path, Tier 3 legacy regex, and Tier 4 neutral monogram (never bytedance fallback)', async () => {
    const { BrandIcon, resolveModelBrand } = loadModelPicker();

    assert.equal(resolveModelBrand('seedream-5-5'), 'bytedance');
    assert.equal(resolveModelBrand('nano-banana-2-lite'), 'google');
    assert.equal(resolveModelBrand('gpt-image-2.5'), 'openai');
    assert.equal(resolveModelBrand('opaque-unknown-99'), null);

    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const prevWindow = global.window;
    const prevDocument = global.document;
    const prevAct = global.IS_REACT_ACT_ENVIRONMENT;
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const container = dom.window.document.getElementById('root');
    const root = reactDomClient.createRoot(container);
    try {
      await React.act(async () => {
        root.render(
          React.createElement(
            'div',
            null,
            React.createElement(BrandIcon, {
              key: 't1',
              modelId: 'gpt-image-2.5',
              label: 'GPT Image 2.5',
              brandId: 'openai',
              brandName: 'OpenAI',
              size: 16,
            }),
            React.createElement(BrandIcon, {
              key: 't2',
              modelId: 'gpt-acme-vision',
              label: 'Acme Vision',
              brandId: 'acme-labs',
              brandName: 'Acme Labs',
              brandIconPath: 'M12 2L22 20H2Z',
              size: 16,
            }),
            React.createElement(BrandIcon, {
              key: 't3',
              modelId: 'muse-image',
              label: 'Muse Image',
              size: 16,
            }),
            React.createElement(BrandIcon, {
              key: 't4-evil',
              modelId: 'evil-model-1',
              label: 'Evil Model',
              brandId: 'evil-labs',
              brandName: 'Evil Labs',
              brandIconPath: '<svg onload=alert(1)>',
              size: 16,
            }),
            React.createElement(BrandIcon, {
              key: 't4-unknown',
              modelId: 'opaque-unknown-99',
              label: 'Opaque Unknown 99',
              size: 16,
            }),
          ),
        );
      });

      const icons = Array.from(container.querySelectorAll('.sh-model-brand-icon'));
      assert.equal(icons.length, 5);

      assert.equal(icons[0].getAttribute('data-brand-source'), 'local');
      assert.equal(icons[0].getAttribute('data-brand-id'), 'openai');
      assert.ok(icons[0].querySelector('svg path'));

      assert.equal(icons[1].getAttribute('data-brand-source'), 'gateway-path');
      assert.equal(icons[1].getAttribute('data-brand-id'), 'acme-labs');
      assert.equal(icons[1].querySelector('svg path')?.getAttribute('d'), 'M12 2L22 20H2Z');

      assert.equal(icons[2].getAttribute('data-brand-source'), 'legacy-regex');
      assert.equal(icons[2].getAttribute('data-brand-id'), 'muse');
      assert.ok(icons[2].querySelector('svg rect'));

      assert.equal(icons[3].getAttribute('data-brand-source'), 'monogram');
      assert.equal(icons[3].getAttribute('data-brand-id'), 'evil-labs');
      assert.equal(icons[3].querySelector('svg'), null);
      assert.equal(icons[3].querySelector('.sh-model-brand-monogram')?.textContent, 'E');

      assert.equal(icons[4].getAttribute('data-brand-source'), 'monogram');
      assert.equal(icons[4].getAttribute('data-brand-id'), '');
      assert.notEqual(icons[4].getAttribute('data-brand-id'), 'bytedance');
      assert.equal(icons[4].querySelector('svg'), null);
      assert.equal(icons[4].querySelector('.sh-model-brand-monogram')?.textContent, 'O');
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
      global.window = prevWindow;
      global.document = prevDocument;
      global.IS_REACT_ACT_ENVIRONMENT = prevAct;
    }
  });

  it('rejects whitespace-padded brandId and brandIconPath fail-closed during catalog ingest', async () => {
    const { ModelPicker } = loadModelPicker();
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://127.0.0.1:4199/',
    });
    const prevWindow = global.window;
    const prevDocument = global.document;
    const prevFetch = global.fetch;
    const prevAct = global.IS_REACT_ACT_ENVIRONMENT;
    const prevCustomEvent = global.CustomEvent;
    global.window = dom.window;
    global.document = dom.window.document;
    global.CustomEvent = dom.window.CustomEvent;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.fetch = async (url) => {
      if (String(url).includes('/omnimux/model-catalog')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            brands: {
              'acme-labs': { id: 'acme-labs', name: 'Acme Labs', iconPath: 'M12 2L22 20H2Z' },
            },
            image: [
              {
                id: 'padded-brand-model',
                label: 'Padded Brand Model',
                brandId: ' acme-labs ',
                brandName: 'Acme Labs',
                brandIconPath: ' M12 2L22 20H2Z ',
              },
              {
                id: 'valid-brand-padded-path',
                label: 'Valid Brand Padded Path',
                brandId: 'padded-only',
                brandName: 'Padded Only',
                brandIconPath: ' M12 2L22 20H2Z ',
              },
            ],
            video: [],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const container = dom.window.document.getElementById('root');
    const root = reactDomClient.createRoot(container);
    try {
      await React.act(async () => {
        root.render(React.createElement(ModelPicker, { sessionId: 'sess-brand-pad' }));
      });
      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      // Open popover and switch to manual + image tab.
      const trigger = container.querySelector('.sh-model-picker-trigger');
      assert.ok(trigger, 'ModelPicker trigger must render');
      await React.act(async () => {
        trigger.click();
      });
      const autoSwitch = dom.window.document.querySelector('.sh-model-switch');
      assert.ok(autoSwitch, 'auto switch must render');
      await React.act(async () => {
        autoSwitch.click();
      });
      const imageTab = Array.from(dom.window.document.querySelectorAll('.sh-model-tab'))
        .find((el) => el.textContent?.includes('图像') || el.textContent?.includes('Image'));
      assert.ok(imageTab, 'image tab must render');
      await React.act(async () => {
        imageTab.click();
      });

      const rows = Array.from(dom.window.document.querySelectorAll('.sh-model-row'));
      assert.equal(rows.length, 2);

      // Row 1: padded brandId `' acme-labs '` must be rejected fail-closed (not trimmed to `'acme-labs'`).
      const icon1 = rows[0].querySelector('.sh-model-brand-icon');
      assert.equal(icon1?.getAttribute('data-brand-source'), 'monogram');
      assert.equal(icon1?.getAttribute('data-brand-id'), '');
      assert.equal(icon1?.querySelector('svg'), null);

      // Row 2: padded brandIconPath `' M12 2L22 20H2Z '` must be rejected fail-closed (not trimmed into valid path).
      const icon2 = rows[1].querySelector('.sh-model-brand-icon');
      assert.equal(icon2?.getAttribute('data-brand-source'), 'monogram');
      assert.equal(icon2?.getAttribute('data-brand-id'), 'padded-only');
      assert.equal(icon2?.querySelector('svg'), null);
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
      global.window = prevWindow;
      global.document = prevDocument;
      global.fetch = prevFetch;
      global.CustomEvent = prevCustomEvent;
      global.IS_REACT_ACT_ENVIRONMENT = prevAct;
    }
  });
});
