import type { MediaBridgeItem } from "../../../../live/bridged-media";

const LIBRARY_ROUTE = "/omnimux/assets/library";
const LOCAL_MEDIA_ROUTE = "/omnimux-workflow/api/local-file";
const REFERENCE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const READABLE_AUDIO = /\.(?:mp3|wav|m4a|aac|flac|ogg|opus)$/i;

export interface LibraryMedia extends MediaBridgeItem {
  assetName: string;
  coverUrl?: string;
}

export type LibraryMediaFilter = "all" | LibraryMedia["type"];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function referenceId(value: unknown): string | undefined {
  return typeof value === "string" && REFERENCE_ID.test(value) ? value : undefined;
}

function previewUrl(assetId: string, fileId: string) {
  return `${LIBRARY_ROUTE}/preview?${new URLSearchParams({ id: assetId, file: fileId })}`;
}

// The library preview serves images and videos. Audio uses the existing
// same-origin file handler, which validates the source and media type again.
function audioReadUrl(path: unknown): string | undefined {
  if (typeof path !== "string" || !/^(?:\/[^/]|[a-z]:[\\/]|\\\\[^\\])/i.test(path) || !READABLE_AUDIO.test(path)) return;
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159) || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) return;
  }
  const url = `${LOCAL_MEDIA_ROUTE}?path=${encodeURIComponent(path)}`;
  return url.length <= 8192 ? url : undefined;
}

/** Project only file identities, names, and supported media kinds from the library view. */
export function readLibraryMedia(payload: unknown): LibraryMedia[] {
  const result = record(payload);
  if (!Array.isArray(result?.assets) || result.error || result.ok === false) {
    throw new Error("Invalid asset library response");
  }
  const media = new Map<string, LibraryMedia>();
  for (const row of result.assets) {
    const asset = record(row);
    const assetId = referenceId(asset?.id);
    if (!assetId || !Array.isArray(asset?.files)) continue;
    const assetName = typeof asset.name === "string" ? asset.name.trim() : "";
    const coverId = referenceId(asset.cover_file_id);
    const files: LibraryMedia[] = [];
    for (const entry of asset.files) {
      const file = record(entry);
      const fileId = referenceId(file?.id);
      const type = file?.kind;
      const name = typeof file?.original_name === "string"
        ? file.original_name.split(/[\\/]/).at(-1)?.trim()
        : undefined;
      if (!fileId || !name || file?.visible === false || (type !== "video" && type !== "image" && type !== "audio")) continue;
      if (type === "image" && /\.svgz?$/i.test(name)) continue;
      const url = type === "audio" ? audioReadUrl(file?.real_path) : previewUrl(assetId, fileId);
      if (!url) continue;
      files.push({ id: `library:${assetId}:${fileId}`, url, name, type, assetName });
    }
    const cover = coverId && files.find(file => file.type === "image" && file.id === `library:${assetId}:${coverId}`);
    for (const file of files) {
      if (!media.has(file.id)) {
        media.set(file.id, cover && file.type === "video" ? { ...file, coverUrl: cover.url } : file);
      }
    }
  }
  return [...media.values()];
}

export async function fetchLibraryMedia(signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(LIBRARY_ROUTE, {
    method: "GET",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Asset library request failed (${response.status})`);
  return readLibraryMedia(await response.json());
}

export function filterLibraryMedia(items: readonly LibraryMedia[], filter: LibraryMediaFilter, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(item => (filter === "all" || item.type === filter) && (
    !needle || item.name.toLocaleLowerCase().includes(needle) || item.assetName.toLocaleLowerCase().includes(needle)
  ));
}
