import { WORKFLOW_API_ROUTES } from '../../shared/api';
import type { WorkflowTemplate } from '../../workflow/templates/templateSchema.ts';
import { request, type ApiResult } from './apiClient';

export type { ApiResult };

export function listTemplates(): Promise<ApiResult<{ templates: WorkflowTemplate[] }>> {
  return request<{ templates: WorkflowTemplate[] }>(WORKFLOW_API_ROUTES.templates);
}

export function createTemplate(payload: {
  name: string;
  description?: string;
  tags?: string[];
  nodes: unknown[];
  edges: unknown[];
}): Promise<ApiResult<{ template: WorkflowTemplate }>> {
  return request<{ template: WorkflowTemplate }>(WORKFLOW_API_ROUTES.templates, {
    method: 'POST',
    body: payload,
  });
}

export function getTemplate(id: string): Promise<ApiResult<{ template: WorkflowTemplate }>> {
  return request<{ template: WorkflowTemplate }>(WORKFLOW_API_ROUTES.template(encodeURIComponent(id)));
}

export function deleteTemplate(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return request<{ ok: boolean }>(WORKFLOW_API_ROUTES.template(encodeURIComponent(id)), {
    method: 'DELETE',
  });
}
