import type { CapabilityCatalog } from '../../shared/api.ts';
import type { ExecutionContext } from '../executors/registry.ts';
import { buildContractView, buildUpstreamFingerprint, isMediaInputType, isPromptInput, isVisualGeneration, resolveModelView } from '../../shared/validation/compatKernel.ts';
import { localFilePathFromUrl } from '../../shared/localMedia.ts';
import { acceptsFeedAsset, feedAssetMime } from '../../shared/graph/feedSlot/autoFillSlots.ts';
import { readPreparedExecutionInputs, resolveExecutionContract, type ReadyRunInput, type RunSnapshot } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
import { checkRunSnapshotContract, EXECUTION_INPUT_CHANGED } from '../../shared/validation/executionReadiness.ts';
import type { ReferenceAssetPayload, SubmitRequest } from '../seam/gateway.ts';
import { resolveSlotOperation } from '../../shared/graph/feedSlot/resolveSlotOperation.ts';
import { readPreferredOperationId } from '../../shared/validation/operationUi.ts';
import { resolveGenerationPrompt } from '../../shared/graph/generationPrompt.ts';
import { parseJsonDocumentText } from '../../shared/jsonDocument.ts';
import { assembleEffectiveInputsFromSlots, deriveSlotLayout, deriveImageGenerationLayout, buildImageGenerationCapability,
  type FeedAsset, type SlotBindings, type SlotConflict } from '../../shared/graph/feedSlot/index.ts';
import { resolveExecutionMediaSource, type ResolveExecutionProjectFile } from './executionMediaSource.ts';
import { SeamGatewayError } from '../seam/SeamGatewayError.ts';
import { effectiveInputDisplay } from '../../shared/graph/feedSlot/effectiveInputDisplay.ts';
import { effectiveSlotFingerprint } from '../../shared/graph/feedSlot/effectiveFingerprint.ts';
import { narrowCatalogByRouting, resolveEffectiveVideoGroup, resolveEffectiveVideoOperation } from '../../shared/validation/lineConstraints.ts';
import { parseModelAndGroup } from '../../shared/validation/channelRouting.ts';
import { isManagedVideoLineChanged } from '../../shared/validation/managedVideoExecution.ts';

/** Resolve only occupied media. Standby URLs are never opened, parsed or sent to a provider. */
export function collectMaterialSlotInputs(data: Record<string, unknown>, ctx: ExecutionContext, inputCatalog: CapabilityCatalog, resolveProjectFile?: ResolveExecutionProjectFile) {
  const prepared = readPreparedExecutionInputs(data);
  const snapshot = ctx.runSnapshot ?? prepared?.snapshot;
  if (snapshot) {
    const blocked = prepared?.assignment.blocked[0];
    if (blocked) throw new SeamGatewayError(blocked.code, blocked.message ?? '当前输入尚不满足生成要求');
    return collectSnapshotInputs(data, ctx, inputCatalog, snapshot, resolveProjectFile);
  }
  // Existing records created before slot snapshots still use their persisted bindings.
  return collectLegacyMaterialSlotInputs(data, ctx, inputCatalog, resolveProjectFile);
}

