import type { CapabilityCatalog } from '../../api.ts';
import { buildContractView, resolveModelView } from '../../validation/compatKernel.ts';
import { buildInputCapability } from '../../validation/inputCapability.ts';
import { readNodeInputSource } from '../nodeInputSource.ts';
import { resolveNodeKind } from '../materialNode.ts';
import { materialTools } from '../../specs/nodes/materialNodeSpec.ts';
import { H3_SLOT_RENAMES, projectCanvasInputSources } from './legacyH3Slots.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
import { readPreferredOperationId } from '../../validation/operationUi.ts';
import { effectiveInputDisplay } from './effectiveInputDisplay.ts';
import type { LegacySlotEdge } from './hydrateSlotBindings.ts';
import type { FeedAsset, SlotBindings, SlotConflict } from './types.ts';
import type { CanvasNode } from '../canvasInputMutationGateway.ts';
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
  let nextEdges = edges.map((edge) => {
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
    let data = structuredClone(node.data ?? {});
    let params = (data.params ?? {}) as Record<string, unknown>;
    const kind = (data.materialType ?? 'text') as keyof NonNullable<CapabilityCatalog['defaults']>;
    const autoOperationId = typeof data.autoOperationId === 'string' || data.autoOperationId === null
      ? data.autoOperationId as string | null
      : undefined;
    const model = resolveModelView(view, (params.model ?? catalog?.defaults?.[kind]) as string | undefined);
    const projected = projectCanvasInputSources(node.id, data, nodes as unknown as CanvasNode[], nextEdges, catalog, model);
    data = projected.data;
    nextEdges = projected.edges;
    params.model ??= model?.id;
    const fingerprint = projected.fingerprint;
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
      // A saved or click-time snapshot may still carry the previous lip-sync
      // wells after the user explicitly switched to text. Keep the original
      // graph intact and use only the current operation's inputs in this run.
      const textMode = capability.operationStates.find(state => state.id === 'text_to_video');
      if (params.operation === textMode?.id && textMode?.selectableBeforeInputs && data.slotBindings) {
        const lip = model?.operations.find(operation => operation.id === 'digital_human');
        const dormant = new Set(lip?.inputs.filter(input => input.type === 'image' || input.type === 'audio').map(input => input.slot));
        for (const rename of H3_SLOT_RENAMES) if (dormant.has(rename.to)) dormant.add(rename.from);
        for (const input of model?.operations.find(operation => operation.id === textMode.id)?.inputs ?? []) dormant.delete(input.slot);
        data.slotBindings = Object.fromEntries(Object.entries(data.slotBindings).filter(([slot]) => !dormant.has(slot)));
        if (Array.isArray(data.slotConflicts)) data.slotConflicts = data.slotConflicts.filter(conflict => !dormant.has(conflict.slot));
      }
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
