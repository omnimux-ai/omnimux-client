import { createHash } from 'node:crypto';
import { realpathSync, statSync, type BigIntStats } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { isAllowedImportedMedia } from '../shared/localMedia.ts';
/** Stats only existing workflow media routes; never fetches arbitrary remote URLs. */
export function createMediaRevision(mediaDir: string, resolveProjectFile: (workspaceId: string, relativePath: string) => string) {
  return (source: string): string => {
    if (!source.startsWith('/omnimux-workflow/')) return '';
    const url = new URL(source, 'http://localhost');
    let file: string | undefined;
    const match = /^\/omnimux-workflow\/api\/workspaces\/([^/]+)\/file$/.exec(url.pathname);
    if (match) file = resolveProjectFile(decodeURIComponent(match[1]!), url.searchParams.get('rel') || '');
    else if (url.pathname === '/omnimux-workflow/api/project-file') file = resolveProjectFile(url.searchParams.get('workspace') || '', url.searchParams.get('rel') || '');
    else if (url.pathname === '/omnimux-workflow/api/local-file') {
      const candidate = url.searchParams.get('path') || '';
      if (isAbsolute(candidate) && isAllowedImportedMedia(candidate)) file = candidate;
    } else if (url.pathname.startsWith('/omnimux-workflow/media/')) {
      const root = resolve(mediaDir);
      const candidate = resolve(root, decodeURIComponent(url.pathname.slice('/omnimux-workflow/media/'.length)));
      if (candidate.startsWith(root + sep) && realpathSync(candidate).startsWith(realpathSync(root) + sep)) file = candidate;
      else throw new Error('media-path-outside-root');
    }
    if (!file) return '';
    const stat = statSync(realpathSync(file));
    if (!stat.isFile()) throw new Error('media-not-file');
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  };
}

const fileDigests = new Map<string, string>();
const DIGEST_CACHE_CAPACITY = 128;

function fileIdentity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

/** Read SHA-256 from the file, sharing it across Range requests only while the physical file is unchanged. */
export async function readMediaContentDigest(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error('media-not-file');
    const identity = fileIdentity(before);
    const cached = before.ino ? fileDigests.get(identity) : undefined;
    const readDigest = async () => {
      const hash = createHash('sha256');
      for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
      return hash.digest('hex');
    };
    const digest = cached ?? await readDigest();
    if (fileIdentity(await stat(path, { bigint: true })) !== identity) throw new Error('media-changed');
    if (!cached && before.ino) {
      if (fileDigests.size >= DIGEST_CACHE_CAPACITY) {
        const oldest = fileDigests.keys().next().value;
        if (oldest) fileDigests.delete(oldest);
      }
      fileDigests.set(identity, digest);
    }
    return digest;
  } finally {
    await handle.close();
  }
}
