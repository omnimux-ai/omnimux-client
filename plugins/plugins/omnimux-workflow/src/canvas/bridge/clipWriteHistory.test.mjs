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
const note = graph => graph.nodes.find(node => node.id === 'note')?.data.content;
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
  const submitExport = (job, { projectRevision = job, revisionEpoch, exportGeneration } = {}) => {
    const output = { videoPath: join(workspacesDir, `job-${job}.mp4`), revision: `export-${job}`, durationMs: job * 1000, width: 640, height: 360 };
    // The Workflow seam accepts the output metadata of a file already written by Clip.
    writeFileSync(output.videoPath, `fixture output ${projectRevision}`);
    const receipt = workflowClip.commitExport({ ...binding, exportJobId: job, projectRevision, revisionEpoch, exportGeneration, output });
    return { receipt, output };
  };
  const saveOnHost = (patch = {}) => {
    const current = disk.get(binding.workspaceId);
    return disk.save(binding.workspaceId, { ...patch, expectedVersion: current.version }).snapshot;
  };
  const commit = (job, { extraReceiptFields, ...task } = {}) => {
    const { receipt, output } = submitExport(job, task);
    assert.equal(receipt.canvasCommitted, true);
    const graph = disk.get(binding.workspaceId);
    assert.equal(receipt.workspaceVersion, graph.version);
    if (!extraReceiptFields) return { graph, output };
    const nodes = graph.nodes.map(node => {
      if (node.id !== 'composition') return node;
      const receipts = node.data.clipExportReceipts;
      return { ...node, data: { ...node.data, clipExportReceipts: [
        ...receipts.slice(0, -1), { ...receipts.at(-1), ...extraReceiptFields },
      ] } };
    });
    return { graph: saveOnHost({ nodes }), output };
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
  const gets = [];
  let deferRead;
  let beforeWrite;
  let afterWrite;
  window.fetch = async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    const path = new URL(url, window.location.origin).pathname;
    const writing = options.method === 'PUT';
    if (writing) beforeWrite?.(body);
    let result;
    try {
      result = await tryHandle(options.method, path, { url, method: options.method, body });
      assert.ok(result, `Unexpected Workspace route ${options.method} ${path}`);
    } catch (error) {
      if (error.code !== 'version_conflict') throw error;
      result = { status: 409, body: { error: error.code, current: error.current } };
    }
    if (writing) {
      const put = { path, expectedVersion: body.expectedVersion, status: result.status, content: note(body) };
      puts.push(put);
      if (afterWrite) await afterWrite(put);
    }
    if (options.method === 'GET' && result.body.workspace) {
      gets.push(result.body.workspace.version);
      if (deferRead) result = await deferRead(result.body.workspace) ?? result;
    }
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
    state, commit, submitExport, saveOnHost, firstExport, puts, gets, seed, open, flush, autosave,
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
    beforeWrite: handler => { beforeWrite = handler; },
    afterWrite: handler => { afterWrite = handler; },
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

test('Undo to a still-dirty graph during 409 recovery writes that graph and preserves Redo', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('first edit'));
  f.tickHistory();
  await f.flush(() => f.edit('second edit'));
  assert.equal(f.state().past.length, 2);
  const latest = f.commit(1);
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  await f.autosave();
  assert.deepEqual(f.gets, [latest.graph.version]);
  assert.equal(f.puts.at(-1).status, 409);
  await f.flush(() => f.state().undo());
  assert.equal(note(f.state()), 'first edit');
  await f.flush(() => release.resolve());

  const saved = f.read();
  t.diagnostic(JSON.stringify({ puts: f.puts, disk: note(saved), visible: note(f.state()) }));
  assert.equal(note(saved), 'first edit');
  assert.deepEqual(f.puts.map(({ expectedVersion, status, content }) => [expectedVersion, status, content]), [
    [1, 409, 'second edit'], [2, 200, 'first edit'],
  ]);
  assertExport(saved, latest);
  assertExport(f.state(), latest);
  assert.equal(f.persistence.isDirty, false);
  assert.equal(f.state().future.length, 1);
  await f.flush(() => f.state().redo());
  await f.autosave();
  assert.equal(note(f.read()), 'second edit');
  assertExport(f.read(), latest);
});

