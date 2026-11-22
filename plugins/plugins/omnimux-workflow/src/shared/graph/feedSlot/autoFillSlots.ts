import { mimeFromFilename } from '../../localMedia.ts';
import { normalizeMimeType } from '../../mediaMetadata.ts';
import type { FeedAsset, FillResult, SlotBindings, SlotLayout, SlotOccupant, SlotSpec } from './types.ts';

export function feedAssetMime(asset: Pick<FeedAsset, 'mimeType' | 'declaredExtension'>): string | undefined {
  const declared = asset.declaredExtension?.replace(/^\./, '');
  return (normalizeMimeType(asset.mimeType) ?? (declared ? mimeFromFilename(`file.${declared}`) : undefined))
    ?.split(';', 1)[0]?.trim().toLowerCase();
}

export function acceptsFeedAsset(slot: SlotSpec, asset: Pick<FeedAsset, 'type' | 'mimeType' | 'declaredExtension' | 'sizeBytes' | 'durationSec'>): boolean {
  const mime = feedAssetMime(asset);
  if (slot.type !== asset.type || (mime && slot.allowedMimes?.length && !slot.allowedMimes.some(value => value.toLowerCase() === mime))) return false;
  if (Number.isFinite(slot.maxSizeMb) && Number.isFinite(asset.sizeBytes)
    && (slot.maxSizeExclusive ? asset.sizeBytes! >= slot.maxSizeMb! * 1024 * 1024 : asset.sizeBytes! > slot.maxSizeMb! * 1024 * 1024)) return false;
  if (Number.isFinite(asset.durationSec) && ((Number.isFinite(slot.minDurationSec) && asset.durationSec! < slot.minDurationSec!)
    || (Number.isFinite(slot.maxDurationSec) && asset.durationSec! > slot.maxDurationSec!))) return false;
  return true;
}

/** Free space in a slot and in its selected line's aggregate input limit. */
export function remainingSlotCapacity(layout: SlotLayout, slot: SlotSpec, occupied: number, typeOccupied: number): number {
  const slotMax = slot.composition ? Infinity : slot.max ?? Infinity;
  const typeMax = layout.inputMaxByType?.[slot.type] ?? Infinity;
  return Math.max(0, Math.min(slotMax - occupied, typeMax - typeOccupied));
}

/** Content eligibility is shared by loading, display and submission. */
export function isReadyFeedAsset(asset: FeedAsset | undefined): asset is FeedAsset {
  if (asset?.type === 'text') return asset.availability === 'ready' && Boolean(asset.textContent?.trim());
  const path = asset?.pathOrUrl ?? asset?.url;
  return asset?.availability === 'ready' && Boolean(path?.trim()) && !path!.trim().startsWith('blob:');
}

