import { acceptsFeedAsset, feedAssetMime, remainingSlotCapacity } from '../graph/feedSlot/autoFillSlots.ts';
import type { SlotSelection } from '../graph/feedSlot/assembleEffectiveInputs.ts';
import type { SlotLayout, SlotSpec } from '../graph/feedSlot/types.ts';
import type { UpstreamAssetFingerprint } from './compatKernel.ts';

export interface SlotIntentContext {
  targetNodeId: string;
  modelId: string;
  operationId: string;
  routing: string;
  mode: string;
  contractFingerprint: string;
}

export interface SlotIntentTarget {
  slot: string;
  role?: string;
  replaceEdgeId?: string;
}

/** Session state for an explicit add or replacement action. */
export interface SlotIntent extends SlotIntentContext {
  slot: string;
  role: string;
  replacement?: { edgeId: string; sourceNodeId: string; outputId?: string };
}

export interface SlotIntentState {
  context: SlotIntentContext;
  layout: SlotLayout;
  records: readonly SlotSelection[];
}

export type SlotIntentReason = 'input_changed' | 'input_waiting' | 'input_unavailable' | 'input_already_bound'
  | 'role_conflict' | 'slot_capacity' | 'mime_unknown' | 'mime_unsupported' | 'size_exceeded' | 'duration_exceeded';

type IntentRejection = { accepted: false; reasonCode: SlotIntentReason };
export type SlotIntentAvailability = IntentRejection | {
  accepted: true;
  spec: SlotSpec;
  remaining: number;
  replacement?: SlotSelection;
  retained: SlotSelection[];
};

function slotSpec(layout: SlotLayout, target: SlotIntentTarget): SlotSpec | undefined {
  if (layout.displayOnlyFromOperation && layout.outputType !== 'image') return;
  const matches = layout.slots.filter(spec => spec.slot === target.slot);
  const [spec] = matches;
  if (matches.length === 1 && spec && (target.role === undefined || spec.role === target.role)) return spec;
}

function replacementOf(records: readonly SlotSelection[], slot: string, edgeId: string): SlotSelection | undefined {
  const matches = records.filter(record => record.slot.slot === slot && record.occupant.edgeId === edgeId);
  return matches.length === 1 ? matches[0] : undefined;
}

export function captureSlotIntent(state: SlotIntentState, target: SlotIntentTarget): SlotIntent | undefined {
  const spec = slotSpec(state.layout, target);
  if (!spec) return;
  const replacement = target.replaceEdgeId ? replacementOf(state.records, spec.slot, target.replaceEdgeId)?.occupant : undefined;
  if (target.replaceEdgeId && !replacement) return;
  const intent: SlotIntent = { ...state.context, slot: spec.slot, role: spec.role,
    ...(replacement ? { replacement: { edgeId: replacement.edgeId, sourceNodeId: replacement.sourceNodeId, outputId: replacement.outputId } } : {}) };
  const available = readSlotIntent(state, intent);
  if (available.accepted && available.remaining > 0) return intent;
}

export function readSlotIntent(state: SlotIntentState, intent: SlotIntent): SlotIntentAvailability {
  const { context } = state;
  if (context.targetNodeId !== intent.targetNodeId || context.modelId !== intent.modelId
    || context.operationId !== intent.operationId || context.routing !== intent.routing || context.mode !== intent.mode
    || context.contractFingerprint !== intent.contractFingerprint) return { accepted: false, reasonCode: 'input_changed' };
  const spec = slotSpec(state.layout, intent);
  if (!spec) return { accepted: false, reasonCode: 'input_changed' };
  const previous = intent.replacement;
  const replacement = previous ? replacementOf(state.records, spec.slot, previous.edgeId) : undefined;
  if (previous && (replacement?.occupant.sourceNodeId !== previous.sourceNodeId
    || replacement?.occupant.outputId !== previous.outputId)) return { accepted: false, reasonCode: 'input_changed' };
  const active = state.records.filter(record => record.state !== 'inactive' && record !== replacement);
  const retained = active.filter(record => record.slot.slot === spec.slot);
  const typeOccupied = active.filter(record => record.slot.type === spec.type).length;
  const remaining = remainingSlotCapacity(state.layout, spec, retained.length, typeOccupied);
  return { accepted: true, spec, remaining: previous ? Math.min(remaining, 1) : remaining, replacement, retained };
}

