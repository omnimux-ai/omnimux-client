import { useEffect, useRef } from "react";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../openreel/web/stores/project-store";
import { getTimelineItems } from "../openreel/core/timeline/timeline-items";
import { canvasWorkspaceMediaUrl, mediaContentDigest, reconnectMediaUrl, workspaceMediaDigest } from "../../timeline/nativeProjectFields.js";
import { mediaDigest, verifiedMediaBlob } from "../live/media-source";
import { createStoredMediaRecovery } from "../live/media-recovery";
import { bridgeMediaLocator } from "../live/media-bridge-source.js";
import { placeFirstVideoInEmptyTimeline } from "../live/bridged-media";

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
  mediaReturn?: { requestId: string; upstreamInputs: Pick<NonNullable<CanvasSession['upstreamInputs']>, 'videos' | 'audios' | 'images'> };
}

function localFileReconnect(request: URL): string | undefined {
  const { hash, pathname, search, searchParams } = request;
  const path = searchParams.get('path');
  if (!path || hash || /[\x00-\x1f\x7f]/u.test(path) || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(path)) return undefined;
  const keys = ['path', 'rev', 'v'];
  if ([...searchParams.keys()].some(key => !keys.includes(key)) || keys.some(key => searchParams.getAll(key).length > 1)) return undefined;
  return pathname + search;
}

function parseMedia(value: string, workspaceId: string | undefined): { url: string; reconnect?: string; localFile?: string } | null {
  if (!value || /[\x00-\x1f\x7f]/u.test(value)) return null;
  if (value.startsWith("blob:") || /^data:(?:video|audio|image\/(?!svg))/i.test(value)) return { url: value };
  try {
    const base = 'https://clip.invalid';
    const request = new URL(value, base);
    const relative = /^\/(?!\/)/.test(value) && request.origin === base;
    const http = /^https?:\/\//i.test(value);
    if (request.username || /^https?:\/\/[^/]*@/i.test(value)) return null;
    const sameOrigin = relative || http && request.origin === globalThis.location?.origin;
    if (WORKSPACE_FILE.test(request.pathname) && sameOrigin) {
      const url = canvasWorkspaceMediaUrl(relative ? value : request.pathname + request.search + request.hash, workspaceId);
      return url ? { url, reconnect: url } : null;
    }
    if (request.pathname === LOCAL_FILE && sameOrigin) {
      return { url: request.pathname + request.search, localFile: localFileReconnect(request) };
    }
    if (relative) {
      if (MEDIA_PATH.test(request.pathname)) {
        const url = request.pathname + request.search;
        return { url, reconnect: reconnectMediaUrl(url, workspaceId) };
      }
    }
    if (http) return { url: request.href };
    if (value.startsWith("//")) return null;
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
      const url = `${LOCAL_FILE}?path=${encodeURIComponent(value)}`;
      return { url, localFile: url };
    }
  } catch {
    return null;
  }
  return null;
}

const MIME = { video: "video/mp4", image: "image/png", audio: "audio/mpeg" };

