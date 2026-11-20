import type { Edge } from '@xyflow/react';
import type { CanvasInputMutationState, CanvasMutationRuntimeContext, CanvasNode } from './canvasInputMutationGateway.ts';
import type { MaterialType } from '../canvasTypes.ts';
import type { MaterialNodeData } from './materialNode.ts';
import { readCanvasParams } from './canvasInputSources.ts';
import { buildContractView, buildUpstreamFingerprint, isMediaInputType, isOrderedImageReferenceSlot, matchOperationInputs, planAutoAdaptation, resolveModelView } from '../validation/compatKernel.ts';
import { buildInputCapability } from '../validation/inputCapability.ts';
import { autoFillSlots, deriveSlotLayout, hydrateSlotBindings, type FeedAsset, type SlotBindings, type SlotConflict, type SlotLayout, type SlotOccupant, type SlotSpec } from './feedSlot/index.ts';
import { acceptsFeedAsset } from './feedSlot/autoFillSlots.ts';
import { effectiveSlotFingerprint, feedFromFingerprint } from './feedSlot/effectiveFingerprint.ts';
import { effectiveInputDisplay } from './feedSlot/effectiveInputDisplay.ts';
import { resolveSlotOccupantOrdinal } from './feedSlot/assembleEffectiveInputs.ts';
import { projectCanvasInputSources } from './feedSlot/legacyH3Slots.ts';
import { resolveSlotOperation } from './feedSlot/resolveSlotOperation.ts';
import { effectiveVideoAssetFields, narrowCatalogByRouting, resolveEffectiveVideoGroup, type EffectiveVideoGroupSelection } from '../validation/lineConstraints.ts';
import { mergeVideoSlotDraft, projectVideoSlotBindings, readVideoSlotDrafts, videoSlotDraftKey } from './feedSlot/videoSlotDrafts.ts';

function isSingleStartImage(slot: SlotSpec): boolean {
  return slot.type === 'image' && slot.role === 'first_frame' && slot.max === 1;
}

function refillDisconnectedSlots(layout: SlotLayout, feed: FeedAsset[], bindings: SlotBindings,
  vacancies: ReadonlyMap<string, number>, standby: readonly string[]): void {
  const slots = layout.slots.flatMap(slot => {
    const priorCount = vacancies.get(slot.slot);
    return priorCount === undefined ? [] : [{ ...slot, max: Math.min(priorCount, slot.max ?? Infinity) }];
  });
  const scoped = Object.fromEntries(slots.map(slot => [slot.slot, (bindings[slot.slot] ?? []).filter(item => item.use !== 'inactive')]));
  const activeEdges = new Set(Object.values(scoped).flat().map(item => item.edgeId));
  const assignedSources = new Set(Object.values(bindings).flat().map(item => item.sourceNodeId));
  const eligible = feed.filter(asset => activeEdges.has(asset.edgeId) || !assignedSources.has(asset.sourceNodeId));
  const { bindings: planned } = autoFillSlots(eligible, { ...layout, slots }, scoped, standby);
  for (const [slot, occupants] of Object.entries(planned)) {
    const added = occupants.filter(item => !activeEdges.has(item.edgeId));
    if (added.length) bindings[slot] = [...(bindings[slot] ?? []), ...added];
  }
}

