/**
 * `project-asset` and `canvas-node` providers for the hub `mediaResolver` seam,
 * plus shared upstream node media resolution for `workflowClip.listUpstreamSources`.
 *
 * Security invariants:
 * - Enforces workspace ACL (`canAccessWorkspace`) when configured.
 * - Enforces lexical + realpath symlink containment for project and media roots.
 * - Rejects SVG, directories, and non-media payloads.
 * - Never returns raw host paths inside canonical handles or fingerprints.
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import type { SerializedCanvasNode } from '../../shared/canvasTypes.ts';
import { resolveNodeOutputType } from '../../shared/graph/materialNode.ts';
import {
  isAllowedImportedMedia,
  looksAbsolutePath,
  mimeFromFilename,
  projectFileMediaUrl,
} from '../../shared/localMedia.ts';
import { fileIdentity } from '../../projects/asyncFiles.ts';
import { readMediaIntegrity, verifiedMediaBytes } from '../../projects/mediaRevision.ts';
import { isInsideDir, resolveProjectRelPath, resolveSafeProjectPath } from '../../projects/paths.ts';
import type { ProjectAssetsStore } from '../workspace/ProjectAssetsStore.ts';
import type { WorkspaceStore } from '../workspace/WorkspaceStore.ts';

export type ProjectAssetHandle = {
  v: 1;
  scope: 'project-asset';
  workspaceId: string;
  assetId?: string;
  rel: string;
  sha256?: string;
};

export type CanvasNodeHandle = {
  v: 1;
  scope: 'canvas-node';
  workspaceId: string;
  nodeId: string;
  outputIndex: number;
  sha256?: string;
};

export type WorkflowMediaHandle = ProjectAssetHandle | CanvasNodeHandle;

export interface MediaAuthContext {
  sessionId?: string;
}

export interface WorkflowMediaProvidersDeps {
  store: Pick<WorkspaceStore, 'get' | 'workspacesDir'>;
  assetsStore: Pick<ProjectAssetsStore, 'get'>;
  resolveAssetsRoot: (workspaceId: string) => { path: string } | null;
  mediaDir: string;
  canAccessWorkspace?: (workspaceId: string, sessionId: string) => boolean;
}

export interface ResolvedUpstreamNodeSource {
  sourceNodeId: string;
  outputIndex: number;
  materialType: 'video' | 'audio' | 'image';
  name: string;
  durationMs?: number;
  canonicalHandle: ProjectAssetHandle | CanvasNodeHandle;
  currentSha256: string;
  size: number;
  mimeType: string;
  legacyFingerprints: string[];
}

const WORKSPACE_FILE_RE = /^\/omnimux-workflow\/api\/workspaces\/(ws_[A-Za-z0-9_-]{1,128})\/file$/u;
const MEDIA_TYPES = new Set(['video', 'audio', 'image']);

function mediaError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isSupportedMediaMime(mime: string | undefined, displayName: string): mime is string {
  if (!mime || /\.svgz?$/iu.test(displayName)) return false;
  const normalized = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!normalized || normalized === 'image/svg+xml') return false;
  return normalized.startsWith('video/') || normalized.startsWith('audio/') || normalized.startsWith('image/');
}

function checkWorkspaceAccess(
  deps: Pick<WorkflowMediaProvidersDeps, 'canAccessWorkspace'>,
  workspaceId: string,
  auth: MediaAuthContext,
): boolean {
  if (!deps.canAccessWorkspace) return true;
  if (!auth.sessionId) return false;
  return deps.canAccessWorkspace(workspaceId, auth.sessionId);
}

async function* streamVerifiedFile(
  realPath: string,
  expectedIdentity: string,
  integrity: Awaited<ReturnType<typeof readMediaIntegrity>>,
  start: number,
  end: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fh = await open(realPath, flags);
  try {
    const opened = await fh.stat({ bigint: true });
    if (!opened.isFile() || fileIdentity(opened) !== expectedIdentity) {
      throw mediaError('media-changed', 'Media file changed before streaming.');
    }
    if (integrity.size === 0 || start > end) return;
    yield* verifiedMediaBytes(fh, integrity, start, end, signal);
  } finally {
    await fh.close();
  }
}

interface InspectedFile {
  status: 'ok' | 'digest_mismatch' | 'not_found' | 'access_denied' | 'unsupported';
  realPath?: string;
  expectedIdentity?: string;
  integrity?: Awaited<ReturnType<typeof readMediaIntegrity>>;
  mimeType?: string;
  displayName?: string;
  canonicalHandle?: ProjectAssetHandle | CanvasNodeHandle;
  error?: Error & { code: string };
}

async function inspectDiskMedia(
  realPath: string,
  canonicalBase: Omit<ProjectAssetHandle, 'sha256'> | Omit<CanvasNodeHandle, 'sha256'>,
  expectedSha256: string | undefined,
  signal?: AbortSignal,
): Promise<InspectedFile> {
  signal?.throwIfAborted();
  let info;
  try {
    info = await stat(realPath, { bigint: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { status: 'not_found', error: mediaError('media-not-found', 'Media file was not found.') };
    }
    throw error;
  }
  if (!info.isFile()) {
    return { status: 'unsupported', error: mediaError('unsupported-media', 'Media target is not a regular file.') };
  }
  const integrity = await readMediaIntegrity(realPath, signal, info);
  const displayName = basename(realPath);
  const mimeType = integrity.sniffedMime ?? mimeFromFilename(displayName);
  if (integrity.size <= 0 || !isSupportedMediaMime(mimeType, displayName)) {
    return { status: 'unsupported', error: mediaError('unsupported-media', 'Media file type is unsupported or empty.') };
  }
  const canonicalHandle = { ...canonicalBase, sha256: integrity.digest } as ProjectAssetHandle | CanvasNodeHandle;
  const expectedIdentity = fileIdentity(info);
  if (expectedSha256 && expectedSha256 !== integrity.digest) {
    return {
      status: 'digest_mismatch',
      realPath,
      expectedIdentity,
      integrity,
      mimeType,
      displayName,
      canonicalHandle,
      error: mediaError('media-version-mismatch', 'Media content digest no longer matches the requested version.'),
    };
  }
  return {
    status: 'ok',
    realPath,
    expectedIdentity,
    integrity,
    mimeType,
    displayName,
    canonicalHandle,
  };
}

function parseWorkflowLocator(raw: string, workspaceId: string):
  | { kind: 'project-asset'; rel: string; aliases: string[] }
  | { kind: 'local-file'; absPath: string; aliases: string[] }
  | { kind: 'workflow-media'; rel: string; aliases: string[] }
  | null {
  if (!raw || /[\x00-\x1f\x7f]/u.test(raw)) return null;
  if (raw.startsWith('/') || /^https?:\/\//iu.test(raw)) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw, 'https://workflow.invalid');
    } catch {
      parsed = null;
    }
    if (parsed) {
      const pathAndQuery = `${parsed.pathname}${parsed.search}`;
      const wsMatch = WORKSPACE_FILE_RE.exec(parsed.pathname);
      if (wsMatch) {
        const targetWs = decodeURIComponent(wsMatch[1]!);
        const rel = parsed.searchParams.get('rel') || '';
        if (targetWs !== workspaceId || !rel) return null;
        const baseUrl = projectFileMediaUrl(workspaceId, rel);
        return { kind: 'project-asset', rel, aliases: [raw, pathAndQuery, baseUrl] };
      }
      if (parsed.pathname === '/omnimux-workflow/api/project-file') {
        const targetWs = parsed.searchParams.get('workspace') || '';
        const rel = parsed.searchParams.get('rel') || '';
        if (targetWs !== workspaceId || !rel) return null;
        const baseUrl = projectFileMediaUrl(workspaceId, rel);
        return { kind: 'project-asset', rel, aliases: [raw, pathAndQuery, baseUrl] };
      }
      if (parsed.pathname === '/omnimux-workflow/api/local-file') {
        const targetPath = parsed.searchParams.get('path') || '';
        if (!targetPath || !looksAbsolutePath(targetPath) || !isAbsolute(targetPath)) return null;
        const baseUrl = `/omnimux-workflow/api/local-file?path=${encodeURIComponent(targetPath)}`;
        return { kind: 'local-file', absPath: targetPath, aliases: [raw, pathAndQuery, baseUrl, targetPath] };
      }
      const mediaMatch = /^\/(?:omnimux-workflow\/)?media\/(.+)$/u.exec(parsed.pathname);
      if (mediaMatch) {
        let rel: string;
        try {
          rel = decodeURIComponent(mediaMatch[1]!);
        } catch {
          return null;
        }
        if (!rel) return null;
        return { kind: 'workflow-media', rel, aliases: [raw, pathAndQuery, parsed.pathname] };
      }
      if (/^https?:\/\//iu.test(raw)) return null;
    }
  }
  if (looksAbsolutePath(raw) && isAbsolute(raw)) {
    const localUrl = `/omnimux-workflow/api/local-file?path=${encodeURIComponent(raw)}`;
    return { kind: 'local-file', absPath: raw, aliases: [raw, localUrl] };
  }
  return null;
}

interface RawNodeOutputEntry {
  outputIndex: number;
  materialType: 'video' | 'audio' | 'image';
  rawLocator: string;
  name: string;
  durationMs?: number;
  assetId?: string;
}

function extractNodeOutputEntries(node: SerializedCanvasNode): RawNodeOutputEntry[] {
  const data = node.data ?? {};
  if (data.simulated === true || data.isMissing === true) return [];
  const isComposition = node.type === 'video_composition';
  const defaultType = isComposition ? 'video' : node.type === 'material' ? resolveNodeOutputType(data) : node.type;
  const name = asNonEmptyString(data.label) ?? asNonEmptyString(data.title) ?? asNonEmptyString(data.originalName) ?? node.id;
  const fallbackUrl = isComposition
    ? asNonEmptyString(data.outputVideoUrl)
    : (asNonEmptyString(data.mediaUrl) ?? asNonEmptyString(data.path) ?? asNonEmptyString(data.url)
      ?? asNonEmptyString(data.real_path) ?? asNonEmptyString(data.filePath));
  const durationSec = asFiniteNumber(data.durationSec) ?? asFiniteNumber(data.duration);
  const fallbackDurationMs = asFiniteNumber(data.outputDurationMs) ?? asFiniteNumber(data.durationMs)
    ?? (durationSec !== undefined ? Math.round(durationSec * 1000) : undefined);

  if (!isComposition && Array.isArray(data.mediaAssets) && data.mediaAssets.length > 0) {
    const entries: RawNodeOutputEntry[] = [];
    for (let index = 0; index < data.mediaAssets.length; index++) {
      const row = data.mediaAssets[index];
      if (!row || typeof row !== 'object') continue;
      const asset = row as Record<string, unknown>;
      const type = asNonEmptyString(asset.type) ?? defaultType;
      const rawLocator = asNonEmptyString(asset.url) ?? (index === 0 ? fallbackUrl : undefined);
      if (!rawLocator || !type || !MEDIA_TYPES.has(type)) continue;
      const rowSec = asFiniteNumber(asset.durationSec);
      const durationMs = rowSec !== undefined ? Math.round(rowSec * 1000) : fallbackDurationMs;
      entries.push({
        outputIndex: index,
        materialType: type as 'video' | 'audio' | 'image',
        rawLocator,
        name,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(asNonEmptyString(asset.assetId) ? { assetId: asNonEmptyString(asset.assetId) } : {}),
      });
    }
    return entries;
  }

  if (!fallbackUrl || !defaultType || !MEDIA_TYPES.has(defaultType)) return [];
  return [{
    outputIndex: 0,
    materialType: defaultType as 'video' | 'audio' | 'image',
    rawLocator: fallbackUrl,
    name,
    ...(fallbackDurationMs !== undefined ? { durationMs: fallbackDurationMs } : {}),
    ...(asNonEmptyString(data.assetId) ? { assetId: asNonEmptyString(data.assetId) } : {}),
  }];
}

export function createWorkflowMediaSupport(deps: WorkflowMediaProvidersDeps) {
  function findLedgerAsset(workspaceId: string, { assetId, rel }: { assetId?: string; rel?: string }) {
    try {
      const doc = deps.assetsStore.get(workspaceId);
      if (assetId) {
        const byId = doc.items.find((item) => item.id === assetId);
        if (byId) return byId;
      }
      if (rel) {
        return doc.items.find((item) => item.relative_path === rel);
      }
      return undefined;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'workspace-not-found' || code === 'project-required' || code === 'not-found') return undefined;
      throw error;
    }
  }

  async function inspectProjectAsset(
    handle: ProjectAssetHandle,
    auth: MediaAuthContext,
    signal?: AbortSignal,
  ): Promise<InspectedFile> {
    if (!checkWorkspaceAccess(deps, handle.workspaceId, auth)) {
      return { status: 'access_denied', error: mediaError('access-denied', 'Workspace media access denied.') };
    }
    const bound = deps.resolveAssetsRoot(handle.workspaceId);
    if (!bound) {
      return { status: 'not_found', error: mediaError('media-not-found', 'Workspace project root was not found.') };
    }
    const ledger = findLedgerAsset(handle.workspaceId, { assetId: handle.assetId, rel: handle.rel });
    const rel = handle.rel || ledger?.relative_path || '';
    if (!rel) {
      return { status: 'not_found', error: mediaError('media-not-found', 'Project asset path was not found.') };
    }
    let physicalPath: string;
    try {
      const target = resolveProjectRelPath(bound.path, rel);
      physicalPath = await resolveSafeProjectPath(target, bound.path, signal);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'path-denied') {
        return { status: 'access_denied', error: mediaError('access-denied', 'Project asset path escapes project root.') };
      }
      if (code === 'ENOENT') {
        return { status: 'not_found', error: mediaError('media-not-found', 'Project asset file was not found.') };
      }
      throw error;
    }
    return inspectDiskMedia(
      physicalPath,
      {
        v: 1,
        scope: 'project-asset',
        workspaceId: handle.workspaceId,
        ...(ledger?.id ?? handle.assetId ? { assetId: ledger?.id ?? handle.assetId } : {}),
        rel,
      },
      handle.sha256,
      signal,
    );
  }

  async function inspectLocatorForNode(
    workspaceId: string,
    nodeId: string,
    outputIndex: number,
    rawLocator: string,
    assetId: string | undefined,
    expectedSha256: string | undefined,
    auth: MediaAuthContext,
    signal?: AbortSignal,
  ): Promise<{ inspected: InspectedFile; aliases: string[] }> {
    const parsed = parseWorkflowLocator(rawLocator, workspaceId);
    if (!parsed) {
      return {
        inspected: { status: 'unsupported', error: mediaError('unsupported-media', 'Canvas node locator is not a supported local media source.') },
        aliases: [],
      };
    }
    if (parsed.kind === 'project-asset') {
      const inspected = await inspectProjectAsset(
        { v: 1, scope: 'project-asset', workspaceId, ...(assetId ? { assetId } : {}), rel: parsed.rel, ...(expectedSha256 ? { sha256: expectedSha256 } : {}) },
        auth,
        signal,
      );
      const aliases = [...parsed.aliases];
      if (inspected.integrity?.digest) {
        aliases.push(projectFileMediaUrl(workspaceId, parsed.rel, inspected.integrity.digest));
      }
      return { inspected, aliases };
    }
    if (parsed.kind === 'local-file') {
      if (!isAllowedImportedMedia(parsed.absPath)) {
        return {
          inspected: { status: 'unsupported', error: mediaError('unsupported-media', 'Local file type is not allowed media.') },
          aliases: parsed.aliases,
        };
      }
      let realPath: string;
      try {
        realPath = await realpath(parsed.absPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          return {
            inspected: { status: 'not_found', error: mediaError('media-not-found', 'Local media file was not found.') },
            aliases: parsed.aliases,
          };
        }
        throw error;
      }
      const inspected = await inspectDiskMedia(
        realPath,
        { v: 1, scope: 'canvas-node', workspaceId, nodeId, outputIndex },
        expectedSha256,
        signal,
      );
      return { inspected, aliases: [...parsed.aliases, realPath] };
    }
    // workflow-media
    const root = resolve(deps.mediaDir);
    const candidate = resolve(root, parsed.rel);
    if (candidate === root || !isInsideDir(candidate, root)) {
      return {
        inspected: { status: 'access_denied', error: mediaError('access-denied', 'Workflow media path escapes media root.') },
        aliases: parsed.aliases,
      };
    }
    let physicalRoot: string;
    let realPath: string;
    try {
      physicalRoot = await realpath(root);
      realPath = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return {
          inspected: { status: 'not_found', error: mediaError('media-not-found', 'Workflow media file was not found.') },
          aliases: parsed.aliases,
        };
      }
      throw error;
    }
    if (realPath === physicalRoot || !isInsideDir(realPath, physicalRoot)) {
      return {
        inspected: { status: 'access_denied', error: mediaError('access-denied', 'Workflow media symlink escapes media root.') },
        aliases: parsed.aliases,
      };
    }
    const inspected = await inspectDiskMedia(
      realPath,
      { v: 1, scope: 'canvas-node', workspaceId, nodeId, outputIndex },
      expectedSha256,
      signal,
    );
    return { inspected, aliases: parsed.aliases };
  }

  async function inspectCanvasNode(
    handle: CanvasNodeHandle,
    auth: MediaAuthContext,
    signal?: AbortSignal,
  ): Promise<InspectedFile> {
    if (!checkWorkspaceAccess(deps, handle.workspaceId, auth)) {
      return { status: 'access_denied', error: mediaError('access-denied', 'Workspace media access denied.') };
    }
    let snapshot;
    try {
      snapshot = deps.store.get(handle.workspaceId);
    } catch (error) {
      if ((error as { code?: string })?.code === 'not-found' || (error as { code?: string })?.code === 'workspace-not-found') {
        return { status: 'not_found', error: mediaError('media-not-found', 'Canvas workspace was not found.') };
      }
      throw error;
    }
    const node = snapshot.nodes.find((candidate) => candidate.id === handle.nodeId);
    if (!node) {
      return { status: 'not_found', error: mediaError('media-not-found', 'Canvas node was not found.') };
    }
    const entry = extractNodeOutputEntries(node).find((row) => row.outputIndex === handle.outputIndex);
    if (!entry) {
      return { status: 'not_found', error: mediaError('media-not-found', 'Canvas node has no readable media output at this index.') };
    }
    const { inspected } = await inspectLocatorForNode(
      handle.workspaceId,
      handle.nodeId,
      handle.outputIndex,
      entry.rawLocator,
      entry.assetId,
      handle.sha256,
      auth,
      signal,
    );
    return inspected;
  }

  function toStatResponse(target: InspectedFile) {
    if ((target.status === 'ok' || target.status === 'digest_mismatch') && target.integrity && target.canonicalHandle) {
      return {
        status: target.status,
        exists: true,
        canonicalHandle: target.canonicalHandle,
        currentSha256: target.integrity.digest,
        size: target.integrity.size,
        mimeType: target.mimeType,
        displayName: target.displayName,
        immutable: target.canonicalHandle.scope === 'project-asset',
      };
    }
    return { status: target.status, exists: false };
  }

  function toOpenResponse(target: InspectedFile) {
    if (target.status !== 'ok' || !target.realPath || !target.expectedIdentity || !target.integrity || !target.canonicalHandle || !target.mimeType || !target.displayName) {
      throw target.error ?? mediaError('media-not-found', 'Media file could not be opened.');
    }
    const { realPath, expectedIdentity, integrity, mimeType, displayName, canonicalHandle } = target;
    return {
      canonicalHandle,
      sha256: integrity.digest,
      size: integrity.size,
      mimeType,
      displayName,
      openRange(start = 0, end = integrity.size - 1, rangeSignal?: AbortSignal) {
        const clampedStart = Math.max(0, Math.min(start, Math.max(0, integrity.size - 1)));
        const clampedEnd = Math.max(clampedStart, Math.min(end, Math.max(0, integrity.size - 1)));
        return streamVerifiedFile(realPath, expectedIdentity, integrity, clampedStart, clampedEnd, rangeSignal);
      },
    };
  }

  async function resolveNodeSources(
    workspaceId: string,
    node: SerializedCanvasNode,
    auth: MediaAuthContext,
    signal?: AbortSignal,
  ): Promise<ResolvedUpstreamNodeSource[]> {
    const entries = extractNodeOutputEntries(node);
    const out: ResolvedUpstreamNodeSource[] = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      const { inspected, aliases } = await inspectLocatorForNode(
        workspaceId,
        node.id,
        entry.outputIndex,
        entry.rawLocator,
        entry.assetId,
        undefined,
        auth,
        signal,
      );
      if (inspected.status !== 'ok' || !inspected.integrity || !inspected.canonicalHandle || !inspected.mimeType) continue;
      const sourceTokens = new Set<string>([
        ...aliases,
        node.id,
        `${workspaceId}:${node.id}:${entry.outputIndex}`,
        ...(entry.outputIndex === 0 ? [node.id] : [`${node.id}:${entry.outputIndex}`]),
      ]);
      const legacyFingerprints = [...sourceTokens].filter(Boolean).map(sha256Text);
      // Include raw source IDs too so direct omnimuxSource.id matching works without hashing twice.
      legacyFingerprints.push(`${workspaceId}:${node.id}:${entry.outputIndex}`);
      if (entry.outputIndex === 0) legacyFingerprints.push(node.id);
      out.push({
        sourceNodeId: node.id,
        outputIndex: entry.outputIndex,
        materialType: entry.materialType,
        name: entry.name,
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
        canonicalHandle: inspected.canonicalHandle,
        currentSha256: inspected.integrity.digest,
        size: inspected.integrity.size,
        mimeType: inspected.mimeType,
        legacyFingerprints: [...new Set(legacyFingerprints)],
      });
    }
    return out;
  }

  const projectAssetProvider = {
    scope: 'project-asset' as const,
    async stat(handle: ProjectAssetHandle, auth: MediaAuthContext = {}, signal?: AbortSignal) {
      return toStatResponse(await inspectProjectAsset(handle, auth, signal));
    },
    async open(handle: ProjectAssetHandle, auth: MediaAuthContext = {}, signal?: AbortSignal) {
      return toOpenResponse(await inspectProjectAsset(handle, auth, signal));
    },
  };

  const canvasNodeProvider = {
    scope: 'canvas-node' as const,
    async stat(handle: CanvasNodeHandle, auth: MediaAuthContext = {}, signal?: AbortSignal) {
      return toStatResponse(await inspectCanvasNode(handle, auth, signal));
    },
    async open(handle: CanvasNodeHandle, auth: MediaAuthContext = {}, signal?: AbortSignal) {
      return toOpenResponse(await inspectCanvasNode(handle, auth, signal));
    },
  };

  return {
    providers: [projectAssetProvider, canvasNodeProvider] as const,
    projectAssetProvider,
    canvasNodeProvider,
    resolveNodeSources,
  };
}
