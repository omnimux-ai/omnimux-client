import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const EditorPortalRoot = createContext<HTMLDivElement | null>(null);

export function useEditorPortalRoot() {
  return useContext(EditorPortalRoot);
}

export function EditorPortal({ children }: { children: ReactNode }) {
  const root = useEditorPortalRoot();
  return root ? createPortal(children, root) : null;
}
