import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const EditorPortalRoot = createContext<HTMLDivElement | null>(null);

export function useEditorPortalRoot() {
  return useContext(EditorPortalRoot);
}

export function EditorPortal({ children }: { children: ReactNode }) {
  const root = useEditorPortalRoot();
  return root ? createPortal(children, root) : null;
}

export function EditorRadixPortal({ portal: Portal, children }: {
  portal: ComponentType<{ container: HTMLDivElement; children: ReactNode }>;
  children: ReactNode;
}) {
  const container = useEditorPortalRoot();
  // Radix falls back to document.body for a null container. Inactive editors
  // must release their focus traps and pointer locks, including open menus.
  return container ? <Portal container={container}>{children}</Portal> : null;
}
