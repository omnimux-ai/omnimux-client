import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeVideoParamsForSchema,
} from './videoParamNormalization.ts';
import { buildVideoParameterSelection, readVideoParameterSelections } from './videoParameterSelection.ts';
import { resolveEffectiveVideoParams, validateVideoParamsForUi } from './videoParamAdapter.ts';
import { prepareExecutionSlotGraph } from '../../../../../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';

const options = (...values) => values.map((value) => ({ value, label: String(value) }));

const promptSlot = { slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 };
const firstFrameSlot = { slot: 'first_frame', type: 'image', role: 'first_frame', source: 'upstream_edge', min: 1, max: 1 };
const lastFrameSlot = { slot: 'last_frame', type: 'image', role: 'last_frame', source: 'upstream_edge', min: 1, max: 1 };
const referenceImagesSlot = { slot: 'reference_images', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 9 };

function operation(id, label, inputs = [promptSlot], parameters = {}) {
  return { id, label, listed: true, output: { type: 'video' }, inputs, parameters };
}

const seedanceParameters = {
  aspectRatio: { options: options('16:9', '9:16', '1:1'), defaultValue: '16:9' },
  duration: { options: options(5, 10), defaultValue: 5 },
  resolution: { options: options('720p', '1080p'), defaultValue: '1080p' },
  sound: { supported: true, defaultValue: true },
};

const minimaxParameters = {
  aspectRatio: { options: options('16:9', '9:16', '1:1'), defaultValue: '16:9' },
  duration: { options: options(5, 10, 15, 30, 60), defaultValue: 5 },
  resolution: { options: options('480p', '736p', '768p', '1088p', '1440p'), defaultValue: '768p' },
  sound: { supported: true, defaultValue: true },
};

const firstLastFrameParameters = {
  aspectRatio: { options: options('adaptive'), defaultValue: 'adaptive' },
  duration: { options: options(5, 10, 15, 30, 60), defaultValue: 5 },
  resolution: { options: options('480p', '736p', '768p', '1088p', '1440p'), defaultValue: '768p' },
  sound: { supported: true, defaultValue: true },
};

const catalog = {
  source: 'omnimux',
  text: [], image: [], audio: [],
  video: [
    { id: 'seedance-2-0', label: 'Seedance 2.0', parameters: seedanceParameters },
    { id: 'minimax-h3-video', label: 'MiniMax H3 Video', parameters: minimaxParameters },
  ],
  models: [
    {
      id: 'seedance-2-0', label: 'Seedance 2.0', listed: true, parameters: seedanceParameters,
      operations: [
        operation('text_to_video', '文生视频', [], seedanceParameters),
        operation('first_frame', '首帧生视频', [promptSlot, firstFrameSlot], seedanceParameters),
        operation('video_multi_ref', '多参考', [promptSlot, referenceImagesSlot], seedanceParameters),
      ],
    },
    {
      id: 'minimax-h3-video', label: 'MiniMax H3 Video', listed: true,
      parameters: minimaxParameters,
      channelGroups: [
        { id: 'standard', label: '标准专线', enabled: true },
        {
          id: 'first-last-only', label: '首尾帧专线', enabled: true,
          constraints: {
            operations: ['first_last_frame'],
            parameters: {
              aspectRatio: { fixed: 'adaptive' },
              resolution: { only: ['480p', '768p'] },
            },
          },
        },
      ],
      operations: [
        operation('text_to_video', '文生视频', [], minimaxParameters),
        operation('first_last_frame', '首尾帧过渡', [promptSlot, firstFrameSlot, lastFrameSlot], firstLastFrameParameters),
        operation('video_multi_ref', '多参考', [promptSlot, referenceImagesSlot], minimaxParameters),
      ],
    },
  ],
};

const minimaxItem = catalog.video[1];
const seedanceItem = catalog.video[0];

