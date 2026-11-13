/**
 * Ported from Gxgen
 * `apps/web/src/pages/CanvasEditor/components/EdgeDisconnectControl.tsx`
 * (49 lines) — foreignObject disconnect button at the edge midpoint,
 * revealed on edge hover (CSS: wf-edge-disconnect*).
 *
 * Differences: AppIcon Scissors → lucide-react Unlink (named import);
 * canvasStore.removeEdge → applyCanvasInputMutation({ removeEdgeIds }) —
 * edge deletion MUST go through the mutation gateway (never setEdges
 * directly) so the undo/redo chain stays intact; aria-label/title come
 * from the island i18n dictionary.
 */

import { memo, useCallback } from 'react';
import { Unlink } from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import { useT } from '../../i18n';

interface EdgeDisconnectControlProps {
  edgeId: string;
  x: number;
  y: number;
}

const CONTROL_SIZE = 28;

const EdgeDisconnectControl: React.FC<EdgeDisconnectControlProps> = ({ edgeId, x, y }) => {
  const t = useT();
  const applyCanvasInputMutation = useCanvasStore((state) => state.applyCanvasInputMutation);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    applyCanvasInputMutation({ removeEdgeIds: [edgeId] });
  }, [edgeId, applyCanvasInputMutation]);

  return (
    <foreignObject
      className="wf-edge-disconnect"
      x={x - CONTROL_SIZE / 2}
      y={y - CONTROL_SIZE / 2}
      width={CONTROL_SIZE}
      height={CONTROL_SIZE}
    >
      <button
        type="button"
        className="wf-edge-disconnect__button"
        aria-label={t('edge.disconnect')}
        title={t('edge.disconnect')}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <Unlink aria-hidden="true" size={14} strokeWidth={2.2} />
      </button>
    </foreignObject>
  );
};

export default memo(EdgeDisconnectControl);
