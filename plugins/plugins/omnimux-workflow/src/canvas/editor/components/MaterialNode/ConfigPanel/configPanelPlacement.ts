/**
 * configPanelPlacement — 纯几何碰撞测算与底部停靠布局计算（Issue #111 P3）。
 *
 * 将「贴卡 vs 底部停靠」决策、停靠限高、画布底部预留区高度以及单次防裁切平移
 * 从 DOM/React 生命周期中拆出为纯函数，便于单测全路径覆盖与回归证伪。
 */

export const CONFIG_PANEL_POSITION_EVENT = 'omnimux:config-panel-position';
export const CONFIG_PANEL_GAP = 8;
export const CONFIG_PANEL_MIN_DOCK_HEIGHT = 128;
export const CONFIG_PANEL_ANCHOR_OFFSET = 12;
export const CONFIG_PANEL_CLICK_TARGET_OFFSET = 14;

export type ConfigPanelPlacementMode = 'anchor' | 'dock';

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface VisibleNodeRects {
  id: string;
  body: RectLike;
  head?: RectLike | null;
}

export interface PlacementModeInput {
  bounds: RectLike;
  ownerId: string;
  ownerCard: RectLike;
  anchorBaseBottom?: number;
  zoom: number;
  preferredWidth: number;
  naturalHeight: number;
  toolbarRect?: RectLike | null;
  overlayRects: readonly RectLike[];
  otherNodes: readonly VisibleNodeRects[];
}

export interface PlacementModeDecision {
  mode: ConfigPanelPlacementMode;
  availableWidth: number;
  center: number;
  idealLeft: number;
  anchorTop: number;
  proposed: RectLike;
  conflicts: readonly VisibleNodeRects[];
  outside: boolean;
  hitsOverlay: boolean;
}

export interface DockLimitInput {
  bounds: RectLike;
  ownerId: string;
  ownerCard: RectLike;
  ownerHeader?: RectLike | null;
  availableWidth: number;
  center: number;
  toolbarRect?: RectLike | null;
  otherNodes: readonly VisibleNodeRects[];
  conflicts: readonly VisibleNodeRects[];
}

export interface DockLimitResult {
  maxHeight: number;
  lastTargetY: number;
  visibleTargets: readonly {
    id: string;
    body: RectLike;
    head?: RectLike | null;
    top: number;
  }[];
}

export interface DockFinalizeInput {
  bounds: RectLike;
  ownerCard: RectLike;
  ownerHeader?: RectLike | null;
  availableWidth: number;
  fittedHeight: number;
  toolbarRect?: RectLike | null;
  overlayRects: readonly RectLike[];
  visibleTargets: DockLimitResult['visibleTargets'];
  lastTargetY: number;
  initialPlacement: boolean;
  allowAutoPan: boolean;
}

export interface DockFinalizeResult {
  left: number;
  top: number;
  shelfTop: number;
  cut: number;
  reserve: number;
  correctivePanY: number;
}

export function rectsIntersect(a: RectLike, b: RectLike): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

