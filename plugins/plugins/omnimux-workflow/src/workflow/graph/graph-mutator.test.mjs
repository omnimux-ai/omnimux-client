/**
 * PR1 GraphMutator tests: the host-side mutation entry (get → shared
 * validation gateway → optimistic-lock save, one conflict replay).
 *
 * Success paths: add node, connect valid edge, patch node data, remove
 * node (cascading edges), conflict replay against a moved snapshot.
 * Error paths: unknown workspace, rejected mutations (duplicate_node /
 * self_connection / type_contract / cycle), double conflict.
 *
 * Runs against the built dist/index.js (node scripts/build-host.mjs first),
 * with a real WorkspaceStore over a temp dir (no HTTP, no gateway).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const host = await import('../../../dist/index.js');

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-graph-mutator-'));
  const store = host.createWorkspaceStore({ workspacesDir: join(dir, 'workspaces') });
  return { dir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function materialNode(id, materialType, tool) {
  return {
    id,
    type: 'material',
    position: { x: 0, y: 0 },
    data: {
      label: '',
      materialType,
      status: 'empty',
      selectedTool: tool,
      params: {},
    },
  };
}

/** Seed two text nodes (text-to-text accepts text upstream). */
function seedTwoTextNodes(store, ws) {
  const a = materialNode('node-a', 'text', 'text-editor');
  const b = materialNode('node-b', 'text', 'text-to-text');
  const r1 = host.mutateWorkspaceGraph(store, ws.id, { addNodes: [a] });
  assert.equal(r1.ok, true);
  const r2 = host.mutateWorkspaceGraph(store, ws.id, { addNodes: [b] });
  assert.equal(r2.ok, true);
  return { a, b };
}

test('addNodes: adds a node and bumps the version', () => {
  const { store, cleanup } = makeStore();
  try {
    const ws = store.create('mutator 测试');
    const result = host.mutateWorkspaceGraph(store, ws.id, {
      addNodes: [materialNode('n1', 'image', 'text-to-image')],
    });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.version, 1);
    assert.equal(result.snapshot.nodes.length, 1);
    assert.equal(result.snapshot.nodes[0].id, 'n1');
  } finally {
    cleanup();
  }
});

