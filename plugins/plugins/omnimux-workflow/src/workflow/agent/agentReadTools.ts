/**
 * Read/run agent tools: workflow_list / workflow_run / workflow_snapshot.
 * Names, descriptions and JSON schemas are unchanged from the monolith.
 */

import { buildInitialOutputs } from '../execution/executionInputs.ts';
import { prepareExecutionAdmission } from '../execution/prepareExecutionAdmission.ts';
import type { CapabilityCatalog } from '../../shared/api.ts';
import { readCanvasParams } from '../../shared/graph/canvasInputSources.ts';
import { resolveNodeKind } from '../../shared/graph/materialNode.ts';
import { effectiveVideoOperations, groupMatchesEffectiveVideoVersion, resolveEffectiveVideoGroup } from '../../shared/validation/lineConstraints.ts';
import { managedVideoLinePricingFingerprint } from '../../shared/validation/managedVideoExecution.ts';
import {
  normalizeNodeIds,
  resolveExecutionSubgraph,
  subgraphContainsMediaGenerate,
  toExecutionMode,
} from '../execution/subgraph.ts';
import {
  type AgentToolSpec,
  type WorkflowAgentDeps,
  objectParams,
  jsonOut,
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  LIST_EXECUTIONS_LIMIT,
  errorBody,
  readString,
  readBoolean,
  resolveWorkspace,
  withWorkspace,
  waitForTerminal,
  summarizeNodes,
  WORKSPACE_ID_PARAM_DESC,
  extractSessionContext,
} from './agentToolShared.ts';
import { sessionToWorkspaceId } from '../../shared/sessionWorkspaceId.ts';
import type { CanvasWorkspaceSnapshot, WorkspaceSummary } from '../../shared/canvasTypes.ts';

export function createWorkflowListTool(deps: WorkflowAgentDeps): AgentToolSpec {
  const { store, executionManager, projectStore, resolveSessionWorkspaceDir } = deps;
  return {
    name: 'workflow_list',
    description:
      'List the workflow creative-canvas workspaces of the omnimux-workflow plugin (id, name, version, nodeCount, updatedAt), newest first. Set includeExecutions=true to also get the 5 most recent executions (current process) with status and progress. Read-only. Use workflow_snapshot to inspect one workspace and workflow_run to execute it.',
    parameters: objectParams({
      include_executions: {
        type: 'boolean',
        description: 'Also include the 5 most recent executions (status + progress overview)',
      },
    }),
    output: jsonOut,
    async execute(args, exec?: unknown) {
      const sessionContext = extractSessionContext(exec);
      let workspaceDir = sessionContext.workspaceDir;
      if (!workspaceDir && sessionContext.sessionId && resolveSessionWorkspaceDir) {
        try {
          workspaceDir = resolveSessionWorkspaceDir(sessionContext.sessionId);
        } catch {
          // ignore
        }
      }

      let workspaces: WorkspaceSummary[] = [];

      if (projectStore && workspaceDir) {
        const project = projectStore.findByRoot(workspaceDir);
        if (project) {
          const projectCanvasIds = new Set(
            (project.pages || []).map((p) => p.canvasWorkspaceId).filter(Boolean),
          );
          const allWorkspaces = store.list();
          workspaces = allWorkspaces.filter((w) => projectCanvasIds.has(w.id));
          const foundIds = new Set(workspaces.map((w) => w.id));
          for (const page of project.pages || []) {
            if (page.canvasWorkspaceId && !foundIds.has(page.canvasWorkspaceId)) {
              workspaces.push({
                id: page.canvasWorkspaceId,
                name: page.title || '创作页',
                version: 0,
                nodeCount: 0,
                updatedAt: page.updatedAt || page.createdAt || new Date().toISOString(),
              });
            }
          }
        } else if (sessionContext.sessionId) {
          const defWsId = sessionToWorkspaceId(sessionContext.sessionId);
          if (defWsId) {
            workspaces = store.list().filter((w) => w.id === defWsId);
          }
        }
      } else {
        workspaces = store.list();
      }

      if (!readBoolean(args, 'include_executions')) {
        return { workspaces };
      }
      const executions = executionManager
        .listExecutions()
        .slice(0, LIST_EXECUTIONS_LIMIT);
      return { workspaces, executions };
    },
  };
}

