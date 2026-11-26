import { readFileSync, realpathSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import type { WorkspaceStore } from '../workflow/workspace/WorkspaceStore.ts';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { CanvasWorkspaceSnapshot } from '../shared/canvasTypes.ts';
import { workspaceSnapshotSchema } from '../workflow/workspace/snapshotSchema.ts';
import { migrateSnapshot } from '../workflow/workspace/snapshotMigration.ts';
import { fileIdentity, mapConcurrent, SharedFileWork, withRegularFile } from './asyncFiles.ts';
import { findCanvasFile, isCanvasWorkspaceId } from './canvasFiles.ts';
import { resolveSafeProjectPath } from './paths.ts';
import { summarizeCover, projectCover, coverUrl, type CoverSummary } from './coverSummary.ts';
import type { MediaRevision, ResolveCanvasProject } from './mediaRevision.ts';

const entrySchema = z.object({
  schemaVersion: z.literal(1), stamp: z.string(), order: z.array(z.string()).max(100000),
  cover: z.object({
    kind: z.enum(['empty', 'document', 'image', 'audio', 'video']), nodeId: z.string().optional(),
    mediaUrl: z.string().refine((url) => Boolean(coverUrl(url))).optional(),
    thumbnailUrl: z.string().refine((url) => Boolean(coverUrl(url))).optional(),
    sourceRevision: z.string().optional(), unavailable: z.boolean().optional(),
  }),
});
interface Page { id: string; canvasWorkspaceId?: string }
interface Entry { stamp: string; order: string[]; cover: CoverSummary }
function withRevision(cover: CoverSummary, body: string | null, poster: string | null): CoverSummary {
  const bodyMissing = body === null;
  const posterMissing = poster === null;
  return { ...cover,
    ...(posterMissing ? { thumbnailUrl: undefined } : {}),
    sourceRevision: JSON.stringify([cover.sourceRevision, body ?? '', poster ?? '', bodyMissing, posterMissing]),
    ...((bodyMissing && !cover.thumbnailUrl) || (posterMissing && (!cover.mediaUrl || bodyMissing)) ? { unavailable: true } : {}),
  };
}

function summarize(stamp: string, nodes: CanvasWorkspaceSnapshot['nodes'], previous?: Entry): Entry {
  const ids = new Set(nodes.map(node => node.id));
  const order = new Set((previous?.order ?? []).filter(id => ids.has(id)));
  for (const id of ids) order.add(id);
  const stableOrder = [...order];
  return { stamp, order: stableOrder, cover: summarizeCover(nodes, stableOrder) };
}

/** Derived per-canvas cache. Source canvas and project timestamps remain untouched. */
export function createProjectCoverService(store: WorkspaceStore, mediaRevision?: (url: string) => string) {
  const versioned = (cover: CoverSummary): CoverSummary => {
    if (!mediaRevision) return cover;
    const readRevision = (url?: string) => {
      try { return url ? mediaRevision(url) : ''; } catch { return null; }
    };
    return withRevision(cover, readRevision(cover.mediaUrl), readRevision(cover.thumbnailUrl));
  };
  const memory = new Map<string, Entry>();
  function pageCover(page: Page): CoverSummary {
    const id = page.canvasWorkspaceId;
    if (!id || !isCanvasWorkspaceId(id)) return { kind: 'empty' };
    const cacheFile = join(store.workspacesDir, id, 'cover-summary.json');
    let previous = memory.get(id);
    if (!previous) {
      try {
        const saved = entrySchema.safeParse(JSON.parse(readFileSync(cacheFile, 'utf8')));
        if (saved.success) previous = saved.data;
      } catch { /* Cache misses are rebuilt from the canvas. */ }
    }
    try {
      const source = realpathSync(store.canvasFileOf(id));
      const stamp = `${source}:${fileIdentity(statSync(source, { bigint: true }))}`;
      if (previous?.stamp === stamp) { memory.set(id, previous); return previous.cover; }
      const entry = summarize(stamp, store.get(id).nodes, previous);
      memory.set(id, entry);
      try {
        mkdirSync(join(cacheFile, '..'), { recursive: true });
        const tmp = `${cacheFile}.tmp-${process.pid}`;
        writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, ...entry }));
        renameSync(tmp, cacheFile);
      } catch { /* Read-only disks may still serve an in-memory summary. */ }
      if (memory.size > 512) memory.delete(memory.keys().next().value!);
      return entry.cover;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        memory.delete(id);
        return previous ? { kind: 'empty', unavailable: true } : { kind: 'empty' };
      }
      return { ...(previous?.cover ?? { kind: 'empty' }), unavailable: true };
    }
  }
  return function enrich<T extends { pages?: Page[] }>(project: T) {
    const pages = (project.pages ?? []).map((page) => ({ ...page, cover: versioned(pageCover(page)) }));
    return { ...project, pages, cover: projectCover(pages.map((page) => page.cover)) };
  };
}

