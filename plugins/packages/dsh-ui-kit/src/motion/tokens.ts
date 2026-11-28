import { injectCss } from "../internal/injectCss.ts";

/**
 * Unified OmniMux motion language (--omnimux-motion-* CSS custom properties).
 * Intentionally uses `--omnimux-motion-*` instead of `--dsw-*` because upstream runtime
 * `--dsw-*` tokens are strictly allowlist-locked by verify-dsw-tokens.mjs.
 */
export const MOTION_VARS = {
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeSpatial: "cubic-bezier(0.32, 0.72, 0, 1)",
  easeExit: "cubic-bezier(0.32, 0, 0.67, 0)",
  easeLinear: "linear",
  durPress: "90ms",
  durFast: "140ms",
  durBase: "200ms",
  durSheet: "260ms",
  pressScale: "0.96",
  pressScaleSubtle: "0.985",
} as const;

export const MOTION_TOKENS_CSS = `:root {
  --omnimux-motion-ease-out: ${MOTION_VARS.easeOut};
  --omnimux-motion-ease-spatial: ${MOTION_VARS.easeSpatial};
  --omnimux-motion-ease-exit: ${MOTION_VARS.easeExit};
  --omnimux-motion-ease-linear: ${MOTION_VARS.easeLinear};
  --omnimux-motion-dur-press: ${MOTION_VARS.durPress};
  --omnimux-motion-dur-fast: ${MOTION_VARS.durFast};
  --omnimux-motion-dur-base: ${MOTION_VARS.durBase};
  --omnimux-motion-dur-sheet: ${MOTION_VARS.durSheet};
  --omnimux-motion-press-scale: ${MOTION_VARS.pressScale};
  --omnimux-motion-press-scale-subtle: ${MOTION_VARS.pressScaleSubtle};
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --omnimux-motion-dur-press: 0ms;
    --omnimux-motion-dur-fast: 0ms;
    --omnimux-motion-dur-base: 0ms;
    --omnimux-motion-dur-sheet: 0ms;
    --omnimux-motion-press-scale: 1;
    --omnimux-motion-press-scale-subtle: 1;
  }
}
`;

export function ensureMotionTokens(): void {
  injectCss("omnimux-motion-tokens", MOTION_TOKENS_CSS);
}

ensureMotionTokens();