describe('normalizeVideoParamsForSchema', () => {
  it('keeps legal minimax text_to_video params and keeps 9:16', () => {
    const result = normalizeVideoParamsForSchema({
      params: {
        model: 'minimax-h3-video', operation: 'text_to_video',
        aspectRatio: '9:16', duration: 10, resolution: '768p', prompt: '保留这段提示词',
      },
      modelItem: minimaxItem,
      operationId: 'text_to_video',
      catalog,
    });
    assert.equal(result.params.aspectRatio, '9:16');
    assert.equal(result.params.duration, 10);
    assert.equal(result.params.resolution, '768p');
    assert.equal(result.params.prompt, '保留这段提示词');
    assert.deepEqual(result.notices, []);
    assert.deepEqual(result.blocked, []);
  });

  it('adapts first_last_frame 9:16 to adaptive with a visible notice', () => {
    const result = normalizeVideoParamsForSchema({
      params: {
        model: 'minimax-h3-video', operation: 'first_last_frame',
        aspectRatio: '9:16', duration: 10, resolution: '768p', prompt: '首尾帧',
      },
      modelItem: minimaxItem,
      operationId: 'first_last_frame',
      catalog,
    });
    assert.equal(result.params.aspectRatio, 'adaptive');
    assert.ok(result.notices.some((message) => message.includes('自适应')));
    assert.deepEqual(result.blocked, []);
  });

  it('maps an out-of-range duration to the nearest legal range value', () => {
    const rangeCatalog = structuredClone(catalog);
    rangeCatalog.models[1].operations[0].parameters.duration = {
      range: { min: 4, max: 30, step: 2 }, defaultValue: 4,
    };
    const result = normalizeVideoParamsForSchema({
      params: { model: 'minimax-h3-video', operation: 'text_to_video', duration: 99 },
      modelItem: minimaxItem,
      operationId: 'text_to_video',
      catalog: rangeCatalog,
    });
    assert.equal(result.params.duration, 30);
    assert.ok(result.notices.some((message) => message.includes('30')));
  });

  it('canonicalizes a case-insensitive resolution instead of dropping it', () => {
    const caseCatalog = structuredClone(catalog);
    caseCatalog.models[0].operations[0].parameters.resolution.caseInsensitive = true;
    const result = normalizeVideoParamsForSchema({
      params: { model: 'seedance-2-0', operation: 'text_to_video', resolution: '1080P' },
      modelItem: seedanceItem,
      operationId: 'text_to_video',
      catalog: caseCatalog,
    });
    assert.equal(result.params.resolution, '1080p');
  });

  it('returns a blocked item for a required field with no legal default', () => {
    const requiredCatalog = structuredClone(catalog);
    requiredCatalog.models[0].operations[0].parameters.aspectRatio = {
      options: [], required: true,
    };
    const result = normalizeVideoParamsForSchema({
      params: { model: 'seedance-2-0', operation: 'text_to_video', aspectRatio: '9:16' },
      modelItem: seedanceItem,
      operationId: 'text_to_video',
      catalog: requiredCatalog,
    });
    assert.equal(result.params.aspectRatio, undefined);
    assert.ok(result.blocked.some((item) => item.field === 'aspectRatio' && item.required === true));
  });

  it('blocks required fields with non-empty options and no defaultValue instead of selecting the first option', () => {
    const requiredCatalog = structuredClone(catalog);
    const requiredSchema = {
      aspectRatio: { options: options('4k'), required: true },
      duration: { options: options(8), required: true },
      resolution: { options: options('8k'), required: true },
      quality: { options: options('best'), required: true },
    };
    requiredCatalog.models[0].parameters = requiredSchema;
    requiredCatalog.models[0].operations[0].parameters = requiredSchema;
    const result = normalizeVideoParamsForSchema({
      params: { model: 'seedance-2-0', operation: 'text_to_video' },
      modelItem: seedanceItem,
      operationId: 'text_to_video',
      catalog: requiredCatalog,
    });
    assert.equal(result.params.aspectRatio, undefined);
    assert.equal(result.params.duration, undefined);
    assert.equal(result.params.resolution, undefined);
    assert.equal(result.params.quality, undefined);
    assert.deepEqual(
      result.blocked.map((item) => item.field).sort(),
      ['aspectRatio', 'duration', 'quality', 'resolution'],
    );
    assert.ok(result.blocked.every((item) => item.required === true));
  });

  it('keeps a legal supplied value for a required field with no defaultValue', () => {
    const requiredCatalog = structuredClone(catalog);
    const requiredSchema = {
      aspectRatio: { options: options('4k'), required: true },
      duration: { options: options(8), required: true },
      resolution: { options: options('8k'), required: true },
      quality: { options: options('best'), required: true },
    };
    requiredCatalog.models[0].parameters = requiredSchema;
    requiredCatalog.models[0].operations[0].parameters = requiredSchema;
    const result = normalizeVideoParamsForSchema({
      params: {
        model: 'seedance-2-0', operation: 'text_to_video',
        aspectRatio: '4k', duration: 8, resolution: '8k', quality: 'best',
      },
      modelItem: seedanceItem,
      operationId: 'text_to_video',
      catalog: requiredCatalog,
    });
    assert.equal(result.params.aspectRatio, '4k');
    assert.equal(result.params.duration, 8);
    assert.equal(result.params.resolution, '8k');
    assert.equal(result.params.quality, 'best');
    assert.deepEqual(result.blocked, []);
  });

  it('falls back to the first option only for non-required fields without defaultValue', () => {
    const optionalCatalog = structuredClone(catalog);
    const optionalSchema = {
      aspectRatio: { options: options('4k') },
      duration: { options: options(8) },
      resolution: { options: options('8k') },
      quality: { options: options('best') },
    };
    optionalCatalog.models[0].parameters = optionalSchema;
    optionalCatalog.models[0].operations[0].parameters = optionalSchema;
    const result = normalizeVideoParamsForSchema({
      params: {
        model: 'seedance-2-0', operation: 'text_to_video',
        aspectRatio: 'legacy', duration: 99, resolution: 'legacy', quality: 'legacy',
      },
      modelItem: seedanceItem,
      operationId: 'text_to_video',
      catalog: optionalCatalog,
    });
    assert.equal(result.params.aspectRatio, '4k');
    assert.equal(result.params.duration, 8);
    assert.equal(result.params.resolution, '8k');
    assert.equal(result.params.quality, 'best');
    assert.deepEqual(result.blocked, []);
  });

  it('does not fabricate defaults or overwrite params when the catalog is unavailable', () => {
    const params = { model: 'minimax-h3-video', operation: 'first_last_frame', aspectRatio: '9:16', duration: 5 };
    const result = normalizeVideoParamsForSchema({ params, catalog: null, modelItem: minimaxItem });
    assert.deepEqual(result.params, params);
    assert.ok(result.blocked.some((item) => item.message === '模型配置尚未就绪'));
  });

  it('is idempotent: applying the normalized result twice produces no second notice', () => {
    const first = normalizeVideoParamsForSchema({
      params: { model: 'minimax-h3-video', operation: 'first_last_frame', aspectRatio: '9:16' },
      modelItem: minimaxItem,
      operationId: 'first_last_frame',
      catalog,
    });
    const second = normalizeVideoParamsForSchema({
      params: first.params,
      modelItem: minimaxItem,
      operationId: 'first_last_frame',
      catalog,
    });
    assert.deepEqual(second.notices, []);
    assert.equal(second.params.aspectRatio, 'adaptive');
  });

  it('drops a stale referenceImages array beyond the operation image-slot capacity', () => {
    const result = normalizeVideoParamsForSchema({
      params: {
        model: 'minimax-h3-video', operation: 'first_last_frame',
        aspectRatio: 'adaptive', referenceImages: ['a.png', 'b.png', 'c.png'],
      },
      modelItem: minimaxItem,
      operationId: 'first_last_frame',
      catalog,
    });
    assert.deepEqual(result.params.referenceImages, ['a.png', 'b.png']);
    assert.ok(result.notices.some((message) => message.includes('2')));
  });
});

