import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createWorkflowClipService } from '../../workflow/clip/workflowClip.ts';
import { createWorkspaceRoutes } from '../../workflow/routes/workspaceRoutes.ts';
import { createWorkspaceStore } from '../../workflow/workspace/WorkspaceStore.ts';

const { JSDOM } = createRequire(new URL('../../../omnimux/package.json', import.meta.url))('jsdom');
const client = await build({
  stdin: {
    contents: `export { useCanvasStore } from '../store/canvasStore';
      export { useWorkspacePersistence } from './useWorkspacePersistence';
      export { openCanvasClipNode } from './canvasClipActions';
      export { act, createElement, useEffect } from 'react';
      export { createRoot } from 'react-dom/client';`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'canvasTest',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const json = value => JSON.parse(JSON.stringify(value));
const note = graph => graph.nodes.find(node => node.id === 'note').data.content;
const source = graph => graph.nodes.find(node => node.id === 'composition');
const downstream = graph => graph.nodes.filter(node => node.data.origin === 'clip_export'
  && node.data.sourceCompositionNodeId === 'composition');

async function fixture(t, { priorExport = false, brokenOutputLine = false, unbound = false } = {}) {
  const workspacesDir = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-clip-history-')));
  t.after(() => { assert.equal(realpathSync(workspacesDir), workspacesDir); rmSync(workspacesDir, { recursive: true }); });
  const disk = createWorkspaceStore({ workspacesDir });
  const seed = (id, content, projectId = `clip_node_${id}`) => {
    const binding = { workspaceId: id, nodeId: 'composition', projectId };
    disk.create('Canvas', id);
    disk.save(id, { expectedVersion: 0, nodes: [
      { id: 'composition', type: 'video_composition', position: { x: 0, y: 0 }, data: { projectId, status: 'idle' } },
      { id: 'note', type: 'material', position: { x: 0, y: 100 }, data: { materialType: 'text', nodeKind: 'import', content } },
    ] });
    return binding;
  };
  let binding = seed('ws_first', 'initial', unbound ? null : undefined);
  const workflowClip = createWorkflowClipService({ store: disk });
  const commit = job => {
    const output = { videoPath: join(workspacesDir, `job-${job}.mp4`), revision: `export-${job}`, durationMs: job * 1000, width: 640, height: 360 };
    // The Workflow seam accepts the output metadata of a file already written by Clip.
    writeFileSync(output.videoPath, `fixture output ${job}`);
    const receipt = workflowClip.commitExport({ ...binding, exportJobId: job, projectRevision: job, output });
    assert.equal(receipt.canvasCommitted, true);
    const graph = disk.get(binding.workspaceId);
    assert.equal(receipt.workspaceVersion, graph.version);
    return { graph, output };
  };
  const firstExport = priorExport ? commit(1) : undefined;
  if (brokenOutputLine) {
    const { version, edges: [edge] } = disk.get(binding.workspaceId);
    disk.save(binding.workspaceId, { expectedVersion: version, edges: [
      { ...edge, id: 'legacy-output-line', sourceHandle: 'output', targetHandle: 'input' },
    ] });
  }

  const { window } = new JSDOM('<div id="root"></div>', { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true });
  window.IS_REACT_ACT_ENVIRONMENT = true;
  window.MessageChannel = class {
    port1 = { onmessage: null };
    port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) };
  };
  const timers = new Map();
  const polls = new Map();
  let timerId = 0;
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (fn, delay, ...args) => {
    if (delay !== 1000 && delay !== 2500) return nativeSetTimeout(fn, delay, ...args);
    const id = -(++timerId);
    timers.set(id, { fn, delay });
    return id;
  };
  window.clearTimeout = id => id < 0 ? timers.delete(id) : nativeClearTimeout(id);
  window.setInterval = fn => { polls.set(++timerId, fn); return timerId; };
  window.clearInterval = id => polls.delete(id);
  let now = 1000;
  window.Date.now = () => now;

  const { tryHandle } = createWorkspaceRoutes(disk);
  const puts = [];
  let deferRead;
  window.fetch = async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    const path = new URL(url, window.location.origin).pathname;
    let result;
    try {
      result = await tryHandle(options.method, path, { url, method: options.method, body });
      assert.ok(result, `Unexpected Workspace route ${options.method} ${path}`);
    } catch (error) {
      if (error.code !== 'version_conflict') throw error;
      result = { status: 409, body: { error: error.code, current: error.current } };
    }
    if (options.method === 'PUT') puts.push({ path, expectedVersion: body.expectedVersion, status: result.status });
    if (options.method === 'GET' && result.body.workspace && deferRead) await deferRead(result.body.workspace);
    return Response.json(result.body, { status: result.status });
  };
  window.eval(client.outputFiles[0].text);
  const { act, createElement, createRoot, useEffect, useCanvasStore, useWorkspacePersistence, openCanvasClipNode } = window.canvasTest;
  const state = useCanvasStore.getState;
  const root = createRoot(window.document.getElementById('root'));
  const flush = fn => act(async () => { await fn?.(); });
  t.after(async () => { await flush(() => root.unmount()); window.close(); });
  let persistence;
  const show = workspace => root.render(createElement(Canvas, { workspace }));
  function Canvas({ workspace }) {
    const nodes = useCanvasStore(value => value.nodes);
    const edges = useCanvasStore(value => value.edges);
    persistence = useWorkspacePersistence(workspace, { enabled: Boolean(workspace), onSaved: show });
    useEffect(() => state().pushHistory(), [nodes, edges]);
    return null;
  }
  const open = async snapshot => {
    await flush(() => show(null));
    await flush(() => {
      state().resetStore();
      state().hydrateGraph(snapshot.nodes, snapshot.edges);
      show(snapshot);
    });
  };
  await open(disk.get(binding.workspaceId));
  const autosave = () => flush(() => {
    const scheduled = [...timers].find(([, timer]) => timer.delay === 1000);
    if (scheduled) {
      timers.delete(scheduled[0]);
      scheduled[1].fn();
    }
  });
  return {
    state, commit, firstExport, puts, seed, open, flush, autosave,
    openClip: () => flush(async () => {
      binding = await openCanvasClipNode({
        ...binding,
        readGraph: state,
        updateNode: (nodeId, data) => state().applyCanvasInputMutation({ nodePatches: [{ nodeId, data }] }),
        ensurePersisted: () => persistence.saveNow(),
        stillCurrent: () => true,
        target: window,
        defaultTitle: 'Canvas composition',
      });
      assert.ok(binding);
    }),
    saveDraft: revision => workflowClip.saveDraft({ ...binding, revision }),
    read: (id = binding.workspaceId) => createWorkspaceStore({ workspacesDir }).get(id),
    poll: () => flush(() => { for (const tick of polls.values()) tick(); }),
    deferRead: handler => { deferRead = handler; },
    tickHistory: () => { now += 400; },
    edit: (content, localEdge = false) => {
      assert.equal(state().applyCanvasInputMutation({ nodePatches: [{ nodeId: 'note', data: { content } }] }).status, 'allowed');
      if (localEdge) {
        assert.equal(state().applyCanvasInputMutation({ addEdges: [
          { id: 'uncommitted-line', source: 'note', target: 'composition', sourceHandle: 'out', targetHandle: 'in' },
        ] }).status, 'allowed');
      }
    },
    get persistence() { return persistence; },
  };
}

