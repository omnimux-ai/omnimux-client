import { useEffect } from 'react';

type DocumentHydrationPatch = {
  documentText?: string;
  documentError?: string;
};

export function useDocumentHydration(
  sourceUrl: string | undefined,
  loaded: boolean,
  update: (patch: DocumentHydrationPatch) => void,
): void {
  useEffect(() => {
    if (!sourceUrl || loaded) return;
    const controller = new AbortController();
    void fetch(sourceUrl, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(text => {
        if (!controller.signal.aborted) update({ documentText: text, documentError: undefined });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const detail = error instanceof Error && error.message ? error.message : '读取失败';
        update({ documentError: `JSON 文件读取失败：${detail}` });
      });
    return () => controller.abort();
  }, [sourceUrl, loaded, update]);
}
