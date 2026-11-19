import { localFileMediaUrl, materialTypeFromFilename } from '../../../shared/localMedia.ts';
import { probeLocalFiles } from '../../bridge/apiClient.ts';
import type { LocalFileDraft } from './resourcePickerPolicy.ts';

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
