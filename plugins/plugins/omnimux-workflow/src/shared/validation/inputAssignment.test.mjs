import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelCatalog } from '../../../../omnimux/src/catalog/list.js';
import { projectCanvasCatalog } from '../generationPolicy.ts';
import { localFileMediaUrl } from '../localMedia.ts';
import { readNodeInputSource } from '../graph/nodeInputSource.ts';
import { sanitizeNodes } from '../../canvas/bridge/persistSanitize.ts';
import { buildUpstreamFingerprint } from './compatKernel.ts';
import { resolveInputAssignment } from './inputAssignment.ts';

const snapshot = JSON.parse(readFileSync(new URL('../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url)));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot }));
const supply = (id, type = 'image', metadata = {}) => ({
  edgeId: `edge-${id}`, sourceNodeId: id, outputId: `${id}:current`, type, availability: 'ready', ...metadata,
});
const fingerprint = (assets, localText = 'Make a clip.') => buildUpstreamFingerprint({ assets, localText, prompt: localText });
const assigned = (result) => result.assigned.map(asset => [asset.sourceNodeId, asset.targetSlot]);
const unused = (result) => result.unused.map(asset => [asset.sourceNodeId, asset.unusedReason]);
const muse = { catalog, modelId: 'muse-video', outputType: 'video', preferredOperationId: 'first_frame', autoOperationId: null };
const seedance = { catalog, modelId: 'seedance-2-5', outputType: 'video' };

function bind(asset, role, ordinal = 0) {
  return { edgeId: asset.edgeId, sourceNodeId: asset.sourceNodeId, pinned: true, role, ordinal };
}

test('A1/A4/A33/A41/A54: Muse classifies supply and promotes the next connected image', () => {
  const a = supply('a', 'image', { ordinal: 0 });
  const b = supply('b', 'image', { ordinal: 1 });
  const c = supply('c', 'image', { ordinal: 2 });
  const audio = supply('wav', 'audio', { mimeType: 'audio/wav' });
  const unsupported = supply('other', 'image', { mimeType: 'image/gif' });
  const resolved = resolveInputAssignment({ ...muse, fingerprint: fingerprint([b, unsupported, audio, a, c], 'Keep @ref[a:0:A] and @ref[b:1:B].') });
  assert.equal(resolved.ready, true);
  assert.equal(resolved.operationId, 'first_frame');
  assert.deepEqual(assigned(resolved), [['a', 'first_frame']]);
  assert.deepEqual(unused(resolved).sort(), [['b', 'capacity'], ['c', 'capacity'], ['other', 'format'], ['wav', 'type']]);
  assert.deepEqual(resolved.effectiveFingerprint.assets.map(asset => asset.edgeId), [a.edgeId]);
  assert.match(resolved.effectiveFingerprint.prompt, /@ref\[a:0:A\]/);
  assert.doesNotMatch(resolved.effectiveFingerprint.prompt, /@ref\[b:/);
  assert.deepEqual(assigned(resolveInputAssignment({ ...muse, fingerprint: fingerprint([c, b, audio]), slotBindings: resolved.bindings })), [['b', 'first_frame']]);
  assert.deepEqual(assigned(resolveInputAssignment({ ...muse, fingerprint: fingerprint([c, audio]), slotBindings: resolved.bindings })), [['c', 'first_frame']]);
});

test('A5/A6/A17/A19/A20: each operation scores distinct consumed outputs from the full supply', () => {
  const a = supply('a');
  const b = supply('b');
  const video = supply('video', 'video', { mimeType: 'video/mp4' });
  const plan = (assets, options = {}) => resolveInputAssignment({ ...seedance, fingerprint: fingerprint(assets), ...options });
  assert.deepEqual(assigned(plan([a, b])), [['a', 'first_frame'], ['b', 'last_frame']]);
  assert.equal(plan([a, b]).operationId, 'first_last_frame');
  assert.equal(plan([a, b, video]).operationId, 'video_multi_ref');
  assert.deepEqual(assigned(plan([a, b], { preferredOperationId: 'first_frame', autoOperationId: null })), [['a', 'first_frame']]);

  const duplicate = { ...a, edgeId: 'a-another-edge' };
  assert.equal(plan([a, duplicate]).operationId, 'first_frame');
  const fixed = plan([a, duplicate], { preferredOperationId: 'first_last_frame', autoOperationId: null });
  assert.equal(fixed.ready, false);
  assert.deepEqual(assigned(fixed), [['a', 'first_frame']]);
  assert.ok(fixed.blocked.some(reason => reason.code === 'min_unsatisfied' && reason.slot === 'last_frame'));
});

test('A7/A10/A11/A43/A53: multimodal capacity and format are local to each slot', () => {
  const plan = (assets) => resolveInputAssignment({ ...seedance, forceOperationId: 'video_multi_ref', fingerprint: fingerprint(assets) });
  const audio = supply('wav', 'audio', { declaredExtension: '.WAV', durationSec: 2 });
  const invalid = supply('flac', 'audio', { mimeType: 'audio/flac', declaredExtension: 'wav' });
  const withAudio = plan([audio, invalid]);
  assert.equal(withAudio.ready, false);
  assert.deepEqual(assigned(withAudio), [['wav', 'reference_audios']]);
  assert.equal(withAudio.assigned[0].mimeType, 'audio/wav');
  assert.deepEqual(unused(withAudio), [['flac', 'format']]);
  assert.deepEqual(withAudio.blocked.map(reason => [reason.code, reason.slot]), [['min_unsatisfied', 'reference_images']]);

  const batches = [['image', 31, 'image/png'], ['video', 11, 'video/mp4'], ['audio', 11, 'audio/mpeg']];
  const batch = plan(batches.flatMap(([type, count, mimeType]) => Array.from({ length: count }, (_, index) => supply(`${type}-${index}`, type, { mimeType }))));
  assert.deepEqual(batch.slots.filter(({ slot }) => slot.type !== 'text').map(item => item.assigned.length), [30, 10, 10]);
  assert.deepEqual(unused(batch), [['image-30', 'capacity'], ['video-10', 'capacity'], ['audio-10', 'capacity']]);
  assert.equal(batch.ready, true);
});

test('A15/A26–A32: legacy role hints, explicit clearing, and pending pins keep their intent', () => {
  const last = supply('last', 'image', { targetSlot: 'last_frame', role: 'last_frame', ordinal: 1 });
  const first = supply('first', 'image', { targetSlot: 'first_frame', role: 'first_frame', ordinal: 0 });
  const frames = { ...seedance, preferredOperationId: 'first_last_frame', autoOperationId: null };
  assert.deepEqual(assigned(resolveInputAssignment({ ...frames, fingerprint: fingerprint([last, first]) })), [['first', 'first_frame'], ['last', 'last_frame']]);
  const purged = resolveInputAssignment({ ...frames, fingerprint: fingerprint([last, first]), inputBindingVersion: 1, slotBindings: {} });
  assert.equal(purged.ready, false);
  assert.deepEqual(assigned(purged), []);
  const afterDisconnect = resolveInputAssignment({ ...frames, fingerprint: fingerprint([last]) });
  assert.deepEqual(assigned(afterDisconnect), [['last', 'last_frame']]);
  assert.equal(afterDisconnect.ready, false);
  assert.deepEqual(unused(resolveInputAssignment({ ...muse, fingerprint: fingerprint([last, first]) })), [['last', 'role']]);

  for (const [availability, state] of [['waiting', 'pending'], ['unavailable', 'invalid']]) {
    const asset = supply('not-ready', 'image', { availability });
    const raw = { ...muse, fingerprint: fingerprint([asset, supply('other')]) };
    assert.deepEqual(assigned(resolveInputAssignment(raw)), [['other', 'first_frame']]);
    const pinned = resolveInputAssignment({ ...raw, slotBindings: { first_frame: [bind(asset, 'first_frame')] } });
    assert.equal(pinned.ready, false);
    assert.deepEqual(assigned(pinned), []);
    assert.deepEqual(pinned.records.map(record => [record.state, record.occupant.edgeId]), [[state, asset.edgeId]]);
  }
  const mismatched = resolveInputAssignment({ ...muse, fingerprint: fingerprint([{ ...last, edgeId: first.edgeId }]),
    slotBindings: { first_frame: [bind(first, 'first_frame')] } });
  assert.equal(mismatched.ready, false);
  assert.deepEqual(mismatched.records.map(record => [record.state, record.occupant.sourceNodeId]), [['invalid', 'first']]);
});

test('A12/A37/A40: text composition keeps graph order and honours explicit choices', () => {
  const a = supply('a', 'text', { textContent: 'Alpha', ordinal: 0 });
  const b = supply('b', 'text', { textContent: 'Beta', ordinal: 1 });
  const table = supply('rows', 'table', { textContent: 'Rows', ordinal: 2 });
  const args = { catalog, modelId: 'gemini-3.8-flash', outputType: 'text', inputBindingVersion: 1,
    fingerprint: fingerprint([table, b, a], 'Local.') };
  const result = resolveInputAssignment(args);
  assert.deepEqual(result.assigned.map(asset => asset.sourceNodeId), ['a', 'b', 'rows']);
  assert.match(result.effectiveFingerprint.prompt, /Alpha[\s\S]+Beta[\s\S]+Rows[\s\S]+Local\./);
  const explicit = resolveInputAssignment({ ...args, slotBindings: { prompt: [bind(b, 'prompt', 1)] } });
  assert.deepEqual(assigned(explicit), [['b', 'prompt']]);
  assert.doesNotMatch(explicit.effectiveFingerprint.prompt, /Alpha|Rows/);
});

test('A35/A36: input and contract fingerprints ignore unused supply and change with a consumed output', () => {
  const img = supply('a', 'image');
  const make = (assets, params = {}) => resolveInputAssignment({ ...muse, params: { model: 'muse-video', ...params }, fingerprint: fingerprint(assets) });
  const active = make([img]);
  const offered = make([img, supply('b'), supply('wav', 'audio')]);
  assert.equal(active.fingerprint, offered.fingerprint);
  assert.equal(active.contractFingerprint, offered.contractFingerprint);
  assert.notEqual(active.fingerprint, make([{ ...img, outputId: 'new-output' }]).fingerprint);
  assert.notEqual(active.contractFingerprint, make([img], { routing: { allowedGroups: ['route'] } }).contractFingerprint);
});

test('A36: graph sanitization preserves the current local output identity', () => {
  const path = '/fixture/voice.wav';
  const node = { id: 'voice', type: 'material', position: { x: 0, y: 0 }, data: {
    materialType: 'audio', nodeKind: 'import', realPath: path, mediaUrl: localFileMediaUrl(path),
  } };
  const [saved] = sanitizeNodes([structuredClone(node)]);
  assert.equal(saved.data.realPath, undefined);
  const before = readNodeInputSource(node);
  const after = readNodeInputSource(saved);
  assert.equal(before.outputId, path);
  assert.equal(after.outputId, path);
  assert.deepEqual(after, before);
});
