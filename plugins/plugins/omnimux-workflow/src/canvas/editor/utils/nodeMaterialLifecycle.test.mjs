import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNodeLifecycle,
  isNodeReady,
  isNodeEmpty,
} from './nodeMaterialLifecycle.ts';
import { hasNodeMaterial } from './nodeToolbarLogic.ts';

test('nodeMaterialLifecycle: text node states', () => {
  assert.equal(resolveNodeLifecycle({ type: 'text', data: {} }), 'empty');
  assert.equal(resolveNodeLifecycle({ type: 'text', data: { content: 'hello world' } }), 'ready');
  assert.equal(resolveNodeLifecycle({ type: 'text', data: { status: 'running' } }), 'loading');
  assert.equal(resolveNodeLifecycle({ type: 'text', data: { status: 'failed' } }), 'error');
  assert.equal(isNodeReady({ type: 'text', data: { content: 'hello' } }), true);
  assert.equal(isNodeEmpty({ type: 'text', data: {} }), true);
});

test('nodeMaterialLifecycle: media node states (probe missing/corrupted)', () => {
  assert.equal(resolveNodeLifecycle({ type: 'image', data: {} }), 'empty');
  assert.equal(resolveNodeLifecycle({ type: 'image', data: { previewUrl: 'http://foo/bar.png' } }), 'ready');
  assert.equal(resolveNodeLifecycle({ type: 'image', data: { probeStatus: 'missing', relativePath: 'img.png' } }), 'missing');
  assert.equal(resolveNodeLifecycle({ type: 'video', data: { probeStatus: 'corrupted', relativePath: 'vid.mp4' } }), 'corrupted');
});

test('nodeMaterialLifecycle: table node states', () => {
  assert.equal(resolveNodeLifecycle({ type: 'table', data: {} }), 'empty');
  assert.equal(resolveNodeLifecycle({ type: 'table', data: { rowCount: 0 } }), 'empty');
  assert.equal(resolveNodeLifecycle({ type: 'table', data: { rowCount: 5 } }), 'ready');
  assert.equal(resolveNodeLifecycle({ type: 'table', data: { previewRows: ['rec1'] } }), 'ready');
  assert.equal(resolveNodeLifecycle({ type: 'table', data: { status: 'loading' } }), 'loading');
  assert.equal(resolveNodeLifecycle({ type: 'table', data: { status: 'missing' } }), 'missing');

  assert.equal(hasNodeMaterial({ nodeType: 'table', tableRowCount: 0 }), false);
  assert.equal(hasNodeMaterial({ nodeType: 'table', tableRowCount: 3 }), true);
});
