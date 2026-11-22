/**
 * useWorkspacePersistence — M2 auto-save layer (replaces the M1 manual
 * save button).
 *
 * Behavior:
 * - Subscribes to the canvasStore graph; changes are debounced (1s) and
 *   saved via PUT with the optimistic-lock version.
 * - 409 / external version poll: compare signatures. Same graph → adopt
 *   the remote version (self-collision from open/flush). Local still equal
 *   to last-saved → reload. Only a real content split surfaces 'conflict'.
 * - Selection / measure-only / media nodeHeight changes are NOT saved
 *   (signature strips `selected`, `measured`, `dragging`, `positionAbsolute`,
 *   `__catalog`, `nodeHeight`, blob: URLs), so casual clicking, first layout
 *   measure, and media onLoad never dirty the doc.
 * - Best-effort flush on unmount / pagehide.
 *
 * 空图保护（persistPolicy）：
 * - 每次 PUT 发送前同步拷贝图。409 恢复在确认仍是同一画布后重新捕获。
 * - 离开时只保存同步捕获的原画布，不读取下一个画布的 Store。
 * - 未观察到用户删光时，禁止把非空图覆盖成空（reset / flush / autosave）。
 * - hydrate 完成前（enabled=false）不订阅、不 flush。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { getWorkspace, getWorkspaceVersion, saveWorkspace } from './apiClient';
import type {
  CanvasWorkspaceSnapshot,
  SerializedCanvasEdge,
  SerializedCanvasNode,
} from '../../shared/canvasTypes';
import {
  decidePersist,
  inferPersistCause,
  peekGraphReset,
  shouldPersistEmptyGraph,
  snapshotGraph,
  type PersistCause,
} from './persistPolicy';
import { decideRemoteVersionAdvance, type GraphReconcileDecision } from './persistConflict';
import { sanitizeEdges, sanitizeNodes, signatureOf } from './persistSanitize';
import { planClipWriteRebase, rebaseClipWrite } from './rebaseClipWrite';

const AUTOSAVE_DEBOUNCE_MS = 1000;
const SAVED_BADGE_MS = 2500;
/** PR3: external-edit version poll interval (visible tab only). */
const EXTERNAL_WATCH_INTERVAL_MS = 3000;

export type AutosaveStatus =
  | 'idle'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

export const WORKSPACE_SAVED_EVENT = 'canvas:workspace-saved';

export function notifyWorkspaceSaved(workspace: CanvasWorkspaceSnapshot): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(WORKSPACE_SAVED_EVENT, { detail: workspace }));
  }
}

export interface PersistenceController {
  status: AutosaveStatus;
  /** Whether the local graph differs from the last saved snapshot. */
  isDirty: boolean;
  /** Save the current graph or reject; returns the version safe to submit. */
  saveNow: () => Promise<number>;
  /**
   * 卸载硬闸：清 debounce，同步 `readStoreCapture()`，再 `void performSave`。
   * 必须在 `resetStore()` 之前调用；PUT 可以异步，capture 必须钉死。
   */
  flushPendingSave: () => void;
  /** Conflict recovery: pull the server version and re-save local content. */
  resolveConflict: () => Promise<void>;
  /** Discard local changes and re-hydrate from the server snapshot. */
  reloadFromServer: () => Promise<void>;
}

export interface UseWorkspacePersistenceOptions {
  /** Called with the fresh server snapshot after every successful save. */
  onSaved?: (workspace: CanvasWorkspaceSnapshot) => void;
  /**
   * hydrate 完成前必须为 false：不订阅 store、不 flush。
   * App 绑 `boot.phase === 'ready'`。
   */
  enabled?: boolean;
}

type SaveMode = 'autosave' | 'preflight' | 'flush' | 'keep-local';
type ClipWrite = { base: GraphCapture; remote: CanvasWorkspaceSnapshot; mode?: 'keep-local' };
type RemoteReconcile = Exclude<GraphReconcileDecision, 'resave'> | 'unavailable' | {
  graph: GraphCapture;
  saved: SavedGraphState;
  clipWrite?: ClipWrite;
};
type SavedGraphState = {
  version: number;
  signature: string;
  nodeCount: number;
  graph: GraphCapture;
  clipWrites?: readonly ClipWrite[];
};
type SaveOutcome = SavedGraphState | { error: string; skipped?: true; saved?: SavedGraphState };

