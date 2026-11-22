import type { Edge } from '@xyflow/react';
import type { CapabilityCatalog } from '../api.ts';
import type { CanvasInputMutationState, CanvasMutationRuntimeContext, CanvasNode } from './canvasInputMutationGateway.ts';
import type { MaterialType } from '../canvasTypes.ts';
import type { MaterialNodeData } from './materialNode.ts';
import { buildCanvasUpstreamFingerprint, readCanvasParams } from './canvasInputSources.ts';
import {
  buildContractView, buildUpstreamFingerprint, isOrderedImageReferenceSlot, isVisualGeneration, mapLegacyOperation,
  planAutoAdaptation, resolveModelView, type UpstreamFingerprint,
} from '../validation/compatKernel.ts';
import { parseModelAndGroup } from '../validation/channelRouting.ts';
import { findDeclaredParameterFailure } from '../validation/declaredParameterValidation.ts';
import { readVisualLineSelection } from '../validation/executionReadiness.ts';
import { resolveInputAssignment, type InputAssignment, type InputAssignmentArgs } from '../validation/inputAssignment.ts';
import { managedVideoLinePricingFingerprint } from '../validation/managedVideoExecution.ts';
import { deriveSlotLayout } from './feedSlot/deriveSlotLayout.ts';
import { projectCanvasInputSources } from './feedSlot/legacyH3Slots.ts';
import type { SlotBindings, SlotConflict, SlotOccupant, SlotSpec } from './feedSlot/types.ts';
import {
  effectiveVideoAssetFields, narrowCatalogByRouting, narrowModelByLineConstraints, requiredEffectiveVideoParameter,
  resolveEffectiveVideoGroup, resolveEffectiveVideoOperation, transitionEffectiveVideoParams, type EffectiveVideoGroupSelection,
} from '../validation/lineConstraints.ts';
import { mergeVideoSlotDraft, readVideoSlotDrafts, videoSlotDraftKey } from './feedSlot/videoSlotDrafts.ts';

/** Plan a default line and its parameters together. A missing or unusable default leaves the draft alone. */
export function planDefaultVisualLineParams(catalog: CapabilityCatalog, outputType: MaterialType,
  params: Record<string, unknown>, migrateRetiredLine: boolean): Record<string, unknown> | undefined {
  if (!isVisualGeneration(outputType)) return;
  const line = readVisualLineSelection(catalog, params);
  if (!line?.defaultGroup || line.selected || (line.hasRequest && (!migrateRetiredLine || line.hasAvailableRequest))) return;
  const { model, defaultGroup: group } = line;
  if (!model.operations?.some(op => op.listed === true && op.output?.type === outputType)) return;
  const routing = { strategy: 'auto', allowedGroups: [group.id] };
  if (outputType === 'video' && model.effectiveVideoVersion !== undefined) {
    const quotedRouting = { ...routing, channelGroupId: group.id, sourceType: 'official', videoLineQuote: managedVideoLinePricingFingerprint(group) };
    const next = transitionEffectiveVideoParams(catalog, { model, group }, { ...params, model: model.id }, quotedRouting);
    if (!next) return;
    let operation = resolveEffectiveVideoOperation(group, next.operation, next);
    if (line.hasRequest && next.operation === params.operation) {
      // Keep draft values the new line accepts for this mode. Each addition must fit a whole variant.
      for (const field of Object.keys(operation?.parameters ?? {})) {
        const value = params[field];
        if (value === undefined || value === null || value === '') continue;
        const compatible = resolveEffectiveVideoOperation(group, next.operation, { ...next, [field]: value });
        if (!compatible) continue;
        next[field] = value;
        operation = compatible;
      }
    }
    if (typeof next.operation === 'string' && !operation) return;
    if (line.hasRequest && (!operation || requiredEffectiveVideoParameter(operation, next))) return;
    return next;
  }

  const narrowed = narrowModelByLineConstraints(model, model.id, group.constraints);
  const operations = (narrowed.operations ?? []).filter(op => op.listed === true && op.output?.type === outputType);
  const recommended = catalog.defaultOperations?.[outputType];
  const operation = operations.find(op => op.id === params.operation || op.aliases?.includes(String(params.operation)))
    ?? (recommended?.modelId === model.id ? operations.find(op => op.id === recommended.operationId) : undefined)
    ?? (operations.length === 1 ? operations[0] : undefined);
  if (operations.length === 0 || (params.operation && !operation)) return;
  const modelParameters: Record<string, unknown> = { ...narrowed.parameters };
  const definitions = { ...modelParameters, ...operation?.parameters } as Record<string, { defaultValue?: unknown }>;
  const next: Record<string, unknown> = { ...params, model: model.id, routing, ...(operation && params.operation ? { operation: operation.id } : {}) };
  for (const [field, rule] of Object.entries(group.constraints?.parameters ?? {})) {
    if (!rule) continue;
    if (rule.supported === false) {
      delete next[field];
    } else if (rule.fixed !== undefined) {
      next[field] = rule.fixed;
    } else if (rule.only && !rule.only.some(value => Object.is(value, next[field]))) {
      const fallback = rule.only.length === 1 ? rule.only[0] : definitions[field]?.defaultValue;
      if (fallback === undefined || !rule.only.some(value => Object.is(value, fallback))) return;
      next[field] = fallback;
    }
  }
  const possibleOperations = operation ? [operation] : operations;
  if (possibleOperations.some(op => findDeclaredParameterFailure(next, op.parameters, modelParameters))) return;
  return next;
}

