import { applyOpenReelTheme, watchOpenReelHostTheme } from "../stores/theme-store";
import { useLayoutEffect, type ReactNode } from "react";
import { TooltipProvider } from "@openreel/ui";
import { useThemeStore } from "../stores/theme-store";
import { PluginManagerHost } from "./editor/plugins/PluginManagerHost";

/** One theme and one set of shadcn primitives for browser and native renderers. */
export function AppProviders({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const isDark = useThemeStore((s) => s.isDark);
  useLayoutEffect(() => active ? watchOpenReelHostTheme() : undefined, [active]);
  useLayoutEffect(() => {
    if (active) applyOpenReelTheme(isDark);
  }, [active, isDark]);
  return (
    <TooltipProvider delayDuration={350}>
      {children}
      {active && <PluginManagerHost />}
    </TooltipProvider>
  );
}
