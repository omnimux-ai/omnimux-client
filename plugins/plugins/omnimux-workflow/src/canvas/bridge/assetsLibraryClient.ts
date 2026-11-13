/**
 * ACL over Host /omnimux/assets/* — string paths only, no package import.
 * 404 / network failures return ok:false + empty lists; they never throw.
 */
import {
  interpretPickResponse,
  mapLibraryAssetToSubject,
  type LibraryAssetView,
  type PickInterpretation,
  type PickKind,
} from './assetsLibraryMapper.ts';
import type { SubjectPack } from '../editor/components/assets/types.ts';

export type AssetsFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface AssetsLibraryListResult {
  ok: boolean;
  status: number;
  subjects: SubjectPack[];
  error?: string;
}

export interface AssetsLibraryCreateResult {
  ok: boolean;
  status: number;
  subject: SubjectPack | null;
  error?: string;
}

export interface AssetsPickResult {
  ok: boolean;
  status: number;
  interpretation: PickInterpretation;
}

function defaultFetch(): AssetsFetch {
  return globalThis.fetch.bind(globalThis) as unknown as AssetsFetch;
}

async function readJson(response: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // network / non-JSON
  }
  return {};
}

export function createAssetsLibraryClient(opts: { fetch?: AssetsFetch } = {}) {
  const fetchImpl = opts.fetch ?? defaultFetch();

  async function listLibrary(
    filter: { type?: string; q?: string } = {},
    signal?: AbortSignal,
  ): Promise<AssetsLibraryListResult> {
    try {
      const params = new URLSearchParams();
      if (filter.type && filter.type !== 'all') params.set('type', filter.type);
      if (filter.q) params.set('q', filter.q);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await fetchImpl(`/omnimux/assets/library${suffix}`, { method: 'GET', signal });
      const body = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          subjects: [],
          error: typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`,
        };
      }
      const rows = Array.isArray(body.assets) ? body.assets : [];
      const subjects = rows
        .filter((row): row is LibraryAssetView => Boolean(row) && typeof row === 'object')
        .map((row) => mapLibraryAssetToSubject(row))
        .filter((row) => row.id !== '');
      return { ok: true, status: response.status, subjects };
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return { ok: false, status: 0, subjects: [], error: 'aborted' };
      }
      return { ok: false, status: 0, subjects: [], error: 'network' };
    }
  }

  async function createLibraryAsset(
    name: string,
    type = 'custom',
    files?: Array<{ real_path: string; original_name?: string }>,
  ): Promise<AssetsLibraryCreateResult> {
    try {
      const payload: Record<string, unknown> = { name, type };
      if (Array.isArray(files) && files.length > 0) payload.files = files;
      const response = await fetchImpl('/omnimux/assets/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          subject: null,
          error: typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`,
        };
      }
      const asset = body.asset && typeof body.asset === 'object' ? (body.asset as LibraryAssetView) : { name, type };
      return { ok: true, status: response.status, subject: mapLibraryAssetToSubject(asset) };
    } catch {
      return { ok: false, status: 0, subject: null, error: 'network' };
    }
  }

  async function pickAssets(kind: PickKind): Promise<AssetsPickResult> {
    try {
      const response = await fetchImpl('/omnimux/assets/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = await readJson(response);
      const interpretation = interpretPickResponse({
        ok: response.ok,
        status: response.status,
        body: {
          error: typeof body.error === 'string' ? body.error : undefined,
          message: typeof body.message === 'string' ? body.message : undefined,
          path: typeof body.path === 'string' || body.path === null ? (body.path as string | null) : null,
          paths: Array.isArray(body.paths) ? (body.paths as string[]) : [],
        },
      });
      return { ok: response.ok, status: response.status, interpretation };
    } catch {
      return {
        ok: false,
        status: 0,
        interpretation: { kind: 'error', message: 'network' },
      };
    }
  }

  return { listLibrary, createLibraryAsset, pickAssets };
}

export const assetsLibraryClient = createAssetsLibraryClient();
