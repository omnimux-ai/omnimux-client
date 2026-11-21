import {
  isCanvasClipBinding,
  isCloseClipEditorPayload,
  isProgressClipEditorPayload,
  isSaveClipEditorPayload,
  newCanvasClipProjectId,
  OMNIMUX_CLIP_CLOSE,
  OMNIMUX_CLIP_OPEN,
  OMNIMUX_CLIP_PROGRESS,
  OMNIMUX_CLIP_SAVE,
  type CanvasClipBinding,
  type OpenClipEditorPayload,
  type VideoCompositionNodeData,
} from './clipEvents.ts';
import type { SerializedCanvasEdge, SerializedCanvasNode } from '../../shared/canvasTypes';
import { captionSlicesFromText } from '../editor/utils/srtParser.ts';
import { VIDEO_COMPOSITION_NODE_WIDTH, clipExportMediaUrl, planClipExportDownstream } from '../nodes/definitions/videoCompositionDownstream.ts';
import type { CanvasInputMutation } from '../../shared/graph/canvasInputMutationGateway.ts';

interface CanvasClipGraph {
  nodes: SerializedCanvasNode[];
  edges: SerializedCanvasEdge[];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mediaPathOf(data: Record<string, unknown>): string | undefined {
  return asString(data.mediaUrl) || asString(data.outputVideoUrl) || asString(data.path)
    || asString(data.url) || asString(data.real_path) || asString(data.filePath);
}

function collectUpstreamInputs({ nodes, edges }: CanvasClipGraph, nodeId: string) {
  const captions: NonNullable<NonNullable<OpenClipEditorPayload['upstreamInputs']>['captions']> = [];
  const inputs: NonNullable<OpenClipEditorPayload['upstreamInputs']> = { videos: [], audios: [], images: [], captions };
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const source = nodes.find((node) => node.id === edge.source);
    if (!source) continue;
    const data = source.data;
    const materialType = source.type === 'video_composition' ? 'video' : asString(data.materialType) ?? source.type;
    const name = asString(data.label) || asString(data.title) || source.id;
    const path = mediaPathOf(data);
    const sourceVersion = asString(data.outputRevision) || asString(data.mediaRevision)
      || asString(data.generationId) || asString(data.taskId);
    const identity = { sourceId: source.id, ...(sourceVersion ? { sourceVersion } : {}) };
    // Imported material duration is in seconds, composition output in milliseconds.
    const duration = asNumber(data.durationSec) ?? asNumber(data.duration);
    const durationMs = asNumber(data.outputDurationMs) ?? asNumber(data.durationMs)
      ?? (duration === undefined ? undefined : duration * 1000);
    if (materialType === 'video' && path) {
      inputs.videos.push({ path, name, durationMs, url: path, ...identity });
    } else if (materialType === 'image' && path) {
      inputs.images.push({ path, name, displayDurationMs: durationMs ?? 3000, url: path, ...identity });
    } else if (materialType === 'audio' && path) {
      inputs.audios.push({ path, name, durationMs, url: path, ...identity });
    } else if (materialType === 'text') {
      const content = asString(data.content) || asString(data.generatedContent) || asString(data.prompt);
      if (!content) continue;
      captions.push(...captionSlicesFromText({
        content,
        contentFormat: asString(data.contentFormat),
        startTimeMs: captions.reduce((sum, item) => sum + item.durationMs, 0),
        sliceDurationMs: 3000,
      }).map(({ text, startTimeMs, durationMs }) => ({ text, startTimeMs, durationMs })));
    }
  }
  return inputs;
}

function clipNode(graph: CanvasClipGraph, nodeId: string) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  return node?.type === 'video_composition' ? node : undefined;
}

export async function openCanvasClipNode({
  workspaceId, nodeId, expectedProjectId, readGraph, updateNode, ensurePersisted, stillCurrent, target, defaultTitle,
}: {
  workspaceId: string;
  nodeId: string;
  expectedProjectId?: string;
  readGraph: () => CanvasClipGraph;
  updateNode: (id: string, patch: Record<string, unknown>) => void;
  ensurePersisted?: (binding: CanvasClipBinding) => Promise<void>;
  stillCurrent: () => boolean;
  target: EventTarget;
  defaultTitle: string;
}): Promise<CanvasClipBinding | undefined> {
  if (!stillCurrent()) return undefined;
  const original = clipNode(readGraph(), nodeId);
  if (!original || (expectedProjectId !== undefined && original.data.projectId !== expectedProjectId)) return undefined;
  const projectId = original.data.projectId ?? newCanvasClipProjectId();
  const binding = { workspaceId, nodeId, projectId };
  if (!isCanvasClipBinding(binding)) return undefined;
  if (original.data.projectId == null) updateNode(nodeId, { projectId });
  if (ensurePersisted) await ensurePersisted(binding);
  if (!stillCurrent()) return undefined;
  const graph = readGraph();
  const current = clipNode(graph, nodeId);
  if (current?.data.projectId !== projectId) return undefined;
  const data = current.data as VideoCompositionNodeData;
  const payload: OpenClipEditorPayload = {
    ...binding,
    source: 'canvas',
    nodeTitle: asString(data.title) || asString(data.label) || defaultTitle,
    ...(data.schema ? { draftSchema: data.schema } : {}),
    ...(Number.isSafeInteger(data.draftRevision) ? { draftRevision: data.draftRevision } : {}),
    upstreamInputs: collectUpstreamInputs(graph, nodeId),
  };
  updateNode(nodeId, { status: 'editing' });
  target.dispatchEvent(new CustomEvent(OMNIMUX_CLIP_OPEN, { detail: payload, bubbles: true }));
  return binding;
}

