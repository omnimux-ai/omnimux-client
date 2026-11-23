/**
 * Local imported-file routes: native pick + probe + stream by realPath.
 * Never copies the source into the workflow media dir.
 */
import { realpath, stat } from 'node:fs/promises';
import { fileIdentity, mapConcurrent, withRegularFile } from '../../projects/asyncFiles.ts';
import { basename, isAbsolute } from 'node:path';
import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import { MATERIAL_TYPES } from '../../shared/graph/materialNode.ts';
import {
  LOCAL_FILE_PROBE_LIMIT,
  detectMimeFromHandle,
  extensionsForSlotFiles,
  isAllowedImportedMedia,
  looksAbsolutePath,
  mimeFromFilename,
  type LocalMediaProbeItem,
  type SlotFileFilter,
} from '../../shared/localMedia.ts';
import { assertLocalWrite, jsonBodyProblem } from '../../http/helpers.ts';
import { browseDirectory } from '../browseDirectory.ts';
import type { RouteTry, WorkflowDispatchRequest } from './dispatch.ts';

const PICKER_PROMPTS = {
  file: '选择要导入的素材',
  directory: '选择要导入的文件夹',
} as const;

export type NativePickerKind = 'file' | 'directory';

interface NativePickerOptions {
  prompt?: string;
  extensions?: string[];
  multiple?: boolean;
}

type NativePicker = (
  kind: NativePickerKind,
  options?: NativePickerOptions,
) => Promise<{ path: string | null; paths: string[] }>;

export interface LocalFileRouteDeps {
  /** Injected picker (tests). Production reads the hub `nativeFilePicker` seam. */
  picker?: NativePicker;
  /** Lazy neutral seam lookup from the host context. */
  getService?: (name: string) => unknown;
}

function nativePickerFromSeam(getService?: (name: string) => unknown): NativePicker {
  return async (kind, options) => {
    const seam = getService?.('nativeFilePicker') as { pick?: NativePicker } | undefined;
    if (!seam || typeof seam.pick !== 'function') {
      throw Object.assign(new Error('nativeFilePicker seam is unavailable'), { code: 'picker-unavailable' });
    }
    return seam.pick(kind, { ...options, prompt: PICKER_PROMPTS[kind] });
  };
}

function pickerCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('picker-') ? code : null;
}

function jsonError(status: number, error: string, message: string) {
  return { status, body: { error, message } };
}

function isCrossSite(req: WorkflowDispatchRequest): boolean {
  const site = String(req.secFetchSite || '').toLowerCase();
  if (site === 'cross-site') return true;
  try {
    assertLocalWrite(req);
    return false;
  } catch {
    return Boolean(req.origin || req.referer);
  }
}

function guardLoopback(req: WorkflowDispatchRequest): ReturnType<typeof jsonError> | null {
  if (isCrossSite(req)) {
    return jsonError(403, 'not-local', 'cross-origin local-file access refused');
  }
  return null;
}

async function resolveReadableFile(rawPath: string, signal?: AbortSignal): Promise<
  | { ok: true; path: string; size: number }
  | { ok: false; status: number; error: string; message: string }> {
  signal?.throwIfAborted();
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return { ok: false, status: 400, error: 'invalid-path', message: 'path is required' };
  }
  if (rawPath.includes('\0')) {
    return { ok: false, status: 400, error: 'invalid-path', message: 'path contains NUL' };
  }
  if (!looksAbsolutePath(rawPath) || !isAbsolute(rawPath)) {
    return { ok: false, status: 400, error: 'invalid-path', message: 'path must be absolute' };
  }
  let real: string;
  try {
    real = await realpath(rawPath);
  } catch {
    return { ok: false, status: 404, error: 'not-found', message: 'file not found' };
  }
  signal?.throwIfAborted();
  let info;
  try {
    info = await stat(real);
  } catch {
    return { ok: false, status: 404, error: 'not-found', message: 'file not found' };
  }
  signal?.throwIfAborted();
  if (!info.isFile()) {
    return { ok: false, status: 400, error: 'not-a-file', message: 'path is not a regular file' };
  }
  if (!isAllowedImportedMedia(real)) {
    return { ok: false, status: 415, error: 'unsupported-media', message: 'file type is not an imported media' };
  }
  return { ok: true, path: real, size: info.size };
}

function isSlotFileFilter(value: unknown): value is SlotFileFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const filter = value as Partial<SlotFileFilter>;
  return typeof filter.slot === 'string' && Boolean(filter.slot.trim()) && filter.slot.length <= 128
    && filter.materialType !== undefined && MATERIAL_TYPES.includes(filter.materialType)
    && (filter.allowedMimes === undefined || Array.isArray(filter.allowedMimes) && filter.allowedMimes.length <= LOCAL_FILE_PROBE_LIMIT
      && filter.allowedMimes.every(mime => typeof mime === 'string' && /^[a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,64}$/i.test(mime)));
}

async function probeOne(rawPath: string, contentMime: boolean, signal?: AbortSignal): Promise<LocalMediaProbeItem> {
  const resolved = await resolveReadableFile(rawPath, signal);
  if (!resolved.ok) {
    return { path: rawPath, exists: false };
  }
  try {
    const metadata = contentMime
      ? await withRegularFile(resolved.path, signal, async (handle, info) => ({
          mime: await detectMimeFromHandle(handle, resolved.path, undefined, signal),
          size: Number(info.size),
          revision: fileIdentity(info),
        }), true)
      : { mime: mimeFromFilename(resolved.path), size: resolved.size };
    return { path: rawPath, exists: true, ...metadata, name: basename(resolved.path) };
  } catch {
    signal?.throwIfAborted();
    return { path: rawPath, exists: false };
  }
}

