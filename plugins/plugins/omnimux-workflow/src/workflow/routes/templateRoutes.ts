import { ZodError } from 'zod';
import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import { jsonBodyProblem } from '../../http/helpers.ts';
import { TemplateStore } from '../templates/TemplateStore.ts';
import { createTemplatePayloadSchema } from '../templates/templateSchema.ts';
import { notFound, type RouteTry, type WorkflowDispatchRequest } from './dispatch.ts';

export function createTemplateRoutes(store: TemplateStore | undefined): { tryHandle: RouteTry } {
  const listPath = `${WORKFLOW_ROUTE_PREFIX}/api/templates`;
  const itemRe = new RegExp(`^${WORKFLOW_ROUTE_PREFIX}/api/templates/([^/]+)$`);

  const tryHandle: RouteTry = (method, path, req: WorkflowDispatchRequest) => {
    if (!store) return null;

    if (path === listPath) {
      if (method === 'GET') {
        return { status: 200, body: { templates: store.list() } };
      }
      if (method === 'POST') {
        const problem = jsonBodyProblem(req.body);
        if (problem) return problem;
        try {
          const payload = createTemplatePayloadSchema.parse(req.body);
          if (payload.nodes.length < 2) {
            return { status: 400, body: { error: 'invalid-template', message: '模板至少需要 2 个节点' } };
          }
          const template = store.save(payload);
          return { status: 200, body: { template } };
        } catch (error) {
          if (error instanceof ZodError) {
            return {
              status: 400,
              body: {
                error: 'invalid-template',
                message: error.issues.slice(0, 3).map((issue) => issue.message).join('; ') || 'invalid template',
              },
            };
          }
          throw error;
        }
      }
      return notFound();
    }

    const match = itemRe.exec(path);
    if (!match) return null;
    const id = match[1] ?? '';
    if (method === 'GET') {
      const template = store.get(id);
      if (!template) return { status: 404, body: { error: 'not-found', message: 'template not found' } };
      return { status: 200, body: { template } };
    }
    if (method === 'DELETE') {
      const deleted = store.delete(id);
      if (!deleted) return { status: 404, body: { error: 'not-found', message: 'template not found' } };
      return { status: 200, body: { ok: true } };
    }
    return notFound();
  };

  return { tryHandle };
}
