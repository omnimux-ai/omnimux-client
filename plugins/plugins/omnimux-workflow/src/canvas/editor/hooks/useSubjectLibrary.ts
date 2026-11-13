/**
 * Global subject library hydrate via ACL (GET /omnimux/assets/library).
 * 404 / network → empty list, never throw.
 */
import { useCallback, useEffect, useState } from 'react';
import { createAssetsLibraryClient } from '../../bridge/assetsLibraryClient.ts';
import type { SubjectPack } from '../components/assets/types.ts';

const client = createAssetsLibraryClient();

export interface UseSubjectLibraryResult {
  subjects: SubjectPack[];
  loading: boolean;
  error: string | null;
  refresh: (filter?: { type?: string; q?: string }) => Promise<void>;
  createSubject: (
    name: string,
    files?: Array<{ real_path: string; original_name?: string }>,
  ) => Promise<SubjectPack | null>;
}

export function useSubjectLibrary(enabled: boolean): UseSubjectLibraryResult {
  const [subjects, setSubjects] = useState<SubjectPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (filter: { type?: string; q?: string } = {}, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await client.listLibrary(filter, signal);
      if (signal?.aborted || result.error === 'aborted') return;
      if (!result.ok) {
        setError(result.error || 'library-unavailable');
        setSubjects([]);
        return;
      }
      setError(null);
      setSubjects(result.subjects);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void refresh({}, controller.signal);
    return () => controller.abort();
  }, [enabled, refresh]);

  const createSubject = useCallback(async (
    name: string,
    files?: Array<{ real_path: string; original_name?: string }>,
  ) => {
    const result = await client.createLibraryAsset(name, 'custom', files);
    if (!result.ok || !result.subject) {
      setError(result.error || 'create-failed');
      return null;
    }
    setSubjects((prev) => [result.subject as SubjectPack, ...prev]);
    setError(null);
    return result.subject;
  }, []);

  return { subjects, loading, error, refresh, createSubject };
}
