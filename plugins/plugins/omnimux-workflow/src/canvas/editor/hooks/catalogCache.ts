/**
 * Catalog cache adopt policy — pure functions, no React / localStorage.
 * Boot uses this to decide whether a freshly fetched catalog replaces cache.
 */

export interface ShouldReplaceCatalogCacheInput {
  cachedFingerprint?: string | null;
  nextFingerprint?: string | null;
  force?: boolean;
}

/**
 * Decide whether a freshly fetched catalog should replace the local cache.
 * force / missing next fingerprint / empty cache → replace; same fingerprint → keep.
 */
export function shouldReplaceCatalogCache({
  cachedFingerprint = '',
  nextFingerprint = '',
  force = false,
}: ShouldReplaceCatalogCacheInput = {}): boolean {
  if (force) return true;
  if (!nextFingerprint) return true;
  if (!cachedFingerprint) return true;
  return cachedFingerprint !== nextFingerprint;
}
