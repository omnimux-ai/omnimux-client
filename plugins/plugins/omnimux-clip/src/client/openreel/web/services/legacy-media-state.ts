import type { MediaItem } from "@openreel/core";

/** Retired browser jobs retain the asset ID and can be relinked like any missing media. */
export function restoreLegacyMediaState(item: MediaItem): MediaItem {
  const { isPending, kieaiError, kieaiTaskId, ...media } = item;
  if (!isPending && !kieaiError && !kieaiTaskId) return item;
  return { ...media, isPlaceholder: !media.blob };
}
