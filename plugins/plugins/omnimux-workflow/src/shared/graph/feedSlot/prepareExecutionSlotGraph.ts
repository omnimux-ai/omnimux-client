import type { CapabilityCatalog } from '../../api.ts';
import { buildContractView, resolveModelView } from '../../validation/compatKernel.ts';
import { buildInputCapability } from '../../validation/inputCapability.ts';
import { readNodeInputSource } from '../nodeInputSource.ts';
import { resolveNodeKind } from '../materialNode.ts';
import { materialTools } from '../../specs/nodes/materialNodeSpec.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
import { readPreferredOperationId } from '../../validation/operationUi.ts';
import { effectiveInputDisplay } from './effectiveInputDisplay.ts';
import type { LegacySlotEdge } from './hydrateSlotBindings.ts';
import type { FeedAsset, SlotBindings, SlotConflict } from './types.ts';
import { buildCanvasUpstreamFingerprint } from '../canvasInputSources.ts';
import type { CanvasNode } from '../canvasInputMutationGateway.ts';
import type { Edge } from '@xyflow/react';
import { resolveSlotOperation } from './resolveSlotOperation.ts';
import { normalizeVideoParamsForSchema } from '../../../canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamNormalization.ts';

/** Freeze legacy hydration for dispatch without modifying the persisted graph or topology. */
export function prepareExecutionSlotGraph<
  N extends { id: string; type?: string; data?: Record<string, unknown> },
  E extends LegacySlotEdge & { target: string },
>(nodes: N[], edges: E[], catalog: CapabilityCatalog | null | undefined): { nodes: N[]; edges: E[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const view = buildContractView(catalog);
  const ordinalByTarget = new Map<string, number>();
  const nextEdges = edges.map((edge) => {
    const ordinal = ordinalByTarget.get(edge.target) ?? 0;
    ordinalByTarget.set(edge.target, ordinal + 1);
    return { ...structuredClone(edge), id: edge.id ?? `feed-${edge.source}-${ordinal}`,
      data: { ...structuredClone(edge.data), feedType: readNodeInputSource(byId.get(edge.source) ?? { id: edge.source }).materialType } };
  }) as E[];
  const nextNodes = nodes.map((node) => {
    if (node.type !== 'material' || resolveNodeKind(node.data ?? {}) !== 'generate') return structuredClone(node);
    const capabilityId = typeof node.data?.outputCapabilityId === 'string'
      ? node.data.outputCapabilityId.trim()
      : '';
    if (capabilityId && materialTools[capabilityId]?.executorKey) return structuredClone(node);
    const data = structuredClone(node.data ?? {});
    let params = (data.params ?? {}) as Record<string, unknown>;
    const kind = (data.materialType ?? 'text') as keyof NonNullable<CapabilityCatalog['defaults']>;
    const autoOperationId = typeof data.autoOperationId === 'string' || data.autoOperationId === null
      ? data.autoOperationId as string | null
      : undefined;
    const model = resolveModelView(view, (params.model ?? catalog?.defaults?.[kind]) as string | undefined);
    params.model ??= model?.id;
    const fingerprint = buildCanvasUpstreamFingerprint(node.id, nodes as unknown as CanvasNode[], nextEdges as unknown as Edge[]);
    if (kind === 'video') {
      // R9: inputCapability decides the operation from the connected media;
      // #55 below only normalizes the values against that operation schema.
      const preferredOperationId = readPreferredOperationId(params, autoOperationId);
      const capability = buildInputCapability({
        catalog,
        modelId: model?.id,
        outputType: 'video',
        fingerprint,
        ...(preferredOperationId ? { preferredOperationId } : {}),
        autoOperationId,
        params,
        ignoredEdgeIds: (data.slotStandbyEdgeIds ?? []) as string[],
      });
      if (capability.selectedOperationId) params.operation = capability.selectedOperationId;
      if (capability.paramsProjection) params = capability.paramsProjection.params;
    } else {
      params.operation ??= resolveSlotOperation(catalog, model?.id, params.operation, kind, fingerprint);
    }
    if (kind === 'video' && catalog?.source === 'omnimux') {
      // The gateway catalog is the execution contract. A model row without
      // model-level parameters can still carry operation-level constraints;
      // skipping normalization here would dispatch a value the read side
      // already normalized. Offline static stubs keep their historical shape.
      const normalized = normalizeVideoParamsForSchema({
        params,
        operationId: typeof params.operation === 'string' ? params.operation : undefined,
        catalog,
      });
      params = normalized.params;
    }
    data.params = params;
    // Current bindings are explicit intent; preparation is not a migration or picker.
    if (data.inputBindingVersion === 1) return { ...node, data } as N;
    if (kind === 'audio' && params.operation === 'text_to_speech') {
      data.slotBindings = {};
      data.slotConflicts = [];
    }
    {
      const incoming = nextEdges.filter((edge) => edge.target === node.id);
      const feed: FeedAsset[] = incoming.flatMap((edge, ordinal) => {
        const source = readNodeInputSource(byId.get(edge.source) ?? { id: edge.source });
        if (!['image', 'video', 'audio'].includes(source.materialType)) return [];
        return [{ edgeId: edge.id ?? `feed-${edge.source}-${ordinal}`, sourceNodeId: edge.source, ordinal,
          type: source.materialType, outputId: source.outputId, availability: source.availability,
          url: source.output.mediaAssets?.[0]?.url, ...source.metadata }];
      });
      const layout = deriveSlotLayout(catalog, model?.id, params.operation as string | undefined);
      const fill = effectiveInputDisplay(layout, feed, data.slotBindings as SlotBindings | undefined,
        (data.slotConflicts ?? []) as SlotConflict[], incoming, (data.slotStandbyEdgeIds ?? []) as string[]);
      data.slotBindings = fill.bindings;
      data.slotConflicts = fill.conflicts;
    }
    return { ...node, data } as N;
  });
  return { nodes: nextNodes, edges: nextEdges };
}
