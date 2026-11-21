import { getActiveClipSession, getActiveClipStageStore } from "../../../../stage-store.js";
import { notifyCanvasClose } from "../../../../CanvasBridge.js";
import { useClipT } from "../../../../i18n/index.js";
import { useLatch } from "./use-latch";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { MobileEditorHeader } from "./mobile/MobileEditorHeader";
import reelIcon from "../../../assets/icons/editor-reel.svg";
import "./mobile/mobile-editor.css";
import { DesktopExportButton } from "../../desktop/editor/DesktopExportButton";
import { WindowControls } from "../../desktop/shell/WindowControls";
import { Button as ShadcnButton, Input } from "@openreel/ui";
import { useEditorPortalRoot } from "@openreel/ui/lib/portal-root";
import { EditorHeaderIcon } from "./EditorHeaderIcon";
import { EditorExportControl } from "./EditorExportControl";
import { getQuickExportPresets, type QuickExportPresetId } from "../../services/quick-export-presets";
import { WorkspaceSaveStatus } from "./WorkspaceSaveStatus";
import { EditorMenuBar } from "./EditorMenuBar";
import React, { lazy, Suspense, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { X } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import {
  projectForSequence,
  trackHasAudioItems,
  type VideoExportSettings,
} from "@openreel/core";
import { ExportQueueButton, ExportQueuePanel } from "./ExportQueuePanel";
import { addDialogExportToQueue, isExportQueueBusy } from "../../stores/export-queue-store";
import { getUseExportPreviews } from "../../services/export-queue/export-queue-activity";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import { useExportRunner, extForFormat, exportFilename, type ExportDeliveryMode } from "../../services/export-runner";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SettingsDialog } from "./settings/SettingsDialog";
import { toast } from "../../stores/notification-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import { clipNow } from "../../../../i18n/index.js";

// Dialogs that only open on demand stay out of the editor chunk (bundle-budgets.json).
const CompressDialog = lazy(() => import("./CompressDialog").then((m) => ({ default: m.CompressDialog })));
const ExportDialog = lazy(() => import("./ExportDialog").then((m) => ({ default: m.ExportDialog })));
const ScreenRecorder = lazy(() => import("./ScreenRecorder").then((m) => ({ default: m.ScreenRecorder })));
const ProjectPackageDialog = lazy(() => import("./ProjectPackageDialog").then((m) => ({ default: m.ProjectPackageDialog })));


