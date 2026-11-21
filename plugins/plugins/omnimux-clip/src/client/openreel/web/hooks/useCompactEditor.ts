import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from "react";

const COMPACT_EDITOR_QUERY = "(max-width: 1366px) and (hover: none) and (pointer: coarse)";
const MIN_THREE_COLUMN_WIDTH = 960;

export const CompactEditorContext = createContext(false);

/** The host can dock the editor inside a pane much narrower than the window. */
export function useCompactEditorPane(pane: HTMLElement | null): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    if (!pane) return;
    const measure = () => {
      if (pane.clientWidth > 0) setCompact(pane.clientWidth < MIN_THREE_COLUMN_WIDTH);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [pane]);
  return compact;
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(COMPACT_EDITOR_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

export function useCompactEditor(): boolean {
  const compactPane = useContext(CompactEditorContext);
  const compactTouch = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_EDITOR_QUERY).matches,
    () => false,
  );
  return compactPane || compactTouch;
}
