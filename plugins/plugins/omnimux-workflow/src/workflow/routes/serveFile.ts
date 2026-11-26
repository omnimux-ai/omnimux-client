import type { ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { fileIdentity, SerialFileWork, SharedFileWork, withRegularFile } from '../../projects/asyncFiles.ts';
import { readMediaIntegrity, verifiedMediaBytes } from '../../projects/mediaRevision.ts';
import { sendJson } from '../../http/helpers.ts';
import { detectMimeFromHandle, detectMimeFromHead } from '../../shared/localMedia.ts';
import { parseByteRange } from '../byteRange';
import type { BundleArtifact } from './staticRoutes';

const MIME_BY_EXT: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

/** Response hardening shared by every file response; SVG gets a sandbox CSP. */
function securityHeadersFor(mime: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if ((mime.split(';')[0] ?? '').trim().toLowerCase() === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  }
  return headers;
}

interface FileOptions {
  fallbackMime?: string;
  range?: string;
  signal?: AbortSignal;
  head?: boolean;
  name?: string;
  canonical?: boolean;
  mediaDigest?: string;
  ifNoneMatch?: string;
}

/** Open, sniff and stream the same file descriptor, including for a Range. */
export async function serveFile(res: ServerResponse, file: string, response: FileOptions | string, rangeHeader?: string): Promise<void> {
  const options = typeof response === 'string' ? { fallbackMime: response, range: rangeHeader } : response;
  const { signal, head, name = file } = options;
  await withRegularFile(file, signal, async (handle, stat) => {
    const integrity = options.mediaDigest ? await readMediaIntegrity(file, signal, stat).catch(() => null) : undefined;
    signal?.throwIfAborted();
    if (options.mediaDigest && options.mediaDigest !== integrity?.digest) {
      sendJson(res, 409, { error: 'media-version-mismatch' });
      return;
    }
    const size = Number(stat.size);
    const range = parseByteRange(options.range, size);
    if (range && 'invalid' in range) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Requested Range Not Satisfiable');
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const verified = integrity && !head && size > 0 ? verifiedMediaBytes(handle, integrity, start, end, signal) : undefined;
    const fallbackMime = MIME_BY_EXT[extname(name)] ?? options.fallbackMime;
    const mime = integrity
      ? integrity.sniffedMime ?? detectMimeFromHead(name, undefined, fallbackMime)
      : await detectMimeFromHandle(handle, name, fallbackMime, signal);
    const cacheableImage = (mime.split(';')[0] ?? '').trim().toLowerCase().startsWith('image/');
    const etag = cacheableImage ? `"${integrity ? integrity.digest : fileIdentity(stat)}"` : undefined;
    if (etag && !range && etagMatches(options.ifNoneMatch, etag)) {
      res.writeHead(304, {
        ...securityHeadersFor(mime),
        ETag: etag,
        'Cache-Control': 'no-cache',
      });
      res.end();
      return;
    }
    // Verify the first block before committing HTTP headers. Later changes
    // terminate the transfer without yielding any unverified bytes.
    const first = await verified?.next().catch(() => null);
    signal?.throwIfAborted();
    if (verified && !first?.value) {
      sendJson(res, 409, { error: 'media-version-mismatch' });
      return;
    }
    res.writeHead(range ? 206 : 200, {
      ...securityHeadersFor(mime),
      'Content-Type': mime,
      'Content-Length': range ? range.end - range.start + 1 : size,
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
      'Accept-Ranges': 'bytes',
      ...(etag ? { ETag: etag } : {}),
      'Cache-Control': 'no-cache',
    });
    if (head || size === 0) {
      res.end();
      return;
    }
    async function* fromVerified() {
      yield first!.value!;
      yield* verified!;
    }
    const stream = verified ? Readable.from(fromVerified(), { objectMode: false }) : handle.createReadStream({ start, end });
    await pipeline(stream, res, { signal });
  }, options.canonical);
}

interface IslandBundleOptions {
  signal?: AbortSignal;
  acceptEncoding?: string;
  ifNoneMatch?: string;
}

const ISLAND_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const brotli = promisify(brotliCompress);
const deflateGzip = promisify(gzip);

interface CompressedBundle {
  bodies: Map<string, Buffer>;
  pending: SharedFileWork<Buffer>;
}
const compressedBundles = new WeakMap<BundleArtifact, CompressedBundle>();
// Keep a cold burst of different representations from monopolizing libuv.
const compressionQueue = new SerialFileWork();

/** gzip/br negotiation; brotli wins when both are offered, q=0 refuses. */
function pickBundleEncoding(acceptEncoding: string | undefined): 'br' | 'gzip' | null {
  if (!acceptEncoding) return null;
  const accepted = new Set<string>();
  for (const token of acceptEncoding.split(',')) {
    const [rawName, ...params] = token.trim().split(';');
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    if (q && Number(q.slice(2)) === 0) continue;
    accepted.add(name);
  }
  if (accepted.has('br')) return 'br';
  if (accepted.has('gzip')) return 'gzip';
  return null;
}

/** If-None-Match match against a strong ETag; `*` matches any representation. */
function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const target = etag.replace(/^W\//, '');
  return ifNoneMatch.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '');
    return value === '*' || value === target;
  });
}

async function compressedBody(artifact: BundleArtifact, encoding: 'br' | 'gzip', signal?: AbortSignal) {
  let bundle = compressedBundles.get(artifact);
  if (!bundle) {
    bundle = { bodies: new Map(), pending: new SharedFileWork() };
    compressedBundles.set(artifact, bundle);
  }
  const { bodies, pending } = bundle;
  const cached = bodies.get(encoding);
  if (cached) return cached;
  return pending.run(encoding, signal, async (compressionSignal) => {
    const raw = artifact.bytes;
    const body = await compressionQueue.run(compressionSignal, () => encoding === 'br'
      ? brotli(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : deflateGzip(raw, { level: 6 }));
    compressionSignal.throwIfAborted();
    bodies.set(encoding, body);
    return body;
  });
}

/** Serve bytes captured with the ETag, even if a rebuild replaces the file meanwhile. */
export async function serveIslandBundle(res: ServerResponse, file: string, artifact: BundleArtifact, options: IslandBundleOptions): Promise<void> {
  const { signal } = options;
  signal?.throwIfAborted();
  const etag = `"${artifact.version}"`;
  const mime = detectMimeFromHead(file, artifact.bytes, MIME_BY_EXT[extname(file)]);
  const headers = {
    ...securityHeadersFor(mime),
    'Cache-Control': ISLAND_CACHE_CONTROL,
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if (etagMatches(options.ifNoneMatch, etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const encoding = pickBundleEncoding(options.acceptEncoding);
  const body = encoding ? await compressedBody(artifact, encoding, signal) : artifact.bytes;
  signal?.throwIfAborted();
  res.writeHead(200, {
    ...headers,
    'Content-Type': mime,
    'Content-Length': body.length,
    ...(encoding ? { 'Content-Encoding': encoding } : { 'Accept-Ranges': 'bytes' }),
  });
  res.end(body);
}
