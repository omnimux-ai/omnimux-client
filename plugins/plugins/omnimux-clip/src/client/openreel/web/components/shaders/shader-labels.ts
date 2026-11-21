import type { MotionShaderDef } from "@openreel/core";
import type { useClipT } from "../../../../i18n/index.js";

export function shaderDisplayName(def: MotionShaderDef, t: ReturnType<typeof useClipT>): string {
  return def.origin === "generated" ? t("{0} (AI)", [def.name]) : t(def.name);
}