function assertExport(graph, expected, { linked = true } = {}) {
  const { graph: committed, output } = expected;
  assert.equal(source(graph).data.outputRevision, output.revision, `Workspace ${graph.version ?? 'live'} lost the latest Host export`);
  assert.equal(source(graph).data.outputVideoUrl, source(committed).data.outputVideoUrl);
  assert.deepEqual(json(source(graph).data.clipExportReceipts), source(committed).data.clipExportReceipts);
  const [material] = downstream(committed);
  assert.deepEqual(Array.from(downstream(graph), node => node.id), [material.id]);
  assert.equal(downstream(graph)[0].data.mediaUrl, material.data.mediaUrl);
  assert.deepEqual(json(graph.edges.filter(edge => edge.source === 'composition' && edge.target === material.id)),
    linked ? committed.edges.filter(edge => edge.source === 'composition' && edge.target === material.id) : []);
  const url = new URL(material.data.mediaUrl, 'http://localhost');
  assert.equal(url.searchParams.get('rev'), output.revision);
  assert.equal(url.searchParams.get('path'), output.videoPath);
  assert.equal(readFileSync(output.videoPath, 'utf8'), `fixture output ${source(committed).data.clipExportReceipts.at(-1).projectRevision}`);
}

test('Undo after a real Clip CAS race saves only the reverted text and local line, then Redo and reopen retain the export', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('my edit', true));
  assert.equal(f.state().past.length, 1);
  const committed = f.commit(1);
  await f.autosave();
  assert.deepEqual(f.puts.map(({ expectedVersion, status }) => [expectedVersion, status]), [[1, 409], [2, 200]]);
  assertExport(f.read(), committed);
  assert.equal(note(f.read()), 'my edit');
  assert.equal(f.read().edges.length, 2);

  await f.flush(() => f.state().undo());
  await f.autosave();
  const undone = f.read();
  assert.equal(undone.version, 4);
  assert.equal(f.puts.at(-1).expectedVersion, 3);
  assert.equal(note(undone), 'initial');
  t.diagnostic(`Undo PUT expectedVersion=3 advanced to ${undone.version}, links=${undone.edges.length}, export=${source(undone).data.outputRevision}`);
  assertExport(undone, committed);
  assert.equal(undone.edges.length, 1);
  assert.equal(f.state().past.length, 0);
  assert.equal(f.state().future.length, 1);

  await f.flush(() => f.state().redo());
  await f.autosave();
  const redone = f.read();
  assert.equal(redone.version, 5);
  assert.equal(f.puts.at(-1).expectedVersion, 4);
  assert.equal(note(redone), 'my edit');
  assert.equal(redone.edges.length, 2);
  await f.open(redone);
  assertExport(f.state(), committed);
  assert.equal(note(f.state()), 'my edit');
  assert.equal(f.state().past.length, 0);
  assert.equal(f.state().future.length, 0);
});