export function createWorkflowRunTool(deps: WorkflowAgentDeps): AgentToolSpec {
  const { store, executionManager, mediaDir, getActiveView } = deps;
  async function report(executionId: string, workspace: CanvasWorkspaceSnapshot, args: Record<string, unknown>) {
    const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0
      ? Math.floor(args.timeout_ms) : DEFAULT_RUN_WAIT_TIMEOUT_MS;
    const { snapshot: final, timedOut } = readBoolean(args, 'wait')
      ? await waitForTerminal(executionManager, executionId, timeoutMs)
      : { snapshot: executionManager.getSnapshot(executionId), timedOut: false };
    if (!final || final.workspaceId !== workspace.id) {
      return errorBody('execution-not-found', `execution ${executionId} does not belong to workspace ${workspace.id}`);
    }
    const durationMs = final.completedAt !== null && final.startedAt !== null
      ? final.completedAt - final.startedAt : null;
    return {
      executionId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      totalNodes: final.totalNodes,
      status: final.status,
      timedOut,
      error: final.error,
      progress: final.progress,
      ...(durationMs !== null ? { durationMs } : {}),
      nodes: summarizeNodes(workspace, new Set(Object.keys(final.nodeStates)), final, mediaDir),
      ...(timedOut ? { hint: 'Execution is still running. Call workflow_run with this execution_id to check it again.' } : {}),
    };
  }
  return {
    name: 'workflow_run',
    description:
      'Run a workflow canvas, or check an existing execution by execution_id without creating another run. Prefer the current canvas from ui_context when workspace_id is omitted. mode "full" runs every node; mode "subset" runs the given node IDs and the inputs they use; mode "single" runs the given node IDs using existing outputs. wait=false returns immediately. wait=true polls until terminal or the timeout (default 120s) and returns per-node results. After a timeout pass the returned executionId as execution_id.',
    parameters: objectParams({
      workspace_id: {
        type: 'string',
        description: WORKSPACE_ID_PARAM_DESC,
      },
      workspace_name: {
        type: 'string',
        description: 'Exact workspace name (fallback when the id is unknown; must be unique)',
      },
      execution_id: {
        type: 'string',
        description: 'Existing executionId to read or wait for. Omit to create a new execution.',
      },
      mode: {
        type: 'string',
        enum: ['full', 'subset', 'single'],
        description: 'Execution scope: full (default), subset (nodeIds + upstream closure), or single (target nodeIds only)',
      },
      node_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required for subset and single modes: node ids to execute',
      },
      wait: {
        type: 'boolean',
        description: 'Wait for a terminal status (bounded by timeout_ms) and return the result summary',
      },
      timeout_ms: {
        type: 'number',
        description: 'wait=true polling budget in milliseconds (default 120000)',
      },
    }),
    output: jsonOut,
    async execute(args) {
      const workspaceId = readString(args, 'workspace_id');
      const workspaceName = readString(args, 'workspace_name');
      const existingId = readString(args, 'execution_id');
      if (args.execution_id !== undefined && (!existingId || !/^[A-Za-z0-9_-]{1,128}$/.test(existingId))) {
        return errorBody('invalid-args', 'execution_id must be a valid execution identifier');
      }
      if (existingId) {
        if (args.mode !== undefined || args.node_ids !== undefined) return errorBody('invalid-args', 'execution_id cannot be combined with mode or node_ids');
        const snapshot = executionManager.getSnapshot(existingId);
        if (!snapshot || (workspaceId && snapshot.workspaceId !== workspaceId)) {
          return errorBody('execution-not-found', `execution ${existingId} not found in this workspace`);
        }
        return withWorkspace(store, snapshot.workspaceId, async (workspace) =>
          workspaceName && workspace.name !== workspaceName
            ? errorBody('execution-not-found', `execution ${existingId} not found in this workspace`)
            : report(existingId, workspace, args));
      }
      const resolved = resolveWorkspace(store, workspaceId, workspaceName, { getActiveView });
      if ('error' in resolved) return resolved;
      const workspace = resolved.snapshot;

      let mode: 'full' | 'subset' | 'single';
      try {
        mode = toExecutionMode(args.mode);
      } catch (error) {
        return errorBody(
          'invalid-args',
          error instanceof Error ? error.message : String(error),
        );
      }

      const nodeIds = normalizeNodeIds(args.node_ids);
      let selected;
      try {
        selected = resolveExecutionSubgraph({
          nodes: workspace.nodes,
          edges: workspace.edges,
          executionMode: mode,
          nodeIds,
        });
      } catch (error) {
        return errorBody(
          'invalid-subgraph',
          error instanceof Error ? error.message : String(error),
        );
      }
      if (selected.nodes.length === 0) {
        return errorBody('empty-graph', `workspace ${workspace.id} has no nodes to execute`);
      }
      const readCatalog = deps.getExecutionCatalog ?? deps.getCatalog;
      const { subgraph, readiness, sourceGraph, recovery } = await prepareExecutionAdmission(
        workspace.id, workspace, selected, mode, executionManager,
        readCatalog ? async () => await readCatalog() as CapabilityCatalog | null : undefined, deps.resolveProjectFile,
      );
      if (readiness) {
        return {
          error: 'configuration_error',
          reasonCode: readiness.reasonCode,
          nodeId: readiness.nodeId,
          message: readiness.message,
        };
      }
      if (
        subgraphContainsMediaGenerate(subgraph.nodes as Array<{ type?: string; data?: Record<string, unknown> }>)
        && !store.resolveProjectRoot(workspace.id)
        && !deps.resolveAssetsRoot?.(workspace.id)
      ) {
        return errorBody(
          'project-required',
          `workspace ${workspace.id} is not bound to a local project`,
        );
      }

      if (store.get(workspace.id).version !== workspace.version) {
        return errorBody('version_conflict', '输入已更新，请确认当前内容后重新生成');
      }
      let initialOutputs;
      try {
        initialOutputs = buildInitialOutputs(sourceGraph, subgraph.nodeIdSet, { mediaDir, resolveProjectFile: deps.resolveProjectFile });
      } catch (error) {
        return errorBody((error as { code?: string }).code ?? 'invalid-input', error instanceof Error ? error.message : String(error));
      }

      const entry = executionManager.createExecution({
        workspaceId: workspace.id,
        nodes: subgraph.nodes as unknown as Array<{ id: string; type: string; data?: Record<string, unknown> }>,
        edges: subgraph.edges as unknown as Array<{ source: string; target: string }>,
        maxParallel: workspace.settings.maxParallel,
        initialOutputs,
        ...recovery,
      });
      const executionId = entry.context.id;

      if (!readBoolean(args, 'wait')) {
        return {
          executionId,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          mode,
          totalNodes: subgraph.nodes.length,
          maxParallel: workspace.settings.maxParallel,
          status: entry.context.status,
          hint:
            'Execution started in the background. Call workflow_run with this execution_id to check the same run.',
        };
      }

      const result = await report(executionId, workspace, args);
      return 'status' in result ? { ...result, mode } : result;
    },
  };
}

