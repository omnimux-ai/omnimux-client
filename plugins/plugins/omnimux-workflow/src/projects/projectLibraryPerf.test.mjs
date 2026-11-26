import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProjectStore, createProjectDispatcher, createWorkspaceStore } from '../../dist/index.js';
import { createListMediaRevision, createProjectMediaResolver } from './mediaRevision.ts';

const prefix = '/omnimux-workflow/api/projects';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-perf-projects-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const libraryRoot = join(root, 'library');
  const workspacesDir = join(root, 'workspaces');
  await mkdir(libraryRoot);
  await mkdir(workspacesDir);
  const store = createProjectStore({ libraryRoot });
  return { root, libraryRoot, workspacesDir, store };
}

test('progressive list (?covers=none) and batch POST /covers separate fast metadata from cover scanning', async t => {
  const { root, libraryRoot, workspacesDir, store } = await fixture(t);
  const wsA = 'ws_fast_a';
  const wsB = 'ws_fast_b';
  const projA = store.create('Alpha', { canvasWorkspaceIds: [wsA] });
  const projB = store.create('Beta', { canvasWorkspaceIds: [wsB] });
  const workspaceStore = createWorkspaceStore({ workspacesDir, resolveProjectRoot: id => store.findByCanvasWorkspaceId(id) });
  workspaceStore.create('Alpha', wsA);
  workspaceStore.create('Beta', wsB);
  await writeFile(join(projA.path, 'cover.png'), 'alpha-png');
  workspaceStore.save(wsA, {
    expectedVersion: 0,
    nodes: [{ id: 'n_a', type: 'material', position: { x: 0, y: 0 }, data: { materialType: 'image', mediaUrl: `/omnimux-workflow/api/workspaces/${wsA}/file?rel=cover.png` } }],
  });
  let mediaChecks = 0;
  const mediaRevision = createListMediaRevision(root, createProjectMediaResolver(workspacesDir));
  const dispatcher = createProjectDispatcher({
    libraryRoot,
    projectStore: store,
    workspaceStore,
    listMediaRevision(source, resolveProject, signal) {
      mediaChecks += 1;
      return mediaRevision(source, resolveProject, signal);
    },
  });

  const fast = await dispatcher.dispatch({ method: 'GET', url: `${prefix}?covers=none` });
  assert.equal(fast.status, 200);
  assert.equal(fast.body.coversIncluded, false);
  assert.equal(fast.body.projects.length, 2);
  assert.equal(fast.body.projects[0].cover, undefined);
  assert.equal(mediaChecks, 0, '?covers=none must skip cover and media revision scans');

  const batch = await dispatcher.dispatch({
    method: 'POST',
    url: `${prefix}/covers`,
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
    body: { ids: [projA.id] },
  });
  assert.equal(batch.status, 200);
  assert.equal(batch.body.covers[projA.id].cover.kind, 'image');
  assert.equal(batch.body.covers[projA.id].cover.nodeId, 'n_a');
  assert.equal(batch.body.covers[projB.id], undefined, 'batch endpoint must only compute requested IDs');
  assert.equal(mediaChecks, 1);

  const badBody = await dispatcher.dispatch({
    method: 'POST',
    url: `${prefix}/covers`,
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
    body: { ids: 'not-an-array' },
  });
  assert.equal(badBody.status, 400);
});

test('GET /api/projects/:id/files lists subdirectories asynchronously with zero host sync fs calls', async t => {
  const { libraryRoot, store } = await fixture(t);
  const project = store.create('Files Project', { canvasWorkspaceIds: ['ws_files_async'] });
  await mkdir(join(project.path, 'clips'), { recursive: true });
  await writeFile(join(project.path, 'poster.png'), 'png');
  await writeFile(join(project.path, 'clips', 'scene1.mp4'), 'mp4');
  const dispatcher = createProjectDispatcher({ libraryRoot, projectStore: store });

  let syncReaddir = 0;
  let syncStat = 0;
  const origReaddirSync = fs.readdirSync;
  const origStatSync = fs.statSync;
  const p1 = t.mock.method(fs, 'readdirSync', (...args) => { syncReaddir += 1; return origReaddirSync(...args); });
  const p2 = t.mock.method(fs, 'statSync', (...args) => { syncStat += 1; return origStatSync(...args); });
  syncBuiltinESMExports();
  try {
    const rootRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files` });
    assert.equal(rootRes.status, 200);
    assert.deepEqual(rootRes.body.items.map(i => i.name), ['clips', 'poster.png']);
    assert.equal(rootRes.body.items[0].isFolder, true);

    const subRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files?subpath=clips` });
    assert.equal(subRes.status, 200);
    assert.equal(subRes.body.currentSubpath, 'clips');
    assert.deepEqual(subRes.body.items.map(i => i.id), ['clips/scene1.mp4']);

    const trailingSlashRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files?subpath=clips/` });
    assert.equal(trailingSlashRes.status, 200);
    assert.equal(trailingSlashRes.body.currentSubpath, 'clips');
    assert.deepEqual(trailingSlashRes.body.items.map(i => i.id), ['clips/scene1.mp4']);

    const escapeRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files?subpath=..` });
    assert.equal(escapeRes.status, 403);
    assert.equal(escapeRes.body.error, 'path-denied');

    const nulRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files?subpath=clips%00evil` });
    assert.equal(nulRes.status, 403);
    assert.equal(nulRes.body.error, 'path-denied');

    assert.equal(syncReaddir, 0, 'GET /files must not call readdirSync on Host main thread');
    assert.equal(syncStat, 0, 'GET /files must not call statSync on Host main thread');
  } finally {
    p1.mock.restore();
    p2.mock.restore();
    syncBuiltinESMExports();
  }
});

test('GET /api/projects/:id/files blocks symlink directory escape and omits external symlink metadata', async t => {
  const { root, libraryRoot, store } = await fixture(t);
  const project = store.create('Symlink Guard Project', { canvasWorkspaceIds: ['ws_symlink_guard'] });
  const outsideDir = join(root, 'outside-secret-dir');
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(outsideDir, 'secret.txt'), 'top-secret-payload');
  await mkdir(join(project.path, 'inside-real'), { recursive: true });
  await writeFile(join(project.path, 'inside-real', 'ok.png'), 'ok');
  await symlink(outsideDir, join(project.path, 'escape-dir'));
  await symlink(join(outsideDir, 'secret.txt'), join(project.path, 'escape-file.txt'));
  await symlink(join(project.path, 'inside-real'), join(project.path, 'safe-link-dir'));

  const dispatcher = createProjectDispatcher({ libraryRoot, projectStore: store });

  const escapeDirRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files?subpath=escape-dir` });
  assert.equal(escapeDirRes.status, 403, 'symlink pointing outside projectRoot must return 403 path-denied');
  assert.equal(escapeDirRes.body.error, 'path-denied');

  const rootList = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files` });
  assert.equal(rootList.status, 200);
  const names = rootList.body.items.map(i => i.name);
  assert.equal(names.includes('escape-dir'), false, 'escaping dir symlink must be omitted from root listing');
  assert.equal(names.includes('escape-file.txt'), false, 'escaping file symlink must be omitted from root listing');
  assert.equal(names.includes('inside-real'), true);
  assert.equal(names.includes('safe-link-dir'), true, 'in-project symlink remains visible');
  assert.equal(rootList.body.items.find(i => i.name === 'safe-link-dir')?.isFolder, true);
});
