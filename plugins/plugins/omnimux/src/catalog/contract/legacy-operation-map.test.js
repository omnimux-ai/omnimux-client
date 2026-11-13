import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLegacyOperation, LEGACY_OPERATION_MAP } from './legacy-operation-map.js';

test('legacy map translates historical aliases', () => {
  assert.equal(mapLegacyOperation('reference'), 'video_multi_ref');
  assert.equal(mapLegacyOperation('i2v'), 'first_frame');
  assert.equal(mapLegacyOperation('asr'), 'speech_to_text');
  assert.equal(mapLegacyOperation('first_last_frame'), 'first_last_frame');
  assert.equal(mapLegacyOperation('end_frame'), 'end_frame');
  assert.equal(mapLegacyOperation('endframe'), 'end_frame');
  assert.equal(mapLegacyOperation('end-frame'), 'end_frame');
  assert.equal(mapLegacyOperation('unknown_keep'), 'unknown_keep');
  assert.ok(Object.keys(LEGACY_OPERATION_MAP).length >= 8);
});

test('legacy map never routes end-frame aliases to first_frame or first_last_frame (#567)', () => {
  for (const raw of ['end_frame', 'endframe', 'end-frame']) {
    const mapped = mapLegacyOperation(raw);
    assert.equal(mapped, 'end_frame', raw);
    assert.notEqual(mapped, 'first_frame');
    assert.notEqual(mapped, 'first_last_frame');
  }
  assert.equal(mapLegacyOperation('i2v'), 'first_frame');
  assert.notEqual(mapLegacyOperation('i2v'), 'end_frame');
  assert.equal(mapLegacyOperation('first_frame'), 'first_frame');
});