async function checkRedoDuringRecovery(t, clipCommit) {
  const f = await fixture(t);
  await f.flush(() => f.edit('first edit'));
  f.tickHistory();
  await f.flush(() => f.edit('redone edit'));
  await f.flush(() => f.state().undo());
  const latest = clipCommit ? f.commit(1) : { graph: f.saveOnHost() };
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  await f.autosave();
  assert.deepEqual(f.gets, [latest.graph.version]);
  await f.flush(() => f.state().redo());
  assert.equal(note(f.state()), 'redone edit');
  await f.flush(() => release.resolve());
  assert.deepEqual(f.puts.map(({ status, content }) => [status, content]), [[409, 'first edit'], [200, 'redone edit']]);
  assert.equal(note(f.read()), 'redone edit');
  assert.equal(f.state().future.length, 0);
  assert.equal(f.persistence.isDirty, false);
  if (clipCommit) assertExport(f.read(), latest);
}

test('Redo during the 409 GET is included in the version-only retry', t => checkRedoDuringRecovery(t, false));
test('Redo during the 409 GET is included in the Clip rebase retry', t => checkRedoDuringRecovery(t, true));

test('A queued autosave cannot overwrite the newest edit used by the 409 retry', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('first edit'));
  const latest = f.commit(1);
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  await f.autosave();
  assert.deepEqual(f.gets, [latest.graph.version]);
  await f.flush(() => f.edit('queued edit'));
  await f.autosave();
  await f.flush(() => f.edit('newest edit'));
  await f.flush(() => release.resolve());
  assert.deepEqual(f.puts.map(({ status, content }) => [status, content]), [[409, 'first edit'], [200, 'newest edit']]);
  assert.equal(note(f.read()), 'newest edit');
  assertExport(f.read(), latest);
  await f.autosave();
  assert.equal(f.puts.length, 2);
});

test('Undo during the retry PUT is saved after the retry response even when it matched the old disk state', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('undo after retry starts'));
  const latest = f.commit(1);
  const release = Promise.withResolvers();
  f.afterWrite(put => put.status === 200 ? release.promise : undefined);
  await f.autosave();
  assert.deepEqual(f.puts.map(({ status }) => status), [409, 200]);
  await f.flush(() => f.state().undo());
  assert.equal(note(f.state()), 'initial');
  await f.flush(() => release.resolve());
  assert.equal(f.persistence.isDirty, true);
  await f.autosave();
  assert.deepEqual(f.puts.map(({ status, content }) => [status, content]), [
    [409, 'undo after retry starts'], [200, 'undo after retry starts'], [200, 'initial'],
  ]);
  assert.equal(note(f.read()), 'initial');
  assertExport(f.read(), latest);
  assert.equal(f.state().future.length, 1);
});

