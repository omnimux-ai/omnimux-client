import { useEffect, useMemo, useRef, useState } from "react";

import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import css from "./MasonryGrid.module.css";
import type { MasonryGridProps } from "./types.ts";

export interface MasonryEntry<T> {
  item: T;
  index: number;
  column: number;
}

/** Calculate responsive column count from measured container width. */
export function computeMasonryColumnCount(
  containerWidth: number,
  {
    minColumnWidth = 236,
    minColumns = 1,
    maxColumns = 6,
    gap = 12,
    defaultColumns = 4,
  }: {
    minColumnWidth?: number | undefined;
    minColumns?: number | undefined;
    maxColumns?: number | undefined;
    gap?: number | undefined;
    defaultColumns?: number | undefined;
  } = {},
): number {
  const lo = Math.max(1, Math.floor(minColumns));
  const hi = Math.max(lo, Math.floor(maxColumns));
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return Math.min(hi, Math.max(lo, Math.floor(defaultColumns)));
  }
  const raw = Math.floor((containerWidth + gap) / (Math.max(120, minColumnWidth) + gap));
  return Math.min(hi, Math.max(lo, raw));
}

/**
 * Distribute items across CSS flex columns while keeping prior assignments stable
 * when paginated batches append to the end of the list.
 */
export function distributeMasonryColumns<T>(
  items: readonly T[],
  getKey: (item: T, index: number) => string,
  columnCount: number,
  previousAssignments: ReadonlyMap<string, number> | undefined,
  estimateWeight?: ((item: T, index: number) => number) | undefined,
): {
  columns: MasonryEntry<T>[][];
  assignments: Map<string, number>;
} {
  const safeCols = Math.max(1, Math.floor(columnCount));
  const columns: MasonryEntry<T>[][] = Array.from({ length: safeCols }, () => []);
  const weights = new Array<number>(safeCols).fill(0);
  const assignments = new Map<string, number>();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === undefined) continue;
    const key = getKey(item, i);
    const weight = estimateWeight ? Math.max(0.4, estimateWeight(item, i)) : 1;

    const cachedCol = previousAssignments?.get(key);
    let targetCol: number;
    if (cachedCol !== undefined && cachedCol >= 0 && cachedCol < safeCols) {
      targetCol = cachedCol;
    } else {
      targetCol = 0;
      let minWeight = weights[0] ?? 0;
      for (let col = 1; col < safeCols; col += 1) {
        const w = weights[col] ?? 0;
        if (w < minWeight) {
          minWeight = w;
          targetCol = col;
        }
      }
    }

    columns[targetCol]?.push({ item, index: i, column: targetCol });
    weights[targetCol] = (weights[targetCol] ?? 0) + weight;
    assignments.set(key, targetCol);
  }

  return { columns, assignments };
}

/**
 * Natural CSS flex-column masonry layout. Avoids pixel height estimation overlap
 * and preserves existing card column placements across pagination appends.
 */
export function MasonryGrid<T>({
  items,
  getKey,
  renderItem,
  estimateWeight,
  minColumnWidth = 236,
  minColumns = 1,
  maxColumns = 6,
  gap = 12,
  defaultColumns = 4,
  resetKey,
  className,
  ariaLabel,
}: MasonryGridProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState<number>(() =>
    computeMasonryColumnCount(0, { minColumnWidth, minColumns, maxColumns, gap, defaultColumns }),
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    const update = (width: number) => {
      const next = computeMasonryColumnCount(width, {
        minColumnWidth,
        minColumns,
        maxColumns,
        gap,
        defaultColumns,
      });
      setColumnCount((prev) => (prev === next ? prev : next));
    };

    const initialWidth = el.clientWidth || (typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect().width : 0);
    if (initialWidth > 0) update(initialWidth);

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === "number" && w > 0) update(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [minColumnWidth, minColumns, maxColumns, gap, defaultColumns]);

  const cacheRef = useRef<{ scope: string; map: Map<string, number> }>({
    scope: "",
    map: new Map(),
  });

  const scopeKey = `${String(resetKey ?? "")}::${columnCount}`;
  const { columns, assignments } = useMemo(() => {
    const prev = cacheRef.current.scope === scopeKey ? cacheRef.current.map : undefined;
    return distributeMasonryColumns(items, getKey, columnCount, prev, estimateWeight);
  }, [items, getKey, columnCount, scopeKey, estimateWeight]);

  useEffect(() => {
    cacheRef.current = { scope: scopeKey, map: assignments };
  }, [scopeKey, assignments]);

  const gapPx = `${Math.max(0, gap)}px`;

  return (
    <div
      ref={rootRef}
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      data-columns={columnCount}
      className={cx(cssClass(css.root, "root"), className)}
      style={{ gap: gapPx }}
    >
      {columns.map((colEntries, colIdx) => (
        <div key={colIdx} className={cssClass(css.column, "column")} style={{ gap: gapPx }}>
          {colEntries.map((entry) => renderItem(entry.item, { index: entry.index, column: entry.column, columnCount }))}
        </div>
      ))}
    </div>
  );
}
