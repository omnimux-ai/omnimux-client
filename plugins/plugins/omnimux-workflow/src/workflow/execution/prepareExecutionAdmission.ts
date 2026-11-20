import type { CapabilityCatalog } from '../../shared/api.ts';
import { readCanvasParams } from '../../shared/graph/canvasInputSources.ts';
import { deriveSlotLayout, type SlotBindings } from '../../shared/graph/feedSlot/index.ts';
import { prepareExecutionSlotGraph } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
import { resolveNodeKind, resolveNodeOutputType } from '../../shared/graph/materialNode.ts';
import { materialTools } from '../../shared/specs/nodes/materialNodeSpec.ts';
import { collectVisualExecutionInputs, findExecutionReadinessFailure, type ExecutionReadinessGraph } from '../../shared/validation/executionReadiness.ts';
import { narrowCatalogByRouting, resolveEffectiveVideoGroup } from '../../shared/validation/lineConstraints.ts';
import type { ExecutionManager } from './ExecutionManager.ts';
import type { ResolveExecutionProjectFile } from './executionMediaSource.ts';
import { executionInputSignatures, readExecutionSourceIdentities } from './executionIdentity.ts';
import { UnverifiedLegacyTask } from './legacyExecutionInput.ts';
import type { ExecutableNode } from './ExecutionScheduler.ts';
import { resolveExecutionSubgraph, type ExecutionMode, type ResolvedExecutionSubgraph, type SubgraphNodeLike, type SubgraphEdgeLike } from './subgraph.ts';

/** Execution drops unused inputs without deleting their canvas edges. */
function executionEdges<E extends ExecutionReadinessGraph['edges'][number]>(
  graph: { nodes: ExecutionReadinessGraph['nodes']; edges: E[] }, catalog: CapabilityCatalog | null,
  recovery: Record<string, unknown>,
): E[] {
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  const activeByTarget = new Map<string, { ids: Set<string>; standby: Set<string>; looseText: boolean }>();
  for (const node of graph.nodes) {
    const data = node.data ?? {};
    if (node.type !== 'material' || data.materialType !== 'video' || resolveNodeKind(data) !== 'generate') continue;
    if (typeof data.outputCapabilityId === 'string' && materialTools[data.outputCapabilityId]?.executorKey) continue;
    const params = readCanvasParams(node);
    if (!resolveEffectiveVideoGroup(catalog, params.model, params.routing)) continue;
    const narrowed = narrowCatalogByRouting(catalog, params.model, params.routing, params);
    const layout = deriveSlotLayout(narrowed, params.model as string | undefined, params.operation as string | undefined);
    activeByTarget.set(node.id, {
      ids: new Set(Object.values((data.slotBindings ?? {}) as SlotBindings).flat()
        .filter(item => item.use !== 'inactive').map(item => item.edgeId)),
      standby: new Set((data.slotStandbyEdgeIds ?? []) as string[]),
      looseText: layout.acceptsText === true && !layout.slots.some(slot => slot.type === 'text' && slot.composition),
    });
  }
  return graph.edges.filter(edge => {
    if (Object.hasOwn(recovery, edge.target)) return false;
    const active = activeByTarget.get(edge.target);
    if (!active) return true;
    if (edge.id && active.ids.has(edge.id)) return true;
    if (edge.id && active.standby.has(edge.id)) return false;
    if (!active.looseText) return false;
    const source = nodesById.get(edge.source);
    const sourceType = source?.type === 'material' ? resolveNodeOutputType(source.data ?? {}) : source?.data?.materialType ?? source?.type;
    return sourceType === 'text' || sourceType === 'table';
  });
}

/** Match persisted tasks against the caller's original intent before a refreshed catalog
 * can reinterpret it. Only new tasks need slot hydration and ready source files. */
export async function prepareExecutionAdmission<
  N extends SubgraphNodeLike & ExecutionReadinessGraph['nodes'][number],
  E extends SubgraphEdgeLike & ExecutionReadinessGraph['edges'][number],
