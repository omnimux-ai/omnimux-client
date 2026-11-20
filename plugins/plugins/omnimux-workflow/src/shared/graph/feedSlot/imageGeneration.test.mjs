/**
 * Image mode is derived from the reference well, not from a saved operation.
 * These tests run against the real shipped catalog so operation ids and slot
 * names stay tied to the gateway contract.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildModelCatalog } from '../../../../../omnimux/src/catalog/list.js';
import { projectCanvasCatalog } from '../../generationPolicy.ts';
import { buildUiUpstreamFingerprint } from '../../validation/operationUi.ts';
import {
  buildImageGenerationCapability,
  deriveImageGenerationLayout,
  resolveImageOperationForReferenceCount,
} from './imageGeneration.ts';

const bundled = JSON.parse(readFileSync(new URL('../../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }));

function fingerprint(types) {
  return buildUiUpstreamFingerprint({
    prompt: 'draw a product shot',
    upstreams: types.map((materialType, index) => ({
      nodeId: `ref-${index}`,
      materialType,
      hasMedia: true,
      availability: 'ready',
    })),
  });
}

describe('image generation derived mode', () => {
  it('gpt-image-2.5 exposes an optional reference well and derives text_to_image / multi_reference', () => {
    const layout = deriveImageGenerationLayout(catalog, 'gpt-image-2.5', 'text_to_image');
    assert.ok(layout);
    assert.ok(layout.slots.some((slot) => slot.slot === 'reference_image'));
    assert.equal(layout.slots.find((slot) => slot.slot === 'reference_image')?.min, 0);
    assert.equal(layout.displayOnlyFromOperation, 'multi_reference');

    assert.equal(resolveImageOperationForReferenceCount(catalog, 'gpt-image-2.5', 0), 'text_to_image');
    assert.equal(resolveImageOperationForReferenceCount(catalog, 'gpt-image-2.5', 1), 'multi_reference');
    assert.equal(resolveImageOperationForReferenceCount(catalog, 'gpt-image-2.5', 2), undefined);

    const none = buildImageGenerationCapability({ catalog, modelId: 'gpt-image-2.5', fingerprint: fingerprint([]) });
    assert.equal(none.selectedOperationId, 'text_to_image');
    const one = buildImageGenerationCapability({ catalog, modelId: 'gpt-image-2.5', fingerprint: fingerprint(['image']) });
    assert.equal(one.selectedOperationId, 'multi_reference');
  });

  it('nano-banana-2-lite derives image_to_image for a reference', () => {
    assert.equal(resolveImageOperationForReferenceCount(catalog, 'nano-banana-2-lite', 0), 'text_to_image');
    assert.equal(resolveImageOperationForReferenceCount(catalog, 'nano-banana-2-lite', 1), 'image_to_image');
  });

  it('models without a reference operation do not pretend to accept one', () => {
    for (const modelId of ['muse-image', 'nano-banana-2-1', 'seedream-5-5']) {
      const layout = deriveImageGenerationLayout(catalog, modelId);
      assert.equal(layout?.slots.some((slot) => slot.type === 'image') ?? false, false, modelId);
      assert.equal(resolveImageOperationForReferenceCount(catalog, modelId, 1), undefined, modelId);
      assert.equal(buildImageGenerationCapability({ catalog, modelId, fingerprint: fingerprint(['image']) }).selectedOperationId, undefined, modelId);
    }
  });
});

import { planCanvasInputMutation } from '../canvasInputMutationGateway.ts';
import { planPickerSelectionMutation } from '../../../canvas/editor/utils/resourcePickerPolicy.ts';
import { catalogFor, operation as fixtureOperation, slot as fixtureSlot } from '../../../workflow/seam/submissionFixtures.mjs';

describe('image reference well mutation', () => {
  const fixtureCatalog = catalogFor('image', 'img-ref', [
    fixtureOperation('text_to_image', 'image', []),
    fixtureOperation('multi_reference', 'image', [fixtureSlot('image', 'reference', 0, 1, 'reference_image')]),
  ]);
  const target = {
    id: 'target', type: 'material', position: { x: 0, y: 0 },
    data: { materialType: 'image', nodeKind: 'generate', inputBindingVersion: 1, prompt: 'draw', params: { model: 'img-ref', operation: 'text_to_image' }, slotBindings: {} },
  };
  const source = {
    id: 'ref', type: 'material', position: { x: 100, y: 0 },
    data: { materialType: 'image', nodeKind: 'import', mediaUrl: 'https://example.test/ref.png', mimeType: 'image/png' },
  };

  it('adds a reference and switches to multi_reference in one mutation', () => {
    const graph = { nodes: [target, source], edges: [] };
    const request = { targetNodeId: 'target', chosenOperationId: 'text_to_image', selections: [{ sourceNodeId: 'ref', outputId: 'https://example.test/ref.png' }] };
    const plan = planPickerSelectionMutation(graph, request, { catalog: fixtureCatalog }, { referenceSlots: ['reference_image'], files: [] });
    assert.equal(plan.status, 'allowed', plan.reasonCode);
    assert.ok(plan.mutation);
    const applied = planCanvasInputMutation(graph, plan.mutation, { catalog: fixtureCatalog });
    assert.equal(applied.status, 'allowed', applied.reasonCode);
    const node = applied.nodes.find((item) => item.id === 'target');
    assert.equal(node.data.params.operation, 'multi_reference');
    assert.equal(node.data.autoOperationId, 'multi_reference');
    assert.equal(node.data.slotBindings.reference_image[0].sourceNodeId, 'ref');
  });

  it('removing the last reference returns to text_to_image', () => {
    const wired = {
      ...target,
      data: {
        ...target.data,
        params: { model: 'img-ref', operation: 'multi_reference' },
        autoOperationId: 'multi_reference',
        slotBindings: { reference_image: [{ edgeId: 'e-ref', sourceNodeId: 'ref', outputId: 'https://example.test/ref.png', role: 'reference', use: 'active', pinned: true }] },
        slotStandbyEdgeIds: [],
      },
    };
    const graph = { nodes: [wired, source], edges: [{ id: 'e-ref', source: 'ref', target: 'target' }] };
    const plan = planCanvasInputMutation(graph, {
      nodePatches: [{ nodeId: 'target', data: { slotBindings: {}, slotStandbyEdgeIds: ['e-ref'] } }],
    }, { catalog: fixtureCatalog });
    assert.equal(plan.status, 'allowed', plan.reasonCode);
    const node = plan.nodes.find((item) => item.id === 'target');
    assert.equal(node.data.params.operation, 'text_to_image');
    assert.equal(node.data.autoOperationId, 'text_to_image');
  });
});