/** Keep manual SAVE/PROGRESS/CLOSE bound to the mounted graph, even for an offscreen node. */
export function installCanvasClipEvents({ workspaceId, target, readGraph, applyMutation, updateNode, defaultTitle, onManualExport }: {
  workspaceId: string;
  target: EventTarget;
  readGraph: () => CanvasClipGraph;
  applyMutation: (mutation: CanvasInputMutation) => void;
  updateNode: (id: string, patch: Record<string, unknown>) => void;
  defaultTitle: string;
  onManualExport: () => void;
}): () => void {
  const readBound = (binding: CanvasClipBinding, graph: CanvasClipGraph) => {
    if (binding.workspaceId !== workspaceId) return undefined;
    const node = clipNode(graph, binding.nodeId);
    return node?.data.projectId === binding.projectId ? node : undefined;
  };
  const detailOf = (event: Event): unknown => event instanceof CustomEvent ? event.detail : undefined;
  const onSave = (event: Event) => {
    const detail = detailOf(event);
    if (!isSaveClipEditorPayload(detail)) return;
    const graph = readGraph();
    const source = readBound(detail, graph);
    if (!source) return;
    const output = detail.output;
    // Stage 1 callbacks still carry unversioned output. After a Host receipt,
    // all changes to the composition output belong to the Host CAS.
    if (output && Array.isArray(source.data.clipExportReceipts) && source.data.clipExportReceipts.length > 0) return;
    const data = {
      ...(detail.schema ? { schema: detail.schema } : {}),
      ...(output ? {
        outputVideoUrl: clipExportMediaUrl(output.videoPath, output.revision),
        outputRevision: output.revision,
        thumbnailUrl: output.thumbnailPath,
        outputThumbnailUrl: output.thumbnailPath,
        outputDurationMs: output.durationMs,
        outputWidth: output.width,
        outputHeight: output.height,
      } : {}),
      status: output || source.data.outputVideoUrl ? 'completed' : 'idle',
      renderProgress: undefined,
      errorMessage: undefined,
    };
    const downstream = output && detail.createDownstreamNode && planClipExportDownstream({
      sourceNodeId: source.id,
      sourcePosition: source.position,
      sourceLabel: asString(source.data.title) || asString(source.data.label) || defaultTitle,
      output,
      currentNodes: graph.nodes,
      currentEdges: graph.edges,
      nodeWidth: VIDEO_COMPOSITION_NODE_WIDTH,
    });
    if (!downstream) {
      updateNode(source.id, data);
      return;
    }
    applyMutation({ ...downstream, nodePatches: [{ nodeId: source.id, data }, ...downstream.nodePatches] });
    onManualExport();
  };
  const onProgress = (event: Event) => {
    const detail = detailOf(event);
    if (!isProgressClipEditorPayload(detail) || !readBound(detail, readGraph())) return;
    updateNode(detail.nodeId, { status: detail.status ?? 'rendering', renderProgress: detail.renderProgress });
  };
  const onClose = (event: Event) => {
    const detail = detailOf(event);
    if (!isCloseClipEditorPayload(detail)) return;
    const node = readBound(detail, readGraph());
    if (node?.data.status === 'editing' || node?.data.status === 'rendering') {
      updateNode(node.id, { status: node.data.outputVideoUrl ? 'completed' : 'idle', renderProgress: undefined });
    }
  };
  target.addEventListener(OMNIMUX_CLIP_SAVE, onSave);
  target.addEventListener(OMNIMUX_CLIP_PROGRESS, onProgress);
  target.addEventListener(OMNIMUX_CLIP_CLOSE, onClose);
  return () => {
    target.removeEventListener(OMNIMUX_CLIP_SAVE, onSave);
    target.removeEventListener(OMNIMUX_CLIP_PROGRESS, onProgress);
    target.removeEventListener(OMNIMUX_CLIP_CLOSE, onClose);
  };
}