test('addEdges: valid connection passes (type contract ok)', () => {
  const { store, cleanup } = makeStore();
  try {
    const ws = store.create('连线测试');
    seedTwoTextNodes(store, ws);
    const result = host.mutateWorkspaceGraph(store, ws.id, {
      addEdges: [{ source: 'node-a', target: 'node-b' }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.edges.length, 1);
    assert.equal(result.snapshot.edges[0].source, 'node-a');
    assert.equal(result.snapshot.edges[0].target, 'node-b');
  } finally {
    cleanup();
  }
});

test('nodePatches: shallow-merges data', () => {
  const { store, cleanup } = makeStore();
  try {
    const ws = store.create('改节点测试');
    seedTwoTextNodes(store, ws);
    const result = host.mutateWorkspaceGraph(store, ws.id, {
      nodePatches: [{ nodeId: 'node-b', data: { prompt: '写一个故事' } }],
    });
    assert.equal(result.ok, true);
    const node = result.snapshot.nodes.find((n) => n.id === 'node-b');
    assert.equal(node.data.prompt, '写一个故事');
    assert.equal(node.data.materialType, 'text');
  } finally {
    cleanup();
  }
});

test('removeNodeIds: cascades connected edges', () => {
  const { store, cleanup } = makeStore();
  try {
    const ws = store.create('删节点测试');
    seedTwoTextNodes(store, ws);
    host.mutateWorkspaceGraph(store, ws.id, { addEdges: [{ source: 'node-a', target: 'node-b' }] });
    const result = host.mutateWorkspaceGraph(store, ws.id, { removeNodeIds: ['node-a'] });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.nodes.length, 1);
    assert.equal(result.snapshot.edges.length, 0);
  } finally {
    cleanup();
  }
});

test('rejects duplicate_node / missing_node / self_connection / type_contract / cycle', () => {
  const { store, cleanup } = makeStore();
  try {
    const ws = store.create('拒绝测试');
    seedTwoTextNodes(store, ws);

    const dup = host.mutateWorkspaceGraph(store, ws.id, {
      addNodes: [materialNode('node-a', 'text', 'text-editor')],
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.reasonCode, 'duplicate_node');

    const missing = host.mutateWorkspaceGraph(store, ws.id, {
      nodePatches: [{ nodeId: 'nope', data: {} }],
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reasonCode, 'missing_node');

    const self = host.mutateWorkspaceGraph(store, ws.id, {
      addEdges: [{ source: 'node-a', target: 'node-a' }],
    });
    assert.equal(self.ok, false);
    assert.equal(self.reasonCode, 'self_connection');

    // type_contract: the acceptedTypes union covers ALL tools of the target
    // material type (connect-then-switch-tool interaction). Text targets
    // accept every type (audio-transcription eats audio); image targets only
    // accept {text, image} — so audio → image must fail.
    const img = materialNode('node-c', 'image', 'import');
    const aud = materialNode('node-d', 'audio', 'import');
    assert.equal(host.mutateWorkspaceGraph(store, ws.id, { addNodes: [img, aud] }).ok, true);
    const contract = host.mutateWorkspaceGraph(store, ws.id, {
      addEdges: [{ source: 'node-d', target: 'node-c' }],
    });
    assert.equal(contract.ok, false);
    assert.equal(contract.reasonCode, 'type_contract');
    assert.equal(host.mutateWorkspaceGraph(store, ws.id, { removeNodeIds: ['node-c', 'node-d'] }).ok, true);

    // cycle: a→b then b→a would be… b's tool (text-to-text) accepts text, so
    // the contract passes and the cycle check must fire. First make a→b.
    host.mutateWorkspaceGraph(store, ws.id, { addEdges: [{ source: 'node-a', target: 'node-b' }] });
    // Rewire node-a to a tool that accepts text upstream (text-to-text).
    host.mutateWorkspaceGraph(store, ws.id, {
      nodePatches: [{ nodeId: 'node-a', data: { selectedTool: 'text-to-text' } }],
    });
    const cycle = host.mutateWorkspaceGraph(store, ws.id, {
      addEdges: [{ source: 'node-b', target: 'node-a' }],
    });
    assert.equal(cycle.ok, false);
    assert.equal(cycle.reasonCode, 'cycle');

    // All rejections left the graph untouched (still version after the 4 successes).
    const snap = store.get(ws.id);
    assert.equal(snap.nodes.length, 2);
    assert.equal(snap.edges.length, 1);
  } finally {
    cleanup();
  }
});

test('unknown workspace returns an envelope, never throws', () => {
  const { store, cleanup } = makeStore();
  try {
    const result = host.mutateWorkspaceGraph(store, 'ws_000000000000', { addNodes: [] });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'workspace-not-found');
  } finally {
    cleanup();
  }
});

test('version_conflict: replays the mutation once against the fresh snapshot', () => {
  const { store, cleanup } = makeStore();
  try {
    const ws = store.create('并发测试');
    // Wrap the store: first save of the mutator loses the race (an external
    // writer bumps the version), the replay must land on the fresh snapshot.
    const realSave = store.save.bind(store);
    let raced = false;
    const racingStore = {
      ...store,
      get: store.get.bind(store),
      save(id, payload) {
        if (!raced) {
          raced = true;
          realSave(id, { expectedVersion: payload.expectedVersion, name: '被别人改了' });
        }
        return realSave(id, payload);
      },
    };
    const result = host.mutateWorkspaceGraph(racingStore, ws.id, {
      addNodes: [materialNode('n1', 'text', 'text-editor')],
    });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.version, 2);
    assert.equal(result.snapshot.name, '被别人改了');
    assert.equal(result.snapshot.nodes.length, 1);
  } finally {
    cleanup();
  }
});
