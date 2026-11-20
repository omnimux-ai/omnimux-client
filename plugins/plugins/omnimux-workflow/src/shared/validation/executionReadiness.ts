/** Shared input/configuration guard for execution admission and final dispatch. */

import type { CapabilityCatalog, CatalogModelDto } from '../api.ts';
import { findDeclaredParameterFailure } from './declaredParameterValidation.ts';
import { buildEffectiveOpsUiState, buildUiUpstreamFingerprint, readPreferredOperationId } from './operationUi.ts';
import { readNodeInputSource } from '../graph/nodeInputSource.ts';
import type { UpstreamMediaSnapshot } from './operationUi.ts';
import { readExplicitTargetSlot } from './compatKernel.ts';
import { buildInputCapability } from './inputCapability.ts';
import { resolveNodeKind } from '../graph/materialNode.ts';
import { materialTools } from '../specs/nodes/materialNodeSpec.ts';
import { deriveSlotLayout, type FeedAsset, type SlotBindings, type SlotConflict } from '../graph/feedSlot/index.ts';
import { effectiveSlotFingerprint, feedFromFingerprint } from '../graph/feedSlot/effectiveFingerprint.ts';
import { resolveSlotOperation } from '../graph/feedSlot/resolveSlotOperation.ts';
import { effectiveInputDisplay } from '../graph/feedSlot/effectiveInputDisplay.ts';
import { narrowCatalogByRouting, requiredEffectiveVideoParameter, resolveEffectiveVideoGroup, resolveEffectiveVideoOperation } from './lineConstraints.ts';
import { isManagedVideoLineChanged } from './managedVideoExecution.ts';
import {
  buildContractView,
  isMediaInputType,
  isVisualGeneration,
  matchOperationInputs,
  resolveModelView,
} from './compatKernel.ts';

export interface ExecutionReadinessNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface ExecutionReadinessFailure {
  nodeId: string;
  reasonCode: string;
  message: string;
  slot?: string;
}

interface ProjectedVisualInputs {
  slotBindings: SlotBindings;
  slotConflicts: SlotConflict[];
  slotStandbyEdgeIds: string[];
}

