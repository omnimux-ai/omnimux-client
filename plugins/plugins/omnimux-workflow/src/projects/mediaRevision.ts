import { createHash } from 'node:crypto';
import { realpathSync, statSync, type BigIntStats } from 'node:fs';
import { realpath, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { isAllowedImportedMedia, sniffMimeType } from '../shared/localMedia.ts';
import { WorkflowStoreError } from '../workflow/workspace/WorkflowStoreError.ts';
import { findCanvasFile, isCanvasWorkspaceId } from './canvasFiles.ts';
import { fileIdentity, SharedFileWork, statIfPresent, withRegularFile } from './asyncFiles.ts';
import { isInsideDir, resolveProjectRelPath, resolveSafeProjectPath } from './paths.ts';

/** Stats only existing workflow media routes; never fetches arbitrary remote URLs. */
export function createMediaRevision(mediaDir: string, resolveProjectFile: (workspaceId: string, relativePath: string) => string) {
  return (source: string): string => {
    if (!source.startsWith('/omnimux-workflow/')) return '';
    const url = new URL(source, 'http://localhost');
    let file: string | undefined;
    const match = /^\/omnimux-workflow\/api\/workspaces\/([^/]+)\/file$/.exec(url.pathname);
    if (match) file = resolveProjectFile(decodeURIComponent(match[1]!), url.searchParams.get('rel') || '');
    else if (url.pathname === '/omnimux-workflow/api/project-file') file = resolveProjectFile(url.searchParams.get('workspace') || '', url.searchParams.get('rel') || '');
    else if (url.pathname === '/omnimux-workflow/api/local-file') {
      const candidate = url.searchParams.get('path') || '';
      if (isAbsolute(candidate) && isAllowedImportedMedia(candidate)) file = candidate;
    } else if (url.pathname.startsWith('/omnimux-workflow/media/')) {
      const root = resolve(mediaDir);
      const candidate = resolve(root, decodeURIComponent(url.pathname.slice('/omnimux-workflow/media/'.length)));
      if (candidate.startsWith(root + sep) && realpathSync(candidate).startsWith(realpathSync(root) + sep)) file = candidate;
      else throw new Error('media-path-outside-root');
    }
    if (!file) return '';
    const stat = statSync(realpathSync(file), { bigint: true });
    if (!stat.isFile()) throw new Error('media-not-file');
    return fileIdentity(stat);
  };
}

export type ResolveCanvasProject = (workspaceId: string, signal?: AbortSignal) => Promise<string | undefined>;
export type MediaRevision = (source: string, resolveProject: ResolveCanvasProject, signal?: AbortSignal) => Promise<string>;

export function createProjectMediaResolver(workspacesDir: string) {
  return async (id: string, rel: string, resolveProject: ResolveCanvasProject, signal?: AbortSignal) => {
    if (!isCanvasWorkspaceId(id)) throw new WorkflowStoreError('invalid-id', `invalid workspace id ${id}`);
    signal?.throwIfAborted();
    const root = await resolveProject(id, signal);
    const canvas = await findCanvasFile(workspacesDir, id, root, signal);
    if (!canvas) throw new WorkflowStoreError('workspace-not-found', `workspace ${id} not found`);
    if (!root) {
      throw new WorkflowStoreError('project-required', `workspace ${id} is not bound to a local project`);
    }
    const name = resolveProjectRelPath(root, rel);
    const file = await resolveSafeProjectPath(name, root, signal);
    const info = await statIfPresent(file, signal);
    signal?.throwIfAborted();
    if (!info) throw new WorkflowStoreError('not-found', `file not found: ${rel}`);
    if (!info.isFile()) throw new WorkflowStoreError('not-a-file', 'path is not a regular file');
    return { file, name, info };
  };
}

export type ResolveProjectMedia = ReturnType<typeof createProjectMediaResolver>;

/** Stats only existing workflow media routes; never fetches arbitrary remote URLs. */
export function createListMediaRevision(mediaDir: string, projectFile: ResolveProjectMedia): MediaRevision {
  return async (source, resolveProject, signal) => {
    if (!source.startsWith('/omnimux-workflow/')) return '';
    signal?.throwIfAborted();
    const url = new URL(source, 'http://localhost');
    const match = /^\/omnimux-workflow\/api\/workspaces\/([^/]+)\/file$/.exec(url.pathname);
    let info: BigIntStats | undefined;
    if (match || url.pathname === '/omnimux-workflow/api/project-file') {
      const id = match ? decodeURIComponent(match[1]!) : url.searchParams.get('workspace') || '';
      ({ info } = await projectFile(id, url.searchParams.get('rel') || '', resolveProject, signal));
    } else if (url.pathname === '/omnimux-workflow/api/local-file') {
      const candidate = url.searchParams.get('path') || '';
      if (isAbsolute(candidate) && isAllowedImportedMedia(candidate)) info = await stat(candidate, { bigint: true });
    } else if (url.pathname.startsWith('/omnimux-workflow/media/')) {
      const root = resolve(mediaDir);
      const candidate = resolve(root, decodeURIComponent(url.pathname.slice('/omnimux-workflow/media/'.length)));
      const physicalRoot = await realpath(root);
      signal?.throwIfAborted();
      const file = await realpath(candidate);
      if (candidate === root || !isInsideDir(candidate, root) || file === physicalRoot || !isInsideDir(file, physicalRoot)) {
        throw new Error('media-path-outside-root');
      }
      info = await stat(file, { bigint: true });
    }
    signal?.throwIfAborted();
    if (!info) return '';
    if (!info.isFile()) throw new Error('media-not-file');
    return fileIdentity(info);
  };
}

const BLOCK_BYTES = 256 * 1024;
interface MediaIntegrity {
  digest: string;
  size: number;
  blocks: string[];
  sniffedMime: string | undefined;
}
const fileDigests = new Map<string, MediaIntegrity>();
const digestReads = new SharedFileWork<MediaIntegrity>();
const DIGEST_CACHE_CAPACITY = 128;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function readBlock(handle: FileHandle, start: number, size: number, signal?: AbortSignal): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(Math.min(BLOCK_BYTES, size - start));
  let offset = 0;
  while (offset < bytes.length) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, start + offset);
    if (!bytesRead) throw new Error('media-changed');
    offset += bytesRead;
  }
  signal?.throwIfAborted();
  return bytes;
}

