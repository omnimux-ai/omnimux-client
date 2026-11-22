import { createContext } from 'react';
import { useCanvasStore } from '../store/canvasStore';

export const CanvasClipLauncher = createContext<((nodeId: string) => void) | null>(null);

export function updateClipNodeData(nodeId: string, patch: Record<string, unknown>): void {
  useCanvasStore.getState().setNodes((nodes) => nodes.map((node) => (
    node.id === nodeId && node.type === 'video_composition'
      ? { ...node, data: { ...node.data, ...patch } } : node
  )));
}
