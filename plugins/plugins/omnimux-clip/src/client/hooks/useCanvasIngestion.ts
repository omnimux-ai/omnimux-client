import { useEffect } from "react";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../openreel/web/stores/project-store";
import { getTimelineItems } from "../openreel/core/timeline/timeline-items";
import { canvasWorkspaceMediaUrl, mediaContentDigest, reconnectMediaUrl } from "../../timeline/nativeProjectFields.js";
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

function parseMedia(value: string, workspaceId: string | undefined): { url: string; reconnect?: string } | null {
  if (!value || /[\x00-\x1f\x7f]/u.test(value)) return null;
  if (value.startsWith("blob:") || /^data:(?:video|audio|image\/(?!svg))/i.test(value)) return { url: value };
  try {
    const base = 'https://clip.invalid';
    const request = new URL(value, base);
    const relative = /^\/(?!\/)/.test(value) && request.origin === base;
    const http = /^https?:\/\//i.test(value);
    if (request.username || /^https?:\/\/[^/]*@/i.test(value)) return null;
    if (WORKSPACE_FILE.test(request.pathname) && (relative || http && request.origin === globalThis.location?.origin)) {
      const url = canvasWorkspaceMediaUrl(relative ? value : request.pathname + request.search + request.hash, workspaceId);
      return url ? { url, reconnect: url } : null;
    }
    if (relative) {
      if (request.pathname === LOCAL_FILE) return { url: request.pathname + request.search };
      if (MEDIA_PATH.test(request.pathname)) {
        const url = request.pathname + request.search;
        return { url, reconnect: reconnectMediaUrl(url, workspaceId) };
      }
    }
    if (http) return { url: request.href };
    if (value.startsWith("//")) return null;
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
      return { url: `${LOCAL_FILE}?path=${encodeURIComponent(value)}` };
    }
  } catch {
    return null;
  }
  return null;
}

const MIME = { video: "video/mp4", image: "image/png", audio: "audio/mpeg" };

function importItems(inputs: NonNullable<CanvasSession["upstreamInputs"]>) {
  return [
    ...(inputs.videos ?? []).map(item => ({ ...item, type: "video" as const, name: item.name || "video.mp4" })),
    ...(inputs.images ?? []).map(item => ({ ...item, type: "image" as const, name: item.name || "image.png" })),
    ...(inputs.audios ?? []).map(item => ({ ...item, type: "audio" as const, name: item.name || "audio.mp3" })),
  ].slice(0, MAX_MEDIA);
}

function sourceKey(item: UpstreamMedia, url: string) {
  return item.path && !item.path.startsWith("blob:") ? item.path : item.sourceId || url;
}

