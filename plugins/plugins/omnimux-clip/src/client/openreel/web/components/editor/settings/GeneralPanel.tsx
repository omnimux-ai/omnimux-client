import { useCallback, useEffect, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button, Card, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, ToggleGroup, ToggleGroupItem, cn } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { CHANNEL_PRESETS, CHANNEL_PRESET_LABELS, type ChannelPreset } from "@openreel/core";
import { EDITING_FRAME_RATE_OPTIONS } from "../editing-frame-rate";
import { AudioOutputSelect } from "./AudioOutputSelect";
import { useClipT } from "../../../../../i18n/index.js";

const ASPECT_PRESETS = [
  { label: "16:9 Landscape (1080p)", width: 1920, height: 1080 },
  { label: "9:16 Vertical (TikTok/Reels)", width: 1080, height: 1920 },
  { label: "1:1 Square", width: 1080, height: 1080 },
  { label: "4:5 Portrait", width: 1080, height: 1350 },
  { label: "4:3 Standard", width: 1440, height: 1080 },
  { label: "21:9 Cinematic", width: 2560, height: 1080 },
  { label: "4K Landscape", width: 3840, height: 2160 },
];
const BACKGROUND_SWATCHES = ["#000000", "#FFFFFF", "#1E1E1E", "#2563EB", "#DC2626", "#16A34A", "#F59E0B", "#9333EA", "#DB2777", "#0EA5E9"];
const controlClass = "h-8 min-w-0 rounded-md bg-bg-2 px-2 text-xs md:text-xs";

function PreferenceSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) {
  const t = useClipT();
  const choices = value && !options.some(option => option.value === value) ? [{ value, label: value }, ...options] : options;
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={t(label)} className={cn(controlClass, "w-full sm:w-[180px]")}><SelectValue /></SelectTrigger><SelectContent>{choices.map(option => <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>)}</SelectContent></Select>;
}
export function GeneralPanel() {
  const t = useClipT();
  const preferences = useSettingsStore(useShallow(state => ({ autoSave: state.autoSave, autoSaveInterval: state.autoSaveInterval,
    defaultAudioChannels: state.defaultAudioChannels })));
  const project = useProjectStore(state => state.project.settings);
  const projectId = useProjectStore(state => state.project.id);
  const backgroundFillMode = useProjectStore(state => state.project.timeline.backgroundFillMode);
  const backgroundColor = useProjectStore(state => state.project.timeline.layoutBackgroundColor);
  const updateProjectSettings = useProjectStore(state => state.updateSettings);
  const setCanvasBackground = useProjectStore(state => state.setCanvasBackground);
  const [draftWidth, setDraftWidth] = useState(String(project.width));
  const [draftHeight, setDraftHeight] = useState(String(project.height));
  const [scaleGraphics, setScaleGraphics] = useState(true);
  const widthId = useId(), heightId = useId(), autoSaveId = useId();
  useEffect(() => { setDraftWidth(String(project.width)); setDraftHeight(String(project.height)); }, [projectId, project.width, project.height]);
  const applyDimensions = useCallback(async (width: number, height: number) => {
    if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    await updateProjectSettings({ width: Math.max(16, Math.min(7680, Math.round(width))), height: Math.max(16, Math.min(7680, Math.round(height))) }, { scaleGraphics });
  }, [updateProjectSettings, scaleGraphics]);
  return <div className="space-y-5 pb-1 text-xs">
    <section className="space-y-3" aria-labelledby="composition-settings-heading">
      <div><h3 id="composition-settings-heading" className="text-sm font-medium">{t("Project Composition")}</h3><p className="mt-1 text-xs leading-5 text-fg-2">{t("Set the canvas dimensions for your project. Pick a preset for TikTok, Reels, YouTube, or enter custom values.")}</p></div>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {ASPECT_PRESETS.map(preset => <Button key={preset.label} variant="outline" aria-label={t(preset.label)} aria-pressed={preset.width === project.width && preset.height === project.height} onClick={() => { void applyDimensions(preset.width, preset.height); }} className="h-auto min-w-0 flex-col items-start whitespace-normal rounded-md p-3 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10"><span>{t(preset.label)}</span><span className="font-normal text-fg-2">{preset.width} × {preset.height}</span></Button>)}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <div className="space-y-1.5"><Label htmlFor={widthId} className="text-xs text-fg-2">{t("Width")}</Label><Input id={widthId} type="number" min={16} max={7680} step={1} inputMode="numeric" value={draftWidth} onChange={event => setDraftWidth(event.target.value)} className={controlClass} /></div>
        <div className="space-y-1.5"><Label htmlFor={heightId} className="text-xs text-fg-2">{t("Height")}</Label><Input id={heightId} type="number" min={16} max={7680} step={1} inputMode="numeric" value={draftHeight} onChange={event => setDraftHeight(event.target.value)} className={controlClass} /></div>
        <Button type="button" onClick={() => { void applyDimensions(Number(draftWidth), Number(draftHeight)); }} className="h-8 text-xs">{t("Apply")}</Button>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-fg-2"><Checkbox checked={scaleGraphics} aria-label={t("Scale graphics to new frame size")} onCheckedChange={value => setScaleGraphics(value === true)} className="mt-px" /><span>{t("Scale graphics to new frame size: titles, text, shapes and templates keep their proportion to the frame (one undo step).")}</span></label>
      <Card className="flex flex-col justify-between gap-3 rounded-md bg-bg-2 p-3 shadow-none sm:flex-row sm:items-center"><div className="min-w-0"><h4 className="text-xs font-medium">{t("Editing frame rate")}</h4><p className="mt-1 text-[11px] leading-4 text-fg-2">{t("Controls preview playback, frame stepping, and the default export rate. Existing clip timing stays unchanged.")}</p></div>
        <PreferenceSelect label={t("Editing frame rate")} value={String(project.frameRate)} options={EDITING_FRAME_RATE_OPTIONS.map(option => ({ label: option.label, value: String(option.value) }))} onChange={value => { const frameRate = Number(value); if (Number.isFinite(frameRate) && frameRate > 0) void updateProjectSettings({ frameRate }); }} />
      </Card>
      <div className="space-y-2"><h4 className="text-xs font-medium text-fg-2">{t("Background fill")}</h4><p className="text-[11px] leading-4 text-fg-2">{t("Fills the canvas around clips that don't match the aspect ratio.")}</p>
        <div className="flex flex-wrap items-center gap-2"><ToggleGroup type="single" value={backgroundFillMode === "blur" ? "blur" : backgroundFillMode === "color" ? "color" : "none"} onValueChange={value => { if (value === "none") setCanvasBackground(undefined, undefined); if (value === "blur") setCanvasBackground("blur", backgroundColor); }} aria-label={t("Background fill")}>
          <ToggleGroupItem value="none" aria-label={t("No background fill")} className="h-8 text-xs">{t("None")}</ToggleGroupItem><ToggleGroupItem value="blur" aria-label={t("Blur background fill")} className="h-8 text-xs">{t("Blur")}</ToggleGroupItem>
        </ToggleGroup>
        {BACKGROUND_SWATCHES.map(hex => <Button key={hex} type="button" variant="ghost" aria-label={t("Background color {0}", [hex])} aria-pressed={backgroundFillMode === "color" && backgroundColor?.toLowerCase() === hex.toLowerCase()} style={{ backgroundColor: hex }} onClick={() => setCanvasBackground("color", hex)} className="h-6 w-6 rounded-full border-2 border-border p-0 aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary" />)}</div>
      </div>
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="audio-channels-settings-heading"><h3 id="audio-channels-settings-heading" className="text-sm font-medium">{t("Audio")}</h3>
      <Card className="flex flex-col justify-between gap-3 rounded-md bg-bg-2 p-3 shadow-none sm:flex-row sm:items-center"><div className="min-w-0"><h4 className="text-xs font-medium">{t("Default audio channels")}</h4><p className="mt-1 text-[11px] leading-4 text-fg-2">{t("Applies to files you import from now on. \"Use file\" keeps each file's own channels; Mono plays the first channel only, Stereo plays the first two channels. Change any clip later with Clip > Audio Channels.")}</p></div>
        <PreferenceSelect label={t("Default audio channels")} value={preferences.defaultAudioChannels} options={CHANNEL_PRESETS.map(preset => ({ value: preset, label: CHANNEL_PRESET_LABELS[preset] }))} onChange={value => useSettingsStore.getState().setDefaultAudioChannels(value as ChannelPreset)} />
      </Card>
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="autosave-settings-heading"><h3 id="autosave-settings-heading" className="text-sm font-medium">{t("Auto-Save")}</h3>
      <div className="flex items-center justify-between gap-3"><div><Label htmlFor={autoSaveId} className="text-xs">{t("Enable auto-save")}</Label><p id={`${autoSaveId}-description`} className="mt-1 text-[11px] leading-4 text-fg-2">{t("Automatically save your project at regular intervals")}</p></div><Switch id={autoSaveId} aria-describedby={`${autoSaveId}-description`} checked={preferences.autoSave} onCheckedChange={value => useSettingsStore.getState().setAutoSave(value)} /></div>
      {preferences.autoSave && <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><span className="text-xs text-fg-2">{t("Save every")}</span><PreferenceSelect label={t("Auto-save interval")} value={String(preferences.autoSaveInterval)} onChange={value => useSettingsStore.getState().setAutoSaveInterval(Number(value))} options={[1, 2, 5, 10, 15, 30].map(value => ({ value: String(value), label: `${value} minute${value === 1 ? "" : "s"}` }))} /></div>}
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="audio-output-settings-heading"><h3 id="audio-output-settings-heading" className="text-sm font-medium">{t("Audio Output")}</h3>
      <div className="flex flex-col gap-2"><div className="min-w-0"><Label className="text-xs">{t("Playback device")}</Label><p className="mt-1 text-[11px] leading-4 text-fg-2">{t("Choose the speakers or headphones used for preview. Remembered between sessions; falls back to the system default if the device is unplugged.")}</p></div>
        <AudioOutputSelect testId="prefs-audio-output" className="w-full max-w-[320px]" /></div>
    </section>
  </div>;
}
