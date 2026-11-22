/** Shared input and configuration checks for UI, Agent and execution admission. */
import type { CapabilityCatalog } from '../api.ts';
import { findDefaultChannelGroup, findSelectedChannelGroup, isByokGroup, parseModelAndGroup, readChannelRouting } from './channelRouting.ts';
import { findDeclaredParameterFailure } from './declaredParameterValidation.ts';
import { buildContractView, buildUpstreamFingerprint, isVisualGeneration } from './compatKernel.ts';
import { groupMatchesEffectiveVideoVersion, requiredEffectiveVideoParameter, resolveEffectiveVideoGroup } from './lineConstraints.ts';
import { isManagedVideoLineChanged } from './managedVideoExecution.ts';
import { resolveInputAssignment } from './inputAssignment.ts';
import {
  isCatalogGeneration, prepareExecutionSlotGraph, readPreparedExecutionInputs, resolveExecutionContract,
  type ExecutionSlotGraphOptions, type ExecutionSlotNode, type RunSnapshot,
} from '../graph/feedSlot/prepareExecutionSlotGraph.ts';

export type ExecutionReadinessNode = ExecutionSlotNode;

export interface ExecutionReadinessFailure {
  nodeId: string;
  reasonCode: string;
  message: string;
  slot?: string;
}

export const EXECUTION_INPUT_CHANGED = '输入已更新，请确认当前内容后重新生成';

/** Resolve the saved official line for the editor, admission and the new task request. */
export function readVisualLineSelection(catalog: CapabilityCatalog | null | undefined, params: Record<string, unknown>) {
  const { modelId, group: inlineGroup } = parseModelAndGroup(params.model);
  const model = Array.isArray(catalog?.models)
    ? catalog.models.find(row => row.id === modelId || row.aliases?.includes(modelId)) : undefined;
  if (!model || model.visible === false || model.selectable === false) return;
  const routing = params.routing;
  const { requestedGroups, pinnedGroup, sourceType, allowedGroups } = readChannelRouting(routing, inlineGroup);
  const hasRequest = requestedGroups.length > 0;
  if (sourceType === 'byok' || (hasRequest && requestedGroups.every(id => isByokGroup(id)))) return;

  const managed = resolveEffectiveVideoGroup(catalog, params.model, routing);
  const version = model.effectiveVideoVersion;
  const requiresSingleLine = Boolean(pinnedGroup || managed || allowedGroups.length === 1);
  const couldConflict = requiresSingleLine && requestedGroups.length > 1;
  if (!managed && !couldConflict && (!model.channelGroups || (!model.channelGroups.length && !hasRequest))) return;
  const groups = (model.channelGroups ?? []).filter(group => version === undefined || groupMatchesEffectiveVideoVersion(group, version));
  const available = findSelectedChannelGroup(groups, routing, inlineGroup);
  const selected = managed ? managed.group : requiresSingleLine
    ? findSelectedChannelGroup(groups, routing, inlineGroup, true) : available;
  const conflict = couldConflict && !selected;
  const defaultGroup = conflict || (managed && version === undefined) ? undefined : findDefaultChannelGroup(groups);
  const message = selected ? undefined
    : conflict ? '请选择当前可用的生成线路'
      : hasRequest && !available ? '原线路已下线，请重选'
        : hasRequest || !defaultGroup || managed ? '请选择当前可用的生成线路' : undefined;
  // An explicit single line uses its stable catalog id. Legacy pools and automatic routing retain their shape.
  const requestGroups = requiresSingleLine && selected ? [selected.id] : allowedGroups;
  return { model, managed: Boolean(managed), selected, defaultGroup, hasRequest, hasAvailableRequest: Boolean(available), message, requestGroups };
}

export function visualLineSelectionMessage(catalog: CapabilityCatalog | null | undefined, params: Record<string, unknown>): string | undefined {
  return readVisualLineSelection(catalog, params)?.message;
}

export interface ExecutionReadinessGraph extends Pick<ExecutionSlotGraphOptions, 'workspaceId' | 'resolvedInputs'> {
  nodes: ExecutionReadinessNode[];
  edges: Array<{ id?: string; source: string; target: string; targetHandle?: string | null; data?: Record<string, unknown> }>;
  /** Only full/subset execution may defer generation dependencies in this set. */
  scheduledNodeIds?: ReadonlySet<string>;
}

function checkLine(
  sourceCatalog: CapabilityCatalog | null | undefined, params: Record<string, unknown>,
  { requestedModel, outputType, managed }: ReturnType<typeof resolveExecutionContract>, reviewed: unknown,
): Omit<ExecutionReadinessFailure, 'nodeId'> | undefined {
  const line = isVisualGeneration(outputType)
    ? visualLineSelectionMessage(sourceCatalog, { ...params, model: requestedModel }) : undefined;
  if (line || (managed || reviewed) && !managed?.group) {
    return { reasonCode: 'line_selection_required', message: line ?? '请选择当前可用的生成线路' };
  }
  if (managed?.group && isManagedVideoLineChanged(managed.group, managed.model.effectiveVideoVersion, params.routing, reviewed)) {
    return { reasonCode: 'line_capability_changed', message: '线路规则或价格已更新，请确认后重新生成' };
  }
}

