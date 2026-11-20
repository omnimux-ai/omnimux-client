/**
 * Ported (narrowed) from Gxgen `apps/web/src/store/canvasStore.ts`
 * (validated by the extraction spike).
 *
 * The Graph slice is line-for-line isomorphic with Gxgen — including the
 * detail that edge removals route through the mutation gateway. The UI
 * slice is minimal (selection). Timeline/Overlay/Playback slices are cut
 * (timeline domain, V1 out of scope).
 *
 * M2 adds the History slice: snapshot-based undo/redo ported from Gxgen
 * `useCanvasHistory` (nodes/edges only — tracks/textOverlays are cut).
 * The snapshot stacks live in the store (not a hook) so the keyboard
 * shortcuts, the context menu, and the toolbar all share one history.
 */

import { create } from 'zustand';
import { useGenerationPreferencesStore } from './generationPreferencesStore';
import { useShallow } from 'zustand/react/shallow';
import {
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import {
  planCanvasInputMutation,
  dispatchSuccessfulConnectionEvents,
  type CanvasInputMutation,
  type CanvasInputMutationPlan,
  type CanvasNode,
} from '../editor/utils/canvasInputMutationGateway';
import type { CapabilityCatalog } from '../../shared/api';
import {
  readGraphCatalogFingerprint,
  reconcileCanvasForCatalog,
} from '../../shared/graph/catalogReconcile.ts';
import {
  clearPersistSessionFlags,
  noteGraphReset,
  noteUserDeletedGraphElements,
} from '../bridge/persistPolicy';
import {
  DEFAULT_GROUP_COLOR,
  planGroupNodes,
  planUngroupNode,
  planToggleGroupCollapse,
} from '../editor/utils/nodeVisualMath';

export type SelectedElementType = 'none' | 'node';

// ============================================================================
// History (ported from Gxgen useCanvasHistory, narrowed to nodes/edges)
// ============================================================================

/** Max undo steps kept (same as Gxgen). */
const MAX_HISTORY_SIZE = 50;
/** Coalescing window: rapid changes (e.g. node drags) share one snapshot. */
const HISTORY_DEBOUNCE_MS = 300;

interface HistorySnapshot {
  nodes: CanvasNode[];
  edges: Edge[];
  /** Graph signature excludes transient React Flow state. */
  sig: string;
}

function graphSignature(nodes: CanvasNode[], edges: Edge[]): string {
  // React Flow can report selection and remeasure restored nodes after undo.
  // Only graph changes should record an undo step or invalidate redo.
  return JSON.stringify({
    nodes: nodes.map(({ selected, dragging, resizing, measured, ...node }) => node),
    edges: edges.map(({ selected, ...edge }) => edge),
  });
}

function snapshotOf(nodes: CanvasNode[], edges: Edge[], sig = graphSignature(nodes, edges)): HistorySnapshot {
  // Deep clone via JSON so history entries are detached from live state.
  const clone = JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: CanvasNode[]; edges: Edge[] };
  return { nodes: clone.nodes, edges: clone.edges, sig };
}

/** Module-private history bookkeeping (single canvasStore instance). */
const history = {
  current: null as HistorySnapshot | null,
  lastPushAt: 0,
};

function recordGroupAction(state: CanvasState, nodes: CanvasNode[]) {
  // Capture the graph at the action boundary, even when the last renderer
  // effect hasn't recorded a preceding drag yet.
  const previous = snapshotOf(state.nodes, state.edges);
  history.current = snapshotOf(nodes, state.edges);
  // Let the first graph change after a discrete action start its own step.
  history.lastPushAt = 0;
  return {
    nodes,
    past: [...state.past, previous].slice(-MAX_HISTORY_SIZE),
    future: [],
  };
}

