import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "auto";

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const calculateIsDark = (mode: ThemeMode): boolean => {
  if (mode === "auto") {
    return getSystemTheme() === "dark";
  }
  return mode === "dark";
};

/**
 * DSH Tab 胶水：官方 store 默认改 `document.documentElement`，会污染宿主主题。
 * 只把 dark / data-theme 写到 `.openreel-studio-root`。
 */
export function applyOpenReelTheme(isDark: boolean) {
  if (typeof document === "undefined") return;
  const roots = document.querySelectorAll(".openreel-studio-root");
  roots.forEach((node) => {
    const el = node as HTMLElement;
    if (isDark) {
      el.classList.add("dark");
      el.dataset.theme = "dark";
    } else {
      el.classList.remove("dark");
      el.dataset.theme = "light";
    }
  });
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "dark",
      isDark: true,

      setMode: (mode: ThemeMode) => {
        const isDark = calculateIsDark(mode);
        set({ mode, isDark });
        applyOpenReelTheme(isDark);
      },

      toggleTheme: () => {
        const currentMode = get().mode;
        const nextMode: ThemeMode =
          currentMode === "light"
            ? "dark"
            : currentMode === "dark"
              ? "auto"
              : "light";
        get().setMode(nextMode);
      },
    }),
    {
      name: "openreel-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const isDark = calculateIsDark(state.mode);
          state.isDark = isDark;
          applyOpenReelTheme(isDark);
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  mediaQuery.addEventListener("change", (e) => {
    const state = useThemeStore.getState();
    if (state.mode === "auto") {
      const isDark = e.matches;
      useThemeStore.setState({ isDark });
      applyOpenReelTheme(isDark);
    }
  });
}
