import { WORKFLOW_API_ROUTES } from '../../shared/api.ts';
import type { SerializedCanvasNode } from '../../shared/canvasTypes.ts';
import { resolveNodeKind, resolveNodeOutputType } from '../../shared/graph/materialNode.ts';
import { projectFileRevisionDigest } from '../../shared/localMedia.ts';
import type { ClipMediaReturnRow, ClipMediaUpstreamInputs } from './clipEvents.ts';

const localOrigin = 'https://workflow.invalid';
const workspaceFile = /^\/omnimux-workflow\/api\/workspaces\/(ws_[A-Za-z0-9_-]{1,128})\/file$/u;
const absoluteFile = /^(?:\/[^/]|[A-Za-z]:[\\/]|\\\\[^\\])/u;
const mediaTypes = new Set(['video', 'audio', 'image']);

function referenceId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\p{L}\p{N}_.:-]{1,256}$/u.test(value)
    && !/^(?:blob|data|file|javascript|https?):/iu.test(value) ? value : undefined;
}

function returnLocator(value: unknown, workspaceId: string, origin?: string) {
  if (typeof value !== 'string' || value.length > 4096 || /[\\#\x00-\x20\x7f]/u.test(value)) return undefined;
  const relative = /^\/(?!\/)/u.test(value);
  if (!relative && !/^https?:\/\//iu.test(value)) return undefined;
  try {
    const parsed = new URL(value, localOrigin);
    const expectedOrigin = relative ? localOrigin : origin;
    const authority = relative ? '' : /^https?:\/\/[^/]+/iu.exec(value)?.[0];
    if (parsed.origin !== expectedOrigin || authority?.includes('@')) return undefined;
    const { pathname, search, searchParams } = parsed;
    const url = pathname + search;
    const pathAndQuery = value.slice(authority?.length ?? 0);
    if (url !== pathAndQuery) return undefined;
    const isLocalFile = pathname === WORKFLOW_API_ROUTES.localFile;
    const fileParam = isLocalFile ? 'path' : 'rel';
    if ([...searchParams].some(([key, token]) => ![fileParam, 'rev', 'v'].includes(key)
      || !token || searchParams.getAll(key).length !== 1 || (key !== fileParam && !referenceId(token)))) return undefined;
    const file = searchParams.get(fileParam);
    if (!file || /[\x00-\x1f\x7f]/u.test(file)) return undefined;
    const rev = searchParams.get('rev');
    if (isLocalFile) {
      if (!absoluteFile.test(file)) return undefined;
      return { url, version: referenceId(rev) ?? referenceId(searchParams.get('v')) };
    }
    if (workspaceFile.exec(pathname)?.[1] !== workspaceId || !projectFileRevisionDigest(rev)
      || !file.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:]/u.test(part))) return undefined;
    // The workspace file route verifies the digest against the served bytes.
    return { url, version: rev! };
  } catch {
    return undefined;
  }
}

function outputVersion(data: SerializedCanvasNode['data'], locatorVersion?: string) {
  return locatorVersion ?? [data.outputRevision, data.mediaRevision, data.generationId, data.taskId]
    .map(referenceId).find(Boolean);
}

export function connectedClipMediaVersion(data: SerializedCanvasNode['data'], path: string | undefined, workspaceId: string, origin?: string) {
  return outputVersion(data, returnLocator(path, workspaceId, origin)?.version);
}

function mediaType(value: unknown): value is ClipMediaReturnRow['type'] {
  return typeof value === 'string' && mediaTypes.has(value);
}

export interface ClipMediaOutput extends ClipMediaReturnRow {
  sourceId: string;
  assetId?: string;
  durationMs?: number;
}

export function sameClipMediaOutput(a: ClipMediaOutput | undefined, b: ClipMediaOutput) {
  return a?.id === b.id && a.sourceId === b.sourceId && a.assetId === b.assetId
    && a.type === b.type && a.url === b.url && a.version === b.version;
}

function nodeOutputs(node: SerializedCanvasNode, workspaceId: string, origin?: string): ClipMediaOutput[] {
  const { data } = node;
  if (data.simulated === true || data.isMissing === true) return [];
  const isComposition = node.type === 'video_composition';
  const type = isComposition ? 'video' : node.type === 'material' ? resolveNodeOutputType(data) : node.type;
  const fallbackUrl = isComposition ? data.outputVideoUrl : data.mediaUrl;
  const rawOutputs: unknown[] = !isComposition && Array.isArray(data.mediaAssets) && data.mediaAssets.length
    ? data.mediaAssets : [{ type, url: fallbackUrl, assetId: data.assetId, durationSec: data.durationSec ?? data.duration }];
  const name = [data.label, data.title, data.originalName].flatMap(value => typeof value === 'string'
    ? [value.split(/[/\\]/u).at(-1)?.trim().slice(0, 256)] : []).find(Boolean) || node.id;
  return rawOutputs.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const asset = value as Record<string, unknown>;
    const id = referenceId(`${workspaceId}:${node.id}:${index}`);
    const locator = returnLocator(asset.url, workspaceId, origin);
    if (!id || !locator || !mediaType(asset.type)) return [];
    const version = outputVersion(data, locator.version);
    const seconds = asset.durationSec;
    const outputMs = data.outputDurationMs ?? data.durationMs;
    const durationMs = typeof outputMs === 'number' && Number.isFinite(outputMs) ? outputMs
      : typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : undefined;
    return [{ id, name, type: asset.type, url: locator.url, version, sourceId: index === 0 ? node.id : `${node.id}:${index}`,
      assetId: referenceId(asset.assetId), durationMs }];
  });
}

