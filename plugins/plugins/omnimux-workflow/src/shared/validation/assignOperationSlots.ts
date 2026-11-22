import {
  acceptsFeedAsset,
  feedAssetMime,
  remainingSlotCapacity,
} from '../graph/feedSlot/autoFillSlots.ts';
import type { SlotSelection } from '../graph/feedSlot/assembleEffectiveInputs.ts';
import type { FeedAsset, SlotBindings, SlotConflict, SlotLayout, SlotOccupant, SlotSpec } from '../graph/feedSlot/types.ts';
import { resolveGenerationPrompt, retainAssignedPromptReferences } from '../graph/generationPrompt.ts';
import { buildUpstreamFingerprint, isMediaInputType, type CompatRejection, type UpstreamFingerprint } from './compatKernel.ts';

export type InputCandidate = FeedAsset & { sourceLabel?: string; availabilityMessage?: string };
export type UnusedReason = 'capacity' | 'type' | 'format' | 'role';
export type UnusedCandidate = InputCandidate & { unusedReason: UnusedReason };

export interface SlotAssignment {
  slot: SlotSpec;
  assigned: InputCandidate[];
  unused: UnusedCandidate[];
  blocked: CompatRejection[];
}

interface SavedIntent {
  slot: string;
  occupant: SlotOccupant;
}

interface CandidatePlacement {
  asset: InputCandidate;
  intent?: SavedIntent;
  scopes: SlotSpec[];
}

export const inputCandidateIdentity = (asset: Pick<InputCandidate, 'sourceNodeId' | 'outputId'>): string =>
  JSON.stringify([asset.sourceNodeId, asset.outputId ?? '']);

function compareCandidates(left: InputCandidate, right: InputCandidate): number {
  return left.ordinal - right.ordinal || String(left.outputId ?? '').localeCompare(String(right.outputId ?? ''));
}

function listCandidates(raw: UpstreamFingerprint): InputCandidate[] {
  return raw.assets.map((asset, ordinal) => ({
    ...asset,
    edgeId: asset.edgeId ?? `feed-${asset.sourceNodeId}-${ordinal}`,
    ordinal: asset.ordinal ?? ordinal,
    availability: asset.availability ?? 'ready',
  }));
}

function collectIntents(saved?: SlotBindings, conflicts: readonly SlotConflict[] = []): SavedIntent[] {
  const intents = Object.entries(saved ?? {}).flatMap(([slot, items]) => items.map(occupant => ({ slot, occupant })));
  const seen = new Set(intents.map(({ slot, occupant }) => JSON.stringify([slot, occupant.edgeId])));
  for (const { slot, occupant } of conflicts) {
    const key = JSON.stringify([slot, occupant.edgeId]);
    if (!seen.has(key)) {
      intents.push({ slot, occupant: { ...occupant, pinned: true } });
      seen.add(key);
    }
  }
  return intents;
}

function matchesIntent(slot: SlotSpec, asset: InputCandidate, wantedSlot?: string, role?: string): boolean {
  if (asset.type !== slot.type && !(asset.type === 'table' && slot.type === 'text' && slot.composition)) return false;
  if (wantedSlot && wantedSlot !== slot.slot) return false;
  return !role || role === slot.role || (role === 'first_frame' && role === slot.firstItemRole);
}

function orderedSlots(scopes: SlotSpec[], asset: InputCandidate, positions: Map<string, SlotSelection[]>): SlotSpec[] {
  if (asset.targetSlot || asset.role) return scopes;
  const required = scopes.filter(slot => slot.role !== 'reference' && positions.get(slot.slot)!.length < slot.min);
  const references = scopes.filter(slot => slot.role === 'reference');
  return [...required, ...references, ...scopes.filter(slot => !required.includes(slot) && !references.includes(slot))];
}

function totalDurationIssue(slot: SlotSpec, assets: readonly InputCandidate[], checkMinimum: boolean): boolean {
  const { totalMinDurationSec: min, totalMaxDurationSec: max } = slot;
  if (max === undefined && (!checkMinimum || min === undefined)) return false;
  if (assets.length === 0 || assets.some(asset => !Number.isFinite(asset.durationSec))) return false;
  const total = assets.reduce((sum, asset) => sum + asset.durationSec!, 0);
  return (max !== undefined && (slot.totalMaxExclusive ? total >= max : total > max))
    || (checkMinimum && min !== undefined && (slot.totalMinExclusive ? total <= min : total < min));
}

function isFreeDocumentSource(layout: SlotLayout, asset: InputCandidate): boolean {
  return asset.type === 'document' && layout.acceptsDocuments === true && !layout.requireBoundDocuments
    && !asset.targetSlot && !asset.role && !layout.slots.some(slot => slot.type === 'document');
}

function isFreePromptSource(layout: SlotLayout, asset: InputCandidate): boolean {
  if (layout.acceptsText === false || asset.targetSlot || asset.role || asset.availability !== 'ready') return false;
  if (asset.type === 'text' || asset.type === 'table') {
    return Boolean(asset.textContent?.trim()) && !layout.slots.some(slot => slot.type === 'text');
  }
  return isFreeDocumentSource(layout, asset) && Boolean(asset.textContent?.trim() || asset.documentText);
}

