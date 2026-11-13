import React, { memo, useCallback, useMemo } from 'react';
import type { ResizeHandleDirection } from '../../utils/nodeVisualMath';
import { clampGroupResize, resolveGroupAccentStyle, screenDeltaToFlowDelta } from '../../utils/nodeVisualMath';
import { stopToolbarNativeEvent } from '../toolbarPointerGuard';

export interface GroupResizeHandlesProps {
  bounds: { x: number; y: number; width: number; height: number };
  minAllowed: { minWidth: number; minHeight: number };
  color: string;
  zoom?: number;
  onResize: (newBounds: { x: number; y: number; width: number; height: number }) => void;
}

const HANDLES: Array<{ direction: ResizeHandleDirection; kind: 'corner' | 'edge' }> = [
  { direction: 'nw', kind: 'corner' },
  { direction: 'ne', kind: 'corner' },
  { direction: 'se', kind: 'corner' },
  { direction: 'sw', kind: 'corner' },
  { direction: 'n', kind: 'edge' },
  { direction: 's', kind: 'edge' },
  { direction: 'w', kind: 'edge' },
  { direction: 'e', kind: 'edge' },
];

export const GroupResizeHandles: React.FC<GroupResizeHandlesProps> = memo(({
  bounds,
  minAllowed,
  color,
  zoom = 1,
  onResize,
}) => {
  const accentStyle = useMemo(
    () => {
      const resolved = resolveGroupAccentStyle(color);
      return Object.keys(resolved).length > 0 ? resolved : { '--wf-group-accent': 'var(--wb-node-ring)' };
    },
    [color],
  );
  const handlePointerDown = useCallback(
    (direction: ResizeHandleDirection, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const initialBounds = { ...bounds };
      const currentZoom = zoom;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const delta = screenDeltaToFlowDelta(
          moveEvent.clientX - startX,
          moveEvent.clientY - startY,
          currentZoom,
        );
        const nextBounds = clampGroupResize(direction, initialBounds, delta, minAllowed);
        onResize(nextBounds);
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [bounds, minAllowed, onResize, zoom],
  );

  return (
    <div
      className="wf-group-resize-handles nodrag nopan"
      onPointerDown={stopToolbarNativeEvent}
      onMouseDown={stopToolbarNativeEvent}
      style={accentStyle as React.CSSProperties}
    >
      {HANDLES.map((handle) => (
        <div
          key={handle.direction}
          className={`wf-group-handle wf-group-handle--${handle.kind} wf-group-handle--${handle.direction}`}
          onPointerDown={(e) => handlePointerDown(handle.direction, e)}
          title={handle.kind === 'corner' ? '缩放' : handle.direction === 'n' || handle.direction === 's' ? '垂直调整' : '水平调整'}
        />
      ))}
    </div>
  );
});

GroupResizeHandles.displayName = 'GroupResizeHandles';
