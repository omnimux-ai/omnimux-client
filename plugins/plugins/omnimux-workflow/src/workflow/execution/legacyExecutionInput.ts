import { prepareExecutionSlotGraph } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
import { canonicalJson } from '../../shared/validation/compatKernel.ts';
import type { ExecutionReadinessNode } from '../../shared/validation/executionReadiness.ts';
import { executionInputSignatures } from './executionIdentity.ts';
import { buildInitialOutputs } from './executionInputs.ts';
import type { ExecutionMediaSourceOptions } from './executionMediaSource.ts';
import type { PersistedExecutionRecord } from './executionStore.ts';

export type RecoveryInputGraph = { nodes: ExecutionReadinessNode[]; edges: PersistedExecutionRecord['edges'] };

/** Catalog hydration changes params and legacy bindings. Other input fields
 * can be compared directly with the persisted node even when the catalog is gone. */
function stableNodeData(node: ExecutionReadinessNode) {
  const { params, slotBindings, slotConflicts, ...data } = node.data ?? {};
  return { ...node, data };
}

/** Older Agent/Headless ledgers hash the selected prepared nodes, with the actual
 * external source outputs stored separately. Only those ledgers need this fallback. */
export function compareLegacyExecutionInput(
  graph: RecoveryInputGraph, record: PersistedExecutionRecord, nodeId: string, savedSignature: string,
  media: Omit<ExecutionMediaSourceOptions, 'workspaceId'>, catalogProjection?: RecoveryInputGraph,
): 'same' | 'changed' | 'unverified' | 'catalog-needed' {
  const selected = new Set([nodeId]);
  if (record.variables.executionInputSignatureScope === 'workspace'
    || executionInputSignatures(record, selected)[nodeId] !== savedSignature) return 'changed';

  const savedNode = record.nodes.find(node => node.id === nodeId)!;
  const edges = graph.edges.filter(edge => edge.target === nodeId);
  const relevantIds = new Set([nodeId, ...edges.map(edge => edge.source)]);
  const prepared = catalogProjection ?? prepareExecutionSlotGraph(graph.nodes.filter(node => relevantIds.has(node.id)), edges, null);
  const node = prepared.nodes.find(candidate => candidate.id === nodeId)!;
  const raw = graph.nodes.find(candidate => candidate.id === nodeId)!;
  const rawParams = (raw.data?.params ?? {}) as Record<string, unknown>;
  const savedParams = (savedNode.data?.params ?? {}) as Record<string, unknown>;
  const effectiveParams = (node.data?.params ?? {}) as Record<string, unknown>;
  if (typeof rawParams.model === 'string' && rawParams.model.trim() !== String(savedParams.model ?? '').trim()) return 'changed';
  // For non-video operations, the old preparation only supplied missing model
  // and operation defaults. Video preparation also normalized explicit controls.
  if (raw.data?.materialType !== 'video') {
    const { model, operation, ...params } = rawParams;
    const { model: savedModel, operation: savedOperation, ...oldParams } = savedParams;
    if ((operation != null && operation !== savedOperation) || canonicalJson(params) !== canonicalJson(oldParams)) return 'changed';
  } else if (catalogProjection && Object.entries(rawParams).some(([key, value]) =>
    canonicalJson(value) !== canonicalJson(savedParams[key]) && canonicalJson(value) === canonicalJson(effectiveParams[key]))) {
    return 'changed';
  }
  const savedEdges = record.edges.filter(edge => edge.target === nodeId);
  const incoming = prepared.edges.filter(edge => edge.target === nodeId);
  const connections = (list: typeof edges) => list.map(edge => [edge.id, edge.source, edge.sourceHandle, edge.targetHandle]);
  if (canonicalJson(connections(savedEdges)) !== canonicalJson(connections(incoming))) return 'changed';
  if (executionInputSignatures({ nodes: [stableNodeData(savedNode)], edges: [] })[nodeId]
    !== executionInputSignatures({ nodes: [stableNodeData(node)], edges: [] })[nodeId]) return 'changed';
  if (raw.data?.inputBindingVersion === 1 && canonicalJson(raw.data.slotBindings) !== canonicalJson(savedNode.data?.slotBindings)) return 'changed';

  const oldSources = Object.fromEntries(edges.filter(edge => Object.hasOwn(record.nodeOutputs, edge.source))
    .map(edge => [edge.source, record.nodeOutputs[edge.source]]));
  let sources;
  try {
    sources = buildInitialOutputs({ ...prepared, id: record.workspaceId }, selected, media);
  } catch {
    return 'unverified'; // The old selected graph cannot identify missing external files.
  }
  if (canonicalJson(Object.keys(oldSources).sort()) !== canonicalJson(Object.keys(sources).sort())) return 'unverified';
  if (canonicalJson(oldSources) !== canonicalJson(sources)) return 'changed';
  // The previous selected-node digest omitted local bytes from external media.
  // Equal paths and file sizes alone cannot prove the old input's identity.
  if (Object.values(sources).some(output => output.mediaAssets?.some(asset => asset.url.startsWith('/')))) return 'unverified';

  if (executionInputSignatures({ nodes: [node], edges: incoming })[nodeId] === savedSignature) return 'same';
  return catalogProjection ? 'unverified' : 'catalog-needed';
}

export class UnverifiedLegacyTask extends Error {
  readonly reasonCode = 'previous_task_input_unverified';
  readonly nodeId: string;
  readonly needsCatalog: boolean;
  constructor(nodeId: string, executionId: string, taskId: string, needsCatalog: boolean) {
    super(`节点已有上游任务 ${taskId}（执行记录 ${executionId}）。旧记录无法核对完整输入，请先查看原任务。如需重新生成，请复制节点后运行。`);
    this.nodeId = nodeId;
    this.needsCatalog = needsCatalog;
  }
}
