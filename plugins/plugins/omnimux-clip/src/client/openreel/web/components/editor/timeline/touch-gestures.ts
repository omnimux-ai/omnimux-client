import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

export function useTimelineTouchGesture() {
  const pointerId = useRef<number | null>(null);
  const suppressMouseUntil = useRef(0);
  const touchTap = useRef(false);
  const captureTarget = useRef<Element | null>(null);
  useEffect(() => () => {
    if (pointerId.current !== null) {
      try { captureTarget.current?.releasePointerCapture?.(pointerId.current); } catch { /* Browser may already release capture. */ }
      pointerId.current = null;
    }
  }, []);
  return useMemo(() => ({
    pointerId,
    shouldIgnoreMouse(event: ReactMouseEvent) {
      return !("pointerType" in event) && performance.now() < suppressMouseUntil.current;
    },
    bodyPointerDown(event: ReactPointerEvent) {
      if (!event.pointerType || event.pointerType === "mouse") return;
      suppressMouseUntil.current = performance.now() + 1000;
      touchTap.current = true;
      // Body taps select through click; native swipes remain timeline scrolling.
      event.stopPropagation();
    },
    start(event: ReactPointerEvent, callback: (event: ReactMouseEvent) => void | boolean) {
      if (!event.pointerType || event.pointerType === "mouse") return;
      suppressMouseUntil.current = performance.now() + 1000;
      touchTap.current = false;
      pointerId.current = event.pointerId;
      captureTarget.current = event.currentTarget;
      event.preventDefault();
      event.stopPropagation();
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Window listeners still complete the gesture. */ }
      if (callback(event) === false) {
        pointerId.current = null;
        try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* Already released. */ }
      }
    },
    consumeTap() {
      const tapped = touchTap.current;
      touchTap.current = false;
      return tapped;
    },
  }), []);
}

/** Share mouse and touch gesture lifecycles while ignoring unrelated fingers. */
export function listenTimelineGesture(
  pointerId: { current: number | null },
  move: (event: MouseEvent) => void,
  end: (event: MouseEvent) => void | Promise<void>,
  cancel: (event: MouseEvent) => void | Promise<void> = end,
  releaseStyle?: () => void,
): () => void {
  let ended = false;
  const matches = (event: MouseEvent) => "pointerId" in event
    ? pointerId.current === (event as PointerEvent).pointerId
    : pointerId.current === null;
  const onMove = (event: MouseEvent) => { if (!ended && matches(event)) move(event); };
  const onEnd = (event: MouseEvent) => {
    if (ended || !matches(event)) return;
    finish(event, event.type === "pointercancel" ? cancel : end);
  };
  const onBlur = (event: Event) => finish(event as MouseEvent, cancel);
  const finish = (event: MouseEvent, callback: typeof end) => {
    if (ended) return;
    stop();
    void Promise.resolve(callback(event)).finally(() => { pointerId.current = null; });
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onEnd);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  window.addEventListener("blur", onBlur);
  const stop = () => {
    ended = true;
    releaseStyle?.();
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onEnd);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };
  return stop;
}
