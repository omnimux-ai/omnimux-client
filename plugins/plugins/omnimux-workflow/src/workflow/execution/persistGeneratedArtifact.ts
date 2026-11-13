/**
 * Move a settled generation tmp file into `<ProjectRoot>/artifacts/`
 * and register it on the project assets ledger. Never writes the global library.
 */
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { basename } from 'node:path';
import { projectFileMediaUrl, sniffMediaExtension, sniffMimeType } from '../../shared/localMedia.ts';
import { resolveProjectPaths } from '../../projects/paths.ts';
import { moveFileIntoDir } from '../ingest/IngestionPipeline.ts';
import { WorkflowStoreError } from '../workspace/WorkflowStoreError.ts';
import type { RegisterGeneratedAssetPayload } from '../workspace/ProjectAssetsStore.ts';
import type { ProjectAssetFileType } from '../../shared/projectAssets.ts';
import { buildMediaMetadata } from '../../shared/mediaMetadata.ts';

export interface PersistGeneratedArtifactOpts {
  workspaceId: string;
  nodeId: string;
  nodeType: string;
  tmpAbs: string;
  materialType: 'image' | 'video' | 'audio';
  resolveProjectRoot: (workspaceId: string) => { path: string } | null;
  registerGenerated: (workspaceId: string, payload: RegisterGeneratedAssetPayload) => {
    items: Array<{ id: string; relative_path: string }>;
  };
  prompt?: string;
  modelId?: string;
}

export interface PersistedGeneratedArtifact {
  relativePath: string;
  assetId: string;
  url: string;
  destAbs: string;
  name: string;
  /** Canonical MIME; null when unknown. */
  mimeType: string | null;
  /** Byte size; null when unknown. */
  sizeBytes: number | null;
  /** Duration seconds; null when unknown (generation path rarely measures). */
  durationSec: number | null;
}

const SNIFF_HEAD_BYTES = 512;

function readTmpHead(tmpAbs: string): Uint8Array | undefined {
  if (!tmpAbs || !existsSync(tmpAbs)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(tmpAbs, 'r');
    const buf = new Uint8Array(SNIFF_HEAD_BYTES);
    const n = readSync(fd, buf, 0, SNIFF_HEAD_BYTES, 0);
    if (n <= 0) return undefined;
    return n === SNIFF_HEAD_BYTES ? buf : buf.subarray(0, n);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close races
      }
    }
  }
}

function artifactFileName(nodeId: string, original: string, sniffedExt?: string): string {
  const safeNode = nodeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'node';
  const stamp = Date.now();
  const ext = sniffedExt
    ? `.${sniffedExt.replace(/^\./, '')}`
    : (() => {
        const base = basename(original);
        const dot = base.lastIndexOf('.');
        return dot > 0 ? base.slice(dot) : '';
      })();
  return `${stamp}_${safeNode}${ext}`;
}

export async function persistGeneratedArtifact(
  opts: PersistGeneratedArtifactOpts,
): Promise<PersistedGeneratedArtifact> {
  const bound = opts.resolveProjectRoot(opts.workspaceId);
  if (!bound) {
    throw new WorkflowStoreError(
      'project-required',
      `workspace ${opts.workspaceId} is not bound to a local project`,
    );
  }
  const paths = resolveProjectPaths(bound.path);
  const head = readTmpHead(opts.tmpAbs);
  const sniffedExt = head ? sniffMediaExtension(head) : undefined;
  const copied = await moveFileIntoDir({
    projectRoot: paths.projectRoot,
    destDir: paths.artifactsDir,
    sourceAbs: opts.tmpAbs,
    originalName: artifactFileName(opts.nodeId, opts.tmpAbs, sniffedExt),
    checkMedia: false,
  });
  const lineage = {
    generatorNodeId: opts.nodeId,
    generatorNodeType: opts.nodeType,
    modelId: opts.modelId || 'unknown',
    prompt: opts.prompt,
    canvasId: opts.workspaceId,
    generatedAt: new Date().toISOString(),
  };
  const type = opts.materialType as ProjectAssetFileType;
  const sniffedMime = head ? sniffMimeType(head) : undefined;
  const meta = buildMediaMetadata({
    mime: sniffedMime,
    size: typeof copied.size === 'number' ? copied.size : null,
    filename: copied.name,
    path: copied.relativePath,
  });
  const document = opts.registerGenerated(opts.workspaceId, {
    relative_path: copied.relativePath,
    name: copied.name,
    type,
    size: meta.sizeBytes,
    mimeType: meta.mimeType,
    durationSec: meta.durationSec,
    lineage,
  });
  const item = document.items.find((row) => row.relative_path === copied.relativePath);
  const assetId = item?.id ?? copied.name;
  return {
    relativePath: copied.relativePath,
    assetId,
    url: projectFileMediaUrl(opts.workspaceId, copied.relativePath),
    destAbs: copied.destAbs,
    name: copied.name,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    durationSec: meta.durationSec,
  };
}
