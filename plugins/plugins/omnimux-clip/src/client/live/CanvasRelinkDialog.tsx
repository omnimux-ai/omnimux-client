import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "dsh-ui-kit";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@openreel/ui";
import { useEditorPortalRoot } from "@openreel/ui/lib/portal-root";
import { FolderOpen, RefreshCw, X } from "@/icons/lucide-compat";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../openreel/web/stores/project-store";
import { useVisibleEditorPane } from "../hooks/useVisibleEditorPane";
import { useClipT } from "../i18n/index.js";
import { useClipEditorActions } from "./EditorSeat.jsx";
import {
  ensureHostPlaceholderInStore,
  hydrateProjectMediaFromHost,
  type HostReconcileHandle,
} from "./bridged-media";
import "./canvas-relink-dialog.css";

interface ReconcileCandidate {
  sourceNodeId: string;
  outputIndex?: number;
  name?: string;
  materialType: MediaItem["type"];
  currentSha256?: string;
  durationMs?: number;
  canonicalHandle?: HostReconcileHandle;
}

interface ReconcileItemReport {
  mediaId: string;
  name: string;
  type: MediaItem["type"];
  reconcileState:
    | "online_exact"
    | "legacy_unsigned_exact"
    | "source_drifted"
    | "legacy_ambiguous"
    | "missing_unlinked";
  recoverable?: boolean;
  expectedSha256?: string;
  currentSha256?: string;
  canonicalHandle?: HostReconcileHandle;
  suggestedSourceNodeId?: string;
  suggestedOutputIndex?: number;
  candidates?: ReconcileCandidate[];
  reason?: string;
}

interface UnimportedUpstream {
  sourceNodeId: string;
  outputIndex: number;
  name: string;
  materialType: MediaItem["type"];
  durationMs?: number;
  currentSha256?: string;
  canonicalHandle?: HostReconcileHandle;
}

interface ReconcileReport {
  projectId: string;
  revision: number;
  items: ReconcileItemReport[];
  unimportedUpstreams: UnimportedUpstream[];
  upstreamSources?: ReconcileCandidate[];
}

export interface RelinkLibraryTarget {
  mediaId: string;
  name: string;
  type: MediaItem["type"];
}

interface CanvasRelinkDialogProps {
  open: boolean;
  focusedMediaId?: string | null;
  onClose: () => void;
  onRequestAssetLibraryRelink?: (target: RelinkLibraryTarget) => void;
  onFallbackLocalFolder?: () => void;
  restoreFocus?: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: ReconcileReport };

