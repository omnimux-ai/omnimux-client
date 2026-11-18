/**
 * Epic #63 / Issue #62 — inputCapability pure-function matrix.
 *
 * The catalog is the real shipped 16-model snapshot projected through the same
 * hub seam the canvas consumes; no fixture model ids are invented here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildModelCatalog } from '../../../../omnimux/src/catalog/list.js';
import { projectCanvasCatalog } from '../generationPolicy.ts';
import { buildFilteredModelOptions, buildUiUpstreamFingerprint } from './operationUi.ts';
import {
  buildInputCapability,
  modelCanConsumeMediaType,
  projectParamsForOperation,
} from './inputCapability.ts';
import { buildContractView, resolveModelView } from './compatKernel.ts';

const bundled = JSON.parse(readFileSync(new URL('../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }));

function fingerprint(types, prompt = 'make a clip') {
  return buildUiUpstreamFingerprint({
    prompt,
    upstreams: types.map((materialType, index) => ({
      nodeId: `up-${index}`,
      materialType,
      hasMedia: true,
      availability: 'ready',
    })),
  });
}

function stateOf(result, id) {
  return result.operationStates.find((state) => state.id === id);
}

function selected(modelId, types, outputType = 'video', preferredOperationId) {
  return buildInputCapability({
    catalog,
    modelId,
    outputType,
    fingerprint: fingerprint(types),
    ...(preferredOperationId ? { preferredOperationId } : {}),
  });
}

describe('R1/R2/R2b/R3 video matrix (real catalog)', () => {
  it('muse-video: no media → text_to_video; 1 image → first_frame', () => {
    const none = selected('muse-video', []);
    assert.equal(none.selectedOperationId, 'text_to_video');
    assert.equal(stateOf(none, 'text_to_video')?.usable, true);
    assert.equal(stateOf(none, 'first_frame')?.usable, false);

    const one = selected('muse-video', ['image']);
    assert.equal(one.selectedOperationId, 'first_frame');
    assert.equal(stateOf(one, 'text_to_video')?.usable, false);
    assert.equal(stateOf(one, 'first_frame')?.usable, true);
  });

  it('seedance-2-5: 2 images → first_last_frame, video_multi_ref stays usable (not grey)', () => {
    const result = selected('seedance-2-5', ['image', 'image']);
    assert.equal(result.selectedOperationId, 'first_last_frame');
    assert.equal(stateOf(result, 'first_last_frame')?.usable, true);
    assert.equal(stateOf(result, 'video_multi_ref')?.usable, true);
    // #88 A17: explicit first_frame with two images is a valid choice; the
    // second image is unused:capacity, not an operation-level failure.
    assert.equal(stateOf(result, 'first_frame')?.usable, true);
    assert.equal(stateOf(result, 'text_to_video')?.usable, false);
  });

  it('seedance-2-5: 1 image → first_frame; 1 video → video_edit; media mix → video_multi_ref', () => {
    assert.equal(selected('seedance-2-5', ['image']).selectedOperationId, 'first_frame');
    const video = selected('seedance-2-5', ['video']);
    assert.equal(video.selectedOperationId, 'video_edit');
    assert.equal(stateOf(video, 'video_extend')?.usable, true);
    assert.equal(selected('seedance-2-5', ['image', 'video', 'audio']).selectedOperationId, 'video_multi_ref');
  });

  it('minimax-h3-video: 1 image → video_multi_ref; image+audio → digital_human', () => {
    const image = selected('minimax-h3-video', ['image']);
    assert.equal(image.selectedOperationId, 'video_multi_ref');
    assert.equal(stateOf(image, 'digital_human')?.usable, false);
    assert.equal(stateOf(image, 'text_to_video')?.usable, false);

    const both = selected('minimax-h3-video', ['image', 'audio']);
    assert.equal(both.selectedOperationId, 'digital_human');
    assert.equal(stateOf(both, 'digital_human')?.usable, true);
  });

  it('wan-3.0: no media → text_to_video; image-only modes stay unavailable', () => {
    const result = selected('wan-3.0', []);
    assert.equal(result.selectedOperationId, 'text_to_video');
    assert.equal(stateOf(result, 'text_to_video')?.usable, true);
    assert.equal(stateOf(result, 'first_frame')?.usable, false);
    assert.equal(stateOf(result, 'first_last_frame')?.usable, false);
    assert.equal(stateOf(result, 'video_multi_ref')?.usable, false);
  });

  it('R3 keeps an explicitly chosen usable operation instead of the sorting winner', () => {
    const result = selected('seedance-2-5', ['image', 'image'], 'video', 'video_multi_ref');
    assert.equal(result.selectedOperationId, 'video_multi_ref');
  });

  it('R3 ignores a system-derived operation but keeps an explicit user choice', () => {
    const auto = buildInputCapability({
      catalog, modelId: 'seedance-2-5', outputType: 'video',
      fingerprint: fingerprint(['image', 'image']),
      preferredOperationId: 'video_multi_ref', autoOperationId: 'video_multi_ref',
    });
    assert.equal(auto.selectedOperationId, 'first_last_frame');
    const explicit = buildInputCapability({
      catalog, modelId: 'seedance-2-5', outputType: 'video',
      fingerprint: fingerprint(['image', 'image']),
      preferredOperationId: 'video_multi_ref', autoOperationId: null,
    });
    assert.equal(explicit.selectedOperationId, 'video_multi_ref');
  });

  it('R6 no media falls back to the family default operation', () => {
    const result = selected('seedance-2-5', [], 'video', 'first_frame');
    assert.equal(result.selectedOperationId, 'text_to_video');
    assert.equal(stateOf(result, 'first_frame')?.usable, false);
  });
});

describe('image / audio / text matrices (real catalog)', () => {
  it('gpt-image-2.5: no media → text_to_image; 1 image → the image-consuming reference op', () => {
    const none = selected('gpt-image-2.5', [], 'image');
    assert.equal(none.selectedOperationId, 'text_to_image');
    const one = selected('gpt-image-2.5', ['image'], 'image');
    assert.equal(one.selectedOperationId, 'multi_reference');
    assert.equal(stateOf(one, 'text_to_image')?.usable, false);
  });

  it('nano-banana-2-lite: no media → text_to_image; 1 image → image_to_image', () => {
    assert.equal(selected('nano-banana-2-lite', [], 'image').selectedOperationId, 'text_to_image');
    const one = selected('nano-banana-2-lite', ['image'], 'image');
    assert.equal(one.selectedOperationId, 'image_to_image');
    assert.equal(stateOf(one, 'text_to_image')?.usable, false);
  });

  it('image models without any image-consuming operation cannot consume an image (R5/R10)', () => {
    for (const modelId of ['muse-image', 'nano-banana-2-1', 'seedream-5-5']) {
      assert.equal(modelCanConsumeMediaType({ catalog, modelId, outputType: 'image', mediaType: 'image' }), false);
      const result = selected(modelId, ['image'], 'image');
      assert.equal(result.blocked, true);
      assert.equal(result.selectedOperationId, undefined);
    }
  });

  it('indextts-2: no media → text_to_speech with voice_clone unavailable (R2b); 1 audio keeps current and enables voice_clone', () => {
    const none = selected('indextts-2', [], 'audio', 'text_to_speech');
    assert.equal(none.selectedOperationId, 'text_to_speech');
    assert.equal(stateOf(none, 'voice_clone')?.usable, false);

    const audio = selected('indextts-2', ['audio'], 'audio', 'text_to_speech');
    assert.equal(audio.selectedOperationId, 'text_to_speech');
    assert.equal(stateOf(audio, 'voice_clone')?.usable, true);
  });

  it('suno / suno-sounds reject audio input (no media slot)', () => {
    for (const modelId of ['suno', 'suno-sounds']) {
      assert.equal(modelCanConsumeMediaType({ catalog, modelId, outputType: 'audio', mediaType: 'audio' }), false);
      assert.equal(selected(modelId, ['audio'], 'audio').blocked, true);
    }
  });

  it('gemini-3.8-flash absorbs text/image/video/audio/pdf; gemini-4-argon rejects audio', () => {
    const gemini = selected('gemini-3.8-flash', ['image', 'video', 'audio', 'document'], 'text');
    assert.equal(gemini.selectedOperationId, 'chat');
    assert.equal(stateOf(gemini, 'chat')?.usable, true);
    assert.equal(modelCanConsumeMediaType({ catalog, modelId: 'gemini-4-argon', outputType: 'text', mediaType: 'audio' }), false);
    assert.equal(selected('gemini-4-argon', ['audio'], 'text').blocked, true);
  });

  it('R10 keeps media-incompatible models in the picker as grey options', () => {
    const imageModels = buildFilteredModelOptions({
      catalog,
      fingerprint: fingerprint(['image']),
      outputType: 'image',
      includeInputIncompatible: true,
    });
    const imageOptions = new Map(imageModels.options.map((option) => [option.id, option]));
    assert.equal(imageOptions.get('muse-image')?.inputIncompatible, true);
    assert.equal(imageOptions.get('nano-banana-2-1')?.inputIncompatible, true);
    assert.equal(imageOptions.get('seedream-5-5')?.inputIncompatible, true);
    assert.equal(imageOptions.get('gpt-image-2.5')?.inputIncompatible, undefined);
    assert.equal(imageOptions.get('nano-banana-2-lite')?.inputIncompatible, undefined);

    const videoModels = buildFilteredModelOptions({
      catalog,
      fingerprint: fingerprint(['audio']),
      outputType: 'video',
      includeInputIncompatible: true,
    });
    const videoOptions = new Map(videoModels.options.map((option) => [option.id, option]));
    // #88: an audio candidate has no Muse slot and must not grey Muse.
    assert.equal(videoOptions.get('muse-video')?.inputIncompatible, undefined);
    assert.equal(videoOptions.get('minimax-h3-video')?.inputIncompatible, undefined);
  });

  it('seed-evolving absorbs image/video but rejects audio/pdf', () => {
    const media = selected('seed-evolving', ['image', 'video'], 'text');
    assert.equal(media.selectedOperationId, 'chat');
    assert.equal(modelCanConsumeMediaType({ catalog, modelId: 'seed-evolving', outputType: 'text', mediaType: 'audio' }), false);
    assert.equal(modelCanConsumeMediaType({ catalog, modelId: 'seed-evolving', outputType: 'text', mediaType: 'document' }), false);
  });
});

describe('R7 projection / fail-closed', () => {
  it('drops media URL semantics that do not exist on the target operation', () => {
    const result = buildInputCapability({
      catalog,
      modelId: 'muse-video',
      outputType: 'video',
      fingerprint: fingerprint([]),
      preferredOperationId: 'first_frame',
      params: {
        model: 'muse-video',
        operation: 'first_frame',
        firstFrameUrl: 'https://example.test/first.png',
        fileUrl: 'https://example.test/story.pdf',
        aspectRatio: 'adaptive',
        duration: 5,
      },
    });
    assert.equal(result.selectedOperationId, 'text_to_video');
    assert.ok(result.paramsProjection);
    assert.equal(result.paramsProjection.operationId, 'text_to_video');
    assert.equal(result.paramsProjection.params.operation, 'text_to_video');
    assert.equal(result.paramsProjection.params.firstFrameUrl, undefined);
    assert.equal(result.paramsProjection.params.fileUrl, undefined);
    assert.equal(result.paramsProjection.params.aspectRatio, 'adaptive');
    assert.equal(result.paramsProjection.params.duration, 5);
    assert.ok(result.paramsProjection.dropped.includes('firstFrameUrl'));
    assert.ok(result.paramsProjection.dropped.includes('fileUrl'));
  });

  it('projectParamsForOperation drops controls absent from the target schema only', () => {
    const view = buildContractView(catalog);
    const model = resolveModelView(view, 'muse-video');
    assert.ok(model);
    const textOp = model.operations.find((operation) => operation.id === 'text_to_video');
    assert.ok(textOp);
    const projected = projectParamsForOperation(model, textOp, {
      model: 'muse-video',
      operation: 'first_frame',
      firstFrameUrl: 'https://example.test/a.png',
      aspectRatio: '9:16',
      duration: 5,
    });
    assert.equal(projected.params.operation, 'text_to_video');
    assert.equal(projected.params.firstFrameUrl, undefined);
    assert.equal(projected.params.aspectRatio, '9:16');
    assert.equal(projected.params.duration, 5);
  });

  it('unknown catalog / unknown model fail closed', () => {
    const noCatalog = buildInputCapability({ catalog: null, modelId: 'muse-video', outputType: 'video', fingerprint: fingerprint([]) });
    assert.equal(noCatalog.blocked, true);
    assert.equal(noCatalog.reasonCode, 'catalog_unavailable');
    const unknown = buildInputCapability({ catalog, modelId: 'no-such-model', outputType: 'video', fingerprint: fingerprint([]) });
    assert.equal(unknown.blocked, true);
    assert.equal(unknown.reasonCode, 'unknown_model');
  });
});
