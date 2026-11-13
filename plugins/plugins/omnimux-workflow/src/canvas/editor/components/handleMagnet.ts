/**
 * handleMagnet.ts —— 节点连接点加号按钮的磁吸跟随计算
 * 对齐 Gxgen `CanvasNodeHandle.tsx:37-39, :114-121`。
 *
 * 鼠标在加号点击区（72×64）内移动时，加号沿鼠标方向做受限偏移（磁吸手感），
 * 离开点击区或关闭菜单后回弹归零。
 */

export const HANDLE_INWARD_MAGNET_OFFSET = 4;
export const HANDLE_OUTWARD_MAGNET_OFFSET = 14;
export const HANDLE_VERTICAL_MAGNET_OFFSET = 14;

export interface HandleMagnetOffset {
  x: number;
  y: number;
}

/**
 * 将指针相对于点击区中心的 raw 偏移 clamp 到受限范围。
 *
 * @param side 'left'（输入柄）| 'right'（输出柄）
 * @param rawOffsetX 指针 X - 表面中心 X
 * @param rawOffsetY 指针 Y - 表面中心 Y
 */
export function clampHandleMagnetOffset(
  side: 'left' | 'right',
  rawOffsetX: number,
  rawOffsetY: number,
): HandleMagnetOffset {
  const isLeft = side === 'left';
  const x = isLeft
    ? Math.max(-HANDLE_OUTWARD_MAGNET_OFFSET, Math.min(HANDLE_INWARD_MAGNET_OFFSET, rawOffsetX))
    : Math.max(-HANDLE_INWARD_MAGNET_OFFSET, Math.min(HANDLE_OUTWARD_MAGNET_OFFSET, rawOffsetX));

  const y = Math.max(
    -HANDLE_VERTICAL_MAGNET_OFFSET,
    Math.min(HANDLE_VERTICAL_MAGNET_OFFSET, rawOffsetY),
  );

  return { x, y };
}