export function createWorkflowSnapshotTool(deps: WorkflowAgentDeps): AgentToolSpec {
  const { store, getActiveView } = deps;
  return {
    name: 'workflow_snapshot',
    description:
      'Inspect one workflow canvas. Default: compact summary. include_nodes=true returns the full graph. For the groups, modes and parameters currently available to a video generation node, pass node_id.',
    parameters: objectParams({
      workspace_id: {
        type: 'string',
        description: WORKSPACE_ID_PARAM_DESC,
      },
      include_nodes: {
        type: 'boolean',
        description: 'Return the full nodes/edges structure instead of the compact summary',
      },
      node_id: {
        type: 'string',
        description: 'Read the published group choices for this video generation node.',
      },
    }),
    output: jsonOut,
    async execute(args) {
      const resolved = resolveWorkspace(
        store,
        readString(args, 'workspace_id'),
        readString(args, 'workspace_name'),
        { getActiveView },
      );
      if ('error' in resolved) return resolved;
      const workspaceId = resolved.snapshot.id;

      return withWorkspace(store, workspaceId, async (workspace) => {
        const nodeId = readString(args, 'node_id');
        if (args.node_id !== undefined && !nodeId) return errorBody('invalid-args', 'node_id must be a non-empty string');
        if (nodeId) {
          const node = workspace.nodes.find(candidate => candidate.id === nodeId);
          if (!node) return errorBody('node-not-found', `node ${nodeId} not found in workspace ${workspaceId}`);
          if (node.type !== 'material' || node.data?.materialType !== 'video' || resolveNodeKind(node.data) !== 'generate') {
            return errorBody('invalid-args', 'node_id must identify a video generation node');
          }
          const catalog = await (deps.getExecutionCatalog ?? deps.getCatalog)?.() as CapabilityCatalog | null | undefined;
          if (!catalog) return errorBody('catalog_unavailable', '模型目录不可用，请稍后重试');
          const params = readCanvasParams(node);
          const selected = resolveEffectiveVideoGroup(catalog, params.model, params.routing);
          return {
            workspaceId, version: workspace.version, nodeId, catalogFingerprint: catalog.fingerprint,
            selected: { modelId: params.model, groupId: selected?.group?.id, operationId: params.operation },
            models: (catalog.models ?? []).flatMap(model => {
              const version = model.effectiveVideoVersion;
              if (!version || model.selectable === false || model.visible === false) return [];
              const groups = (model.channelGroups ?? []).filter(group => groupMatchesEffectiveVideoVersion(group, version)).map(group => ({
                id: group.id, label: group.label, wireGroup: group.wireGroup, version: group.effectiveVersion,
                pricing: group.pricing, defaultOperationId: group.defaultOperationId,
                videoLineQuote: managedVideoLinePricingFingerprint(group),
                operations: effectiveVideoOperations(group),
              }));
              return groups.length ? [{ id: model.id, label: model.label, version, groups }] : [];
            }),
          };
        }
        if (readBoolean(args, 'include_nodes')) {
          return { workspace };
        }

        const nodeTypeCounts: Record<string, number> = {};
        const materialCounts: Record<string, number> = {};
        for (const node of workspace.nodes) {
          const data = (node.data ?? {}) as Record<string, unknown>;
          const type = typeof node.type === 'string' ? node.type : 'unknown';
          nodeTypeCounts[type] = (nodeTypeCounts[type] ?? 0) + 1;
          const material = typeof data.materialType === 'string' ? data.materialType : 'unknown';
          materialCounts[material] = (materialCounts[material] ?? 0) + 1;
        }
        return {
          summary: {
            id: workspace.id,
            name: workspace.name,
            version: workspace.version,
            nodeCount: workspace.nodes.length,
            edgeCount: workspace.edges.length,
            nodeTypeCounts,
            materialCounts,
            settings: workspace.settings,
            metadata: workspace.metadata,
          },
          hint: 'Pass include_nodes=true for the full node/edge structure.',
        };
      });
    },
  };
}
