/**
 * Issue #467 / W2 — catalog fingerprint reconcile (no oscillation).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCompatTestCatalog } from '../validation/compatTestCatalog.ts';
import { planCanvasInputMutation } from './canvasInputMutationGateway.ts';
import { managedVideoLinePricingFingerprint } from '../validation/managedVideoExecution.ts';
import { visualLineSelectionMessage } from '../validation/executionReadiness.ts';
import {
  readGraphCatalogFingerprint,
  reconcileCanvasForCatalog,
  shouldReconcileCatalog,
} from './catalogReconcile.ts';

const catalog = createCompatTestCatalog();

function genNode(id, params = {}, materialType = 'image') {
  return {
    id,
    type: 'material',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      materialType,
      nodeKind: 'generate',
      selectedTool: materialType === 'video' ? 'video-generation' : 'text-to-image',
      status: 'empty',
      prompt: '',
      params: { model: 'img-ref', ...params },
    },
  };
}

describe('shouldReconcileCatalog', () => {
  it('same fingerprint → skip; different → reconcile; force always', () => {
    assert.equal(shouldReconcileCatalog({ previousFingerprint: 'a', nextFingerprint: 'a' }), false);
    assert.equal(shouldReconcileCatalog({ previousFingerprint: 'a', nextFingerprint: 'b' }), true);
    assert.equal(shouldReconcileCatalog({ previousFingerprint: '', nextFingerprint: '' }), false);
    assert.equal(shouldReconcileCatalog({ previousFingerprint: 'a', nextFingerprint: 'a', force: true }), true);
  });
});

describe('reconcileCanvasForCatalog', () => {
  it('same fingerprint is a no-op (oscillation guard)', () => {
    const nodes = [genNode('g1')];
    const edges = [];
    const result = reconcileCanvasForCatalog({
      nodes,
      edges,
      catalog,
      previousFingerprint: catalog.fingerprint,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.changed, false);
    assert.equal(result.nodes, nodes);
  });

  it('fingerprint change recomputes generate nodes and stamps catalogFingerprint', () => {
    const nodes = [genNode('g1', { model: 'img-ref', operation: 'image_to_image' })];
    const edges = [];
    const result = reconcileCanvasForCatalog({
      nodes,
      edges,
      catalog,
      previousFingerprint: 'stale-fp',
    });
    assert.equal(result.skipped, false);
    assert.equal(result.fingerprint, catalog.fingerprint);
    const gen = result.nodes.find((n) => n.id === 'g1');
    assert.ok(gen);
    assert.equal(typeof gen.data.params.operation, 'string');
    assert.equal(gen.data.compat.catalogFingerprint, catalog.fingerprint);
  });

  it('unsupported historical feed keeps edges and does not invalidate a prompt-only task', () => {
    const nodes = [
      {
        id: 'src',
        type: 'material',
        position: { x: 0, y: 0 },
        data: {
          label: 'src',
          materialType: 'image',
          nodeKind: 'import',
          selectedTool: 'import',
          status: 'ready',
          mimeType: 'image/gif', // fixture models only allow png/jpeg
          fileSize: 1024,
        },
      },
      genNode('g1', { model: 'img-prompt-only' }),
    ];
    const edges = [
      { id: 'e1', source: 'src', target: 'g1' },
    ];
    const result = reconcileCanvasForCatalog({
      nodes,
      edges,
      catalog,
      previousFingerprint: 'old',
    });
    assert.equal(result.edges.length, 1, 'edges must not be deleted');
    assert.equal(result.edges[0].id, 'e1');
    const gen = result.nodes.find((n) => n.id === 'g1');
    assert.equal(gen.data.compat.status, 'ok');
    assert.equal(gen.data.compat.acceptsCurrentInputs, true);
    assert.equal(gen.data.slotBindings, undefined, 'a slotless operation does not record a user clear');
    assert.equal(gen.data.compat.readyToSubmit, false, 'the task still needs prompt');
  });

  it('readGraphCatalogFingerprint reads the stamped value', () => {
    const nodes = [
      {
        ...genNode('g1'),
        data: {
          ...genNode('g1').data,
          compat: { catalogFingerprint: 'fp-1' },
        },
      },
    ];
    assert.equal(readGraphCatalogFingerprint(nodes), 'fp-1');
    assert.equal(readGraphCatalogFingerprint([]), '');
  });
});

const modelId = 'vid-frames';
const videoMode = { id: 'text_to_video', listed: true, output: { type: 'video' }, inputs: [] };
const videoLine = (id, resolution, duration, audio) => ({ id, enabled: true, label: id,
  effectiveOperations: [{ ...videoMode, parameters: {
    resolution: { options: [{ value: resolution }], defaultValue: resolution },
    duration: { range: { min: duration, max: duration }, required: true },
    ...(audio ? { sound: { type: 'boolean', defaultValue: true } } : {}),
  } }],
});
const manual = videoLine('hand-picked', '1080p', 10, true);
const survivor = videoLine('survivor', '720p', 6, false);
const replacement = { ...videoLine('directory-default', '480p', 4, false), default: true, pricing: { groupRatio: 0.5 } };
const managedCatalog = (fingerprint, channelGroups) => {
  const directory = createCompatTestCatalog();
  const row = directory.models.find(model => model.id === modelId);
  Object.assign(row, { effectiveVideoVersion: 'fixture-version', channelGroups });
  return { ...directory, fingerprint };
};
const savedVideo = () => genNode('v', { model: modelId, operation: videoMode.id,
  routing: { strategy: 'auto', allowedGroups: [manual.id], videoLineQuote: managedVideoLinePricingFingerprint(manual) },
  resolution: '1080p', duration: 10, sound: true,
}, 'video');

it('initializes a new managed video from the marked default and leaves a sole unmarked line unchosen', () => {
  const node = genNode('v', { model: modelId }, 'video');
  const create = channelGroups => planCanvasInputMutation({ nodes: [], edges: [] }, { addNodes: [node] },
    { catalog: managedCatalog('new', channelGroups) }).nodes[0];
  const initialized = create([survivor, replacement]);
  assert.deepEqual(initialized.data.params.routing.allowedGroups, [replacement.id]);
  assert.equal(initialized.data.params.routing.videoLineQuote, managedVideoLinePricingFingerprint(replacement));
  assert.equal(initialized.data.params.operation, videoMode.id);
  assert.equal(initialized.data.params.resolution, '480p');
  assert.equal(initialized.data.params.duration, 4);
  const empty = create([survivor]);
  assert.equal(empty.data.params.routing, undefined);
  assert.equal(visualLineSelectionMessage(managedCatalog('new', [survivor]), empty.data.params), '请选择当前可用的生成线路');
});

it('keeps a valid manual video choice, then migrates the retired line and quote in one graph update', () => {
  const node = savedVideo();
  node.data.prompt = 'Keep my draft';
  const retained = reconcileCanvasForCatalog({ nodes: [node], edges: [], catalog: managedCatalog('new-default', [manual, survivor, replacement]), previousFingerprint: 'previous' });
  assert.deepEqual(retained.nodes[0].data.params, node.data.params);
  const migrated = reconcileCanvasForCatalog({ ...retained, catalog: managedCatalog('retired', [survivor, replacement]), previousFingerprint: retained.fingerprint });
  const data = migrated.nodes[0].data;
  assert.deepEqual(data.params.routing.allowedGroups, [replacement.id]);
  assert.equal(data.params.routing.videoLineQuote, managedVideoLinePricingFingerprint(replacement));
  assert.equal(data.params.operation, videoMode.id);
  assert.equal(data.params.resolution, '480p');
  assert.equal(data.params.duration, 4);
  assert.equal(Object.hasOwn(data.params, 'sound'), false);
  assert.equal(data.prompt, 'Keep my draft');
  assert.equal(node.data.params.resolution, '1080p');
});

it('retains the retired-line draft when the default is missing or lacks required parameter choices', () => {
  const node = savedVideo();
  const binding = { sourceNodeId: 'source', edgeId: 'e', pinned: true };
  node.data.slotBindings = { reference_images: [binding] };
  const source = genNode('source');
  source.data.nodeKind = 'import';
  const edges = [{ id: 'e', source: source.id, target: node.id, data: { role: 'reference' } }];
  const requiresChoice = { ...replacement, effectiveOperations: [{ ...videoMode, parameters: {
    duration: { range: { min: 4, max: 8 }, required: true },
  } }] };
  for (const groups of [[survivor], [survivor, requiresChoice]]) {
    const nextCatalog = managedCatalog('retired', groups);
    const next = reconcileCanvasForCatalog({ nodes: [source, node], edges, catalog: nextCatalog, previousFingerprint: 'old' });
    assert.deepEqual(next.nodes[1].data, node.data);
    assert.deepEqual(next.edges, edges);
    assert.equal(visualLineSelectionMessage(nextCatalog, next.nodes[1].data.params), '原线路已下线，请重选');
  }
});

it('migrates a valid saved parameter when the destination line has no default for it', () => {
  const node = savedVideo();
  const ranged = { ...replacement, effectiveOperations: [{ ...videoMode, parameters: {
    duration: { range: { min: 4, max: 12 }, required: true },
  } }] };
  const directory = managedCatalog('retired', [survivor, ranged]);
  const migrated = reconcileCanvasForCatalog({ nodes: [node], edges: [], catalog: directory, previousFingerprint: 'old' });
  assert.deepEqual(migrated.nodes[0].data.params.routing.allowedGroups, [replacement.id]);
  assert.equal(migrated.nodes[0].data.params.duration, 10);
  assert.equal(Object.hasOwn(migrated.nodes[0].data.params, 'sound'), false);
  assert.equal(visualLineSelectionMessage(directory, migrated.nodes[0].data.params), undefined);
});

it('uses the legacy image default to migrate declared fields and remove unsupported quality', () => {
  const directory = createCompatTestCatalog();
  const row = directory.models.find(model => model.id === 'img-prompt-only');
  row.parameters = {
    resolution: { options: [{ value: '1K' }, { value: '4K' }], defaultValue: '4K' },
    quality: { options: [{ value: 'standard' }, { value: 'hd' }], defaultValue: 'standard' },
    n: { options: [{ value: 1 }, { value: 4 }], defaultValue: 1 },
  };
  row.channelGroups = [{ id: 'first', enabled: true }, { id: 'marked', enabled: true, default: true,
    constraints: { parameters: { resolution: { fixed: '1K' }, quality: { supported: false }, n: { fixed: 1 } } },
  }];
  const node = genNode('image', { model: row.id, operation: 'text_to_image', routing: { allowedGroups: ['retired'] },
    resolution: '4K', n: 4, quality: 'hd' });
  const result = reconcileCanvasForCatalog({ nodes: [node], edges: [], catalog: directory, previousFingerprint: 'old' });
  assert.deepEqual(result.nodes[0].data.params, { model: row.id, operation: 'text_to_image',
    routing: { strategy: 'auto', allowedGroups: ['marked'] }, resolution: '1K', n: 1 });
  const fresh = genNode('fresh', { model: row.id });
  const created = planCanvasInputMutation({ nodes: [], edges: [] }, { addNodes: [fresh] }, { catalog: directory });
  assert.deepEqual(created.nodes[0].data.params.routing.allowedGroups, ['marked']);
});

it('preserves saved official and BYOK drafts during catalog rotation and never reroutes BYOK', () => {
  const official = savedVideo();
  const byok = genNode('byok', { model: modelId, operation: 'text_to_video', duration: 7,
    routing: { sourceType: 'byok', allowedGroups: ['byok-fixture'], channelGroupId: 'byok-fixture' },
  }, 'video');
  official.data.videoSlotDrafts = { text_to_video: { prompt: [{ edgeId: 'e', sourceNodeId: 'source' }] } };
  const graph = { nodes: [official, byok], edges: [] };
  const unavailable = { source: 'omnimux', models: [], image: [], video: [] };
  const waiting = reconcileCanvasForCatalog({ ...graph, catalog: unavailable, previousFingerprint: 'old' });
  assert.equal(waiting.nodes, graph.nodes);
  assert.equal(waiting.edges, graph.edges);
  const edit = planCanvasInputMutation(graph, { nodePatches: [{ nodeId: official.id, data: { prompt: 'Edited while waiting' } }] }, { catalog: unavailable });
  assert.deepEqual(edit.nodes[0].data, { ...official.data, prompt: 'Edited while waiting' });
  const restored = reconcileCanvasForCatalog({ ...edit, catalog: managedCatalog('restored', [manual, survivor, replacement]), previousFingerprint: waiting.fingerprint });
  assert.deepEqual(restored.nodes[0].data.params, official.data.params);
  assert.equal(restored.nodes[0].data.prompt, 'Edited while waiting');
  assert.deepEqual(restored.nodes[1].data.params.routing, byok.data.params.routing);
  assert.equal(restored.nodes[1].data.params.duration, 7);
});

it('does not reinterpret a quoted managed route as legacy when its variant catalog disappears', () => {
  const node = savedVideo();
  const directory = managedCatalog('variant-missing', [manual, replacement]);
  const model = directory.models.find(row => row.id === modelId);
  delete model.effectiveVideoVersion;
  const result = reconcileCanvasForCatalog({ nodes: [node], edges: [], catalog: directory, previousFingerprint: 'old' });
  assert.deepEqual(result.nodes[0].data, node.data);
  assert.equal(visualLineSelectionMessage(directory, result.nodes[0].data.params), '请选择当前可用的生成线路');
});
