/**
 * Media static route (traversal- and symlink-guarded).
 */
import { realpath } from 'node:fs/promises';
import { statIfPresent } from '../../projects/asyncFiles.ts';
import { isInsideDir } from '../../projects/paths.ts';
import { join, normalize, resolve } from 'node:path';
import { WORKFLOW_ROUTE_PREFIX } from '../../shared/api';
import type { RouteTry } from './dispatch';

export function createMediaRoutes(mediaDir: string): { tryHandle: RouteTry } {
  const mediaRoot = resolve(mediaDir);
  const mediaApiPath = `${WORKFLOW_ROUTE_PREFIX}/media/`;

  const tryHandle: RouteTry = async (method, path, req) => {
    if (!((method === 'GET' || method === 'HEAD') && path.startsWith(mediaApiPath))) return null;
    req.signal?.throwIfAborted();
    const rel = path.slice(mediaApiPath.length);
    // Explicit '..' segment check: attempts to escape -> 403 (the
    // normalize() clamp below additionally prevents silent escapes).
    if (rel.split('/').some((segment) => segment === '..')) {
      return { status: 403, body: { error: 'path-denied', message: 'path escapes media root' } };
    }
    const target = resolve(join(mediaRoot, normalize(`/${rel}`)));
    // Lexical pre-check first (cheap, catches plain traversal)…
    if (!isInsideDir(target, mediaRoot)) {
      return { status: 403, body: { error: 'path-denied', message: 'path escapes media root' } };
    }
    // …then resolve symlinks on BOTH ends (M2 QA fix #3): a symlink
    // inside media/ pointing outside must not be served. realpath
    // failure (missing file / broken link) maps to 404.
    let realTarget: string;
    try {
      const realRoot = await realpath(mediaRoot);
      req.signal?.throwIfAborted();
      realTarget = await realpath(target);
      if (!isInsideDir(realTarget, realRoot)) {
        return { status: 403, body: { error: 'path-denied', message: 'path escapes media root' } };
      }
    } catch {
      return { status: 404, body: { error: 'not-found', message: 'media file not found' } };
    }
    req.signal?.throwIfAborted();
    if (!(await statIfPresent(realTarget, req.signal))?.isFile()) {
      return { status: 404, body: { error: 'not-found', message: 'media file not found' } };
    }
    return { status: 200, file: realTarget, canonical: true };
  };

  return { tryHandle };
}
