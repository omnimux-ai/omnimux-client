import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickLocalDirectory, pickLocalFiles } from './apiClient.ts';
import { createAssetsLibraryClient } from './assetsLibraryClient.ts';
import { pickProjectDirectory } from '../../client/api.js';
import { WORKFLOW_API_ROUTES } from '../../shared/api.ts';

function useDesktop(t, desktop) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'dshDesktop');
  Object.defineProperty(globalThis, 'dshDesktop', { value: desktop, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'dshDesktop', previous);
    else delete globalThis.dshDesktop;
  });
}

const ok = payload => ({ ok: true, status: 200, json: async () => payload });

test('canvas, project and asset drawer imports use the same desktop picker', async t => {
  const calls = [];
  const firstPath = 'C:\\项目 素材\\第一张图.png';
  const paths = [firstPath, 'C:\\项目 素材\\第二张图.png'];
  useDesktop(t, { protocolVersion: 1, filePicker: { version: 1, async open(options) {
    calls.push(options);
    const selected = options.kind === 'directory' ? [] : options.multiple ? paths : [firstPath];
    return { ok: true, path: selected[0] ?? null, paths: selected };
  } } });
  const web = t.mock.method(globalThis, 'fetch', () => { throw new Error('Desktop choice must not reach HTTP'); });

  const picked = await pickLocalFiles({ extensions: ['png'], multiple: false });
  assert.deepEqual(picked.body, { path: firstPath, paths: [firstPath] });
  for (const pickDirectory of [pickLocalDirectory, pickProjectDirectory]) {
    const canceled = await pickDirectory();
    assert.equal(canceled.ok, true);
    assert.deepEqual(canceled.body, { path: null, paths: [] });
  }
  const assetChoice = await createAssetsLibraryClient().pickAssets('file');
  assert.deepEqual(assetChoice.interpretation, { kind: 'ok', paths });
  assert.deepEqual(calls, [
    { kind: 'file', multiple: false, extensions: ['png'] },
    { kind: 'directory', multiple: false },
    { kind: 'directory', multiple: false },
    { kind: 'file', multiple: true },
  ]);
  assert.equal(web.mock.callCount(), 0);
});

test('old desktop clients return an update prompt without opening the Web host picker', async t => {
  useDesktop(t, { protocolVersion: 1 });
  const web = t.mock.method(globalThis, 'fetch', () => { throw new Error('Old desktop must not reach HTTP'); });
  const rejected = await pickProjectDirectory();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.body.error, 'picker-update-required');
  assert.ok(rejected.body.message);
  const assetChoice = await createAssetsLibraryClient().pickAssets('file');
  assert.equal(assetChoice.ok, false);
  assert.deepEqual(assetChoice.interpretation, { kind: 'error', message: rejected.body.message });
  assert.equal(web.mock.callCount(), 0);
});

test('Web keeps the existing picker routes and request bodies', async t => {
  useDesktop(t, undefined);
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, method: request.method, body: JSON.parse(request.body) });
    return ok({ path: '/素材 路径' });
  };
  t.mock.method(globalThis, 'fetch', fetchImpl);
  await pickLocalFiles({ extensions: ['mp3'], multiple: true });
  const projectDirectory = await pickProjectDirectory();
  assert.equal(projectDirectory.body.path, '/素材 路径');
  const assetChoice = await createAssetsLibraryClient({ fetch: fetchImpl }).pickAssets('file');
  assert.deepEqual(assetChoice.interpretation, { kind: 'ok', paths: ['/素材 路径'] });
  assert.deepEqual(calls, [
    { url: WORKFLOW_API_ROUTES.pick, method: 'POST', body: { kind: 'file', extensions: ['mp3'], multiple: true } },
    { url: WORKFLOW_API_ROUTES.pick, method: 'POST', body: { kind: 'directory' } },
    { url: '/omnimux/assets/pick', method: 'POST', body: { kind: 'file' } },
  ]);
});