test('A clean canvas keeps a pending Redo through the first Host export and subsequent draft and export writes', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('redo me'));
  await f.flush(() => f.state().undo());
  assert.equal(f.state().future.length, 1);
  f.tickHistory();
  const first = f.commit(1);
  await f.poll();
  assertExport(f.state(), first);
  assert.equal(f.state().past.length, 0, 'Host commit must not create an Undo step');
  assert.equal(f.state().future.length, 1, 'Host commit must not discard Redo');
  f.saveDraft(7);
  await f.poll();
  assert.equal(source(f.state()).data.draftRevision, 7);
  const second = f.commit(2);
  await f.poll();
  assertExport(f.state(), second);
  const third = f.commit(3);
  await f.poll();
  assert.equal(downstream(f.state())[0].id, downstream(first.graph)[0].id);
  assert.deepEqual(json(f.state().edges), first.graph.edges);
  assertExport(f.state(), third);
  assert.equal(f.puts.length, 0);

  await f.flush(() => f.state().redo());
  await f.autosave();
  assert.equal(note(f.read()), 'redo me');
  assertExport(f.read(), third);
  await f.flush(() => f.state().undo());
  await f.autosave();
  assert.equal(note(f.read()), 'initial');
  assertExport(f.read(), third);
});

test('Redo can delete a durable line after a newer export and Undo restores that same line with the newest media', async t => {
  const f = await fixture(t, { priorExport: true });
  const line = f.firstExport.graph.edges[0];
  await f.flush(() => f.state().removeEdge(line.id));
  await f.flush(() => f.state().undo());
  const latest = f.commit(2);
  await f.poll();
  assertExport(f.state(), latest);
  await f.flush(() => f.state().redo());
  await f.autosave();
  assertExport(f.read(), latest, { linked: false });
  assert.equal(f.read().edges.length, 0);
  await f.flush(() => f.state().undo());
  await f.autosave();
  assertExport(f.read(), latest);
  assert.deepEqual(f.read().edges, [line]);
});

for (const undoBeforeCommit of [true, false]) {
  test(`The Host repair keeps one line across Undo/Redo with an uncommitted overlap ${undoBeforeCommit ? 'in history' : 'in the canvas'}`, async t => {
    const f = await fixture(t, { priorExport: true, brokenOutputLine: true });
    await f.flush(() => {
      f.edit('text beside temporary line');
      const pending = { ...f.firstExport.graph.edges[0], id: 'temporary-output-line' };
      assert.equal(f.state().applyCanvasInputMutation({ addEdges: [pending] }).status, 'allowed');
    });
    if (undoBeforeCommit) await f.flush(() => f.state().undo());
    const latest = f.commit(2);
    await f.poll();
    assertExport(f.state(), latest);
    if (!undoBeforeCommit) await f.flush(() => f.state().undo());
    assert.equal(f.state().future.length, 1);
    await f.flush(() => f.state().redo());
    await f.autosave();
    const saved = f.read();
    assert.equal(note(saved), 'text beside temporary line');
    assertExport(saved, latest);
    assert.equal(saved.edges.length, 1);
    assert.equal(saved.edges[0].id, f.firstExport.graph.edges[0].id);
  });
}

