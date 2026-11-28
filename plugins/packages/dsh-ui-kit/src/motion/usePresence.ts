import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "./usePrefersReducedMotion.ts";

export type PresencePhase = "unmounted" | "entering" | "entered" | "exiting";

export interface PresenceState {
  mounted: boolean;
  phase: PresencePhase;
}

/**
 * Interruptible enter/exit lifecycle hook for drawers and overlaid sheets.
 * Callers MUST bind modal side effects (focus trap, scroll lock, Escape) to `open`,
 * keeping `mounted` solely for preserving DOM nodes during exit animation.
 */
export function usePresence(open: boolean, exitMs = 200): PresenceState {
  const reducedMotion = usePrefersReducedMotion();
  const hasRaf =
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    typeof window.matchMedia === "function";

  const [state, setState] = useState<PresenceState>(() =>
    open
      ? { mounted: true, phase: reducedMotion || !hasRaf ? "entered" : "entering" }
      : { mounted: false, phase: "unmounted" },
  );

  const raf1Ref = useRef<number>(0);
  const raf2Ref = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const clearPending = () => {
      if (raf1Ref.current && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf1Ref.current);
        raf1Ref.current = 0;
      }
      if (raf2Ref.current && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf2Ref.current);
        raf2Ref.current = 0;
      }
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    clearPending();

    if (open) {
      if (reducedMotion || !hasRaf) {
        setState({ mounted: true, phase: "entered" });
        return clearPending;
      }

      if (stateRef.current.phase === "entered") {
        return clearPending;
      }

      if (stateRef.current.mounted) {
        // Reversing mid-exit: stay mounted and flip straight into entered on next frame
        raf1Ref.current = requestAnimationFrame(() => {
          raf1Ref.current = 0;
          setState({ mounted: true, phase: "entered" });
        });
        return clearPending;
      }

      setState({ mounted: true, phase: "entering" });
      raf1Ref.current = requestAnimationFrame(() => {
        raf1Ref.current = 0;
        raf2Ref.current = requestAnimationFrame(() => {
          raf2Ref.current = 0;
          setState({ mounted: true, phase: "entered" });
        });
      });
      return clearPending;
    }

    if (!stateRef.current.mounted) {
      setState({ mounted: false, phase: "unmounted" });
      return clearPending;
    }

    if (reducedMotion || !hasRaf || exitMs <= 0) {
      setState({ mounted: false, phase: "unmounted" });
      return clearPending;
    }

    setState({ mounted: true, phase: "exiting" });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setState({ mounted: false, phase: "unmounted" });
    }, exitMs);

    return clearPending;
  }, [open, exitMs, reducedMotion, hasRaf]);

  return state;
}
