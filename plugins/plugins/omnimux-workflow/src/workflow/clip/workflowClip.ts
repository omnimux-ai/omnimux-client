import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { isCanvasClipBinding, type CanvasClipBinding } from '../../canvas/bridge/clipEvents.ts';
import { VIDEO_COMPOSITION_NODE_WIDTH, clipExportMediaUrl, planClipExportDownstream } from '../../canvas/nodes/definitions/videoCompositionDownstream.ts';
import type { CanvasWorkspaceSnapshot, SerializedCanvasNode } from '../../shared/canvasTypes.ts';
import { planCanvasInputMutation } from '../../shared/graph/canvasInputMutationGateway.ts';
import { looksAbsolutePath, materialTypeFromFilename, projectFileMediaUrl } from '../../shared/localMedia.ts';
import { assertProjectWriteSafe, resolveProjectPaths, toProjectRelativePath } from '../../projects/paths.ts';
import { readMediaContentDigest } from '../../projects/mediaRevision.ts';
import { copyFileIntoDir, uniqueImportedName } from '../ingest/IngestionPipeline.ts';
import { retryWorkspaceVersionConflict } from '../graph/GraphMutator.ts';
import type { ProjectAssetsStore } from '../workspace/ProjectAssetsStore.ts';
import type { WorkspaceStore } from '../workspace/WorkspaceStore.ts';
import { WorkflowStoreError } from '../workspace/WorkflowStoreError.ts';
import type { ResolvedUpstreamNodeSource } from '../media/workflowMediaProviders.ts';

interface SaveDraftInput extends CanvasClipBinding {
  revision: number;
}

interface ExportRevision {
  projectRevision: number;
  revisionEpoch?: number;
  exportGeneration?: number;
}

interface CommitExportInput extends CanvasClipBinding, ExportRevision {
  exportJobId: number | string;
  output: { videoPath: string; revision: string; durationMs: number; width: number; height: number; sha256?: string };
}

interface ClipExportArtifactMeta {
  relativePath: string;
  assetId: string;
  mediaUrl: string;
  mediaHandle: {
    v: 1;
    scope: 'project-asset';
    workspaceId: string;
    assetId: string;
    rel: string;
    sha256: string;
  };
}

interface StoredExportReceipt extends ExportRevision {
  exportJobId: number;
  fingerprint: string;
  workspaceVersion: number;
  artifact?: ClipExportArtifactMeta;
}

interface WorkflowClipOptions {
  store: Pick<WorkspaceStore, 'get' | 'save'>;
  assetsStore?: Pick<ProjectAssetsStore, 'get' | 'registerGenerated'>;
  resolveProjectRoot?: (workspaceId: string) => { path: string } | null;
  canAccessWorkspace?: (workspaceId: string, sessionId: string) => boolean;
  resolveNodeSources?: (
    workspaceId: string,
    node: SerializedCanvasNode,
    auth: { sessionId?: string },
    signal?: AbortSignal,
  ) => Promise<ResolvedUpstreamNodeSource[]>;
}

export interface IngestClipMediaInput {
  tempPath: string;
  fileName: string;
  mimeType: string;
  sha256: string;
}