export function clampNumber(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

function hasPositiveArea(rect: RectLike | null | undefined): rect is RectLike {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

/**
 * 测算配置面板处于自然贴卡高度时是否与相邻节点、画布边界或悬浮控件（含底部工具栏）碰撞。
 */
export function evaluateConfigPanelMode(input: PlacementModeInput): PlacementModeDecision {
  const {
    bounds,
    ownerCard,
    anchorBaseBottom = ownerCard.bottom,
    zoom,
    preferredWidth,
    naturalHeight,
    toolbarRect,
    overlayRects,
    otherNodes,
  } = input;

  const availableWidth = Math.max(0, Math.min(preferredWidth, bounds.width - 2 * CONFIG_PANEL_GAP));
  const center = (ownerCard.left + ownerCard.right) / 2;
  const idealLeft = center - availableWidth / 2;
  const anchorTop = anchorBaseBottom + CONFIG_PANEL_ANCHOR_OFFSET * zoom;
  const proposed: RectLike = {
    left: idealLeft,
    top: anchorTop,
    right: idealLeft + availableWidth,
    bottom: anchorTop + naturalHeight,
    width: availableWidth,
    height: naturalHeight,
  };

  const conflicts = otherNodes.filter(
    ({ body, head }) => rectsIntersect(proposed, body) || Boolean(head && rectsIntersect(proposed, head)),
  );
  const outside =
    proposed.left < bounds.left + CONFIG_PANEL_GAP ||
    proposed.right > bounds.right - CONFIG_PANEL_GAP ||
    proposed.top < bounds.top + CONFIG_PANEL_GAP ||
    proposed.bottom > bounds.bottom - CONFIG_PANEL_GAP;

  const blockers: RectLike[] = [];
  if (hasPositiveArea(toolbarRect)) blockers.push(toolbarRect);
  for (const overlay of overlayRects) {
    if (hasPositiveArea(overlay)) blockers.push(overlay);
  }
  const hitsOverlay = blockers.some((rect) => rectsIntersect(proposed, rect));

  const mode: ConfigPanelPlacementMode =
    conflicts.length > 0 || outside || hitsOverlay ? 'dock' : 'anchor';

  return {
    mode,
    availableWidth,
    center,
    idealLeft,
    anchorTop,
    proposed,
    conflicts,
    outside,
    hitsOverlay,
  };
}

/**
 * 计算停靠态下的面板最大高度，保证受影响相邻节点的标题和卡片上沿 14px 点击区保持可点。
 */
export function computeDockHeightLimit(input: DockLimitInput): DockLimitResult {
  const {
    bounds,
    ownerId,
    ownerCard,
    ownerHeader,
    availableWidth,
    center,
    toolbarRect,
    otherNodes,
    conflicts,
  } = input;

  const conflictIds = new Set(conflicts.map((entry) => entry.id));
  const ownerEntry = {
    id: ownerId,
    body: ownerCard,
    head: ownerHeader ?? null,
    top: Math.min(ownerHeader?.top ?? ownerCard.top, ownerCard.top),
  };

  const relatedOthers = otherNodes
    .filter(
      ({ id, body }) =>
        conflictIds.has(id) ||
        (body.left < center + availableWidth / 2 && body.right > center - availableWidth / 2),
    )
    .map(({ id, body, head }) => ({
      id,
      body,
      head: head ?? null,
      top: Math.min(head?.top ?? body.top, body.top),
    }));

  const visibleTargets = [
    ownerEntry,
    ...relatedOthers.filter(
      ({ body, head }) =>
        body.top >= bounds.top &&
        body.top + CONFIG_PANEL_CLICK_TARGET_OFFSET < bounds.bottom &&
        (!head || head.top >= bounds.top),
    ),
  ];

  const lastTargetY = Math.max(
    ownerCard.top + CONFIG_PANEL_CLICK_TARGET_OFFSET,
    ...visibleTargets.map(({ body }) => Math.min(body.bottom, body.top + CONFIG_PANEL_CLICK_TARGET_OFFSET)),
  );

  const toolbarTop = hasPositiveArea(toolbarRect) ? toolbarRect.top : bounds.bottom;
  const maxHeight = Math.floor(
    Math.max(CONFIG_PANEL_MIN_DOCK_HEIGHT, toolbarTop - 3 * CONFIG_PANEL_GAP - lastTargetY),
  );

  return { maxHeight, lastTargetY, visibleTargets };
}

/**
 * 计算停靠态最终定位、底部预留高度，以及在首次打开/内容增高时的单次防裁切平移量。
 */
export function finalizeDockPlacement(input: DockFinalizeInput): DockFinalizeResult {
  const {
    bounds,
    ownerCard,
    ownerHeader,
    availableWidth,
    fittedHeight,
    toolbarRect,
    overlayRects,
    visibleTargets,
    lastTargetY,
    initialPlacement,
    allowAutoPan,
  } = input;

  const toolbarTop = hasPositiveArea(toolbarRect) ? toolbarRect.top : bounds.bottom;
  const shelfTop = toolbarTop - CONFIG_PANEL_GAP - fittedHeight;
  const cut = shelfTop - CONFIG_PANEL_GAP;
  const reserve = Math.max(0, Math.ceil(bounds.bottom - cut));
  const left = (bounds.width - availableWidth) / 2;
  const top = shelfTop - bounds.top;

  let correctivePanY = 0;
  if (allowAutoPan) {
    const ownerTop = Math.min(ownerHeader?.top ?? ownerCard.top, ownerCard.top);
    const topmost = Math.min(ownerTop, ...visibleTargets.map((entry) => entry.top));
    const lowest = initialPlacement
      ? Math.max(
          ownerCard.bottom,
          ...visibleTargets.filter(({ body }) => body.top < cut).map(({ body }) => body.bottom),
        )
      : lastTargetY;

    const titleAllowance = visibleTargets.flatMap(({ head }) =>
      head
        ? overlayRects
            .filter(
              (region) =>
                hasPositiveArea(region) &&
                head.right > region.left &&
                head.left < region.right &&
                head.top > region.bottom,
            )
            .map((region) => region.bottom + 3 - head.top)
        : [],
    );

    const topAllowance = Math.min(0, Math.max(bounds.top + CONFIG_PANEL_GAP - topmost, ...titleAllowance));
    const delta = clampNumber(cut - CONFIG_PANEL_GAP - lowest, topAllowance, 0);
    if (delta < -0.5) {
      correctivePanY = delta;
    }
  }

  return { left, top, shelfTop, cut, reserve, correctivePanY };
}

/**
 * 贴卡态最终定位（相对 `.wf-canvas-editor` 左上角）。
 */
export function finalizeAnchorPlacement(
  bounds: RectLike,
  idealLeft: number,
  anchorTop: number,
  availableWidth: number,
): { left: number; top: number } {
  return {
    left: clampNumber(
      idealLeft - bounds.left,
      CONFIG_PANEL_GAP,
      Math.max(CONFIG_PANEL_GAP, bounds.width - availableWidth - CONFIG_PANEL_GAP),
    ),
    top: anchorTop - bounds.top,
  };
}
