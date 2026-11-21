import React from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from "@openreel/ui";
import {
  Copy,
  Layers,
  Trash2,
  Scissors,
  Music,
  Sparkles,
  Volume2,
  Film,
  Image,
  ArrowLeftToLine,
  ArrowRightToLine,
  ListChecks,
  SplitSquareVertical,
  Crosshair,
  FolderSearch,
  Tag,
} from "@/icons/lucide-compat";
import { findLinkedPartners, type Clip, type Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineTrackSelection } from "../../../utils/timeline-item-actions";
import { editableTimelineIds, editTimelineSelection } from "../../../services/linked-timeline-edit";
import { getEditableTimelineSelection, getLinkedTimelineSelection } from "../../../utils/linked-timeline-selection";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { toast } from "../../../stores/notification-store";
import { useSceneDetectionDialogStore } from "../../../stores/scene-detection-dialog-store";
import { isReversedClip } from "../../../services/scene-detection";
import { addEditToAllTracks, matchFrame, runWithToast } from "../../../services/premiere-edit-commands";
import { LINKED_BAKE_CLIP_KEY } from "@openreel/core";
import { restoreUnrenderedCommand } from "../../../services/linked-comp-commands";
import { extendSelectedEdit, makeSplitEdit } from "../../../services/split-edit-commands";
import { makeSubclipFromClip, revealClipInProject, runOrganize, setClipLabel } from "../../../services/project-panel-commands";
import { LabelPickerItems } from "../project-panel/ProjectPanelMenus";
import { AUDIO_TYPES, AUDIO_TYPE_LABELS, resolveClipLabel } from "@openreel/core";
import { clearEssentialSound, tagAudioType } from "../../../services/essential-sound";
import { nestSelectedClips, openNestClip } from "../../../services/sequence-commands";
import { clipNow } from "../../../../../i18n/index.js";
import { useClipT } from "../../../../../i18n/index.js";

