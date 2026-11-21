import { applyOpenReelTheme, watchOpenReelHostTheme } from "../stores/theme-store";
import { useLayoutEffect, type ReactNode } from "react";
import { TooltipProvider } from "@openreel/ui";
import { useThemeStore } from "../stores/theme-store";
import { PluginManagerHost } from "./editor/plugins/PluginManagerHost";

/** One theme and one set of shadcn primitives for browser and native renderers. */
export function AppProviders({ children }: { children: ReactNode }) {
  const isDark = useThemeStore((s) => s.isDark);
  useLayoutEffect(watchOpenReelHostTheme, []);
  useLayoutEffect(() => {
    applyOpenReelTheme(isDark);
  }, [isDark]);
  return (
    <TooltipProvider delayDuration={350}>
      {children}
      <PluginManagerHost />
    </TooltipProvider>
  );
}
