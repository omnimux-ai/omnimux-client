/**
 * ConfigPanelShell — 单层一体化浮层外壳（Issue #111 P3 动态避让与底部停靠）。
 *
 * 正常运行时通过 Portal 挂载到 `.wf-canvas-editor`（与 ReactFlow 同处 `.wf-canvas-root`，
 * 天然继承浅/暗双主题语义 Token 且无需反缩放失真）：
 * 1. 空间充足时贴合节点卡片下方；
 * 2. 打开配置或同一次选中内参数/卡槽变化导致内容高度改变时，实时按实际内容高度测算碰撞；
 * 3. 与相邻节点卡片/标题、画布边界或底部悬浮工具栏等浮层碰撞时，自动移入画布底部预留停靠区；
 * 4. 空间恢复时自动回归贴卡与完整画布高度；连续平移/拖拽手势期间锁定当前布局模式；
 * 5. 无 `.wf-canvas-editor` 容器的隔离单测/SSR 环境回退到内联渲染。
 */

import React, { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow, useViewport } from '@xyflow/react';
import { inverseScaleForZoom } from '../../../utils/nodeVisualMath';
import {
  CONFIG_PANEL_POSITION_EVENT,
  computeDockHeightLimit,
  evaluateConfigPanelMode,
  finalizeAnchorPlacement,
  finalizeDockPlacement,
  rectsIntersect,
  type ConfigPanelPlacementMode,
  type RectLike,
  type VisibleNodeRects,
} from './configPanelPlacement';

export interface ConfigPanelShellProps {
  children: React.ReactNode;
  /** 面板首选宽度（屏幕 CSS 像素） */
  width?: number;
}

const DEFAULT_WIDTH = 480;
const OVERLAY_SELECTOR =
  '.wf-page-header-controls, .wf-header-controls, .wf-minimap-popover, .wf-floating-selection-bar';
const NON_CANVAS_GESTURE_SELECTOR =
  '.wf-panel-shell, .wf-cfg-popover, .wf-video-param-popover, .wf-cascade-popover, .wf-custom-select-dropdown, .wf-canvas-toolbar, .wf-header-controls, .wf-page-header-controls';

function toRectLike(rect: DOMRect): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function collectVisibleOtherNodes(
  host: HTMLElement,
  owner: Element,
  bounds: RectLike,
): VisibleNodeRects[] {
  const result: VisibleNodeRects[] = [];
  for (const node of host.querySelectorAll('.react-flow__node')) {
    if (node === owner) continue;
    const bodyEl = node.querySelector('.wf-material-node__card') ?? node;
    const body = toRectLike(bodyEl.getBoundingClientRect());
    const headEl = node.querySelector('.wf-node-header');
    const head = headEl ? toRectLike(headEl.getBoundingClientRect()) : null;
    if (body.width <= 0 || body.height <= 0) continue;
    if (!rectsIntersect(bounds, body) && !(head && rectsIntersect(bounds, head))) continue;
    result.push({
      id: node.getAttribute('data-id') || '',
      body,
      head,
    });
  }
  return result;
}

function collectOverlayRects(host: HTMLElement): RectLike[] {
  return Array.from(host.querySelectorAll(OVERLAY_SELECTOR), (el) =>
    toRectLike(el.getBoundingClientRect()),
  );
}

