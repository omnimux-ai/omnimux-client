import { useEffect } from "react";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../openreel/web/stores/project-store";
import { getTimelineItems } from "../openreel/core/timeline/timeline-items";
import { reconnectMediaUrl } from "../../timeline/nativeProjectFields.js";
import { mediaDigest } from "../live/media-source";

const MAX_MEDIA = 20;
const MAX_CAPTIONS = 120;
const LOCAL_FILE = "/omnimux-workflow/api/local-file";
const WORKSPACE_FILE = /^\/omnimux-workflow\/api\/workspaces\/ws_[A-Za-z0-9_-]+\/file$/;
const MEDIA_PATH = /^\/(?:omnimux-workflow\/)?media\/.+/;

interface UpstreamMedia {
  path: string;
  name: string;
  url?: string;
  sourceId?: string;
  sourceVersion?: string;
}

export interface CanvasSession {
  source?: "canvas" | "sidebar" | "agent";
  workspaceId?: string;
  nodeId?: string;
  nodeTitle?: string;
  projectId?: string;
  draftSchema?: unknown;
  upstreamInputs?: {
    videos?: UpstreamMedia[];
    audios?: UpstreamMedia[];
    images?: UpstreamMedia[];
    captions?: Array<{ text: string; startTimeMs: number; durationMs: number }>;
  };
}

function parseMedia(value: string): { url: string; reconnect?: string } | null {
  if (!value || /[\x00-\x1f\x7f]/u.test(value)) return null;
  if (value.startsWith("blob:") || /^data:(?:video|audio|image\/(?!svg))/i.test(value)) return { url: value };
  try {
    const request = new URL(value, 'https://clip.invalid');
    if (/^https?:\/\/[^/]*@/i.test(value)) return null;
    if (/^\/(?!\/)/.test(value)) {
      if (request.pathname === LOCAL_FILE) return { url: request.pathname + request.search };
      if (WORKSPACE_FILE.test(request.pathname) || MEDIA_PATH.test(request.pathname)) {
        const url = request.pathname + request.search;
        return { url, reconnect: reconnectMediaUrl(url) };
      }
    }
    if (/^https?:\/\//i.test(value)) return { url: request.href };
    if (value.startsWith("//")) return null;
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
      return { url: `${LOCAL_FILE}?path=${encodeURIComponent(value)}` };
    }
  } catch {
    return null;
  }
  return null;
}

function importItems(inputs: NonNullable<CanvasSession["upstreamInputs"]>) {
  return [
    ...(inputs.videos ?? []).map(item => ({ ...item, mime: "video/mp4", name: item.name || "video.mp4" })),
    ...(inputs.images ?? []).map(item => ({ ...item, mime: "image/png", name: item.name || "image.png" })),
    ...(inputs.audios ?? []).map(item => ({ ...item, mime: "audio/mpeg", name: item.name || "audio.mp3" })),
  ].slice(0, MAX_MEDIA);
}