/** Compute one file version from the same fixed blocks used to verify streamed ranges. */
export async function readMediaIntegrity(path: string, signal?: AbortSignal, expected?: BigIntStats): Promise<MediaIntegrity> {
  signal?.throwIfAborted();
  const info = expected ?? await stat(path, { bigint: true });
  signal?.throwIfAborted();
  if (!info.isFile()) throw new Error('media-not-file');
  const identity = fileIdentity(info);
  const cached = info.ino ? fileDigests.get(identity) : undefined;
  if (cached) return cached;
  return digestReads.run(`${path}\0${identity}`, signal, async readSignal => {
    const result = await withRegularFile(path, readSignal, async (handle, opened) => {
      if (fileIdentity(opened) !== identity) throw new Error('media-changed');
      const hash = createHash('sha256');
      const blocks: string[] = [];
      const size = Number(opened.size);
      let sniffedMime: string | undefined;
      for (let start = 0; start < size; start += BLOCK_BYTES) {
        const block = await readBlock(handle, start, size, readSignal);
        if (start === 0) sniffedMime = sniffMimeType(block);
        blocks.push(sha256(block));
        hash.update(block);
      }
      if (fileIdentity(await handle.stat({ bigint: true })) !== identity) throw new Error('media-changed');
      return { digest: hash.digest('hex'), size, blocks, sniffedMime };
    });
    readSignal.throwIfAborted();
    if (fileIdentity(await stat(path, { bigint: true })) !== identity) throw new Error('media-changed');
    readSignal.throwIfAborted();
    if (info.ino) {
      if (fileDigests.size >= DIGEST_CACHE_CAPACITY) fileDigests.delete(fileDigests.keys().next().value!);
      fileDigests.set(identity, result);
    }
    return result;
  });
}

export async function readMediaContentDigest(path: string, signal?: AbortSignal, expected?: BigIntStats): Promise<string> {
  return (await readMediaIntegrity(path, signal, expected)).digest;
}

/** Verify before yielding so an in-place rewrite can never send bytes for an older URL. */
export async function* verifiedMediaBytes(handle: FileHandle, integrity: MediaIntegrity,
  start: number, end: number, signal?: AbortSignal): AsyncGenerator<Buffer> {
  for (let index = Math.floor(start / BLOCK_BYTES); index * BLOCK_BYTES <= end; index++) {
    const blockStart = index * BLOCK_BYTES;
    const block = await readBlock(handle, blockStart, integrity.size, signal);
    if (sha256(block) !== integrity.blocks[index]) throw new Error('media-changed');
    yield block.subarray(Math.max(start - blockStart, 0), end - blockStart + 1);
  }
}
