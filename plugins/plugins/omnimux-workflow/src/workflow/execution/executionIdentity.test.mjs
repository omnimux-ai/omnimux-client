import assert from 'node:assert/strict';
import { createHash, Hash } from 'node:crypto';
import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { executionSourceIdentities, readExecutionSourceIdentities } from './executionIdentity.ts';
import { prepareExecutionAdmission } from './prepareExecutionAdmission.ts';

function localSources(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-input-digest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'voice.wav');
  const alias = join(dir, 'original.wav');
  const bytes = Buffer.alloc(4 * 1024 * 1024, 17);
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path, bytes);
  linkSync(path, alias);
  const source = { id: 'voice', type: 'material', data: { nodeKind: 'import', materialType: 'audio',
    relativePath: 'voice.wav', mediaUrl: '/omnimux-workflow/api/workspaces/ws/file?rel=voice.wav',
    outputs: [{ path }, { path: alias }] } };
  const first = { id: 'first', type: 'material', data: { nodeKind: 'generate', materialType: 'video' } };
  const second = { ...first, id: 'second' };
  const edges = [{ source: 'voice', target: 'first' }, { source: 'voice', target: 'second' }];
  const graph = { nodes: [source, first, second], edges };
  const selected = { nodes: [first, second], edges, nodeIdSet: new Set(['first', 'second']) };
  const project = { workspaceId: 'ws', resolveProjectFile: () => path };
  return { project, graph, selected, path, alias, digest, size: bytes.length };
}

async function admit(fixture, onLookup) {
  const manager = { findRecoverableTasks(options) {
    onLookup(options);
    return { first: { taskId: 'accepted-first' }, second: { taskId: 'accepted-second' } };
  } };
  return prepareExecutionAdmission('ws', fixture.graph, fixture.selected, 'single',
    manager, undefined, fixture.project.resolveProjectFile);
}

test('file-backed admission yields to pending events before it looks up accepted tasks', async t => {
  const fixture = localSources(t);
  let yielded = false;
  const pending = setImmediate(() => { yielded = true; });
  t.after(() => clearImmediate(pending));
  await admit(fixture, () => assert.equal(yielded, true));
});

test('a file referenced by two targets and multiple paths is digested once for the request', async t => {
  const fixture = localSources(t);
  const direct = executionSourceIdentities(fixture.graph, fixture.selected.nodeIdSet, fixture.project);
  const updates = t.mock.method(Hash.prototype, 'update');
  await admit(fixture, options => {
    const expected = Object.fromEntries(['project-file:voice.wav', fixture.path, fixture.alias].map(key => [key, fixture.digest]));
    assert.deepEqual(options.sourceIdentities.first, expected);
    assert.deepEqual(options.sourceIdentities.second, expected);
    assert.deepEqual(options.sourceIdentities, direct);
  });
  const bytes = updates.mock.calls.reduce((sum, record) => {
    const [chunk] = record.arguments;
    return sum + (Buffer.isBuffer(chunk) ? chunk.length : 0);
  }, 0);
  assert.equal(bytes, fixture.size);
});

test('project URLs from another workspace and denied relative paths cannot fallback to local reads', async t => {
  const fixture = localSources(t);
  const foreign = '/omnimux-workflow/api/workspaces/other/file?rel=' + encodeURIComponent(fixture.path);
  const local = '/omnimux-workflow/api/workspaces/ws/file?rel=' + encodeURIComponent(fixture.path);
  const graph = { nodes: [
    { id: 'foreign', data: { mediaUrl: foreign, path: fixture.path } },
    { id: 'denied', data: { mediaUrl: local, relativePath: fixture.path, path: fixture.path } },
  ], edges: [] };
  const resolutions = [];
  const project = { workspaceId: 'ws', resolveProjectFile(workspace, rel) {
    resolutions.push([workspace, rel]);
    throw new Error('Outside this workspace');
  } };
  const identities = await readExecutionSourceIdentities(graph, undefined, project);
  assert.deepEqual(resolutions, [['ws', fixture.path]]);
  assert.deepEqual(identities.foreign, {});
  assert.deepEqual(identities.denied, Object.fromEntries([['project-file:' + fixture.path, '']]));
});
