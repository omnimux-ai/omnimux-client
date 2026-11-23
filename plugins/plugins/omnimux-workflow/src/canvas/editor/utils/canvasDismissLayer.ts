/**
 * canvasDismissLayer — 画布瞬态浮层全局逐层关闭协调器。
 *
 * 统一规范画布上所有「点击外部关闭 / Escape 关闭」的瞬态浮层与菜单：
 * 1. 空白面保护（One Gesture = One Layer Dismiss）：存在打开的浮层时，左键点击画布
 *    空白面（.react-flow__pane / .react-flow__background / 未折叠 .wf-group-node 底板）
 *    仅收起浮层并消费本次空白面指针手势，保持当前节点选中与 ConfigPanel 输入框面板可见；
 *    下一次点击空白面正常透传到 ReactFlow 取消选中。
 * 2. 非空白目标一次直达：点击提示词输入框、另一触发胶囊、生成按钮、其他节点、工具栏
 *    或画布外区域时，收起浮层但不阻断事件，消除全屏遮罩造成的双点税。
 * 3. Escape 严格 LIFO 逐层退栈：window 捕获阶段仅关闭栈顶单层并隔离传播，避免同一次
 *    Escape 顺带触发 useKeyboardShortcuts 清空画布选中或关闭外层抽屉/弹窗。
 * 4. 连点两下防误放大：空白点击收起浮层后的短窗口（500ms）内，抑制空白面 dblclick，
 *    避免用户快点两下（关菜单 + 取消选中）意外触发 d3-zoom 双击缩放。
 */

import { useEffect, useRef, type RefObject } from 'react';

export type CanvasDismissReason = 'outside-pointer' | 'escape';

export interface CanvasDismissLayerRegistration {
  /** 返回 true 表示事件目标归属本浮层（面板、触发器、子菜单等），不触发外部关闭。 */
  containsTarget: (target: Node) => boolean;
  /** 关闭回调。 */
  onDismiss: (reason: CanvasDismissReason) => void;
  /** 额外视为内部的选择器白名单（如浮层内打开的 .wf-custom-select-dropdown）。 */
  excludeSelectors?: readonly string[];
  /** 是否响应外部点击关闭（默认 true）。 */
  dismissOnOutsidePointerDown?: boolean;
  /** 是否在栈顶时响应 Escape 关闭（默认 true；false 表示由浮层自身接管 Escape）。 */
  dismissOnEscape?: boolean;
  /** 空白画布左键点击收起本浮层时，是否消费空白面手势以保留节点选中态（默认 true）。 */
  preserveCanvasSelectionOnBlankClick?: boolean;
  /** Escape 放行守卫：返回 false 时栈顶层让出本次 Escape（如内部正处于内联重命名输入框），且不穿透到下层。 */
  shouldHandleEscape?: (event: KeyboardEvent) => boolean;
}

