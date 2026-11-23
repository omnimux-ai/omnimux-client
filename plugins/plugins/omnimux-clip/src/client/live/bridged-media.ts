import { isReferenceId, mediaContentDigest, mediaHandleFromLocator, sha256Digest, workspaceMediaDigest } from '../../timeline/nativeProjectFields.js';
import { getTimelineItems } from '../openreel/core/timeline/timeline-items';
import { interpretedDisplaySize, type MediaItem } from '../openreel/core';
import { useProjectStore } from '../openreel/web/stores/project-store';
import { fetchHostMediaBlob } from './host-media';
import { bridgeMediaLocator } from './media-bridge-source.js';
import { mediaDigest } from './media-source';

export interface MediaBridgeItem {
  id: string;
  url: string;
  name: string;
  type: MediaItem['type'];
  version?: string;
}

export interface MediaBridgeProgress {
  id: string;
  status: 'reading' | 'imported' | 'existing' | 'failed';
  mediaId?: string;
}

interface ImportOptions {
  signal: AbortSignal;
  isCurrent: () => boolean;
  onItem?: (result: MediaBridgeProgress) => void;
}

const MEDIA_MIME = { video: 'video/mp4', image: 'image/png', audio: 'audio/mpeg' };
const READ_TIMEOUT_MS = 45_000;

export async function placeFirstVideoInEmptyTimeline(item: MediaItem, isCurrent: () => boolean) {
  const state = useProjectStore.getState();
  const timelineIsEmpty = () => getTimelineItems(useProjectStore.getState().project).length === 0;
  if (item.type !== 'video' || !isCurrent() || !timelineIsEmpty()) return;
  const { width, height } = interpretedDisplaySize(item);
  if (width > 0 && height > 0 && (width !== state.project.settings.width || height !== state.project.settings.height)) {
    await state.updateSettings({ width, height });
  }
  if (isCurrent() && timelineIsEmpty()) await useProjectStore.getState().addClipToNewTrack(item.id, 0, { isCurrent });
}