export const Toolbar: React.FC<{ canvasMode?: boolean }> = ({ canvasMode: isCanvasMode = false }) => {
  const t = useClipT();
  const canvasSession = isCanvasMode ? getActiveClipSession() : null;
  const phone = usePhoneEditor() && !isCanvasMode;
  const isDesktop = !isCanvasMode && typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const nativePlatform = /Mac/i.test(navigator.platform) ? "darwin" : /Win/i.test(navigator.platform) ? "win32" : "linux";
  const project = useProjectStore((state) => state.project);
  const loopStart = useTimelineStore((state) => state.loopStart);
  const loopEnd = useTimelineStore((state) => state.loopEnd);
  const renameProject = useProjectStore((state) => state.renameProject);
  const setGlobalExportState = useUIStore((state) => state.setExportState);
  const active = useEditorPortalRoot() !== null;
  const activeModal = useUIStore((state) => active ? state.activeModal : null);
  const closeModal = useUIStore((state) => state.closeModal);
  const isExportDialogOpen = activeModal === "export";
  const [isCompressOpen, setIsCompressOpen] = useState(false);
  // Dialogs are fetched the first time they open and then stay mounted so their close animation still plays.
  const compressLatched = useLatch(isCompressOpen);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const importMedia = useProjectStore((state) => state.importMedia);
  // Export renders the chosen sequence (default: the active one) as if it were open.
  const exportSequenceId = useUIStore((state) => state.exportSequenceId);
  const exportProject = useMemo(
    () => (exportSequenceId && exportSequenceId !== project.activeSequenceId ? projectForSequence(project, exportSequenceId) ?? project : project),
    [project, exportSequenceId],
  );
  useEffect(() => {
    if (active && exportSequenceId && !project.sequences?.some((sequence) => sequence.id === exportSequenceId)) useUIStore.getState().setExportSequenceId(null);
  }, [active, project.sequences, exportSequenceId]);
  const sourceMatch = useMemo(() => deriveSourceExportMatch(exportProject), [exportProject]);
  const projectHasAudio = useMemo(
    () => exportProject.timeline.tracks.some((track) => trackHasAudioItems(exportProject, track.id)),
    [exportProject],
  );
  const hasTimelineContent = (exportProject.timeline?.duration ?? 0) > 0;
  const checkTimelineForExport = useCallback(() => {
    if (hasTimelineContent) return true;
    const translate = clipNow();
    toast.warning(translate("Timeline is empty"), translate("Add clips or graphics to the timeline before exporting."));
    return false;
  }, [hasTimelineContent]);
  const openExportDialog = useCallback(() => {
    if (useUIStore.getState().exportState.isExporting || !checkTimelineForExport()) return;
    if (isDesktop) window.dispatchEvent(new CustomEvent("openreel:menu:export"));
    else useUIStore.getState().openModal("export");
  }, [isDesktop, checkTimelineForExport]);
  // The chosen sequence only lasts for one export: opening the dialog or switching tabs starts over.
  useEffect(() => {
    if (active) useUIStore.getState().setExportSequenceId(null);
  }, [active, project.activeSequenceId, isExportDialogOpen]);
  const { track } = useAnalytics();

  // Local editable project name (committed onBlur / Enter)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  const cancelProjectNameCommit = useRef(false);
  useEffect(() => {
    setProjectNameDraft(project.name);
  }, [project.name]);

  const commitProjectName = useCallback(() => {
    if (cancelProjectNameCommit.current) {
      cancelProjectNameCommit.current = false;
      return;
    }
    const next = projectNameDraft.trim();
    if (next && next !== project.name) {
      void renameProject(next);
    } else {
      setProjectNameDraft(project.name);
    }
  }, [projectNameDraft, project.name, renameProject]);

  const handleExported = useCallback(
    (videoSettings: Partial<VideoExportSettings>) => {
      track(AnalyticsEvents.PROJECT_EXPORTED, {
        format: videoSettings.format ?? "mp4",
        codec: videoSettings.codec ?? "h264",
        width: videoSettings.width ?? project.settings.width,
        height: videoSettings.height ?? project.settings.height,
        frameRate: videoSettings.frameRate ?? project.settings.frameRate,
        duration: project.timeline?.duration ?? 0,
      });
    },
    [project, track],
  );

  const {
    state: exportState,
    runExport,
    runAudioExport,
    showSavePicker,
    markComplete,
    beginExport,
    finishExportSoon,
    failExport,
    cancel: handleCancelExport,
    resetError,
  } = useExportRunner({ project: exportProject, canvasMode: isCanvasMode, onExported: handleExported });

  useEffect(() => {
    if (!active) return;
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
    });
  }, [active, exportState.isExporting, exportState.progress, exportState.phase, setGlobalExportState]);

  const handleQuickExport = useCallback(async (id: QuickExportPresetId) => {
    if (!hasTimelineContent || useUIStore.getState().exportState.isExporting) return;
    if (isDesktop) {
      window.dispatchEvent(new CustomEvent("openreel:menu:quick-export", { detail: { preset: id } }));
      return;
    }
    const preset = getQuickExportPresets(exportProject.settings).find(entry => entry.id === id);
    if (!preset) return;
    try {
      const ext = preset.kind === "audio" ? preset.extension : extForFormat(preset.settings.format ?? "mp4", preset.settings.codec);
      const writable = await showSavePicker(exportFilename(project.name, ext), ext, { delivery: "download" });
      beginExport(writable);
      if (preset.kind === "audio") {
        await runAudioExport(preset.settings, writable);
        markComplete();
        track(AnalyticsEvents.PROJECT_EXPORTED, { format: preset.extension, duration: project.timeline.duration });
      } else if (!(await runExport(preset.settings, ext, writable))) {
        return;
      }
      finishExportSoon();
    } catch (error) {
      failExport(error);
    }
  }, [hasTimelineContent, isDesktop, project, exportProject.settings, showSavePicker, beginExport, runAudioExport, markComplete, track, runExport, finishExportSoon, failExport]);

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings, delivery: ExportDeliveryMode = window.openreel?.platform === "desktop" ? "file" : "download") => {
      closeModal();
      if (!checkTimelineForExport()) return;
      // The encoder is busy with a queued job: line this export up behind it.
      if (!isCanvasMode && isExportQueueBusy()) {
        addDialogExportToQueue(settings, { presetLabel: "Custom", usePreviews: getUseExportPreviews(), sequenceId: exportSequenceId });
        return;
      }

      try {
        const ext = extForFormat(settings.format, settings.codec);
        const writable = await showSavePicker(exportFilename(project.name, ext), ext, { delivery });

        beginExport(writable);

        const needsUpscaling =
          settings.width > exportProject.settings.width ||
          settings.height > exportProject.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        if (!(await runExport(exportSettings, ext, writable))) return;

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, exportProject, exportSequenceId, checkTimelineForExport, isCanvasMode, closeModal, track, runExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );


  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          clipNow()("Recording failed"),
          clipNow()("No video data was captured. Please try again."),
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importMedia(screenFile, undefined, { recordedTake: "screen" });
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || "Failed to import screen recording",
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importMedia(webcamFile, undefined, { recordedTake: "webcam" });
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || "Failed to import webcam recording",
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          `${importCount} recording${importCount > 1 ? "s" : ""} imported!`,
          webcamBlob && webcamBlob.size > 0
            ? clipNow()("Screen and webcam added to assets. Use the timeline to composite them.")
            : clipNow()("Screen recording added to assets."),
        );
      } else if (errors.length > 0) {
        toast.error(clipNow()("Import failed"), errors.join(". "));
      }
    },
    [importMedia],
  );

  return (
    <header className={`${phone ? "mobile-editor-header" : "workspace-topbar flex items-center border-b border-border"} shrink-0 z-30 relative ${isDesktop ? `workspace-native-${nativePlatform}` : ""}`} style={isDesktop ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}>
      {phone ? <MobileEditorHeader
        onExport={() => { if (exportState.isExporting) handleCancelExport(); else { if (exportState.error) resetError(); openExportDialog(); } }}
        exportLabel={exportState.isExporting ? `${Math.round(exportState.progress)}%` : exportState.error ? t("Retry") : exportState.complete ? t("Saved") : t("Export")}
        exportDisabled={exportState.complete}
        exportControl={isDesktop ? <span className="mobile-native-export"><DesktopExportButton compact /></span> : <EditorExportControl
          state={exportState} disabled={!hasTimelineContent} compact onOpen={openExportDialog} onCancel={handleCancelExport} onDismissError={resetError} />}
        menu={<EditorMenuBar onExport={openExportDialog} onQuickExport={handleQuickExport} onCompress={() => setIsCompressOpen(true)}/>}
      /> : <>
      <div data-toolbar-section="left" className="openreel-toolbar-left contents">
      <ProjectSwitcher trigger={<ShadcnButton variant="ghost" className="workspace-brand p-0 h-auto" aria-label={t("Project menu")}>
        <img src={reelIcon} alt="" />OpenReel
      </ShadcnButton>} />
      <EditorMenuBar onExport={openExportDialog} onQuickExport={handleQuickExport} onCompress={() => setIsCompressOpen(true)} />
      </div>
      <div data-toolbar-section="center" className="workspace-project openreel-toolbar-center">
        <Input aria-label={t("Project name")} value={projectNameDraft} onChange={(e) => setProjectNameDraft(e.target.value)}
          onBlur={commitProjectName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { cancelProjectNameCommit.current = true; setProjectNameDraft(project.name); e.currentTarget.blur(); } }} />
        <span className="workspace-project-meta">{project.settings.width}×{project.settings.height} · {project.settings.frameRate} fps</span>
        <WorkspaceSaveStatus />
      </div>
      <div className="workspace-actions">
        <div data-toolbar-section="left" className="openreel-toolbar-left contents">
        <div className="workspace-history">
          <ShadcnButton variant="ghost" size="icon" aria-label={t("Undo")} onClick={() => void useProjectStore.getState().undo()}><EditorHeaderIcon kind="undo" /></ShadcnButton>
          <ShadcnButton variant="ghost" size="icon" aria-label={t("Redo")} onClick={() => void useProjectStore.getState().redo()}><EditorHeaderIcon kind="redo" /></ShadcnButton>
        </div>
        <ExportQueueButton className="workspace-queue h-7 w-7 text-fg-2" />
        <ShadcnButton variant="secondary" className="workspace-share" title={t("Back up or package this project")} aria-label={t("Project backup")} onClick={() => setIsShareOpen(true)}>{t("Backup")}</ShadcnButton>
        </div>
        <div data-toolbar-section="right" className="openreel-toolbar-right inline-flex items-center gap-2.5">
        {isDesktop ? <DesktopExportButton /> : <EditorExportControl
          state={exportState} disabled={!hasTimelineContent} onOpen={openExportDialog}
          style={isCanvasMode ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
          onCancel={handleCancelExport} onDismissError={resetError} />}
        {isCanvasMode && <ShadcnButton
          type="button"
          variant="ghost"
          className="omnimux-clip-stage-close-btn inline-flex"
          disabled={exportState.isExporting && !exportState.savingToCanvas}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={() => {
            if (exportState.savingToCanvas) handleCancelExport();
            if (canvasSession?.nodeId) notifyCanvasClose({ nodeId: canvasSession.nodeId, projectId: canvasSession.projectId });
            getActiveClipStageStore()?.set(false);
          }}
        >{t("Exit editor")}</ShadcnButton>}
        </div>
      </div>

      {isDesktop && <WindowControls platform={nativePlatform} />}
      </>}
      {/* ─── Auxiliary popups & dialogs ───────────────────────── */}
      {compressLatched && (
        <Suspense fallback={null}>
          <CompressDialog
            isOpen={isCompressOpen}
            onClose={() => setIsCompressOpen(false)}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeModal}
        onExport={handleCustomExport}
        canvasMode={isCanvasMode}
        onAddToQueue={isCanvasMode ? undefined : (settings, meta) => { addDialogExportToQueue(settings, { ...meta, sequenceId: exportSequenceId }); }}
        duration={exportProject.timeline?.duration ?? 0}
        projectWidth={exportProject.settings?.width ?? 1920}
        projectHeight={exportProject.settings?.height ?? 1080}
        frameRate={exportProject.settings?.frameRate ?? 30}
        sourceMatch={sourceMatch}
        hasAudio={projectHasAudio}
        markedRange={loopEnd > loopStart && exportProject === project ? { startTime: loopStart, endTime: loopEnd } : null}
      />
      </Suspense>

      <ExportQueuePanel />

      <Suspense fallback={null}>
        <ScreenRecorder
          isOpen={activeModal === "recorder"}
          onClose={closeModal}
          onRecordingComplete={handleRecordingComplete}
        />
      </Suspense>

      <SettingsDialog />
      {isShareOpen && (
        <Suspense fallback={null}>
          <ProjectPackageDialog onClose={() => setIsShareOpen(false)} />
        </Suspense>
      )}

      {activeModal === "history" && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeModal}
          />
          <div className="fixed top-topbar right-0 bottom-0 w-80 bg-bg-1 border-l border-border z-50 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="font-bold text-sm text-fg">
                {t("Action history")}
              </span>
              <ShadcnButton variant="ghost" size="icon-sm" onClick={closeModal} type="button" aria-label={t("Close action history")} title={t("Close action history")} className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent p-1.5 rounded hover:bg-hover text-fg-3 hover:text-fg transition-colors">
                {<X size={14} aria-hidden />}
              </ShadcnButton>
            </div>
            <div className="h-[calc(100%-49px)]">
              <HistoryPanel />
            </div>
          </div>
        </>
      )}
    </header>
  );
};
