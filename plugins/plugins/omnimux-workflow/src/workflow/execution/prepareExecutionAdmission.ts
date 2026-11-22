import type { CapabilityCatalog } from '../../shared/api.ts';
import { prepareExecutionSlotGraph, readPreparedExecutionInputs, type RunSnapshotProof } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
import { EXECUTION_INPUT_CHANGED, findExecutionReadinessFailure, type ExecutionReadinessGraph } from '../../shared/validation/executionReadiness.ts';
import type { ExecutionManager } from './ExecutionManager.ts';
import type { ResolveExecutionProjectFile } from './executionMediaSource.ts';
import { executionInputSignatures, readExecutionSourceIdentities } from './executionIdentity.ts';
import { UnverifiedLegacyTask } from './legacyExecutionInput.ts';
import type { ExecutableNode } from './ExecutionScheduler.ts';
import { resolveExecutionSubgraph, type ExecutionMode, type ResolvedExecutionSubgraph, type SubgraphNodeLike, type SubgraphEdgeLike } from './subgraph.ts';

/** Match persisted tasks against the caller's original intent before a refreshed catalog
 * can reinterpret it. Only new tasks need slot hydration and ready source files. */
export async function prepareExecutionAdmission<
  N extends SubgraphNodeLike & ExecutionReadinessGraph['nodes'][number],
  E extends SubgraphEdgeLike & ExecutionReadinessGraph['edges'][number],
>(workspaceId: string, graph: { nodes: N[]; edges: E[] }, selected: ResolvedExecutionSubgraph<N, E>,
  mode: ExecutionMode, manager: Partial<Pick<ExecutionManager, 'findRecoverableTasks'>>, getCatalog?: () => CapabilityCatalog | null | Promise<CapabilityCatalog | null>,
  resolveProjectFile?: ResolveExecutionProjectFile, expectedInput?: RunSnapshotProof) {
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
    ? prepareExecutionSlotGraph(graph.nodes, graph.edges, catalog, mode === 'single' ? undefined : selected.nodeIdSet, { workspaceId })
    : graph;
  if (catalog && needsSubmission) legacyCatalogProjection ??= prepared;
  const selectedEdges = new Set(selected.edges);
  const buildScope = (tasks: Record<string, unknown>) => {
    const nodes = prepared.nodes.map((node, i) => Object.hasOwn(tasks, node.id) ? graph.nodes[i]! : node);
    const unusedByTarget = new Map(prepared.nodes.map(node => [node.id,
      new Set(readPreparedExecutionInputs(node.data)?.snapshot?.unusedEdgeIds)]));
    const edges = prepared.edges.filter(edge => !Object.hasOwn(tasks, edge.target)
      && (!edge.id || !unusedByTarget.get(edge.target)?.has(edge.id)));
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
  const submitting = subgraph.nodes.filter(node => !Object.hasOwn(recoveryTasks, node.id));
  let readiness = findExecutionReadinessFailure(submitting, catalog,
    { nodes, edges, workspaceId, scheduledNodeIds: mode === 'single' ? undefined : subgraph.nodeIdSet });
  if (expectedInput && mode === 'single' && submitting.length === 1 && !readiness?.reasonCode.startsWith('line_')) {
    const target = submitting[0]!;
    const snapshot = readPreparedExecutionInputs(target.data)?.snapshot;
    if (snapshot?.fingerprint !== expectedInput.fingerprint || snapshot?.contractFingerprint !== expectedInput.contractFingerprint) {
      readiness = { nodeId: target.id, reasonCode: 'input_changed', message: EXECUTION_INPUT_CHANGED };
    }
  }
  return {
    subgraph, readiness,
    sourceGraph: { id: workspaceId, nodes, edges, catalog },
    recovery: identity ? { ...identity, legacyCatalogProjection, recoveryTasks } : {},
  };
}
