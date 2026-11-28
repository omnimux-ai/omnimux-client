export type KitLocale = "zh" | "en";

/**
 * Resolve UI kit default copy language from explicit locale, `<html lang>`, or navigator language.
 * Falls back to Simplified Chinese when no English tag is present.
 */
export function resolveKitLocale(explicit?: string): KitLocale {
  const explicitTrimmed = explicit?.trim();
  if (explicitTrimmed) {
    return explicitTrimmed.toLowerCase().startsWith("en") ? "en" : "zh";
  }

  const docLang =
    typeof document !== "undefined" ? document.documentElement?.lang?.trim() : "";
  if (docLang) {
    return docLang.toLowerCase().startsWith("en") ? "en" : "zh";
  }

  const navLang =
    typeof navigator !== "undefined" ? navigator.language?.trim() : "";
  if (navLang) {
    return navLang.toLowerCase().startsWith("en") ? "en" : "zh";
  }

  return "zh";
}