/** Preserve explicit choices first; automatically use each supply edge at most once. */
export function autoFillSlots(feedAssets: FeedAsset[], layout: SlotLayout, explicit: SlotBindings = {}, standbyEdgeIds: readonly string[] = []): FillResult {
  const feed = [...feedAssets].sort((a, b) => a.ordinal - b.ordinal);
  const byEdge = new Map(feed.map((asset) => [asset.edgeId, asset]));
  const slots = layout.preset === 'none' ? [] : layout.slots;
  const bindings: SlotBindings = Object.fromEntries(slots.map((slot) => [slot.slot, []]));
  const conflicts: FillResult['conflicts'] = [];
  // Explicit bindings can reuse standby supply; only automatic filling excludes it.
  const reserved = new Set<string>(standbyEdgeIds);
  const used = new Set<string>();
  const usedInputs = new Set<string>();
  const usedRoles = new Set<string>();
  const identity = (asset: FeedAsset) => JSON.stringify([asset.sourceNodeId, asset.outputId ?? '']);
  // A composed text slot consumes multiple ordered text sources even when the
  // contract's physical max is 1: composition is the body, not a media slot.
  const isComposedTextSlot = (slot: SlotSpec | undefined): boolean =>
    slot?.type === 'text' && Boolean(slot.composition);
  const roleIdentity = (asset: FeedAsset, slot: SlotSpec) => JSON.stringify([identity(asset), slot.role]);
  // Two passes give pinned choices precedence even when they occur later in a strip.
  for (const pinned of [true, false]) {
    for (const [name, occupants] of Object.entries(explicit)) {
      const slot = slots.find((candidate) => candidate.slot === name);
      for (const occupant of occupants) {
        if (occupant.pinned !== pinned) continue;
        const asset = byEdge.get(occupant.edgeId);
        if (!asset || asset.sourceNodeId !== occupant.sourceNodeId) {
          if (pinned && slot) bindings[name]!.push({ ...occupant });
          else if (pinned) conflicts.push({ slot: name, occupant: { ...occupant }, reason: 'slot_removed' });
          continue;
        }
        if (!pinned && !isReadyFeedAsset(asset)) continue;
        const next: SlotOccupant = { ...occupant, outputId: asset.outputId };
        const reason = !slot ? 'slot_removed' : slot.type !== asset.type ? 'type_mismatch'
          : !acceptsFeedAsset(slot, asset) ? 'role_illegal' : undefined;
        if (!reason && slot && (usedRoles.has(roleIdentity(asset, slot)) || (!pinned && used.has(asset.edgeId)))) continue;
        const full = slot && !isComposedTextSlot(slot) && bindings[name]!.length >= (slot.max ?? Infinity);
        if (reason || full) {
          if (pinned) {
            conflicts.push({ slot: name, occupant: next, reason: reason ?? 'role_illegal' });
            reserved.add(asset.edgeId);
          }
          continue;
        }
        bindings[name]!.push(next);
        used.add(asset.edgeId);
        usedInputs.add(identity(asset));
        usedRoles.add(roleIdentity(asset, slot!));
      }
    }
  }
  for (const slot of slots) {
    if (conflicts.some((conflict) => conflict.slot === slot.slot)
      || bindings[slot.slot]!.some((occupant) => occupant.pinned && !isReadyFeedAsset(byEdge.get(occupant.edgeId)))) continue;
    for (const asset of feed) {
      if (!isComposedTextSlot(slot) && bindings[slot.slot]!.length >= (slot.max ?? Infinity)) break;
      if (!isReadyFeedAsset(asset) || used.has(asset.edgeId) || usedInputs.has(identity(asset)) || reserved.has(asset.edgeId) || !acceptsFeedAsset(slot, asset)) continue;
      // Role-specific assets must be chosen explicitly, not inferred as masks/control signals.
      if (slot.role === 'mask' || slot.role === 'controlnet') continue;
      bindings[slot.slot]!.push({
        sourceNodeId: asset.sourceNodeId, edgeId: asset.edgeId, outputId: asset.outputId, pinned: false,
      });
      used.add(asset.edgeId);
      usedInputs.add(identity(asset));
      usedRoles.add(roleIdentity(asset, slot));
    }
  }
  return { bindings, conflicts, unusedFeed: feed.filter((asset) => !used.has(asset.edgeId)).map((asset) => ({ ...asset })) };
}

/** Exchange assignments while retaining the destination role and position. */
export function swapNamedSlots(bindings: SlotBindings, first: Pick<SlotSpec, 'slot' | 'role'>, last: Pick<SlotSpec, 'slot' | 'role'>): SlotBindings {
  const next = { ...bindings };
  if (first.slot === last.slot) return next;
  const firstItems = bindings[first.slot] ?? [];
  const lastItems = bindings[last.slot] ?? [];
  next[first.slot] = lastItems.map((value, index) => ({
    ...value, role: first.role, ordinal: firstItems[index]?.ordinal ?? index, pinned: true,
  }));
  next[last.slot] = firstItems.map((value, index) => ({
    ...value, role: last.role, ordinal: lastItems[index]?.ordinal ?? firstItems.length + index, pinned: true,
  }));
  return next;
}
