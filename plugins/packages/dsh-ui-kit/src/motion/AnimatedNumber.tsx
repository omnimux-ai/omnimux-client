import { useEffect, useRef, useState } from "react";

import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import css from "./AnimatedNumber.module.css";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.ts";

export interface AnimatedNumberProps {
  value: number;
  /** Explicit opt-in flag. Default `false` renders immediately with `tabular-nums`. */
  animate?: boolean;
  /** Interpolation duration in ms when `animate` is true. Defaults to 180. */
  durationMs?: number;
  /** Optional value formatter. Defaults to integer locale formatting. */
  format?: (value: number) => string;
  className?: string;
}

const VALUE_CLASS = cssClass(css.value, "value");

function defaultFormat(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

/**
 * Tabular numeric readout with explicit opt-in live-delta interpolation.
 * Skips initial-mount animation, throttles rapid streams, and honors reduced-motion.
 */
export function AnimatedNumber({
  value,
  animate = false,
  durationMs = 180,
  format = defaultFormat,
  className,
}: AnimatedNumberProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState<number>(value);
  const prevValueRef = useRef<number>(value);
  const displayRef = useRef<number>(value);
  const lastTriggerRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  displayRef.current = display;

  useEffect(() => {
    const canRaf =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const rapid = now - lastTriggerRef.current < 100;
    lastTriggerRef.current = now;

    if (
      !animate ||
      reducedMotion ||
      !canRaf ||
      durationMs <= 0 ||
      !Number.isFinite(value) ||
      !Number.isFinite(prevValueRef.current) ||
      value === prevValueRef.current ||
      rapid
    ) {
      prevValueRef.current = value;
      setDisplay(value);
      return;
    }

    const from = displayRef.current;
    const to = value;
    prevValueRef.current = value;
    const start = now;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    const step = (ts: number) => {
      const t = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = 0;
        setDisplay(to);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [value, animate, durationMs, reducedMotion]);

  return <span className={cx(VALUE_CLASS, className)}>{format(display)}</span>;
}
