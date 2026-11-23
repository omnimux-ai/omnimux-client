/**
 * Local imported media helpers: preview URL builders + type probes.
 * Project ingest copies into `<ProjectRoot>/assets/imported/`; `local-file`
 * remains a probe/source stream. blob: URLs must not persist.
 */
import { WORKFLOW_ROUTE_PREFIX } from './api.ts';
import type { MaterialType } from './canvasTypes.ts';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
const TEXT_EXT = new Set(['txt', 'md']);
const DOCUMENT_EXT = new Set(['json']);
const IMPORT_EXTENSIONS: Record<MaterialType, ReadonlySet<string>> = {
  image: IMAGE_EXT,
  video: VIDEO_EXT,
  audio: AUDIO_EXT,
  text: TEXT_EXT,
  document: DOCUMENT_EXT,
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  json: 'application/json',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const SNIFF_HEAD_BYTES = 512;
export const LOCAL_FILE_PROBE_LIMIT = 64;

interface NodeFsSync {
  openSync(path: string, flags: string): number;
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number;
  closeSync(fd: number): void;
}

function bytesEq(buf: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (buf.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buf[offset + i] !== signature[i]) return false;
  }
  return true;
}

function asciiEq(buf: Uint8Array, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function latin1Head(buf: Uint8Array, maxBytes = SNIFF_HEAD_BYTES): string {
  const n = Math.min(buf.length, maxBytes);
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('latin1').decode(buf.subarray(0, n));
  }
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += String.fromCharCode(buf[i] ?? 0);
  }
  return out;
}

/**
 * Magic-byte MIME probe. Node `Buffer` is a `Uint8Array` subclass, so either
 * is accepted. Returns undefined when the buffer is empty or unknown.
 */