function collectLegacyMaterialSlotInputs(data: Record<string, unknown>, ctx: ExecutionContext, inputCatalog: CapabilityCatalog, resolveProjectFile?: ResolveExecutionProjectFile) {
  const params = (data.params ?? {}) as Record<string, unknown>;
  const kind = (data.materialType ?? 'text') as keyof NonNullable<CapabilityCatalog['defaults']>;
  const requestedModel = typeof params.model === 'string' ? params.model : inputCatalog.defaults?.[kind];
  const modelId = isVisualGeneration(kind) ? parseModelAndGroup(requestedModel).modelId : requestedModel;
  const managed = kind === 'video' ? resolveEffectiveVideoGroup(inputCatalog, requestedModel, params.routing) : null;
  const reviewed = data.managedVideoGeneration;
  if ((managed || reviewed) && !managed?.group) {
    throw new SeamGatewayError('line_selection_required', '请选择当前可用的生成线路');
  }
  if (managed?.group && isManagedVideoLineChanged(managed.group, managed.model.effectiveVideoVersion, params.routing, reviewed)) {
    throw new SeamGatewayError('line_capability_changed', '线路规则或价格已更新，请确认后重新生成');
  }
  const variant = managed?.group ? resolveEffectiveVideoOperation(managed.group, params.operation, params) : undefined;
  if (managed && !variant) throw new SeamGatewayError('operation-not-allowed', '当前线路不支持所选生成方式或参数，请重新选择');
  const catalog = isVisualGeneration(kind)
    ? narrowCatalogByRouting(inputCatalog, requestedModel, params.routing, params) ?? inputCatalog : inputCatalog;
  const model = resolveModelView(buildContractView(catalog), modelId);
  const autoOperationId = typeof data.autoOperationId === 'string' || data.autoOperationId === null
    ? data.autoOperationId as string | null : undefined;
  const preferredOperationId = variant?.id ?? readPreferredOperationId(params, autoOperationId);
  let operationId = preferredOperationId;
  let layout = deriveSlotLayout(catalog, model?.id, operationId);
  const currentVersion = data.inputBindingVersion === 1;
  const standbyEdgeIds = new Set(((data.slotStandbyEdgeIds ?? []) as unknown[]).filter((id): id is string => typeof id === 'string'));
  const boundOccupants = Object.entries((data.slotBindings ?? {}) as SlotBindings).flatMap(([targetSlot, occupants]) => occupants
    .filter(occupant => occupant.use !== 'inactive').map(occupant => {
      const resolved = ctx.upstreamBindings?.find(binding => binding.edgeId === occupant.edgeId && binding.sourceNodeId === occupant.sourceNodeId);
      return { edgeId: occupant.edgeId, sourceNodeId: occupant.sourceNodeId, targetSlot, role: occupant.role, ordinal: resolved?.ordinal,
        output: (ctx.upstreamBindings !== undefined ? resolved?.output : ctx.upstreamOutputs.get(occupant.sourceNodeId)) ?? {} };
    }));
  const rawBindings: NonNullable<ExecutionContext['upstreamBindings']> = ctx.upstreamBindings
    ?? [...ctx.upstreamOutputs].map(([sourceNodeId, output]) => ({ sourceNodeId, output }));
  const ordered: NonNullable<ExecutionContext['upstreamBindings']> = currentVersion
    ? [
      ...boundOccupants,
      // Free-text contract: unbound connected edges (not in slotBindings, not
      // standby) stay in feed so assemble picks them up as freeTextAssets.
      ...rawBindings.filter((binding) => !standbyEdgeIds.has(binding.edgeId ?? '')
        && (!managed || !(binding.output.documentText !== undefined || binding.output.documentError
          || binding.output.mediaAssets?.some(asset => asset.type === 'document')))
        && !boundOccupants.some((item) => item.edgeId === binding.edgeId && item.sourceNodeId === binding.sourceNodeId)),
    ]
    : rawBindings.filter((binding) => !standbyEdgeIds.has(binding.edgeId ?? ''));
  const texts: string[] = [];
  const seenText = new Set<string>();
  const feed: FeedAsset[] = [];
  const mediaByEdge = new Map<string, NonNullable<ExecutionContext['upstreamBindings']>[number]['output']['mediaAssets']>();
  const saved = data.slotBindings as SlotBindings | undefined;
  for (const [ordinal, binding] of ordered.entries()) {
    const output = binding.output;
    const edgeId = binding.edgeId ?? `feed-${binding.sourceNodeId}-${ordinal}`;
    // Standby is the user's explicit exclusion; never open, parse or submit it.
    if (standbyEdgeIds.has(edgeId)) continue;
    const savedSlot = layout.slots.find((slot) => saved?.[slot.slot]?.some((item) => item.edgeId === edgeId));
    const type = output.mediaAssets?.[0]?.type ?? (currentVersion && output.text !== undefined ? 'text' : undefined) ?? savedSlot?.type;
    if (!type) {
      if (!output.text?.trim()) continue;
      if (!seenText.has(binding.sourceNodeId)) { seenText.add(binding.sourceNodeId); texts.push(output.text.trim()); }
      continue;
    }
    if (feed.some((asset) => asset.edgeId === edgeId)) continue;
    const asset = output.mediaAssets?.[0];
    feed.push({ edgeId, sourceNodeId: binding.sourceNodeId, type, ordinal: binding.ordinal ?? ordinal,
      outputId: asset?.assetId ?? asset?.relativePath ?? asset?.path ?? asset?.url ?? output.assetId,
      availability: asset || (type === 'text' && output.text?.trim()) ? 'ready'
        : (currentVersion && ctx.upstreamBindings !== undefined
          ? ctx.upstreamBindings.some(item => item.edgeId === edgeId && item.sourceNodeId === binding.sourceNodeId)
          : ctx.upstreamBindings?.some(item => item.edgeId === edgeId && item.sourceNodeId === binding.sourceNodeId)
            || ctx.upstreamOutputs.has(binding.sourceNodeId)) ? 'waiting' : 'unavailable',
      ...(type === 'text' || type === 'document' ? { textContent: output.text } : {}),
      ...(output.documentText !== undefined ? { documentText: output.documentText } : {}), role: binding.role, targetSlot: binding.targetSlot,
      url: asset?.url, pathOrUrl: asset?.relativePath || asset?.path, mimeType: asset?.mimeType, sizeBytes: asset?.sizeBytes, durationSec: asset?.durationSec });
    mediaByEdge.set(edgeId, output.mediaAssets);
  }
  const boundFingerprint = buildUpstreamFingerprint({
    prompt: resolveGenerationPrompt(data, texts),
    localText: resolveGenerationPrompt(data),
    nodeFields: params,
    assets: feed,
  });
  if (kind === 'image' && model) {
    const imageLayout = deriveImageGenerationLayout(catalog, model.id, params.operation as string | undefined);
    if (!imageLayout) {
      operationId = undefined;
    } else {
      const imageDisplay = effectiveInputDisplay(
        imageLayout,
        feed,
        saved,
        (data.slotConflicts ?? []) as SlotConflict[],
        [],
        [...standbyEdgeIds],
        currentVersion ? 1 : undefined,
      );
      const imageFingerprint = effectiveSlotFingerprint(
        boundFingerprint,
        imageLayout,
        imageDisplay.bindings,
        imageDisplay.conflicts,
        currentVersion ? 1 : undefined,
        [...standbyEdgeIds],
      );
      operationId = buildImageGenerationCapability({
        catalog,
        modelId: model.id,
        fingerprint: imageFingerprint,
        ignoredEdgeIds: [...standbyEdgeIds],
      }).selectedOperationId;
    }
  } else {
    const hasSavedOperation = model?.operations.some(op => op.listed && op.id === preferredOperationId);
    operationId = hasSavedOperation ? preferredOperationId : resolveSlotOperation(catalog, model?.id, params.operation, kind, boundFingerprint);
  }
  if (model && !operationId) throw new SeamGatewayError('operation-required', '请选择生成方式');
  layout = deriveSlotLayout(catalog, model?.id, operationId);
  const plainSpeech = !currentVersion && kind === 'audio' && operationId === 'text_to_speech';
  const loaded = effectiveInputDisplay(layout, feed, plainSpeech ? {} : saved,
    plainSpeech ? [] : (data.slotConflicts ?? []) as SlotConflict[], [], (data.slotStandbyEdgeIds ?? []) as string[],
    currentVersion ? 1 : undefined);
  const { bindings, conflicts } = loaded;
  if (loaded.requiredUnavailable) {
    const reason = currentVersion ? loaded.records.find(record => record.occupant.edgeId === loaded.requiredUnavailable!.occupant.edgeId)?.reasonCode : undefined;
    throw new SeamGatewayError(reason === 'input_waiting' ? reason : 'input_unavailable', `来源 ${loaded.requiredUnavailable.occupant.sourceNodeId} 的素材尚不可用，请替换或停用`);
  }
  for (const { occupant } of loaded.selected) {
    const asset = feed.find((item) => item.edgeId === occupant.edgeId);
    const output = mediaByEdge.get(occupant.edgeId);
    if (!asset || !output?.length) continue;
    // The selected output is singular. Multiple historical media must not become one occupant.
    if (output.length !== 1) throw new SeamGatewayError('input_unavailable', `来源 ${occupant.sourceNodeId} 尚未确定唯一输出`);
    asset.pathOrUrl = resolveExecutionMediaSource(output[0]!, { workspaceId: ctx.workspaceId, mediaDir: ctx.mediaDir, resolveProjectFile }) ?? undefined;
    if (!asset.pathOrUrl) throw new SeamGatewayError('input_unavailable', `来源 ${occupant.sourceNodeId} 的已选素材无法解析，请替换或移除引用`);
  }
  const effective = assembleEffectiveInputsFromSlots({ layout, bindings, conflicts,
    nodeData: data, feedAssets: feed, incomingText: texts, standbyEdgeIds: [...standbyEdgeIds] });
  if (effective.blockedInputs.length) {
    const failure = effective.blockedInputs[0]!;
    throw new SeamGatewayError(failure.reason, `来源 ${failure.sourceNodeId} 的已入坑素材尚不可用，请补齐或移除引用`);
  }
  const localPromptSlot = isVisualGeneration(layout.outputType) && layout.slots.find(slot => isPromptInput(slot)
    && slot.composition && slot.valueSources?.includes('local_field'));
  const missingSlots = localPromptSlot ? effective.emptyRequiredSlots.filter(slot => slot !== localPromptSlot.slot) : effective.emptyRequiredSlots;
  if (missingSlots.length) throw new SeamGatewayError('min_unsatisfied', `还需要卡槽 ${missingSlots.join('、')} 的素材`);
  const textSlot = layout.slots.find(slot => slot.type === 'text' && slot.composition);
  const localText = layout.acceptsText === false || textSlot && !textSlot.valueSources?.includes('local_field') ? '' : resolveGenerationPrompt(data);
  const textInputs = loaded.records.filter(record => record.state === 'ready' && record.slot.type === 'text').map(record => ({
    sourceNodeId: record.occupant.sourceNodeId, edgeId: record.occupant.edgeId, outputId: record.asset?.outputId,
    role: record.slot.role, targetSlot: record.slot.slot, textContent: record.asset?.textContent ?? '',
  }));
  // JSON document duration is a model-level parameter override, applied only
  // when the selected model declares a duration parameter (Issue #27).
  let documentDuration: number | undefined;
  if (!managed && model && layout.acceptsDocuments !== false) {
    const modelRow = (catalog.models ?? []).find((candidate) =>
      candidate.id === model.id || (Array.isArray(candidate.aliases) && candidate.aliases.includes(model.id)));
    const operationRow = model.operations.find((candidate) => candidate.id === operationId);
    const parameterSchema = (operationRow?.parameters ?? modelRow?.parameters) as Record<string, unknown> | undefined;
    if (parameterSchema && typeof parameterSchema === 'object' && 'duration' in parameterSchema) {
      for (const asset of feed) {
        if (standbyEdgeIds.has(asset.edgeId) || asset.type !== 'document' || !asset.documentText) continue;
        const parsed = parseJsonDocumentText(asset.documentText);
        if (parsed.ok && parsed.duration !== undefined) {
          documentDuration = parsed.duration;
          break;
        }
      }
    }
  }
  return { ...effective, ...(currentVersion ? { localText, textInputs } : {}),
    ...(managed?.group && variant ? { managedGroup: managed.group, variant, effectiveVideoVersion: managed.model.effectiveVideoVersion } : {}),
    ...(documentDuration !== undefined ? { documentDuration } : {}),
    texts: layout.acceptsText === false ? [] : texts, operationId, modelId: model?.id ?? modelId };
}