describe('buildVideoParameterSelection / readVideoParameterSelections', () => {
  it('roundtrips A → B → A with A legal history restored and B history normalized', () => {
    const first = buildVideoParameterSelection({
      params: {
        model: 'seedance-2-0', operation: 'text_to_video',
        aspectRatio: '9:16', duration: 10, resolution: '1080p', prompt: 'A 的提示词',
      },
      currentModelItem: seedanceItem,
      targetModelItem: minimaxItem,
      catalog,
      upstreams: [],
      prompt: 'A 的提示词',
    });
    assert.equal(first.params.model, 'minimax-h3-video');
    assert.equal(first.params.operation, 'text_to_video');
    assert.equal(first.params.aspectRatio, '16:9');
    assert.equal(first.params.duration, 5);
    assert.equal(first.params.resolution, '768p');
    assert.equal(first.params.prompt, 'A 的提示词');
    assert.equal(first.parameterSelections.byModel['seedance-2-0'].byOperation.text_to_video.aspectRatio, '9:16');

    const back = buildVideoParameterSelection({
      params: { ...first.params, aspectRatio: '9:16' },
      parameterSelections: first.parameterSelections,
      currentModelItem: minimaxItem,
      targetModelItem: seedanceItem,
      catalog,
      upstreams: [],
      prompt: 'A 的提示词',
    });
    assert.equal(back.params.model, 'seedance-2-0');
    assert.equal(back.params.aspectRatio, '9:16');
    assert.equal(back.params.duration, 10);
    assert.equal(back.params.resolution, '1080p');
    assert.equal(back.params.prompt, 'A 的提示词');
  });

  it('same-model channel switch normalizes operation and channel constraints', () => {
    const result = buildVideoParameterSelection({
      params: {
        model: 'minimax-h3-video', operation: 'text_to_video',
        aspectRatio: '9:16', duration: 10, resolution: '1080p', prompt: '渠道切换',
        routing: { strategy: 'auto', allowedGroups: ['standard'] },
      },
      currentModelItem: minimaxItem,
      targetModelItem: minimaxItem,
      catalog,
      upstreams: [],
      prompt: '渠道切换',
      routing: { strategy: 'auto', allowedGroups: ['first-last-only'], channelGroupId: 'first-last-only' },
      explicitModelSelection: true,
    });
    assert.equal(result.params.operation, 'first_last_frame');
    assert.equal(result.params.aspectRatio, 'adaptive');
    assert.equal(result.params.resolution, '768p');
    assert.ok(result.notices.length > 0);
  });

  it('drops invalid historical controls and reports notices without polluting next params', () => {
    const history = {
      version: 1,
      byModel: {
        'minimax-h3-video': {
          lastOperationId: 'first_last_frame',
          byOperation: {
            first_last_frame: { aspectRatio: '9:16', duration: 99, resolution: '4k' },
          },
        },
      },
    };
    const result = buildVideoParameterSelection({
      params: { model: 'minimax-h3-video', operation: 'first_last_frame' },
      parameterSelections: history,
      currentModelItem: minimaxItem,
      targetModelItem: minimaxItem,
      catalog,
      upstreams: [
        { nodeId: 'img-1', materialType: 'image', hasMedia: true, availability: 'ready', url: 'https://example.test/1.png' },
        { nodeId: 'img-2', materialType: 'image', hasMedia: true, availability: 'ready', url: 'https://example.test/2.png' },
      ],
      prompt: '旧项目',
    });
    assert.equal(result.params.aspectRatio, 'adaptive');
    assert.equal(result.params.duration, 5);
    assert.equal(result.params.resolution, '768p');
    assert.ok(result.notices.length > 0);
    assert.equal(result.parameterSelections.byModel['minimax-h3-video'].byOperation.first_last_frame.aspectRatio, 'adaptive');
  });

  it('readVideoParameterSelections normalizes a supplied catalog without mutating the stored object', () => {
    const stored = {
      version: 1,
      byModel: {
        'minimax-h3-video': {
          lastOperationId: 'first_last_frame',
          byOperation: { first_last_frame: { aspectRatio: '9:16', duration: 99, resolution: '4k' } },
        },
      },
    };
    const before = structuredClone(stored);
    const read = readVideoParameterSelections(stored, { catalog, modelId: 'minimax-h3-video' });
    assert.deepEqual(stored, before);
    assert.equal(read.byModel['minimax-h3-video'].byOperation.first_last_frame.aspectRatio, 'adaptive');
    assert.ok(read.notices.length > 0);
  });
});

