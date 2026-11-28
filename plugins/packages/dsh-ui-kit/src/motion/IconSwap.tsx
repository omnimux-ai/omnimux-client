import type { ReactNode } from "react";

import { cssClass } from "../internal/cssClass.ts";
import { cx } from "../internal/cx.ts";
import css from "./IconSwap.module.css";
import "./tokens.ts";

export interface IconSwapProps {
  /** Whether to show the `secondary` icon (`true`) or `primary` icon (`false`). */
  active: boolean;
  /** Default resting icon (`active === false`). */
  primary: ReactNode;
  /** Alternate active/confirmation icon (`active === true`). */
  secondary: ReactNode;
  className?: string;
}

const ROOT_CLASS = cssClass(css.root, "root");
const LAYER_CLASS = cssClass(css.layer, "layer");
const ACTIVE_CLASS = cssClass(css.active, "active");
const INACTIVE_CLASS = cssClass(css.inactive, "inactive");

/**
 * Pure-compositor dual-layer icon swap (`scale(0.65 -> 1) + opacity`, zero blur).
 * Both icons remain stacked in a single grid cell so the swap never shifts layout.
 */
export function IconSwap({ active, primary, secondary, className }: IconSwapProps) {
  return (
    <span className={cx(ROOT_CLASS, className)} aria-hidden="true">
      <span className={cx(LAYER_CLASS, active ? INACTIVE_CLASS : ACTIVE_CLASS)} data-icon-slot="primary">
        {primary}
      </span>
      <span className={cx(LAYER_CLASS, active ? ACTIVE_CLASS : INACTIVE_CLASS)} data-icon-slot="secondary">
        {secondary}
      </span>
    </span>
  );
}