/** Only settled, playable outputs of real generators appear in the Studio picker. */
export function collectStudioReturnOutputs(nodes: readonly SerializedCanvasNode[], workspaceId: string, origin?: string) {
  return nodes.flatMap(node => {
    const { data } = node;
    if (node.type === 'video_composition') {
      if (data.status !== 'completed') return [];
    } else if (node.type !== 'material' || resolveNodeKind(data) !== 'generate'
      || (data.executionStatus ?? data.status) !== 'completed') return [];
    return nodeOutputs(node, workspaceId, origin);
  });
}

export function selectedStudioReturnRows(outputs: readonly ClipMediaOutput[], selected: readonly ClipMediaOutput[]): ClipMediaReturnRow[] | undefined {
  const live = new Map(outputs.map(output => [output.id, output]));
  const rows: ClipMediaReturnRow[] = [];
  for (const output of selected) {
    if (!sameClipMediaOutput(live.get(output.id), output)) return undefined;
    const { id, name, type, url, version } = output;
    rows.push({ id, name, type, url, ...(version ? { version } : {}) });
  }
  return rows;
}

export type CanvasMediaReturnBaseline = ReadonlyMap<string, ClipMediaOutput>;

export function collectConnectedReturnOutputs(
  nodes: readonly SerializedCanvasNode[],
  sourceIds: ReadonlySet<string>,
  workspaceId: string,
  origin?: string,
): CanvasMediaReturnBaseline {
  const outputs = nodes.filter(node => sourceIds.has(node.id)).flatMap(node => nodeOutputs(node, workspaceId, origin));
  return new Map(outputs.map(output => [output.id, output]));
}

export function changedConnectedInputs(baseline: CanvasMediaReturnBaseline, current: CanvasMediaReturnBaseline): ClipMediaUpstreamInputs {
  const inputs: ClipMediaUpstreamInputs = { videos: [], images: [], audios: [] };
  for (const [id, output] of current) {
    if (sameClipMediaOutput(baseline.get(id), output)) continue;
    const { url, name, sourceId, version, durationMs } = output;
    const media = { path: url, url, name, sourceId, ...(version ? { sourceVersion: version } : {}) };
    if (output.type === 'video') inputs.videos.push({ ...media, durationMs });
    else if (output.type === 'audio') inputs.audios.push({ ...media, durationMs });
    else inputs.images.push({ ...media, displayDurationMs: durationMs ?? 3000 });
  }
  return inputs;
}