describe('read-side / execution-side consistency', () => {
  it('resolveEffectiveVideoParams and prepareExecutionSlotGraph produce the same normalized params', () => {
    const params = {
      model: 'minimax-h3-video', operation: 'first_last_frame',
      aspectRatio: '9:16', duration: 5, resolution: '768p', prompt: '首尾帧生成',
    };
    const images = [
      { nodeId: 'img-1', materialType: 'image', hasMedia: true, availability: 'ready', url: 'https://example.test/1.png' },
      { nodeId: 'img-2', materialType: 'image', hasMedia: true, availability: 'ready', url: 'https://example.test/2.png' },
    ];
    const effective = resolveEffectiveVideoParams({
      params,
      schema: minimaxParameters,
      modelItem: minimaxItem,
      catalog,
      upstreams: images,
      prompt: '首尾帧生成',
    });
    assert.equal(effective.aspectRatio, 'adaptive');
    assert.equal(validateVideoParamsForUi({ params: effective, prompt: '首尾帧生成' }).some((error) => error.includes('aspectRatio')), false);

    const nodes = [
      { id: 'img-1', type: 'material', data: { materialType: 'image', nodeKind: 'import', mediaUrl: 'https://example.test/1.png' } },
      { id: 'img-2', type: 'material', data: { materialType: 'image', nodeKind: 'import', mediaUrl: 'https://example.test/2.png' } },
      {
        id: 'target', type: 'material',
        data: { materialType: 'video', prompt: '首尾帧生成', params: { ...params } },
      },
    ];
    const edges = [
      { id: 'e-1', source: 'img-1', target: 'target' },
      { id: 'e-2', source: 'img-2', target: 'target' },
    ];
    const prepared = prepareExecutionSlotGraph(nodes, edges, catalog);
    const preparedTarget = prepared.nodes.find((node) => node.id === 'target');
    assert.equal(preparedTarget.data.params.aspectRatio, 'adaptive');
    assert.equal(preparedTarget.data.params.duration, 5);
    assert.equal(preparedTarget.data.params.resolution, '768p');
  });

  it('prepareExecutionSlotGraph normalizes an operation-level-only invalid ratio for a gateway catalog', () => {
    const firstFrameOperation = operation('first_frame', '首帧生视频', [promptSlot, firstFrameSlot], {
      aspectRatio: { options: options('adaptive'), defaultValue: 'adaptive' },
    });
    const gatewayCatalog = {
      source: 'omnimux', schemaVersion: '1.1', defaults: { video: 'frames' },
      text: [], image: [], video: [{ id: 'frames', label: 'frames' }], audio: [],
      models: [{
        id: 'frames', label: 'frames', listed: true,
        operations: [firstFrameOperation],
      }],
    };
    const target = {
      id: 'target', type: 'material',
      data: {
        materialType: 'video', prompt: '首帧生成',
        params: { model: 'frames', operation: 'first_frame', aspectRatio: '9:16' },
      },
    };
    const prepared = prepareExecutionSlotGraph([target], [], gatewayCatalog);
    assert.equal(prepared.nodes[0].data.params.aspectRatio, 'adaptive');
    assert.equal(target.data.params.aspectRatio, '9:16');
  });

  it('prepareExecutionSlotGraph uses operation-level parameters when the model row has none', () => {
    const textToVideoOperation = operation('text_to_video', '文生视频', [], {
      aspectRatio: { options: options('adaptive'), defaultValue: 'adaptive' },
      duration: { options: options(10), defaultValue: 10 },
      resolution: { options: options('1080p'), defaultValue: '1080p' },
    });
    const gatewayCatalog = {
      source: 'omnimux', schemaVersion: '1.1', defaults: { video: 'frames' },
      text: [], image: [], video: [{ id: 'frames', label: 'frames' }], audio: [],
      models: [{
        id: 'frames', label: 'frames', listed: true,
        operations: [textToVideoOperation],
      }],
    };
    const target = {
      id: 'target', type: 'material',
      data: {
        materialType: 'video', prompt: '文生视频',
        params: { model: 'frames', operation: 'text_to_video', aspectRatio: '9:16', duration: 5, resolution: '4k' },
      },
    };
    const prepared = prepareExecutionSlotGraph([target], [], gatewayCatalog);
    assert.equal(prepared.nodes[0].data.params.aspectRatio, 'adaptive');
    assert.equal(prepared.nodes[0].data.params.duration, 10);
    assert.equal(prepared.nodes[0].data.params.resolution, '1080p');
    assert.equal(target.data.params.aspectRatio, '9:16');
  });
});