function pendingRecord(slot: SlotSpec, asset: InputCandidate, intent: SavedIntent | undefined): SlotSelection {
  const ready = asset.availability === 'ready';
  const waiting = asset.availability === 'waiting';
  return {
    slot,
    asset,
    occupant: {
      edgeId: asset.edgeId,
      sourceNodeId: asset.sourceNodeId,
      outputId: asset.outputId,
      pinned: Boolean(intent?.occupant.pinned || asset.targetSlot || asset.role),
      ...(intent?.occupant.use ? { use: intent.occupant.use } : {}),
      ordinal: asset.ordinal,
      role: slot.role,
    },
    state: ready ? 'ready' : waiting ? 'pending' : 'invalid',
    ...(!ready ? { reasonCode: waiting ? 'input_waiting' as const : 'input_unavailable' as const } : {}),
  };
}

/** Assign the complete candidate set to one operation, including incomplete layouts. */
export function assignOperationSlots(layout: SlotLayout, raw: UpstreamFingerprint, options: {
  ignoredEdgeIds?: readonly string[];
  slotBindings?: SlotBindings;
  slotConflicts?: readonly SlotConflict[];
  inputBindingVersion?: number;
} = {}) {
  const candidates = listCandidates(raw);
  const ignored = new Set(options.ignoredEdgeIds ?? []);
  const cleared = options.slotBindings !== undefined && Object.keys(options.slotBindings).length === 0;
  const intents = cleared ? [] : collectIntents(options.slotBindings, options.slotConflicts);
  const byEdge = new Map<string, SavedIntent[]>();
  for (const intent of intents) {
    const entries = byEdge.get(intent.occupant.edgeId);
    if (entries) entries.push(intent);
    else byEdge.set(intent.occupant.edgeId, [intent]);
  }
  const sourcesByEdge = new Map(candidates.map(asset => [asset.edgeId, asset]));
  const missingIntents = new Map<string, Set<string>>();
  for (const { slot, occupant } of intents) {
    if ((!occupant.pinned && occupant.use !== 'inactive') || ignored.has(occupant.edgeId)
      || sourcesByEdge.get(occupant.edgeId)?.sourceNodeId === occupant.sourceNodeId) continue;
    const spec = layout.slots.find(item => item.slot === slot && (!occupant.role || item.role === occupant.role));
    if (!spec) continue;
    const sources = missingIntents.get(occupant.edgeId) ?? new Set<string>();
    if (sources.has(occupant.sourceNodeId)) continue;
    sources.add(occupant.sourceNodeId);
    missingIntents.set(occupant.edgeId, sources);
    candidates.push({ ...occupant, type: spec.type, availability: 'unavailable', ordinal: occupant.ordinal ?? candidates.length });
  }
  const positions = new Map(layout.slots.map(slot => [slot.slot, [] as SlotSelection[]]));
  const unused: UnusedCandidate[] = [];
  const freePrompt: InputCandidate[] = [];
  const unreadableDocuments: InputCandidate[] = [];
  const inactive: SlotSelection[] = [];
  const blocked: CompatRejection[] = [];
  const placed = new Map<string, SlotSelection>();
  const placements: CandidatePlacement[] = [];
  for (const source of candidates) {
    const missingSources = missingIntents.get(source.edgeId);
    if (ignored.has(source.edgeId) || (missingSources && !missingSources.has(source.sourceNodeId))) continue;
    const related = (byEdge.get(source.edgeId) ?? []).filter(item => item.occupant.sourceNodeId === source.sourceNodeId);
    const pinned = related.filter(item => item.occupant.pinned && item.occupant.use !== 'inactive');
    const intent = pinned.find(item => layout.slots.some(slot => matchesIntent(slot, source, item.slot, item.occupant.role))) ?? pinned[0];
    const dormant = related.find(item => item.occupant.use === 'inactive');
    if (!intent && dormant) {
      const slot = layout.slots.find(item => matchesIntent(item, source, dormant.slot, dormant.occupant.role));
      if (slot) inactive.push({ slot, occupant: dormant.occupant, asset: source, state: 'inactive' });
      continue;
    }
    const targetSlot = intent?.slot ?? source.targetSlot;
    const role = intent?.occupant.role ?? source.role;
    const scopes = layout.slots.filter(slot => matchesIntent(slot, source, targetSlot, role)
      && (targetSlot !== undefined || role !== undefined || !['mask', 'controlnet'].includes(slot.role)));
    // A V1 composition with a saved text selection only uses its chosen sources.
    if (!intent && !targetSlot && !role && options.inputBindingVersion === 1 && scopes.some(slot => slot.composition
      && options.slotBindings?.[slot.slot]?.some(occupant => occupant.pinned))) continue;
    if (pinned.filter(item => layout.slots.some(slot => matchesIntent(slot, source, item.slot, item.occupant.role))).length > 1) {
      blocked.push({ code: 'role_conflict', message: '同一份素材占用了多个槽位', slot: targetSlot, meta: { edgeId: source.edgeId } });
    }
    const ordinal = intent?.occupant.ordinal ?? related.find(item => item.slot === scopes[0]?.slot)?.occupant.ordinal ?? source.ordinal;
    placements.push({ asset: { ...source, targetSlot, role, ordinal, mimeType: feedAssetMime(source) }, intent, scopes });
  }
  const priority = (asset: InputCandidate) => asset.targetSlot ? 0 : asset.role ? 1 : 2;
  placements.sort((left, right) => priority(left.asset) - priority(right.asset) || compareCandidates(left.asset, right.asset));
  const occupiedByType = new Map<string, number>();
  for (const { asset, intent, scopes } of placements) {
    const explicit = Boolean(asset.targetSlot || asset.role);
    if (isFreePromptSource(layout, asset) && !placed.has(inputCandidateIdentity(asset))
      && !freePrompt.some(item => inputCandidateIdentity(item) === inputCandidateIdentity(asset))) {
      freePrompt.push(asset);
      continue;
    }
    if (!explicit && asset.availability !== 'ready') {
      if (isFreeDocumentSource(layout, asset)) unreadableDocuments.push(asset);
      continue;
    }
    if (scopes.length === 0) {
      unused.push({ ...asset, unusedReason: explicit ? 'role' : 'type' });
      continue;
    }
    const identity = inputCandidateIdentity(asset);
    const prior = placed.get(identity);
    if (prior && explicit && !scopes.some(slot => slot.slot === prior.slot.slot)) {
      blocked.push({ code: 'role_conflict', message: '同一份素材占用了多个槽位', slot: scopes[0]!.slot, meta: { edgeId: asset.edgeId } });
      unused.push({ ...asset, unusedReason: 'role' });
      continue;
    }
    const matching = orderedSlots(scopes, asset, positions).filter(slot => {
      const assigned = positions.get(slot.slot)!.filter(item => item.state === 'ready').map(item => item.asset!);
      const input = asset.type === 'table' && slot.type === 'text' ? { ...asset, type: slot.type } : asset;
      return acceptsFeedAsset(slot, input) && (asset.availability !== 'ready' || !totalDurationIssue(slot, [...assigned, asset], false));
    });
    const slot = matching.find(item => remainingSlotCapacity(
      layout, item, positions.get(item.slot)!.length, occupiedByType.get(item.type) ?? 0,
    ) > 0);
    if (!slot || prior || cleared) {
      unused.push({ ...asset, unusedReason: matching.length ? 'capacity' : 'format' });
      continue;
    }
    const record = pendingRecord(slot, asset, intent);
    positions.get(slot.slot)!.push(record);
    occupiedByType.set(slot.type, (occupiedByType.get(slot.type) ?? 0) + 1);
    placed.set(identity, record);
  }

  const records = layout.slots.flatMap(slot => positions.get(slot.slot)!.sort((left, right) => compareCandidates(left.asset!, right.asset!)));
  const assignedBySlot = new Map(layout.slots.map(slot => [slot.slot, positions.get(slot.slot)!
    .filter(record => record.state === 'ready')
    .map(({ asset }) => ({ ...asset!, targetSlot: slot.slot, role: slot.role }))]));
  for (const slot of layout.slots) {
    if (totalDurationIssue(slot, assignedBySlot.get(slot.slot)!, true)) {
      blocked.push({ code: 'duration_exceeded', message: '素材总时长不符合槽位要求', slot: slot.slot });
    }
  }
  freePrompt.sort(compareCandidates);
  const textSlot = layout.slots.find(slot => slot.type === 'text' && slot.composition);
  const assets = [...assignedBySlot.values()].flat();
  const localText = layout.acceptsText === false || textSlot && !textSlot.valueSources?.includes('local_field')
    ? '' : retainAssignedPromptReferences(raw.localText ?? raw.prompt, [...assets, ...freePrompt]);
  const composed = [...(textSlot ? assignedBySlot.get(textSlot.slot) ?? [] : []), ...freePrompt]
    .sort(compareCandidates);
  const effectiveFingerprint = buildUpstreamFingerprint({
    ...raw,
    localText,
    prompt: resolveGenerationPrompt({ prompt: localText, materialType: layout.outputType }, composed.map(asset => asset.textContent), textSlot?.composition),
    assets: [...assets, ...freePrompt, ...unreadableDocuments, ...records.filter(record => record.state !== 'ready')
      .map(({ slot, asset }) => ({ ...asset!, targetSlot: slot.slot, role: slot.role }))],
  });
  const allRecords = [...records, ...inactive];
  const bindings: SlotBindings = Object.fromEntries(layout.slots.map(slot => [slot.slot, allRecords
    .filter(record => record.slot === slot)
    .sort((left, right) => compareCandidates(left.asset!, right.asset!))
    .map(record => record.occupant)]));
  return { assigned: [...assets, ...freePrompt], assignedBySlot, unused, blocked, records: allRecords, bindings, effectiveFingerprint };
}

export function countAssignedMedia(assigned: readonly InputCandidate[]): number {
  return assigned.filter(asset => isMediaInputType(asset.type) && asset.targetSlot).length;
}
