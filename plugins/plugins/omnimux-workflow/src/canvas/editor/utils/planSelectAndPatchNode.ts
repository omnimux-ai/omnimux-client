/**
 * 单选当前节点并合并 data 补丁（Issue #299）。
 *
 * 文本空态预设按钮带 nodrag + mousedown stopPropagation，
 * React Flow 收不到选中手势；配置底栏又要求 selected === true。
 * 预设 handler 自己走这套纯函数：只补丁目标节点 data，同时 exclusive select。
 */

export type PatchableCanvasNode = {
  id: string;
  selected?: boolean;
  data?: unknown;
};

/**
 * 返回新节点数组：目标节点 selected=true 且 data 合并 updates，
 * 其它节点 selected=false、data 保持引用。不修改入参数组。
 */
export function planSelectAndPatchNode<T extends PatchableCanvasNode>(
  nodes: readonly T[] | undefined,
  nodeId: string,
  dataUpdates: Record<string, unknown>,
): T[] {
  if (!Array.isArray(nodes) || !nodeId) {
    return Array.isArray(nodes) ? nodes.map((n) => n) : [];
  }
  return nodes.map((n) => {
    if (n.id !== nodeId) {
      return { ...n, selected: false };
    }
    const prevData =
      n.data && typeof n.data === 'object' && !Array.isArray(n.data)
        ? (n.data as Record<string, unknown>)
        : {};
    return {
      ...n,
      selected: true,
      data: { ...prevData, ...dataUpdates } as T['data'],
    };
  });
}
