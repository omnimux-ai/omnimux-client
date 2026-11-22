import type { OperationContractDto } from '../../api.ts';
import { acceptsFeedAsset } from './autoFillSlots.ts';
import { resolveSlotOccupantOrdinal } from './assembleEffectiveInputs.ts';
import type { FeedAsset, SlotBindings, SlotLayout, SlotOccupant } from './types.ts';

export type VideoSlotDrafts = Record<string, SlotBindings>;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOccupant(value: unknown): value is SlotOccupant {
  return record(value) && typeof value.sourceNodeId === 'string' && typeof value.edgeId === 'string';
}

export function readVideoSlotDrafts(value: unknown, disconnected?: ReadonlySet<string>): VideoSlotDrafts {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([mode, draft]) => record(draft)
    ? [[mode, Object.fromEntries(Object.entries(draft).flatMap(([slot, occupants]) => Array.isArray(occupants)
      ? [[slot, occupants.filter((occupant): occupant is SlotOccupant => isOccupant(occupant) && !disconnected?.has(occupant.edgeId))]]
      : []))]] : []));
}

/** A draft belongs to the purpose of this operation, not the price or model ID. */
export function videoSlotDraftKey(operation: OperationContractDto | undefined): string | undefined {
  return operation ? operation.modeKind || operation.id : undefined;
}

export function readVideoOperationDraft(data: Record<string, unknown>, operation: OperationContractDto | undefined): SlotBindings {
  const key = videoSlotDraftKey(operation);
  const drafts = readVideoSlotDrafts(data.videoSlotDrafts);
  return key && Object.hasOwn(drafts, key) ? drafts[key]! : (data.slotBindings ?? {}) as SlotBindings;
}

/** Project the saved order without accepting overflow, changing roles, or adding other supplies. */
export function projectVideoSlotBindings(layout: SlotLayout, feed: FeedAsset[], draft: SlotBindings): SlotBindings {
  const feedById = new Map(feed.map(asset => [asset.edgeId, asset]));
  const usedRoles = new Set<string>();
  return Object.fromEntries(layout.slots.map((slot) => {
    const aliases = layout.slots.filter(other => other.type === slot.type && other.role === slot.role).length === 1
      ? Object.entries(draft).flatMap(([name, values]) => layout.slots.some(other => other.slot === name)
        ? [] : values.filter(occupant => occupant.role === slot.role)) : [];
    const candidates = [...(draft[slot.slot] ?? []), ...aliases].sort((a, b) =>
      resolveSlotOccupantOrdinal(a, feedById.get(a.edgeId)) - resolveSlotOccupantOrdinal(b, feedById.get(b.edgeId)));
    const limit = slot.composition ? Infinity : slot.max ?? Infinity;
    const active: SlotOccupant[] = [];
    for (const occupant of candidates) {
      if (active.length >= limit) break;
      const asset = feedById.get(occupant.edgeId);
      if (!asset || asset.sourceNodeId !== occupant.sourceNodeId || asset.availability === 'unavailable'
        || occupant.use === 'inactive' || (occupant.role && occupant.role !== slot.role)
        || !acceptsFeedAsset(slot, asset)) continue;
      const roleId = JSON.stringify([asset.sourceNodeId, asset.outputId ?? '', slot.role]);
      if (usedRoles.has(roleId)) continue;
      usedRoles.add(roleId);
      active.push({ ...occupant, role: slot.role, ordinal: resolveSlotOccupantOrdinal(occupant, asset),
        ...(asset.outputId ? { outputId: asset.outputId } : {}) });
    }
    return [slot.slot, active];
  }));
}

/** Replace a visible edit without deleting the saved occupants outside the current line's limits. */
export function mergeVideoSlotDraft(draft: SlotBindings, activeBefore: SlotBindings, activeAfter: SlotBindings): SlotBindings {
  const edited = [...Object.entries(activeBefore), ...Object.entries(activeAfter)];
  const replaced = new Set(edited.flatMap(([slot, occupants]) => occupants.flatMap(occupant => [
    JSON.stringify([occupant.edgeId, slot]),
    ...(occupant.role ? [JSON.stringify([occupant.edgeId, '$role', occupant.role])] : []),
  ])));
  return Object.fromEntries([...new Set([...Object.keys(draft), ...Object.keys(activeAfter)])].map(slot => [slot, [
    ...(activeAfter[slot] ?? []),
    ...(draft[slot] ?? []).filter(occupant => !replaced.has(JSON.stringify([occupant.edgeId, slot]))
      && (!occupant.role || !replaced.has(JSON.stringify([occupant.edgeId, '$role', occupant.role])))),
  ]]));
}