/** Clip ids a label change applies to: the selected timeline clips when this one is among them. */
function clipLabelTargets(clipId: string): string[] {
  const clips = new Set(useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const selected = useUIStore.getState().selectedItems.map((s) => s.id).filter((id) => clips.has(id));
  return selected.includes(clipId) ? selected : [clipId];
}

interface ClipContextMenuProps {
  clip: Clip;
  track: Track;
  onClose?: () => void;
}

export function ClipContextMenu({
  clip,
  track,
  onClose,
}: ClipContextMenuProps) {
  const t = useClipT();
  const {
    project,
    copyClips,
    separateAudio,
    getMediaItem,
    copyEffects,
    pasteEffects,
    copiedEffects,
    closeGapBeforeClip,
  } = useProjectStore(useShallow((state) => ({
    project: state.project,
    copyClips: state.copyClips,
    separateAudio: state.separateAudio,
    getMediaItem: state.getMediaItem,
    copyEffects: state.copyEffects,
    pasteEffects: state.pasteEffects,
    copiedEffects: state.copiedEffects,
    closeGapBeforeClip: state.closeGapBeforeClip,
  })));
  const ownerProjectId = React.useRef(project.id);
  const selectMultiple = useUIStore((state) => state.selectMultiple);
  const linkedSelection = useEditorWorkspaceStore((state) => state.linkedSelection);
  const editable = getEditableTimelineSelection(project, [clip.id], linkedSelection);
  const exporting = useUIStore(state => state.exportState.isExporting);
  const operationLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const editingDisabled = track.locked || editable.blocked || exporting || operationLocked;
  const canAct = (edit = false) => {
    const state = useProjectStore.getState();
    if (state.project.id !== ownerProjectId.current || !state.getClip(clip.id)) return false;
    return !edit || (!useUIStore.getState().exportState.isExporting
      && !useTimelineStore.getState().playbackLockedReason
      && getEditableTimelineSelection(state.project, [clip.id], useEditorWorkspaceStore.getState().linkedSelection).ids.includes(clip.id));
  };

  const isPlayheadOnClip = useTimelineStore((state) =>
    state.playheadPosition > clip.startTime &&
    state.playheadPosition < clip.startTime + clip.duration,
  );

  const hasGapBeforeClip = React.useMemo(() => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const idx = sorted.findIndex((c) => c.id === clip.id);
    if (idx < 0) return false;
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const target = prev ? prev.startTime + prev.duration : 0;
    return clip.startTime - target > 0.0001;
  }, [track.clips, clip.id, clip.startTime]);

  const mediaItem = getMediaItem(clip.mediaId);
  const clipMediaType = track.type === "audio" ? "audio" : mediaItem?.type ?? track.type;
  const isVideo = clipMediaType === "video";
  const isAudio = clipMediaType === "audio";
  const isImage = clipMediaType === "image";
  const isVideoWithAudio =
    isVideo &&
    mediaItem?.type === "video" &&
    mediaItem?.metadata?.channels &&
    mediaItem.metadata.channels > 0;

  const splitEditFrames = useEditorWorkspaceStore((state) => state.splitEditFrames);
  const hasLinkedPartner = React.useMemo(
    () => findLinkedPartners(clip, project.timeline.tracks).length > 0,
    [clip, project.timeline.tracks],
  );
  const hasEffects = clip.effects && clip.effects.length > 0;
  const hasCopiedEffects = copiedEffects && copiedEffects.length > 0;

  const handleCopy = () => {
    if (!canAct()) return;
    copyClips(getLinkedTimelineSelection(useProjectStore.getState().project, [clip.id], useEditorWorkspaceStore.getState().linkedSelection));
    onClose?.();
  };

  const handleDuplicate = async () => {
    if (!canAct(true)) return;
    await editTimelineSelection([clip.id], "duplicate");
    onClose?.();
  };

  const handleSelectTrackClips = () => {
    if (!canAct()) return;
    const project = useProjectStore.getState().getFullProject();
    selectMultiple(getTimelineTrackSelection(project, track.id));
    onClose?.();
  };

  const handleDelete = async () => {
    if (!canAct(true)) return;
    await editTimelineSelection([clip.id], "delete");
    onClose?.();
  };

  const handleRippleDelete = async () => {
    if (!canAct(true)) return;
    await editTimelineSelection([clip.id], "ripple");
    onClose?.();
  };

  const handleSplit = async () => {
    if (!canAct(true)) return;
    const playheadPosition = useTimelineStore.getState().playheadPosition;
    if (
      playheadPosition >= clip.startTime &&
      playheadPosition <= clip.startTime + clip.duration
    ) {
      await editTimelineSelection([clip.id], "split", playheadPosition);
    }
    onClose?.();
  };

  const handleCloseGap = async () => {
    if (!canAct(true)) return;
    if (!editableTimelineIds([clip.id]).length) return;
    // One sync-lock aware ripple: a linked partner and every other sync-locked
    // track close the same gap, or the edit is blocked and says which track.
    const result = await closeGapBeforeClip(clip.id);
    if (!result.success) toast.warning(clipNow()("Close gap"), result.error?.message ?? clipNow()("The gap could not be closed."));
    onClose?.();
  };

  const handleSeparateAudio = async () => {
    if (!canAct(true)) return;
    onClose?.();
    const result = await separateAudio(clip.id);
    if (!result.success) {
      toast.error(clipNow()("Could not separate audio"), result.error?.message);
    }
  };

  const handleCopyEffects = () => {
    if (!canAct()) return;
    copyEffects(clip.id);
    onClose?.();
  };

  const handlePasteEffects = async () => {
    if (!canAct(true)) return;
    await pasteEffects(clip.id);
    onClose?.();
  };

  const handleSceneDetection = () => {
    if (!canAct(true)) return;
    onClose?.();
    useSceneDetectionDialogStore.getState().open(clip.id);
  };

  const getClipTypeLabel = () => {
    if (isVideo) return "Video Clip";
    if (isAudio) return "Audio Clip";
    if (isImage) return "Image Clip";
    return "Clip";
  };

  const getClipTypeIcon = () => {
    if (isVideo) return <Film size={14} className="text-primary" aria-hidden />;
    if (isAudio) return <Volume2 size={14} className="text-blue-400" aria-hidden />;
    if (isImage) return <Image size={14} className="text-primary" aria-hidden />;
    return null;
  };

  return (
    <ContextMenuContent className="w-[220px] [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:text-xs"
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <ContextMenuLabel className="flex items-center gap-2 text-xs">{getClipTypeIcon()}{getClipTypeLabel()}</ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleCopy}><Copy size={14} aria-hidden />{t("Copy Clip")}</ContextMenuItem>
      <ContextMenuItem disabled={editingDisabled} onSelect={() => void handleDuplicate()}><Layers size={14} aria-hidden />{t("Duplicate")}</ContextMenuItem>
      <ContextMenuItem onSelect={handleSelectTrackClips}><ListChecks size={14} aria-hidden />{t("Select All Clips on Track")}</ContextMenuItem>
      <ContextMenuSeparator />
      {(clip.metadata?.compoundClipId !== undefined || clip.mediaId.startsWith("compound:")) && (
        <ContextMenuItem data-testid="open-nested-sequence" onSelect={() => { void openNestClip(clip.id); onClose?.(); }}><Layers size={14} aria-hidden />{t("Open Nested Sequence")}</ContextMenuItem>
      )}
      {typeof clip.metadata?.[LINKED_BAKE_CLIP_KEY] === "string" && (
        <ContextMenuItem data-testid="restore-unrendered-menu" disabled={editingDisabled} onSelect={() => { void restoreUnrenderedCommand(String(clip.metadata?.[LINKED_BAKE_CLIP_KEY])); onClose?.(); }}><Layers size={14} aria-hidden />{t("Restore Unrendered")}</ContextMenuItem>
      )}
      <ContextMenuItem data-testid="nest-clips" disabled={editingDisabled} onSelect={() => {
        if (!useUIStore.getState().getSelectedClipIds().includes(clip.id)) useUIStore.getState().select({ type: "clip", id: clip.id });
        void nestSelectedClips();
        onClose?.();
      }}><Layers size={14} aria-hidden />{t("Nest")}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={editingDisabled || !isPlayheadOnClip} onSelect={() => void handleSplit()}><Scissors size={14} aria-hidden />{t("Split at Playhead")}</ContextMenuItem>
      <ContextMenuItem disabled={editingDisabled || !hasGapBeforeClip} onSelect={() => void handleCloseGap()}><ArrowLeftToLine size={14} aria-hidden />{t("Close Gap to Previous")}</ContextMenuItem>
      <ContextMenuItem disabled={editingDisabled || !isPlayheadOnClip} onSelect={() => { runWithToast("Add edit", addEditToAllTracks); onClose?.(); }}><SplitSquareVertical size={14} aria-hidden />{t("Add Edit to All Tracks")}</ContextMenuItem>
      <ContextMenuItem disabled={!isPlayheadOnClip} onSelect={() => { runWithToast("Match frame", () => matchFrame(clip.id)); onClose?.(); }}><Crosshair size={14} aria-hidden />{t("Match Frame")}</ContextMenuItem>
      {hasLinkedPartner && <>
        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs">{t("Split edit")}</ContextMenuLabel>
        <ContextMenuItem disabled={editingDisabled} onSelect={() => { runWithToast("J-cut", () => makeSplitEdit("j", { clipId: clip.id })); onClose?.(); }}><ArrowLeftToLine size={14} aria-hidden />{t("J-cut: audio leads")} {splitEditFrames}{t("f")}</ContextMenuItem>
        <ContextMenuItem disabled={editingDisabled} onSelect={() => { runWithToast("L-cut", () => makeSplitEdit("l", { clipId: clip.id })); onClose?.(); }}><ArrowRightToLine size={14} aria-hidden />{t("L-cut: audio trails")} {splitEditFrames}{t("f")}</ContextMenuItem>
        <ContextMenuItem disabled={editingDisabled} onSelect={() => { useUIStore.getState().select({ type: "clip", id: clip.id }); runWithToast("Extend edit", () => extendSelectedEdit("both")); onClose?.(); }}><Crosshair size={14} aria-hidden />{t("Extend edit to playhead")}</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><SplitSquareVertical size={14} aria-hidden />{t("Split edit length")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup value={String(splitEditFrames)} onValueChange={(value) => useEditorWorkspaceStore.getState().setSplitEditFrames(Number(value))}>
              {[6, 12, 24, 48].map((frames) => <ContextMenuRadioItem key={frames} value={String(frames)}>{frames} {t("frames")}</ContextMenuRadioItem>)}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </>}
      <ContextMenuItem data-testid="clip-reveal-in-project" onSelect={() => { runWithToast("Reveal in Project", () => revealClipInProject(clip.id)); onClose?.(); }}><FolderSearch size={14} aria-hidden />{t("Reveal in Project")}</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger data-testid="clip-label-menu"><Tag size={14} aria-hidden />{t("Label")}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-[320px] overflow-auto [&_[role=menuitem]]:text-xs">
          <LabelPickerItems
            kind="context"
            current={resolveClipLabel(clip, mediaItem)}
            onPick={(label) => { void runOrganize("Set clip label", setClipLabel(clipLabelTargets(clip.id), label)); onClose?.(); }}
            onInherit={() => { void runOrganize("Set clip label", setClipLabel(clipLabelTargets(clip.id), "inherit")); onClose?.(); }}
          />
        </ContextMenuSubContent>
      </ContextMenuSub>
      {(isVideo || isAudio) && <ContextMenuItem data-testid="clip-make-subclip" onSelect={() => { void makeSubclipFromClip(clip.id).then((outcome) => { if (!outcome.success) toast.warning(clipNow()("Make Subclip"), outcome.message); else toast.info(clipNow()("Make Subclip"), outcome.message); }); onClose?.(); }}><Scissors size={14} aria-hidden />{t("Make Subclip")}</ContextMenuItem>}
      {(isVideo || isImage || isAudio) && <>
        <ContextMenuSeparator />
        <ContextMenuLabel className="text-xs">{isAudio ? t("Audio") : t("Effects")}</ContextMenuLabel>
        <ContextMenuItem disabled={!hasEffects} onSelect={handleCopyEffects}><Sparkles size={14} aria-hidden />{isAudio ? t("Copy Audio Effects") : t("Copy Effects")}</ContextMenuItem>
        <ContextMenuItem disabled={editingDisabled || !hasCopiedEffects} onSelect={() => void handlePasteEffects()}><Sparkles size={14} aria-hidden />{isAudio ? t("Paste Audio Effects") : t("Paste Effects")}</ContextMenuItem>
      </>}
      {(isAudio || isVideoWithAudio) && (
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="clip-audio-type-menu" disabled={editingDisabled}><Volume2 size={14} aria-hidden />{t("Set Audio Type")}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="[&_[role=menuitem]]:text-xs">
            {AUDIO_TYPES.map((type) => (
              <ContextMenuItem
                key={type}
                data-testid={`clip-audio-type-${type}`}
                onSelect={() => {
                  if (!canAct(true)) return;
                  const targets = clipLabelTargets(clip.id);
                  onClose?.();
                  tagAudioType(targets, type).catch((error: unknown) => toast.warning(clipNow()("Set Audio Type"), error instanceof Error ? error.message : clipNow()("The audio type could not be set.")));
                }}
              >
                {AUDIO_TYPE_LABELS[type]}{clip.audioType === type ? " ✓" : ""}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem
              data-testid="clip-audio-type-clear"
              disabled={!clip.audioType}
              onSelect={() => {
                if (!canAct(true)) return;
                const targets = clipLabelTargets(clip.id);
                onClose?.();
                clearEssentialSound(targets).catch((error: unknown) => toast.warning(clipNow()("Clear Audio Type"), error instanceof Error ? error.message : clipNow()("The audio type could not be cleared.")));
              }}
            >
              {t("Clear Audio Type")}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {isVideoWithAudio && <ContextMenuItem disabled={editingDisabled} onSelect={() => void handleSeparateAudio()}><Music size={14} aria-hidden />{t("Separate Audio")}</ContextMenuItem>}
      {isVideo && mediaItem?.type === "video" && <ContextMenuItem disabled={editingDisabled || isReversedClip(clip)} onSelect={handleSceneDetection}><Film size={14} aria-hidden />{t("Detect Scene Edits…")}</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={editingDisabled} onSelect={() => void handleRippleDelete()}><Trash2 size={14} aria-hidden />{t("Ripple Delete")}</ContextMenuItem>
      <ContextMenuItem disabled={editingDisabled} onSelect={() => void handleDelete()}><Trash2 size={14} aria-hidden />Delete</ContextMenuItem>
    </ContextMenuContent>
  );
}