export function createLocalFileRoutes(deps: LocalFileRouteDeps = {}): { tryHandle: RouteTry } {
  const picker = deps.picker ?? nativePickerFromSeam(deps.getService);
  const pickPath = `${WORKFLOW_ROUTE_PREFIX}/api/pick`;
  const browsePath = `${WORKFLOW_ROUTE_PREFIX}/api/browse-directory`;
  const filePath = `${WORKFLOW_ROUTE_PREFIX}/api/local-file`;
  const probePath = `${WORKFLOW_ROUTE_PREFIX}/api/local-file/probe`;

  const tryHandle: RouteTry = async (method, path, req) => {
    if (method === 'POST' && path === pickPath) {
      const denied = guardLoopback(req);
      if (denied) return denied;
      const problem = jsonBodyProblem(req.body);
      if (problem) return problem;
      const body = (req.body ?? {}) as { kind?: string; extensions?: unknown; multiple?: unknown; slotFilter?: unknown };
      const kind = body.kind ?? 'file';
      if (kind !== 'file' && kind !== 'directory') {
        return jsonError(400, 'picker-invalid-kind', `unknown pick kind: ${String(kind)}`);
      }
      const { extensions, multiple, slotFilter } = body;
      if (extensions !== undefined && (kind !== 'file' || !Array.isArray(extensions) || extensions.length > LOCAL_FILE_PROBE_LIMIT
        || extensions.some(extension => typeof extension !== 'string' || !/^[a-z0-9]{1,12}$/.test(extension)))) {
        return jsonError(400, 'picker-invalid-extensions', 'extensions must be a list of filename extensions');
      }
      if (multiple !== undefined && (kind !== 'file' || typeof multiple !== 'boolean')) {
        return jsonError(400, 'picker-invalid-multiple', 'multiple must be a boolean for a file picker');
      }
      let nativeExtensions = extensions as string[] | undefined;
      if (slotFilter !== undefined) {
        if (kind !== 'file' || !isSlotFileFilter(slotFilter)) {
          return jsonError(400, 'picker-invalid-extensions', 'invalid named slot file filter');
        }
        nativeExtensions = extensionsForSlotFiles(slotFilter, nativeExtensions);
        // An empty native filter would otherwise mean all file types.
        if (!nativeExtensions.length) return { status: 200, body: { path: null, paths: [] } };
      }
      try {
        const options = { ...(nativeExtensions ? { extensions: nativeExtensions } : {}), ...(multiple !== undefined ? { multiple } : {}) };
        const result = nativeExtensions !== undefined || multiple !== undefined ? await picker(kind, options) : await picker(kind);
        const paths = Array.isArray(result.paths)
          ? result.paths.filter((row) => typeof row === 'string' && row !== '')
          : [];
        return { status: 200, body: { path: paths[0] ?? result.path ?? null, paths } };
      } catch (error) {
        const code = pickerCode(error);
        if (code) {
          const status =
            code === 'picker-unsupported' ? 501
            : code === 'picker-invalid-kind' ? 400
            : code === 'picker-unavailable' ? 503
            : 500;
          return jsonError(status, code, error instanceof Error ? error.message : String(error));
        }
        return jsonError(500, 'picker-failed', error instanceof Error ? error.message : String(error));
      }
    }

    if (method === 'POST' && path === browsePath) {
      const denied = guardLoopback(req);
      if (denied) return denied;
      const problem = jsonBodyProblem(req.body);
      if (problem) return problem;
      const body = (req.body ?? {}) as { path?: unknown };
      try {
        const listed = browseDirectory(body.path);
        return { status: 200, body: listed };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: string }).code || 'browse-failed')
          : 'browse-failed';
        const status = code === 'invalid-path' || code === 'not-directory' ? 400
          : code === 'not-found' ? 404
          : code === 'unreadable' || code === 'path-denied' ? 403
          : 500;
        return jsonError(status, code, error instanceof Error ? error.message : String(error));
      }
    }

    if (method === 'POST' && path === probePath) {
      const denied = guardLoopback(req);
      if (denied) return denied;
      const problem = jsonBodyProblem(req.body);
      if (problem) return problem;
      const body = (req.body ?? {}) as { paths?: unknown; contentMime?: boolean };
      if (!Array.isArray(body.paths)) {
        return jsonError(400, 'invalid-json', 'paths must be an array');
      }
      const raw = body.paths.filter((row): row is string => typeof row === 'string').slice(0, LOCAL_FILE_PROBE_LIMIT);
      const items = await mapConcurrent(raw, 2, path => probeOne(path, body.contentMime === true, req.signal), req.signal);
      return { status: 200, body: { items } };
    }

    if (method === 'GET' && path === filePath) {
      const denied = guardLoopback(req);
      if (denied) return denied;
      const url = new URL(req.url, 'http://127.0.0.1');
      const target = url.searchParams.get('path') ?? '';
      const resolved = await resolveReadableFile(target, req.signal);
      if (!resolved.ok) {
        return jsonError(resolved.status, resolved.error, resolved.message);
      }
      return { status: 200, file: resolved.path, canonical: true };
    }

    return null;
  };

  return { tryHandle };
}