export interface CanvasState {
  // ===== Graph Slice =====
  nodes: CanvasNode[];
  edges: Edge[];
  onNodesChange: OnNodesChange<CanvasNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  applyCanvasInputMutation: (mutation: CanvasInputMutation, options?: { undoStep?: boolean }) => CanvasInputMutationPlan;
  /** Catalog v1.1 runtime DTO (boot-synced; runtime-only, never persisted). */
  catalogRuntime: CapabilityCatalog | null;
  setCatalogRuntime: (catalog: CapabilityCatalog | null) => void;
  setNodes: (nodes: CanvasNode[] | ((nodes: CanvasNode[]) => CanvasNode[])) => void;
  setEdges: (edges: Edge[] | ((edges: Edge[]) => Edge[])) => void;
  removeEdge: (edgeId: string) => void;
  deleteElements: (nodeIds: string[], edgeIds: string[]) => void;
  /** Group given nodes into a new group container node. */
  groupNodes: (nodeIds: string[], title?: string, color?: string) => string | null;
  /** Ungroup container and restore child nodes to absolute canvas space. */
  ungroup: (groupId: string) => void;
  /** Toggle group collapse/expand state. */
  toggleGroupCollapse: (groupId: string) => void;
  /** Resize or reposition a group node. */
  resizeGroup: (groupId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  /** Replace the whole graph (workspace load). */
  hydrateGraph: (nodes: CanvasNode[], edges: Edge[]) => void;

  // ===== History Slice（M2，Gxgen useCanvasHistory 移植）=====
  /** Undo stack (past states, oldest first). */
  past: HistorySnapshot[];
  /** Redo stack (undone states, oldest first). */
  future: HistorySnapshot[];
  /** Record the current graph as a potential undo target (debounced). */
  pushHistory: (force?: boolean) => void;
  undo: () => void;
  redo: () => void;
  /** Drop all history and reseed from the current graph. */
  clearHistory: () => void;

  // ===== UI Slice（最小）=====
  selectedElement: { type: SelectedElementType; id: string | null };
  setSelectedElement: (type: SelectedElementType, id: string | null) => void;

  // ===== Store Reset =====
  resetStore: () => void;
}

export const useCanvasStore = create<CanvasState>()(
  (set, get) => ({
    // ========================================================================
    // Graph Slice（与 Gxgen 同构）
    // ========================================================================
    nodes: [] as CanvasNode[],
    edges: [] as Edge[],

    onNodesChange: (changes: NodeChange<CanvasNode>[]) => {
      if (changes.some((change) => change.type === 'remove')) {
        // xyflow / 键盘删除走 remove change，视为用户删节点
        noteUserDeletedGraphElements();
      }
      set({
        nodes: applyNodeChanges(changes, get().nodes),
      });
    },

    onEdgesChange: (changes: EdgeChange[]) => {
      const removedEdgeIds = changes
        .filter((change): change is EdgeChange & { type: 'remove' } => change.type === 'remove')
        .map((change) => change.id);
      if (removedEdgeIds.length > 0) {
        get().applyCanvasInputMutation({ removeEdgeIds: removedEdgeIds });
      }
      const nonRemovalChanges = changes.filter((change) => change.type !== 'remove');
      if (nonRemovalChanges.length > 0) {
        set({ edges: applyEdgeChanges(nonRemovalChanges, get().edges) });
      }
    },

    onConnect: (connection: Connection) => {
      get().applyCanvasInputMutation({ addEdges: [connection] });
    },

    applyCanvasInputMutation: (mutation, { undoStep = false } = {}) => {
      if (mutation.removeNodeIds && mutation.removeNodeIds.length > 0) {
        noteUserDeletedGraphElements();
      }
      const current = get();
      const plan = planCanvasInputMutation(
        { nodes: current.nodes, edges: current.edges },
        mutation,
        // Issue #466: catalog-aware compat pass — edge + slot binding +
        // model/operation auto-adaptation commit as ONE store set.
        { catalog: current.catalogRuntime, preferredModels: useGenerationPreferencesStore.getState().lastModelByType },
      );
      if (plan.status !== 'allowed') return plan;
      if (undoStep) current.pushHistory();
      set({ nodes: plan.nodes, edges: plan.edges });
      if (undoStep) get().pushHistory(true);
      const addedEdges = plan.edges.filter((edge) => (
        !current.edges.some((existing) => existing.id === edge.id)
      ));
      dispatchSuccessfulConnectionEvents(addedEdges);
      return plan;
    },

    catalogRuntime: null as CapabilityCatalog | null,

    setCatalogRuntime: (catalog: CapabilityCatalog | null) => {
      const current = get();
      const previousFingerprint =
        (typeof current.catalogRuntime?.fingerprint === 'string'
          ? current.catalogRuntime.fingerprint
          : '')
        || readGraphCatalogFingerprint(current.nodes);
      const nextFingerprint =
        typeof catalog?.fingerprint === 'string' ? catalog.fingerprint : '';

      // Always store the runtime catalog first so subsequent mutations see it.
      if (
        previousFingerprint === nextFingerprint
        && current.catalogRuntime === catalog
      ) {
        // Identical reference + fingerprint: pure no-op (oscillation guard).
        return;
      }

      // Soft reconcile generate nodes when the fingerprint changes. Historical
      // zero-candidate graphs keep their edges and only flip configuration_error.
      if (previousFingerprint !== nextFingerprint && current.nodes.length > 0) {
        const reconciled = reconcileCanvasForCatalog({
          nodes: current.nodes,
          edges: current.edges,
          catalog,
          previousFingerprint,
          preferredModels: useGenerationPreferencesStore.getState().lastModelByType,
        });
        if (reconciled.changed) {
          set({
            catalogRuntime: catalog,
            nodes: reconciled.nodes,
            edges: reconciled.edges,
          });
          return;
        }
      }
      set({ catalogRuntime: catalog });
    },

    setNodes: (nodesOrUpdater) => {
      set((state) => ({
        nodes: typeof nodesOrUpdater === 'function'
          ? nodesOrUpdater(state.nodes)
          : nodesOrUpdater,
      }));
    },

    setEdges: (edgesOrUpdater) => {
      set((state) => ({
        edges: typeof edgesOrUpdater === 'function'
          ? edgesOrUpdater(state.edges)
          : edgesOrUpdater,
      }));
    },

    removeEdge: (edgeId) => {
      get().applyCanvasInputMutation({ removeEdgeIds: [edgeId] });
    },

    deleteElements: (nodeIds, edgeIds) => {
      if (nodeIds.length > 0) noteUserDeletedGraphElements();
      get().applyCanvasInputMutation({ removeNodeIds: nodeIds, removeEdgeIds: edgeIds });
      const selected = get().selectedElement;
      if (selected.type === 'node' && selected.id && nodeIds.includes(selected.id)) {
        set({ selectedElement: { type: 'none', id: null } });
      }
    },

    groupNodes: (nodeIds, title = '新建组', color = DEFAULT_GROUP_COLOR) => {
      const state = get();
      const plan = planGroupNodes(state.nodes, nodeIds, title, color);
      if (!plan) return null;

      set({
        ...recordGroupAction(state, plan.nodes),
        selectedElement: { type: 'node', id: plan.groupId },
      });

      return plan.groupId;
    },

    ungroup: (groupId) => {
      const state = get();
      const updatedNodes = planUngroupNode(state.nodes, groupId);
      if (!updatedNodes) return;

      set({
        ...recordGroupAction(state, updatedNodes),
        selectedElement: { type: 'none', id: null },
      });
    },

    toggleGroupCollapse: (groupId) => {
      const state = get();
      const updatedNodes = planToggleGroupCollapse(state.nodes, groupId);
      if (!updatedNodes) return;

      set(recordGroupAction(state, updatedNodes));
    },

    resizeGroup: (groupId, bounds) => {
      const currentNodes = get().nodes;
      const groupNode = currentNodes.find((n) => n.id === groupId && n.type === 'group');
      if (!groupNode) return;

      const dx = bounds.x - groupNode.position.x;
      const dy = bounds.y - groupNode.position.y;

      const updatedNodes = currentNodes.map((node) => {
        if (node.id === groupId) {
          return {
            ...node,
            position: { x: bounds.x, y: bounds.y },
            width: bounds.width,
            height: bounds.height,
            style: {
              ...node.style,
              width: bounds.width,
              height: bounds.height,
            },
          };
        }
        // If group position shifted (e.g. from NW resize), adjust children relative positions
        if (node.parentId === groupId && (dx !== 0 || dy !== 0)) {
          return {
            ...node,
            position: {
              x: node.position.x - dx,
              y: node.position.y - dy,
            },
          };
        }
        return node;
      });

      set({ nodes: updatedNodes });
    },

    hydrateGraph: (nodes, edges) => {
      clearPersistSessionFlags();
      const catalog = get().catalogRuntime;
      // Catalog-first boot has already stored its fingerprint while the graph
      // was empty. Reconcile the newly loaded nodes regardless of that prior
      // runtime fingerprint so picker state and submitted params stay aligned.
      const reconciled = catalog
        ? reconcileCanvasForCatalog({
            nodes,
            edges,
            catalog,
            previousFingerprint: '',
            preferredModels: useGenerationPreferencesStore.getState().lastModelByType,
          })
        : null;
      const nextNodes = reconciled?.nodes ?? nodes;
      const nextEdges = reconciled?.edges ?? edges;
      set({
        nodes: nextNodes,
        edges: nextEdges,
        selectedElement: { type: 'none', id: null },
        past: [],
        future: [],
      });
      history.current = snapshotOf(nextNodes, nextEdges);
      history.lastPushAt = 0;
    },

    // ========================================================================
    // History Slice（M2）
    // ========================================================================
    past: [] as HistorySnapshot[],
    future: [] as HistorySnapshot[],

    pushHistory: (force = false) => {
      const { nodes, edges, future } = get();
      const sig = graphSignature(nodes, edges);
      // No-op when nothing changed (also absorbs the re-render that undo
      // itself triggers: history.current was already moved to the restored
      // state before set(), so the signatures match and we return early).
      if (history.current?.sig === sig) return;

      const now = Date.now();
      const previous = history.current;
      // Within the debounce window we only move the "current" pointer —
      // rapid changes (node drags, typing) coalesce into one undo step.
      history.current = snapshotOf(nodes, edges, sig);
      if (previous && (force || future.length > 0 || now - history.lastPushAt >= HISTORY_DEBOUNCE_MS)) {
        history.lastPushAt = now;
        set((state) => ({
          past: [...state.past, previous].slice(-MAX_HISTORY_SIZE),
          future: [],
        }));
      }
    },

    undo: () => {
      const { past, nodes, edges } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      if (!previous) return;
      const current = snapshotOf(nodes, edges);
      history.current = previous;
      set((state) => ({
        nodes: previous.nodes,
        edges: previous.edges,
        past: past.slice(0, -1),
        future: [...state.future, current],
      }));
    },

    redo: () => {
      const { future, nodes, edges } = get();
      if (future.length === 0) return;
      const next = future[future.length - 1];
      if (!next) return;
      const current = snapshotOf(nodes, edges);
      history.current = next;
      set((state) => ({
        nodes: next.nodes,
        edges: next.edges,
        past: [...state.past, current],
        future: future.slice(0, -1),
      }));
    },

    clearHistory: () => {
      const { nodes, edges } = get();
      set({ past: [], future: [] });
      history.current = snapshotOf(nodes, edges);
      history.lastPushAt = 0;
    },

    // ========================================================================
    // UI Slice（最小）
    // ========================================================================
    selectedElement: { type: 'none' as SelectedElementType, id: null as string | null },

    setSelectedElement: (type: SelectedElementType, id: string | null) => {
      set({ selectedElement: { type, id } });
    },

    // ========================================================================
    // Store Reset
    // ========================================================================
    resetStore: () => {
      noteGraphReset();
      set({
        nodes: [],
        edges: [],
        selectedElement: { type: 'none', id: null },
        past: [],
        future: [],
        catalogRuntime: null,
      });
      history.current = null;
      history.lastPushAt = 0;
    },
  }),
);

// ============================================================================
// Convenience Hooks（保留 Gxgen 的 selector 组织方式）
// ============================================================================

export const useGraphStore = () =>
  useCanvasStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      setNodes: state.setNodes,
      setEdges: state.setEdges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
    })),
  );

export const useSelection = () =>
  useCanvasStore(
    useShallow((state) => ({
      selectedElement: state.selectedElement,
      setSelectedElement: state.setSelectedElement,
    })),
  );

export const useCanUndo = () => useCanvasStore((state) => state.past.length > 0);

export const useCanRedo = () => useCanvasStore((state) => state.future.length > 0);

/** 是否处于多选模式（选中的常规非组节点数 >= 2） */
export const useIsMultiSelected = () =>
  useCanvasStore((state) => state.nodes.filter((n) => n.selected && n.type !== 'group').length >= 2);

/** 当前选中的常规非组节点数量 */
export const useSelectedNodeCount = () =>
  useCanvasStore((state) => state.nodes.filter((n) => n.selected && n.type !== 'group').length);