/** Derived per-canvas cache. A project listing only reads the source canvas. */
export function createProjectListCoverService(workspacesDir: string, mediaRevision?: MediaRevision) {
  const memory = new Map<string, Entry>();
  const summaries = new SharedFileWork<CoverSummary>();

  async function pageCover(id: string, projectRoot: string | undefined, signal: AbortSignal): Promise<CoverSummary> {
    let previous = memory.get(id);
    let cacheFileResolved = false;
    let cacheFile: string | undefined;
    const resolveCacheFile = async () => {
      if (cacheFileResolved) return cacheFile;
      cacheFileResolved = true;
      cacheFile = await resolveSafeProjectPath(join(workspacesDir, id, 'cover-summary.json'), workspacesDir, signal).catch(() => {
        signal.throwIfAborted();
        return undefined;
      });
      return cacheFile;
    };
    try {
      if (!previous) {
        const diskCache = await resolveCacheFile();
        if (diskCache) {
          try {
            const raw = await withRegularFile(diskCache, signal, handle => handle.readFile({ encoding: 'utf8', signal }), true);
            const saved = entrySchema.safeParse(JSON.parse(raw));
            if (saved.success) previous = saved.data;
          } catch { signal.throwIfAborted(); /* Cache misses are rebuilt from the canvas. */ }
        }
      }
      const source = await findCanvasFile(workspacesDir, id, projectRoot, signal);
      if (!source) {
        memory.delete(id);
        return previous ? { kind: 'empty', unavailable: true } : { kind: 'empty' };
      }
      if (previous?.stamp === `${source.file}:${fileIdentity(source.info)}`) {
        memory.set(id, previous);
        return previous.cover;
      }
      const entry = await withRegularFile(source.file, signal, async (handle, info) => {
        const raw = await handle.readFile({ encoding: 'utf8', signal });
        const snapshot = migrateSnapshot(workspaceSnapshotSchema.parse(JSON.parse(raw)) as CanvasWorkspaceSnapshot);
        return summarize(`${source.file}:${fileIdentity(info)}`, snapshot.nodes, previous);
      }, true);
      signal.throwIfAborted();
      memory.set(id, entry);
      if (memory.size > 512) memory.delete(memory.keys().next().value!);
      const targetCacheFile = await resolveCacheFile();
      if (!targetCacheFile) return entry.cover;
      const tmp = `${targetCacheFile}.tmp-${randomUUID()}`;
      try {
        await mkdir(dirname(targetCacheFile), { recursive: true });
        await writeFile(tmp, JSON.stringify({ schemaVersion: 1, ...entry }), { flag: 'wx', signal });
        signal.throwIfAborted();
        await rename(tmp, targetCacheFile);
      } catch {
        await rm(tmp, { force: true }).catch(() => undefined);
        signal.throwIfAborted();
        // Read-only disks may still serve the in-memory summary.
      }
      return entry.cover;
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        memory.delete(id);
        return previous ? { kind: 'empty', unavailable: true } : { kind: 'empty' };
      }
      return { ...(previous?.cover ?? { kind: 'empty' }), unavailable: true };
    }
  }

  return async function enrich<T extends { pages: Page[] }>(projects: T[],
    resolveProject: (id: string) => string | undefined, resolveAssets: ResolveCanvasProject, signal?: AbortSignal) {
    const ids = new Set<string>();
    for (const project of projects) {
      for (const { canvasWorkspaceId: id } of project.pages) {
        if (id && isCanvasWorkspaceId(id)) ids.add(id);
      }
    }
    const revisions = new Map<string, Promise<string | null>>();
    function revision(url?: string) {
      if (!url || !mediaRevision) return '';
      let result = revisions.get(url);
      if (!result) {
        result = mediaRevision(url, resolveAssets, signal).catch(() => {
          signal?.throwIfAborted();
          return null;
        });
        revisions.set(url, result);
      }
      return result;
    }
    const covers = new Map(await mapConcurrent([...ids], 8, async id => {
      const root = resolveProject(id);
      const cover = await summaries.run(JSON.stringify([id, root]), signal, readSignal => pageCover(id, root, readSignal));
      return [id, mediaRevision ? withRevision(cover, await revision(cover.mediaUrl), await revision(cover.thumbnailUrl)) : cover] as const;
    }, signal));
    return projects.map(project => {
      const pages = project.pages.map(page => ({
        ...page, cover: covers.get(page.canvasWorkspaceId ?? '') ?? { kind: 'empty' as const },
      }));
      return { ...project, pages, cover: projectCover(pages.map(page => page.cover)) };
    });
  };
}