export function slotIntentNeedsDuration(spec: SlotSpec): boolean {
  return [spec.minDurationSec, spec.maxDurationSec, spec.totalMinDurationSec, spec.totalMaxDurationSec].some(Number.isFinite);
}

function knownNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function candidateFailure(spec: SlotSpec, candidate: UpstreamAssetFingerprint): SlotIntentReason | undefined {
  if (candidate.availability !== 'ready') return candidate.availability === 'waiting' ? 'input_waiting' : 'input_unavailable';
  if (spec.type !== candidate.type || candidate.role && candidate.role !== spec.role
    || candidate.targetSlot && candidate.targetSlot !== spec.slot) return 'role_conflict';
  const mime = feedAssetMime(candidate);
  if (spec.allowedMimes?.length) {
    if (!mime) return 'mime_unknown';
    if (!acceptsFeedAsset(spec, { type: candidate.type, mimeType: mime })) return 'mime_unsupported';
  }
  if (Number.isFinite(spec.maxSizeMb) && !knownNumber(candidate.sizeBytes)) return 'size_exceeded';
  if (slotIntentNeedsDuration(spec) && !knownNumber(candidate.durationSec)) return 'duration_exceeded';
  if (acceptsFeedAsset(spec, candidate)) return;
  return acceptsFeedAsset(spec, { ...candidate, durationSec: undefined }) ? 'duration_exceeded' : 'size_exceeded';
}

/** G3 checks just the named slot. While editing, a partial batch can still grow to its total-duration minimum. */
export function validateSlotIntent(state: SlotIntentState, intent: SlotIntent, candidates: readonly UpstreamAssetFingerprint[],
  { partial = false }: { partial?: boolean } = {}): { accepted: true } | IntentRejection {
  const slot = readSlotIntent(state, intent);
  if (!slot.accepted) return slot;
  if (candidates.length === 0) return { accepted: false, reasonCode: 'input_unavailable' };
  if (candidates.length > slot.remaining) return { accepted: false, reasonCode: 'slot_capacity' };
  const used = new Set(state.records.filter(record => record.state !== 'inactive').map(({ occupant }) =>
    JSON.stringify([occupant.sourceNodeId, occupant.outputId ?? ''])));
  for (const candidate of candidates) {
    const failure = candidateFailure(slot.spec, candidate);
    if (failure) return { accepted: false, reasonCode: failure };
    const identity = JSON.stringify([candidate.sourceNodeId, candidate.outputId ?? '']);
    if (used.has(identity)) return { accepted: false, reasonCode: 'input_already_bound' };
    used.add(identity);
  }
  const { totalMinDurationSec: min, totalMaxDurationSec: max, totalMinExclusive, totalMaxExclusive } = slot.spec;
  if (max !== undefined || !partial && min !== undefined) {
    const durations = [...slot.retained.filter(record => record.state === 'ready').map(record => record.asset?.durationSec),
      ...candidates.map(candidate => candidate.durationSec)];
    if (!durations.every(knownNumber)) return { accepted: false, reasonCode: 'duration_exceeded' };
    const total = durations.reduce((sum, duration) => sum + duration, 0);
    if ((max !== undefined && (totalMaxExclusive ? total >= max : total > max))
      || (!partial && min !== undefined && (totalMinExclusive ? total <= min : total < min))) {
      return { accepted: false, reasonCode: 'duration_exceeded' };
    }
  }
  return { accepted: true };
}
