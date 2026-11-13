import { useState, useEffect, useCallback, useMemo } from "react";
import { shareBaseOrigin } from "../services/share-origin";

export type AppRoute =
  | "welcome"
  | "editor"
  | "new"
  | "templates"
  | "recent"
  | "share"
  | "motion";

export interface RouteParams {
  dimensions?: string;
  preset?: string;
  width?: string;
  height?: string;
  fps?: string;
  tab?: string;
  shareId?: string;
  compositionId?: string;
}

export interface RouterState {
  route: AppRoute;
  params: RouteParams;
}

function parseHash(hash: string): RouterState {
  const cleanHash = hash.replace(/^#\/?/, "");
  const [path, queryString] = cleanHash.split("?");

  const params: RouteParams = {};
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      params[key as keyof RouteParams] = value;
    });
  }

  const pathParts = path.split("/");
  let route: AppRoute = (pathParts[0] || "welcome") as AppRoute;
  const validRoutes: AppRoute[] = [
    "welcome",
    "editor",
    "new",
    "templates",
    "recent",
    "share",
    "motion",
  ];

  if (route === "share" && pathParts[1]) {
    params.shareId = pathParts[1];
  }

  return {
    route: validRoutes.includes(route) ? route : "welcome",
    params,
  };
}

function buildHash(route: AppRoute, params?: RouteParams): string {
  let hash = `#/${route}`;

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      hash += `?${queryString}`;
    }
  }

  return hash;
}

/**
 * DSH Tab 胶水：OpenReel 官方路由默认写 `window.location.hash`，会污染宿主
 * 会话路由。这里改成进程内状态，API（navigate / params）保持不变。
 */
let memoryState: RouterState = { route: "welcome", params: {} };
const routerListeners = new Set<() => void>();

function setMemoryState(next: RouterState) {
  memoryState = next;
  routerListeners.forEach((listener) => listener());
}

export function resetOpenReelRouter(next?: RouterState) {
  setMemoryState(next ?? { route: "welcome", params: {} });
}

export function useRouter() {
  const [state, setState] = useState<RouterState>(() => memoryState);

  useEffect(() => {
    const handleChange = () => setState(memoryState);
    routerListeners.add(handleChange);
    return () => {
      routerListeners.delete(handleChange);
    };
  }, []);

  const navigate = useCallback((route: AppRoute, params?: RouteParams) => {
    setMemoryState({ route, params: params ?? {} });
  }, []);

  const updateParams = useCallback(
    (newParams: Partial<RouteParams>) => {
      setMemoryState({
        route: memoryState.route,
        params: { ...memoryState.params, ...newParams },
      });
    },
    [],
  );

  const clearParams = useCallback(() => {
    setMemoryState({ route: memoryState.route, params: {} });
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

export function generateShareableLink(
  route: AppRoute,
  params?: RouteParams,
): string {
  return `${shareBaseOrigin()}${buildHash(route, params)}`;
}

export function generateNewProjectLink(options: {
  width?: number;
  height?: number;
  preset?: string;
  fps?: number;
}): string {
  const params: RouteParams = {};

  if (options.preset) {
    params.preset = options.preset;
  } else if (options.width && options.height) {
    params.dimensions = `${options.width}x${options.height}`;
  }

  if (options.fps && options.fps !== 30) {
    params.fps = String(options.fps);
  }

  return generateShareableLink("new", params);
}