function recomputeEffectiveVideoSlots(node: CanvasNode, graph: CanvasInputMutationState, context: CanvasMutationRuntimeContext,
  managed: EffectiveVideoGroupSelection, params: Record<string, unknown>, previous: CanvasNode | undefined,
  newEdgeIds: ReadonlySet<string>, disconnected: ReadonlySet<string>): CanvasNode {
  const catalog = narrowCatalogByRouting(context.catalog, managed.model.id, params.routing, params);
  const operation = catalog?.models?.find(model => model.id === managed.model.id)?.operations?.find(item => item.id === params.operation);
  const key = videoSlotDraftKey(operation);
  const priorParams = previous ? readCanvasParams(previous) : params;
  const priorCatalog = narrowCatalogByRouting(context.catalog, priorParams.model, priorParams.routing, priorParams);
  const priorModel = priorCatalog?.models?.find(model => model.id === priorParams.model || model.aliases?.includes(String(priorParams.model)));
  const priorOperation = priorModel?.operations?.find(item => item.id === priorParams.operation)
    ?? context.catalog?.models?.find(model => model.id === priorParams.model)?.operations?.find(item => item.id === priorParams.operation);
  const priorKey = videoSlotDraftKey(priorOperation);
  const drafts = readVideoSlotDrafts(node.data.videoSlotDrafts, disconnected);
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
    const saved = Object.fromEntries(effectiveVideoAssetFields(operation).flatMap(field => {
      const value = params[field] ?? assetDrafts[key]?.[field];
      if (typeof value !== 'string') return [];
      params[field] = value;
      return [[field, value]];
    }));
    if (Object.keys(saved).length) Object.defineProperty(assetDrafts, key, {
      value: { ...assetDrafts[key], ...saved }, enumerable: true, configurable: true, writable: true,
    });
  }
  const previousBindings = (previous?.data.slotBindings ?? node.data.slotBindings ?? {}) as SlotBindings;
  const editedBindings = (node.data.slotBindings ?? {}) as SlotBindings;
  if (priorKey && !Object.hasOwn(drafts, priorKey)) {
    const priorConflicts = ((previous?.data.slotConflicts ?? node.data.slotConflicts ?? []) as SlotConflict[])
      .filter(conflict => !disconnected.has(conflict.occupant.edgeId));
    const previousDraft = Object.fromEntries(Object.entries(previousBindings).map(([slot, values]) =>
      [slot, values.filter(occupant => !disconnected.has(occupant.edgeId))]));
    for (const conflict of priorConflicts) {
      const occupants = previousDraft[conflict.slot] ??= [];
      if (!occupants.some(occupant => occupant.edgeId === conflict.occupant.edgeId)) occupants.push(conflict.occupant);
    }
    Object.defineProperty(drafts, priorKey, { value: previousDraft, enumerable: true, configurable: true, writable: true });
  }

  const feed = feedFromFingerprint(projectCanvasInputSources(node.id, node.data, graph.nodes, graph.edges, context.catalog, undefined).fingerprint, 1);
  const layout = deriveSlotLayout(catalog, managed.model.id, operation?.id);
  let active: SlotBindings = {};
  if (key) {
    let draft = Object.hasOwn(drafts, key) ? drafts[key]! : {};
    if (previous && key === priorKey && previous.data.slotBindings !== node.data.slotBindings) {
      const priorLayout = deriveSlotLayout(priorCatalog, priorModel?.id, priorOperation?.id);
      draft = mergeVideoSlotDraft(draft, projectVideoSlotBindings(priorLayout, feed, draft), editedBindings);
    }
    active = projectVideoSlotBindings(layout, feed, draft);
    if (newEdgeIds.size) {
      // Only the new connection is eligible for automatic assignment in this mode.
      const activeIds = new Set(Object.values(active).flat().map(occupant => occupant.edgeId));
      const eligible = feed.filter(asset => activeIds.has(asset.edgeId) || newEdgeIds.has(asset.edgeId));
      const standby = Array.isArray(node.data.slotStandbyEdgeIds) ? node.data.slotStandbyEdgeIds as string[] : [];
      const added = autoFillSlots(eligible, layout, active, standby).bindings;
      for (const asset of eligible) {
        if (asset.availability !== 'waiting' || !newEdgeIds.has(asset.edgeId) || activeIds.has(asset.edgeId) || standby.includes(asset.edgeId)) continue;
        const slot = layout.slots.find(candidate => candidate.role !== 'mask' && candidate.role !== 'controlnet'
          && (candidate.composition || (added[candidate.slot]?.length ?? 0) < (candidate.max ?? Infinity))
          && acceptsFeedAsset(candidate, asset));
        if (slot) (added[slot.slot] ??= []).push({ sourceNodeId: asset.sourceNodeId, edgeId: asset.edgeId,
          outputId: asset.outputId, role: slot.role, pinned: false });
      }
      for (const slot of layout.slots) {
        const occupants = added[slot.slot] ?? [];
        const preceding = draft[slot.slot] ?? [];
        let ordinal = preceding.reduce((max, occupant) => Math.max(max, occupant.ordinal ?? -1), -1) + 1;
        const next = occupants.filter(occupant => newEdgeIds.has(occupant.edgeId)
          && !preceding.some(saved => saved.edgeId === occupant.edgeId));
        if (next.length) draft[slot.slot] = [...preceding, ...next.map(occupant => ({ ...occupant, role: slot.role, ordinal: ordinal++ }))];
      }
      active = projectVideoSlotBindings(layout, feed, draft);
    }
    Object.defineProperty(drafts, key, { value: draft, enumerable: true, configurable: true, writable: true });
  }
  return { ...node, data: {
    ...node.data, params, videoSlotDrafts: drafts, ...(Object.keys(assetDrafts).length ? { videoAssetFieldDrafts: assetDrafts } : {}),
    slotBindings: active, slotConflicts: [], inputBindingVersion: 1,
  } };
}

