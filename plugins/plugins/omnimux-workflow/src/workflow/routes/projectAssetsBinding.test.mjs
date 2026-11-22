import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: [
  "export { createWorkflowDispatcher, registerWorkflowRoutes } from './src/workflow/routes/canvasRoutes.ts';",
  "export { createWorkspaceStore } from './src/workflow/workspace/WorkspaceStore.ts';",
  "export { createProjectAssetsStore } from './src/workflow/workspace/ProjectAssetsStore.ts';",
  "export { createProjectStore } from './src/projects/ProjectStore.ts';",
  "export { bindEnsureProjectBound } from './src/projects/ensureProjectBound.ts';",
].join('\n'), resolveDir: new URL('../../..', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.url': JSON.stringify(new URL('./pluginRoot.ts', import.meta.url).href) }, write: false });
const host = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wf-asset-bind-'));
  const projectStore = host.createProjectStore({ libraryRoot: join(root, 'library') });
  const resolveProjectRoot = id => projectStore.findByCanvasWorkspaceId(id);
  const store = host.createWorkspaceStore({ workspacesDir: join(root, 'workspaces'), resolveProjectRoot });
  const source = join(root, 'hero.png');
  writeFileSync(source, 'test-image');
  const assetsStore = host.createProjectAssetsStore({ workspacesDir: store.workspacesDir, resolveProjectRoot,
    fetchLibraryDetail: async () => ({ files: [{ real_path: source, visible: true }] }) });
  const dispatcher = host.createWorkflowDispatcher({ store, projectStore, assetsStore,
    ensureProjectBound: host.bindEnsureProjectBound(projectStore), libraryRoot: join(root, 'library'),
    mediaDir: join(root, 'media'), gateway: {}, executionManager: {} });
  return { root, source, store, projectStore, assetsStore, dispatcher };
}

for (const action of ['instantiate', 'ingest']) {
  test(action + ': unbound canvas binds one reusable project and preserves graph', async () => {
    const f = fixture();
    try {
      const ws = f.store.create('角色复刻');
      f.store.save(ws.id, { expectedVersion: 0, nodes: [
        { id: 'existing_a', type: 'material', position: { x: 10, y: 20 }, data: { label: '原有文本' } },
        { id: 'existing_b', type: 'material', position: { x: 40, y: 50 }, data: { label: '原有图片' } },
      ], edges: [{ id: 'existing_edge', source: 'existing_a', target: 'existing_b' }] });
      const before = f.store.get(ws.id);
      const request = { method: 'POST', url: '/omnimux-workflow/api/workspaces/' + ws.id + '/assets/' + action,
        origin: 'http://localhost:3000', body: action === 'instantiate'
          ? { globalSubjectId: 'subject_a', expectedRev: 0 } : { paths: [f.source], expectedRev: 0 } };
      const result = await f.dispatcher.dispatch(request);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.assets.items.length, 1);
      const project = f.projectStore.findByCanvasWorkspaceId(ws.id);
      assert.ok(project);
      assert.equal(project.title, '角色复刻');
      assert.deepEqual(f.store.get(ws.id), before);
      assert.equal(readFileSync(f.assetsStore.resolveProjectFile(ws.id, result.body.assets.items[0].relative_path), 'utf8'), 'test-image');
      const second = await f.dispatcher.dispatch({ ...request, body: { ...request.body, expectedRev: 1 } });
      assert.equal(second.status, 200);
      assert.equal(f.projectStore.list().length, 1);
      assert.equal(f.projectStore.findByCanvasWorkspaceId(ws.id).id, project.id);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('project file routes honor an injected asset store without an explicit root resolver', async t => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const ws = f.store.create('Read from custom store');
  const project = f.projectStore.create('Default project', { canvasWorkspaceIds: [ws.id] });
  writeFileSync(join(project.path, 'hero.png'), 'default-project-image');
  const assetsStore = { ...f.assetsStore, resolveProjectFile(id, rel) {
    assert.equal(id, ws.id);
    assert.equal(rel, 'hero.png');
    return f.source;
  } };
  const dispatcher = host.createWorkflowDispatcher({ store: f.store, projectStore: f.projectStore, assetsStore,
    libraryRoot: join(f.root, 'library'), mediaDir: join(f.root, 'media'), gateway: {}, executionManager: {} });
  for (const url of [`/omnimux-workflow/api/workspaces/${ws.id}/file?rel=hero.png`,
    `/omnimux-workflow/api/project-file?workspace=${ws.id}&rel=hero.png`]) {
    const result = await dispatcher.dispatch({ method: 'GET', url });
    assert.equal(result.status, 200);
    assert.equal(result.file, f.source);
  }
});

test('both project file URLs use the injected asset store even when an asset root resolver is supplied', { timeout: 10000 }, async t => {
  const f = fixture();
  const ws = f.store.create('Custom store');
  const project = f.projectStore.create('Root resolver project', { canvasWorkspaceIds: [ws.id] });
  writeFileSync(join(project.path, 'hero.png'), 'root-resolver-image');
  const calls = [];
  let rootChecks = 0;
  const assetsStore = { ...f.assetsStore, resolveProjectFile(id, rel) {
    calls.push([id, rel]);
    return f.source;
  } };
  const dispatcher = host.createWorkflowDispatcher({ store: f.store, projectStore: f.projectStore, assetsStore,
    resolveAssetsRoot() { rootChecks++; return { path: project.path }; },
    libraryRoot: join(f.root, 'library'), mediaDir: join(f.root, 'media'), gateway: {}, executionManager: {} });
  let handler;
  const unregister = host.registerWorkflowRoutes({ register(route) {
    if (route.path === '/omnimux-workflow') handler = route.handler;
    return () => {};
  } }, dispatcher);
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    unregister();
    rmSync(f.root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const url of [`/omnimux-workflow/api/workspaces/${ws.id}/file?rel=hero.png`,
    `/omnimux-workflow/api/project-file?workspace=${ws.id}&rel=hero.png`]) {
    const result = await fetch(origin + url, { headers: { range: 'bytes=0-3' } });
    assert.equal(result.status, 206);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from('test'));
  }
  assert.deepEqual(calls, [[ws.id, 'hero.png'], [ws.id, 'hero.png']]);
  assert.equal(rootChecks, 0);
});

test('missing canvas, malformed body and foreign requests do not create projects', async () => {
  const f = fixture();
  try {
    const ws = f.store.create('角色');
    for (const request of [
      { method: 'POST', url: '/omnimux-workflow/api/workspaces/ws_missing/assets/instantiate', origin: 'http://localhost:3000', body: { globalSubjectId: 'subject_a' } },
      { method: 'POST', url: '/omnimux-workflow/api/workspaces/' + ws.id + '/assets/instantiate', origin: 'http://localhost:3000', body: null },
      { method: 'POST', url: '/omnimux-workflow/api/workspaces/' + ws.id + '/assets/instantiate', origin: 'https://foreign.example', body: { globalSubjectId: 'subject_a' } },
    ]) {
      const result = await f.dispatcher.dispatch(request);
      assert.ok(result.status >= 400);
      assert.equal(f.projectStore.list().length, 0);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