const ConfigPanelShell: React.FC<ConfigPanelShellProps> = ({
  children,
  width = DEFAULT_WIDTH,
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const counterScale = useMemo(() => inverseScaleForZoom(zoom), [zoom]);

  useLayoutEffect(() => {
    const editorHost = anchorRef.current?.closest('.wf-canvas-editor') as HTMLElement | null;
    setHost(editorHost ?? null);
  }, []);

  useLayoutEffect(() => {
    if (!host) return;
    const panel = shellRef.current;
    const owner = anchorRef.current?.closest('.react-flow__node');
    if (!panel || !owner) return;

    const ownerId = owner.getAttribute('data-id') || '';
    panel.dataset.owner = ownerId;

    let mode: ConfigPanelPlacementMode = 'anchor';
    let hasPlacedPanel = false;
    let previousGeometry = '';
    let previousHeight = -1;
    let previousPosition = '';
    let contentChanged = true;
    let didPan = false;
    let userViewportMoved = false;
    let pointerIsDown = false;
    let gestureStartViewport: { x: number; y: number; zoom: number } | null = null;
    let wheelUntil = 0;
    let frame = 0;
    let pendingPanTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const innerCard = panel.firstElementChild as HTMLElement | null;
    const contentObserver = new MutationObserver(() => {
      contentChanged = true;
    });
    if (innerCard) {
      contentObserver.observe(innerCard, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style', 'data-preset', 'data-effective-ops'],
      });
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && innerCard
        ? new ResizeObserver(() => {
            contentChanged = true;
          })
        : null;
    if (resizeObserver && innerCard) {
      resizeObserver.observe(innerCard);
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !host.contains(target)) return;
      if (target.closest(NON_CANVAS_GESTURE_SELECTOR)) return;
      pointerIsDown = true;
      gestureStartViewport = flow.getViewport();
    };

    const handlePointerRelease = () => {
      if (pointerIsDown && gestureStartViewport) {
        const current = flow.getViewport();
        if (
          Math.abs(current.x - gestureStartViewport.x) > 0.5 ||
          Math.abs(current.y - gestureStartViewport.y) > 0.5 ||
          Math.abs(current.zoom - gestureStartViewport.zoom) > 0.001
        ) {
          userViewportMoved = true;
        }
      }
      pointerIsDown = false;
      gestureStartViewport = null;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.nodrag, .nowheel')) return;
      wheelUntil = performance.now() + 150;
      userViewportMoved = true;
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerRelease, true);
    window.addEventListener('pointercancel', handlePointerRelease, true);
    window.addEventListener('blur', handlePointerRelease);
    host.addEventListener('wheel', handleWheel, { passive: true, capture: true });

    const align = () => {
      const cardEl = owner.querySelector('.wf-material-node__card') ?? owner;
      const headEl = owner.querySelector('.wf-node-header');
      const capabilityEl = owner.querySelector('.wf-material-node__capability');
      const toolbarEl = host.querySelector('.wf-canvas-toolbar');

      const viewport = flow.getViewport();
      const bounds = toRectLike(host.getBoundingClientRect());
      const ownerCard = toRectLike(cardEl.getBoundingClientRect());
      const ownerHeader = headEl ? toRectLike(headEl.getBoundingClientRect()) : null;
      const capabilityRect = capabilityEl ? toRectLike(capabilityEl.getBoundingClientRect()) : null;
      const toolbarRect = toolbarEl ? toRectLike(toolbarEl.getBoundingClientRect()) : null;
      const anchorBaseBottom = Math.max(ownerCard.bottom, capabilityRect?.bottom ?? ownerCard.bottom);

      const availableWidth = Math.max(0, Math.min(width, bounds.width - 16));
      if (panel.style.width !== `${availableWidth}px`) {
        panel.style.width = `${availableWidth}px`;
      }

      const geometry = [
        Math.round(bounds.width),
        Math.round(bounds.height),
        viewport.zoom.toFixed(4),
        Math.round(ownerCard.left),
        Math.round(ownerCard.top),
        Math.round(ownerCard.width),
        Math.round(ownerCard.height),
        Math.round(anchorBaseBottom),
        toolbarRect ? `${Math.round(toolbarRect.top)}:${Math.round(toolbarRect.width)}` : 'none',
      ].join(',');

      const frozen = pointerIsDown || performance.now() < wheelUntil;
      const currentHeight = panel.offsetHeight;
      const layoutChanged =
        contentChanged || geometry !== previousGeometry || currentHeight !== previousHeight;
      const initialPlacement = !hasPlacedPanel;
      const wasDocked = mode === 'dock';
      let checkedPlacement = false;
      let conflicts: readonly VisibleNodeRects[] = [];
      let otherNodes: VisibleNodeRects[] = [];
      let overlays: RectLike[] = [];

      if (!frozen && layoutChanged) {
        contentChanged = false;
        previousGeometry = geometry;

        // 先在自然贴卡布局下量取实际内容高度，避免受停靠紧凑布局影响
        panel.dataset.placement = 'anchor';
        panel.removeAttribute('data-compact-slots');
        panel.style.removeProperty('--wf-config-panel-limit');
        const naturalHeight = panel.getBoundingClientRect().height;

        otherNodes = collectVisibleOtherNodes(host, owner, bounds);
        overlays = collectOverlayRects(host);
        const decision = evaluateConfigPanelMode({
          bounds,
          ownerId,
          ownerCard,
          anchorBaseBottom,
          zoom: viewport.zoom,
          preferredWidth: width,
          naturalHeight,
          toolbarRect,
          overlayRects: overlays,
          otherNodes,
        });

        mode = decision.mode;
        conflicts = decision.conflicts;
        panel.dataset.placement = mode;
        hasPlacedPanel = true;
        checkedPlacement = true;
      }

      if (mode === 'dock') {
        if (checkedPlacement) {
          const header = panel.querySelector('.wf-config-panel__prompt-header');
          const strip = header?.querySelector(':scope > .wf-slot-wells[data-preset="strip"]');
          const hasExtraInputGroups = Boolean(
            header?.querySelector('[data-testid="wf-document-inputs"], [data-testid="wf-text-inputs"]'),
          );
          panel.toggleAttribute(
            'data-compact-slots',
            Boolean(
              strip &&
                !hasExtraInputGroups &&
                strip.children.length <= 2 &&
                header?.children.length === 2,
            ),
          );

          const dockLimit = computeDockHeightLimit({
            bounds,
            ownerId,
            ownerCard,
            ownerHeader,
            availableWidth,
            center: (ownerCard.left + ownerCard.right) / 2,
            toolbarRect,
            otherNodes,
            conflicts,
          });

          panel.style.setProperty('--wf-config-panel-limit', `${dockLimit.maxHeight}px`);
          const fittedHeight = panel.offsetHeight;
          const allowAutoPan =
            !didPan && !userViewportMoved && (!wasDocked || fittedHeight > previousHeight);

          const dockFinal = finalizeDockPlacement({
            bounds,
            ownerCard,
            ownerHeader,
            availableWidth,
            fittedHeight,
            toolbarRect,
            overlayRects: overlays,
            visibleTargets: dockLimit.visibleTargets,
            lastTargetY: dockLimit.lastTargetY,
            initialPlacement,
            allowAutoPan,
          });

          if (dockFinal.correctivePanY < -0.5) {
            didPan = true;
            const panDeltaY = dockFinal.correctivePanY;
            if (pendingPanTimer !== null) clearTimeout(pendingPanTimer);
            // 推迟到当前点击的 mouseup/click 结算后再平移，避免 mousedown 挂载时把刚点中的节点移离指针下方导致误失选
            pendingPanTimer = setTimeout(() => {
              pendingPanTimer = null;
              if (disposed || pointerIsDown || userViewportMoved) return;
              const liveViewport = flow.getViewport();
              void flow.setViewport({
                x: liveViewport.x,
                y: liveViewport.y + panDeltaY,
                zoom: liveViewport.zoom,
              });
            }, 60);
          }

          panel.style.left = `${dockFinal.left}px`;
          panel.style.top = `${dockFinal.top}px`;
          host.style.setProperty('--wf-config-dock-reserve', `${dockFinal.reserve}px`);
          host.dataset.configPanelPlacement = 'dock';
        } else {
          const fittedHeight = panel.offsetHeight;
          const toolbarTop = toolbarRect && toolbarRect.height > 0 ? toolbarRect.top : bounds.bottom;
          const shelfTop = toolbarTop - 8 - fittedHeight;
          const cut = shelfTop - 8;
          panel.style.left = `${(bounds.width - availableWidth) / 2}px`;
          panel.style.top = `${shelfTop - bounds.top}px`;
          host.style.setProperty('--wf-config-dock-reserve', `${Math.max(0, Math.ceil(bounds.bottom - cut))}px`);
          host.dataset.configPanelPlacement = 'dock';
        }
      } else {
        const center = (ownerCard.left + ownerCard.right) / 2;
        const anchorPos = finalizeAnchorPlacement(
          bounds,
          center - availableWidth / 2,
          anchorBaseBottom + 12 * viewport.zoom,
          availableWidth,
        );
        panel.style.left = `${anchorPos.left}px`;
        panel.style.top = `${anchorPos.top}px`;
        host.style.removeProperty('--wf-config-dock-reserve');
        host.dataset.configPanelPlacement = 'anchor';
      }

      if (!frozen) {
        previousHeight = panel.offsetHeight;
      }

      if (panel.style.visibility !== 'visible') {
        panel.style.visibility = 'visible';
      }

      const positionSignature = `${mode},${panel.style.left},${panel.style.top},${panel.style.width},${panel.offsetHeight}`;
      if (positionSignature !== previousPosition) {
        previousPosition = positionSignature;
        window.dispatchEvent(new Event(CONFIG_PANEL_POSITION_EVENT));
      }

      frame = requestAnimationFrame(align);
    };

    align();

    return () => {
      disposed = true;
      if (pendingPanTimer !== null) {
        clearTimeout(pendingPanTimer);
        pendingPanTimer = null;
      }
      cancelAnimationFrame(frame);
      contentObserver.disconnect();
      resizeObserver?.disconnect();
      host.style.removeProperty('--wf-config-dock-reserve');
      delete host.dataset.configPanelPlacement;
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerRelease, true);
      window.removeEventListener('pointercancel', handlePointerRelease, true);
      window.removeEventListener('blur', handlePointerRelease);
      host.removeEventListener('wheel', handleWheel, true);
    };
  }, [host, width, flow]);

  // 隔离单测/SSR 无 .wf-canvas-editor 容器时回退到节点内联贴卡渲染
  if (!host) {
    return (
      <>
        <span ref={anchorRef} className="wf-panel-anchor" aria-hidden="true" />
        <div
          className="wf-panel-shell nodrag nowheel"
          data-placement="anchor"
          style={{
            width,
            top: 'calc(100% + 12px)',
            left: '50%',
            marginLeft: -width / 2,
            transform: `scale(${counterScale})`,
            transformOrigin: 'top center',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wf-panel-shell__card">{children}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <span ref={anchorRef} className="wf-panel-anchor" aria-hidden="true" />
      {createPortal(
        <div
          ref={shellRef}
          className="wf-panel-shell wf-panel-shell--floating nodrag nowheel nopan"
          style={{ width, visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wf-panel-shell__card">{children}</div>
        </div>,
        host,
      )}
    </>
  );
};

export default memo(ConfigPanelShell);