>(workspaceId: string, graph: { nodes: N[]; edges: E[] }, selected: ResolvedExecutionSubgraph<N, E>,
  mode: ExecutionMode, manager: Partial<Pick<ExecutionManager, 'findRecoverableTasks'>>, getCatalog?: () => CapabilityCatalog | null | Promise<CapabilityCatalog | null>,
  resolveProjectFile?: ResolveExecutionProjectFile) {
  const findRecoverableTasks = manager.findRecoverableTasks?.bind(manager);
  const identity = findRecoverableTasks ? {
    inputSignatures: executionInputSignatures(graph, selected.nodeIdSet),
    sourceIdentities: await readExecutionSourceIdentities(graph, selected.nodeIdSet, { workspaceId, resolveProjectFile }),
    rawGraph: graph,
  } : undefined;
  let catalog: CapabilityCatalog | null = null;
  let legacyCatalogProjection: typeof graph | undefined;
  function lookup(scope = selected, acceptedTasks?: ReturnType<ExecutionManager['findRecoverableTasks']>) {
    try {
      return identity && findRecoverableTasks ? findRecoverableTasks({
        workspaceId, nodes: scope.nodes as ExecutableNode[], edges: scope.edges, ...identity,
        legacyCatalogProjection,
        recoveryTasks: acceptedTasks,
      }) : {};
    } catch (error) {
      if (!(error instanceof UnverifiedLegacyTask)) throw error;
      return error;
    }
  }
  let recoveryTasks = lookup();
  if (recoveryTasks instanceof UnverifiedLegacyTask && recoveryTasks.needsCatalog && getCatalog) {
    // An old catalog default may still project to exactly the originally
    // submitted node. If lookup fails the existing task remains actionable.
    catalog = await Promise.resolve().then(getCatalog).catch(() => null);
    if (catalog) {
      legacyCatalogProjection = prepareExecutionSlotGraph(graph.nodes, graph.edges, catalog);
      recoveryTasks = lookup();
    }
  }
  if (recoveryTasks instanceof UnverifiedLegacyTask) {
    return { subgraph: selected, readiness: { nodeId: recoveryTasks.nodeId, reasonCode: recoveryTasks.reasonCode, message: recoveryTasks.message },
      sourceGraph: { id: workspaceId, ...graph }, recovery: {} };
  }
  const needsSubmission = selected.nodes.some(node => !Object.hasOwn(recoveryTasks, node.id));
  if (needsSubmission && !legacyCatalogProjection && getCatalog) catalog = await getCatalog();
  const prepared = needsSubmission
    ? prepareExecutionSlotGraph(graph.nodes, graph.edges, catalog, mode === 'single' ? undefined : selected.nodeIdSet)
    : graph;
  if (catalog && needsSubmission) legacyCatalogProjection ??= prepared;
  const selectedEdges = new Set(selected.edges);
  const buildScope = (tasks: Record<string, unknown>) => {
    const scopedEdges = executionEdges(prepared, catalog, tasks);
    const projectedInputs = collectVisualExecutionInputs(
      prepared.nodes.filter(node => selected.nodeIdSet.has(node.id) && !Object.hasOwn(tasks, node.id)),
      catalog, { nodes: prepared.nodes, edges: scopedEdges, workspaceId,
        scheduledNodeIds: mode === 'single' ? undefined : selected.nodeIdSet },
    );
    // Freeze the assignment before pruning edges. Missing metadata for a
    // pruned source must not revive it as an unavailable slot at dispatch.
    const nodes = prepared.nodes.map((node, i) => {
      if (Object.hasOwn(tasks, node.id)) return graph.nodes[i]!;
      const projection = projectedInputs.get(node.id);
      return projection ? { ...node, data: { ...node.data, ...projection.data } } : node;
    });
    const edges = mode === 'single' ? scopedEdges
      : scopedEdges.filter(edge => !edge.id || !projectedInputs.get(edge.target)?.unusedMediaEdgeIds.has(edge.id));
    // Re-expand from the original roots so an unused connection cannot start an implicit paid node.
    const subgraph = mode === 'full' || selected.requestedNodeIds
      ? resolveExecutionSubgraph({ nodes, edges, executionMode: mode, nodeIds: selected.requestedNodeIds ?? [] })
      : {
        nodeIdSet: selected.nodeIdSet,
        nodes: nodes.filter(node => selected.nodeIdSet.has(node.id)),
        edges: prepared.edges.filter((edge, i) => edges.includes(edge) && selectedEdges.has(graph.edges[i]!)),
      };
    return { nodes, edges, subgraph };
  };
  let scope = buildScope(recoveryTasks);
  if (identity && scope.subgraph.edges.length < selected.edges.length
    && scope.subgraph.nodes.some(node => !Object.hasOwn(recoveryTasks, node.id))) {
    // A dormant dependency must not prevent collecting an already accepted task.
    const additional = lookup(scope.subgraph, recoveryTasks);
    if (additional instanceof UnverifiedLegacyTask) {
      return { subgraph: scope.subgraph,
        readiness: { nodeId: additional.nodeId, reasonCode: additional.reasonCode, message: additional.message },
        sourceGraph: { id: workspaceId, nodes: scope.nodes, edges: scope.edges, catalog }, recovery: {} };
    }
    if (Object.keys(additional).some(nodeId => !Object.hasOwn(recoveryTasks, nodeId))) {
      recoveryTasks = { ...recoveryTasks, ...additional };
      scope = buildScope(recoveryTasks);
    }
  }
  const { nodes, edges, subgraph } = scope;
  const readiness = findExecutionReadinessFailure(
    subgraph.nodes.filter(node => !Object.hasOwn(recoveryTasks, node.id)), catalog,
    { nodes, edges, workspaceId, scheduledNodeIds: mode === 'single' ? undefined : subgraph.nodeIdSet },
  );
  return {
    subgraph, readiness,
    sourceGraph: { id: workspaceId, nodes, edges, catalog },
    recovery: identity ? { ...identity, legacyCatalogProjection, recoveryTasks } : {},
  };
}
