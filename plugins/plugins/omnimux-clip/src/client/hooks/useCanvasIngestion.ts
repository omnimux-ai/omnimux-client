import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../openreel/web/stores/project-store";
import { getTimelineItems } from "../openreel/core/timeline/timeline-items";
import { canvasWorkspaceMediaUrl, mediaContentDigest, mediaHandleFromLocator, normalizeMediaHandle, reconnectMediaUrl, workspaceMediaDigest } from "../../timeline/nativeProjectFields.js";
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

type CanvasImportItem = ReturnType<typeof importItems>[number];

type CanvasImportScope = {
  workspaceId?: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

function deriveCanvasImportHandle(
  item: UpstreamMedia,
  locator: string | undefined,
  workspaceId: string | undefined,
  digest: string,
) {
  const fromUrl = mediaHandleFromLocator(locator, workspaceId, digest);
  if (fromUrl) return fromUrl;
  if (!workspaceId || !item.sourceId) return undefined;
  const parts = item.sourceId.split(':');
  const nodeId = parts[0];
  const parsedIndex = parts.length > 1 ? Number(parts[1]) : 0;
  const outputIndex = Number.isSafeInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
  return normalizeMediaHandle({ v: 1, scope: 'canvas-node', workspaceId, nodeId, outputIndex, sha256: digest }, workspaceId);
}

async function importCanvasFile(item: CanvasImportItem, { workspaceId, signal, isCurrent }: CanvasImportScope, returning: boolean) {
  const ref = parseMedia(item.url || item.path, workspaceId);
  if (!ref || (returning && !bridgeMediaLocator(ref.url)) || /\.svgz?(?:[?#]|$)/iu.test(item.path || item.name)) return;
  const key = ref.reconnect ?? ref.localFile ?? sourceKey(item, ref.url);
  const localPath = ref.localFile ? new URL(ref.localFile, 'https://clip.invalid').searchParams.get('path') : undefined;
  const [id, historicalId, localId, requestedVersion] = await Promise.all([
    mediaDigest(key), mediaDigest(sourceKey(item, ref.url)), localPath ? mediaDigest(localPath) : undefined,
    item.sourceVersion ? mediaDigest(item.sourceVersion) : undefined,
  ]);
  if (!isCurrent()) return;
  const pinnedDigest = workspaceMediaDigest(ref.reconnect, workspaceId);
  const contentOf = (media: MediaItem | undefined) => mediaContentDigest(media)
    ?? workspaceMediaDigest(media?.omnimuxSource?.url, workspaceId);
  const findMatch = (digest?: string) => {
    const candidates = useProjectStore.getState().project.mediaLibrary.items.filter(media => {
      const source = media.omnimuxSource;
      return media.type === item.type && source && (source.id === id || source.id === historicalId || source.id === localId
        || (ref.reconnect && source.url === ref.reconnect));
    });
    // Historical drafts can store the task ID where new opens use a file revision.
    const sameContent = digest ? candidates.filter(media => contentOf(media) === digest) : [];
    const version = requestedVersion ?? digest;
    return sameContent.find(media => !media.isPlaceholder) ?? sameContent[0]
      ?? (version ? candidates.find(media => media.omnimuxSource?.version === version) : undefined);
  };
  const existing = findMatch(pinnedDigest);
  if (existing && !existing.isPlaceholder && (!pinnedDigest || contentOf(existing) === pinnedDigest)) {
    return returning ? undefined : existing;
  }

  const file = await readMediaFile(ref.url, item.name, item.type,
    returning ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : signal);
  if (!isCurrent()) return;
  if (returning && !file.type.startsWith(`${item.type}/`)) throw new Error('The upstream media type changed');
  const digest = await mediaDigest(file);
  if (!isCurrent()) return;
  const match = findMatch(digest);
  const expected = contentOf(match);
  if ((pinnedDigest && pinnedDigest !== digest) || (expected && expected !== digest)) {
    throw new Error('The upstream media version changed');
  }
  if (match && !match.isPlaceholder) return returning ? undefined : match;

  const handle = deriveCanvasImportHandle(item, ref.reconnect ?? ref.url, workspaceId, digest);
  const omnimuxSource = {
    id: match?.omnimuxSource?.id ?? id,
    version: match?.omnimuxSource?.version ?? requestedVersion ?? digest,
    digest,
    ...(ref.reconnect ? { url: ref.reconnect } : {}),
    ...(handle ? { handle } : {}),
  };
  const store = useProjectStore.getState();
  const stillAssignable = () => isCurrent() && findMatch(digest) === match;
  const result = match
    ? await store.replaceMediaAsset(match.id, file, undefined, { restorePlaceholder: true, isCurrent: stillAssignable, omnimuxSource,
      ...(returning ? { expectedDigest: digest } : {}) })
    : await store.importMedia(file, undefined, { omnimuxSource }, { signal, isCurrent: stillAssignable, expectedType: returning ? item.type : undefined });
  if (!isCurrent()) return;
  if (!result.success || !result.actionId) throw new Error('Could not import the upstream media');
  return useProjectStore.getState().getMediaItem(match?.id ?? result.actionId);
}

async function connectedMedia(item: CanvasImportItem, workspaceId: string) {
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
      const recoveredHandle = mediaHandleFromLocator(url, workspaceId, digest);
      const omnimuxSource = sourceId ? {
        id: sourceId, version: digest, digest,
        ...(canvasWorkspaceMediaUrl(url, workspaceId) ? { url } : {}),
        ...(recoveredHandle ? { handle: recoveredHandle } : {}),
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

interface CanvasReturnFeedback {
  session: CanvasSession;
  token: AbortController;
  retrying: boolean;
  failed: Array<{ id: string; name: string }>;
  retry: (id: string) => void;
}

export function useCanvasIngestion(session: CanvasSession | null, token: AbortController | undefined,
  owns: () => boolean, onSaved: () => void, sessionId?: string,
) {
  // ClipStage stays mounted across Portal opens. Keep only unfinished reads for each binding.
  const pendingReturns = useRef(new Map<string, Map<string, CanvasImportItem>>());
  const acceptedReturns = useRef(new WeakSet<NonNullable<CanvasSession['mediaReturn']>>());
  const [feedback, setFeedback] = useState<CanvasReturnFeedback>();
  useEffect(() => {
    if (!session?.projectId || !token || session.source !== "canvas") return;
    const controller = new AbortController();
    const signal = AbortSignal.any([token.signal, controller.signal]);
    const executor = useProjectStore.getState().actionExecutor;
    const isCurrent = () => {
      const store = useProjectStore.getState();
      return !signal.aborted && owns() && store.project.id === session.projectId && store.actionExecutor === executor;
    };
    if (!isCurrent()) return;
    const inputs = session.upstreamInputs ?? {};
    const returning = session.mediaReturn;
    const upstream = importItems(inputs);
    const scope = { workspaceId: session.workspaceId, signal, isCurrent };
    const scopeKey = sessionId && session.workspaceId && session.nodeId
      ? JSON.stringify([sessionId, session.workspaceId, session.nodeId, session.projectId]) : undefined;
    const pending = (scopeKey && pendingReturns.current.get(scopeKey)) || new Map<string, CanvasImportItem>();
    if (returning && !acceptedReturns.current.has(returning)) {
      acceptedReturns.current.add(returning);
      for (const item of importItems(returning.upstreamInputs, Infinity)) {
        pending.set(JSON.stringify([item.type, item.url || item.path, item.sourceVersion]), item);
      }
      if (scopeKey && pending.size) pendingReturns.current.set(scopeKey, pending);
    }
    let importing = false;

    const importReturned = async (entries: Iterable<[string, CanvasImportItem]>) => {
      let firstVideo: MediaItem | undefined;
      for (const [key, item] of entries) {
        if (!isCurrent()) return;
        try {
          const media = await importCanvasFile(item, scope, true);
          if (!isCurrent()) return;
          pending.delete(key);
          if (!firstVideo && media?.type === 'video') firstVideo = media;
        } catch (error) {
          if (isCurrent()) console.warn('[Clip] Returned media could not be imported.', (error as Error)?.name);
        }
      }
      if (firstVideo) await placeFirstVideoInEmptyTimeline(firstVideo, isCurrent);
    };

    const publish = () => {
      if (signal.aborted) return;
      const failed = [...pending].map(([id, item]) => ({ id, name: item.name.split(/[/\\]/u).at(-1) || item.type }));
      setFeedback(failed.length ? { session, token, retrying: importing, failed, retry } : undefined);
    };

    const run = async (work: () => Promise<void>) => {
      importing = true;
      try {
        await work();
      } catch (error) {
        if (isCurrent()) console.warn('[Clip] Canvas source initialization failed.', (error as Error)?.name);
      } finally {
        importing = false;
        if (scopeKey && !pending.size && pendingReturns.current.get(scopeKey) === pending) pendingReturns.current.delete(scopeKey);
        publish();
        if (isCurrent()) onSaved();
      }
    };

    function retry(id: string) {
      const item = pending.get(id);
      if (!item || importing || !isCurrent()) return;
      void run(() => importReturned([[id, item]]));
      publish();
    }

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
      if (returning || pending.size) {
        await importReturned(pending);
        return;
      }
      if (initialized) return;
      let firstVideo: MediaItem | undefined;
      let failed = false;
      for (const item of upstream) {
        if (!isCurrent()) return;
        try {
          const imported = await importCanvasFile(item, scope, false);
          if (!firstVideo && imported?.type === 'video') firstVideo = imported;
        } catch (error) {
          failed = true;
          if (isCurrent()) console.warn('[Clip] Upstream media could not be imported.', (error as Error)?.name);
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
    void run(importAll);
    return () => controller.abort();
  }, [session, token, owns, onSaved, sessionId]);
  return feedback && feedback.session === session && feedback.token === token ? feedback : undefined;
}