function staleInput(): never {
  throw new SeamGatewayError('input_changed', EXECUTION_INPUT_CHANGED);
}

function storageIdentityMatches(expected: ReadyRunInput, asset: { assetId?: string; relativePath?: string; path?: string; url: string }): boolean {
  const id = asset.assetId ?? asset.relativePath;
  const matchesId = id ? id === expected.outputId : [asset.url, asset.path, localFilePathFromUrl(asset.url)].includes(expected.outputId);
  if (expected.outputId && !matchesId) return false;
  if (!expected.url) return true;
  const path = localFilePathFromUrl(expected.url);
  if (path && asset.path && path !== asset.path) return false;
  return asset.url === expected.url || Boolean(path && (asset.path === path || asset.url === path));
}

/** Resolve and validate the captured edges in their frozen order. No other input can enter a request. */
function collectSnapshotInputs(data: Record<string, unknown>, ctx: ExecutionContext, sourceCatalog: CapabilityCatalog,
  snapshot: RunSnapshot, resolveProjectFile?: ResolveExecutionProjectFile) {
  const changed = checkRunSnapshotContract(data, sourceCatalog, snapshot);
  if (changed) throw new SeamGatewayError(changed.reasonCode, changed.message);
  const { catalog, model, managed, variant } = resolveExecutionContract(data, sourceCatalog, snapshot.params);
  const operation = model?.operations.find(op => op.id === snapshot.operationId);
  if (!operation) return staleInput();
  const layout = deriveSlotLayout(catalog, snapshot.modelId, snapshot.operationId);
  const composition = layout.slots.find(slot => slot.type === 'text' && slot.composition)?.composition;
  const references: ReferenceAssetPayload[] = [];
  const textInputs: NonNullable<SubmitRequest['textInputs']> = [];
  const promptSources: Array<{ ordinal: number; text: string }> = [];
  let audioTrack: ReferenceAssetPayload | undefined;
  let documentDuration: number | undefined;
  const canReadDuration = !managed && Object.hasOwn({ ...model?.parameters, ...operation.parameters }, 'duration');
  const plan = [...snapshot.assigned, ...snapshot.deferred].sort((left, right) => left.ordinal - right.ordinal);
  const mediaOptions = { workspaceId: ctx.workspaceId, mediaDir: ctx.mediaRoot ?? ctx.mediaDir, resolveProjectFile };
  for (const item of plan) {
    const expected = 'availability' in item ? item as ReadyRunInput : undefined;
    const bindings = ctx.upstreamBindings?.filter(input => input.edgeId === item.edgeId && input.sourceNodeId === item.sourceNodeId);
    const output = bindings?.length === 1 ? bindings[0]!.output : undefined;
    if (!output || output.documentError) return staleInput();
    const asset = output.mediaAssets?.[0];
    const type = item.type === 'table' ? 'text' : item.type;
    const slot = item.targetSlot ? layout.slots.find(slot => slot.slot === item.targetSlot && slot.role === item.role && slot.type === type) : undefined;
    if (item.targetSlot && !slot) return staleInput();
    if (expected && (expected.textContent !== output.text || expected.documentText !== output.documentText)) return staleInput();
    const promptOrdinal = item.promptOrdinal ?? item.ordinal;
    if (type === 'text') {
      const text = output.text;
      if (!text?.trim() || asset || (output.assetId && expected?.outputId && output.assetId !== expected.outputId)) return staleInput();
      if (!slot || slot.composition) promptSources.push({ ordinal: promptOrdinal, text });
      if (slot) textInputs.push({ sourceNodeId: item.sourceNodeId, edgeId: item.edgeId,
        outputId: expected?.outputId ?? output.assetId, role: item.role, targetSlot: slot.slot, textContent: text });
      continue;
    }
    if (asset && (asset.type !== item.type || output.mediaAssets?.length !== 1 || expected && !storageIdentityMatches(expected, asset))) return staleInput();
    if (item.type === 'document' && !item.targetSlot) {
      if (!output.documentText) return staleInput();
      const parsed = parseJsonDocumentText(output.documentText);
      if (!parsed.ok) return staleInput();
      if (asset) {
        try { resolveExecutionMediaSource(asset, mediaOptions); }
        catch { return staleInput(); }
      }
      if (output.text?.trim()) promptSources.push({ ordinal: promptOrdinal, text: output.text });
      if (canReadDuration) documentDuration ??= parsed.duration;
      continue;
    }
    if (!asset || !slot || !isMediaInputType(item.type)) return staleInput();
    const mime = feedAssetMime(asset);
    if (expected && (mime && expected.mimeType && mime !== expected.mimeType
      || asset.sizeBytes !== undefined && expected.sizeBytes !== undefined && asset.sizeBytes !== expected.sizeBytes
      || asset.durationSec !== undefined && expected.durationSec !== undefined && asset.durationSec !== expected.durationSec)) return staleInput();
    const metadata = { mimeType: mime ?? expected?.mimeType,
      sizeBytes: asset.sizeBytes ?? expected?.sizeBytes, durationSec: asset.durationSec ?? expected?.durationSec };
    if (!acceptsFeedAsset(slot, { ...metadata, type: item.type })) return staleInput();
    let pathOrUrl: string;
    try { pathOrUrl = resolveExecutionMediaSource(asset, mediaOptions); }
    catch { return staleInput(); }
    const payload: ReferenceAssetPayload = { type: item.type, role: item.role as ReferenceAssetPayload['role'],
      pathOrUrl, edgeId: item.edgeId, sourceNodeId: item.sourceNodeId, targetSlot: item.targetSlot, ...metadata };
    if (item.type === 'audio' && item.role === 'audio_track' && !audioTrack) audioTrack = payload;
    else references.push(payload);
  }
  const texts = promptSources.sort((left, right) => left.ordinal - right.ordinal).map(source => source.text);
  return {
    prompt: layout.acceptsText === false ? '' : resolveGenerationPrompt({ prompt: snapshot.localText, materialType: data.materialType }, texts, composition),
    references, audioTrack, localText: snapshot.localText, textInputs, texts, documentDuration,
    ...(managed?.group && variant ? { managedGroup: managed.group, variant, effectiveVideoVersion: managed.model.effectiveVideoVersion } : {}),
    operationId: snapshot.operationId, modelId: snapshot.modelId,
  };
}
