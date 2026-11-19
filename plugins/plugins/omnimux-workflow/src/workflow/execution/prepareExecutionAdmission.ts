import type { CapabilityCatalog } from '../../shared/api.ts';
import { prepareExecutionSlotGraph } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
import { findExecutionReadinessFailure, type ExecutionReadinessGraph } from '../../shared/validation/executionReadiness.ts';
import type { ExecutionManager } from './ExecutionManager.ts';
import type { ResolveExecutionProjectFile } from './executionMediaSource.ts';
import { executionInputSignatures, readExecutionSourceIdentities } from './executionIdentity.ts';
import { UnverifiedLegacyTask } from './legacyExecutionInput.ts';
import type { ExecutableNode } from './ExecutionScheduler.ts';
import type { ExecutionMode, ResolvedExecutionSubgraph, SubgraphNodeLike, SubgraphEdgeLike } from './subgraph.ts';

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
  let prepared: typeof graph | undefined;
  function lookup() {
    try {
      return identity && findRecoverableTasks ? findRecoverableTasks({
        workspaceId, nodes: selected.nodes as ExecutableNode[], edges: selected.edges, ...identity,
        legacyCatalogProjection: prepared,
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
      prepared = prepareExecutionSlotGraph(graph.nodes, graph.edges, catalog);
      recoveryTasks = lookup();
    }
  }
  if (recoveryTasks instanceof UnverifiedLegacyTask) {
    return { subgraph: selected, readiness: { nodeId: recoveryTasks.nodeId, reasonCode: recoveryTasks.reasonCode, message: recoveryTasks.message },
      sourceGraph: { id: workspaceId, ...graph }, recovery: {} };
  }
  const needsSubmission = selected.nodes.some(node => !Object.hasOwn(recoveryTasks, node.id));
  if (needsSubmission && !prepared && getCatalog) catalog = await getCatalog();
  prepared ??= needsSubmission ? prepareExecutionSlotGraph(graph.nodes, graph.edges, catalog) : graph;
  // Slot preparation preserves topology and ordering, including the selected node set.
  const selectedEdges = new Set(selected.edges);
  const subgraph = {
    nodeIdSet: selected.nodeIdSet,
    nodes: prepared.nodes.map((node, i) => Object.hasOwn(recoveryTasks, node.id) ? graph.nodes[i]! : node)
      .filter(node => selected.nodeIdSet.has(node.id)),
    edges: prepared.edges.filter((_, i) => selectedEdges.has(graph.edges[i]!)),
  };
  const readiness = findExecutionReadinessFailure(
    subgraph.nodes.filter(node => !Object.hasOwn(recoveryTasks, node.id)), catalog,
    { ...prepared, workspaceId, scheduledNodeIds: mode === 'single' ? undefined : selected.nodeIdSet },
  );
  return {
    subgraph, readiness,
    sourceGraph: { id: workspaceId, nodes: prepared.nodes, edges: prepared.edges.filter(edge => !Object.hasOwn(recoveryTasks, edge.target)), catalog },
    recovery: identity ? { ...identity, ...(catalog ? { legacyCatalogProjection: prepared } : {}), recoveryTasks } : {},
  };
}