async function readMediaFile(url: string, name: string, type: MediaItem['type'], signal: AbortSignal) {
  const response = await fetch(url, {
    signal, redirect: "error", mode: url.startsWith("/") ? "same-origin" : undefined,
    credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error(`Upstream media returned HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.size || /^image\/svg/i.test(blob.type)) throw new Error("Upstream media is not a supported file");
  return new File([blob], name, { type: blob.type.startsWith("application/") ? MIME[type] : blob.type || MIME[type] });
}

function workspaceLocator(url: string) {
  const query = new URL(url, "https://clip.invalid").searchParams;
  return { path: query.get("rel"), version: JSON.stringify([query.get("rev"), query.get("v")]) };
}

async function recoverLegacyCanvasMedia(
  items: readonly MediaItem[], upstream: ReturnType<typeof importItems>, workspaceId: string | undefined,
  signal: AbortSignal, isCurrent: () => boolean,
) {
  const placeholders = items.filter(item => item.sourceRef?.kind === "legacy" && item.isPlaceholder);
  if (!workspaceId || !placeholders.length) return;
  const connected = await Promise.all(upstream.map(async item => {
    const ref = parseMedia(item.url || item.path, workspaceId);
    const url = canvasWorkspaceMediaUrl(ref?.reconnect, workspaceId);
    if (!url) return;
    const locators = [...new Set([item.url, item.path, url].filter((value): value is string => Boolean(value)))];
    return { item, url, ...workspaceLocator(url), fingerprints: await Promise.all(locators.map(mediaDigest)) };
  }));

  for (const media of placeholders) {
    if (!isCurrent()) return;
    const retained = canvasWorkspaceMediaUrl(media.sourceRef?.url, workspaceId);
    const locator = retained ? workspaceLocator(retained) : undefined;
    const input = connected.find(source => source && source.item.type === media.type && (locator
      ? source.path === locator.path && source.version === locator.version
      : media.sourceRef?.fingerprint && source.fingerprints.includes(media.sourceRef.fingerprint)));
    const expected = mediaContentDigest(media);
    // Workflow's file route resolves rel to the current file on disk. A linked
    // replacement at the same path cannot prove the old bytes without a digest.
    if (locator && !expected && !input && connected.some(source => source?.path === locator.path)) continue;
    const url = retained ?? input?.url;
    if (!url) continue;
    try {
      const file = await readMediaFile(url, media.name, media.type, AbortSignal.any([signal, AbortSignal.timeout(12_000)]));
      if (!isCurrent()) return;
      const digest = await mediaDigest(file);
      if (expected && expected !== digest) throw new Error("The legacy media version changed");
      const id = await mediaDigest(input ? sourceKey(input.item, url) : url);
      const version = input?.item.sourceVersion ? await mediaDigest(input.item.sourceVersion) : digest;
      const store = useProjectStore.getState();
      if (!isCurrent()) return;
      if (store.getMediaItem(media.id) !== media) continue;
      const restored = await store.replaceMediaAsset(media.id, file, undefined, {
        restorePlaceholder: true, isCurrent, omnimuxSource: { id, version, url, digest },
      });
      if (!restored.success) throw new Error("Could not restore the legacy media");
    } catch (error) {
      if (isCurrent()) console.warn("[Clip] Legacy canvas media could not be restored.", (error as Error)?.name);
    }
  }
}

export function useCanvasIngestion(session: CanvasSession | null, token: AbortController | undefined, owns: () => boolean, onSaved: () => void) {
  useEffect(() => {
    if (!session?.projectId || !token || session.source !== "canvas") return;
    const controller = new AbortController();
    const signal = AbortSignal.any([token.signal, controller.signal]);
    const isCurrent = () => !signal.aborted && owns() && useProjectStore.getState().project.id === session.projectId;
    const inputs = session.upstreamInputs ?? {};
    const upstream = importItems(inputs);
    const importAll = async () => {
      if (!isCurrent()) return;
      const initial = useProjectStore.getState().project;
      const items = initial.mediaLibrary.items;
      if (initial.omnimuxCanvasInitialized || items.some(item => item.sourceRef?.kind === "legacy")
        || session.draftSchema && (items.length || getTimelineItems(initial).length)) {
        await recoverLegacyCanvasMedia(items, upstream, session.workspaceId, signal, isCurrent);
        if (!initial.omnimuxCanvasInitialized && isCurrent()) {
          useProjectStore.setState(state => ({ project: { ...state.project, omnimuxCanvasInitialized: true } }));
        }
        return;
      }
      let firstVideo: MediaItem | undefined;
      let failed = false;
      for (const item of upstream) {
        if (!isCurrent()) return;
        const ref = parseMedia(item.url || item.path, session.workspaceId);
        if (!ref || /\.svgz?(?:[?#]|$)/iu.test(item.path || item.name)) continue;
        try {
          const url = ref.url;
          const id = await mediaDigest(sourceKey(item, url));
          const requestedVersion = item.sourceVersion ? await mediaDigest(item.sourceVersion) : undefined;
          if (!isCurrent()) return;
          const findItem = (version: string) => useProjectStore.getState().project.mediaLibrary.items.find(media =>
            media.omnimuxSource?.id === id && media.omnimuxSource.version === version);
          const existing = requestedVersion ? findItem(requestedVersion) : undefined;
          if (existing && !existing.isPlaceholder) {
            if (!firstVideo && existing.type === 'video') firstVideo = existing;
            continue;
          }
          const file = await readMediaFile(url, item.name, item.type, signal);
          if (!isCurrent()) return;
          const digest = await mediaDigest(file);
          const version = requestedVersion ?? digest;
          if (!isCurrent()) return;
          const match = findItem(version);
          if (match && !match.isPlaceholder) {
            if (!firstVideo && match.type === 'video') firstVideo = match;
            continue;
          }
          const expected = mediaContentDigest(match);
          if (expected && expected !== digest) throw new Error('The upstream media version changed');
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
