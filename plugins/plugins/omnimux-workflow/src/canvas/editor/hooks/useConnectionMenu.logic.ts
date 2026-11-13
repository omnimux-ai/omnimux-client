/**
 * W3 (T3.4): connection-release outcome resolution — pure logic extracted
 * from useConnectionMenu so node:test can cover the three branches
 * without a React environment.
 *
 * Three branches (plan pit #7 — the menu branch is inserted ONLY into the
 * blank-drop path and must not overlap the existing rejection toast):
 * 1. isValid → normal connect (handled by onConnect / mutation gateway)
 * 2. dropped on a node but rejected → keep the existing message.warning
 * 3. blank drop (no toNode) from a source handle with available output
 *    options → show the action menu
 */

export type ConnectionEndOutcome =
  | { type: 'connected' }
  | { type: 'menu' }
  | { type: 'reject'; reason: string }
  | { type: 'noop' };

export interface ConnectionEndOutcomeInput {
  /** connectionState.isValid（xyflow FinalConnectionState） */
  isValid: boolean | null;
  fromNodeId: string | null;
  toNodeId: string | null;
  /** onConnectStart 记录到 source 把手拖出 */
  startedFromSource: boolean;
  /** 源节点有可派生的输出动作选项 */
  hasOptions: boolean;
  /** toNode 存在时 validateConnectionDetailed 的拒绝原因（null = 无提示） */
  rejectReason: string | null;
}

export function resolveConnectionEndOutcome(
  input: ConnectionEndOutcomeInput,
): ConnectionEndOutcome {
  if (input.isValid) return { type: 'connected' };
  if (!input.fromNodeId) return { type: 'noop' };

  // 分支 2：落在已有节点上但校验被拒 → 保留现有拒绝提示
  if (input.toNodeId) {
    return input.rejectReason ? { type: 'reject', reason: input.rejectReason } : { type: 'noop' };
  }

  // 分支 3：空白释放 + source 拖出 + 有选项 → 弹动作菜单
  if (input.startedFromSource && input.hasOptions) return { type: 'menu' };

  return { type: 'noop' };
}
