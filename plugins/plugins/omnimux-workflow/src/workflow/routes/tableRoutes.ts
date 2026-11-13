/**
 * Tabular document REST routes (.htable L2 persistence).
 *
 *   GET    /omnimux-workflow/api/workspaces/:wsId/tables/:tableId
 *   PUT    /omnimux-workflow/api/workspaces/:wsId/tables/:tableId
 *   DELETE /omnimux-workflow/api/workspaces/:wsId/tables/:tableId
 */

import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import { assertLocalWrite, jsonBodyProblem } from '../../http/helpers.ts';
import type { SaveWorkspaceTablePayload } from '../../shared/api.ts';
import type { WorkspaceStore } from '../workspace/WorkspaceStore.ts';
import { TableStorageService, TableStorageError } from '../storage/TableStorageService.ts';
import {
  resolveTableAbsPath,
  resolveTableRelativePath,
  validateTableId,
  TablePathError,
} from '../storage/tablePath.ts';
import { notFound, type RouteTry, type WorkflowDispatchRequest } from './dispatch.ts';

export function createTableRoutes(workspaceStore: WorkspaceStore): { tryHandle: RouteTry } {
  const tableItemRe = new RegExp(`^${WORKFLOW_ROUTE_PREFIX}/api/workspaces/([^/]+)/tables/([^/]+)$`);

  const tryHandle: RouteTry = async (method, path, req: WorkflowDispatchRequest) => {
    const tableMatch = tableItemRe.exec(path);
    if (!tableMatch) return null;

    const workspaceId = tableMatch[1] ?? '';
    const tableId = tableMatch[2] ?? '';

    if (!validateTableId(tableId)) {
      return { status: 400, body: { error: 'invalid-id', message: `Invalid table id: ${tableId}` } };
    }

    let absPath: string;
    let relPath: string;
    try {
      absPath = resolveTableAbsPath(workspaceStore, workspaceId, tableId, { checkLegacy: method === 'GET' });
      relPath = resolveTableRelativePath(tableId);
    } catch (err) {
      if (err instanceof TablePathError) {
        return { status: 400, body: { error: err.code, message: err.message } };
      }
      return { status: 500, body: { error: 'internal-error', message: String(err) } };
    }

    if (method === 'GET') {
      const exists = await TableStorageService.exists(absPath);
      if (!exists) {
        return { status: 404, body: { error: 'table-not-found', message: `Table file not found for tableId: ${tableId}` } };
      }
      try {
        const doc = await TableStorageService.loadTable(absPath);
        return {
          status: 200,
          body: {
            table: {
              tableId,
              tablePath: relPath,
              contentRev: doc.contentRev ?? 0,
              rowCount: doc.rows.length,
              columnCount: doc.columns.length,
              title: doc.title,
              document: doc,
            },
          },
        };
      } catch (err: any) {
        return { status: 500, body: { error: 'table-corrupted', message: err.message || 'Failed to read table file' } };
      }
    }

    if (method === 'PUT') {
      try {
        assertLocalWrite(req);
      } catch {
        return { status: 403, body: { error: 'not-local', message: 'cross-origin write refused' } };
      }

      const problem = jsonBodyProblem(req.body);
      if (problem) return problem;

      const body = req.body as Partial<SaveWorkspaceTablePayload>;
      if (typeof body.expectedRev !== 'number') {
        return { status: 400, body: { error: 'rev-required', message: 'expectedRev number is required for saves' } };
      }
      if (!body.document || typeof body.document !== 'object') {
        return { status: 400, body: { error: 'invalid-document', message: 'document object is required' } };
      }

      try {
        const result = await TableStorageService.saveTable(absPath, body.document, {
          expectedRev: body.expectedRev,
        });

        return {
          status: 200,
          body: {
            table: {
              tableId,
              tablePath: relPath,
              contentRev: result.contentRev,
              rowCount: result.document.rows.length,
              columnCount: result.document.columns.length,
              title: result.document.title,
              document: result.document,
            },
          },
        };
      } catch (err: any) {
        if (err instanceof TableStorageError && err.code === 'version_conflict') {
          return {
            status: 409,
            body: {
              error: 'version_conflict',
              message: err.message,
              currentRev: err.currentRev,
            },
          };
        }
        return { status: 400, body: { error: 'save-failed', message: err.message || 'Failed to save table file' } };
      }
    }

    if (method === 'DELETE') {
      try {
        assertLocalWrite(req);
      } catch {
        return { status: 403, body: { error: 'not-local', message: 'cross-origin write refused' } };
      }

      try {
        await TableStorageService.deleteTable(absPath);
        return { status: 200, body: { ok: true } };
      } catch (err: any) {
        return { status: 500, body: { error: 'delete-failed', message: err.message || 'Failed to delete table file' } };
      }
    }

    return notFound();
  };

  return { tryHandle };
}
