import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProjectStore, createProjectDispatcher, createWorkspaceStore } from '../../dist/index.js';
import { createListMediaRevision, createProjectMediaResolver } from './mediaRevision.ts';
import { SharedFileWork } from './asyncFiles.ts';

const now = '2026-01-01T00:00:00.000Z';
const prefix = '/omnimux-workflow/api/projects';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow-async-projects-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const libraryRoot = join(root, 'library');
  const workspacesDir = join(root, 'workspaces');
  await mkdir(libraryRoot);
  const store = createProjectStore({ libraryRoot });
  return { root, libraryRoot, workspacesDir, store };
}

async function writeRecord(root, project) {
  const file = join(root, '.omnimux', 'project.json');
  await mkdir(join(root, '.omnimux'), { recursive: true });
  await writeFile(file, JSON.stringify({ createdAt: now, updatedAt: now, ...project }));
  return file;
}

test('async list retains unreachable external registrations, deduplicates physical roots and repairs old records', async t => {
  const { root, libraryRoot } = await fixture(t);
  const declared = join(root, 'registered-alias');
  const actual = join(root, 'external');
  const offline = join(root, 'not-mounted');
  const discovered = join(root, 'workspace');
  const registry = join(libraryRoot, '.external-projects.json');
  const local = await writeRecord(join(libraryRoot, 'Old'), { schemaVersion: 2, id: 'repair', title: 'Repair me' });
  await writeRecord(actual, { schemaVersion: 1, id: 'legacy', title: 'Legacy', canvasWorkspaceIds: ['ws_legacy'] });
  await writeRecord(discovered, { schemaVersion: 1, id: 'discovered', title: 'Found in workspace' });
  await symlink(actual, declared, 'junction');
  await writeFile(registry, JSON.stringify([offline, declared]));
  const store = createProjectStore({ libraryRoot, workspaceDirs: () => [discovered, actual, declared] });
  const dispatcher = createProjectDispatcher({ libraryRoot, projectStore: store });
  const list = () => dispatcher.dispatch({ method: 'GET', url: prefix });

  const first = await list();
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.projects.map(row => row.id), ['repair', 'legacy', 'discovered']);
  assert.equal(first.body.projects[1].workspaceDir, declared);
  assert.equal(first.body.projects[1].pages[0].canvasWorkspaceId, 'ws_legacy');
  assert.equal(first.body.projects[0].bound, false);
  const repaired = JSON.parse(await readFile(local, 'utf8'));
  assert.equal(repaired.pages[0].canvasWorkspaceId, first.body.projects[0].pages[0].canvasWorkspaceId);
  assert.deepEqual(JSON.parse(await readFile(registry, 'utf8')), [offline, declared, discovered]);
  assert.equal(store.findByCanvasWorkspaceId('ws_legacy').path, declared);
  assert.deepEqual(JSON.parse(await readFile(registry, 'utf8')), [offline, declared, discovered]);

  await writeRecord(offline, { schemaVersion: 1, id: 'back', title: 'Available again' });
  assert.equal((await list()).body.projects.find(row => row.id === 'back').workspaceDir, offline);
  await rename(offline, join(root, 'detached'));
  assert.equal((await list()).body.projects.some(row => row.id === 'back'), false);
  assert.deepEqual(JSON.parse(await readFile(registry, 'utf8')), [offline, declared, discovered]);
});