export function useCanvasIngestion(session: CanvasSession | null, token: AbortController | undefined, owns: () => boolean, onSaved: () => void) {
  useEffect(() => {
    if (!session?.projectId || !token || session.source !== "canvas") return;
    const controller = new AbortController();
    const signal = AbortSignal.any([token.signal, controller.signal]);
    const isCurrent = () => !signal.aborted && owns() && useProjectStore.getState().project.id === session.projectId;
    const inputs = session.upstreamInputs ?? {};
    const importAll = async () => {
      const initial = useProjectStore.getState().project;
      if (initial.omnimuxCanvasInitialized || session.draftSchema && initial.mediaLibrary.items.length) return;
      let firstVideo: MediaItem | undefined;
      let failed = false;
      for (const item of importItems(inputs)) {
        if (!isCurrent()) return;
        const ref = parseMedia(item.url || item.path);
        if (!ref || /\.svgz?(?:[?#]|$)/iu.test(item.path || item.name)) continue;
        try {
          const url = ref.url;
          const stableSource = item.path && !item.path.startsWith("blob:") ? item.path : (item.sourceId || url);
          const id = await mediaDigest(stableSource);
          const requestedVersion = item.sourceVersion ? await mediaDigest(item.sourceVersion) : undefined;
          if (!isCurrent()) return;
          const findItem = (version: string) => useProjectStore.getState().project.mediaLibrary.items.find(media =>
            media.omnimuxSource?.id === id && media.omnimuxSource.version === version);
          const existing = requestedVersion ? findItem(requestedVersion) : undefined;
          if (existing && !existing.isPlaceholder) {
            if (!firstVideo && existing.type === 'video') firstVideo = existing;
            continue;
          }
          const response = await fetch(url, { signal, redirect: "error", credentials: "same-origin" });
          if (!isCurrent()) return;
          if (!response.ok) throw new Error(`Upstream media returned HTTP ${response.status}`);
          const blob = await response.blob();
          if (!isCurrent()) return;
          if (/^image\/svg/i.test(blob.type)) continue;
          const digest = !requestedVersion || ref.reconnect ? await mediaDigest(blob) : undefined;
          const version = requestedVersion ?? digest!;
          if (!isCurrent()) return;
          const match = findItem(version);
          if (match && !match.isPlaceholder) {
            if (!firstVideo && match.type === 'video') firstVideo = match;
            continue;
          }
          if (match?.omnimuxSource?.digest && match.omnimuxSource.digest !== digest) throw new Error('The upstream media version changed');
          const file = new File([blob], item.name, { type: blob.type.startsWith("application/") ? item.mime : blob.type || item.mime });
          const omnimuxSource = { id, version, ...(ref.reconnect ? { url: ref.reconnect, digest } : {}) };
          const store = useProjectStore.getState();
          const result = match
            ? await store.replaceMediaAsset(match.id, file, undefined, { restorePlaceholder: true, isCurrent, omnimuxSource })
            : await store.importMedia(file, undefined, { omnimuxSource }, { signal, isCurrent });
          if (!isCurrent()) return;
          if (!result.success || !result.actionId) throw new Error("Could not import the upstream media");
          const imported = useProjectStore.getState().getMediaItem(match?.id ?? result.actionId);
          if (!firstVideo && imported?.type === "video") firstVideo = imported;
        } catch (error) {
          failed = true;
          if (isCurrent()) console.warn("[Clip] Upstream media could not be imported.", (error as Error)?.name);
        }
      }

      if (firstVideo && isCurrent() && getTimelineItems(useProjectStore.getState().project).length === 0) {
        const { width, height } = firstVideo.metadata;
        if (width && height) await useProjectStore.getState().updateSettings({ width, height });
        if (!isCurrent()) return;
        if (getTimelineItems(useProjectStore.getState().project).length === 0) {
          await useProjectStore.getState().addClipToNewTrack(firstVideo.id, 0, { isCurrent });
        }
      }
      const cues = (inputs.captions ?? []).filter(cue => cue.text && cue.startTimeMs >= 0 && cue.durationMs > 0).slice(0, MAX_CAPTIONS);
      if (cues.length && isCurrent()) {
        const { executeNativeEdit } = await import("../live/native-edit");
        const current = useProjectStore.getState().project;
        const existing = new Set([...getTimelineItems(current).map(item => item.id), ...current.timeline.subtitles.map(cue => cue.id)]);
        const operations = (await Promise.all(cues.map(async (cue) => ({
          type: "add_text", kind: "subtitle", clipId: `canvas-caption-${await mediaDigest(JSON.stringify(cue))}`,
          content: cue.text, startSec: cue.startTimeMs / 1000, durationSec: cue.durationMs / 1000,
        })))).filter(operation => !existing.has(operation.clipId));
        if (operations.length && isCurrent()) await executeNativeEdit({ operations, description: "Import canvas captions" }, {
          assertCurrent() { if (!isCurrent()) throw new Error("The canvas binding changed"); },
        });
      }
      if (isCurrent() && !failed) useProjectStore.setState(state => ({ project: { ...state.project, omnimuxCanvasInitialized: true } }));
    };
    void importAll().catch(error => {
      if (isCurrent()) console.warn("[Clip] Canvas source initialization failed.", error?.name);
    }).finally(() => { if (isCurrent()) onSaved(); });
    return () => controller.abort();
  }, [session, token, owns, onSaved]);
}
