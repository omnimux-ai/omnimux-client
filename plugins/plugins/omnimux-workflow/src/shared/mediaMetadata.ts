/**
 * Media metadata normalization (Issue 467 / W2).
 *
 * Import assets, project assets and generation artifacts must carry
 * MIME / sizeBytes / durationSec end-to-end. Unknown values stay
 * explicitly unknown (`undefined` / `null`) — NEVER invent 0 or a
 * catch-all MIME (`application/octet-stream`).
 */

import { mimeFromFilename } from './localMedia.ts';

export type MediaMime = string | null | undefined;
export type MediaSizeBytes = number | null | undefined;
export type MediaDurationSec = number | null | undefined;

export interface MediaMetadataFields {
  /** Canonical MIME; null when unknown. */
  mimeType: string | null;
  /** Byte size; null when unknown. Never 0-for-unknown. */
  sizeBytes: number | null;
  /** Duration in seconds; null when unknown / non-AV. */
  durationSec: number | null;
  /**
   * Legacy aliases kept for node data / ledger readers that still look at
   * `fileSize` / `duration`. Same null semantics as the canonical fields.
   */
  fileSize: number | null;
  duration: number | null;
}

export interface MediaMetadataInput {
  mimeType?: unknown;
  mime?: unknown;
  sizeBytes?: unknown;
  fileSize?: unknown;
  size?: unknown;
  durationSec?: unknown;
  duration?: unknown;
  /** Optional filename / path used only when MIME is missing. */
  filename?: unknown;
  path?: unknown;
  name?: unknown;
}

/**
 * Normalize a MIME candidate. Empty / "unknown" / octet-stream → null.
 * Never invents a catch-all type.
 */
export function normalizeMimeType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'unknown' || lower === 'application/octet-stream' || lower === 'binary/octet-stream') {
    return null;
  }
  return trimmed;
}

/**
 * Normalize a finite non-negative number. null/undefined/NaN/negative → null.
 * Zero is only accepted when the caller truly measured 0 (empty file / 0s clip);
 * unknown must be passed as null/undefined, not coerced.
 */
export function normalizeMediaNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') {
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return parsed;
    }
    return null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Resolve MIME with explicit priority:
 *   1. mimeType
 *   2. mime
 *   3. sniff-from-filename helpers (name / path / filename) — only when present
 * Missing everything → null (unknown).
 */
export function resolveMimeType(input: MediaMetadataInput): string | null {
  const direct =
    normalizeMimeType(input.mimeType)
    ?? normalizeMimeType(input.mime);
  if (direct) return direct;

  const candidates = [input.filename, input.name, input.path];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const fromName = mimeFromFilename(candidate);
    const normalized = normalizeMimeType(fromName);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Build the canonical media metadata bag. All unknown fields are `null`
 * (JSON-serializable explicit unknown) — never omitted-as-0 and never a
 * universal MIME.
 */
export function buildMediaMetadata(input: MediaMetadataInput = {}): MediaMetadataFields {
  const mimeType = resolveMimeType(input);
  const sizeBytes =
    normalizeMediaNumber(input.sizeBytes)
    ?? normalizeMediaNumber(input.fileSize)
    ?? normalizeMediaNumber(input.size);
  const durationSec =
    normalizeMediaNumber(input.durationSec)
    ?? normalizeMediaNumber(input.duration);

  return {
    mimeType,
    sizeBytes,
    durationSec,
    // Legacy aliases mirror the canonical null semantics.
    fileSize: sizeBytes,
    duration: durationSec,
  };
}

/**
 * Merge media metadata into a node-data / asset-row bag without inventing
 * defaults. Existing explicit values win over incoming nulls only when the
 * existing value is already a usable number/string; incoming known values
 * always overwrite.
 */
export function mergeMediaMetadata(
  target: Record<string, unknown>,
  incoming: MediaMetadataInput,
): Record<string, unknown> {
  const meta = buildMediaMetadata({
    mimeType: incoming.mimeType ?? target.mimeType,
    mime: incoming.mime,
    sizeBytes: incoming.sizeBytes ?? target.sizeBytes ?? target.fileSize,
    fileSize: incoming.fileSize ?? target.fileSize,
    size: incoming.size,
    durationSec: incoming.durationSec ?? target.durationSec ?? target.duration,
    duration: incoming.duration ?? target.duration,
    filename: incoming.filename ?? target.originalName ?? target.name,
    path: incoming.path ?? target.relativePath ?? target.realPath,
    name: incoming.name ?? target.originalName,
  });

  const next: Record<string, unknown> = { ...target };
  // Always write the canonical keys so readers can rely on null-vs-missing.
  next.mimeType = meta.mimeType;
  next.sizeBytes = meta.sizeBytes;
  next.durationSec = meta.durationSec;
  next.fileSize = meta.fileSize;
  next.duration = meta.duration;
  return next;
}

/**
 * True when a metadata field is the explicit-unknown sentinel (null) or
 * genuinely missing. Distinguishes "unknown" from a measured 0.
 */
export function isUnknownMediaField(value: unknown): boolean {
  return value === null || value === undefined;
}