export interface UseCanvasDismissLayerOptions extends CanvasDismissLayerRegistration {
  /** 浮层是否处于打开态。 */
  open: boolean;
  /** 延迟一帧注册（兼容 useClickOutside 的触发防抖语义，默认 false）。 */
  deferRegistration?: boolean;
  /** 经由 Escape 关闭时自动恢复焦点的触发器（鼠标点外部不主动聚焦，避免多余焦点环）。 */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

interface RegisteredLayerEntry {
  id: number;
  getSpec: () => CanvasDismissLayerRegistration;
}

interface SuppressedBlankGesture {
  pointerId: number | null;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
}

export interface CanvasDismissHostLike {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;
}

export interface CanvasDismissCoordinator {
  register: (getSpec: () => CanvasDismissLayerRegistration) => () => void;
  hasActiveLayers: () => boolean;
  getActiveLayerCount: () => number;
  destroy: () => void;
}

const DBLCLICK_SUPPRESS_WINDOW_MS = 500;
const POINTER_MOUSE_DEDUPE_MS = 80;
const POINTERUP_FALLBACK_CLEAR_MS = 80;

function toElement(target: EventTarget | null | undefined): Element | null {
  if (!target || typeof target !== 'object') return null;
  if (typeof (target as Element).closest === 'function') {
    return target as Element;
  }
  const parent = (target as { parentElement?: Element | null }).parentElement;
  return parent && typeof parent.closest === 'function' ? parent : null;
}

/**
 * 判断事件目标是否为画布空白背景面：
 * - `.react-flow__pane`（ReactFlow 空白画布承接层）
 * - `.react-flow__background`（点阵背景层）
 * - 未折叠的 `.wf-group-node` 自身底板（组内视觉空白区；折叠态分组是紧凑卡片胶囊，不视为背景）
 */
export function isCanvasBlankSurface(target: EventTarget | null | undefined): boolean {
  const el = toElement(target);
  if (!el) return false;
  if (el.classList?.contains('react-flow__pane') || el.classList?.contains('wf-canvas-editor')) return true;
  if (typeof el.closest === 'function' && el.closest('.react-flow__background')) return true;
  if (
    el.classList?.contains('wf-group-node')
    && !el.classList.contains('wf-group-node--collapsed')
  ) {
    return true;
  }
  return false;
}

function isTargetInsideSpec(
  spec: CanvasDismissLayerRegistration,
  target: EventTarget | null,
): boolean {
  if (!target) return false;
  if (spec.containsTarget(target as Node)) return true;
  const selectors = spec.excludeSelectors;
  if (selectors && selectors.length > 0) {
    const el = toElement(target);
    if (el && typeof el.closest === 'function') {
      for (const selector of selectors) {
        if (el.closest(selector)) return true;
      }
    }
  }
  return false;
}

export function createCanvasDismissCoordinator(options?: {
  host?: CanvasDismissHostLike | null;
  now?: () => number;
}): CanvasDismissCoordinator {
  const getNow = options?.now ?? (() => Date.now());
  const resolveHost = (): CanvasDismissHostLike | null => {
    if (options && 'host' in options) return options.host ?? null;
    return typeof window !== 'undefined' ? window : null;
  };

  let nextId = 1;
  let attachedHost: CanvasDismissHostLike | null = null;
  const layers: RegisteredLayerEntry[] = [];
  let suppressedGesture: SuppressedBlankGesture | null = null;
  let lastPointerDown: { at: number; target: EventTarget | null } | null = null;
  let lastBlankDismissAt = 0;

  const clearSuppressedGesture = (): void => {
    if (suppressedGesture?.fallbackTimer != null) {
      clearTimeout(suppressedGesture.fallbackTimer);
    }
    suppressedGesture = null;
  };

  const scheduleFallbackClear = (): void => {
    if (!suppressedGesture || suppressedGesture.fallbackTimer != null) return;
    suppressedGesture.fallbackTimer = setTimeout(
      clearSuppressedGesture,
      POINTERUP_FALLBACK_CLEAR_MS,
    );
  };

  const dismissOutside = (
    target: EventTarget | null,
    button: number,
    pointerId: number | null,
    now: number,
  ): boolean => {
    if (layers.length === 0) return false;

    const toDismiss: CanvasDismissLayerRegistration[] = [];
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const entry = layers[i];
      if (!entry) continue;
      const spec = entry.getSpec();
      if (spec.dismissOnOutsidePointerDown === false) continue;
      if (!isTargetInsideSpec(spec, target)) {
        toDismiss.push(spec);
      }
    }

    if (toDismiss.length === 0) return false;

    const shouldPreserveBlank = button === 0
      && isCanvasBlankSurface(target)
      && toDismiss.some((spec) => spec.preserveCanvasSelectionOnBlankClick !== false);

    if (shouldPreserveBlank) {
      clearSuppressedGesture();
      suppressedGesture = { pointerId, fallbackTimer: null };
      lastBlankDismissAt = now;
    }

    for (const spec of toDismiss) {
      spec.onDismiss('outside-pointer');
    }

    return shouldPreserveBlank;
  };

  const onPointerDown = (rawEvent: Event): void => {
    const event = rawEvent as PointerEvent;
    clearSuppressedGesture();
    const now = getNow();
    lastPointerDown = { at: now, target: event.target };
    const button = typeof event.button === 'number' ? event.button : 0;
    const pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    if (dismissOutside(event.target, button, pointerId, now)) {
      event.stopPropagation();
    }
  };

  const onMouseDown = (rawEvent: Event): void => {
    const event = rawEvent as MouseEvent;
    const now = getNow();
    if (
      lastPointerDown
      && now - lastPointerDown.at <= POINTER_MOUSE_DEDUPE_MS
      && lastPointerDown.target === event.target
    ) {
      if (suppressedGesture && event.button === 0 && isCanvasBlankSurface(event.target)) {
        event.stopPropagation();
      }
      return;
    }

    clearSuppressedGesture();
    const button = typeof event.button === 'number' ? event.button : 0;
    if (dismissOutside(event.target, button, null, now)) {
      event.stopPropagation();
    }
  };

  const onPointerUp = (rawEvent: Event): void => {
    if (!suppressedGesture) return;
    const event = rawEvent as PointerEvent;
    if (
      suppressedGesture.pointerId !== null
      && typeof event.pointerId === 'number'
      && suppressedGesture.pointerId !== event.pointerId
    ) {
      return;
    }
    if (isCanvasBlankSurface(event.target)) {
      event.stopPropagation();
    }
    scheduleFallbackClear();
  };

  const onMouseUp = (rawEvent: Event): void => {
    if (!suppressedGesture) return;
    const event = rawEvent as MouseEvent;
    if (isCanvasBlankSurface(event.target)) {
      event.stopPropagation();
    }
    scheduleFallbackClear();
  };

  const onPointerCancel = (): void => {
    clearSuppressedGesture();
  };

