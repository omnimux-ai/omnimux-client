import { readExplicitTargetSlot, type ContractModelView } from '../../validation/compatKernel.ts';
import type { Edge } from '@xyflow/react';
import type { CapabilityCatalog } from '../../api.ts';
import { buildCanvasUpstreamFingerprint } from '../canvasInputSources.ts';
import type { CanvasNode } from '../canvasInputMutationGateway.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
import { feedFromFingerprint } from './effectiveFingerprint.ts';
import { hydrateSlotBindings, type LegacySlotEdge } from './hydrateSlotBindings.ts';
import type { SlotBindings, SlotConflict, SlotOccupant } from './types.ts';

export const H3_SLOT_RENAMES = [
  { from: 'character', fromRole: 'first_frame', to: 'reference_image', type: 'image' },
  { from: 'driving_audio', fromRole: 'audio_track', to: 'reference_audio', type: 'audio' },
] as const;

/** Read historical H3 bindings and edge hints before either the canvas or execution hydrates them. */
function projectLegacyH3Slots<E extends LegacySlotEdge & { target: string }>(
  nodeId: string, data: Record<string, unknown>, edges: E[], catalogSource: string | undefined, model: ContractModelView | undefined,
): { data: Record<string, unknown>; edges: E[] } {
  const params = data.params as { model?: string; operation?: string } | undefined;
  if (data.materialType !== 'video' || catalogSource !== 'omnimux' || !params?.model || model?.id !== 'minimax-h3-video'
    || params.operation !== 'digital_human') return { data, edges };
  const operation = model.operations.find(candidate => candidate.id === params.operation && candidate.listed && candidate.output.type === 'video');
  if (!operation) return { data, edges };
  const aliases = H3_SLOT_RENAMES.filter(({ from, to, type }) => !operation.inputs.some(input => input.slot === from)
    && operation.inputs.some(input => input.slot === to && input.type === type && input.role === 'reference'
      && input.source === 'upstream_edge' && input.min === 1 && input.max === 1));
  if (!aliases.length) return { data, edges };

  let nextData = data;
  for (const { from, fromRole, to } of aliases) {
    const bindings = nextData.slotBindings as SlotBindings | undefined;
    const occupants = bindings?.[from];
    if (!bindings || !Array.isArray(occupants)) continue;
    // A current slot, including a saved empty slot, supersedes its retired name.
    const alreadyCurrent = Object.hasOwn(bindings, to);
    const projectRole = (occupant: SlotOccupant) => occupant.role === fromRole ? { ...occupant, role: 'reference' } : occupant;
    const nextBindings = { ...bindings };
    if (!alreadyCurrent) nextBindings[to] = occupants.map(projectRole);
    delete nextBindings[from];
    const conflicts = nextData.slotConflicts as SlotConflict[] | undefined;
    nextData = { ...nextData, slotBindings: nextBindings, ...(Array.isArray(conflicts) ? {
      slotConflicts: alreadyCurrent ? conflicts.filter(conflict => conflict.slot !== from)
        : conflicts.map(conflict => conflict.slot === from ? { ...conflict, slot: to, occupant: projectRole(conflict.occupant) } : conflict),
    } : {}) };
  }
  let hadOldEdge = false;
  const nextEdges = edges.map(edge => {
    if (edge.target !== nodeId) return edge;
    const metadata = edge.data ?? {};
    const name = readExplicitTargetSlot(metadata, edge.targetHandle);
    const alias = aliases.find(candidate => candidate.from === name);
    if (!alias) return edge;
    hadOldEdge = true;
    const binding = metadata.slotBinding as { role?: string; mirror?: boolean } | undefined;
    const role = typeof metadata.role === 'string' ? metadata.role : binding?.mirror === true ? undefined : binding?.role;
    return { ...edge, data: { ...metadata, targetSlot: alias.to, ...(role === alias.fromRole ? { role: 'reference' } : {}) } };
  });
  return { data: nextData, edges: hadOldEdge ? nextEdges : edges };
}


/** The canvas and execution read the same slot choices before their normal readiness checks. */
export function projectCanvasInputSources<E extends LegacySlotEdge & { target: string }>(
  nodeId: string, data: Record<string, unknown>, nodes: CanvasNode[], edges: E[],
  catalog: CapabilityCatalog | null | undefined, model: ContractModelView | undefined,
) {
  const projected = projectLegacyH3Slots(nodeId, data, edges, catalog?.source, model);
  const fingerprint = buildCanvasUpstreamFingerprint(nodeId, nodes, projected.edges as Edge[]);
  // Some snapshots already carried the binding version, but still stored the actual
  // selections solely on the old edges. An existing map (including {}) takes precedence.
  if (projected.edges !== edges && data.inputBindingVersion === 1 && data.slotBindings === undefined) {
    const layout = deriveSlotLayout(catalog, model?.id, 'digital_human');
    const fill = hydrateSlotBindings(feedFromFingerprint(fingerprint, 1), layout,
      projected.edges.filter(edge => edge.target === nodeId), (data.slotStandbyEdgeIds ?? []) as string[]);
    projected.data = { ...projected.data, slotBindings: fill.bindings, slotConflicts: fill.conflicts };
  }
  return { ...projected, fingerprint };
}
