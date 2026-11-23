import { LOCAL_FILE_PROBE_LIMIT, localFileMediaUrl, materialTypeFromFilename } from '../../../shared/localMedia.ts';
import { parseJsonDocumentText } from '../../../shared/jsonDocument.ts';
import { probeLocalFiles } from '../../bridge/apiClient.ts';
import type { LocalFileDraft } from './resourcePickerPolicy.ts';

/** Refresh metadata from the selected file while retaining the picker's row identity. */
export async function probePickerDrafts(drafts: LocalFileDraft[], shouldReadDuration = false, signal?: AbortSignal): Promise<LocalFileDraft[]> {
  if (!drafts.length) return [];
  const paths = [...new Set(drafts.map(file => file.realPath))];
  const batches = Array.from({ length: Math.ceil(paths.length / LOCAL_FILE_PROBE_LIMIT) }, (_, index) =>
    paths.slice(index * LOCAL_FILE_PROBE_LIMIT, (index + 1) * LOCAL_FILE_PROBE_LIMIT));
  const results = await Promise.all(batches.map(batch => probeLocalFiles(batch, true, signal)));
  if (results.some(result => !result.ok || !Array.isArray(result.body.items))) throw new Error('Could not read selected local files');
  const probes = new Map(results.flatMap(result => result.body.items.map(item => [item.path, item] as const)));
  const refreshed = await Promise.all(drafts.map(async file => {
    const probe = probes.get(file.realPath);
    if (!probe?.exists || !probe.size || file.fileRevision && probe.revision !== file.fileRevision) return;
    const mime = probe.mime ?? '';
    const materialType = materialTypeFromFilename(probe.name ?? file.name, mime);
    if (!materialType) return;
    const next = { ...file, mime, materialType, size: probe.size, fileRevision: probe.revision };
    const unchanged = file.fileRevision !== undefined && file.fileRevision === probe.revision;
    if (materialType === 'document' && !unchanged) {
      const response = await fetch(localFileMediaUrl(next.realPath), { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) return;
      const text = await response.text();
      if (!parseJsonDocumentText(text).ok) return;
      next.documentText = text;
    }
    if (shouldReadDuration && (!unchanged || next.durationSec == null)) next.durationSec = await readMediaDuration(next, signal);
    return next;
  }));
  return refreshed.filter((file): file is NonNullable<typeof file> => file !== undefined);
}

function readMediaDuration(file: LocalFileDraft, signal?: AbortSignal): Promise<number | null> {
  if (file.materialType !== 'audio' && file.materialType !== 'video') return Promise.resolve(null);
  if (signal?.aborted) return Promise.resolve(null);
  const media = document.createElement(file.materialType);
  media.preload = 'metadata';
  return new Promise(resolve => {
    const abort = () => finish(null);
    const finish = (value: number | null) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 3000);
    signal?.addEventListener('abort', abort, { once: true });
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => finish(null);
    const url = localFileMediaUrl(file.realPath);
    media.src = file.fileRevision ? `${url}&probe=${encodeURIComponent(file.fileRevision)}` : url;
  });
}
