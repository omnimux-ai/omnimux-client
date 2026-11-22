import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureSlotIntent, readSlotIntent, validateSlotIntent } from './slotIntent.ts';

const audioSlot = { slot: 'reference_audios', role: 'reference', type: 'audio', min: 0, max: 2,
  allowedMimes: ['audio/wav', 'audio/mpeg'], maxSizeMb: 1, maxSizeExclusive: true, minDurationSec: 1,
  maxDurationSec: 4, totalMinDurationSec: 3, totalMinExclusive: true, totalMaxDurationSec: 6, totalMaxExclusive: true };
const imageSlot = { slot: 'reference_images', role: 'reference', type: 'image', min: 1, max: 2 };
const context = { targetNodeId: 'video', modelId: 'fixture', operationId: 'video_multi_ref', routing: 'group-a',
  mode: 'multi-reference', contractFingerprint: 'version-one' };
const audio = (id, extra = {}) => ({ sourceNodeId: id, outputId: `${id}:current`, type: 'audio', availability: 'ready',
  declaredExtension: 'wav', sizeBytes: 128, durationSec: 2, ...extra });
const occupied = (candidate, edgeId, slot = audioSlot) => ({ slot, state: 'ready', asset: candidate,
  occupant: { sourceNodeId: candidate.sourceNodeId, outputId: candidate.outputId, edgeId, pinned: true } });
const pickerState = (records = []) => ({ context, layout: { outputType: 'video', slots: [imageSlot, audioSlot] }, records });

function assertRejected(state, intent, candidates, reasonCode, options) {
  assert.deepEqual(validateSlotIntent(state, intent, candidates, options), { accepted: false, reasonCode });
}

test('accepts the declared extension only as a fallback and uses finite slot limits', () => {
  const state = pickerState([occupied(audio('already'), 'e-already')]);
  const intent = captureSlotIntent(state, { slot: audioSlot.slot });
  assert.equal(readSlotIntent(state, intent).remaining, 1);
  assert.deepEqual(validateSlotIntent(state, intent, [audio('new')]), { accepted: true });
  assertRejected(state, intent, [audio('flac', { mimeType: 'audio/flac' })], 'mime_unsupported');
  assertRejected(state, intent, [audio('unknown', { declaredExtension: undefined })], 'mime_unknown');
  assertRejected(state, intent, [audio('big', { sizeBytes: 2 ** 20 })], 'size_exceeded');
  assertRejected(state, intent, [audio('unknown', { sizeBytes: undefined })], 'size_exceeded');
  assertRejected(state, intent, [audio('short', { durationSec: 0.5 })], 'duration_exceeded');
  assertRejected(state, intent, [audio('unknown', { durationSec: undefined })], 'duration_exceeded');
  assertRejected(state, intent, [audio('long', { durationSec: 4 })], 'duration_exceeded');
  assertRejected(state, intent, [audio('old', { availability: 'waiting' })], 'input_waiting');
  assertRejected(state, intent, [audio('old', { availability: 'unavailable' })], 'input_unavailable');
  assertRejected(state, intent, [audio('other', { targetSlot: imageSlot.slot })], 'role_conflict');
  assertRejected(state, intent, [audio('already')], 'input_already_bound');
  assertRejected(state, intent, [audio('x'), audio('y')], 'slot_capacity');
});

test('partial selection can accumulate time and confirmation enforces total limits', () => {
  const state = pickerState();
  const intent = captureSlotIntent(state, { slot: audioSlot.slot });
  assert.deepEqual(validateSlotIntent(state, intent, [audio('a')], { partial: true }), { accepted: true });
  assertRejected(state, intent, [audio('a', { durationSec: 3 })], 'duration_exceeded');
  assert.deepEqual(validateSlotIntent(state, intent, [audio('a'), audio('b')]), { accepted: true });
  assertRejected(state, intent, [audio('a'), audio('a')], 'input_already_bound');
  assertRejected(state, intent, [audio('a', { durationSec: 3 }), audio('b', { durationSec: 3 })], 'duration_exceeded', { partial: true });
});

test('replacement requires the original one occupant, exact scope and a current well', () => {
  const before = occupied(audio('a', { durationSec: 3.5 }), 'e-a');
  const other = occupied(audio('b'), 'e-b');
  const state = pickerState([before, other]);
  const request = { slot: audioSlot.slot, replaceEdgeId: 'e-a', role: 'reference' };
  const intent = captureSlotIntent(state, request);
  assert.equal(captureSlotIntent(state, { slot: audioSlot.slot }), undefined);
  assert.equal(captureSlotIntent(pickerState([before, before]), request), undefined);
  assert.equal(captureSlotIntent(state, { ...request, role: 'audio_track' }), undefined);
  assert.equal(readSlotIntent(state, intent).replacement, before);
  assert.deepEqual(validateSlotIntent(state, intent, [audio('c')]), { accepted: true });
  assertRejected(state, intent, [audio('b')], 'input_already_bound');
  assertRejected(pickerState([other]), intent, [audio('c')], 'input_changed');
  assertRejected(pickerState([occupied(audio('a', { outputId: 'fresh' }), 'e-a'), other]), intent, [audio('c')], 'input_changed');
  const changedScopes = [{ targetNodeId: 'other-node' }, { modelId: 'other-model' }, { operationId: 'text_to_video' },
    { routing: 'group-b' }, { mode: 'first-frame' }, { contractFingerprint: 'version-two' }];
  for (const patch of changedScopes) {
    assertRejected({ ...state, context: { ...context, ...patch } }, intent, [audio('c')], 'input_changed');
  }
  const removed = { ...state, layout: { ...state.layout, slots: [imageSlot] } };
  assertRejected(removed, intent, [audio('c')], 'input_changed');
  const borrowed = { ...state, layout: { ...state.layout, displayOnlyFromOperation: context.operationId } };
  assert.equal(captureSlotIntent(borrowed, request), undefined);
});

test('the routed input cap applies across wells and still permits replacing one occupant', () => {
  const extra = { ...audioSlot, slot: 'extra_audios' };
  const fixture = pickerState([occupied(audio('assigned'), 'e-assigned')]);
  const state = { ...fixture, layout: { ...fixture.layout, slots: [audioSlot, extra], inputMaxByType: { audio: 1 } } };
  assert.equal(captureSlotIntent(state, { slot: extra.slot }), undefined);
  const replacement = captureSlotIntent(state, { slot: audioSlot.slot, replaceEdgeId: 'e-assigned' });
  assert.equal(readSlotIntent(state, replacement).remaining, 1);
  assert.deepEqual(validateSlotIntent(state, replacement, [audio('different', { durationSec: 3.5 })]), { accepted: true });
});
