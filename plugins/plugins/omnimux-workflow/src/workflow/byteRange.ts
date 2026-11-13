/**
 * HTTP Range parsing for local media streaming (no copy of video-preview).
 */
export interface ByteRange {
  start: number;
  end: number;
}

export function parseByteRange(
  rangeHeader: string | undefined,
  totalSize: number,
): ByteRange | { invalid: true } | null {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };

  const startStr = match[1];
  const endStr = match[2];
  let start = startStr ? Number.parseInt(startStr, 10) : undefined;
  let end = endStr ? Number.parseInt(endStr, 10) : undefined;

  if (start === undefined && end === undefined) return { invalid: true };

  if (start === undefined) {
    start = Math.max(0, totalSize - (end ?? 0));
    end = totalSize - 1;
  } else if (end === undefined || end >= totalSize) {
    end = totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
    return { invalid: true };
  }
  return { start, end };
}