export interface IngestClipMediaResult {
  assetId: string;
  relativePath: string;
  sha256: string;
  size: number;
  mimeType: string;
  url: string;
  handle: {
    v: 1;
    scope: 'project-asset';
    workspaceId: string;
    assetId: string;
    rel: string;
    sha256: string;
  };
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function boundNode(snapshot: CanvasWorkspaceSnapshot, binding: CanvasClipBinding): SerializedCanvasNode {
  const matches = snapshot.nodes.filter((node) => node.id === binding.nodeId);
  const node = matches[0];
  if (snapshot.id !== binding.workspaceId || matches.length !== 1 || node?.type !== 'video_composition'
    || node.data.projectId !== binding.projectId || snapshot.nodes.some((other) => (
      other !== node && other.type === 'video_composition' && other.data.projectId === binding.projectId
    ))) {
    throw new WorkflowStoreError('clip-binding-mismatch', 'The Clip project no longer matches its canvas node.');
  }
  return node;
}

function assertBinding(input: unknown): asserts input is CanvasClipBinding {
  if (!isCanvasClipBinding(input)) {
    throw new WorkflowStoreError('invalid-clip-binding', 'A workspace, composition node and Clip project are required.');
  }
}

function titleOf(node: SerializedCanvasNode): string {
  for (const value of [node.data.title, node.data.label]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '视频合成';
}

function exportGenerationOf({ revisionEpoch, exportGeneration }: ExportRevision): number {
  return exportGeneration ?? revisionEpoch ?? 0;
}

function exportIdentity(input: CommitExportInput) {
  const { exportJobId, projectRevision, revisionEpoch, exportGeneration, output } = input;
  const jobId = typeof exportJobId === 'string' && /^[1-9]\d{0,15}$/.test(exportJobId)
    ? Number(exportJobId) : exportJobId;
  if (!validRevision(jobId) || jobId === 0 || !validRevision(projectRevision)
    || (revisionEpoch !== undefined && !validRevision(revisionEpoch))
    || (exportGeneration !== undefined && !validRevision(exportGeneration)) || !output
    || typeof output.videoPath !== 'string' || !looksAbsolutePath(output.videoPath)
    || typeof output.revision !== 'string' || !output.revision.trim() || output.revision.length > 256
    || !Number.isFinite(output.durationMs) || output.durationMs < 0
    || !validRevision(output.width) || output.width === 0
    || !validRevision(output.height) || output.height === 0) {
    throw new WorkflowStoreError('invalid-clip-export', 'The export job, project revision or media metadata is invalid.');
  }
  const { videoPath, revision, durationMs, width, height } = output;
  const identity = [projectRevision, videoPath, revision, durationMs, width, height];
  const generation = exportGenerationOf(input);
  // Preserve fingerprints of reservations written before generation tracking.
  if (revisionEpoch || generation) identity.push(revisionEpoch ?? 0, generation);
  const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { jobId, generation, fingerprint };
}

const SHA256_RE = /^[a-f0-9]{64}$/u;

function sha256FileSync(filePath: string): string {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(256 * 1024);
    while (true) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function safeArtifactStem(label: string): string {
  const cleaned = label
    .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 64) || 'clip_export';
}

function linkOrCopyAtomicSync(sourceAbs: string, destAbs: string): void {
  try {
    linkSync(sourceAbs, destAbs);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EACCES' && code !== 'EINVAL') {
      throw error;
    }
  }
  const tmp = `${destAbs}.${randomUUID()}.tmp`;
  try {
    copyFileSync(sourceAbs, tmp);
    renameSync(tmp, destAbs);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function materializeClipExportArtifact(opts: {
  workspaceId: string;
  projectRoot: string;
  sourceNodeId: string;
  sourceLabel: string;
  projectId: string;
  exportJobId: number;
  output: CommitExportInput['output'];
  assetsStore: Pick<ProjectAssetsStore, 'get' | 'registerGenerated'>;
}): ClipExportArtifactMeta & { artifactPath: string; sha256: string } {
  const { workspaceId, projectRoot, sourceNodeId, sourceLabel, projectId, exportJobId, output, assetsStore } = opts;
  const paths = resolveProjectPaths(projectRoot);
  mkdirSync(paths.artifactsDir, { recursive: true });
  const digest = typeof output.sha256 === 'string' && SHA256_RE.test(output.sha256)
    ? output.sha256
    : sha256FileSync(output.videoPath);

  const existing = assetsStore.get(workspaceId).items.find((item) => (
    item.sha256 === digest
    && typeof item.relative_path === 'string'
    && item.relative_path.startsWith('artifacts/')
    && existsSync(join(paths.projectRoot, item.relative_path))
  ));

  let assetId: string;
  let relativePath: string;
  let destAbs: string;
  if (existing && existing.relative_path) {
    assetId = existing.id;
    relativePath = existing.relative_path;
    destAbs = join(paths.projectRoot, existing.relative_path);
  } else {
    const fileName = uniqueImportedName(paths.artifactsDir, `${safeArtifactStem(sourceLabel)}_${digest.slice(0, 12)}.mp4`);
    destAbs = join(paths.artifactsDir, fileName);
    assertProjectWriteSafe(destAbs, paths.projectRoot);
    relativePath = toProjectRelativePath(paths.projectRoot, destAbs);
    linkOrCopyAtomicSync(output.videoPath, destAbs);
    const size = statSync(destAbs).size;
    const durationSec = Number.isFinite(output.durationMs) && output.durationMs > 0 ? output.durationMs / 1000 : null;
    const doc = assetsStore.registerGenerated(workspaceId, {
      relative_path: relativePath,
      name: fileName,
      type: 'video',
      size,
      mimeType: 'video/mp4',
      durationSec,
      sha256: digest,
      lineage: {
        kind: 'clip_export',
        sourceCompositionNodeId: sourceNodeId,
        clipProjectId: projectId,
        exportJobId,
        canvasId: workspaceId,
      },
    });
    const registered = doc.items.find((row) => row.relative_path === relativePath);
    assetId = registered?.id ?? fileName;
  }

  const mediaUrl = projectFileMediaUrl(workspaceId, relativePath, digest);
  const mediaHandle = {
    v: 1 as const,
    scope: 'project-asset' as const,
    workspaceId,
    assetId,
    rel: relativePath,
    sha256: digest,
  };
  return {
    artifactPath: destAbs,
    sha256: digest,
    relativePath,
    assetId,
    mediaUrl,
    mediaHandle,
  };
}

/** A receipt lives with the source node in the same atomic save as the graph. */
function committed(
  workspaceVersion: number,
  artifact?: (ClipExportArtifactMeta & { artifactPath?: string }),
) {
  return {
    status: 'committed' as const,
    canvasCommitted: true as const,
    workspaceVersion,
    ...(artifact ? {
      artifactCommitted: true as const,
      ...(artifact.artifactPath ? { artifactPath: artifact.artifactPath } : {}),
      relativePath: artifact.relativePath,
      assetId: artifact.assetId,
      mediaUrl: artifact.mediaUrl,
      mediaHandle: artifact.mediaHandle,
    } : {}),
  };
}

export function createWorkflowClipService({ store, assetsStore, resolveProjectRoot, canAccessWorkspace, resolveNodeSources }: WorkflowClipOptions) {
  return {
    resolveBinding(input: CanvasClipBinding, sessionId?: string) {
      assertBinding(input);
      const { workspaceId, nodeId, projectId } = input;
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId
        || !canAccessWorkspace?.(workspaceId, sessionId))) {
        throw new WorkflowStoreError('outside-project-boundary', 'The canvas does not belong to the requested session workspace.');
      }
      const node = boundNode(store.get(workspaceId), input);
      return {
        workspaceId, nodeId, projectId, title: titleOf(node),
        ...(validRevision(node.data.draftRevision) ? { draftRevision: node.data.draftRevision } : {}),
      };
    },

    async listUpstreamSources(input: CanvasClipBinding, sessionId?: string, signal?: AbortSignal): Promise<{
      workspaceId: string;
      nodeId: string;
      projectId: string;
      sources: ResolvedUpstreamNodeSource[];
    }> {
      assertBinding(input);
      const { workspaceId, nodeId, projectId } = input;
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId
        || !canAccessWorkspace?.(workspaceId, sessionId))) {
        throw new WorkflowStoreError('outside-project-boundary', 'The canvas does not belong to the requested session workspace.');
      }
      const snapshot = store.get(workspaceId);
      boundNode(snapshot, input);
      if (!resolveNodeSources) {
        return { workspaceId, nodeId, projectId, sources: [] };
      }
      const sourceIds = new Set<string>();
      for (const edge of snapshot.edges) {
        if (edge.target === nodeId) sourceIds.add(edge.source);
      }
      const sources: ResolvedUpstreamNodeSource[] = [];
      for (const candidate of snapshot.nodes) {
        if (!sourceIds.has(candidate.id)) continue;
        signal?.throwIfAborted();
        const resolved = await resolveNodeSources(workspaceId, candidate, { sessionId }, signal);
        sources.push(...resolved);
      }
      return { workspaceId, nodeId, projectId, sources };
    },