async function fetchBridgeFile(url: string, item: MediaBridgeItem, signal: AbortSignal) {
  const response = await fetch(url, {
    method: 'GET', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error('The media could not be read');
  const blob = await response.blob();
  const type = blob.type || 'application/octet-stream';
  const mime = type === 'application/octet-stream' ? MEDIA_MIME[item.type] : type;
  const name = item.name.split(/[/\\]/u).at(-1)?.trim();
  if (!blob.size || !name || /\.svgz?$/iu.test(name) || /^image\/svg/iu.test(mime)
    || !mime.startsWith(`${item.type}/`)) throw new Error('The media type does not match');
  return new File([blob], name, { type: mime });
}

/** Import approved same-origin media into the currently owned native project. */
export async function importBridgedMedia(items: readonly MediaBridgeItem[], options: ImportOptions) {
  const { signal, onItem } = options;
  const origin = useProjectStore.getState();
  const isCurrent = () => {
    const current = useProjectStore.getState();
    return !signal.aborted && options.isCurrent() && origin.project.id === current.project.id
      && origin.actionExecutor === current.actionExecutor;
  };
  const seen = new Set<string>();
  let handledFirstVideo = false;
  for (const item of items) {
    if (!isCurrent()) return;
    const selectionKey = JSON.stringify([item.id, item.version]);
    if (seen.has(selectionKey)) continue;
    seen.add(selectionKey);
    const matches = (media: MediaItem) => media.omnimuxSource?.id === item.id
      && (item.version === undefined || media.omnimuxSource.version === item.version);
    const find = () => useProjectStore.getState().project.mediaLibrary.items.find(matches);
    try {
      const url = bridgeMediaLocator(item.url);
      if (!url || !isReferenceId(item.id) || (item.version !== undefined && !isReferenceId(item.version))) {
        throw new Error('The source is not an approved media file');
      }
      const existing = find();
      if (existing && !existing.isPlaceholder) {
        onItem?.({ id: item.id, status: 'existing', mediaId: existing.id });
        continue;
      }
      onItem?.({ id: item.id, status: 'reading' });
      const file = await fetchBridgeFile(url, item, signal);
      const digest = await mediaDigest(file);
      if (!isCurrent()) return;
      const workspaceId = /^\/omnimux-workflow\/api\/workspaces\/([^/]+)\/file\?/.exec(url)?.[1];
      const expectedVersion = workspaceMediaDigest(url, workspaceId);
      const expectedContent = mediaContentDigest(existing);
      if ((expectedVersion && digest !== expectedVersion) || (expectedContent && digest !== expectedContent)) {
        throw new Error('The source media version changed');
      }
      const current = useProjectStore.getState();
      const handle = mediaHandleFromLocator(url, workspaceId, digest);
      const omnimuxSource = {
        id: item.id,
        version: item.version ?? digest,
        digest,
        ...(expectedVersion ? { url } : {}),
        ...(handle ? { handle } : {}),
      };
      const stillAssignable = () => isCurrent() && find() === existing;
      const result = existing
        ? await current.replaceMediaAsset(existing.id, file, undefined, { restorePlaceholder: true, isCurrent: stillAssignable, expectedDigest: digest, omnimuxSource })
        : await current.importMedia(file, undefined, { omnimuxSource }, { signal, isCurrent: stillAssignable, expectedType: item.type });
      if (!isCurrent()) return;
      const imported = find();
      if (!imported || imported.isPlaceholder) throw new Error('The media was not imported');
      if (result.success && imported.type === 'video' && !handledFirstVideo) {
        handledFirstVideo = true;
        await placeFirstVideoInEmptyTimeline(imported, isCurrent);
      }
      if (isCurrent()) onItem?.({ id: item.id, status: result.success ? 'imported' : 'existing', mediaId: imported.id });
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('[Clip] Media import failed.', (error as Error)?.name);
      onItem?.({ id: item.id, status: 'failed' });
    }
  }
}

/**
 * Relink an existing media library entry to an approved OmniMux Asset Library or
 * workspace media item, preserving `mediaId` and all timeline placements.
 */
export async function relinkMediaFromBridgeItem(
  mediaId: string,
  item: MediaBridgeItem,
  options: { signal: AbortSignal; isCurrent: () => boolean },
): Promise<{ success: boolean; error?: string }> {
  const { signal } = options;
  const origin = useProjectStore.getState();
  const isCurrent = () => {
    const current = useProjectStore.getState();
    return !signal.aborted && options.isCurrent() && origin.project.id === current.project.id
      && origin.actionExecutor === current.actionExecutor;
  };
  const target = origin.project.mediaLibrary.items.find(row => row.id === mediaId);
  if (!target) return { success: false, error: 'Media item not found.' };
  if (target.type !== item.type) return { success: false, error: 'Media type does not match.' };
  const url = bridgeMediaLocator(item.url);
  if (!url || !isReferenceId(item.id) || (item.version !== undefined && !isReferenceId(item.version))) {
    return { success: false, error: 'The source is not an approved media file.' };
  }
  const file = await fetchBridgeFile(url, item, signal);
  const digest = await mediaDigest(file);
  if (!isCurrent()) return { success: false, error: 'Editor project changed during relink.' };
  const workspaceId = /^\/omnimux-workflow\/api\/workspaces\/([^/]+)\/file\?/.exec(url)?.[1];
  const expectedVersion = workspaceMediaDigest(url, workspaceId);
  if (expectedVersion && digest !== expectedVersion) {
    return { success: false, error: 'The source media version changed.' };
  }
  const handle = mediaHandleFromLocator(url, workspaceId, digest);
  const omnimuxSource = {
    id: item.id,
    version: item.version ?? `sha256:${digest}`,
    digest,
    ...(expectedVersion ? { url } : {}),
    ...(handle ? { handle } : {}),
  };
  const result = await useProjectStore.getState().replaceMediaAsset(mediaId, file, undefined, {
    isCurrent,
    omnimuxSource,
  });
  return result.success ? { success: true } : { success: false, error: result.error?.message || 'Could not relink media.' };
}

export interface HostReconcileHandle {
  v: 1;
  scope: 'project-asset' | 'library-file' | 'canvas-node' | 'clip-vault';
  workspaceId?: string;
  assetId?: string;
  rel?: string;
  libraryAssetId?: string;
  fileId?: string;
  nodeId?: string;
  outputIndex?: number;
  sha256?: string;
  mimeType?: string;
  size?: number;
}

export interface HostMediaHydrateInput {
  projectId: string;
  mediaId: string;
  name?: string;
  type: MediaItem['type'];
  currentSha256?: string;
  canonicalHandle?: HostReconcileHandle;
  restorePlaceholder: boolean;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export function projectAssetUrlFromHandle(handle?: HostReconcileHandle): string | undefined {
  if (!handle || handle.scope !== 'project-asset' || !handle.workspaceId || !handle.rel) return undefined;
  const rev = sha256Digest(handle.sha256);
  const query = new URLSearchParams({ rel: handle.rel, ...(rev ? { rev: `sha256:${rev}` } : {}) });
  return `/omnimux-workflow/api/workspaces/${encodeURIComponent(handle.workspaceId)}/file?${query.toString()}`;
}

/**
 * Insert a placeholder media item returned by Host `reconcile(import_upstream)`
 * into the live OpenReel store while preserving the exact Host `mediaId`.
 */
export function ensureHostPlaceholderInStore(hostItem: MediaItem, isCurrent: () => boolean): boolean {
  if (!isCurrent()) return false;
  const state = useProjectStore.getState();
  if (state.project.mediaLibrary.items.some(row => row.id === hostItem.id)) return true;
  useProjectStore.setState({
    project: {
      ...state.project,
      mediaLibrary: {
        ...state.project.mediaLibrary,
        items: [...state.project.mediaLibrary.items, { ...hostItem, blob: null, fileHandle: null, missing: true, isPlaceholder: true }],
      },
      modifiedAt: Date.now(),
    },
  });
  return true;
}

/**
 * Fetch verified bytes for a Host-reconciled media item and bind them into the
 * live OpenReel project store, keeping `mediaId` and all timeline placements intact.
 */
export async function hydrateProjectMediaFromHost(
  input: HostMediaHydrateInput,
): Promise<{ success: boolean; error?: string }> {
  const { projectId, mediaId, name, type, currentSha256, canonicalHandle, restorePlaceholder, signal } = input;
  const origin = useProjectStore.getState();
  const isCurrent = () => {
    const current = useProjectStore.getState();
    return !signal.aborted && input.isCurrent() && origin.project.id === current.project.id
      && origin.actionExecutor === current.actionExecutor;
  };
  const target = origin.project.mediaLibrary.items.find(row => row.id === mediaId);
  if (!target) return { success: false, error: 'Media item not found.' };
  const expectedDigest = sha256Digest(currentSha256) ?? sha256Digest(canonicalHandle?.sha256);
  const fetched = await fetchHostMediaBlob(projectId, mediaId, { expectedDigest, signal });
  if (!isCurrent()) return { success: false, error: 'Editor project changed during sync.' };
  if (!fetched.ok || !fetched.blob) {
    return { success: false, error: fetched.code || 'Could not read verified media bytes from host.' };
  }
  const blob = fetched.blob;
  const mime = !blob.type || blob.type === 'application/octet-stream'
    ? (canonicalHandle?.mimeType || MEDIA_MIME[type])
    : blob.type;
  const safeName = (name || target.name || mediaId).split(/[/\\]/u).at(-1)?.trim() || mediaId;
  const file = new File([blob], safeName, { type: mime });
  const digest = sha256Digest(fetched.digest) ?? expectedDigest ?? await mediaDigest(file);
  if (!isCurrent()) return { success: false, error: 'Editor project changed during sync.' };
  const workspaceUrl = projectAssetUrlFromHandle(canonicalHandle);
  const sourceId = target.omnimuxSource?.id
    ?? (canonicalHandle?.scope === 'library-file' && canonicalHandle.libraryAssetId && canonicalHandle.fileId
      ? `${canonicalHandle.libraryAssetId}:${canonicalHandle.fileId}`
      : canonicalHandle?.scope === 'canvas-node' && canonicalHandle.workspaceId && canonicalHandle.nodeId
        ? `${canonicalHandle.workspaceId}:${canonicalHandle.nodeId}:${canonicalHandle.outputIndex ?? 0}`
        : mediaId);
  const omnimuxSource = {
    id: sourceId,
    version: `sha256:${digest}`,
    digest,
    ...(workspaceUrl ? { url: workspaceUrl } : {}),
    ...(canonicalHandle ? { handle: canonicalHandle } : {}),
  };
  const result = await useProjectStore.getState().replaceMediaAsset(mediaId, file, undefined, {
    restorePlaceholder,
    isCurrent,
    expectedDigest: digest,
    omnimuxSource,
  });
  return result.success ? { success: true } : { success: false, error: result.error?.message || 'Could not hydrate media.' };
}
