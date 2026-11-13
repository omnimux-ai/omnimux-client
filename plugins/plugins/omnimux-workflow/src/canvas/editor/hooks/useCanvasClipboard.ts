/**
 * In-island clipboard + selection mutations (Gxgen pattern: ref, not the
 * system clipboard). Extracted from CanvasEditor so the ReactFlow shell
 * does not own copy/paste/delete/select-all mechanics.
 */
import { useCallback, useRef, type MutableRefObject } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { copyNodesToClipboard, pasteFromClipboard, type ClipboardData } from '../utils/clipboardUtils';

export interface CanvasClipboard {
  clipboardRef: MutableRefObject<ClipboardData>;
  hasClipboard: boolean;
  copySelectedNodes: () => void;
  pasteNodes: (targetPosition?: { x: number; y: number }) => void;
  duplicateSelectedNodes: () => void;
  deleteSelectedNodes: () => void;
  selectAllNodes: () => void;
  clearSelection: () => void;
}

export function useCanvasClipboard(
  setNodes: (updater: (current: ReturnType<typeof useCanvasStore.getState>['nodes']) => ReturnType<typeof useCanvasStore.getState>['nodes']) => void,
  setSelectedElement: (type: 'none' | 'node', id: string | null) => void,
): CanvasClipboard {
  const clipboardRef = useRef<ClipboardData>({ nodes: [], edges: [] });
  const lastPastePositionRef = useRef<{ x: number; y: number } | null>(null);
  const hasClipboard = clipboardRef.current.nodes.length > 0;

  const copySelectedNodes = useCallback(() => {
    const state = useCanvasStore.getState();
    const clipboard = copyNodesToClipboard(state.nodes, state.edges);
    if (clipboard.nodes.length > 0) {
      clipboardRef.current = clipboard;
      lastPastePositionRef.current = null;
    }
  }, []);

  const pasteNodes = useCallback((targetPosition?: { x: number; y: number }) => {
    const result = pasteFromClipboard(
      clipboardRef.current,
      targetPosition,
      lastPastePositionRef.current,
    );
    if (!result) return;
    lastPastePositionRef.current = result.newPastePosition;
    const state = useCanvasStore.getState();
    state.applyCanvasInputMutation({
      addNodes: result.nodes,
      addEdges: result.edges,
      nodePatches: state.nodes.map((node) => ({
        nodeId: node.id,
        data: {},
        node: { selected: false },
      })),
    });
  }, []);

  const duplicateSelectedNodes = useCallback(() => {
    copySelectedNodes();
    pasteNodes();
  }, [copySelectedNodes, pasteNodes]);

  const deleteSelectedNodes = useCallback(() => {
    const state = useCanvasStore.getState();
    const nodeIds = state.nodes.filter((node) => node.selected).map((node) => node.id);
    if (nodeIds.length === 0) return;
    state.applyCanvasInputMutation({ removeNodeIds: nodeIds });
  }, []);

  const selectAllNodes = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: true })));
  }, [setNodes]);

  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setSelectedElement('none', null);
  }, [setNodes, setSelectedElement]);

  return {
    clipboardRef,
    hasClipboard,
    copySelectedNodes,
    pasteNodes,
    duplicateSelectedNodes,
    deleteSelectedNodes,
    selectAllNodes,
    clearSelection,
  };
}
