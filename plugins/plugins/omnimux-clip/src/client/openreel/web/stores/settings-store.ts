import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";
import type { ChannelPreset } from "@openreel/core";

export type SettingsTab = "general" | "mcp" | "watch-folders";

const defaultPreferences = {
  autoSave: true,
  autoSaveInterval: 5,
  language: "en",
  audioOutputDeviceId: "",
  audioOutputDeviceLabel: "",
  defaultAudioChannels: "file" as ChannelPreset,
  mcpAutoAllowTrustedLocal: true,
};

type LocalPreferences = typeof defaultPreferences;

interface SettingsState extends LocalPreferences {
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveInterval: (minutes: number) => void;
  setLanguage: (lang: string) => void;
  setAudioOutputDevice: (deviceId: string, label?: string) => void;
  setDefaultAudioChannels: (preset: ChannelPreset) => void;
  setMcpAutoAllowTrustedLocal: (enabled: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

/** Keep the local preference schema when loading profiles written by earlier versions. */
function localPreferences(value: unknown): Partial<LocalPreferences> {
  if (value === null || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
    Object.hasOwn(defaultPreferences, key) && typeof entry === typeof defaultPreferences[key as keyof LocalPreferences],
  ));
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...defaultPreferences,
        settingsOpen: false,
        settingsTab: "general",
        setAutoSave: (enabled) => set({ autoSave: enabled }),
        setAutoSaveInterval: (minutes) => set({ autoSaveInterval: Math.max(1, Math.min(30, minutes)) }),
        setLanguage: (lang) => set({ language: lang }),
        setAudioOutputDevice: (deviceId, label = "") => {
          const id = deviceId === "default" ? "" : deviceId;
          set({ audioOutputDeviceId: id, audioOutputDeviceLabel: id ? label : "" });
        },
        setDefaultAudioChannels: (preset) => set({ defaultAudioChannels: preset }),
        setMcpAutoAllowTrustedLocal: (enabled) => set({ mcpAutoAllowTrustedLocal: enabled }),
        openSettings: (tab = get().settingsTab) => set({ settingsOpen: true, settingsTab: tab }),
        closeSettings: () => set({ settingsOpen: false }),
      }),
      {
        name: "openreel-settings",
        version: 8,
        migrate: localPreferences,
        merge: (persisted, current) => ({ ...current, ...localPreferences(persisted) }),
        partialize: localPreferences,
      },
    ),
  ),
);