export function sniffMimeType(buf: Uint8Array): string | undefined {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length === 0) return undefined;

  // PNG: 89 50 4E 47
  if (bytesEq(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  // JPEG: FF D8 FF
  if (bytesEq(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // GIF: 47 49 46 38 ("GIF8")
  if (asciiEq(bytes, 0, 'GIF8')) return 'image/gif';
  // WebP: RIFF....WEBP
  if (asciiEq(bytes, 0, 'RIFF') && asciiEq(bytes, 8, 'WEBP')) return 'image/webp';
  // WAV: RIFF....WAVE
  if (asciiEq(bytes, 0, 'RIFF') && asciiEq(bytes, 8, 'WAVE')) return 'audio/wav';
  if (asciiEq(bytes, 0, 'fLaC')) return 'audio/flac';
  if (bytesEq(bytes, 0, [0x49, 0x49, 0x2a, 0]) || bytesEq(bytes, 0, [0x4d, 0x4d, 0, 0x2a])) return 'image/tiff';
  if (asciiEq(bytes, 0, 'BM')) return 'image/bmp';
  if (asciiEq(bytes, 0, 'RIFF') && asciiEq(bytes, 8, 'AVI ')) return 'video/x-msvideo';
  // The ftyp brand distinguishes containers that share the same file header.
  if (asciiEq(bytes, 4, 'ftyp')) {
    if (asciiEq(bytes, 8, 'qt  ')) return 'video/quicktime';
    if (asciiEq(bytes, 8, 'M4A ') || asciiEq(bytes, 8, 'M4B ')) return 'audio/mp4';
    if (asciiEq(bytes, 8, 'avif') || asciiEq(bytes, 8, 'avis')) return 'image/avif';
    if (asciiEq(bytes, 8, 'heic') || asciiEq(bytes, 8, 'heix')) return 'image/heic';
    if (asciiEq(bytes, 8, 'mif1') || asciiEq(bytes, 8, 'msf1')) {
      const boxLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
      for (let offset = 16; offset + 4 <= Math.min(boxLength, bytes.length); offset += 4) {
        if (asciiEq(bytes, offset, 'avif') || asciiEq(bytes, offset, 'avis')) return 'image/avif';
        if (asciiEq(bytes, offset, 'heic') || asciiEq(bytes, offset, 'heix')) return 'image/heic';
      }
      return 'image/heif';
    }
    return 'video/mp4';
  }
  if (bytesEq(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML DocType appears in the header before the media data.
    return latin1Head(bytes).includes('matroska') ? 'video/x-matroska' : 'video/webm';
  }
  if (asciiEq(bytes, 0, 'OggS')) return latin1Head(bytes).includes('OpusHead') ? 'audio/opus' : 'audio/ogg';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0) return 'audio/aac';
  if (asciiEq(bytes, 0, 'ID3') || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  const markup = latin1Head(bytes).replace(/^\u00ef\u00bb\u00bf/, '');
  if (/^\s*(?:(?:<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE svg[^>]*>)\s*)*<svg(?:\s|\/?>)/i.test(markup)) return 'image/svg+xml';

  return undefined;
}

/** Map a sniffed buffer onto a file extension (`png`, `jpg`, `svg`, …). */
export function sniffMediaExtension(buf: Uint8Array): string | undefined {
  const mime = sniffMimeType(buf);
  if (!mime) return undefined;
  return EXT_BY_MIME[mime];
}

function nodeFsSync(): NodeFsSync | undefined {
  try {
    const proc = (globalThis as {
      process?: { getBuiltinModule?: (name: string) => unknown };
    }).process;
    const fs = proc?.getBuiltinModule?.('node:fs') as NodeFsSync | undefined;
    if (!fs?.openSync || !fs.readSync || !fs.closeSync) return undefined;
    return fs;
  } catch {
    return undefined;
  }
}

function readFileHead(filePath: string, maxBytes = SNIFF_HEAD_BYTES): Uint8Array | undefined {
  const fs = nodeFsSync();
  if (!fs) return undefined;
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = new Uint8Array(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    if (n <= 0) return new Uint8Array();
    return n === maxBytes ? buf : buf.subarray(0, n);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close races
      }
    }
  }
}

/** Read a local text file on Node/Electron hosts; undefined in browser-only contexts. */
export function readLocalTextFile(filePath: string): string | undefined {
  try {
    const proc = (globalThis as {
      process?: { getBuiltinModule?: (name: string) => unknown };
    }).process;
    const fs = proc?.getBuiltinModule?.('node:fs') as { readFileSync?: (path: string, encoding: string) => string } | undefined;
    return fs?.readFileSync?.(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Prefer magic-byte MIME over the filename extension so a historical
 * `artifacts/*.svg` that is actually PNG still serves as `image/png`.
 */
export function detectMimeFromFile(
  filePath: string,
  fallbackMime = 'application/octet-stream',
): string {
  return detectMimeFromHead(filePath, readFileHead(filePath), fallbackMime);
}

export function detectMimeFromHead(filePath: string, head?: Uint8Array, fallbackMime = 'application/octet-stream'): string {
  return (head ? sniffMimeType(head.subarray(0, SNIFF_HEAD_BYTES)) : undefined) ?? mimeFromFilename(filePath) ?? fallbackMime;
}

/** The positioned probe leaves the stream offset on this handle unchanged. */
export async function detectMimeFromHandle(handle: {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}, filePath: string,
  fallbackMime?: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const buffer = new Uint8Array(SNIFF_HEAD_BYTES);
  const read = await handle.read(buffer, 0, buffer.length, 0).catch(() => null);
  signal?.throwIfAborted();
  return detectMimeFromHead(filePath, read ? buffer.subarray(0, read.bytesRead) : undefined, fallbackMime);
}

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function mimeFromFilename(filename: string): string | undefined {
  return MIME_BY_EXT[extensionOf(filename)];
}

export function extensionsForMimes(mimes: readonly string[]): string[] {
  const allowed = new Set(mimes.map(mime => mime.trim().toLowerCase()));
  return Object.entries(MIME_BY_EXT).filter(([, mime]) => allowed.has(mime)).map(([extension]) => extension);
}

export function extensionsForMaterialType(type: MaterialType): string[] {
  return [...IMPORT_EXTENSIONS[type]];
}

/** Workflow's file chooser maps a named slot's MIME allowlist onto native extensions. */
export interface SlotFileFilter {
  slot: string;
  materialType: MaterialType;
  allowedMimes?: readonly string[];
}

export function extensionsForSlotFiles({ materialType, allowedMimes }: SlotFileFilter, requested?: readonly string[]): string[] {
  const allowed = allowedMimes?.length ? extensionsForMimes(allowedMimes) : undefined;
  return extensionsForMaterialType(materialType).filter(extension =>
    (!allowed || allowed.includes(extension)) && (!requested || requested.includes(extension)));
}

export function materialTypeFromFilename(filename: string, mime = ''): MaterialType | null {
  const normalized = (mime || '').toLowerCase().trim();
  if (normalized.split(';')[0]?.trim() === 'application/json') return 'document';
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  const ext = extensionOf(filename);
  if (DOCUMENT_EXT.has(ext)) return 'document';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (TEXT_EXT.has(ext)) return 'text';
  return null;
}

export function isAllowedImportedMedia(filename: string, mime = ''): boolean {
  return materialTypeFromFilename(filename, mime) !== null;
}

export function isBlobUrl(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith('blob:');
}

export function isLocalFileUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  return url.includes('/api/local-file');
}

export function localFileMediaUrl(realPath: string): string {
  return `${WORKFLOW_ROUTE_PREFIX}/api/local-file?path=${encodeURIComponent(realPath)}`;
}

const SHA256_REVISION_PREFIX = 'sha256:';
const isSha256 = (value: string) => /^[a-f0-9]{64}$/u.test(value);

export function projectFileRevisionDigest(revision: string | null): string | undefined {
  if (!revision?.startsWith(SHA256_REVISION_PREFIX)) return undefined;
  const digest = revision.slice(SHA256_REVISION_PREFIX.length);
  return isSha256(digest) ? digest : undefined;
}

export function projectFileMediaUrl(workspaceId: string, relativePath: string, digest?: string): string {
  const url = `${WORKFLOW_ROUTE_PREFIX}/api/workspaces/${encodeURIComponent(workspaceId)}/file?rel=${encodeURIComponent(relativePath)}`;
  return digest && isSha256(digest) ? `${url}&rev=${encodeURIComponent(SHA256_REVISION_PREFIX + digest)}` : url;
}

export function preserveProjectFileMediaRevision(workspaceId: string, relativePath: string, previous: unknown): string {
  const url = projectFileMediaUrl(workspaceId, relativePath);
  if (typeof previous !== 'string' || !previous.startsWith(`${url.split('?')[0]}?`)) return url;
  const { hash, searchParams } = new URL(previous, 'https://workflow.invalid');
  if (hash || searchParams.size !== 2 || searchParams.get('rel') !== relativePath) return url;
  return projectFileMediaUrl(workspaceId, relativePath, projectFileRevisionDigest(searchParams.get('rev')));
}

export function localFilePathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    const parsed = new URL(url, 'http://127.0.0.1');
    if (!parsed.pathname.endsWith('/api/local-file')) return null;
    const path = parsed.searchParams.get('path');
    return path && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

export function looksAbsolutePath(path: string): boolean {
  if (!path || path.includes('\0')) return false;
  // A Windows UNC root must name both a server and a share. Three or more
  // forward slashes still denote a POSIX path, like a single forward slash.
  if (/^[\\/]{2}/.test(path) && !path.startsWith('///')) {
    const [server, share] = path.slice(2).split(/[\\/]/, 2);
    return [server, share].every(part =>
      typeof part === 'string' && part.trim() !== '' && part !== '.' && part !== '..'
      && !/[<>:"|?*\u0000-\u001f]/.test(part));
  }
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path);
}

export function displayNameOf(realPath: string, originalName?: string): string {
  const named = typeof originalName === 'string' ? originalName.trim() : '';
  if (named) return named;
  const trimmed = realPath.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || realPath;
}

export interface ImportedMediaFields {
  [key: string]: unknown;
  mediaUrl: string;
  status: 'ready';
  content: string;
  originalName: string;
  realPath: string;
  /** Canonical MIME; null when unknown (never invent octet-stream). */
  mimeType: string | null;
  /** Canonical byte size; null when unknown (never invent 0). */
  sizeBytes: number | null;
  /** Canonical duration seconds; null when unknown / non-AV. */
  durationSec: number | null;
  /** Legacy alias of sizeBytes (same null semantics). */
  fileSize: number | null;
  /** Legacy alias of durationSec (same null semantics). */
  duration: number | null;
  isMissing: false;
  mediaAssets: Array<{ type: MaterialType; url: string; path: string }>;
}

export function buildImportedMediaData(input: {
  realPath: string;
  name: string;
  materialType: MaterialType;
  mime?: string | null;
  size?: number | null;
  durationSec?: number | null;
  duration?: number | null;
}): ImportedMediaFields {
  const url = localFileMediaUrl(input.realPath);
  // Lazy import avoided — keep localMedia free of circular deps by inlining
  // the null-safe normalize rules (mirrors shared/mediaMetadata.ts).
  const rawMime =
    (typeof input.mime === 'string' && input.mime.trim() ? input.mime.trim() : '')
    || mimeFromFilename(input.name)
    || mimeFromFilename(input.realPath)
    || '';
  const mimeLower = rawMime.toLowerCase();
  const mimeType =
    rawMime
    && mimeLower !== 'unknown'
    && mimeLower !== 'application/octet-stream'
      ? rawMime
      : null;
  const sizeBytes =
    typeof input.size === 'number' && Number.isFinite(input.size) && input.size >= 0
      ? input.size
      : null;
  const durationSec =
    (typeof input.durationSec === 'number' && Number.isFinite(input.durationSec) && input.durationSec >= 0
      ? input.durationSec
      : null)
    ?? (typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration >= 0
      ? input.duration
      : null);
  return {
    mediaUrl: url,
    status: 'ready',
    content: input.name,
    originalName: input.name,
    realPath: input.realPath,
    mimeType,
    sizeBytes,
    durationSec,
    fileSize: sizeBytes,
    duration: durationSec,
    isMissing: false,
    mediaAssets: [{ type: input.materialType, url, path: input.realPath }],
  };
}

export interface LocalMediaProbeItem {
  path: string;
  exists: boolean;
  size?: number;
  mime?: string;
  name?: string;
  /** A transient version of the file that supplied the content metadata. */
  revision?: string;
}

export function applyLocalMediaProbe<T extends { data?: Record<string, unknown> }>(
  nodes: T[],
  items: LocalMediaProbeItem[],
): T[] {
  const byPath = new Map(items.map((item) => [item.path, item]));
  return nodes.map((node) => {
    const data = node.data && typeof node.data === 'object' ? { ...node.data } : {};
    const realPath = typeof data.realPath === 'string' ? data.realPath : '';
    if (!realPath) return node;
    const hit = byPath.get(realPath);
    if (!hit) return node;
    if (hit.exists) {
      if (data.status === 'offline' || data.isMissing === true) {
        data.status = 'ready';
        data.isMissing = false;
        data.mediaUrl = localFileMediaUrl(realPath);
        return { ...node, data };
      }
      return node;
    }
    data.status = 'offline';
    data.isMissing = true;
    return { ...node, data };
  });
}

export function collectRealPaths(nodes: Array<{ data?: Record<string, unknown> }>): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const realPath = typeof node.data?.realPath === 'string' ? node.data.realPath : '';
    if (!realPath || seen.has(realPath)) continue;
    seen.add(realPath);
    paths.push(realPath);
  }
  return paths;
}
