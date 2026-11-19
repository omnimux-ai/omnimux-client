/**
 * Build LocalFileDraft from an absolute disk path provided by the desktop host.
 * Canvas-island safe: no node:path.
 */
import {
  localFileMediaUrl,
  looksAbsolutePath,
  materialTypeFromFilename,
  mimeFromFilename,
} from '../../../shared/localMedia.ts';
import type { LocalFileDraft } from './resourcePickerPolicy.ts';
import { probeLocalFiles } from '../../bridge/apiClient.ts';

export function nativePathOf(file: File): string {
  const host = globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor(file: File): string } };
  const hostPath = host.__DSH_HOST_PATHS__?.pathFor(file);
  if (hostPath) return hostPath;
  const path = (file as File & { path?: string }).path;
  return typeof path === 'string' ? path : '';
}

function baseName(realPath: string): string {
  const trimmed = realPath.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || realPath;
}

export function draftFromRealPath(
  realPath: string,
  extras: { name?: string; mime?: string; size?: number } = {},
): LocalFileDraft | null {
  if (!looksAbsolutePath(realPath)) return null;
  const name = extras.name || baseName(realPath);
  const mime = extras.mime || mimeFromFilename(name) || mimeFromFilename(realPath) || '';
  const materialType = materialTypeFromFilename(name, mime);
  if (!materialType) return null;
  return {
    id: `${realPath}-${extras.size ?? 0}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime,
    size: extras.size ?? 0,
    realPath,
    materialType,
    previewUrl: localFileMediaUrl(realPath),
  };
}

export function draftsFromPickedPaths(paths: string[]): LocalFileDraft[] {
  const drafts: LocalFileDraft[] = [];
  for (const path of paths) {
    const draft = draftFromRealPath(path);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

/** Refresh file metadata at the desktop boundary without changing picker row identity. */
export async function probePickerDrafts(drafts: LocalFileDraft[], shouldReadDuration = false): Promise<LocalFileDraft[]> {
  if (!drafts.length) return [];
  const result = await probeLocalFiles(drafts.map(file => file.realPath), true);
  if (!result.ok || !Array.isArray(result.body.items)) throw new Error('Could not read selected local files');
  const probes = new Map(result.body.items.map(item => [item.path, item]));
  const refreshed = drafts.flatMap(file => {
    const probe = probes.get(file.realPath);
    if (!probe?.exists) return [];
    const mime = probe.mime ?? file.mime;
    const materialType = materialTypeFromFilename(probe.name ?? file.name, mime);
    return materialType ? [{ ...file, mime, materialType, size: probe.size ?? file.size }] : [];
  });
  if (!shouldReadDuration) return refreshed;
  return Promise.all(refreshed.map(async file => ({ ...file, durationSec: await readMediaDuration(file) })));
}

function readMediaDuration(file: LocalFileDraft): Promise<number | null> {
  if (file.materialType !== 'audio' && file.materialType !== 'video') return Promise.resolve(null);
  const media = document.createElement(file.materialType);
  media.preload = 'metadata';
  return new Promise(resolve => {
    const finish = (value: number | null) => {
      clearTimeout(timeout);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 3000);
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => finish(null);
    media.src = localFileMediaUrl(file.realPath);
  });
}

/**
 * Slot-fill sessions only accept the slot's media types; any other draft is
 * intercepted at ingest. An undefined or empty whitelist accepts everything.
 */
export function filterDraftsByTypes(
  drafts: LocalFileDraft[],
  acceptedTypes?: readonly string[],
): LocalFileDraft[] {
  if (!acceptedTypes?.length) return drafts;
  return drafts.filter((draft) => acceptedTypes.includes(draft.materialType));
}
