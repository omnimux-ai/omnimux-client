import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { importBridgedMedia, type MediaBridgeItem } from "../../../../live/bridged-media";
import type { ActionExecutorLike } from "../../services/lazy-action-executor";

interface EditorMediaSeat {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

interface BridgeImportOptions {
  projectId: string;
  actionExecutor: ActionExecutorLike;
  canBridgeMedia?: boolean;
  captureMediaEditor?: () => EditorMediaSeat | undefined;
  returnedMedia?: { id: string; items: readonly MediaBridgeItem[] };
  acknowledgeReturnedMedia?: (id: string) => void;
}

export interface BridgeImportProgress {
  done: number;
  total: number;
}

export function useBridgedMediaImport({
  projectId, actionExecutor, canBridgeMedia, captureMediaEditor, returnedMedia, acknowledgeReturnedMedia,
}: BridgeImportOptions) {
  const active = useRef<AbortController | null>(null);
  const acknowledgedReturn = useRef<string | undefined>(undefined);
  const [progress, setProgress] = useState<BridgeImportProgress | null>(null);
  const [failed, setFailed] = useState(() => new Map<string, MediaBridgeItem>());
  const [highlighted, setHighlighted] = useState(() => new Set<string>());
  const busy = progress !== null;

  useLayoutEffect(() => {
    setProgress(null);
    setFailed(new Map());
    setHighlighted(new Set());
    acknowledgedReturn.current = undefined;
    return () => {
      const controller = active.current;
      active.current = null;
      controller?.abort();
    };
  }, [projectId, actionExecutor]);

  const start = useCallback((items: readonly MediaBridgeItem[], onDone?: () => void) => {
    if (!canBridgeMedia || active.current || !items.length) return false;
    const seat = captureMediaEditor?.();
    if (!seat || seat.signal.aborted || !seat.isCurrent()) return false;

    // Lock before the first await and before React paints disabled controls.
    const controller = new AbortController();
    active.current = controller;
    const signal = AbortSignal.any([controller.signal, seat.signal]);
    const isCurrent = () => active.current === controller && !signal.aborted && seat.isCurrent();
    const pending = new Map(items.map(item => [item.id, item]));
    const total = pending.size;
    setProgress({ done: 0, total });

    const release = () => {
      if (active.current !== controller) return;
      active.current = null;
      setProgress(null);
    };
    signal.addEventListener("abort", release, { once: true });

    const onItem: NonNullable<Parameters<typeof importBridgedMedia>[1]["onItem"]> = ({ id, status, mediaId }) => {
      if (!isCurrent() || status === "reading") return;
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      setProgress({ done: total - pending.size, total });
      setFailed(previous => {
        if (status !== "failed" && !previous.has(id)) return previous;
        const next = new Map(previous);
        if (status === "failed") next.set(id, item);
        else next.delete(id);
        return next;
      });
      if (status === "imported" && mediaId) {
        setHighlighted(previous => new Set(previous).add(mediaId));
      }
    };

    const finish = () => {
      signal.removeEventListener("abort", release);
      if (isCurrent()) {
        // Transport failure or an incomplete importer result still yields retryable rows.
        for (const id of pending.keys()) onItem({ id, status: "failed" });
        onDone?.();
      }
      release();
    };
    void importBridgedMedia([...pending.values()], { signal, isCurrent, onItem }).then(finish, finish);
    return true;
  }, [canBridgeMedia, captureMediaEditor]);

  // AssetsPanel stays mounted while the user is on another editor tab. Let the
  // same importer finish in the background and retain its media-bin feedback.
  useEffect(() => {
    if (!returnedMedia || !acknowledgeReturnedMedia || busy || returnedMedia.id === acknowledgedReturn.current) return;
    const { id, items } = returnedMedia;
    start(items, () => {
      acknowledgedReturn.current = id;
      acknowledgeReturnedMedia(id);
    });
  }, [returnedMedia, acknowledgeReturnedMedia, busy, start]);

  return { busy, progress, failed, highlighted, start };
}