test('Keep local after deleting the old output preserves the newer Host pointer, receipt, material and original line', async t => {
  const f = await fixture(t, { priorExport: true });
  const [oldMaterial] = downstream(f.firstExport.graph);
  const [originalLine] = f.firstExport.graph.edges;
  await f.flush(() => {
    f.state().deleteElements([oldMaterial.id], []);
    f.edit('keep this local edit');
  });
  const newest = f.commit(3, {
    revisionEpoch: 1, exportGeneration: 1,
    extraReceiptFields: { producer: { kind: 'future', sequence: 4 } },
  });
  assert.deepEqual(newest.graph.edges, [originalLine]);
  assert.deepEqual(f.submitExport(2).receipt, { status: 'superseded', canvasCommitted: false });
  assert.equal(f.read().version, newest.graph.version);
  await f.autosave();
  assert.equal(f.puts.at(-1).status, 409);
  assert.equal(f.persistence.status, 'conflict');
  assertExport(f.read(), newest);

  await f.flush(() => f.persistence.resolveConflict());
  const saved = f.read();
  t.diagnostic(JSON.stringify({ puts: f.puts, pointer: source(saved).data.outputRevision,
    receipts: source(saved).data.clipExportReceipts.map(row => row.exportJobId), originalLine: saved.edges[0]?.id }));
  assert.equal(note(saved), 'keep this local edit');
  assertExport(saved, newest);
  const receipt = source(saved).data.clipExportReceipts.at(-1);
  assert.equal(receipt.revisionEpoch, 1);
  assert.equal(receipt.exportGeneration, 1);
  assert.deepEqual(receipt.producer, { kind: 'future', sequence: 4 });
  assertExport(f.state(), newest);
  assert.deepEqual(saved.edges, [originalLine]);
  assert.equal(f.persistence.isDirty, false);
  await f.flush(() => f.state().undo());
  await f.autosave();
  assert.equal(note(f.read()), 'initial');
  assertExport(f.read(), newest);
  await f.flush(() => f.state().redo());
  await f.autosave();
  assert.equal(note(f.read()), 'keep this local edit');
  assertExport(f.read(), newest);
  await f.open(f.read());
  assert.equal(note(f.state()), 'keep this local edit');
  assertExport(f.state(), newest);

  // A new explicit deletion, after seeing the new export, is still saved normally.
  await f.flush(() => f.state().removeEdge(originalLine.id));
  await f.autosave();
  assertExport(f.read(), newest, { linked: false });
  await f.flush(() => f.state().deleteElements([oldMaterial.id], []));
  await f.autosave();
  await f.open(f.read());
  assert.equal(downstream(f.state()).length, 0);
  assert.equal(f.state().edges.length, 0);
  assert.equal(source(f.state()).data.outputVideoUrl, source(newest.graph).data.outputVideoUrl);
  assert.deepEqual(json(source(f.state()).data.clipExportReceipts), source(newest.graph).data.clipExportReceipts);
});

test('Canvas rebase follows the Host export receipt when a new generation has a lower project revision', async t => {
  const f = await fixture(t);
  const previous = f.commit(1, { projectRevision: 5 });
  await f.poll();
  await f.flush(() => f.edit('keep through generation change'));
  const latest = f.commit(2, { projectRevision: 2, revisionEpoch: 1, exportGeneration: 1 });
  assert.deepEqual(f.submitExport(3, { projectRevision: 6 }).receipt, { status: 'superseded', canvasCommitted: false });
  assert.equal(f.read().version, latest.graph.version);
  await f.autosave();
  assert.deepEqual(f.puts.map(({ expectedVersion, status }) => [expectedVersion, status]), [
    [previous.graph.version, 409], [latest.graph.version, 200],
  ]);
  assert.equal(note(f.read()), 'keep through generation change');
  assertExport(f.read(), latest);
  await f.flush(() => f.state().undo());
  await f.autosave();
  await f.open(f.read());
  assertExport(f.state(), latest);
  assert.deepEqual(json(source(f.state()).data.clipExportReceipts.map(row => [row.exportJobId, row.projectRevision, row.exportGeneration ?? 0])),
    [[1, 5, 0], [2, 2, 1]]);
});

test('Keep local resolves a mixed edit and export while retaining an intentional unlink', async t => {
  const f = await fixture(t, { priorExport: true });
  const [line] = f.firstExport.graph.edges;
  await f.flush(() => {
    f.state().removeEdge(line.id);
    f.edit('local text');
  });
  const latest = f.commit(2);
  f.saveOnHost({ nodes: latest.graph.nodes.map(node => node.id === 'note'
    ? { ...node, data: { ...node.data, content: 'other window' } } : node) });
  await f.autosave();
  assert.equal(f.persistence.status, 'conflict');
  await f.flush(() => f.persistence.resolveConflict());
  const saved = f.read();
  assert.equal(note(saved), 'local text');
  assertExport(saved, latest, { linked: false });
  assert.equal(saved.edges.length, 0);
});

