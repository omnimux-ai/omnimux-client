import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimCanvasClipNavigation, readCanvasClipNavigation } from './canvasClipNavigation.js';

const binding = { workspaceId: 'ws_target', nodeId: 'node_a', projectId: 'clip_node_a' };
const clip = { mode: 'canvas', ...binding };
const tabId = 'omnimux-workflow:canvas';

function sidebarWith(meta) {
  const tab = { type: tabId, id: tabId, meta, title: 'Canvas' };
  const snapshot = { sessionId: 'session_a', state: { splits: { kind: 'leaf', tabs: [tab] } } };
  return { tab, getSnapshot: () => snapshot, updateTab(id, props) { assert.equal(id, tabId); Object.assign(tab, props); } };
}

for (const meta of [{ workspaceId: binding.workspaceId, clip }, { extra: { workspaceId: binding.workspaceId, clip } }]) {
  test(`workbench ${meta.extra ? 'nested' : 'direct'} Clip intent is consumed once and retains the correct page`, () => {
    const sidebar = sidebarWith({ ...meta, focusGroupId: 'group_a' });
    assert.deepEqual(readCanvasClipNavigation(sidebar.tab.meta), binding);
    const options = { sidebar, sessionId: 'session_a', tabId, binding, pageId: 'page_target' };
    assert.equal(claimCanvasClipNavigation(options), true);
    assert.equal(sidebar.tab.meta.pageId, 'page_target');
    assert.equal(sidebar.tab.meta.focusGroupId, 'group_a');
    assert.equal(readCanvasClipNavigation(sidebar.tab.meta), undefined);
    assert.equal(claimCanvasClipNavigation(options), false);
  });
}

test('stale session, invalid scope and mismatched request cannot claim the active canvas', () => {
  assert.equal(readCanvasClipNavigation({ workspaceId: 'ws_other', clip }), undefined);
  assert.equal(readCanvasClipNavigation({ clip, extra: { clip: { ...clip, nodeId: 'other' } } }), undefined);
  assert.equal(readCanvasClipNavigation({ clip: { ...clip, mode: 'standalone' } }), undefined);
  const sidebar = sidebarWith({ clip });
  assert.equal(claimCanvasClipNavigation({ sidebar, sessionId: 'session_stale', tabId, binding }), false);
  assert.equal(claimCanvasClipNavigation({ sidebar, sessionId: 'session_a', tabId, binding: { ...binding, projectId: 'other' } }), false);
  assert.deepEqual(readCanvasClipNavigation(sidebar.tab.meta), binding);
});