function importItems(inputs: NonNullable<CanvasSession["upstreamInputs"]>, limit = MAX_MEDIA) {
  return [
    ...(inputs.videos ?? []).map(item => ({ ...item, type: "video" as const, name: item.name || "video.mp4" })),
    ...(inputs.images ?? []).map(item => ({ ...item, type: "image" as const, name: item.name || "image.png" })),
    ...(inputs.audios ?? []).map(item => ({ ...item, type: "audio" as const, name: item.name || "audio.mp3" })),
  ].slice(0, limit);
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

async function connectedMedia(item: ReturnType<typeof importItems>[number], workspaceId: string) {
  const ref = parseMedia(item.url || item.path, workspaceId);
  const workspaceUrl = canvasWorkspaceMediaUrl(ref?.reconnect, workspaceId);
  const url = workspaceUrl ?? ref?.localFile;
  if (!url) return undefined;
  const locators = [url];
  if (workspaceUrl) {
    // A historical hash-only record must match the complete versioned locator.
    for (const alias of [item.path, item.url]) {
      if (alias && parseMedia(alias, workspaceId)?.reconnect === url) locators.push(alias);
    }
  } else {
    const pathOf = (value: string) => new URL(value, 'https://clip.invalid').searchParams.get('path');
    const path = pathOf(url);
    if (path) locators.push(path);
    for (const alias of [item.path, item.url]) {
      const localUrl = alias && parseMedia(alias, workspaceId)?.localFile;
      if (localUrl && pathOf(localUrl) === path) locators.push(alias);
    }
  }
  return { type: item.type, url, workspaceUrl, fingerprints: await Promise.all([...new Set(locators)].map(mediaDigest)) };
}

async function recoverCanvasMedia(
  items: readonly MediaItem[], upstream: ReturnType<typeof importItems>, session: CanvasSession,
  signal: AbortSignal, isCurrent: () => boolean,
) {
  const placeholders = items.filter(item => item.isPlaceholder && (item.sourceRef?.kind === 'legacy' || mediaContentDigest(item)));
  const { workspaceId, nodeId, projectId } = session;
  if (!workspaceId || !projectId || !placeholders.length) return;
  const connected = await Promise.all(upstream.map(item => connectedMedia(item, workspaceId)));
  const readStored = createStoredMediaRecovery(projectId, { workspaceId, nodeId, projectId }, isCurrent);

  for (const media of placeholders) {
    if (!isCurrent()) return;
    const legacy = media.sourceRef?.kind === 'legacy';
    const fingerprint = media.sourceRef?.fingerprint;
    const upstreamId = legacy ? undefined : media.omnimuxSource?.id;
    const input = connected.find(source => source && source.type === media.type && (legacy || !source.workspaceUrl)
      && source.fingerprints.some(value => value === fingerprint || value === upstreamId));
    const retained = legacy ? canvasWorkspaceMediaUrl(media.sourceRef?.url, workspaceId) : undefined;
    const url = retained ?? (input ? input.url : undefined);
    // A mutable URL or an opaque revision label cannot establish the bytes
    // that the old timeline referred to. A typed SHA must be on the old URL.
    const digest = mediaContentDigest(media) ?? (legacy ? workspaceMediaDigest(url, workspaceId) : undefined);
    if (!digest) continue;
    try {
      const stored = await readStored(media, digest);
      if (!isCurrent()) return;
      const file = stored ? new File([stored], media.name, { type: stored.type || MIME[media.type] })
        : url ? await readMediaFile(url, media.name, media.type, AbortSignal.any([signal, AbortSignal.timeout(12_000)])) : undefined;
      if (!isCurrent()) return;
      if (!file) continue;
      if (!stored && !await verifiedMediaBlob(file, digest)) throw new Error('The source media version changed');
      const sourceId = legacy ? fingerprint ?? (url ? await mediaDigest(url) : undefined) : undefined;
      const omnimuxSource = sourceId ? {
        id: sourceId, version: digest, digest,
        ...(canvasWorkspaceMediaUrl(url, workspaceId) ? { url } : {}),
      } : media.omnimuxSource;
      const store = useProjectStore.getState();
      if (!isCurrent()) return;
      if (store.getMediaItem(media.id) !== media) continue;
      const restored = await store.replaceMediaAsset(media.id, file, undefined, {
        restorePlaceholder: true, expectedDigest: digest, isCurrent, omnimuxSource,
      });
      if (!restored.success) throw new Error('Could not restore the original media');
    } catch (error) {
      if (isCurrent()) console.warn('[Clip] Canvas media could not be restored.', (error as Error)?.name);
    }
  }
}

export function useCanvasIngestion(session: CanvasSession | null, token: AbortController | undefined, owns: () => boolean, onSaved: () => void) {
  const finishedReturn = useRef<string>();
  useEffect(() => {
    if (!session?.projectId || !token || session.source !== "canvas") return;
    const controller = new AbortController();
    const signal = AbortSignal.any([token.signal, controller.signal]);
    const executor = useProjectStore.getState().actionExecutor;
    const isCurrent = () => {
      const store = useProjectStore.getState();
      return !signal.aborted && owns() && store.project.id === session.projectId && store.actionExecutor === executor;
    };
    const inputs = session.upstreamInputs ?? {};
    const returning = session.mediaReturn;
    const upstream = importItems(inputs);
    const importAll = async () => {
      if (!isCurrent()) return;
      const initial = useProjectStore.getState().project;
      const items = initial.mediaLibrary.items;
      await recoverCanvasMedia(items, upstream, session, signal, isCurrent);
      if (!isCurrent()) return;
      const initialized = initial.omnimuxCanvasInitialized || items.some(item => item.sourceRef?.kind === "legacy")
        || session.draftSchema && (items.length || getTimelineItems(initial).length);
      if (initialized && !initial.omnimuxCanvasInitialized) {
        useProjectStore.setState(state => ({ project: { ...state.project, omnimuxCanvasInitialized: true } }));
      }
      if (returning ? finishedReturn.current === returning.requestId : initialized) return;
      const candidates = returning ? importItems(returning.upstreamInputs, Infinity) : upstream;
      let firstVideo: MediaItem | undefined;
      let failed = false;
      for (const item of candidates) {
        if (!isCurrent()) return;
        const ref = parseMedia(item.url || item.path, session.workspaceId);
        if (!ref || (returning && !bridgeMediaLocator(ref.url)) || /\.svgz?(?:[?#]|$)/iu.test(item.path || item.name)) continue;
        try {
          const url = ref.url;
          const id = await mediaDigest(sourceKey(item, url));
          const requestedVersion = item.sourceVersion ? await mediaDigest(item.sourceVersion) : undefined;
          if (!isCurrent()) return;
          const findItem = (version: string) => useProjectStore.getState().project.mediaLibrary.items.find(media =>
            media.omnimuxSource?.id === id && media.omnimuxSource.version === version);
          const existing = requestedVersion ? findItem(requestedVersion) : undefined;
          if (existing && !existing.isPlaceholder) {
            if (!returning && !firstVideo && existing.type === 'video') firstVideo = existing;
            continue;
          }
          const file = await readMediaFile(url, item.name, item.type,
            returning ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : signal);
          if (!isCurrent()) return;
          if (returning && !file.type.startsWith(`${item.type}/`)) throw new Error('The upstream media type changed');
          const digest = await mediaDigest(file);
          const version = requestedVersion ?? digest;
          if (!isCurrent()) return;
          const match = findItem(version);
          if (match && !match.isPlaceholder) {
            if (!returning && !firstVideo && match.type === 'video') firstVideo = match;
            continue;
          }
          const expected = mediaContentDigest(match);
          const requestedDigest = workspaceMediaDigest(ref.reconnect, session.workspaceId);
          if ((expected && expected !== digest) || (requestedDigest && requestedDigest !== digest)) {
            throw new Error('The upstream media version changed');
          }
          const omnimuxSource = { id, version, ...(ref.reconnect ? { url: ref.reconnect, digest } : {}) };
          const store = useProjectStore.getState();
          const result = match
            ? await store.replaceMediaAsset(match.id, file, undefined, { restorePlaceholder: true, isCurrent, omnimuxSource,
              ...(returning ? { expectedDigest: digest } : {}) })
            : await store.importMedia(file, undefined, { omnimuxSource }, { signal, isCurrent, expectedType: returning ? item.type : undefined });
          if (!isCurrent()) return;
          if (!result.success || !result.actionId) throw new Error("Could not import the upstream media");
          const imported = useProjectStore.getState().getMediaItem(match?.id ?? result.actionId);
          if (!firstVideo && imported?.type === "video") firstVideo = imported;
        } catch (error) {
          failed = true;
          if (isCurrent()) console.warn("[Clip] Upstream media could not be imported.", (error as Error)?.name);
        }
      }

      if (returning) {
        if (firstVideo) await placeFirstVideoInEmptyTimeline(firstVideo, isCurrent);
        if (isCurrent() && !failed) finishedReturn.current = returning.requestId;
        return;
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