test('cover list reuses a canvas across pages and refreshes a cross-project media revision', async t => {
  const { root, libraryRoot, workspacesDir, store } = await fixture(t);
  const ownId = 'ws_source';
  const otherId = 'ws_references';
  const owner = store.create('Source', { canvasWorkspaceIds: [ownId] });
  const other = store.create('References', { canvasWorkspaceIds: [otherId] });
  store.addPage(other.id, 'Second page', { canvasWorkspaceId: otherId });
  const workspaceStore = createWorkspaceStore({ workspacesDir, resolveProjectRoot: id => store.findByCanvasWorkspaceId(id) });
  workspaceStore.create('Source', ownId);
  workspaceStore.create('References', otherId);
  const coverSource = join(owner.path, 'poster.png');
  await writeFile(coverSource, 'one');
  workspaceStore.save(otherId, { expectedVersion: 0, nodes: [{ id: 'poster', type: 'material', position: { x: 0, y: 0 },
    data: { materialType: 'image', mediaUrl: `/omnimux-workflow/api/workspaces/${ownId}/file?rel=poster.png` } }] });
  const resolveMedia = createProjectMediaResolver(workspacesDir);
  const mediaRevision = createListMediaRevision(root, resolveMedia);
  let checks = 0;
  const dispatcher = createProjectDispatcher({ libraryRoot, projectStore: store, workspaceStore,
    listMediaRevision(source, resolveProject, signal) {
      checks++;
      return mediaRevision(source, resolveProject, signal);
    } });
  const list = () => dispatcher.dispatch({ method: 'GET', url: prefix });
  const first = (await list()).body.projects.find(row => row.id === other.id);
  assert.equal(first.cover.nodeId, 'poster');
  assert.equal(first.cover.unavailable, undefined);
  assert.deepEqual(first.pages[0].cover, first.pages[1].cover);
  assert.equal(checks, 1, 'one cover revision for the shared canvas and image URL');
  await writeFile(coverSource, 'replacement');
  const second = (await list()).body.projects.find(row => row.id === other.id);
  assert.notEqual(second.cover.sourceRevision, first.cover.sourceRevision);
  assert.equal(second.cover.unavailable, undefined);
  await rm(coverSource);
  const missing = (await list()).body.projects.find(row => row.id === other.id);
  assert.equal(missing.cover.unavailable, true);
});

test('a dangling derived cache does not hide a readable canvas cover', async t => {
  const { root, libraryRoot, workspacesDir, store } = await fixture(t);
  const id = 'ws_dangling_cover';
  const project = store.create('Cover project', { canvasWorkspaceIds: [id] });
  const workspaceStore = createWorkspaceStore({ workspacesDir, resolveProjectRoot: ws => store.findByCanvasWorkspaceId(ws) });
  workspaceStore.create('Cover canvas', id);
  const mediaUrl = `/omnimux-workflow/api/workspaces/${id}/file?rel=cover.png`;
  workspaceStore.save(id, { expectedVersion: 0, nodes: [{ id: 'cover', type: 'material', position: { x: 0, y: 0 },
    data: { materialType: 'image', mediaUrl } }] });
  await writeFile(join(project.path, 'cover.png'), 'cover content');
  const home = join(workspacesDir, id);
  const cache = join(home, 'cover-summary.json');
  await symlink('retired-summary.json', cache);
  const dispatcher = createProjectDispatcher({ libraryRoot, projectStore: store, workspaceStore,
    listMediaRevision: createListMediaRevision(root, createProjectMediaResolver(workspacesDir)) });
  const result = await dispatcher.dispatch({ method: 'GET', url: prefix });
  assert.equal(result.status, 200);
  const cover = result.body.projects[0].cover;
  assert.equal(cover.kind, 'image');
  assert.equal(cover.nodeId, 'cover');
  assert.equal(cover.mediaUrl, mediaUrl);
  assert.equal(cover.unavailable, undefined);
  assert.equal(await readlink(cache), 'retired-summary.json');
  await assert.rejects(readFile(join(home, 'retired-summary.json')), { code: 'ENOENT' });
});

