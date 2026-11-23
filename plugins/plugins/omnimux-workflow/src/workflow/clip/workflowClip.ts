import { createHash } from 'node:crypto';
import { isCanvasClipBinding, type CanvasClipBinding } from '../../canvas/bridge/clipEvents.ts';
import { VIDEO_COMPOSITION_NODE_WIDTH, clipExportMediaUrl, planClipExportDownstream } from '../../canvas/nodes/definitions/videoCompositionDownstream.ts';
import type { CanvasWorkspaceSnapshot, SerializedCanvasNode } from '../../shared/canvasTypes.ts';
import { planCanvasInputMutation } from '../../shared/graph/canvasInputMutationGateway.ts';
import { looksAbsolutePath, materialTypeFromFilename, projectFileMediaUrl } from '../../shared/localMedia.ts';
import { resolveProjectPaths } from '../../projects/paths.ts';
import { readMediaContentDigest } from '../../projects/mediaRevision.ts';
import { copyFileIntoDir } from '../ingest/IngestionPipeline.ts';
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
  output: { videoPath: string; revision: string; durationMs: number; width: number; height: number };
}

interface StoredExportReceipt extends ExportRevision {
  exportJobId: number;
  fingerprint: string;
  workspaceVersion: number;
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

/** A receipt lives with the source node in the same atomic save as the graph. */
function committed(workspaceVersion: number) {
  return { status: 'committed' as const, canvasCommitted: true as const, workspaceVersion };
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
      // Reuse an existing identical project asset if already stored under the project root.
      const existing = assetsStore.get(workspaceId).items.find((item) => item.sha256 === expectedDigest && item.relative_path);
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
          return committed(prior.workspaceVersion);
        }
        if (receipts.some((receipt) => {
          const savedGeneration = exportGenerationOf(receipt);
          return savedGeneration > generation || (savedGeneration === generation
            && (receipt.exportJobId > jobId || receipt.projectRevision > projectRevision));
        })) {
          return { status: 'superseded' as const, canvasCommitted: false as const };
        }
        const downstream = planClipExportDownstream({
          sourceNodeId: source.id,
          sourcePosition: source.position,
          sourceLabel: titleOf(source),
          output,
          currentNodes: snapshot.nodes,
          currentEdges: snapshot.edges,
          nodeWidth: VIDEO_COMPOSITION_NODE_WIDTH,
        });
        const receipt: StoredExportReceipt = {
          exportJobId: jobId, fingerprint, projectRevision, workspaceVersion: snapshot.version + 1,
          ...(revisionEpoch !== undefined ? { revisionEpoch } : {}),
          ...(exportGeneration !== undefined ? { exportGeneration } : {}),
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
            outputVideoUrl: clipExportMediaUrl(output.videoPath, output.revision),
            outputRevision: output.revision,
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
        return committed(saved.snapshot.version);
      });
    },
  };
}
