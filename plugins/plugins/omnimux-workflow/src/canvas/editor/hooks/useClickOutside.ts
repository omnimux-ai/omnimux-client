/**
 * useClickOutside — W2 T2.1，移植自 Gxgen `apps/web/src/hooks/useClickOutside.ts`
 * 的窄化版（只留 refs / excludeSelectors / onClose / deferRegistration）。
 *
 * 判定逻辑抽成纯函数 `isOutsideClickTarget`（无 React/DOM 全局依赖，仅消费
 * 事件目标上的 closest/contains 接口），供 node:test 直接断言（计划 §8）。
 *
 * 计划 §9 坑#4：antd 浮层（Select 下拉、Slider 滑块）渲染在面板 DOM 之外，
 * 必须进 excludeSelectors 白名单，否则点选项会误关面板。
 */

import { useEffect, type RefObject } from 'react';

/** 浮层默认排除选择器：面板自身由 refs 覆盖，这里列出外部弹出层白名单 */
export const DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS = [
  '.wf-custom-select-dropdown',
  '.wf-custom-dropdown-menu',
  '.wf-custom-slider',
  '.wf-modal-overlay',
  '.ant-select-dropdown',
  '.ant-slider-thumb',
] as const;

/** 事件目标需要的最小接口（真实 DOM Element / 测试 fake 均满足） */
export interface ClickTargetLike {
  closest?(selector: string): unknown;
}

export interface ClickContainerLike {
  contains(node: unknown): boolean;
}

/**
 * 点击目标是否位于「浮层外部」——即应触发 onClose。
 * 依次判定：① 浮层自身内部 → 不关闭；② excludeSelectors 命中的祖先 → 不关闭。
 */
export function isOutsideClickTarget(
  target: ClickTargetLike | null | undefined,
  containers: ReadonlyArray<ClickContainerLike | null | undefined>,
  excludeSelectors: readonly string[] = DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS,
): boolean {
  if (!target) return false;
  for (const container of containers) {
    if (container?.contains(target)) return false;
  }
  for (const selector of excludeSelectors) {
    if (target.closest?.(selector)) return false;
  }
  return true;
}

export interface UseClickOutsideOptions {
  /** 浮层 ref（点击其内部不触发 onClose）。支持单个或数组 */
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[];
  /** 排除的 CSS 选择器（antd 浮层白名单，默认 DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS） */
  excludeSelectors?: readonly string[];
  /** 点击外部时的关闭回调 */
  onClose: () => void;
  /** 是否启用监听（默认 true） */
  enabled?: boolean;
  /** 是否延迟注册（rAF，避免触发打开的当次点击立即关闭，默认 true） */
  deferRegistration?: boolean;
}

export function useClickOutside({
  refs,
  excludeSelectors = DEFAULT_FLOATING_LAYER_EXCLUDE_SELECTORS,
  onClose,
  enabled = true,
  deferRegistration = true,
}: UseClickOutsideOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const refArray = Array.isArray(refs) ? refs : [refs];

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as ClickTargetLike | null;
      if (isOutsideClickTarget(target, refArray.map((ref) => ref.current), excludeSelectors)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const register = () => {
      document.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('keydown', handleKeyDown);
    };

    let rafId: number | null = null;
    if (deferRegistration) {
      rafId = requestAnimationFrame(register);
    } else {
      register();
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [refs, excludeSelectors, onClose, enabled, deferRegistration]);
}

export default useClickOutside;
