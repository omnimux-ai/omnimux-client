/**
 * Local imported-file routes: native pick + probe + stream by realPath.
 * Never copies the source into the workflow media dir.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api.ts';
import {
  detectMimeFromFile,
  isAllowedImportedMedia,
  looksAbsolutePath,
  mimeFromFilename,
} from '../../shared/localMedia.ts';
import { assertLocalWrite, jsonBodyProblem } from '../../http/helpers.ts';
import { browseDirectory } from '../browseDirectory.ts';
import type { RouteTry, WorkflowDispatchRequest } from './dispatch.ts';

const PROBE_LIMIT = 64;

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

function resolveReadableFile(rawPath: string):
  | { ok: true; path: string }
  | { ok: false; status: number; error: string; message: string } {
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
    real = realpathSync(rawPath);
  } catch {
    return { ok: false, status: 404, error: 'not-found', message: 'file not found' };
  }
  let stat;
  try {
    stat = statSync(real);
  } catch {
    return { ok: false, status: 404, error: 'not-found', message: 'file not found' };
  }
  if (!stat.isFile()) {
    return { ok: false, status: 400, error: 'not-a-file', message: 'path is not a regular file' };
  }
  if (!isAllowedImportedMedia(real)) {
    return { ok: false, status: 415, error: 'unsupported-media', message: 'file type is not an imported media' };
  }
  return { ok: true, path: real };
}

function probeOne(rawPath: string, contentMime: boolean): {
  path: string;
  exists: boolean;
  size?: number;
  mime?: string;
  name?: string;
} {
  const resolved = resolveReadableFile(rawPath);
  if (!resolved.ok) {
    return { path: rawPath, exists: false };
  }
  try {
    const declared = mimeFromFilename(resolved.path);
    const detected = contentMime ? detectMimeFromFile(resolved.path) : declared;
    // ISO base media magic is shared by MP4, MOV, M4A and HEIF.
    const mime = detected === 'video/mp4' && declared && /^(video\/quicktime|audio\/mp4|image\/hei[cf])$/.test(declared)
      ? declared : detected;
    return { path: rawPath, exists: true, size: statSync(resolved.path).size, mime, name: basename(resolved.path) };
  } catch {
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
      const body = (req.body ?? {}) as { kind?: string; extensions?: unknown; multiple?: unknown };
      const kind = body.kind ?? 'file';
      if (kind !== 'file' && kind !== 'directory') {
        return jsonError(400, 'picker-invalid-kind', `unknown pick kind: ${String(kind)}`);
      }
      const { extensions, multiple } = body;
      if (extensions !== undefined && (kind !== 'file' || !Array.isArray(extensions) || extensions.length > PROBE_LIMIT
        || extensions.some(extension => typeof extension !== 'string' || !/^[a-z0-9]{1,12}$/.test(extension)))) {
        return jsonError(400, 'picker-invalid-extensions', 'extensions must be a list of filename extensions');
      }
      if (multiple !== undefined && (kind !== 'file' || typeof multiple !== 'boolean')) {
        return jsonError(400, 'picker-invalid-multiple', 'multiple must be a boolean for a file picker');
      }
      try {
        const options = { ...(extensions ? { extensions } : {}), ...(multiple !== undefined ? { multiple } : {}) };
        const result = extensions !== undefined || multiple !== undefined ? await picker(kind, options) : await picker(kind);
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
      const raw = body.paths.filter((row): row is string => typeof row === 'string').slice(0, PROBE_LIMIT);
      return { status: 200, body: { items: raw.map(path => probeOne(path, body.contentMime === true)) } };
    }

    if (method === 'GET' && path === filePath) {
      const denied = guardLoopback(req);
      if (denied) return denied;
      const url = new URL(req.url, 'http://127.0.0.1');
      const target = url.searchParams.get('path') ?? '';
      const resolved = resolveReadableFile(target);
      if (!resolved.ok) {
        return jsonError(resolved.status, resolved.error, resolved.message);
      }
      // existsSync after realpath: race with unlink between resolve and serve.
      if (!existsSync(resolved.path)) {
        return jsonError(404, 'not-found', 'file not found');
      }
      return { status: 200, file: resolved.path };
    }

    return null;
  };

  return { tryHandle };
}
