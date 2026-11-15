/**
 * Minimal app execution bridge for workflow-published AI apps.
 *
 * Production can keep using the omnimux-apps `__OMNIMUX_APPS_EXECUTE__`
 * bridge; this route is the fallback that makes a published manifest runnable
 * inside the workflow host without a second app runtime.
 */

import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import { assertLocalWrite, jsonBodyProblem } from '../../http/helpers.ts';
import { createWorkflowLogger } from '../execution/logger.ts';
import type { HeadlessExecutionSeam } from '../execution/HeadlessExecutionSeam.ts';
import type { RouteTry, WorkflowDispatchRequest } from './dispatch.ts';

export interface AppExecutionRouteDeps {
  headlessSeam?: HeadlessExecutionSeam;
}

interface AppExecutionBody {
  manifest?: {
    appId?: string;
    workflowBinding?: {
      workspaceId?: string;
      snapshot?: { nodes?: unknown[]; edges?: unknown[] };
    };
    publishPlan?: unknown;
  };
  inputs?: Record<string, unknown>;
}

const APP_EXECUTIONS_ROUTE = new RegExp(`^${WORKFLOW_ROUTE_PREFIX}/api/apps/executions$`);

export function createAppExecutionRoutes(deps: AppExecutionRouteDeps): { tryHandle: RouteTry } {
  const logger = createWorkflowLogger('app-executions');
  return {
    tryHandle: async (method, path, req: WorkflowDispatchRequest) => {
      if (method !== 'POST' || !APP_EXECUTIONS_ROUTE.test(path)) return null;
      if (!deps.headlessSeam) {
        return { status: 503, body: { error: 'app-runtime-unavailable', message: '应用运行服务未就绪' } };
      }
      try {
        assertLocalWrite(req);
      } catch {
        return { status: 403, body: { error: 'not-local', message: '拒绝跨来源的应用执行请求' } };
      }
      const problem = jsonBodyProblem(req.body);
      if (problem) return problem;
      const body = req.body as AppExecutionBody;
      const workspaceId = body.manifest?.workflowBinding?.workspaceId;
      const snapshot = body.manifest?.workflowBinding?.snapshot;
      const publishPlan = body.manifest?.publishPlan;
      if (!workspaceId || !snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0 || !publishPlan) {
        return { status: 400, body: { error: 'invalid-manifest', message: '应用 manifest 缺少执行所需快照' } };
      }
      const started = Date.now();
      try {
        const job = await deps.headlessSeam.executeHeadless({
          workspaceId,
          snapshot: snapshot as never,
          inputs: body.inputs,
          publishPlan: publishPlan as never,
          caller: { appId: body.manifest?.appId },
        });
        logger.info('app execution started', {
          appId: body.manifest?.appId,
          executionId: job.executionId,
          durationMs: Date.now() - started,
        });
        return {
          status: 200,
          body: {
            executionId: job.executionId,
            jobId: job.jobId,
            workspaceId,
            status: job.status,
          },
        };
      } catch (error) {
        logger.error('app execution failed to start', {
          appId: body.manifest?.appId,
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          status: 400,
          body: {
            error: 'app-execution-failed',
            message: error instanceof Error ? error.message : '应用执行启动失败',
          },
        };
      }
    },
  };
}