function formatDurationMs(durationMs: number | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const totalSec = Math.round(durationMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function shortSha(sha: string | undefined): string | null {
  if (!sha) return null;
  return sha.slice(0, 8);
}

function candidateKey(nodeId: string, outputIndex = 0): string {
  return `${nodeId}:${outputIndex}`;
}

export function CanvasRelinkDialog({
  open,
  focusedMediaId,
  onClose,
  onRequestAssetLibraryRelink,
  onFallbackLocalFolder,
  restoreFocus,
}: CanvasRelinkDialogProps) {
  const t = useClipT();
  const portal = useEditorPortalRoot();
  const pane = useVisibleEditorPane(open ? portal : null);
  const { inspectMediaReconcile, applyMediaReconcile, canRelinkMedia } = useClipEditorActions() as {
    inspectMediaReconcile?: () => Promise<ReconcileReport>;
    applyMediaReconcile?: (actions: unknown[]) => Promise<{
      projectId: string;
      result: ReconcileReport & { upgradedMediaIds?: string[]; importedMediaIds?: string[]; project?: { mediaLibrary?: { items?: MediaItem[] } } };
    }>;
    canRelinkMedia?: boolean;
  };
  const projectId = useProjectStore((s) => s.project.id);
  const actionExecutor = useProjectStore((s) => s.actionExecutor);
  const mediaItems = useProjectStore((s) => s.project.mediaLibrary.items);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const inspectRef = useRef(inspectMediaReconcile);
  inspectRef.current = inspectMediaReconcile;
  const tRef = useRef(t);
  tRef.current = t;

  const style = pane?.clipped
    ? {
        left: pane.left + pane.width / 2,
        top: pane.top + pane.height / 2,
        width: Math.max(0, pane.width - 24),
        maxHeight: Math.max(0, pane.height - 24),
      }
    : undefined;

  const isCurrentSession = useCallback(() => {
    const state = useProjectStore.getState();
    return open && state.project.id === projectId && state.actionExecutor === actionExecutor;
  }, [open, projectId, actionExecutor]);

  const loadReport = useCallback(async () => {
    const inspect = inspectRef.current;
    if (!open || !inspect || !canRelinkMedia) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadState({ status: "loading" });
    setRowErrors({});
    try {
      const report = await inspect();
      if (controller.signal.aborted) return;
      setLoadState({ status: "ready", report });
      setSelectedCandidates((prev) => {
        const next = { ...prev };
        for (const item of report.items) {
          if (next[item.mediaId]) continue;
          const matching = (item.candidates?.length ? item.candidates : report.upstreamSources ?? [])
            .filter((cand) => cand.materialType === item.type);
          if (item.suggestedSourceNodeId) {
            next[item.mediaId] = candidateKey(item.suggestedSourceNodeId, item.suggestedOutputIndex ?? 0);
          } else if (matching.length === 1) {
            next[item.mediaId] = candidateKey(matching[0].sourceNodeId, matching[0].outputIndex ?? 0);
          }
        }
        return next;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : tRef.current("Could not inspect canvas media sources."),
      });
    }
  }, [open, canRelinkMedia]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusyKey(null);
      return;
    }
    void loadReport();
    return () => {
      abortRef.current?.abort();
    };
  }, [open, reloadTick, loadReport]);

  const liveById = useMemo(
    () => new Map(mediaItems.map((item) => [item.id, item])),
    [mediaItems],
  );

  const report = loadState.status === "ready" ? loadState.report : null;

  const classified = useMemo(() => {
    if (!report) {
      return {
        actionable: [] as ReconcileItemReport[],
        online: [] as ReconcileItemReport[],
        autoRecoverable: [] as ReconcileItemReport[],
        driftedCount: 0,
        manualCount: 0,
      };
    }
    const actionable: ReconcileItemReport[] = [];
    const online: ReconcileItemReport[] = [];
    const autoRecoverable: ReconcileItemReport[] = [];
    let driftedCount = 0;
    let manualCount = 0;

    for (const item of report.items) {
      const live = liveById.get(item.mediaId);
      const clientOffline = live ? Boolean(live.isPlaceholder || !live.blob) : false;
      if (item.reconcileState === "online_exact" && !clientOffline) {
        online.push(item);
      } else {
        actionable.push(item);
        if (item.reconcileState === "legacy_unsigned_exact" || (item.reconcileState === "online_exact" && clientOffline)) {
          autoRecoverable.push(item);
        } else if (item.reconcileState === "source_drifted") {
          driftedCount += 1;
        } else {
          manualCount += 1;
        }
      }
    }

    if (focusedMediaId) {
      actionable.sort((a, b) => (a.mediaId === focusedMediaId ? -1 : b.mediaId === focusedMediaId ? 1 : 0));
    }

    return { actionable, online, autoRecoverable, driftedCount, manualCount };
  }, [report, liveById, focusedMediaId]);

  const setItemError = useCallback((key: string, message: string | null) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (!message) delete next[key];
      else next[key] = message;
      return next;
    });
  }, []);

  const runRecoverItem = useCallback(
    async (item: ReconcileItemReport) => {
      if (!applyMediaReconcile || !report) return;
      const controller = abortRef.current ?? new AbortController();
      setBusyKey(item.mediaId);
      setItemError(item.mediaId, null);
      try {
        let updatedReportItem: ReconcileItemReport = item;
        if (item.reconcileState === "legacy_unsigned_exact") {
          const applied = await applyMediaReconcile([{ mediaId: item.mediaId, action: "upgrade_legacy" }]);
          const found = applied.result.items?.find((row) => row.mediaId === item.mediaId);
          if (found) updatedReportItem = found;
        }
        const live = useProjectStore.getState().project.mediaLibrary.items.find((row) => row.id === item.mediaId);
        const hydrated = await hydrateProjectMediaFromHost({
          projectId: report.projectId,
          mediaId: item.mediaId,
          name: updatedReportItem.name,
          type: updatedReportItem.type,
          currentSha256: updatedReportItem.currentSha256,
          canonicalHandle: updatedReportItem.canonicalHandle,
          restorePlaceholder: Boolean(live?.isPlaceholder),
          signal: controller.signal,
          isCurrent: isCurrentSession,
        });
        if (!hydrated.success) {
          setItemError(item.mediaId, hydrated.error || t("Could not restore this media."));
          return;
        }
        setReloadTick((n) => n + 1);
      } catch (error) {
        setItemError(item.mediaId, error instanceof Error ? error.message : t("Could not restore this media."));
      } finally {
        setBusyKey(null);
      }
    },
    [applyMediaReconcile, report, isCurrentSession, setItemError, t],
  );

  const runAutoRecoverAll = useCallback(async () => {
    if (!applyMediaReconcile || !report || classified.autoRecoverable.length === 0) return;
    const controller = abortRef.current ?? new AbortController();
    setBusyKey("__auto__");
    setRowErrors({});
    try {
      const legacyActions = classified.autoRecoverable
        .filter((item) => item.reconcileState === "legacy_unsigned_exact")
        .map((item) => ({ mediaId: item.mediaId, action: "upgrade_legacy" }));
      let latestItems = report.items;
      if (legacyActions.length > 0) {
        const applied = await applyMediaReconcile(legacyActions);
        if (applied.result.items) latestItems = applied.result.items;
      }
      const byId = new Map(latestItems.map((row) => [row.mediaId, row]));
      for (const item of classified.autoRecoverable) {
        if (!isCurrentSession() || controller.signal.aborted) break;
        const resolved = byId.get(item.mediaId) ?? item;
        const live = useProjectStore.getState().project.mediaLibrary.items.find((row) => row.id === item.mediaId);
        const hydrated = await hydrateProjectMediaFromHost({
          projectId: report.projectId,
          mediaId: item.mediaId,
          name: resolved.name,
          type: resolved.type,
          currentSha256: resolved.currentSha256,
          canonicalHandle: resolved.canonicalHandle,
          restorePlaceholder: Boolean(live?.isPlaceholder),
          signal: controller.signal,
          isCurrent: isCurrentSession,
        });
        if (!hydrated.success) {
          setItemError(item.mediaId, hydrated.error || t("Could not restore this media."));
        }
      }
      setReloadTick((n) => n + 1);
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : t("Could not restore media."),
      });
    } finally {
      setBusyKey(null);
    }
  }, [applyMediaReconcile, report, classified.autoRecoverable, isCurrentSession, setItemError, t]);

  const runBindUpstream = useCallback(
    async (item: ReconcileItemReport, action: "accept_drift" | "rebind_upstream", nodeKey?: string) => {
      if (!applyMediaReconcile || !report) return;
      const controller = abortRef.current ?? new AbortController();
      setBusyKey(item.mediaId);
      setItemError(item.mediaId, null);
      try {
        let payload: Record<string, unknown>;
        if (action === "accept_drift") {
          payload = { mediaId: item.mediaId, action: "accept_drift" };
        } else {
          const chosen = nodeKey ?? selectedCandidates[item.mediaId];
          if (!chosen) {
            setItemError(item.mediaId, t("Choose an upstream canvas node first."));
            return;
          }
          const sep = chosen.lastIndexOf(":");
          const sourceNodeId = sep >= 0 ? chosen.slice(0, sep) : chosen;
          const outputIndex = sep >= 0 ? Number(chosen.slice(sep + 1)) || 0 : 0;
          payload = { mediaId: item.mediaId, action: "rebind_upstream", sourceNodeId, outputIndex };
        }
        const applied = await applyMediaReconcile([payload]);
        const updatedReportItem = applied.result.items?.find((row) => row.mediaId === item.mediaId) ?? item;
        const hydrated = await hydrateProjectMediaFromHost({
          projectId: report.projectId,
          mediaId: item.mediaId,
          name: updatedReportItem.name,
          type: updatedReportItem.type,
          currentSha256: updatedReportItem.currentSha256,
          canonicalHandle: updatedReportItem.canonicalHandle,
          // Explicit drift adoption / upstream rebind permits new content digest while preserving mediaId and clips.
          restorePlaceholder: false,
          signal: controller.signal,
          isCurrent: isCurrentSession,
        });
        if (!hydrated.success) {
          setItemError(item.mediaId, hydrated.error || t("Could not bind the selected upstream media."));
          return;
        }
        setReloadTick((n) => n + 1);
      } catch (error) {
        setItemError(item.mediaId, error instanceof Error ? error.message : t("Could not bind the selected upstream media."));
      } finally {
        setBusyKey(null);
      }
    },
    [applyMediaReconcile, report, selectedCandidates, isCurrentSession, setItemError, t],
  );

  const runImportUpstream = useCallback(
    async (upstream: UnimportedUpstream) => {
      if (!applyMediaReconcile || !report) return;
      const key = `import:${candidateKey(upstream.sourceNodeId, upstream.outputIndex)}`;
      const controller = abortRef.current ?? new AbortController();
      setBusyKey(key);
      setItemError(key, null);
      try {
        const applied = await applyMediaReconcile([
          { action: "import_upstream", sourceNodeId: upstream.sourceNodeId, outputIndex: upstream.outputIndex },
        ]);
        const importedId = applied.result.importedMediaIds?.[0];
        const hostItem = importedId
          ? applied.result.project?.mediaLibrary?.items?.find((row) => row.id === importedId)
          : undefined;
        const reportEntry = importedId
          ? applied.result.items?.find((row) => row.mediaId === importedId)
          : undefined;
        if (!importedId || !hostItem) {
          setItemError(key, t("Could not import the upstream media."));
          return;
        }
        ensureHostPlaceholderInStore(hostItem, isCurrentSession);
        const hydrated = await hydrateProjectMediaFromHost({
          projectId: report.projectId,
          mediaId: importedId,
          name: reportEntry?.name ?? upstream.name,
          type: reportEntry?.type ?? upstream.materialType,
          currentSha256: reportEntry?.currentSha256 ?? upstream.currentSha256,
          canonicalHandle: reportEntry?.canonicalHandle ?? upstream.canonicalHandle,
          restorePlaceholder: true,
          signal: controller.signal,
          isCurrent: isCurrentSession,
        });
        if (!hydrated.success) {
          setItemError(key, hydrated.error || t("Could not import the upstream media."));
          return;
        }
        setReloadTick((n) => n + 1);
      } catch (error) {
        setItemError(key, error instanceof Error ? error.message : t("Could not import the upstream media."));
      } finally {
        setBusyKey(null);
      }
    },
    [applyMediaReconcile, report, isCurrentSession, setItemError, t],
  );

  const stateBadge = (item: ReconcileItemReport) => {
    switch (item.reconcileState) {
      case "online_exact":
        return { label: t("Ready to restore"), tone: "info" as const };
      case "legacy_unsigned_exact":
        return { label: t("Auto-recoverable"), tone: "info" as const };
      case "source_drifted":
        return { label: t("Upstream updated"), tone: "warn" as const };
      case "legacy_ambiguous":
        return { label: t("Multiple candidates"), tone: "warn" as const };
      default:
        return { label: t("Source missing"), tone: "warn" as const };
    }
  };

  const stateDescription = (item: ReconcileItemReport) => {
    switch (item.reconcileState) {
      case "online_exact":
        return t("Verified source exists on host. Restore into the current browser cache.");
      case "legacy_unsigned_exact":
        return t("Uniquely matched to a connected canvas upstream node. Safe to back up and upgrade.");
      case "source_drifted":
        return t("The connected canvas upstream content changed (SHA-256 differs). Confirm before updating.");
      case "legacy_ambiguous":
        return t("Matched multiple upstream candidates. Select which canvas node to bind.");
      default:
        return t("Original file is unavailable. Rebind to an upstream canvas node or replace from Assets.");
    }
  };

  const unimportedCount = report?.unimportedUpstreams.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="clip-relink-dialog absolute flex max-w-none flex-col gap-0 overflow-hidden p-0"
        data-testid="canvas-relink-dialog"
        style={style}
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) return;
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div className="clip-relink-header">
          <div className="clip-relink-header-text">
            <DialogTitle>{t("Sync & Relink from Canvas")}</DialogTitle>
            <p className="clip-relink-subtitle">
              {t("Verify upstream canvas and project assets by SHA-256 while preserving timeline edits.")}
            </p>
          </div>
          <DialogClose asChild>
            <IconButton aria-label={t("Close")} size="sm">
              <X size={16} />
            </IconButton>
          </DialogClose>
        </div>

        {report && (
          <div className="clip-relink-summary">
            <div className="clip-relink-pills">
              <span className="clip-relink-pill" data-tone="ok">
                {t("Online {0}", [classified.online.length])}
              </span>
              {classified.autoRecoverable.length > 0 && (
                <span className="clip-relink-pill" data-tone="info">
                  {t("Recoverable {0}", [classified.autoRecoverable.length])}
                </span>
              )}
              {classified.driftedCount > 0 && (
                <span className="clip-relink-pill" data-tone="warn">
                  {t("Updated {0}", [classified.driftedCount])}
                </span>
              )}
              {classified.manualCount > 0 && (
                <span className="clip-relink-pill" data-tone="warn">
                  {t("Needs choice {0}", [classified.manualCount])}
                </span>
              )}
              {unimportedCount > 0 && (
                <span className="clip-relink-pill" data-tone="info">
                  {t("New upstream {0}", [unimportedCount])}
                </span>
              )}
            </div>
            <div className="clip-relink-actions">
              <Button
                size="xs"
                variant="outline"
                disabled={busyKey !== null}
                leadingIcon={<RefreshCw size={12} />}
                onClick={() => setReloadTick((n) => n + 1)}
              >
                {t("Refresh")}
              </Button>
              {classified.autoRecoverable.length > 0 && (
                <Button
                  size="xs"
                  variant="primary"
                  disabled={busyKey !== null}
                  onClick={() => void runAutoRecoverAll()}
                >
                  {busyKey === "__auto__"
                    ? t("Restoring…")
                    : t("Auto-recover ({0})", [classified.autoRecoverable.length])}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="clip-relink-body" aria-busy={loadState.status === "loading"}>
          {loadState.status === "loading" ? (
            <div className="clip-relink-message" role="status">
              <span>{t("Inspecting canvas upstream sources…")}</span>
            </div>
          ) : loadState.status === "error" ? (
            <div className="clip-relink-message">
              <span role="alert">{loadState.message}</span>
              <Button size="sm" variant="secondary" onClick={() => setReloadTick((n) => n + 1)}>
                {t("Retry")}
              </Button>
            </div>
          ) : (
            <>
              {classified.actionable.length === 0 && unimportedCount === 0 && classified.online.length === 0 ? (
                <div className="clip-relink-message">
                  <span>{t("No media items in this project yet.")}</span>
                </div>
              ) : null}

              {classified.actionable.length > 0 && (
                <>
                  <div className="clip-relink-section-title">
                    {t("Needs attention ({0})", [classified.actionable.length])}
                  </div>
                  {classified.actionable.map((item) => {
                    const badge = stateBadge(item);
                    const isBusy = busyKey !== null;
                    const rowError = rowErrors[item.mediaId];
                    const matchingCandidates = (
                      item.candidates && item.candidates.length > 0
                        ? item.candidates
                        : report?.upstreamSources ?? []
                    ).filter((cand) => cand.materialType === item.type);
                    const chosenKey = selectedCandidates[item.mediaId] ?? "";

                    return (
                      <div
                        key={item.mediaId}
                        className="clip-relink-row"
                        data-focused={focusedMediaId === item.mediaId ? "true" : undefined}
                        data-reconcile-state={item.reconcileState}
                      >
                        <div className="clip-relink-row-head">
                          <div className="clip-relink-row-info">
                            <div className="clip-relink-row-title" title={item.name}>
                              {item.name}
                            </div>
                            <div className="clip-relink-row-meta">{stateDescription(item)}</div>
                          </div>
                          <span className="clip-relink-pill" data-tone={badge.tone}>
                            {badge.label}
                          </span>
                        </div>

                        {(item.reconcileState === "legacy_unsigned_exact" ||
                          item.reconcileState === "online_exact") && (
                          <div className="clip-relink-actions">
                            <Button
                              size="xs"
                              variant="primary"
                              disabled={isBusy}
                              onClick={() => void runRecoverItem(item)}
                            >
                              {busyKey === item.mediaId ? t("Restoring…") : t("Restore media")}
                            </Button>
                          </div>
                        )}

                        {item.reconcileState === "source_drifted" && (
                          <div className="clip-relink-actions">
                            <Button
                              size="xs"
                              variant="primary"
                              disabled={isBusy}
                              onClick={() => void runBindUpstream(item, "accept_drift")}
                            >
                              {busyKey === item.mediaId ? t("Updating…") : t("Use latest canvas version")}
                            </Button>
                            {onRequestAssetLibraryRelink && (
                              <Button
                                size="xs"
                                variant="secondary"
                                disabled={isBusy}
                                onClick={() =>
                                  onRequestAssetLibraryRelink({
                                    mediaId: item.mediaId,
                                    name: item.name,
                                    type: item.type,
                                  })
                                }
                              >
                                {t("Replace from Assets…")}
                              </Button>
                            )}
                          </div>
                        )}

                        {(item.reconcileState === "legacy_ambiguous" ||
                          item.reconcileState === "missing_unlinked") && (
                          <>
                            {matchingCandidates.length > 0 && (
                              <div className="clip-relink-candidates" role="radiogroup" aria-label={item.name}>
                                {matchingCandidates.map((cand) => {
                                  const key = candidateKey(cand.sourceNodeId, cand.outputIndex ?? 0);
                                  const selected = chosenKey === key;
                                  const metaParts = [
                                    formatDurationMs(cand.durationMs),
                                    shortSha(cand.currentSha256),
                                  ].filter(Boolean);
                                  return (
                                    <label
                                      key={key}
                                      className="clip-relink-candidate"
                                      data-selected={selected ? "true" : "false"}
                                    >
                                      <span className="clip-relink-candidate-label">
                                        <input
                                          type="radio"
                                          name={`relink-cand-${item.mediaId}`}
                                          checked={selected}
                                          disabled={isBusy}
                                          onChange={() =>
                                            setSelectedCandidates((prev) => ({
                                              ...prev,
                                              [item.mediaId]: key,
                                            }))
                                          }
                                        />
                                        <span>{cand.name || cand.sourceNodeId}</span>
                                      </span>
                                      {metaParts.length > 0 && (
                                        <span className="clip-relink-candidate-meta">{metaParts.join(" · ")}</span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                            <div className="clip-relink-actions">
                              {matchingCandidates.length > 0 && (
                                <Button
                                  size="xs"
                                  variant="primary"
                                  disabled={isBusy || !chosenKey}
                                  onClick={() => void runBindUpstream(item, "rebind_upstream", chosenKey)}
                                >
                                  {busyKey === item.mediaId ? t("Binding…") : t("Bind selected upstream")}
                                </Button>
                              )}
                              {onRequestAssetLibraryRelink && (
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  disabled={isBusy}
                                  onClick={() =>
                                    onRequestAssetLibraryRelink({
                                      mediaId: item.mediaId,
                                      name: item.name,
                                      type: item.type,
                                    })
                                  }
                                >
                                  {t("Replace from Assets…")}
                                </Button>
                              )}
                            </div>
                          </>
                        )}

                        {rowError && (
                          <p className="clip-relink-row-error" role="alert">
                            {rowError}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {report && report.unimportedUpstreams.length > 0 && (
                <>
                  <div className="clip-relink-section-title">
                    {t("New upstream canvas media ({0})", [report.unimportedUpstreams.length])}
                  </div>
                  {report.unimportedUpstreams.map((upstream) => {
                    const key = `import:${candidateKey(upstream.sourceNodeId, upstream.outputIndex)}`;
                    const metaParts = [
                      t("Connected on canvas, not yet in this clip project"),
                      formatDurationMs(upstream.durationMs),
                      shortSha(upstream.currentSha256),
                    ].filter(Boolean);
                    return (
                      <div key={key} className="clip-relink-row">
                        <div className="clip-relink-row-head">
                          <div className="clip-relink-row-info">
                            <div className="clip-relink-row-title" title={upstream.name}>
                              {upstream.name}
                            </div>
                            <div className="clip-relink-row-meta">{metaParts.join(" · ")}</div>
                          </div>
                          <Button
                            size="xs"
                            variant="primary"
                            disabled={busyKey !== null}
                            onClick={() => void runImportUpstream(upstream)}
                          >
                            {busyKey === key ? t("Importing…") : t("Import to pool")}
                          </Button>
                        </div>
                        {rowErrors[key] && (
                          <p className="clip-relink-row-error" role="alert">
                            {rowErrors[key]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {classified.online.length > 0 && (
                <>
                  <div className="clip-relink-section-title">
                    {t("Online media ({0})", [classified.online.length])}
                  </div>
                  {classified.online.map((item) => (
                    <div key={item.mediaId} className="clip-relink-row">
                      <div className="clip-relink-row-head">
                        <div className="clip-relink-row-info">
                          <div className="clip-relink-row-title" title={item.name}>
                            {item.name}
                          </div>
                          <div className="clip-relink-row-meta">
                            {[item.canonicalHandle?.scope, shortSha(item.currentSha256)].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <span className="clip-relink-pill" data-tone="ok">
                          {t("Online")}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        <div className="clip-relink-footer">
          <span>{t("Supports canvas upstream, Asset Library, and local folders")}</span>
          <div className="clip-relink-actions">
            {onFallbackLocalFolder && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyKey !== null}
                leadingIcon={<FolderOpen size={13} />}
                onClick={() => {
                  onClose();
                  onFallbackLocalFolder();
                }}
              >
                {t("From local folder…")}
              </Button>
            )}
            <DialogClose asChild>
              <Button size="sm" variant="primary">
                {t("Done")}
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