function keepUnresolvedVisualDraft(catalog: CapabilityCatalog | null | undefined, params: Record<string, unknown>, outputType: unknown): boolean {
  if (outputType !== 'image' && outputType !== 'video') return false;
  if (!catalog?.fingerprint && !catalog?.models?.length) return true;
  const line = readVisualLineSelection(catalog, params);
  return Boolean(line && !line.selected && (line.hasRequest || line.managed));
}

function isClear(bindings: SlotBindings | undefined): boolean {
  return bindings !== undefined && Object.keys(bindings).length === 0;
}

function pruneDisconnected(bindings: SlotBindings | undefined, disconnected: ReadonlySet<string>): SlotBindings | undefined {
  if (!bindings || !disconnected.size) return bindings;
  return Object.fromEntries(Object.entries(bindings).map(([slot, occupants]) => [slot,
    occupants.filter(occupant => !disconnected.has(occupant.edgeId))]));
}

function bindingKey(slot: string, occupant: SlotOccupant): string {
  return JSON.stringify([slot, occupant.edgeId, occupant.sourceNodeId]);
}

/** A saved pin identifies the user's choice; records and snapshots carry the current output. */
function preservePinnedOutputIds(bindings: SlotBindings, args: InputAssignmentArgs): SlotBindings {
  const savedOutputIds = new Map<string, string | undefined>();
  const remember = (slot: string, occupant: SlotOccupant) => {
    if (occupant.pinned || occupant.use === 'inactive') savedOutputIds.set(bindingKey(slot, occupant), occupant.outputId);
  };
  for (const { slot, occupant } of args.slotConflicts ?? []) remember(slot, occupant);
  for (const [slot, occupants] of Object.entries(args.slotBindings ?? {})) {
    for (const occupant of occupants) remember(slot, occupant);
  }
  return Object.fromEntries(Object.entries(bindings).map(([slot, occupants]) => [slot, occupants.map(occupant => {
    const key = bindingKey(slot, occupant);
    const outputId = savedOutputIds.get(key);
    if (!savedOutputIds.has(key) || outputId === occupant.outputId) return occupant;
    const saved = { ...occupant };
    if (outputId === undefined) delete saved.outputId;
    else saved.outputId = outputId;
    return saved;
  })]));
}

