import { useSyncExternalStore, useMemo, useCallback } from "react";
import { MOTION_CREATOR_ENABLED } from "../config/features";

type AppRoute =
  | "welcome"
  | "editor"
  | "new"
  | "templates"
  | "recent"
  | "motion";

interface RouteParams {
  dimensions?: string;
  preset?: string;
  width?: string;
  height?: string;
  fps?: string;
  tab?: string;
  compositionId?: string;
}

interface RouterState {
  route: AppRoute;
  params: RouteParams;
}

/**
 * DSH Tab 胶水：OpenReel 官方路由默认写 `window.location.hash`，会污染宿主
 * 会话路由。这里改成进程内状态，API（navigate / params）保持不变。
 */
let memoryState: RouterState = { route: "welcome", params: {} };
const routerListeners = new Set<() => void>();

function subscribe(listener: () => void) {
  routerListeners.add(listener);
  return () => { routerListeners.delete(listener); };
}

export function getOpenReelRoute(): RouterState {
  return memoryState;
}

export function navigateOpenReel(route: AppRoute, params: RouteParams = {}) {
  const next = route === "motion" && !MOTION_CREATOR_ENABLED ? { route: "editor" as const, params: {} } : { route, params };
  memoryState = next;
  routerListeners.forEach(listener => listener());
}

export function resetOpenReelRouter(next?: RouterState) {
  navigateOpenReel(next?.route ?? "welcome", next?.params);
}

export function useRouter() {
  const state = useSyncExternalStore(subscribe, getOpenReelRoute, getOpenReelRoute);
  const navigate = navigateOpenReel;

  const updateParams = useCallback(
    (newParams: Partial<RouteParams>) => {
      navigateOpenReel(memoryState.route, { ...memoryState.params, ...newParams });
    },
    [],
  );

  const clearParams = useCallback(() => {
    navigateOpenReel(memoryState.route);
  }, []);

  const parsedDimensions = useMemo(() => {
    const { dimensions, width, height } = state.params;

    if (dimensions) {
      const match = dimensions.match(/^(\d+)x(\d+)$/i);
      if (match) {
        return {
          width: parseInt(match[1], 10),
          height: parseInt(match[2], 10),
        };
      }
    }

    if (width && height) {
      return { width: parseInt(width, 10), height: parseInt(height, 10) };
    }

    return null;
  }, [state.params]);

  const fps = useMemo(() => {
    const { fps } = state.params;
    if (fps) {
      const parsed = parseInt(fps, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 120) {
        return parsed;
      }
    }
    return 30;
  }, [state.params]);

  return {
    route: state.route,
    params: state.params,
    navigate,
    updateParams,
    clearParams,
    parsedDimensions,
    fps,
  };
}