/** Recheck the authoritative variant without letting a different operation win allocation. */
export function checkRunSnapshotContract(data: Record<string, unknown>, catalog: CapabilityCatalog | null | undefined, snapshot: RunSnapshot) {
  const params = snapshot.params;
  const contract = resolveExecutionContract(data, catalog, params);
  const line = checkLine(catalog, params, contract, data.managedVideoGeneration);
  if (line) return line;
  const current = resolveInputAssignment({ catalog: contract.catalog, modelId: contract.model?.id,
    outputType: contract.outputType, forceOperationId: snapshot.operationId, params,
    fingerprint: buildUpstreamFingerprint({ nodeFields: params }),
  });
  if (current.modelId !== snapshot.modelId || current.operationId !== snapshot.operationId
    || current.contractFingerprint !== snapshot.contractFingerprint || contract.managed && !contract.variant) {
    return { reasonCode: 'input_changed', message: EXECUTION_INPUT_CHANGED };
  }
  return snapshot.blockingInput;
}

function checkPreparedNode(node: ExecutionReadinessNode, catalog: CapabilityCatalog | null | undefined): ExecutionReadinessFailure | null {
  const data = node.data ?? {};
  const prepared = readPreparedExecutionInputs(data);
  if (!prepared) return null;
  const { assignment, documentFailure, reviewedLine } = prepared;
  const params = data.params as Record<string, unknown>;
  const contract = resolveExecutionContract(data, catalog, params);
  const { managed, variant, model } = contract;
  const failure = (reasonCode: string, message: string, slot?: string) => ({ nodeId: node.id, reasonCode, message, ...(slot ? { slot } : {}) });
  const line = checkLine(catalog, params, contract, reviewedLine);
  if (line) return { nodeId: node.id, ...line };
  if (managed && !variant) return failure('operation_incompatible', '当前线路不支持所选生成方式或参数，请重新选择');
  if (!buildContractView(catalog).available) return failure('catalog_unavailable', '模型目录不可用，请稍后重试');
  if (!model) return failure('unknown_model', '当前模型不可用，请选择模型后重试');
  const operation = model.operations.find(candidate => candidate.id === assignment.operationId && candidate.listed);
  if (!operation) return failure('operation_incompatible', '当前模型没有可用的生成方式');
  const requiredParameter = variant && requiredEffectiveVideoParameter(variant, params);
  if (requiredParameter) return failure('parameter_required', `请选择参数“${requiredParameter}”`);
  const invalidParameter = findDeclaredParameterFailure(params, operation.parameters, model.parameters);
  if (invalidParameter) return failure('parameter_unsupported', invalidParameter.message);
  if (documentFailure) return failure(documentFailure.availability === 'waiting' ? 'input_waiting' : 'input_unavailable',
    documentFailure.availabilityMessage ?? 'JSON 文件不可用，请修复或移除该输入');
  const missing = assignment.blocked[0];
  if (missing) {
    const slot = missing.slot ?? assignment.records.find(record =>
      (record.state === 'pending' || record.state === 'invalid') && record.occupant.edgeId === missing.meta?.edgeId
      && record.occupant.sourceNodeId === missing.meta?.sourceNodeId)?.slot.slot;
    return failure(missing.code, missing.message ?? '当前输入尚不满足生成要求', missing.code === 'metadata_required' ? undefined : slot);
  }
  return assignment.ready ? null : failure('operation_incompatible', '当前输入尚不满足生成要求');
}

/** Check in execution order after resolving the run's dependency scope. */
export function findExecutionReadinessFailure(
  nodes: ExecutionReadinessNode[], catalog: CapabilityCatalog | null | undefined, graph?: ExecutionReadinessGraph,
): ExecutionReadinessFailure | null {
  const targets = nodes.filter(isCatalogGeneration);
  const unprepared = targets.filter(node => !readPreparedExecutionInputs(node.data));
  const checked = new Map<string, ExecutionReadinessNode>();
  if (unprepared.length) {
    const nodesById = new Map(graph?.nodes.map(node => [node.id, node]));
    for (const node of unprepared) nodesById.set(node.id, node);
    const raw = prepareExecutionSlotGraph([...nodesById.values()], graph?.edges ?? [], catalog, graph?.scheduledNodeIds,
      { workspaceId: graph?.workspaceId, resolvedInputs: graph?.resolvedInputs, normalizeVideoParams: false });
    for (const node of raw.nodes) checked.set(node.id, node);
  }
  for (const node of targets) {
    const failure = checkPreparedNode(readPreparedExecutionInputs(node.data) ? node : checked.get(node.id)!, catalog);
    if (failure) return failure;
  }
  return null;
}
