/**
   * 画布持久化策略（纯函数 + 会话标记）。
   *
   * 根因：boot cleanup `resetStore()` 把 zustand 清成 `nodes: []` 后，
   * 未完成的 `performSave` / unmount `flushIfDirty` 再读 store，会 PUT 空图盖盘。
   * 本模块保证：
   * 1. 保存决策瞬间拷贝图，后续只用这份快照（禁止 await 后再读 store）；
   * 2. 未观察到用户删光时，禁止把非空图覆盖成空。
   */

export type PersistCause = 'user-delete' | 'reset' | 'flush' | 'autosave';

export interface PersistEmptyGraphInput {
  lastSavedNodeCount: number;
  nextNodeCount: number;
  cause: PersistCause;
}

export interface GraphSnapshot<N = unknown, E = unknown> {
  nodes: N[];
  edges: E[];
}

export interface PersistDecisionInput<N = unknown, E = unknown> {
  lastSavedNodeCount: number;
  nextNodes: N[];
  nextEdges: E[];
  cause: PersistCause;
  lastSavedSignature: string;
  nextSignature: string;
}

export interface PersistDecision<N = unknown, E = unknown> {
  persist: boolean;
  reason: 'unchanged' | 'skip-empty-overwrite' | 'save';
  snapshot: GraphSnapshot<N, E> | null;
}

/** 会话内：用户经 deleteElements / removeNodeIds / 键盘删除动过节点。 */
let userDeletedGraphElements = false;
/** 会话内：刚发生过 resetStore 清空（非用户删图）。 */
let graphWasReset = false;

export function noteUserDeletedGraphElements(): void {
  userDeletedGraphElements = true;
}

export function noteGraphReset(): void {
  graphWasReset = true;
  // reset 不是用户删光，清掉 user-delete，避免把 boot 清空误判成可存空
  userDeletedGraphElements = false;
}

export function clearPersistSessionFlags(): void {
  userDeletedGraphElements = false;
  graphWasReset = false;
}

export function peekUserDeletedGraphElements(): boolean {
  return userDeletedGraphElements;
}

export function peekGraphReset(): boolean {
  return graphWasReset;
}

/** 跳过空覆盖后消费 reset 标记，避免一直卡在 reset。 */
export function consumeGraphReset(): void {
  graphWasReset = false;
}

/**
 * lastSavedNodeCount > 0 且 next 为 0 且不是用户删光 → 禁止 PUT 空图。
 * 用户在本会话删光（cause === 'user-delete'）才允许存空。
 */
export function shouldPersistEmptyGraph(input: PersistEmptyGraphInput): boolean {
  if (input.lastSavedNodeCount > 0 && input.nextNodeCount === 0 && input.cause !== 'user-delete') {
    return false;
  }
  return true;
}

/** 决定瞬间的浅拷贝；调用方必须在读 store 的同一同步栈里调用。 */
export function snapshotGraph<N, E>(nodes: N[], edges: E[]): GraphSnapshot<N, E> {
  return {
    nodes: nodes.slice(),
    edges: edges.slice(),
  };
}

export function inferPersistCause(nextNodeCount: number, explicit?: PersistCause): PersistCause {
  if (explicit) return explicit;
  if (graphWasReset && nextNodeCount === 0) return 'reset';
  if (userDeletedGraphElements && nextNodeCount === 0) return 'user-delete';
  return 'autosave';
}

export function decidePersist<N, E>(input: PersistDecisionInput<N, E>): PersistDecision<N, E> {
  const snapshot = snapshotGraph(input.nextNodes, input.nextEdges);
  if (input.nextSignature === input.lastSavedSignature) {
    return { persist: false, reason: 'unchanged', snapshot: null };
  }
  if (
    !shouldPersistEmptyGraph({
      lastSavedNodeCount: input.lastSavedNodeCount,
      nextNodeCount: input.nextNodes.length,
      cause: input.cause,
    })
  ) {
    consumeGraphReset();
    return { persist: false, reason: 'skip-empty-overwrite', snapshot: null };
  }
  return { persist: true, reason: 'save', snapshot };
}

/** 只在 decision.persist 时把快照交给 save（模拟 PUT，不回读 store）。 */
export function applyPersistDecision<N, E>(
  decision: PersistDecision<N, E>,
  save: (snapshot: GraphSnapshot<N, E>) => void,
): boolean {
  if (!decision.persist || !decision.snapshot) return false;
  save(decision.snapshot);
  return true;
}