test('Repeated 409 and an unavailable recovery read require a fresh Keep local decision against the newest export', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('local before conflict'));
  const first = f.commit(1);
  let second;
  f.beforeWrite(({ expectedVersion }) => {
    if (expectedVersion === first.graph.version && !second) second = f.commit(2);
  });
  await f.autosave();
  assert.deepEqual(f.puts.map(({ expectedVersion, status }) => [expectedVersion, status]), [[1, 409], [2, 409]]);
  assert.equal(f.persistence.status, 'conflict');
  assertExport(f.read(), second);
  await f.flush(() => f.edit('local after both 409s'));
  await f.autosave();
  assert.equal(f.puts.length, 2);

  f.deferRead(() => ({ status: 409, body: { error: 'version_conflict' } }));
  await f.flush(() => f.persistence.resolveConflict());
  assert.equal(f.puts.length, 2, 'an unavailable GET must not authorize a PUT');
  assert.equal(f.persistence.status, 'conflict');
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  // Advance again after the selected recovery read has captured its response.
  await f.flush(() => { void f.persistence.resolveConflict(); });
  assert.equal(f.gets.at(-1), second.graph.version);
  const third = f.commit(3);
  await f.flush(() => f.edit('text during recovery GET'));
  await f.flush(() => release.resolve());
  assert.equal(f.puts.at(-1).status, 409);
  assert.equal(f.persistence.status, 'conflict');
  assertExport(f.read(), third);
  await f.flush(() => f.persistence.resolveConflict());
  assert.equal(f.puts.at(-1).expectedVersion, third.graph.version);
  assert.equal(note(f.read()), 'text during recovery GET');
  assertExport(f.read(), third);
  assertExport(f.state(), third);
  t.diagnostic(JSON.stringify({ gets: f.gets, puts: f.puts, finalVersion: f.read().version }));
});

test('Switch during 409 recovery saves only the last captured graph of the old workspace', async t => {
  const f = await fixture(t);
  await f.flush(() => f.edit('first workspace first edit'));
  f.tickHistory();
  await f.flush(() => f.edit('first workspace undone edit'));
  const latest = f.commit(1);
  const release = Promise.withResolvers();
  f.deferRead(() => release.promise);
  await f.autosave();
  assert.deepEqual(f.gets, [latest.graph.version]);
  await f.flush(() => f.state().undo());
  const other = f.seed('ws_second', 'second workspace initial');
  f.persistence.flushPendingSave();
  await f.open(f.read(other.workspaceId));
  await f.flush(() => f.edit('second workspace new edit'));
  await f.flush(() => release.resolve());
  await f.autosave();
  assert.deepEqual(f.puts.map(({ path, status, content }) => [path.split('/').at(-1), status, content]), [
    ['ws_first', 409, 'first workspace undone edit'],
    ['ws_first', 200, 'first workspace first edit'],
    ['ws_second', 200, 'second workspace new edit'],
  ]);
  assert.equal(note(f.read()), 'first workspace first edit');
  assertExport(f.read(), latest);
  assert.equal(note(f.read(other.workspaceId)), 'second workspace new edit');
  assert.equal(source(f.state()).data.projectId, other.projectId);
  assert.equal(source(f.state()).data.outputRevision, undefined);
  assert.equal(f.state().past.length, 1);
});

test('Undoing the first saved node of an empty workspace can explicitly save an empty graph', async t => {
  const f = await fixture(t);
  await f.open(f.saveOnHost({ nodes: [], edges: [] }));
  await f.flush(() => f.state().applyCanvasInputMutation({ addNodes: [{
    id: 'note', type: 'material', position: { x: 0, y: 0 },
    data: { materialType: 'text', nodeKind: 'import', content: 'first node' },
  }] }));
  await f.autosave();
  assert.equal(note(f.read()), 'first node');
  await f.flush(() => f.state().undo());
  await f.autosave();
  assert.deepEqual(f.read().nodes, []);
  assert.equal(f.state().future.length, 1);
  await f.flush(() => f.state().redo());
  await f.autosave();
  assert.equal(note(f.read()), 'first node');
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
