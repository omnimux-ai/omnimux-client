import { injectCss } from "../internal/injectCss.ts";

/**
 * Unified OmniMux motion language (--omx-* CSS custom properties).
 * Intentionally uses `--omx-*` instead of `--dsw-*` because upstream runtime
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
  --omx-ease-out: ${MOTION_VARS.easeOut};
  --omx-ease-spatial: ${MOTION_VARS.easeSpatial};
  --omx-ease-exit: ${MOTION_VARS.easeExit};
  --omx-ease-linear: ${MOTION_VARS.easeLinear};
  --omx-dur-press: ${MOTION_VARS.durPress};
  --omx-dur-fast: ${MOTION_VARS.durFast};
  --omx-dur-base: ${MOTION_VARS.durBase};
  --omx-dur-sheet: ${MOTION_VARS.durSheet};
  --omx-press-scale: ${MOTION_VARS.pressScale};
  --omx-press-scale-subtle: ${MOTION_VARS.pressScaleSubtle};
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --omx-dur-press: 0ms;
    --omx-dur-fast: 0ms;
    --omx-dur-base: 0ms;
    --omx-dur-sheet: 0ms;
    --omx-press-scale: 1;
    --omx-press-scale-subtle: 1;
  }
}
`;

export function ensureMotionTokens(): void {
  injectCss("omx-motion-tokens", MOTION_TOKENS_CSS);
}

ensureMotionTokens();
