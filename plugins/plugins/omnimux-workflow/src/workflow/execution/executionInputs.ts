import type { CapabilityCatalog } from '../../shared/api.ts';
import { resolveNodeKind, resolveNodeOutputType } from '../../shared/graph/materialNode.ts';
import { readNodeInputSource } from '../../shared/graph/nodeInputSource.ts';
import { buildContractView, operationAcceptsDocuments, resolveModelView, type ContractView } from '../../shared/validation/compatKernel.ts';
import { resolveExecutionMediaSource, type ExecutionMediaSourceOptions } from './executionMediaSource.ts';
import type { NodeOutput } from '../executors/registry.ts';
import type { SlotBindings } from '../../shared/graph/feedSlot/types.ts';
import { readPreparedExecutionInputs } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';

/** Seed only dependencies outside the scheduled graph, using their displayed current output. */
export function buildInitialOutputs(
  workspace: {
    id: string;
    catalog?: CapabilityCatalog | null;
    nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    edges: Array<{ id?: string; source: string; target: string }>;
  },
  executedNodeIds: ReadonlySet<string>,
  options?: Omit<ExecutionMediaSourceOptions, 'workspaceId'>,
): Record<string, NodeOutput> {
  const initialOutputs: Record<string, NodeOutput> = {};
  let view: ContractView | undefined;
  for (const edge of workspace.edges) {
    if (!executedNodeIds.has(edge.target)) continue;
    const source = workspace.nodes.find((node) => node.id === edge.source);
    if (!source) continue;
    const scheduled = executedNodeIds.has(edge.source);
    if (scheduled && source.type === 'material' && resolveNodeKind(source.data ?? {}) === 'generate') continue;
    const target = workspace.nodes.find((node) => node.id === edge.target);
    const snapshot = readPreparedExecutionInputs(target?.data)?.snapshot;
    if (snapshot && ![...snapshot.assigned, ...snapshot.deferred].some(input => input.edgeId === edge.id && input.sourceNodeId === edge.source)) continue;
    const sourceType = source.type === 'material' ? resolveNodeOutputType(source.data ?? {}) : source.data?.materialType ?? source.type;
    if (!snapshot && sourceType === 'document' && workspace.catalog && target) {
      view ??= buildContractView(workspace.catalog);
      const params = target.data?.params as { model?: string; operation?: string } | undefined;
      const model = resolveModelView(view, params?.model);
      const operation = model?.operations.find(op => op.id === params?.operation && op.listed);
      if (model && operation && !operationAcceptsDocuments(model, operation)) continue;
    }
    const resolved = readNodeInputSource(source, workspace.id);
    // Admission has already projected visual bindings against the selected
    // operation and line. Preserve the source if another target consumes it.
    const slots = target?.data?.slotBindings as SlotBindings | undefined;
    if (!snapshot && slots !== undefined && ['image', 'video', 'audio'].includes(resolved.materialType)
      && !Object.values(slots).some(values => values.some(item => item.use !== 'inactive'
        && item.edgeId === edge.id && item.sourceNodeId === edge.source))) continue;
    if (resolved.availability === 'ready') {
      const output = {
        ...resolved.output,
        ...(resolved.output.mediaAssets ? { mediaAssets: resolved.output.mediaAssets.map((asset) => {
          const source = resolveExecutionMediaSource(asset, { mediaDir: options?.mediaDir ?? '', ...options, workspaceId: workspace.id });
          // Preserve the displayed locator so the admitted output identity can
          // be compared even when the gateway will read a resolved local path.
          return { ...asset, url: snapshot ? asset.url : source, path: source.startsWith('/') ? source : undefined };
        }) } : {}),
      };
      if (!scheduled) initialOutputs[edge.source] = output;
    }
  }
  return initialOutputs;
}