    resolveProjectAsset(
      workspaceId: string,
      assetId: string,
      sessionId?: string,
    ): {
      assetId: string;
      relativePath: string;
      name: string;
      sha256?: string;
      handle: {
        v: 1;
        scope: 'project-asset';
        workspaceId: string;
        assetId: string;
        rel: string;
        sha256?: string;
      };
    } | null {
      if (typeof workspaceId !== 'string' || !/^ws_[A-Za-z0-9_-]{1,128}$/u.test(workspaceId)
        || typeof assetId !== 'string' || !assetId.trim() || assetId.length > 256) {
        return null;
      }
      if (canAccessWorkspace && (typeof sessionId !== 'string' || !sessionId || !canAccessWorkspace(workspaceId, sessionId))) {
        throw new WorkflowStoreError('outside-project-boundary', 'The canvas does not belong to the requested session workspace.');
      }
      if (!assetsStore) return null;
      const item = assetsStore.get(workspaceId).items.find((entry) => entry.id === assetId);
      if (!item || typeof item.relative_path !== 'string' || !item.relative_path) return null;
      const sha256 = typeof item.sha256 === 'string' && SHA256_RE.test(item.sha256) ? item.sha256 : undefined;
      return {
        assetId: item.id,
        relativePath: item.relative_path,
        name: item.name,
        ...(sha256 ? { sha256 } : {}),
        handle: {
          v: 1,
          scope: 'project-asset',
          workspaceId,
          assetId: item.id,
          rel: item.relative_path,
          ...(sha256 ? { sha256 } : {}),
        },
      };
    },

