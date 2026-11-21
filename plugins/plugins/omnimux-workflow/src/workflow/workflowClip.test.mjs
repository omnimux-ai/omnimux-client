import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createMockGateway,
  createProjectStore,
  createWorkspaceStore,
  mountWorkflowHost,
} from '../../dist/index.js';

const projectId = 'clip_node_original';
const source = {
  id: 'composition',
  type: 'video_composition',
  position: { x: 40, y: 60 },
  data: { projectId, title: '合成 A', status: 'idle', schema: { tracks: ['legacy'] } },
};
const otherNode = {
  id: 'notes',
  type: 'material',
  position: { x: 10, y: 20 },
  data: { materialType: 'text', nodeKind: 'import', content: 'before' },
};

function makeHarness(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-clip-')));
  const libraryRoot = join(root, 'projects');
  const paths = { root, workspacesDir: join(root, 'workspaces'), mediaDir: join(root, 'media'),
    executionsDir: join(root, 'executions'), templatesDir: join(root, 'templates') };
  const projects = createProjectStore({ libraryRoot });
  const newStore = () => createWorkspaceStore({
    workspacesDir: paths.workspacesDir,
    resolveProjectRoot: (id) => projects.findByCanvasWorkspaceId(id),
  });
  const store = newStore();
  const workspace = store.create('Canvas A');
  const project = projects.create('Project A', { canvasWorkspaceIds: [workspace.id] });
  const unrelated = projects.create('Project B');
  store.save(workspace.id, { expectedVersion: 0, nodes: [source, otherNode], edges: [] });
  const binding = { workspaceId: workspace.id, nodeId: source.id, projectId };
  const mounts = [];
  t.after(() => {
    for (const dispose of mounts) dispose();
    assert.equal(realpathSync(root), root);
    rmSync(root, { recursive: true, force: true });
  });
  function mount() {
    const seats = new Map();
    mounts.push(mountWorkflowHost({
      provide: (name, service) => seats.set(name, service),
      get: (name) => name === 'agents' ? {
        get: (sessionId) => {
          const cwd = ({ target: project.path, other: unrelated.path })[sessionId];
          return cwd ? { session: { header: { cwd } } } : undefined;
        },
      } : seats.get(name),
    }, { paths, libraryRoot, gateway: createMockGateway() }));
    const seam = seats.get('workflowClip');
    assert.ok(seam, 'mountWorkflowHost must provide workflowClip');
    return seam;
  }
  const read = () => newStore().get(binding.workspaceId);
  const exportArgs = (exportJobId) => ({
    ...binding,
    exportJobId,
    projectRevision: 4,
    output: {
      videoPath: join(root, `export-${exportJobId}.mp4`),
      revision: `123:${exportJobId}`,
      durationMs: 2400,
      width: 1280,
      height: 720,
    },
  });
  return { binding, read, exportArgs, mount, store };
}

test('Host resolves only the exact persisted composition in the trusted session workspace', t => {
  const h = makeHarness(t);
  const seam = h.mount();
  assert.deepEqual(seam.resolveBinding(h.binding, 'target'), { ...h.binding, title: '合成 A' });
  for (const session of ['other', 'unknown']) {
    assert.throws(() => seam.resolveBinding(h.binding, session), { code: 'outside-project-boundary' });
  }
  for (const binding of [
    { ...h.binding, projectId: 'clip_node_foreign' },
    { ...h.binding, nodeId: otherNode.id },
  ]) {
    assert.throws(() => seam.resolveBinding(binding), { code: 'clip-binding-mismatch' });
    assert.throws(() => seam.saveDraft({ ...binding, revision: 1 }), { code: 'clip-binding-mismatch' });
    assert.throws(() => seam.commitExport({ ...h.exportArgs(1), ...binding }), { code: 'clip-binding-mismatch' });
  }
  assert.throws(() => seam.resolveBinding({ ...h.binding, workspaceId: '../elsewhere' }), { code: 'invalid-clip-binding' });
  assert.equal(h.read().version, 1);
});

test('draft pointer persists with the Portal absent and stays monotonic', t => {
  const h = makeHarness(t);
  const seam = h.mount();
  const receipt = seam.saveDraft({ ...h.binding, revision: 8 });
  assert.deepEqual(receipt, { revision: 8, workspaceVersion: 2 });
  const disk = h.read();
  assert.equal(disk.version, 2);
  assert.deepEqual(disk.nodes[0].data, { ...source.data, draftRevision: 8 });
  assert.deepEqual(disk.nodes[1], otherNode);
  const restarted = h.mount();
  assert.equal(restarted.resolveBinding(h.binding).draftRevision, 8);
  assert.deepEqual(restarted.saveDraft({ ...h.binding, revision: 8 }), receipt);
  assert.deepEqual(restarted.saveDraft({ ...h.binding, revision: 3 }), receipt);
  assert.throws(() => restarted.saveDraft({ ...h.binding, revision: 8.5 }), { code: 'invalid-clip-revision' });
  assert.deepEqual(h.read(), disk);
});