  const onClick = (rawEvent: Event): void => {
    if (!suppressedGesture) return;
    const event = rawEvent as MouseEvent;
    const shouldStop = isCanvasBlankSurface(event.target);
    clearSuppressedGesture();
    if (shouldStop) {
      event.stopPropagation();
    }
  };

  const onDblClick = (rawEvent: Event): void => {
    if (lastBlankDismissAt <= 0) return;
    const event = rawEvent as MouseEvent;
    if (getNow() - lastBlankDismissAt > DBLCLICK_SUPPRESS_WINDOW_MS) {
      lastBlankDismissAt = 0;
      return;
    }
    if (isCanvasBlankSurface(event.target)) {
      lastBlankDismissAt = 0;
      event.stopPropagation();
      event.preventDefault();
    }
  };

  const onKeyDown = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    if (event.key !== 'Escape') return;
    if (event.isComposing || event.keyCode === 229) return;
    if (layers.length === 0) return;

    const topEntry = layers[layers.length - 1];
    if (!topEntry) return;
    const spec = topEntry.getSpec();
    if (spec.dismissOnEscape === false) return;
    if (spec.shouldHandleEscape && !spec.shouldHandleEscape(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    spec.onDismiss('escape');
  };

  const onBlur = (): void => {
    clearSuppressedGesture();
  };

  const ensureAttached = (): void => {
    if (attachedHost) return;
    const host = resolveHost();
    if (!host) return;
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('mousedown', onMouseDown, true);
    host.addEventListener('pointerup', onPointerUp, true);
    host.addEventListener('mouseup', onMouseUp, true);
    host.addEventListener('pointercancel', onPointerCancel, true);
    host.addEventListener('click', onClick, true);
    host.addEventListener('dblclick', onDblClick, true);
    host.addEventListener('keydown', onKeyDown, true);
    host.addEventListener('blur', onBlur);
    attachedHost = host;
  };

  const destroy = (): void => {
    clearSuppressedGesture();
    lastPointerDown = null;
    lastBlankDismissAt = 0;
    layers.length = 0;
    if (!attachedHost) return;
    attachedHost.removeEventListener('pointerdown', onPointerDown, true);
    attachedHost.removeEventListener('mousedown', onMouseDown, true);
    attachedHost.removeEventListener('pointerup', onPointerUp, true);
    attachedHost.removeEventListener('mouseup', onMouseUp, true);
    attachedHost.removeEventListener('pointercancel', onPointerCancel, true);
    attachedHost.removeEventListener('click', onClick, true);
    attachedHost.removeEventListener('dblclick', onDblClick, true);
    attachedHost.removeEventListener('keydown', onKeyDown, true);
    attachedHost.removeEventListener('blur', onBlur);
    attachedHost = null;
  };

  const register = (getSpec: () => CanvasDismissLayerRegistration): (() => void) => {
    ensureAttached();
    const id = nextId++;
    layers.push({ id, getSpec });
    return () => {
      const idx = layers.findIndex((item) => item.id === id);
      if (idx !== -1) {
        layers.splice(idx, 1);
      }
    };
  };

  return {
    register,
    hasActiveLayers: () => layers.length > 0,
    getActiveLayerCount: () => layers.length,
    destroy,
  };
}

export const canvasDismissCoordinator = createCanvasDismissCoordinator();

export function hasActiveCanvasDismissLayer(): boolean {
  return canvasDismissCoordinator.hasActiveLayers();
}

/**
 * React Hook：将打开中的瞬态浮层/菜单接入全局画布逐层关闭栈。
 * 通过 latestRef 保存最新回调，确保重渲染不会重排 LIFO 栈顺序。
 */
export function useCanvasDismissLayer(options: UseCanvasDismissLayerOptions): void {
  const latestRef = useRef(options);
  latestRef.current = options;

  useEffect(() => {
    if (!options.open) return undefined;

    let unregister: (() => void) | null = null;
    let rafId: number | null = null;

    const mount = (): void => {
      unregister = canvasDismissCoordinator.register(() => {
        const current = latestRef.current;
        return {
          containsTarget: current.containsTarget,
          excludeSelectors: current.excludeSelectors,
          dismissOnOutsidePointerDown: current.dismissOnOutsidePointerDown,
          dismissOnEscape: current.dismissOnEscape,
          preserveCanvasSelectionOnBlankClick: current.preserveCanvasSelectionOnBlankClick,
          shouldHandleEscape: current.shouldHandleEscape,
          onDismiss: (reason) => {
            current.onDismiss(reason);
            if (reason === 'escape') {
              const focusEl = current.returnFocusRef?.current;
              if (focusEl?.isConnected) {
                queueMicrotask(() => {
                  if (focusEl.isConnected) focusEl.focus();
                });
              }
            }
          },
        };
      });
    };

    if (options.deferRegistration && typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(mount);
    } else {
      mount();
    }

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      unregister?.();
    };
  }, [options.open, options.deferRegistration]);
}
