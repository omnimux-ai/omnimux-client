import { resolveGenerationPrompt } from '../generationPrompt.ts';
import { isMediaInputType, isVisualGeneration } from '../../validation/compatKernel.ts';
import { acceptsFeedAsset, isReadyFeedAsset } from './autoFillSlots.ts';
import type { EffectiveSubmitInputs, FeedAsset, SlotBindings, SlotConflict, SlotLayout, SlotOccupant, SlotSpec } from './types.ts';

export interface SlotSelection {
  slot: SlotSpec;
  occupant: SlotOccupant;
  asset?: FeedAsset;
  state: 'ready' | 'inactive' | 'pending' | 'invalid';
  reasonCode?: 'input_waiting' | 'input_unavailable' | 'slot_removed' | 'role_conflict' | 'slot_capacity';
}

export function resolveSlotOccupantOrdinal(occupant: SlotOccupant, asset?: FeedAsset): number {
  return occupant.ordinal ?? (asset?.sourceNodeId === occupant.sourceNodeId ? asset.ordinal : 0);
}

export interface SlotSelectionOptions {
  /** Mutations validate the requested assignment before any unused supply is projected out. */
  strictMedia?: boolean;
  strictAssignments?: readonly { slot: string; edgeId: string }[];
}

/** The sole traversal of persisted consumption; never fills gaps from standby feed. */
export function selectSlotOccupants(layout: SlotLayout, bindings: SlotBindings, feedAssets: FeedAsset[], conflicts: SlotConflict[] = [],
  inputBindingVersion?: number, options: SlotSelectionOptions = {}): SlotSelection[] {
  const byEdge = new Map(feedAssets.map(asset => [asset.edgeId, asset]));
  const seenRoles = new Set<string>();
  const counts = new Map<string, number>();
  const records: SlotSelection[] = [];
  const projectSupply = isVisualGeneration(layout.outputType) && !options.strictMedia;
  const isStrictAssignment = (slot: string, edgeId: string) => options.strictAssignments?.some(item => item.slot === slot && item.edgeId === edgeId);
  for (const [name, occupants] of Object.entries(bindings)) {
    const spec = layout.slots.find(slot => slot.slot === name);
    const seen = new Set<string>();
    const ordered = projectSupply && spec && isMediaInputType(spec.type)
      ? [...occupants].sort((a, b) => resolveSlotOccupantOrdinal(a, byEdge.get(a.edgeId)) - resolveSlotOccupantOrdinal(b, byEdge.get(b.edgeId)))
      : occupants;
    for (const occupant of ordered) {
      if (inputBindingVersion !== 1 && seen.has(occupant.edgeId)) continue;
      seen.add(occupant.edgeId);
      const candidate = byEdge.get(occupant.edgeId);
      const asset = candidate?.sourceNodeId === occupant.sourceNodeId ? candidate : undefined;
      const slot: SlotSpec = spec ?? { slot: name, role: occupant.role ?? '', type: asset?.type ?? '', min: 0, max: null, labelKey: '' };
      const savedConflict = conflicts.some(item => item.slot === name && item.occupant.edgeId === occupant.edgeId);
      const differentRole = occupant.role !== undefined && occupant.role !== spec?.role;
      const incompatibleAsset = asset && !acceptsFeedAsset(slot, asset);
      if (projectSupply && !isStrictAssignment(name, occupant.edgeId) && occupant.use !== 'inactive') {
        // A mode or channel change can leave these bindings in a saved graph.
        // Keep the graph intact and expose only supported assignments for this run.
        if (!spec) continue;
        if ((isMediaInputType(spec.type) || asset && isMediaInputType(asset.type))
          && (differentRole || incompatibleAsset || savedConflict || (counts.get(name) ?? 0) >= (spec.max ?? Infinity))) continue;
      }
      let state: SlotSelection['state'] = 'ready';
      let reasonCode: SlotSelection['reasonCode'];
      if (occupant.use === 'inactive') state = 'inactive';
      else if (!spec) { state = 'invalid'; reasonCode = 'slot_removed'; }
      else if (differentRole
        || (inputBindingVersion === 1 && occupants.filter(item => item.edgeId === occupant.edgeId).length > 1)
        || savedConflict
        || incompatibleAsset) { state = 'invalid'; reasonCode = 'role_conflict'; }
      else if (asset?.availability === 'waiting') { state = 'pending'; reasonCode = 'input_waiting'; }
      else if (!isReadyFeedAsset(asset)) { state = 'invalid'; reasonCode = 'input_unavailable'; }
      if (state === 'ready' || state === 'pending') {
        const identity = JSON.stringify([occupant.sourceNodeId, asset?.outputId ?? occupant.outputId ?? '', slot.role]);
        if (seenRoles.has(identity)) {
          if (inputBindingVersion !== 1) continue;
          state = 'invalid'; reasonCode = 'role_conflict';
        } else seenRoles.add(identity);
      }
      if (state === 'ready' || state === 'pending') {
        const count = (counts.get(name) ?? 0) + 1;
        counts.set(name, count);
        if (!slot.composition && count > (slot.max ?? Infinity)) { state = 'invalid'; reasonCode = 'slot_capacity'; }
      }
      if (inputBindingVersion !== 1 && state !== 'ready') continue;
      records.push({ slot, occupant: { ...occupant,
        ...(inputBindingVersion === 1 && asset?.outputId ? { outputId: asset.outputId } : {}),
      }, ...(asset ? { asset: { ...asset } } : {}), state, ...(reasonCode ? { reasonCode } : {}) });
    }
  }
  records.sort((a, b) => resolveSlotOccupantOrdinal(a.occupant, a.asset) - resolveSlotOccupantOrdinal(b.occupant, b.asset));
  if (!projectSupply) return records;
  // Show repairable missing inputs only in positions left open by ready and
  // scheduled occupants. Obsolete unavailable extras cannot block the run.
  const occupied = new Map<string, number>();
  for (const { slot, state } of records) {
    if (state === 'ready' || state === 'pending') occupied.set(slot.slot, (occupied.get(slot.slot) ?? 0) + 1);
  }
  return records.filter(({ slot, occupant, state }) => {
    if (state !== 'invalid' || !isMediaInputType(slot.type) || isStrictAssignment(slot.slot, occupant.edgeId)) return true;
    const count = occupied.get(slot.slot) ?? 0;
    if (count >= (slot.max ?? Infinity)) return false;
    occupied.set(slot.slot, count + 1);
    return true;
  });
}