    async ingestClipMedia(
      input: CanvasClipBinding,
      media: IngestClipMediaInput,
      sessionId?: string,
      signal?: AbortSignal,
    ): Promise<IngestClipMediaResult | null> {
      assertBinding(input);
      const { workspaceId } = input;
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId
        || !canAccessWorkspace?.(workspaceId, sessionId))) {
        throw new WorkflowStoreError('outside-project-boundary', 'The canvas does not belong to the requested session workspace.');
      }
      boundNode(store.get(workspaceId), input);
      if (!assetsStore || !resolveProjectRoot) return null;
      const bound = resolveProjectRoot(workspaceId);
      if (!bound) return null;
      const paths = resolveProjectPaths(bound.path);
      const expectedDigest = typeof media.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(media.sha256)
        ? media.sha256
        : await readMediaContentDigest(media.tempPath, signal);
      // Reuse an existing identical project asset only when the file still exists on disk.
      const existing = assetsStore.get(workspaceId).items.find(
        (item) => item.sha256 === expectedDigest && item.relative_path && existsSync(join(paths.projectRoot, item.relative_path)),
      );
      if (existing) {
        const url = projectFileMediaUrl(workspaceId, existing.relative_path, expectedDigest);
        return {
          assetId: existing.id,
          relativePath: existing.relative_path,
          sha256: expectedDigest,
          size: typeof existing.size === 'number' ? existing.size : 0,
          mimeType: existing.mimeType || media.mimeType,
          url,
          handle: {
            v: 1,
            scope: 'project-asset',
            workspaceId,
            assetId: existing.id,
            rel: existing.relative_path,
            sha256: expectedDigest,
          },
        };
      }
      const copied = await copyFileIntoDir({
        projectRoot: paths.projectRoot,
        destDir: paths.importedDir,
        sourceAbs: media.tempPath,
        originalName: media.fileName,
        checkMedia: false,
      });
      const verifiedDigest = await readMediaContentDigest(copied.destAbs, signal);
      if (verifiedDigest !== expectedDigest) {
        throw new WorkflowStoreError('media-version-mismatch', 'Uploaded media bytes changed during project ingestion.');
      }
      const kind = materialTypeFromFilename(copied.name, media.mimeType);
      const fileType = kind === 'video' || kind === 'audio' || kind === 'image' ? kind : 'doc';
      const doc = assetsStore.registerGenerated(workspaceId, {
        relative_path: copied.relativePath,
        name: copied.name,
        type: fileType,
        size: copied.size,
        mimeType: media.mimeType,
        sha256: verifiedDigest,
        lineage: { kind: 'clip_local_import', sourceCompositionNodeId: input.nodeId, clipProjectId: input.projectId, canvasId: workspaceId },
      });
      const registered = doc.items.find((row) => row.relative_path === copied.relativePath);
      const assetId = registered?.id ?? copied.name;
      const url = projectFileMediaUrl(workspaceId, copied.relativePath, verifiedDigest);
      return {
        assetId,
        relativePath: copied.relativePath,
        sha256: verifiedDigest,
        size: copied.size,
        mimeType: media.mimeType,
        url,
        handle: {
          v: 1,
          scope: 'project-asset',
          workspaceId,
          assetId,
          rel: copied.relativePath,
          sha256: verifiedDigest,
        },
      };
    },

    saveDraft(input: SaveDraftInput) {
      assertBinding(input);
      const { workspaceId, revision } = input;
      if (!validRevision(revision)) {
        throw new WorkflowStoreError('invalid-clip-revision', 'The draft revision must be a nonnegative safe integer.');
      }
      return retryWorkspaceVersionConflict(() => {
        const snapshot = store.get(workspaceId);
        const source = boundNode(snapshot, input);
        const previous = source.data.draftRevision;
        if (validRevision(previous) && previous >= revision) {
          return { revision: previous, workspaceVersion: snapshot.version };
        }
        const nodes = snapshot.nodes.map((node) => node === source
          ? { ...node, data: { ...node.data, draftRevision: revision } } : node);
        const saved = store.save(workspaceId, { expectedVersion: snapshot.version, nodes });
        return { revision, workspaceVersion: saved.snapshot.version };
      });
    },

    commitExport(input: CommitExportInput) {
      assertBinding(input);
      const { workspaceId, output, projectRevision, revisionEpoch, exportGeneration } = input;
      const { jobId, generation, fingerprint } = exportIdentity(input);
      return retryWorkspaceVersionConflict(() => {
        const snapshot = store.get(workspaceId);
        const source = boundNode(snapshot, input);
        const receipts = Array.isArray(source.data.clipExportReceipts)
          ? source.data.clipExportReceipts as StoredExportReceipt[] : [];
        const prior = receipts.find((receipt) => receipt.exportJobId === jobId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            throw new WorkflowStoreError('clip-export-job-mismatch', 'The export job already identifies a different result.');
          }
          if (prior.artifact && resolveProjectRoot) {
            const bound = resolveProjectRoot(workspaceId);
            const artifactPath = bound ? join(resolveProjectPaths(bound.path).projectRoot, prior.artifact.relativePath) : undefined;
            return committed(prior.workspaceVersion, { ...prior.artifact, ...(artifactPath ? { artifactPath } : {}) });
          }
          return committed(prior.workspaceVersion, prior.artifact);
        }
        if (receipts.some((receipt) => {
          const savedGeneration = exportGenerationOf(receipt);
          return savedGeneration > generation || (savedGeneration === generation
            && (receipt.exportJobId > jobId || receipt.projectRevision > projectRevision));
        })) {
          return { status: 'superseded' as const, canvasCommitted: false as const };
        }
        let materialized: (ClipExportArtifactMeta & { artifactPath: string; sha256: string }) | undefined;
        if (assetsStore && resolveProjectRoot && existsSync(output.videoPath)) {
          const bound = resolveProjectRoot(workspaceId);
          if (bound) {
            materialized = materializeClipExportArtifact({
              workspaceId,
              projectRoot: bound.path,
              sourceNodeId: source.id,
              sourceLabel: titleOf(source),
              projectId: input.projectId,
              exportJobId: jobId,
              output,
              assetsStore,
            });
          }
        }
        const fallbackRevision = !materialized && typeof output.sha256 === 'string' && SHA256_RE.test(output.sha256)
          ? `sha256:${output.sha256}`
          : output.revision;
        const downstreamOutput = materialized
          ? {
              ...output,
              mediaUrl: materialized.mediaUrl,
              relativePath: materialized.relativePath,
              assetId: materialized.assetId,
              sha256: materialized.sha256,
              mediaHandle: materialized.mediaHandle,
            }
          : {
              ...output,
              revision: fallbackRevision,
            };
        const downstream = planClipExportDownstream({
          sourceNodeId: source.id,
          sourcePosition: source.position,
          sourceLabel: titleOf(source),
          output: downstreamOutput,
          currentNodes: snapshot.nodes,
          currentEdges: snapshot.edges,
          nodeWidth: VIDEO_COMPOSITION_NODE_WIDTH,
        });
        const artifactMeta: ClipExportArtifactMeta | undefined = materialized
          ? {
              relativePath: materialized.relativePath,
              assetId: materialized.assetId,
              mediaUrl: materialized.mediaUrl,
              mediaHandle: materialized.mediaHandle,
            }
          : undefined;
        const receipt: StoredExportReceipt = {
          exportJobId: jobId, fingerprint, projectRevision, workspaceVersion: snapshot.version + 1,
          ...(revisionEpoch !== undefined ? { revisionEpoch } : {}),
          ...(exportGeneration !== undefined ? { exportGeneration } : {}),
          ...(artifactMeta ? { artifact: artifactMeta } : {}),
        };
        const graph = planCanvasInputMutation(snapshot, {
          addNodes: downstream?.addNodes.map(({ data: { realPath: _realPath, ...data }, ...node }) => ({
            ...node, selected: false, data: { ...data, nodeKind: 'import' },
          })),
          addEdges: downstream?.addEdges,
          removeEdgeIds: downstream?.removeEdgeIds,
          nodePatches: [{ nodeId: source.id, data: {
            status: 'completed',
            renderProgress: undefined,
            errorMessage: undefined,
            outputVideoUrl: materialized ? materialized.mediaUrl : clipExportMediaUrl(output.videoPath, fallbackRevision),
            ...(materialized ? { outputMediaHandle: materialized.mediaHandle } : {}),
            outputRevision: fallbackRevision,
            outputDurationMs: output.durationMs,
            outputWidth: output.width,
            outputHeight: output.height,
            thumbnailUrl: undefined,
            outputThumbnailUrl: undefined,
            clipExportReceipts: [...receipts, receipt],
          } }, ...(downstream?.nodePatches ?? [])],
        });
        if (graph.status !== 'allowed') {
          throw new WorkflowStoreError('mutation-rejected', `Clip export cannot be linked: ${graph.reasonCode}.`);
        }
        const saved = store.save(workspaceId, { expectedVersion: snapshot.version, nodes: graph.nodes, edges: graph.edges });
        return committed(saved.snapshot.version, materialized);
      });
    },
  };
}