/** Persist user intent separately when it does not fit the selected layout. */
function parkUnassignedIntents(saved: SlotBindings | undefined, conflicts: readonly SlotConflict[], active: SlotBindings): SlotConflict[] {
  const assigned = new Set(Object.entries(active).flatMap(([slot, occupants]) => occupants.map(occupant => bindingKey(slot, occupant))));
  const parked = new Map<string, SlotConflict>();
  for (const conflict of conflicts) {
    const key = bindingKey(conflict.slot, conflict.occupant);
    if (!assigned.has(key)) parked.set(key, conflict);
  }
  for (const [slot, occupants] of Object.entries(saved ?? {})) {
    for (const occupant of occupants) {
      const key = bindingKey(slot, occupant);
      if ((occupant.pinned || occupant.use === 'inactive') && !assigned.has(key) && !parked.has(key)) {
        parked.set(key, { slot, occupant, reason: 'slot_inactive' });
      }
    }
  }
  return [...parked.values()];
}

function isSingleStartImage(slot: SlotSpec): boolean {
  return slot.type === 'image' && slot.role === 'first_frame' && slot.max === 1;
}

/** Give historical ties distinct ranks in the order saved by the editor. */
function preserveOrderedRanks(args: InputAssignmentArgs, operation: string): InputAssignmentArgs {
  const layout = deriveSlotLayout(args.catalog, args.modelId ?? undefined, operation);
  const slot = layout.slots.find(isOrderedImageReferenceSlot);
  const occupants = slot && args.slotBindings?.[slot.slot];
  if (!slot || !occupants?.length) return args;
  const feedOrder = new Map(args.fingerprint.assets.map(asset => [asset.edgeId, asset.ordinal]));
  const ranked = occupants.map((occupant, index) => ({ occupant, ordinal: occupant.ordinal ?? feedOrder.get(occupant.edgeId) ?? index }));
  ranked.sort((left, right) => left.ordinal - right.ordinal);
  let last = -1;
  const ordered = ranked.map(({ occupant, ordinal }) => {
    last = Math.max(last + 1, ordinal);
    return { ...occupant, ordinal: last };
  });
  return { ...args, slotBindings: { ...args.slotBindings, [slot.slot]: ordered } };
}

/** A manual switch between single and ordered start-image modes carries the chosen start image. */
function transferOrderedStart(args: InputAssignmentArgs, priorCatalog: CapabilityCatalog | null | undefined,
  fromOperation: string, toOperation: string): InputAssignmentArgs {
  const before = deriveSlotLayout(priorCatalog, args.modelId ?? undefined, fromOperation);
  const after = deriveSlotLayout(args.catalog, args.modelId ?? undefined, toOperation);
  const fromOrdered = before.slots.find(isOrderedImageReferenceSlot);
  const toOrdered = after.slots.find(isOrderedImageReferenceSlot);
  if (Boolean(fromOrdered) === Boolean(toOrdered)) return args;
  const from = fromOrdered ?? before.slots.find(isSingleStartImage);
  const to = toOrdered ?? after.slots.find(isSingleStartImage);
  if (!from || !to) return args;

  const priorArgs = preserveOrderedRanks({ ...args, catalog: priorCatalog, forceOperationId: fromOperation }, fromOperation);
  const prior = resolveInputAssignment(priorArgs);
  const priorBindings = preservePinnedOutputIds(prior.bindings, priorArgs);
  const records = prior.records.filter(record => record.slot.slot === from.slot);
  const start = records.find(record => record.state === 'ready');
  const saved = { ...args.slotBindings };
  const destination = saved[to.slot] ?? [];
  const moveStart = start && !destination.some(occupant => occupant.use !== 'inactive');
  const transferred = records.filter(record => record.state === 'inactive' || (moveStart && record === start));
  if (!transferred.length) return args;
  const moved = new Set(transferred.map(record => record.occupant.edgeId));
  const oldOccupants = saved[from.slot];
  if (oldOccupants) saved[from.slot] = oldOccupants.filter(occupant => !moved.has(occupant.edgeId));
  const nextOccupants = [...transferred.map(({ occupant }) => {
    const savedPin = priorBindings[from.slot]?.find(item => item.edgeId === occupant.edgeId && item.sourceNodeId === occupant.sourceNodeId);
    return { ...(savedPin ?? occupant), role: to.role, pinned: true };
  }), ...destination.filter(occupant => !moved.has(occupant.edgeId))];
  saved[to.slot] = nextOccupants;
  const conflicts = (args.slotConflicts ?? []).filter(conflict => conflict.slot !== from.slot || !moved.has(conflict.occupant.edgeId));
  if (moveStart && toOrdered) {
    // The start leads, followed by saved choices, then by connected supply. Paused choices keep their position after active images.
    const startId = start.occupant.edgeId;
    const staged = [...nextOccupants, ...conflicts.filter(conflict => conflict.slot === to.slot).map(conflict => conflict.occupant)];
    const trailing = staged.filter(occupant => occupant.edgeId !== startId && occupant.use !== 'inactive')
      .sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0));
    const ordinals = new Map(trailing.map((occupant, index) => [occupant.edgeId, index + 1]));
    const assets = args.fingerprint.assets.map((asset, index) => asset.type !== 'image' ? asset : {
      ...asset, ordinal: (asset.ordinal ?? index) + trailing.length + 1,
    });
    let last = Math.max(trailing.length, ...assets.map(asset => asset.ordinal ?? -1));
    for (const occupant of staged) if (occupant.use === 'inactive') ordinals.set(occupant.edgeId, ++last);
    const applyRank = (occupant: SlotOccupant): SlotOccupant => ({ ...occupant, ordinal: ordinals.get(occupant.edgeId) ?? 0 });
    return { ...args, fingerprint: buildUpstreamFingerprint({ ...args.fingerprint, assets }),
      slotBindings: { ...saved, [to.slot]: nextOccupants.map(applyRank) },
      slotConflicts: conflicts.map(conflict => conflict.slot === to.slot
        ? { ...conflict, occupant: applyRank(conflict.occupant) } : conflict) };
  }
  return { ...args, slotBindings: saved, slotConflicts: conflicts };
}