/** Initialize unspecified choices only; supply changes cannot replace a saved creative choice. */
export function recomputeCanvasSlots(node: CanvasNode, graph: CanvasInputMutationState, context: CanvasMutationRuntimeContext,
  previous?: CanvasNode, newEdgeIds: ReadonlySet<string> = new Set(), disconnected: ReadonlySet<string> = new Set()): CanvasNode {
  const params = { ...readCanvasParams(node) };
  // A narrow line accepts far less than the contract publishes; narrowing the routed model
  // once here keeps the slot layout, the operation list and the parameter view aligned.
  const catalog = narrowCatalogByRouting(context.catalog, params.model, params.routing, params);
  const outputType = node.data.materialType as MaterialType;
  const managed = outputType === 'video' ? resolveEffectiveVideoGroup(context.catalog, params.model, params.routing) : null;
  if (managed) return recomputeEffectiveVideoSlots(node, graph, context, managed, params, previous, newEdgeIds, disconnected);
  const currentVersion = node.data.inputBindingVersion === 1;
  const view = buildContractView(catalog);
  const savedModel = typeof params.model === 'string' ? resolveModelView(view, params.model) : undefined;
  const projected = projectCanvasInputSources(node.id, node.data, graph.nodes, graph.edges, catalog, savedModel);
  if (projected.data !== node.data) node = { ...node, data: projected.data };
  if (projected.edges !== graph.edges) graph = { ...graph, edges: projected.edges };
  const raw = projected.fingerprint;
  if (!params.model && catalog) {
    const recommended = catalog.defaultOperations?.[outputType];
    const pick = planAutoAdaptation({ catalog, outputType, preferredModelId: context.preferredModels?.[outputType],
      currentOperationId: typeof params.operation === 'string' ? params.operation : undefined,
      fingerprint: buildUpstreamFingerprint({ ...raw, assets: raw.assets.filter((asset) => asset.type === 'text') }) });
    if (pick) {
      params.model = pick.modelId;
      const recommendedId = recommended?.modelId === pick.modelId
        && resolveModelView(view, pick.modelId)?.operations.some((op) => op.id === recommended.operationId
          && op.listed && op.output.type === outputType)
        ? recommended.operationId : undefined;
      params.operation ??= recommendedId ?? pick.operationId;
    }
  }
  const defaultManaged = outputType === 'video' ? resolveEffectiveVideoGroup(context.catalog, params.model, params.routing) : null;
  if (defaultManaged) return recomputeEffectiveVideoSlots(node, graph, context, defaultManaged, params, previous, newEdgeIds, disconnected);
  const model = savedModel ?? resolveModelView(view, typeof params.model === 'string' ? params.model : undefined);
  if (model) params.model = model.id;
  const modelRecommendation = catalog?.defaultOperations?.[outputType];
  const recommendedId = modelRecommendation?.modelId === model?.id ? modelRecommendation?.operationId : undefined;
  const savedOperation = typeof params.operation === 'string' && params.operation.trim() ? params.operation.trim() : undefined;
  const legacyChat = !currentVersion && outputType === 'text' && savedOperation === 'chat';
  const savedOp = savedOperation && model
    ? model.operations.find((op) => op.id === savedOperation && op.listed && op.output.type === outputType)
    : undefined;
  // 系统写入的生成方式不是用户的创作选择：节点数据 autoOperationId 记录来源（string = 系统推导，
  // null = 用户拍板，undefined = 历史节点来源未知，仅当模式恰好等于该产出类型的目录推荐值时才按系统写入对待）。
  const autoOperationId = typeof node.data.autoOperationId === 'string' || node.data.autoOperationId === null
    ? node.data.autoOperationId as string | null
    : undefined;
  const systemChosen = autoOperationId === undefined
    ? Boolean(savedOperation && savedOperation === recommendedId)
    : autoOperationId === savedOperation;
  // 仅当已就绪的上游媒体当前模式吸收不了时才改写；用户拍板过的模式与无素材场景都不受影响。
  const strandedBySupply = Boolean(savedOp && !matchOperationInputs(savedOp, raw).accepts
    && raw.assets.some((asset) => isMediaInputType(asset.type) && asset.availability === 'ready'));
  let autoDerived: string | undefined;
  let selectableBeforeInputs = false;
  const preferredOperationId = systemChosen ? undefined : savedOperation;
  if (outputType === 'video' && model) {
    // Epic #63: video operation follows the connected media. The capability
    // layer keeps the saved operation only while it is usable (R3), switches
    // to the deterministic best candidate otherwise, and falls back to the
    // family default after every media edge is removed (R6).
    const capability = buildInputCapability({
      catalog,
      modelId: model.id,
      outputType: 'video',
      fingerprint: raw,
      ...(preferredOperationId ? { preferredOperationId } : {}),
      autoOperationId,
      ignoredEdgeIds: Array.isArray(node.data.slotStandbyEdgeIds)
        ? (node.data.slotStandbyEdgeIds as string[])
        : [],
    });
    if (capability.selectedOperationId && capability.selectedOperationId !== savedOperation) {
      params.operation = capability.selectedOperationId;
      autoDerived = capability.selectedOperationId;
    }
    selectableBeforeInputs = capability.operationStates.some(state => state.id === params.operation && state.selectableBeforeInputs);
  } else if ((!savedOperation || legacyChat || (systemChosen && strandedBySupply)) && model) {
    // A node without a saved mode starts in the catalog's recommended one — the mode that
    // consumes upstream media, so its slots exist from the first render. A saved mode, an
    // explicit connection or a user pick is never replaced here.
    const recommended = recommendedId && model.operations.some((op) => op.id === recommendedId && op.listed && op.output.type === outputType)
      ? recommendedId : undefined;
    params.operation = resolveSlotOperation(catalog, model.id, systemChosen && strandedBySupply ? undefined : params.operation, outputType, raw) ?? recommended;
    if (typeof params.operation === 'string' && params.operation) autoDerived = params.operation;
  }
  const operation = model?.operations.find((op) => op.id === params.operation && op.listed && op.output.type === outputType);
  const permitted = Boolean(model);
  const layout = deriveSlotLayout(catalog, model?.id, operation?.id);
  const slotByName = new Map(layout.slots.map(slot => [slot.slot, slot]));
  const feed = feedFromFingerprint(raw, currentVersion ? 1 : undefined);
  const plainSpeech = !currentVersion && outputType === 'audio' && params.operation === 'text_to_speech';
  const priorParams = previous ? readCanvasParams(previous) : {};
  const cached = node.data.parkedLipSyncInputs as MaterialNodeData['parkedLipSyncInputs'];
  const sameModel = model && model.id === priorParams.model;
  const restoring = selectableBeforeInputs && sameModel && priorParams.operation === 'text_to_video'
    && params.operation === 'digital_human' && cached?.model === model.id
    && node.data.slotBindings === previous?.data.slotBindings ? cached : undefined;
  const standbyIds = Array.isArray(node.data.slotStandbyEdgeIds) ? node.data.slotStandbyEdgeIds.filter((id): id is string => typeof id === 'string') : [];
  const excludedOnRestore = restoring && model?.id === 'minimax-h3-video' ? new Set(standbyIds) : undefined;
  let storedConflicts = restoring ? restoring.conflicts?.filter(conflict => !excludedOnRestore?.has(conflict.occupant.edgeId))
    : node.data.slotConflicts as SlotConflict[] | undefined;
  let explicit = plainSpeech ? {} : restoring?.bindings ?? node.data.slotBindings as SlotBindings | undefined;
  if (!currentVersion && outputType === 'text' && explicit && Object.keys(explicit).length === 0 && (!node.data.slotStandbyEdgeIds || (node.data.slotStandbyEdgeIds as unknown[]).length === 0)) {
    explicit = undefined;
  }
  const modeChanged = previous && (priorParams.operation !== params.operation || priorParams.model !== params.model);
  let transferredStartSlot: string | undefined;
  let transferredInactive: SlotOccupant[] = [];
  if (sameModel && modeChanged && autoOperationId === null && params.operation === savedOperation
    && typeof priorParams.operation === 'string') {
    const priorCatalog = narrowCatalogByRouting(context.catalog, priorParams.model, priorParams.routing);
    const priorLayout = deriveSlotLayout(priorCatalog, model.id, priorParams.operation);
    const priorOrderedImages = priorLayout.slots.find(isOrderedImageReferenceSlot);
    const nextOrderedImages = layout.slots.find(isOrderedImageReferenceSlot);
    const from = priorOrderedImages ?? (nextOrderedImages ? priorLayout.slots.find(isSingleStartImage) : undefined);
    const to = nextOrderedImages ?? (priorOrderedImages ? layout.slots.find(isSingleStartImage) : undefined);
    if (from && to && Boolean(priorOrderedImages) !== Boolean(nextOrderedImages)) {
      const loaded = effectiveInputDisplay(priorLayout, feed, explicit, storedConflicts,
        graph.edges.filter(edge => edge.target === node.id), standbyIds, currentVersion ? 1 : undefined);
      const start = loaded.selected.find(record => record.slot.slot === from.slot);
      const rest = { ...explicit };
      delete rest[from.slot];
      if (start && !rest[to.slot]?.length) {
        rest[to.slot] = [{ ...start.occupant, role: to.role, pinned: true, ordinal: 0 }];
      }
      transferredInactive = loaded.records.filter(record => record.slot.slot === from.slot && record.state === 'inactive'
        && !rest[to.slot]?.some(occupant => occupant.edgeId === record.occupant.edgeId))
        .map(record => ({ ...record.occupant, role: to.role }));
      transferredStartSlot = to.slot;
      explicit = rest;
      storedConflicts = storedConflicts?.filter(conflict => conflict.slot !== from.slot);
    }
  }
  const verifiedH3Lip = selectableBeforeInputs && model?.id === 'minimax-h3-video' && params.operation === 'digital_human';
  // A return to a previously configured mode is an explicit user edit. Freeze exactly its
  // earlier choices so subsequent legacy auto-fill cannot substitute other connected media.
  const upgradeRestored = !currentVersion && verifiedH3Lip && Boolean(restoring);
  const savedClears = !modeChanged && !newEdgeIds.size && verifiedH3Lip && explicit !== undefined
    && (Object.keys(explicit).length === 0 || Object.values(explicit).some(occupants => occupants.length === 0));
  const useSavedSlots = currentVersion || upgradeRestored || savedClears;
  const keepSavedLipSlots = selectableBeforeInputs && params.operation === 'digital_human'
    && useSavedSlots && (!modeChanged || (verifiedH3Lip && Boolean(restoring)));
  // A V1 occupant is authoritative only while its source node and edge still exist on the
  // canvas. Unpinned (auto-filled) occupants whose supply vanished are junk that must be
  // pruned here, otherwise the stale binding keeps re-persisting and the node stays blocked
  // as `input_unavailable`. Keep invalid pinned intent for repair unless the user
  // removed its connection in this mutation.
  const liveNodeIds = new Set(graph.nodes.map((item) => item.id));
  const liveEdgeSource = new Map(
    graph.edges.filter((edge) => edge.target === node.id).map((edge) => [edge.id, edge.source]),
  );
  const isLiveOccupant = (occupant: SlotOccupant): boolean =>
    Boolean(occupant.sourceNodeId) && liveNodeIds.has(occupant.sourceNodeId)
    && Boolean(occupant.edgeId) && liveEdgeSource.get(occupant.edgeId as string) === occupant.sourceNodeId;
  const wasDisconnected = (occupant: SlotOccupant) => disconnected.has(occupant.edgeId) && !isLiveOccupant(occupant);
  if (disconnected.size) storedConflicts = storedConflicts?.filter(conflict => !wasDisconnected(conflict.occupant));
  const parkedSlots: SlotConflict[] = [];
  const restoredSlots: SlotConflict[] = [];
  storedConflicts = storedConflicts?.filter(conflict => {
    if (conflict.reason !== 'slot_inactive') return true;
    const spec = slotByName.get(conflict.slot);
    if (spec && (!conflict.occupant.role || spec.role === conflict.occupant.role)) restoredSlots.push(conflict);
    else parkedSlots.push(conflict);
    return false;
  });
  const autoStandby = [...standbyIds, ...parkedSlots.map(conflict => conflict.occupant.edgeId)];
  if (explicit) {
    const vacancies = new Map<string, number>();
    if (useSavedSlots && !modeChanged && disconnected.size) {
      for (const [slot, occupants] of Object.entries(explicit)) {
        const active = occupants.filter(occupant => occupant.use !== 'inactive');
        if (active.some(occupant => !occupant.pinned && wasDisconnected(occupant))) vacancies.set(slot, active.length);
      }
    }
    explicit = Object.fromEntries(Object.entries(explicit)
      .map(([slot, occupants]) => [slot,
        occupants
          .filter((occupant) => !excludedOnRestore?.has(occupant.edgeId)
            && !wasDisconnected(occupant)
            && (useSavedSlots ? (isLiveOccupant(occupant) || occupant.pinned) : (!modeChanged || occupant.pinned)))
          .map((occupant) => ({ ...occupant }))] as const)
      // Drop slots emptied by pruning so the node does not keep a `{slot: []}` residue
      // that reads as an explicit user-clear to downstream readers.
      .filter(([slot, occupants]) => occupants.length > 0 || (keepSavedLipSlots && explicit?.[slot]?.length === 0)));
    for (const conflict of (plainSpeech ? [] : [...(storedConflicts ?? []), ...restoredSlots])) {
      const occupants = explicit[conflict.slot] ??= [];
      if (!occupants.some((item) => item.edgeId === conflict.occupant.edgeId)) occupants.push({ ...conflict.occupant });
    }
    // Only new edges may carry a picker hint. Stale edge mirrors never override node slots.
    const newEdges = graph.edges.filter((edge) => edge.target === node.id && newEdgeIds.has(edge.id));
    for (const edge of newEdges) {
      const asset = feed.find((item) => item.edgeId === edge.id);
      if (!asset) continue;
      if (useSavedSlots) {
        // V1 plain connects carry no picker hint. A composed text slot is the
        // one slot that consumes every new text source as ordered body text;
        // append it instead of letting max=1 replace the earlier source.
        const textSlot = layout.slots.find((slot) => slot.type === 'text' && slot.composition);
        if (asset.type === 'text') {
          if (!textSlot || !explicit || Object.keys(explicit).length === 0) continue;
          const values = explicit[textSlot.slot] ?? [];
          if (values.some((occupant) => occupant.edgeId === edge.id && occupant.sourceNodeId === asset.sourceNodeId)) continue;
          const ordinal = values.reduce((max, item) => Math.max(max, item.ordinal ?? -1), -1) + 1;
          explicit[textSlot.slot] = [...values, { sourceNodeId: asset.sourceNodeId, edgeId: edge.id,
            outputId: asset.outputId, ordinal, role: textSlot.role, pinned: true }];
          continue;
        }
        // Media: a newly connected supply edge is a new user action and must
        // land in a free accepting slot. Existing explicit choices stay put;
        // only the new edge is copied from the auto-fill plan (a cleared slot
        // must not be silently refilled from older supply).
        if (!explicit) continue;
        const planned = autoFillSlots(feed, layout, explicit, autoStandby);
        for (const [slotName, occupants] of Object.entries(planned.bindings)) {
          for (const occupant of occupants) {
            if (occupant.edgeId !== edge.id) continue;
            const current = explicit[slotName] ?? [];
            if (current.some((item) => item.edgeId === occupant.edgeId && item.sourceNodeId === occupant.sourceNodeId)) continue;
            const slot = layout.slots.find(candidate => candidate.slot === slotName);
            if (slot && isOrderedImageReferenceSlot(slot)) {
              // Keep the new connection after the saved order, even if removing an older edge shortened feed ordinals.
              occupant.ordinal = current.reduce((max, item) => Math.max(max,
                resolveSlotOccupantOrdinal(item, feed.find(asset => asset.edgeId === item.edgeId))), -1) + 1;
            }
            explicit[slotName] = [...current, occupant];
          }
        }
        continue;
      }
      if (!asset.targetSlot && !asset.role) continue;
      const slot = asset.targetSlot ? layout.slots.find((item) => item.slot === asset.targetSlot)
        : layout.slots.find((item) => item.role === asset.role && item.type === asset.type);
      const hint = slot?.slot ?? asset.targetSlot ?? `role:${asset.role}`;
      const occupant = { sourceNodeId: asset.sourceNodeId, edgeId: asset.edgeId, outputId: asset.outputId, pinned: true };
      explicit[hint] = slot?.type === 'text' && slot.composition
        ? [...(explicit[hint] ?? []), occupant]
        : slot?.max === 1 ? [occupant] : [...(explicit[hint] ?? []), occupant];
    }
    if (vacancies.size) refillDisconnectedSlots(layout, feed, explicit, vacancies, autoStandby);
  }
  // A missing V1 `slotBindings` means "not initialized yet", not "the user cleared every slot": the display
  // side self-heals such a node by auto-filling, so the store must persist that same fill. Leaving `{}` behind
  // splits the two readers — the panel shows a filled slot while submission skips the fill and drops the asset
  // silently. An explicit `{}` (a user clear, or a parked edge) keeps its meaning, and a fill that binds
  // nothing keeps the previous empty shape so untouched nodes stay byte-identical.
  const selfHealed = explicit === undefined ? autoFillSlots(feed, layout, {}, autoStandby) : undefined;
  const filledAnything = selfHealed !== undefined && Object.values(selfHealed.bindings).some((occupants) => occupants.length > 0);
  // Reassign automatic supply after a layout change. Hold pins for missing roles
  // outside the current assignment so the same inputs can be restored later.
  const renormalized = !keepSavedLipSlots && explicit && (transferredStartSlot || restoredSlots.length || Object.keys(explicit).some(slot => !slotByName.has(slot)))
    ? autoFillSlots(feed, layout, Object.fromEntries(Object.entries(explicit).map(([slot, occupants]) => [slot,
      slotByName.has(slot) ? occupants : occupants.filter(occupant => occupant.pinned && modeChanged),
    ])), [...autoStandby, ...transferredInactive.map(occupant => occupant.edgeId)])
    : undefined;
  const fill = useSavedSlots
    ? (filledAnything ? selfHealed!
      : renormalized ?? { bindings: explicit ?? {}, conflicts: storedConflicts ?? [] })
    : explicit ? autoFillSlots(feed, layout, explicit, autoStandby) : hydrateSlotBindings(feed, layout, graph.edges.filter((edge) => edge.target === node.id), autoStandby);
  if (transferredStartSlot && fill.bindings[transferredStartSlot]) {
    // The transferred start image is first in the new slot, regardless of when its edge was drawn.
    fill.bindings[transferredStartSlot] = [...fill.bindings[transferredStartSlot]!, ...transferredInactive]
      .map((occupant, ordinal) => ({ ...occupant, ordinal }));
  }
  const conflicts = fill.conflicts.filter(conflict => {
    if (!renormalized || fill !== renormalized || conflict.reason !== 'slot_removed' || slotByName.has(conflict.slot)) return true;
    parkedSlots.push({ ...conflict, reason: 'slot_inactive' });
    return false;
  });
  const fingerprint = effectiveSlotFingerprint(raw, layout, fill.bindings, conflicts, currentVersion || upgradeRestored ? 1 : undefined);
  const match = operation && permitted ? matchOperationInputs(operation, fingerprint) : undefined;
  const reasonCodes = !view.available ? ['catalog_unavailable'] : !permitted ? ['not_listed'] : !model ? ['unknown_model']
    : !operation ? ['operation_incompatible'] : [...(match?.rejections ?? []), ...(match?.pending ?? [])].map((item) => item.code);
  if (conflicts.length) reasonCodes.push('role_conflict');
  const data = { ...node.data };
  if (upgradeRestored) data.inputBindingVersion = 1;
  if (selectableBeforeInputs && sameModel && params.operation === 'text_to_video' && priorParams.operation === 'digital_human' && previous?.data.slotBindings) {
    data.parkedLipSyncInputs = { model: model.id, bindings: previous.data.slotBindings, conflicts: previous.data.slotConflicts };
  } else if (params.operation !== 'text_to_video' || cached?.model !== model?.id) {
    delete data.parkedLipSyncInputs;
  }
  return { ...node, data: { ...data, params, ...(autoDerived ? { autoOperationId: autoDerived } : {}),
    slotBindings: fill.bindings, slotConflicts: [...conflicts, ...parkedSlots],
    compat: { status: operation && permitted ? 'ok' : 'configuration_error', acceptsCurrentInputs: match?.accepts ?? false,
      readyToSubmit: Boolean(match?.ready), operation: operation?.id, reasonCodes,
      fingerprint: fingerprint.signature, catalogFingerprint: catalog?.fingerprint ?? '' } } };
}

/** Best-effort mirror for old readers; a single edge cannot express two roles. */
export function mirrorCanvasSlots(node: CanvasNode, edges: Edge[], context: CanvasMutationRuntimeContext): Edge[] {
  const params = readCanvasParams(node);
  const catalog = narrowCatalogByRouting(context.catalog, params.model, params.routing);
  const layout = deriveSlotLayout(catalog, params.model as string | undefined, params.operation as string | undefined);
  const bindings = (node.data.slotBindings ?? {}) as SlotBindings;
  return edges.map((edge) => {
    if (edge.target !== node.id) return edge;
    const slot = layout.slots.find((item) => bindings[item.slot]?.some((occupant) => occupant.edgeId === edge.id));
    const data = { ...edge.data };
    delete data.slotBinding;
    delete data.targetSlot;
    if (slot) data.slotBinding = { slot: slot.slot, role: slot.role, type: slot.type, mirror: true };
    return { ...edge, data };
  });
}