function freezeVisualInputs(loaded: ReturnType<typeof effectiveInputDisplay>, feed: FeedAsset[], standby: string[]): ProjectedVisualInputs {
  const slotBindings: SlotBindings = {};
  const active = new Set<string>();
  for (const { slot, occupant, state } of loaded.records) {
    (slotBindings[slot.slot] ??= []).push(occupant);
    if (state !== 'inactive') active.add(occupant.edgeId);
  }
  const slotConflicts = loaded.conflicts.filter(({ slot, occupant }) =>
    slotBindings[slot]?.some(value => value.edgeId === occupant.edgeId && value.sourceNodeId === occupant.sourceNodeId));
  const slotStandbyEdgeIds = [...new Set([...standby, ...feed
    .filter(asset => isMediaInputType(asset.type) && !active.has(asset.edgeId))
    .map(asset => asset.edgeId)])];
  return { slotBindings, slotConflicts, slotStandbyEdgeIds };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface ExecutionReadinessGraph {
  nodes: ExecutionReadinessNode[];
  edges: Array<{ id?: string; source: string; target: string; targetHandle?: string | null; data?: Record<string, unknown> }>;
  workspaceId?: string;
  resolvedInputs?: ReadonlyMap<string, UpstreamMediaSnapshot[]>;
  /** Only full/subset execution may defer generation dependencies in this set. */
  scheduledNodeIds?: ReadonlySet<string>;
}

function upstreamSnapshots(nodeId: string, graph?: ExecutionReadinessGraph): UpstreamMediaSnapshot[] {
  return (graph?.edges ?? []).filter((edge) => edge.target === nodeId).flatMap((edge, ordinal) => {
    const node = graph!.nodes.find((candidate) => candidate.id === edge.source);
    const source = readNodeInputSource(node ?? { id: edge.source }, graph?.workspaceId);
    const binding = edge.data?.slotBinding as { role?: string; mirror?: boolean } | undefined;
    const inputs = graph?.resolvedInputs?.get(edge.source) ?? [{
      nodeId: edge.source, label: source.label, outputId: source.outputId, materialType: node ? source.materialType : String(edge.data?.feedType ?? source.materialType),
      availability: source.availability, availabilityMessage: source.message,
      textContent: source.output.text, url: source.output.mediaAssets?.[0]?.url,
      ...source.metadata,
    }];
    return inputs.map((input) => ({ ...input, edgeId: edge.id ?? `feed-${edge.source}-${ordinal}`,
      role: typeof edge.data?.role === 'string' ? edge.data.role : binding?.mirror === true ? undefined : binding?.role,
      targetSlot: readExplicitTargetSlot(edge.data ?? {}, edge.targetHandle),
    }));
  });
}

/**
 * Check current sources, roles, slots and declared model parameters. Scheduled
 * generation dependencies may wait until dispatch; imported sources must exist.
 */
export function findExecutionReadinessFailure(
  nodes: ExecutionReadinessNode[],
  inputCatalog: CapabilityCatalog | null | undefined,
  graph?: ExecutionReadinessGraph,
  onVisualInputs?: (nodeId: string, inputs: ProjectedVisualInputs) => void,
): ExecutionReadinessFailure | null {
  const baseView = buildContractView(inputCatalog);
  for (const node of nodes) {
    if (node.type !== 'material' || resolveNodeKind(node.data ?? {}) !== 'generate') continue;
    const outputCapabilityId = typeof node.data?.outputCapabilityId === 'string' ? node.data.outputCapabilityId : '';
    if (outputCapabilityId && materialTools[outputCapabilityId]?.executorKey) continue;
    let upstreams = upstreamSnapshots(node.id, graph);
    const deferred = new Set(upstreams.filter((input) => {
      const source = graph?.nodes.find((candidate) => candidate.id === input.nodeId);
      return source?.type === 'material' && resolveNodeKind(source.data ?? {}) === 'generate'
        && graph?.scheduledNodeIds?.has(source.id);
    }).map((input) => input.nodeId));
    // These sources will run again; their old result metadata is not this run's input.
    upstreams = upstreams.map((input) => deferred.has(input.nodeId)
      ? { nodeId: input.nodeId, label: input.label, materialType: input.materialType, edgeId: input.edgeId,
          role: input.role, targetSlot: input.targetSlot, availability: 'ready' as const,
          // Admission-only placeholder: dispatch revalidates the completed scheduled output.
          ...(input.materialType === 'text' ? { textContent: '__scheduled_text__' } : { url: 'scheduled:pending' }) }
      : input);
    const data = node.data ?? {};
    const inputBindingVersion = data.inputBindingVersion === 1 ? 1 : undefined;
    const params = data.params && typeof data.params === 'object'
      ? data.params as Record<string, unknown>
      : {};
    const requestedModel = readString(params.model);
    const outputKind = typeof data.materialType === 'string' ? data.materialType : 'text';
    const defaultModel = inputCatalog?.defaults?.[outputKind as keyof NonNullable<CapabilityCatalog['defaults']>];
    const managed = outputKind === 'video' ? resolveEffectiveVideoGroup(inputCatalog, requestedModel ?? defaultModel, params.routing) : null;
    const reviewed = data.managedVideoGeneration;
    if ((managed || reviewed) && !managed?.group) return {
      nodeId: node.id, reasonCode: 'line_selection_required', message: '请选择当前可用的生成线路',
    };
    if (managed?.group && isManagedVideoLineChanged(managed.group, managed.model.effectiveVideoVersion, params.routing, reviewed)) return {
      nodeId: node.id, reasonCode: 'line_capability_changed', message: '线路规则或价格已更新，请确认后重新生成',
    };
    const variant = managed?.group ? resolveEffectiveVideoOperation(managed.group, params.operation, params) : undefined;
    if (managed && !variant) return {
      nodeId: node.id, reasonCode: 'operation_incompatible', message: '当前线路不支持所选生成方式或参数，请重新选择',
    };
    const requiredParameter = variant && requiredEffectiveVideoParameter(variant, params);
    if (requiredParameter) return {
      nodeId: node.id, reasonCode: 'parameter_required', message: `请选择参数“${requiredParameter}”`,
    };
    const baseModel = resolveModelView(baseView, requestedModel ?? defaultModel);
    const catalog = isVisualGeneration(outputKind)
      ? narrowCatalogByRouting(inputCatalog, baseModel?.id, params.routing, params) : inputCatalog;
    const view = catalog === inputCatalog ? baseView : buildContractView(catalog);
    if (!view.available) return { nodeId: node.id, reasonCode: 'catalog_unavailable', message: '模型目录不可用，请稍后重试' };
    const model = resolveModelView(view, requestedModel ?? defaultModel);
    if (!model) return { nodeId: node.id, reasonCode: 'unknown_model', message: '当前模型不可用，请选择模型后重试' };
    const rawFingerprint = buildUiUpstreamFingerprint({
      materialType: typeof data.materialType === 'string' ? data.materialType : undefined,
      prompt: typeof data.prompt === 'string' ? data.prompt : '',
      content: typeof data.content === 'string' ? data.content : undefined,
      upstreams,
      nodeFields: params,
    });
    const outputType = typeof data.materialType === 'string' ? data.materialType : undefined;
    const autoOperationId = typeof data.autoOperationId === 'string' || data.autoOperationId === null
      ? data.autoOperationId as string | null
      : undefined;
    const preferredOperationId = readPreferredOperationId(params, autoOperationId);
    const videoCapability = outputType === 'video' && !managed
      ? buildInputCapability({
          catalog,
          modelId: model.id,
          outputType: 'video',
          fingerprint: rawFingerprint,
          ...(preferredOperationId ? { preferredOperationId } : {}),
          autoOperationId,
          params,
          ignoredEdgeIds: Array.isArray(data.slotStandbyEdgeIds) ? (data.slotStandbyEdgeIds as string[]) : [],
        })
      : undefined;
    if (videoCapability?.blocked) {
      return { nodeId: node.id, reasonCode: 'operation_incompatible', message: '当前模型没有可用的生成方式' };
    }
    const chosenId = variant?.id ?? (videoCapability
      ? videoCapability.selectedOperationId
      : inputBindingVersion === 1 && readString(params.operation)
        ? readString(params.operation) : resolveSlotOperation(catalog, model.id, params.operation, outputType, rawFingerprint));
    const layout = deriveSlotLayout(catalog, model.id, chosenId);
    const rawDocumentFailure = layout.acceptsDocuments !== false && rawFingerprint.assets.find(asset =>
      asset.type === 'document' && asset.availability !== undefined && asset.availability !== 'ready');
    if (rawDocumentFailure) return {
      nodeId: node.id, reasonCode: rawDocumentFailure.availability === 'waiting' ? 'input_waiting' : 'input_unavailable',
      message: rawDocumentFailure.availabilityMessage ?? 'JSON 文件不可用，请修复或移除该输入',
    };
    const feed = feedFromFingerprint(rawFingerprint, inputBindingVersion);
    const standby = (data.slotStandbyEdgeIds ?? []) as string[];
    const loaded = effectiveInputDisplay(layout, feed, data.slotBindings as SlotBindings | undefined,
      (data.slotConflicts ?? []) as SlotConflict[], graph?.edges.filter((edge) => edge.target === node.id) ?? [],
      standby, inputBindingVersion);
    const { bindings, conflicts } = loaded;
    const videoMode = videoCapability?.operationStates.find(candidate => candidate.id === chosenId);
    if (loaded.requiredUnavailable && !deferred.has(loaded.requiredUnavailable.occupant.sourceNodeId)) return {
      nodeId: node.id, reasonCode: inputBindingVersion === 1
        ? loaded.records.find(record => record.occupant.edgeId === loaded.requiredUnavailable!.occupant.edgeId)?.reasonCode ?? 'input_unavailable' : 'input_unavailable',
      message: `来源 ${loaded.requiredUnavailable.occupant.sourceNodeId} 的素材尚不可用，请替换或停用`,
      ...(videoMode?.selectableBeforeInputs ? { slot: loaded.requiredUnavailable.slot } : {}),
    };
    const fingerprint = effectiveSlotFingerprint(rawFingerprint, layout, bindings, conflicts, inputBindingVersion, standby);
    const unavailable = fingerprint.assets.find((asset) => asset.availability !== 'ready' && !deferred.has(asset.sourceNodeId));
    if (unavailable) return { nodeId: node.id, reasonCode: unavailable.availability === 'unavailable' ? 'input_unavailable' : 'input_waiting',
      message: unavailable.availabilityMessage ?? `等待来源 ${unavailable.sourceNodeId} 的内容` };
    const opsState = managed ? undefined : buildEffectiveOpsUiState({
      catalog,
      modelId: model.id,
      fingerprint,
      ...(outputType ? { outputType } : {}),
      ...(readString(params.operation) ? { preferredOperationId: readString(params.operation) } : {}),
    });
    const rawOperation = readString(params.operation);
    const selectedOperationId = variant?.id ?? (videoCapability
      ? chosenId
      : rawOperation ?? chosenId ?? opsState?.selectedOperationId ?? opsState?.implicitOperationId);
    const operation = selectedOperationId
      ? model.operations.find((candidate) => candidate.id === selectedOperationId && candidate.listed)
      : undefined;
    const selectedIsEffective = managed ? Boolean(operation) : videoCapability
      ? videoMode?.usable || videoMode?.selectableBeforeInputs
      : Boolean(selectedOperationId && opsState?.effectiveOps.some((candidate) => candidate.id === selectedOperationId));
    // Raw persisted operation ids are never a soft preference: if no longer
    // listed/effective for this model and node shape, block before mock or hub
    // submission. For an omitted id, the kernel's implicit/chosen operation is
    // used so its parameters and node fields receive the same checks as UI.
    if (!operation || !selectedIsEffective) {
      return {
        nodeId: node.id,
        reasonCode: 'operation_incompatible',
        message: rawOperation
          ? `当前模型不支持已保存的生成方式 ${rawOperation}`
          : (opsState?.reasonMessage ?? '请选择生成方式'),
      };
    }
    const catalogModel = (catalog?.models ?? []).find((candidate: CatalogModelDto) =>
      candidate.id === model.id || candidate.aliases?.includes(model.id),
    );
    const parameterFailure = findDeclaredParameterFailure(
      params,
      operation.parameters,
      catalogModel?.parameters as Record<string, unknown> | undefined,
    );
    if (parameterFailure) {
      return {
        nodeId: node.id,
        reasonCode: 'parameter_unsupported',
        message: parameterFailure.message,
      };
    }
    const match = matchOperationInputs(operation, fingerprint, { deferVisualPrompt: true });
    const missing = [...match.rejections, ...match.pending].find((failure) => {
      if (deferred.size === 0) return true;
      // Missing dynamic content is checked again against completed scheduler outputs.
      if (['input_waiting', 'input_unavailable'].includes(failure.code)) {
        return !deferred.has(String(failure.meta?.sourceNodeId));
      }
      return !(failure.code === 'prompt_required'
        && upstreams.some((input) => deferred.has(input.nodeId) && input.materialType === 'text'));
    });
    if (missing) return { nodeId: node.id, reasonCode: missing.code, message: missing.message,
      ...(videoMode?.selectableBeforeInputs && missing.slot ? { slot: missing.slot } : {}) };
    if (onVisualInputs && !managed && isVisualGeneration(outputKind)) onVisualInputs(node.id, freezeVisualInputs(loaded, feed, standby));
  }
  return null;
}