function readManagedVideoDraft(node: CanvasNode, directory: CapabilityCatalog | null | undefined,
  managed: EffectiveVideoGroupSelection, params: Record<string, unknown>, previous: CanvasNode | undefined,
  disconnected: ReadonlySet<string>, bindings: SlotBindings | undefined,
) {
  const variant = resolveEffectiveVideoOperation(managed.group, params.operation, params);
  const key = videoSlotDraftKey(variant);
  const priorParams = previous ? readCanvasParams(previous) : params;
  const priorManaged = resolveEffectiveVideoGroup(directory, priorParams.model, priorParams.routing);
  const priorOperation = resolveEffectiveVideoOperation(priorManaged?.group, priorParams.operation, priorParams)
    ?? priorManaged?.model.operations?.find(operation => operation.id === priorParams.operation);
  const priorKey = videoSlotDraftKey(priorOperation);
  const drafts = readVideoSlotDrafts(node.data.videoSlotDrafts, disconnected);
  const priorBindings = pruneDisconnected((previous ? previous.data.slotBindings : node.data.slotBindings) as SlotBindings | undefined, disconnected);
  if (priorKey && priorBindings && !Object.hasOwn(drafts, priorKey)) {
    Object.defineProperty(drafts, priorKey, { value: priorBindings, enumerable: true, configurable: true, writable: true });
  }
  const assetDrafts: NonNullable<MaterialNodeData['videoAssetFieldDrafts']> = {
    ...(node.data.videoAssetFieldDrafts as MaterialNodeData['videoAssetFieldDrafts']),
  };
  if (priorKey) {
    const saved = Object.fromEntries(effectiveVideoAssetFields(priorOperation).flatMap(field =>
      typeof priorParams[field] === 'string' ? [[field, priorParams[field]]] : []));
    if (Object.keys(saved).length) Object.defineProperty(assetDrafts, priorKey, {
      value: { ...assetDrafts[priorKey], ...saved }, enumerable: true, configurable: true, writable: true,
    });
  }
  if (key) {
    const saved = Object.fromEntries(effectiveVideoAssetFields(variant).flatMap(field => {
      const value = params[field] ?? assetDrafts[key]?.[field];
      if (typeof value !== 'string') return [];
      params[field] = value;
      return [[field, value]];
    }));
    if (Object.keys(saved).length) Object.defineProperty(assetDrafts, key, {
      value: { ...assetDrafts[key], ...saved }, enumerable: true, configurable: true, writable: true,
    });
  }

  let draft = key && Object.hasOwn(drafts, key) ? drafts[key] : !priorKey || key === priorKey ? bindings : undefined;
  const priorDraft = key === priorKey ? draft ?? priorBindings : undefined;
  if (key && key === priorKey && previous && previous.data.slotBindings !== node.data.slotBindings) {
    draft = isClear(bindings) ? bindings : mergeVideoSlotDraft(draft ?? {}, priorBindings ?? {}, bindings ?? {});
  }
  return { variant, key, drafts, assetDrafts, draft, priorBindings: priorDraft };
}

