import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
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
