import { useState, useEffect, useCallback } from "react";
import { autoSaveManager, type AutoSaveMetadata } from "../services/auto-save";
import { useProjectStore } from "../stores/project-store";

interface RecoveryState {
  isChecking: boolean;
  availableSaves: AutoSaveMetadata[];
  showDialog: boolean;
}

const NO_RECOVERY: RecoveryState = { isChecking: false, availableSaves: [], showDialog: false };

export function useProjectRecovery(enabled = true) {
  const [state, setState] = useState<RecoveryState>({
    isChecking: true,
    availableSaves: [],
    showDialog: false,
  });

  const recoverFromAutoSave = useProjectStore((s) => s.recoverFromAutoSave);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const checkForRecovery = async () => {
      try {
        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();
        if (!current) return;

        if (saves.length > 0) {
          setState({
            isChecking: false,
            availableSaves: saves,
            showDialog: true,
          });
        } else {
          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
          });
        }
      } catch (error) {
        if (!current) return;
        console.warn("[Recovery] Failed to check for saves:", error);
        setState({
          isChecking: false,
          availableSaves: [],
          showDialog: false,
        });
      }
    };

    void checkForRecovery();
    return () => { current = false; };
  }, [enabled]);

  const recover = useCallback(
    async (saveId: string) => {
      const success = await recoverFromAutoSave(saveId);
      if (success) {
        setState((prev) => ({ ...prev, showDialog: false }));
      }
      return success;
    },
    [recoverFromAutoSave],
  );

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, showDialog: false }));
  }, []);

  const clearAll = useCallback(async () => {
    await autoSaveManager.clearAllSaves();
    setState((prev) => ({ ...prev, availableSaves: [], showDialog: false }));
  }, []);

  return {
    ...(enabled ? state : NO_RECOVERY),
    recover,
    dismiss,
    clearAll,
  };
}