test('Host commits the source, material and out→in edge together with no Canvas client', t => {
  const h = makeHarness(t);
  const seam = h.mount();
  const input = h.exportArgs(15);
  const receipt = seam.commitExport(input);
  assert.deepEqual(receipt, { status: 'committed', canvasCommitted: true, workspaceVersion: 2 });
  const disk = h.read();
  const [composition, unchanged, material] = disk.nodes;
  assert.equal(disk.version, 2);
  assert.deepEqual(unchanged, otherNode);
  assert.equal(composition.data.status, 'completed');
  assert.deepEqual(composition.data.schema, source.data.schema);
  assert.equal(composition.data.outputRevision, input.output.revision);
  assert.equal(composition.data.outputDurationMs, 2400);
  assert.equal(composition.data.outputWidth, 1280);
  assert.equal(composition.data.outputHeight, 720);
  assert.equal(material.data.sourceCompositionNodeId, source.id);
  assert.equal(material.data.materialType, 'video');
  assert.deepEqual(material.position, { x: 470, y: 60 });
  assert.equal(composition.data.outputVideoUrl, material.data.mediaUrl);
  const playback = new URL(material.data.mediaUrl, 'http://localhost');
  assert.equal(playback.pathname, '/omnimux-workflow/api/local-file');
  assert.equal(playback.searchParams.get('path'), input.output.videoPath);
  assert.equal(playback.searchParams.get('rev'), input.output.revision);
  assert.deepEqual(disk.edges.map(({ source, target, sourceHandle, targetHandle }) =>
    [source, target, sourceHandle, targetHandle]), [[composition.id, material.id, 'out', 'in']]);
  assert.deepEqual(h.mount().commitExport(input), receipt);
  assert.deepEqual(h.read(), disk);
});

test('re-export reuses the downstream node and rejects out-of-order or conflicting replays', t => {
  const h = makeHarness(t);
  const first = h.mount().commitExport(h.exportArgs(20));
  const oldGraph = h.read();
  const current = h.mount();
  current.commitExport(h.exportArgs('22'));
  const newGraph = h.read();
  assert.equal(newGraph.version, 3);
  assert.equal(newGraph.nodes.at(-1).id, oldGraph.nodes.at(-1).id);
  assert.deepEqual(newGraph.edges, oldGraph.edges);
  assert.equal(newGraph.nodes[0].data.outputRevision, '123:22');
  assert.equal(newGraph.nodes.at(-1).data.mediaUrl, newGraph.nodes[0].data.outputVideoUrl);
  assert.deepEqual(current.commitExport(h.exportArgs(21)), { status: 'superseded', canvasCommitted: false });
  assert.deepEqual(current.commitExport(h.exportArgs(20)), first);
  assert.throws(() => current.commitExport({ ...h.exportArgs(22), projectRevision: 9 }), { code: 'clip-export-job-mismatch' });
  assert.deepEqual(h.read(), newGraph);
});

test('Host can save an original binding after unrelated canvas edits and rejects a deleted or rebound node', t => {
  const h = makeHarness(t);
  const seam = h.mount();
  const old = h.read();
  const changed = { ...otherNode, position: { x: 310, y: 220 }, data: { ...otherNode.data, content: 'edited live' } };
  h.store.save(h.binding.workspaceId, { expectedVersion: old.version, name: 'Renamed', nodes: [source, changed] });
  seam.saveDraft({ ...h.binding, revision: 10 });
  seam.commitExport(h.exportArgs(30));
  const disk = h.read();
  assert.equal(disk.name, 'Renamed');
  assert.deepEqual(disk.nodes[1], changed);
  assert.equal(disk.nodes[0].data.draftRevision, 10);
  const copy = { ...source, data: { ...source.data, projectId: 'clip_node_copy' } };
  h.store.save(h.binding.workspaceId, { expectedVersion: disk.version, nodes: [copy], edges: [] });
  assert.throws(() => seam.commitExport(h.exportArgs(31)), { code: 'clip-binding-mismatch' });
  assert.throws(() => seam.saveDraft({ ...h.binding, revision: 11 }), { code: 'clip-binding-mismatch' });
  assert.deepEqual(h.read().nodes, [copy]);
});
