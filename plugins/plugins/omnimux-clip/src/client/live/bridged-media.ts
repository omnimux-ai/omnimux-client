import { isReferenceId, mediaContentDigest, workspaceMediaDigest } from '../../timeline/nativeProjectFields.js';
import { getTimelineItems } from '../openreel/core/timeline/timeline-items';
import { interpretedDisplaySize, type MediaItem } from '../openreel/core';
import { useProjectStore } from '../openreel/web/stores/project-store';
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
      const omnimuxSource = { id: item.id, version: item.version ?? digest, digest, ...(expectedVersion ? { url } : {}) };
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