test('A text change in the same render as the Host merge still records its own Undo step', async t => {
  const f = await fixture(t);
  const latest = f.commit(1);
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  await f.poll();
  await f.flush(() => {
    f.edit('text before render');
    release.resolve();
  });
  assert.equal(f.state().past.length, 1);
  assertExport(f.state(), latest);
  await f.flush(() => f.state().undo());
  await f.autosave();
  assert.equal(note(f.state()), 'initial');
  assertExport(f.state(), latest);
  assert.equal(f.puts.length, 0, 'the reverted edit never needs to reach disk');
});

test('Undo while fetching a 409 recovery does not retry the undone text and keeps Redo', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('reverted during request'));
  const latest = f.commit(1);
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  await f.autosave();
  assert.equal(f.puts.at(-1).status, 409);
  await f.flush(() => f.state().undo());
  await f.flush(() => release.resolve());
  assert.equal(f.puts.length, 1, 'a skipped edit must not become a successful retry');
  assert.equal(note(f.read()), 'initial');
  assert.equal(f.read().version, latest.graph.version);
  assertExport(f.read(), latest);
  assert.equal(f.persistence.status, 'idle');
  assert.equal(f.persistence.isDirty, false);
  assert.equal(f.state().future.length, 1);
  await f.flush(() => f.state().redo());
  await f.autosave();
  assert.equal(f.puts.at(-1).expectedVersion, latest.graph.version);
  assert.equal(note(f.read()), 'reverted during request');
  assertExport(f.read(), latest);
});

test('An explicit material deletion can save and a later export never resurrects its obsolete node during Undo', async t => {
  const f = await fixture(t, { priorExport: true });
  const [oldMaterial] = downstream(f.firstExport.graph);
  await f.flush(() => f.state().deleteElements([oldMaterial.id], []));
  await f.autosave();
  assert.equal(f.read().version, 3);
  assert.equal(f.puts.at(-1).expectedVersion, 2);
  assert.equal(downstream(f.read()).length, 0);
  assert.deepEqual(f.read().edges, []);
  assert.equal(source(f.read()).data.outputRevision, f.firstExport.output.revision);

  // A normal user edit made after the deletion stays undoable across re-export.
  f.tickHistory();
  await f.flush(() => f.edit('after deletion'));
  const latest = f.commit(2);
  assert.notEqual(downstream(latest.graph)[0].id, oldMaterial.id);
  await f.poll();
  await f.autosave();
  await f.flush(() => f.state().undo());
  await f.autosave();
  assert.equal(note(f.read()), 'initial');
  assertExport(f.read(), latest);
  assert.equal(f.state().past.length, 0, 'superseded deletion has no older media to restore');
  await f.flush(() => f.state().undo());
  await f.autosave();
  assertExport(f.read(), latest);
});

test('Undo of text edited before the first Clip open keeps that composition binding and its export on disk', async t => {
  const f = await fixture(t, { unbound: true });
  await f.flush(() => f.edit('edited before Clip opens'));
  await f.openClip();
  const latest = f.commit(1);
  await f.poll();
  assertExport(f.state(), latest);
  await f.flush(() => f.state().undo());
  await f.autosave();
  const restored = f.read();
  assert.equal(note(restored), 'initial');
  assert.equal(source(restored).data.projectId, source(latest.graph).data.projectId);
  assertExport(restored, latest);
});

test('A returned Clip snapshot cannot touch a switched workspace with reused node IDs or history', async t => {
  const f = await fixture(t, { priorExport: true });
  await f.flush(() => f.edit('first canvas edit'));
  await f.flush(() => f.state().undo());
  const late = f.commit(2);
  const capture = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.deferRead(snapshot => { capture.resolve(snapshot); return release.promise; });
  await f.poll();
  assert.equal((await capture.promise).version, late.graph.version);

  const other = f.seed('ws_second', 'second initial');
  await f.open(f.read(other.workspaceId));
  assert.equal(f.state().past.length, 0);
  assert.equal(f.state().future.length, 0);
  await f.flush(() => f.edit('second canvas edit'));
  await f.flush(() => release.resolve());
  assert.equal(source(f.state()).data.projectId, other.projectId);
  assert.equal(source(f.state()).data.outputRevision, undefined);
  assert.equal(note(f.state()), 'second canvas edit');
  assert.equal(f.state().past.length, 1);
  await f.flush(() => f.state().undo());
  assert.equal(note(f.state()), 'second initial');
  assert.deepEqual(json(f.state().edges), []);
  assertExport(f.read(), late);
});
