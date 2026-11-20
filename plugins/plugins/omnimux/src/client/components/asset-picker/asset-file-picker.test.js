import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { pickAssetPaths } from './asset-file-picker.js';

test('desktop chooser errors reach the add form instead of becoming cancellation', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('unexpected Web request');
  });
  globalThis.dshDesktop = { protocolVersion: 1 };
  t.after(() => { delete globalThis.dshDesktop; });

  const update = await pickAssetPaths('file');
  assert.match(update.error, /Update OmniMux|请更新 OmniMux/);
  assert.equal(fetch.mock.callCount(), 0);

  globalThis.dshDesktop.filePicker = {
    version: 1,
    open: async () => ({ ok: true, path: null, paths: [] }),
  };
  assert.deepEqual(await pickAssetPaths('file'), { paths: [] });
  assert.equal(fetch.mock.callCount(), 0);
});

test('Web chooser surfaces unsuccessful responses and preserves selected paths', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('request rejected', { status: 403 }));
  assert.deepEqual(await pickAssetPaths('file'), { error: 'HTTP 403' });
  assert.equal(fetch.mock.calls[0].arguments[0], '/omnimux/assets/pick');
  assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body), { kind: 'file' });

  const files = ['/fixtures/素材 一.png', '/fixtures/素材 二.png'];
  fetch.mock.mockImplementation(async () => Response.json({ path: files[0], paths: files }));
  assert.deepEqual(await pickAssetPaths('file'), { paths: files });
});

test('the add card starts one pick in its click and the current form consumes its own result', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { default: React, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const output = await build({
    entryPoints: [fileURLToPath(new URL('./AssetPicker.jsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react', 'dsh-ui-kit'],
  });
  const require = createRequire(import.meta.url);
  const h = React.createElement;
  const Button = ({ onClick, children, disabled, 'aria-label': name }) =>
    h('button', { type: 'button', onClick, disabled, 'aria-label': name }, children);
  const kit = {
    Badge: ({ children }) => h('span', null, children),
    Button,
    DropdownSelect: () => null,
    IconButton: Button,
    InputField: React.forwardRef(({ placeholder, value, onChange, disabled }, ref) =>
      h('input', { ref, placeholder, value, onChange, disabled })),
    ModalDialog: ({ open, title, children, footer }) =>
      open ? h('section', { 'aria-label': title }, children, footer) : null,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    name => name === 'dsh-ui-kit' ? kit : require(name), module, module.exports,
  );
  const { AssetPicker } = module.exports;
  const requests = [];
  let inClick = false;
  const onPick = kind => {
    assert.equal(inClick, true, 'the chooser needs the original click gesture');
    const request = Promise.withResolvers();
    requests.push({ kind, ...request });
    return request.promise;
  };
  const fetchAssets = async () => [];
  await act(async () => root.render(h(AssetPicker, {
    open: true, onClose: () => {}, onConfirm: () => {}, onPick, fetchAssets,
    t: key => key,
  })));

  const click = async selector => {
    const element = document.querySelector(selector);
    assert.ok(element, selector);
    await act(async () => {
      inClick = true;
      element.click();
      inClick = false;
    });
  };
  const addCard = '.omx-asset-pick-card--add';
  const form = '[aria-label="composerAdd.addAssetModalTitle"]';
  await click(addCard);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'file');
  await click(addCard);
  assert.equal(requests.length, 1);
  await click(form + ' [aria-label="composerAdd.cancel"]');
  assert.equal(document.querySelector(form), null);

  await click(addCard);
  assert.equal(requests.length, 2);
  await act(async () => requests[0].resolve(['/fixtures/旧文件.png']));
  assert.equal(document.querySelector(form + ' input').value, '');
  assert.doesNotMatch(document.querySelector(form).textContent, /旧文件/);

  await act(async () => requests[1].resolve(['/fixtures/素材 一.png']));
  assert.equal(document.querySelector(form + ' input').value, '素材 一');
  assert.match(document.querySelector(form).textContent, /素材 一\.png/);
  const pickFolders = [...document.querySelectorAll(form + ' button')].find(button =>
    button.textContent === 'composerAdd.pickFolders');
  assert.ok(pickFolders);
  await act(async () => {
    inClick = true;
    pickFolders.click();
    inClick = false;
  });
  assert.equal(requests[2].kind, 'directory');
  await act(async () => requests[2].resolve([]));
  assert.equal(document.querySelector(form + ' input').value, '素材 一');
  assert.match(document.querySelector(form).textContent, /素材 一\.png/);
});
