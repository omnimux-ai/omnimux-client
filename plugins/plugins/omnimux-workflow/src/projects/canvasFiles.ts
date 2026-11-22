import { join } from 'node:path';
import { resolveSafeProjectPath } from './paths.ts';
import { statIfPresent } from './asyncFiles.ts';

export function isCanvasWorkspaceId(id: string): boolean {
  return /^ws_[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/** Prefer the bound source; a legacy home canvas can still supply a cover before its first open. */
export async function findCanvasFile(workspacesDir: string, id: string, projectRoot?: string, signal?: AbortSignal) {
  const home = await resolveSafeProjectPath(join(workspacesDir, id, 'canvas.json'), workspacesDir, signal);
  if (projectRoot) {
    const file = await resolveSafeProjectPath(join(projectRoot, '.omnimux', 'canvases', `${id}.json`), projectRoot, signal);
    const info = await statIfPresent(file, signal);
    if (info) return { file, info };
  }
  const info = await statIfPresent(home, signal);
  return info ? { file: home, info } : null;
}