interface GraphCapture {
  nodes: SerializedCanvasNode[];
  edges: SerializedCanvasEdge[];
}

function readStoreCapture(): GraphCapture {
  const { nodes, edges } = useCanvasStore.getState();
  return snapshotGraph(nodes as SerializedCanvasNode[], edges as SerializedCanvasEdge[]);
}

function confirmedSnapshot(snapshot: CanvasWorkspaceSnapshot): SavedGraphState {
  return {
    version: snapshot.version,
    signature: signatureOf(snapshot.nodes, snapshot.edges, { workspaceId: snapshot.id }),
    nodeCount: snapshot.nodes.length,
    graph: snapshot,
  };
}

function installClipGraph(graph: GraphCapture, plan: NonNullable<ReturnType<typeof planClipWriteRebase>>) {
  const history = useCanvasStore.getState().rebaseHistory?.(plan.replayHistory);
  useCanvasStore.setState({ ...graph, ...history });
}

export function useWorkspacePersistence(
  workspace: CanvasWorkspaceSnapshot | null,
  opts: UseWorkspacePersistenceOptions = {},
): PersistenceController {
  const enabled = opts.enabled !== false;
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [isDirty, setIsDirty] = useState(false);

  const workspaceRef = useRef<CanvasWorkspaceSnapshot | null>(workspace);
  const scopeRef = useRef({ workspaceId: workspace?.id ?? null });
  if (scopeRef.current.workspaceId !== (workspace?.id ?? null)) {
    scopeRef.current = { workspaceId: workspace?.id ?? null };
  }
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const serverVersionRef = useRef(0);
  const lastSavedRef = useRef<SavedGraphState>({
    version: 0, signature: '', nodeCount: 0, graph: { nodes: [], edges: [] },
  });
  const conflictRef = useRef(false);
  const lastInitIdRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<SaveOutcome> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onSavedRef = useRef(opts.onSaved);
  onSavedRef.current = opts.onSaved;

  const isCurrentScope = (scope: typeof scopeRef.current) =>
    mountedRef.current && enabledRef.current && scopeRef.current === scope
    && workspaceRef.current?.id === scope.workspaceId && !peekGraphReset();

  const rememberSaved = useCallback(({ version, signature, nodeCount, graph }: SavedGraphState) => {
    serverVersionRef.current = version;
    lastSavedRef.current = { version, signature, nodeCount, graph };
  }, []);

  const graphSig = (
    nodes: SerializedCanvasNode[],
    edges: SerializedCanvasEdge[],
  ) => signatureOf(nodes, edges, { workspaceId: workspaceRef.current?.id });

  // (Re)initialize tracking on workspace switch / initial load. A mere
  // version bump from our own successful save only refreshes the server
  // version — it must not clobber the 'saved' badge or dirty tracking.
  useEffect(() => {
    workspaceRef.current = workspace;
    if (!workspace) {
      lastInitIdRef.current = '';
      savingRef.current = null;
      return;
    }
    if (lastInitIdRef.current === workspace.id) {
      serverVersionRef.current = Math.max(serverVersionRef.current, workspace.version);
      return;
    }
    lastInitIdRef.current = workspace.id;
    savingRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current);
    savedBadgeTimerRef.current = null;
    conflictRef.current = false;
    // 以磁盘/服务端快照为 last-saved，不读可能已被 reset 的 store
    rememberSaved(confirmedSnapshot(workspace));
    setIsDirty(false);
    setStatus('idle');
  }, [workspace?.id, workspace?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // 监听外部（如服务端原子写入或拆解完成）的已保存快照广播，对齐本地版本并触发 onSaved
  useEffect(() => {
    const handleRemoteSaved = (e: Event) => {
      const snap = (e as CustomEvent<CanvasWorkspaceSnapshot>).detail;
      if (!snap || snap.id !== workspaceRef.current?.id || snap.version < serverVersionRef.current) return;
      rememberSaved(confirmedSnapshot(snap));
      conflictRef.current = false;
      setIsDirty(false);
      setStatus('idle');
      onSavedRef.current?.(snap);
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener(WORKSPACE_SAVED_EVENT, handleRemoteSaved);
      return () => {
        window.removeEventListener(WORKSPACE_SAVED_EVENT, handleRemoteSaved);
      };
    }
  }, []);

  const clearSavedBadgeTimer = () => {
    if (savedBadgeTimerRef.current) {
      clearTimeout(savedBadgeTimerRef.current);
      savedBadgeTimerRef.current = null;
    }
  };

  const performSaveRef = useRef<
    ((capture: GraphCapture, cause: PersistCause, mode?: SaveMode) => Promise<SaveOutcome>) | null
  >(null);

  const clearAutosaveTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const armAutosave = useCallback((capture: GraphCapture, cause: PersistCause) => {
    clearAutosaveTimer();
    const scope = scopeRef.current;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (isCurrentScope(scope)) void performSaveRef.current?.(capture, cause);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [clearAutosaveTimer]);

  /**
   * 远端 version 超前：先拉快照比签名。
   *
   * 判定必须用 await 之后的**当前** store 快照：版本探测与本地捕获不同源，
   * 沿用探测前的旧快照会把探测窗口内的编辑（典型：导入素材插入节点）
   * 误判成真分叉并冻结自动保存（Issue #3595）。四态见 persistConflict。
   */
  const resolveRemoteAdvance = useCallback((
    snapshot: CanvasWorkspaceSnapshot,
    keepLocal = false,
  ): RemoteReconcile => {
    const ws = workspaceRef.current;
    // A poll or a save response can arrive after a newer snapshot was adopted.
    if (snapshot.id !== ws?.id || snapshot.version < serverVersionRef.current) return 'unavailable';
    if (conflictRef.current && !keepLocal) return 'conflict';
    const current = readStoreCapture();
    const currentSignature = graphSig(current.nodes, current.edges);
    const saved = confirmedSnapshot(snapshot);
    const decision = decideRemoteVersionAdvance({
      localSignature: currentSignature,
      lastSavedSignature: lastSavedRef.current.signature,
      remoteSignature: saved.signature,
    });
    const base = lastSavedRef.current.graph;
    const mode = keepLocal ? 'keep-local' : undefined;
    const plan = keepLocal || decision === 'conflict' || decision === 'reload'
      ? planClipWriteRebase(base, snapshot, ws.id, mode) : undefined;
    const rebased = plan?.apply(current);
    if (plan && rebased) {
      rememberSaved(saved);
      const dirty = graphSig(rebased.nodes, rebased.edges) !== saved.signature;
      installClipGraph(rebased, plan);
      setIsDirty(dirty);
      if (!keepLocal) {
        setStatus(dirty ? 'pending' : 'idle');
        onSavedRef.current?.(snapshot);
      }
      return { graph: rebased, saved, clipWrite: { base, remote: snapshot, mode } };
    }
    if (keepLocal && !plan) {
      rememberSaved(saved);
      return { graph: current, saved };
    }
    if (decision === 'conflict' || keepLocal) {
      serverVersionRef.current = snapshot.version;
      conflictRef.current = true;
      setIsDirty(true);
      setStatus('conflict');
      return 'conflict';
    }
    rememberSaved(saved);
    if (decision === 'resave') {
      setIsDirty(true);
      setStatus((prev) => (prev === 'saving' ? prev : 'pending'));
      return { graph: current, saved };
    }
    if (decision === 'reload') useCanvasStore.getState().hydrateGraph(snapshot.nodes, snapshot.edges);
    setIsDirty(false);
    setStatus('idle');
    onSavedRef.current?.(snapshot);
    return decision;
  }, [rememberSaved]);

  const performSave = useCallback((
    capture: GraphCapture,
    cause: PersistCause,
    mode: SaveMode = 'autosave',
  ): Promise<SaveOutcome> => {
    const ws = workspaceRef.current;
    const scope = scopeRef.current;
    const previous = savingRef.current;
    const capturedSaved = lastSavedRef.current;
    const capturedConflict = conflictRef.current;
    const pending = (async (): Promise<SaveOutcome> => {
      if (!ws || scope.workspaceId !== ws.id) return { error: '画布尚未就绪，请重新打开后再试' };
      const prior = previous ? await previous : null;
      const current = isCurrentScope(scope);
      const priorSaved = prior && 'error' in prior ? prior.saved : prior;
      let saved = current ? lastSavedRef.current : priorSaved ?? capturedSaved;
      let clipWrites = priorSaved?.clipWrites ?? [];
      const skipped = (error: string): SaveOutcome => ({ error, skipped: true, saved: { ...saved, clipWrites } });
      const switched = () => skipped('画布已切换，请重新发起生成');
      const conflict = (observedVersion?: number): SaveOutcome => {
        if (isCurrentScope(scope)) {
          if (observedVersion !== undefined) {
            serverVersionRef.current = Math.max(serverVersionRef.current, observedVersion);
          }
          conflictRef.current = true;
          clearAutosaveTimer();
          setStatus('conflict');
        }
        return { error: '画布版本冲突，请确认最新内容后重新生成', saved: { ...saved, clipWrites } };
      };
      if (!current && mode !== 'flush') return switched();
      if (!current && prior && 'error' in prior && !prior.skipped) return prior;
      const keepLocal = mode === 'keep-local';
      const hasConflict = current ? conflictRef.current : capturedConflict;
      if (hasConflict && !keepLocal) return conflict();
      if (keepLocal && !hasConflict) return saved;

      let graph = capture;
      if (current && mode === 'autosave' && prior) {
        // A queued debounce can predate a retry that already saved a later edit.
        graph = readStoreCapture();
        cause = inferPersistCause(graph.nodes.length);
      } else if (!keepLocal) {
        const writesAfterCapture = clipWrites.filter(({ remote }) => remote.version > capturedSaved.version);
        for (const write of writesAfterCapture) {
          const plan = planClipWriteRebase(write.base, write.remote, ws.id, write.mode);
          const merged = plan?.apply(graph);
          if (!merged) return conflict();
          graph = merged;
        }
        if (!writesAfterCapture.length && saved.version !== capturedSaved.version) {
          graph = rebaseClipWrite(capturedSaved.graph, saved.graph, capture, ws.id) ?? capture;
        }
      }
      const decide = (next: GraphCapture, persistCause: PersistCause) => decidePersist({
        lastSavedNodeCount: saved.nodeCount,
        nextNodes: next.nodes,
        nextEdges: next.edges,
        cause: persistCause,
        lastSavedSignature: saved.signature,
        nextSignature: signatureOf(next.nodes, next.edges, { workspaceId: ws.id }),
      });
      const put = (value: GraphCapture) => saveWorkspace(ws.id, {
        name: ws.name,
        nodes: sanitizeNodes(value.nodes, { workspaceId: ws.id }),
        edges: sanitizeEdges(value.edges),
        expectedVersion: saved.version,
      });
      const readLatest = async (): Promise<CanvasWorkspaceSnapshot | undefined> => {
        const latest = await getWorkspace(ws.id).catch(() => undefined);
        const snapshot = latest?.ok ? latest.body.workspace : undefined;
        return snapshot?.id === ws.id && snapshot.version >= saved.version ? snapshot : undefined;
      };
      const reconcile = (result: Extract<RemoteReconcile, object>) => {
        saved = result.saved;
        graph = result.graph;
        if (result.clipWrite) clipWrites = [...clipWrites, result.clipWrite];
      };
      const complete = (persisted: CanvasWorkspaceSnapshot): SavedGraphState => {
        const nextSaved = { ...confirmedSnapshot(persisted), clipWrites };
        if (!isCurrentScope(scope) || persisted.version < serverVersionRef.current) return nextSaved;
        conflictRef.current = false;
        rememberSaved(nextSaved);
        // Undo can have matched the previous disk state while the PUT was
        // in flight, clearing its timer. Check against the newly written graph.
        const local = readStoreCapture();
        const dirty = graphSig(local.nodes, local.edges) !== nextSaved.signature;
        setIsDirty(dirty);
        setStatus(dirty ? 'pending' : 'saved');
        if (!dirty) clearAutosaveTimer();
        else if (!timerRef.current) armAutosave(local, inferPersistCause(local.nodes.length));
        clearSavedBadgeTimer();
        savedBadgeTimerRef.current = setTimeout(() => {
          if (isCurrentScope(scope)) setStatus((prev) => (prev === 'saved' ? 'idle' : prev));
        }, SAVED_BADGE_MS);
        onSavedRef.current?.(persisted);
        return nextSaved;
      };

      try {
        let resolution: CanvasWorkspaceSnapshot | undefined;
        if (keepLocal) {
          setStatus('saving');
          resolution = await readLatest();
          if (!isCurrentScope(scope)) return switched();
          const latest = resolution && resolveRemoteAdvance(resolution, true);
          if (!latest || typeof latest !== 'object') return conflict();
          reconcile(latest);
          cause = inferPersistCause(graph.nodes.length);
        }
        const decision = decide(graph, cause);
        if (!decision.snapshot) {
          if (decision.reason !== 'unchanged') {
            return keepLocal ? conflict() : { error: '画布内容尚未保存，请重新打开后再试' };
          }
          return resolution ? complete(resolution) : saved;
        }
        if (current) setStatus('saving');
        let result = await put(decision.snapshot);
        if (result.status === 409) {
          // One automatic retry. Further contention leaves the conflict
          // controls available, and Keep local starts from a fresh GET.
          const observedVersion = result.body.current;
          if (keepLocal) return conflict(observedVersion);
          const remote = await readLatest();
          if (!remote || remote.version <= saved.version || remote.version < (observedVersion ?? 0)) {
            return conflict(observedVersion);
          }
          if (isCurrentScope(scope)) {
            const latest = resolveRemoteAdvance(remote);
            if (latest === 'adopt') return { error: '画布版本冲突，请确认最新内容后重新生成' };
            if (latest === 'reload') return { error: '画布已被其它会话更新，已载入最新内容，请重新发起生成' };
            if (typeof latest !== 'object') return conflict();
            reconcile(latest);
            cause = inferPersistCause(graph.nodes.length);
          } else {
            const base = saved.graph;
            const plan = planClipWriteRebase(base, remote, ws.id);
            if (!plan) return conflict();
            if (mode !== 'flush') {
              // The failed autosave no longer owns a live graph. Pass the Host
              // advance to the separately captured close flush in this queue.
              reconcile({ graph, saved: confirmedSnapshot(remote), clipWrite: { base, remote } });
              return switched();
            }
            const rebased = plan.apply(decision.snapshot);
            if (!rebased) return conflict();
            reconcile({ graph: rebased, saved: confirmedSnapshot(remote), clipWrite: { base, remote } });
          }
          const retry = decide(graph, cause);
          if (!retry.snapshot) {
            return retry.reason === 'unchanged'
              ? skipped('画布已同步剪辑更新，请确认后重新生成') : conflict();
          }
          if (isCurrentScope(scope)) setStatus('saving');
          result = await put(retry.snapshot);
          if (result.status === 409) return conflict(result.body.current);
        }
        if (!result.ok || result.body.workspace?.id !== ws.id) {
          if (isCurrentScope(scope)) setStatus(conflictRef.current ? 'conflict' : 'error');
          return { error: result.body.message ?? '画布保存失败，请重试', saved: { ...saved, clipWrites } };
        }
        return complete(result.body.workspace);
      } catch {
        if (!isCurrentScope(scope)) return { error: '画布已切换，请重新发起生成', saved: { ...saved, clipWrites } };
        setStatus(conflictRef.current ? 'conflict' : 'error');
        return { error: '画布保存失败，请重试', saved: { ...saved, clipWrites } };
      }
    })();
    savingRef.current = pending;
    void pending.then(() => {
      if (savingRef.current === pending) savingRef.current = null;
    });
    return pending;
  }, [armAutosave, clearAutosaveTimer, rememberSaved, resolveRemoteAdvance]);
  // armAutosave / 冲突恢复都要能在 performSave 之外排程同一份保存逻辑。
  performSaveRef.current = performSave;

  // Core subscription: debounce store changes, skip no-op notifications.
  // hydrate 完成前不订阅。
  useEffect(() => {
    if (!enabled) return;
    const evaluate = () => {
      if (!workspaceRef.current || !isCurrentScope(scopeRef.current)) return;
      const capture = readStoreCapture();
      const sig = graphSig(capture.nodes, capture.edges);
      const dirty = sig !== lastSavedRef.current.signature;
      setIsDirty(dirty);
      if (conflictRef.current) return;
      if (!dirty) {
        clearAutosaveTimer();
        setStatus((prev) => (prev === 'pending' ? 'idle' : prev));
        return;
      }
      const inferred = inferPersistCause(capture.nodes.length);
      if (
        !shouldPersistEmptyGraph({
          lastSavedNodeCount: lastSavedRef.current.nodeCount,
          nextNodeCount: capture.nodes.length,
          cause: inferred,
        })
      ) {
        // 从有节点跳到 0 但不是 user-delete：跳过，不要 debounce 存空
        clearAutosaveTimer();
        setIsDirty(false);
        setStatus((prev) => (prev === 'pending' ? 'idle' : prev));
        return;
      }
      setStatus((prev) => (prev === 'saving' || prev === 'conflict' ? prev : 'pending'));
      armAutosave(capture, inferred);
    };

    const unsubscribe = useCanvasStore.subscribe(evaluate);
    return () => {
      unsubscribe();
      clearAutosaveTimer();
    };
  }, [armAutosave, clearAutosaveTimer, enabled]);

  // Best-effort flush on unmount / pagehide.
  // 先同步签名+拷贝，再交给 save（禁止 void performSave() 无快照）。
  useEffect(() => {
    if (!enabled) return;
    const flushIfDirty = () => {
      if (!enabledRef.current || peekGraphReset()) return;
      const ws = workspaceRef.current;
      if (!ws) return;
      const capture = readStoreCapture();
      const cause = inferPersistCause(capture.nodes.length);
      const decision = decidePersist({
        lastSavedNodeCount: lastSavedRef.current.nodeCount,
        nextNodes: capture.nodes,
        nextEdges: capture.edges,
        cause,
        lastSavedSignature: savingRef.current ? '' : lastSavedRef.current.signature,
        nextSignature: graphSig(capture.nodes, capture.edges),
      });
      if (!decision.snapshot) return;
      void performSave(decision.snapshot, cause, 'flush');
    };
    window.addEventListener('pagehide', flushIfDirty);
    return () => {
      window.removeEventListener('pagehide', flushIfDirty);
      flushIfDirty();
      clearSavedBadgeTimer();
    };
  }, [performSave, enabled]);

  const saveNow = useCallback(async (): Promise<number> => {
    clearAutosaveTimer();
    const scope = scopeRef.current;
    const capture = readStoreCapture();
    const signature = graphSig(capture.nodes, capture.edges);
    const assertCurrent = () => {
      if (isCurrentScope(scope)) {
        const current = readStoreCapture();
        if (graphSig(current.nodes, current.edges) === signature) return;
      }
      throw new Error('保存期间输入已变化，请确认内容后重新生成');
    };
    // An autosave may have captured an older graph. Wait for it before saving
    // this click's snapshot, and never submit if that snapshot has changed.
    if (savingRef.current) {
      const previous = await savingRef.current;
      if ('error' in previous) throw new Error(previous.error);
    }
    assertCurrent();
    const result = await performSave(capture, inferPersistCause(capture.nodes.length), 'preflight');
    if ('error' in result) throw new Error(result.error);
    assertCurrent();
    return result.version;
  }, [clearAutosaveTimer, performSave]);

  /**
   * 必须同步：先读 store 再交给 PUT。调用方保证发生在 resetStore() 之前。
   */
  const flushPendingSave = useCallback(() => {
    clearAutosaveTimer();
    const ws = workspaceRef.current;
    if (!ws || peekGraphReset()) return;
    const capture = readStoreCapture();
    const cause = inferPersistCause(capture.nodes.length);
    const decision = decidePersist({
      lastSavedNodeCount: lastSavedRef.current.nodeCount,
      nextNodes: capture.nodes,
      nextEdges: capture.edges,
      cause,
      // Even a clean capture may undo another graph already in flight.
      lastSavedSignature: savingRef.current ? '' : lastSavedRef.current.signature,
      nextSignature: graphSig(capture.nodes, capture.edges),
    });
    if (!decision.snapshot) return;
    void performSave(decision.snapshot, cause, 'flush');
  }, [clearAutosaveTimer, performSave]);

  const resolveConflict = useCallback(async () => {
    clearAutosaveTimer();
    const capture = readStoreCapture();
    await performSave(capture, inferPersistCause(capture.nodes.length), 'keep-local');
  }, [clearAutosaveTimer, performSave]);

  const reloadFromServer = useCallback(async () => {
    const ws = workspaceRef.current;
    const scope = scopeRef.current;
    if (!ws) return;
    clearAutosaveTimer();
    try {
      if (savingRef.current) await savingRef.current;
      if (!isCurrentScope(scope)) return;
      const latest = await getWorkspace(ws.id);
      if (!isCurrentScope(scope)) return;
      const snapshot = latest.body.workspace;
      if (!latest.ok || snapshot?.id !== ws.id || snapshot.version < serverVersionRef.current) {
        setStatus(conflictRef.current ? 'conflict' : 'error');
        return;
      }
      conflictRef.current = false;
      const saved = confirmedSnapshot(snapshot);
      rememberSaved(saved);
      useCanvasStore.getState().hydrateGraph(snapshot.nodes, snapshot.edges);
      setIsDirty(false);
      setStatus('idle');
      onSavedRef.current?.(snapshot);
    } catch {
      if (isCurrentScope(scope)) setStatus(conflictRef.current ? 'conflict' : 'error');
    }
  }, [clearAutosaveTimer, rememberSaved]);

  // PR3 external-edit watcher: agent tools bump version without this window
  // noticing. Poll /version while visible; same-graph advances adopt the
  // remote version, clean local reloads, only a real split surfaces conflict.
  useEffect(() => {
    if (!enabled) return;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      if (!enabledRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const ws = workspaceRef.current;
      const scope = scopeRef.current;
      if (!ws || savingRef.current || conflictRef.current) return;
      inFlight = true;
      try {
        const probe = await getWorkspaceVersion(ws.id);
        if (!isCurrentScope(scope)) return;
        // 两次 await 期间可能有自己的保存开始/完成：它已经处理过版本，
        // 这里再判会用旧快照覆盖新版本。
        if (savingRef.current || conflictRef.current) return;
        if (!probe.ok || typeof probe.body.version !== 'number') return;
        if (probe.body.version <= serverVersionRef.current) return;
        const latest = await getWorkspace(ws.id);
        if (!isCurrentScope(scope) || savingRef.current || conflictRef.current) return;
        if (!latest.ok || !latest.body.workspace) {
          setStatus('error');
          return;
        }
        const decision = resolveRemoteAdvance(latest.body.workspace);
        // Issue #3595: a version-only advance still needs the local save.
        if (typeof decision === 'object' && !decision.clipWrite && !timerRef.current) {
          armAutosave(decision.graph, inferPersistCause(decision.graph.nodes.length));
        }
      } catch {
        // Probe failures are silent — the next tick retries.
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, EXTERNAL_WATCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [armAutosave, enabled, resolveRemoteAdvance]);

  return { status, isDirty, saveNow, flushPendingSave, resolveConflict, reloadFromServer };
}