/** Initialize unspecified choices only; supply changes cannot replace a saved creative choice. */
export function recomputeCanvasSlots(node: CanvasNode, graph: CanvasInputMutationState, context: CanvasMutationRuntimeContext,
  previous?: CanvasNode, newEdgeIds: ReadonlySet<string> = new Set(), disconnected: ReadonlySet<string> = new Set(),
  preservedOperationId?: string): CanvasNode {
  let params = { ...readCanvasParams(node) };
  const outputType = node.data.materialType as MaterialType;
  const directory = context.catalog;
  if (isVisualGeneration(outputType) && !directory?.fingerprint && !directory?.models?.length) {
    // A pending replacement catalog does not change the saved line, slots or draft.
    if (directory) return node;
    return { ...node, data: { ...node.data, compat: {
      status: 'configuration_error', acceptsCurrentInputs: false, readyToSubmit: false,
      reasonCodes: ['catalog_unavailable'], fingerprint: '', catalogFingerprint: '',
    } } };
  }
  const hadModel = Boolean(params.model);
  if (!hadModel && directory) {
    const raw = buildCanvasUpstreamFingerprint(node.id, graph.nodes, graph.edges);
    const recommended = directory.defaultOperations?.[outputType];
    const pick = planAutoAdaptation({ catalog: directory, outputType, preferredModelId: context.preferredModels?.[outputType],
      currentOperationId: typeof params.operation === 'string' ? params.operation : undefined,
      fingerprint: buildUpstreamFingerprint({ ...raw, assets: raw.assets.filter((asset) => asset.type === 'text') }) });
    if (pick) {
      params.model = pick.modelId;
      const recommendedId = recommended?.modelId === pick.modelId
        && resolveModelView(buildContractView(directory), pick.modelId)?.operations.some((op) => op.id === recommended.operationId
          && op.listed && op.output.type === outputType)
        ? recommended.operationId : undefined;
      params.operation ??= recommendedId ?? pick.operationId;
    }
  }
  if ((!previous || !hadModel) && directory) params = planDefaultVisualLineParams(directory, outputType, params, false) ?? params;
  if (keepUnresolvedVisualDraft(directory, params, outputType)) {
    return hadModel ? node : { ...node, data: { ...node.data, params } };
  }

  const incoming = graph.edges.filter(edge => edge.target === node.id);
  const live = new Set(incoming.map(edge => edge.id));
  const removed = new Set([...disconnected].filter(id => !live.has(id)));
  const added = new Set(incoming.filter(edge => newEdgeIds.has(edge.id)).map(edge => edge.id));
  const catalog = narrowCatalogByRouting(directory, params.model, params.routing, params);
  const modelRef = isVisualGeneration(outputType) ? parseModelAndGroup(params.model)
    : { modelId: typeof params.model === 'string' ? params.model : undefined, group: undefined };
  const model = resolveModelView(buildContractView(catalog), modelRef.modelId);
  if (model && !modelRef.group) params.model = model.id;
  const projected = projectCanvasInputSources(node.id, { ...node.data, params }, graph.nodes, graph.edges, catalog, model);
  const data = { ...projected.data };
  const edited = previous !== undefined && previous.data.slotBindings !== node.data.slotBindings;
  const priorParams = previous ? readCanvasParams(previous) : {};
  const priorOp = mapLegacyOperation(typeof priorParams.operation === 'string' ? priorParams.operation : undefined);
  const savedOp = mapLegacyOperation(typeof params.operation === 'string' ? params.operation : undefined);
  const autoOperationId = typeof data.autoOperationId === 'string' || data.autoOperationId === null ? data.autoOperationId : undefined;
  const recommended = catalog?.defaultOperations?.[outputType];
  const systemChosen = !hadModel && autoOperationId !== null || autoOperationId === savedOp
    || autoOperationId === undefined && (recommended?.modelId === model?.id && recommended?.operationId === savedOp
      || outputType === 'text' && data.inputBindingVersion !== 1 && savedOp === 'chat');
  const managed = outputType === 'video' ? resolveEffectiveVideoGroup(directory, params.model, params.routing) : null;
  let saved = pruneDisconnected(data.slotBindings as SlotBindings | undefined, removed);
  let conflicts = (data.slotConflicts as SlotConflict[] | undefined ?? []).filter(conflict => !removed.has(conflict.occupant.edgeId));
  const priorModelId = parseModelAndGroup(priorParams.model).modelId;
  const sameModel = Boolean(model && (model.id === priorModelId || priorModelId && model.aliases.includes(priorModelId)));
  const lipMode = model?.id === 'minimax-h3-video' && savedOp === 'digital_human';
  const cached = data.parkedLipSyncInputs as MaterialNodeData['parkedLipSyncInputs'];
  const restoredLip = lipMode && sameModel && priorOp === 'text_to_video' && cached?.model === model?.id && !edited;
  if (restoredLip && cached) {
    saved = pruneDisconnected(cached.bindings, removed);
    conflicts = (cached.conflicts ?? []).filter(conflict => !removed.has(conflict.occupant.edgeId));
    data.inputBindingVersion = 1;
  }
  if (model?.id === 'minimax-h3-video' && savedOp === 'text_to_video') {
    const park = sameModel && priorOp === 'digital_human' && previous?.data.slotBindings
      ? { model: model.id, bindings: previous.data.slotBindings as SlotBindings, conflicts: previous.data.slotConflicts as SlotConflict[] | undefined }
      : cached;
    if (park?.model === model.id) data.parkedLipSyncInputs = { ...park,
      bindings: pruneDisconnected(park.bindings, removed)!, conflicts: park.conflicts?.filter(conflict => !removed.has(conflict.occupant.edgeId)) };
  } else {
    delete data.parkedLipSyncInputs;
  }

  const video = managed ? readManagedVideoDraft(node, directory, managed, params, previous, removed, saved) : undefined;
  if (video) {
    // The selected line and its complete variant govern managed nodes, even when other modes could consume more.
    if (!video.variant) return { ...node, data: { ...node.data, params } };
    saved = video.draft;
    for (const [key, draft] of Object.entries(video.drafts)) {
      if (key !== video.key) conflicts = parkUnassignedIntents(draft, conflicts, saved ?? {});
    }
  }
  const priorBindings = video ? video.priorBindings : restoredLip ? saved : previous?.data.slotBindings as SlotBindings | undefined;
  const standby = new Set((Array.isArray(data.slotStandbyEdgeIds) ? data.slotStandbyEdgeIds : [])
    .filter((id): id is string => typeof id === 'string' && !removed.has(id)));
  const raw = projected.fingerprint;
  const opensClear = (isClear(saved) || isClear(priorBindings)) && (added.size > 0 || (edited && !isClear(saved) && saved !== undefined));
  const staysClear = !opensClear && isClear(saved);
  if (opensClear) {
    // Reserve earlier supply when opening a previously cleared map. A picker may explicitly reactivate an old edge.
    const selected = new Set(Object.values(saved ?? {}).flat().filter(occupant => occupant.pinned).map(occupant => occupant.edgeId));
    for (const edge of incoming) if (!added.has(edge.id) && !selected.has(edge.id)) standby.add(edge.id);
    if (isClear(saved)) saved = undefined;
  }
  const lipLayout = lipMode ? deriveSlotLayout(catalog, model?.id, savedOp) : undefined;
  if (lipLayout?.acceptsText === false && saved && !staysClear) {
    // Older H3 canvases can save an intentionally empty voice or portrait independently of the other slot.
    const emptyTypes = new Set(lipLayout.slots.filter(slot => (restoredLip || Object.hasOwn(saved, slot.slot))
      && !saved[slot.slot]?.some(occupant => !standby.has(occupant.edgeId))).map(slot => slot.type));
    for (const asset of raw.assets) if (asset.edgeId && !added.has(asset.edgeId) && emptyTypes.has(asset.type)) standby.add(asset.edgeId);
  }
  if (standby.size || Array.isArray(data.slotStandbyEdgeIds)) data.slotStandbyEdgeIds = [...standby];
  let args: InputAssignmentArgs = {
    catalog, modelId: model?.id ?? modelRef.modelId, outputType, params,
    fingerprint: buildUpstreamFingerprint({ ...raw, nodeFields: params }),
    preferredOperationId: systemChosen ? undefined : savedOp || undefined, autoOperationId,
    forceOperationId: video?.variant?.id ?? preservedOperationId,
    slotBindings: saved, slotConflicts: staysClear ? [] : conflicts, ignoredEdgeIds: [...standby],
    inputBindingVersion: data.inputBindingVersion === 1 ? 1 : undefined,
    deferVisualPrompt: false,
  };
  if (savedOp) args = preserveOrderedRanks(args, savedOp);
  if (added.size) {
    // A newly drawn edge belongs after saved ranks even when disconnects have shortened the feed ordinals.
    let lastOrdinal = Object.values(args.slotBindings ?? {}).flat().reduce((max, occupant) => Math.max(max, occupant.ordinal ?? -1), -1);
    for (const asset of raw.assets) if (!asset.edgeId || !added.has(asset.edgeId)) lastOrdinal = Math.max(lastOrdinal, asset.ordinal ?? -1);
    const composition = args.inputBindingVersion === 1
      ? deriveSlotLayout(catalog, args.modelId ?? undefined, args.forceOperationId ?? savedOp).slots.find(slot =>
        slot.type === 'text' && slot.composition && args.slotBindings?.[slot.slot]?.some(occupant => occupant.pinned))
      : undefined;
    const assets = args.fingerprint.assets.map(asset => {
      if (!asset.edgeId || !added.has(asset.edgeId)) return asset;
      const ordinal = ++lastOrdinal;
      // Drawing a new text edge appends to an explicitly composed prompt, while old unselected text stays unused.
      if (composition && asset.type === 'text' && asset.availability === 'ready' && !asset.targetSlot && !asset.role) {
        return { ...asset, ordinal, targetSlot: composition.slot };
      }
      return { ...asset, ordinal };
    });
    args = { ...args, fingerprint: buildUpstreamFingerprint({ ...args.fingerprint, assets }) };
  }
  if (!video && sameModel && priorOp && savedOp && priorOp !== savedOp && autoOperationId === null && !staysClear) {
    const priorCatalog = narrowCatalogByRouting(directory, priorParams.model, priorParams.routing, priorParams);
    args = transferOrderedStart(args, priorCatalog, priorOp, savedOp);
  }
  const assignment = resolveInputAssignment(args);
  const operationId = assignment.operationId;
  if (operationId) {
    params.operation = operationId;
    if (!video && !preservedOperationId && (systemChosen || !savedOp || outputType === 'image' || operationId !== savedOp)) {
      if (data.autoOperationId !== null || operationId !== savedOp) data.autoOperationId = operationId;
    }
    let bindings = preservePinnedOutputIds(assignment.bindings, args);
    const eligible = raw.assets.some(asset => !asset.edgeId || !standby.has(asset.edgeId));
    if (staysClear || (!video && !lipMode && !eligible && !Object.values(bindings).some(occupants => occupants.length))) bindings = {};
    if (lipLayout?.acceptsText === false && !staysClear) {
      bindings = Object.fromEntries(Object.entries(bindings).filter(([slot, occupants]) => occupants.length > 0
        || saved?.[slot]?.length === 0 || lipLayout.slots.some(spec => spec.slot === slot && raw.assets.some(asset =>
          asset.type === spec.type && asset.edgeId && standby.has(asset.edgeId)))));
    }
    const parked = parkUnassignedIntents(args.slotBindings, staysClear ? conflicts : args.slotConflicts ?? [], bindings);
    // A slotless operation can still have supply or intent that fits a future operation.
    if (!staysClear && isClear(bindings) && (eligible || parked.length)) delete data.slotBindings;
    else data.slotBindings = bindings;
    data.slotConflicts = parked;
    if (video?.key) {
      const draft = mergeVideoSlotDraft(args.slotBindings ?? {}, {}, bindings);
      if (data.slotBindings !== undefined || Object.values(draft).some(occupants => occupants.length)) {
        Object.defineProperty(video.drafts, video.key, { value: draft, enumerable: true, configurable: true, writable: true });
      } else {
        delete video.drafts[video.key];
      }
      data.videoSlotDrafts = video.drafts;
      if (Object.keys(video.assetDrafts).length) data.videoAssetFieldDrafts = video.assetDrafts;
      data.inputBindingVersion = 1;
    }
  }
  return { ...node, data: { ...data, params, compat: canvasCompatibility(assignment, catalog) } };
}

