/**
 * Canvas-side copy of the omnimux-clip JSON event contract.
 *
 * MUST NOT import omnimux-clip source (spec §2 / §4). Event names and
 * payload shapes are duplicated here so the island stays decoupled.
 */

import { v4 as uuidv4 } from 'uuid';

export const OMNIMUX_CLIP_OPEN = 'omnimux-clip-open';
export const OMNIMUX_CLIP_SAVE = 'omnimux-clip-save';
export const OMNIMUX_CLIP_CLOSE = 'omnimux-clip-close';
export const OMNIMUX_CLIP_PROGRESS = 'omnimux-clip-progress';

export type ClipMediaType = 'video' | 'image' | 'audio' | 'text';
export type TrackType = 'video' | 'audio' | 'text';
export type AspectRatio = '16:9' | '9:16' | '1:1';

export interface CanvasConfig {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  backgroundColor: string;
}

export interface TextStyleConfig {
  presetId?: string;
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  backgroundColor?: string;
  textAlign: 'left' | 'center' | 'right';
}

export interface TransitionConfig {
  type: 'none' | 'cut' | 'crossfade' | 'fadeblack';
  durationMs: number;
}

export interface ClipModel {
  id: string;
  trackId: string;
  name: string;
  mediaType: ClipMediaType;
  startTimeMs: number;
  durationMs: number;
  sourceUrl: string;
  sourceInMs: number;
  sourceOutMs: number;
  speed: number;
  volume: number;
  textStyle?: TextStyleConfig;
  transition?: TransitionConfig;
}

export interface TrackModel {
  id: string;
  name: string;
  type: TrackType;
  order: number;
  isMuted: boolean;
  isLocked: boolean;
  isVisible: boolean;
  clips: ClipModel[];
}

export interface TimelineSchema {
  version: '1.0';
  projectId: string;
  canvasConfig: CanvasConfig;
  tracks: TrackModel[];
  media: Array<{
    id: string;
    name: string;
    type: ClipMediaType;
    durationMs?: number;
    path: string;
  }>;
}

export interface CanvasClipBinding {
  workspaceId: string;
  nodeId: string;
  projectId: string;
}

export interface OpenClipEditorPayload extends CanvasClipBinding {
  source: 'canvas';
  nodeTitle?: string;
  draftSchema?: TimelineSchema;
  upstreamInputs?: {
    videos: Array<{ path: string; name: string; durationMs?: number; url?: string }>;
    audios: Array<{ path: string; name: string; durationMs?: number; url?: string }>;
    images: Array<{ path: string; name: string; displayDurationMs?: number; url?: string }>;
    captions?: Array<{ text: string; startTimeMs: number; durationMs: number }>;
  };
  canvasConfig?: Partial<CanvasConfig>;
}

export interface SaveClipEditorPayload extends CanvasClipBinding {
  schema?: TimelineSchema;
  createDownstreamNode?: boolean;
  output?: {
    videoPath: string;
    thumbnailPath?: string;
    durationMs?: number;
    width?: number;
    height?: number;
    /**
     * Content identity of the file just written (`mtimeMs:size` from the clip
     * host). Re-exporting overwrites the same path, so the downstream node
     * needs this token in its `mediaUrl` to make the browser fetch the new
     * bytes instead of reusing the stale `<video>` element.
     */
    revision?: string;
  };
}

export type VideoCompositionStatus = 'idle' | 'editing' | 'rendering' | 'completed' | 'error';

export interface VideoCompositionNodeData {
  [key: string]: unknown;
  title: string;
  label?: string;
  projectId?: string;
  schemaVersion?: '1.0';
  schema?: TimelineSchema;
  status: VideoCompositionStatus;
  renderProgress?: number;
  outputVideoUrl?: string;
  /** Content identity of `outputVideoUrl`; part of the downstream node's media URL. */
  outputRevision?: string;
  thumbnailUrl?: string;
  outputThumbnailUrl?: string;
  outputDurationMs?: number;
  outputWidth?: number;
  outputHeight?: number;
  errorMessage?: string;
}

export function newCanvasClipProjectId(): string {
  return `clip_node_${uuidv4()}`;
}

export function isClipProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

// Keep this wire guard in sync with omnimux-clip/src/client/clip-events.js.
export function isCanvasClipBinding(payload: unknown): payload is CanvasClipBinding {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const { workspaceId, nodeId, projectId } = payload as Record<string, unknown>;
  return typeof workspaceId === 'string' && /^ws_[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
    && typeof nodeId === 'string' && /^[^\s/\\\x00-\x1f\x7f]{1,256}$/.test(nodeId)
    && isClipProjectId(projectId);
}

export function isSaveClipEditorPayload(payload: unknown): payload is SaveClipEditorPayload {
  if (!isCanvasClipBinding(payload)) return false;
  const value = payload as unknown as Record<string, unknown>;
  if (value.schema != null && (typeof value.schema !== 'object' || Array.isArray(value.schema))) return false;
  if (value.output != null) {
    if (typeof value.output !== 'object' || Array.isArray(value.output)) return false;
    const { videoPath } = value.output as { videoPath?: unknown };
    if (typeof videoPath !== 'string' || !videoPath.trim()) return false;
  }
  return true;
}

export const isCloseClipEditorPayload = isCanvasClipBinding;

export function isProgressClipEditorPayload(
  payload: unknown,
): payload is CanvasClipBinding & { status?: VideoCompositionStatus; renderProgress?: number } {
  if (!isCanvasClipBinding(payload)) return false;
  const { status, renderProgress } = payload as CanvasClipBinding & { status?: unknown; renderProgress?: unknown };
  if (status !== undefined && !['idle', 'editing', 'rendering', 'completed', 'error'].some((value) => value === status)) return false;
  if (renderProgress !== undefined && (typeof renderProgress !== 'number' || !Number.isFinite(renderProgress))) return false;
  return true;
}