export function assembleEffectiveInputsFromSlots(args: {
  layout: SlotLayout;
  bindings: SlotBindings;
  conflicts: SlotConflict[];
  nodeData: { materialType?: string; prompt?: unknown; content?: unknown; inputBindingVersion?: number };
  feedAssets: FeedAsset[];
  incomingText: string[];
  /** User-explicit standby edges never contribute prompt text or unused supply. */
  standbyEdgeIds?: readonly string[];
}): EffectiveSubmitInputs {
  const result: EffectiveSubmitInputs = {
    prompt: args.layout.acceptsText === false ? '' : resolveGenerationPrompt(args.nodeData, args.incomingText), references: [],
    unusedFeedEdgeIds: [], emptyRequiredSlots: [], blockedInputs: [],
  };
  const records = selectSlotOccupants(args.layout, args.bindings, args.feedAssets, args.conflicts, args.nodeData.inputBindingVersion);
  const selections = records.filter(record => record.state === 'ready');
  result.blockedInputs = records.filter(record => record.state === 'pending' || record.state === 'invalid').map(record => ({
    slot: record.slot.slot, edgeId: record.occupant.edgeId, sourceNodeId: record.occupant.sourceNodeId,
    reason: record.reasonCode ?? 'input_unavailable',
  }));
  const textSelections = selections.filter(item => item.slot.type === 'text')
    .sort((a, b) => (a.occupant.ordinal ?? a.asset?.ordinal ?? 0) - (b.occupant.ordinal ?? b.asset?.ordinal ?? 0));
  const textSlot = args.layout.slots.find(slot => slot.type === 'text' && slot.composition);
  const composition = textSlot?.composition;
  if (args.nodeData.inputBindingVersion === 1) {
    const local = textSlot && !textSlot.valueSources?.includes('local_field') ? {} : args.nodeData;
    // Free-text contract parity with effectiveFingerprint: unbound ready text
    // feed assets (connected but occupying no slot, not on standby) join bound
    // texts into the generation prompt.
    const boundEdgeIds = new Set(selections.map((item) => item.occupant.edgeId));
    const standbyEdgeIds = new Set(args.standbyEdgeIds ?? []);
    const freeTexts = !textSlot && args.layout.acceptsText !== false
      ? args.feedAssets.filter((asset) => (asset.type === 'text' || asset.type === 'document' && !args.layout.requireBoundDocuments) && asset.availability === 'ready'
        && asset.textContent?.trim() && !boundEdgeIds.has(asset.edgeId) && !standbyEdgeIds.has(asset.edgeId))
      : [];
    result.prompt = args.layout.acceptsText === false ? '' : resolveGenerationPrompt(local,
      [...textSelections.map(item => item.asset?.textContent), ...freeTexts.map(asset => asset.textContent)], composition);
  }
  const counts = new Map<string, number>();
  const used = new Set(selections.map((item) => item.occupant.edgeId));
  for (const { slot, occupant, asset } of selections) {
    if (slot.type === 'text') {
      counts.set(slot.slot, slot.composition ? Number(Boolean(result.prompt.trim())) : (counts.get(slot.slot) ?? 0) + 1);
      continue;
    }
    const count = (counts.get(slot.slot) ?? 0) + 1;
    counts.set(slot.slot, count);
    const path = asset?.pathOrUrl ?? asset?.url;
    const valid = asset && acceptsFeedAsset(slot, asset) && count <= (slot.max ?? Infinity);
    if (!valid || asset.availability !== 'ready' || !path?.trim() || !isMediaInputType(asset.type)) {
      result.blockedInputs.push({ slot: slot.slot, edgeId: occupant.edgeId, sourceNodeId: occupant.sourceNodeId,
        reason: valid && asset.availability === 'waiting' ? 'input_waiting' : 'input_unavailable' });
      continue;
    }
    const payload: EffectiveSubmitInputs['references'][number] = {
      type: asset.type, role: slot.role as EffectiveSubmitInputs['references'][number]['role'],
      pathOrUrl: path, targetSlot: slot.slot, sourceNodeId: asset.sourceNodeId, edgeId: asset.edgeId,
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      ...(asset.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
      ...(asset.durationSec !== undefined ? { durationSec: asset.durationSec } : {}),
    };
    if (asset.type === 'audio' && slot.role === 'audio_track' && !result.audioTrack) result.audioTrack = payload;
    else result.references.push(payload);
  }
  for (const slot of args.layout.slots) {
    if (slot.type === 'text' && slot.composition && slot.valueSources?.includes('local_field')) {
      counts.set(slot.slot, Number(Boolean(result.prompt.trim())));
    }
  }
  result.emptyRequiredSlots = args.layout.slots.filter((slot) => (counts.get(slot.slot) ?? 0) < slot.min).map((slot) => slot.slot);
  const standbyEdgeIds = new Set(args.standbyEdgeIds ?? []);
  result.unusedFeedEdgeIds = args.feedAssets.filter((asset) => !used.has(asset.edgeId) && !standbyEdgeIds.has(asset.edgeId)).map((asset) => asset.edgeId);
  return result;
}

export const assembleEffectiveInputs = assembleEffectiveInputsFromSlots;
