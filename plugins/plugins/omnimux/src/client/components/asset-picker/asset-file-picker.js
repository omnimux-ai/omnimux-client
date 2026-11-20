import { requestFilePicker } from 'dsh-ui-kit/native-file-picker';

/**
 * Start a pick in the current user gesture and settle it for the add form.
 * @param {'file' | 'directory'} kind
 * @param {((kind: 'file' | 'directory') => Promise<string[]>) | undefined} onPick
 * @returns {Promise<{ paths: string[] } | { error: string }>}
 */
export async function pickAssetPaths(kind, onPick) {
  try {
    if (typeof onPick === 'function') {
      const paths = await onPick(kind);
      return { paths: Array.isArray(paths) ? paths : [] };
    }
    const prompt = kind === 'directory' ? '选择要添加的文件夹' : '选择要添加的文件';
    const result = await requestFilePicker({ kind, multiple: true, prompt }, async () => {
      const response = await fetch('/omnimux/assets/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = await response.json().catch(() => null);
      return { ok: response.ok && body !== null, status: response.status, body };
    });
    const body = result.body;
    if (!result.ok) return { error: String(body?.message || body?.error || ('HTTP ' + result.status)) };
    if (Array.isArray(body?.paths) && body.paths.length) return { paths: body.paths };
    return { paths: typeof body?.path === 'string' && body.path ? [body.path] : [] };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : String(caught) };
  }
}
