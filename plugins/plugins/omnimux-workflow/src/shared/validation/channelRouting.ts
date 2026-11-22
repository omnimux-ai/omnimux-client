export function parseModelAndGroup(input?: unknown): { modelId: string; group: string | null } {
  if (typeof input !== 'string') return { modelId: '', group: null };
  const trimmed = input.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex < 0) return { modelId: trimmed, group: null };
  return { modelId: trimmed.slice(0, atIndex).trim(), group: trimmed.slice(atIndex + 1).trim() || null };
}

function groupId(value: unknown): string | undefined {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id !== 'auto' ? id : undefined;
}

/** Read both saved single-line fields and the historical model suffix. */
export function readChannelRouting(routing: unknown, inlineGroup?: string | null) {
  const row = routing && typeof routing === 'object' && !Array.isArray(routing)
    ? routing as Record<string, unknown> : undefined;
  const channelGroupId = groupId(row?.channelGroupId);
  const legacyGroup = groupId(row?.group);
  const modelGroup = groupId(inlineGroup);
  const allowedGroups = (Array.isArray(row?.allowedGroups) ? row.allowedGroups : []).map(groupId)
    .filter((id): id is string => id !== undefined);
  const requestedGroups = [...new Set([channelGroupId, ...allowedGroups, legacyGroup, modelGroup]
    .filter((id): id is string => id !== undefined))];
  const rawStrategy = row?.strategy;
  const strategy: 'auto' | 'cost_first' | 'stability_first' | undefined =
    rawStrategy === 'auto' || rawStrategy === 'cost_first' || rawStrategy === 'stability_first' ? rawStrategy : undefined;
  return { channelGroupId, allowedGroups, requestedGroups, strategy, sourceType: row?.sourceType,
    pinnedGroup: channelGroupId ?? legacyGroup ?? modelGroup };
}

type ChannelRouteOption = {
  id: string;
  wireGroup?: string;
  default?: boolean;
  category?: string;
  sourceType?: string;
  isAvailable?: boolean;
  enabled?: boolean;
};

export function isByokGroup(groupOrId?: string | { id?: string; category?: string; sourceType?: string } | null): boolean {
  if (typeof groupOrId === 'string') return groupOrId.startsWith('byok-');
  return Boolean(groupOrId && (groupOrId.category === 'byok' || groupOrId.sourceType === 'byok' || groupOrId.id?.startsWith('byok-')));
}

export function isChannelGroupAvailable(group: Pick<ChannelRouteOption, 'enabled' | 'isAvailable'>): boolean {
  return group.enabled !== false && group.isAvailable !== false;
}

/** The hub resolves compatibility defaults against the gateway order. */
export function findDefaultChannelGroup<T extends ChannelRouteOption>(groups: readonly T[]): T | undefined {
  const defaults = groups.filter(group => group.default === true && isChannelGroupAvailable(group) && !isByokGroup(group));
  return defaults.length === 1 ? defaults[0] : undefined;
}

export function findSelectedChannelGroup<T extends ChannelRouteOption>(
  groups: readonly T[], routing: unknown, inlineGroup?: string | null, requireConsistentSelection = false,
): T | undefined {
  const { requestedGroups, sourceType } = readChannelRouting(routing, inlineGroup);
  if (!requestedGroups.length) return;
  const available = groups.filter(group => isChannelGroupAvailable(group) && (sourceType !== 'byok' || isByokGroup(group)));
  const matches = requestedGroups.map(id => {
    const exact = groups.find(group => group.id === id);
    return exact ? available.filter(group => group === exact) : available.filter(group => group.wireGroup === id);
  });
  if (!requireConsistentSelection) return matches.find(candidates => candidates.length)?.[0];
  const consistent = available.filter(group => matches.every(candidates => candidates.includes(group)));
  return consistent.length === 1 ? consistent[0] : undefined;
}
