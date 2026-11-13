/**
 * Loopback HTTP to omnimux-assets. No package import.
 */
import type { FetchLibraryDetail, LibraryAssetDetail, PromoteToLibrary } from '../workspace/ProjectAssetsStore.ts';

export function assetsOrigin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DSH_HTTP_ORIGIN) return env.DSH_HTTP_ORIGIN.replace(/\/+$/, '');
  const port = env.PORT || env.DSH_PORT || '3210';
  return `http://127.0.0.1:${port}`;
}

export function createLibraryHttpClient(opts: {
  origin?: string;
  fetchImpl?: typeof fetch;
} = {}): { fetchLibraryDetail: FetchLibraryDetail; promoteToLibrary: PromoteToLibrary } {
  const origin = (opts.origin || assetsOrigin()).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function fetchLibraryDetail(id: string): Promise<LibraryAssetDetail | null> {
    const url = `${origin}/omnimux/assets/library/detail?id=${encodeURIComponent(id)}`;
    const response = await fetchImpl(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`library detail HTTP ${String(response.status)}`);
    }
    const body = (await response.json()) as { asset?: LibraryAssetDetail };
    return body.asset ?? null;
  }

  async function promoteToLibrary(payload: {
    name: string;
    type?: string;
    files: Array<{ real_path: string }>;
  }): Promise<unknown> {
    const response = await fetchImpl(`${origin}/omnimux/assets/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      const err = body && typeof body === 'object' ? (body as { error?: string; message?: string }) : {};
      throw new Error(err.message || err.error || `library promote HTTP ${String(response.status)}`);
    }
    return (body as { asset?: unknown }).asset;
  }

  return { fetchLibraryDetail, promoteToLibrary };
}