test('a shared read outlives one cancelled waiter and stops after its last waiter disconnects', async () => {
  const work = new SharedFileWork();
  const first = new AbortController();
  const second = new AbortController();
  const active = Promise.withResolvers();
  const released = Promise.withResolvers();
  let starts = 0;
  const read = async signal => {
    starts++;
    active.resolve(signal);
    return released.promise;
  };
  const reading = work.run('one', first.signal, read);
  const other = work.run('one', second.signal, read);
  const signal = await active.promise;
  first.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(signal.aborted, false);
  assert.equal(starts, 1);
  second.abort();
  await assert.rejects(other, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  const fresh = work.run('one', undefined, async () => { starts++; return 'fresh'; });
  await Promise.resolve();
  assert.equal(starts, 1, 'the aborted native read still owns the slot');
  released.resolve('superseded');
  assert.equal(await fresh, 'fresh');
});

test('canvas lookup honors legacy external tie order and the injected media root decision', async t => {
  const { root, libraryRoot, workspacesDir } = await fixture(t);
  const outside = join(root, 'external');
  const internal = join(libraryRoot, 'local');
  const id = 'ws_overlap';
  const legacy = { schemaVersion: 1, id: 'same-project', title: 'Copy', canvasWorkspaceIds: [id] };
  await writeRecord(internal, legacy);
  await writeRecord(outside, legacy);
  await writeFile(join(libraryRoot, '.external-projects.json'), JSON.stringify([outside]));
  await mkdir(join(workspacesDir, id), { recursive: true });
  await writeFile(join(workspacesDir, id, 'canvas.json'), '{}');
  await writeFile(join(outside, 'sample.png'), 'chosen');
  const store = createProjectStore({ libraryRoot });
  const owner = await store.findCanvasProjectForRead(id);
  assert.equal(owner.path, outside);
  assert.equal((await store.listForRead()).owners.get(id).path, outside);
  const resolveMedia = createProjectMediaResolver(workspacesDir);
  const resolveAssets = async () => store.withCanvasProject(id, owner, () => store.findByCanvasWorkspaceId(id).path);
  assert.equal((await resolveMedia(id, 'sample.png', resolveAssets)).file, join(outside, 'sample.png'));
  await assert.rejects(resolveMedia(id, 'sample.png', async () => undefined), { code: 'project-required' });
});

test('a list repair uses the same post-repair owner for covers and media', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const { root, libraryRoot, workspacesDir, store } = await fixture(t);
  const internal = join(libraryRoot, 'copy');
  const external = join(root, 'copy');
  const id = 'ws_repaired';
  const record = { schemaVersion: 1, id: 'same-project', title: 'Copy' };
  await writeRecord(internal, { ...record, canvasWorkspaceIds: [id] });
  await writeRecord(external, { ...record, updatedAt: '2025-12-31T00:00:00.000Z', canvasWorkspaceIds: [` ${id} `] });
  await writeFile(join(libraryRoot, '.external-projects.json'), JSON.stringify([external]));
  for (const [path, nodeId] of [[internal, 'inside'], [external, 'outside']]) {
    const workspace = createWorkspaceStore({ workspacesDir, resolveProjectRoot: () => ({ path }) });
    workspace.create('Copy', id);
    workspace.save(id, { expectedVersion: 0, nodes: [{ id: nodeId, type: 'material', position: { x: 0, y: 0 },
      data: { materialType: 'image', mediaUrl: `/omnimux-workflow/api/workspaces/${id}/file?rel=cover.png` } }] });
    await writeFile(join(path, 'cover.png'), nodeId);
  }
  const workspaceStore = createWorkspaceStore({ workspacesDir, resolveProjectRoot: ws => store.findByCanvasWorkspaceId(ws) });
  const resolveMedia = createProjectMediaResolver(workspacesDir);
  const dispatcher = createProjectDispatcher({ libraryRoot, projectStore: store, workspaceStore,
    listMediaRevision: createListMediaRevision(root, resolveMedia) });
  const list = await dispatcher.dispatch({ method: 'GET', url: prefix });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.projects.map(row => row.path), [internal, external]);
  assert.deepEqual(list.body.projects.map(row => row.cover.nodeId), ['outside', 'outside']);
  assert.equal(store.findByCanvasWorkspaceId(id).path, external);
  const media = await resolveMedia(id, 'cover.png', async ws => (await store.findCanvasProjectForRead(ws))?.path);
  assert.equal(media.file, join(external, 'cover.png'));
});

test('media ownership retries across a project deletion without repairing unrelated records', async t => {
  const { root, libraryRoot } = await fixture(t);
  const external = join(root, 'read-only-record');
  await writeRecord(external, { schemaVersion: 2, id: 'unrelated', title: 'Unrelated old project' });
  await writeFile(join(libraryRoot, '.external-projects.json'), JSON.stringify([external]));
  let remove = false;
  let project;
  const store = createProjectStore({ libraryRoot, workspaceDirs() {
    if (remove) {
      remove = false;
      store.remove(project.id);
    }
    return [];
  } });
  project = store.create('To remove', { canvasWorkspaceIds: ['ws_removed'] });
  assert.equal((await store.findCanvasProjectForRead('ws_removed')).path, project.path);
  remove = true;
  assert.equal(await store.findCanvasProjectForRead('ws_removed'), null);
  const raw = JSON.parse(await readFile(join(external, '.omnimux', 'project.json'), 'utf8'));
  assert.equal(raw.pages, undefined);
});

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
    assert.deepEqual(subRes.body.items.map(i => i.id), ['clips/scene1.mp4']);

    const escapeRes = await dispatcher.dispatch({ method: 'GET', url: `${prefix}/${project.id}/files?subpath=..` });
    assert.equal(escapeRes.status, 403);

    assert.equal(syncReaddir, 0, 'GET /files must not call readdirSync on Host main thread');
    assert.equal(syncStat, 0, 'GET /files must not call statSync on Host main thread');
  } finally {
    p1.mock.restore();
    p2.mock.restore();
    syncBuiltinESMExports();
  }
});