function canvasCompatibility(assignment: InputAssignment, catalog: CapabilityCatalog | null | undefined) {
  const { operationId } = assignment;
  const reasonCode = assignment.reasonCode === 'unknown_model' ? 'not_listed' : assignment.reasonCode;
  return {
    status: operationId ? 'ok' : 'configuration_error',
    acceptsCurrentInputs: operationId ? assignment.operationMatches.get(operationId)?.accepts ?? false : false,
    readyToSubmit: assignment.ready,
    operation: operationId,
    reasonCodes: [...new Set(assignment.blocked.length ? assignment.blocked.map(issue => issue.code) : reasonCode ? [reasonCode] : [])],
    fingerprint: assignment.fingerprint,
    catalogFingerprint: catalog?.fingerprint ?? '',
  };
}

/** Best-effort mirror for old readers; original edge intent remains authoritative. */
export function mirrorCanvasSlots(node: CanvasNode, edges: Edge[], context: CanvasMutationRuntimeContext): Edge[] {
  const params = readCanvasParams(node);
  if (keepUnresolvedVisualDraft(context.catalog, params, node.data.materialType)) return edges;
  const catalog = narrowCatalogByRouting(context.catalog, params.model, params.routing, params);
  const modelId = parseModelAndGroup(params.model).modelId;
  const layout = deriveSlotLayout(catalog, modelId, typeof params.operation === 'string' ? params.operation : undefined);
  const bindings = (node.data.slotBindings ?? {}) as SlotBindings;
  return edges.map(edge => {
    if (edge.target !== node.id) return edge;
    const mirror = edge.data?.slotBinding as { slot?: string; role?: string; type?: string; mirror?: boolean } | undefined;
    if (mirror && mirror.mirror !== true) return edge;
    const slot = layout.slots.find(item => bindings[item.slot]?.some(occupant => occupant.edgeId === edge.id
      && occupant.sourceNodeId === edge.source && occupant.use !== 'inactive'));
    if (slot && mirror?.slot === slot.slot && mirror.role === slot.role && mirror.type === slot.type || !slot && !mirror) return edge;
    const data = { ...edge.data };
    if (slot) data.slotBinding = { slot: slot.slot, role: slot.role, type: slot.type, mirror: true };
    else delete data.slotBinding;
    return { ...edge, data };
  });
}
