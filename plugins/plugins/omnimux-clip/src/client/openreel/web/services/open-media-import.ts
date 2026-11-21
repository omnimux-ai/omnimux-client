import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";

/** Keep menu and keyboard import on the asset browser's existing file pipeline. */
export function openMediaImport() {
  useEditorWorkspaceStore.getState().setSection("media");
  document.querySelector<HTMLInputElement>('[data-tour="assets"] input[type="file"]')?.click();
}
