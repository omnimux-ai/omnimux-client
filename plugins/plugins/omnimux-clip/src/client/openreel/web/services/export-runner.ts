import { getActiveClipSession } from "../../../stage-store.js";
import { cancelClipExport, reserveCanvasExport, uploadClipExport } from "../../../live/export-transport.js";
import { cloneProjectSnapshot } from "../../core/export/project-snapshot";
import { useProjectStore } from "../stores/project-store";
import {
  createSilentCanvasWritable,
  isCanvasClipExportSession,
} from "../../../export-canvas-mode.js";
import { createWritableCapture, type WritableLike } from "./export-write-buffer";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureProjectFonts } from "./project-fonts";
import { toast } from "../stores/notification-store";
import { createExportFrameSource, getUseExportPreviews } from "./export-queue/export-queue-activity";
import {
  describeExportSource,
  getExportEngine,
  type VideoExportSettings,
  type AudioExportSettings,
  type Project,
} from "@openreel/core";
import { getEncoderBackendFactory, setEncoderBackendFactory } from "@openreel/core/export/encoder-backend";
import { clipNow } from "../../../i18n/index.js";

let nativeVideoRender: Promise<void> | undefined;
let standaloneVideoRenders = 0;

/** Agent and canvas exports share OpenReel's compositor until encoding finishes. */
export function tryLockNativeVideoRender(): (() => void) | undefined {
  if (nativeVideoRender || standaloneVideoRenders > 0) return undefined;
  let finish!: () => void;
  nativeVideoRender = new Promise((resolve) => { finish = resolve; });
  return () => {
    nativeVideoRender = undefined;
    finish();
  };
}

/** Wait before loading a different project into the shared compositor. */
export function waitForNativeExportRender(): Promise<void> | undefined {
  return nativeVideoRender;
}

export function startWebCodecsVideoExport(generator: ReturnType<ReturnType<typeof getExportEngine>["exportVideo"]>) {
  // OpenReel selects the backend synchronously before its first yield. Scope
  // the browser backend to that step so it cannot alter a manual export.
  const previous = getEncoderBackendFactory();
  setEncoderBackendFactory(null);
  try {
    return generator.next();
  } finally {
    setEncoderBackendFactory(previous);
  }
}

export interface ExportRunnerState {
  isExporting: boolean;
  canvasReserved: boolean;
  savingToCanvas: boolean;
  progress: number;
  phase: string;
  error: string | null;
  complete: boolean;
}

type ExportContainer = "mp4" | "webm" | "mov" | "mxf" | "mkv" | "wav" | "ac3" | "ec3";
export type ExportDeliveryMode = "download" | "file";

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mxf: "application/mxf",
  mkv: "video/x-matroska",
  wav: "audio/wav",
  ac3: "audio/ac3",
  ec3: "audio/eac3",
};

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function extForFormat(format: string, codec?: string): ExportContainer {
  if (format === "mxf") return "mxf";
  if (codec === "prores") return "mov";
  if (format === "mov") return "mov";
  if (format === "webm") return "webm";
  if (format === "wav") return "wav";
  if (format === "mkv") return "mkv";
  if (format === "ac3") return "ac3";
  if (format === "eac3") return "ec3";
  return "mp4";
}

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;

function sanitizeFilenameBase(name: string): string {
  const withoutControls = Array.from(name, (ch) =>
    ch.charCodeAt(0) < 0x20 ? " " : ch,
  ).join("");
  return withoutControls
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 200)
    .trim();
}

export function exportFilename(projectName: string | undefined, ext: string): string {
  const cleaned = projectName ? sanitizeFilenameBase(projectName) : "";
  const base = cleaned.length > 0 ? cleaned : "export";
  return `${base}.${ext}`;
}

export async function writeBlobToWritable(
  blob: Blob,
  writable: FileSystemWritableFileStream,
): Promise<void> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) await writable.write(value);
    }
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      void 0;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Drain audio exports with the same cancellation and generator cleanup as video. */
export async function runAudioExportToWritable(
  project: Project,
  settings: Partial<AudioExportSettings>,
  writable: FileSystemWritableFileStream,
  options: { assertNotCancelled: () => void; reportProgress: (progress: number, phase: string) => void },
): Promise<void> {
  const engine = getExportEngine();
  let generator: ReturnType<typeof engine.exportAudio> | undefined;
  try {
    await engine.initialize();
    options.assertNotCancelled();
    generator = engine.exportAudio(project, settings);
    for (;;) {
      const { value, done } = await generator.next();
      options.assertNotCancelled();
      if (done) {
        if (!value.success || !value.blob) {
          if (value.error?.code === "CANCELLED") throw new DOMException("Export cancelled", "AbortError");
          throw new Error(value.error?.message || "Audio export failed");
        }
        await writeBlobToWritable(value.blob, writable);
        options.assertNotCancelled();
        return;
      }
      options.reportProgress(value.progress, value.phase);
    }
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  } finally {
    try { await generator?.return({ success: false }); } catch { /* Preserve the original failure. */ }
  }
}

function progressPhaseLabel(phase: string): string {
  return phase === "complete" ? "Complete!" : `${phase}...`;
}

function triggerAnchorDownload(data: Blob, filename: string, onRelease?: () => void): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    window.removeEventListener("pagehide", release);
    URL.revokeObjectURL(url);
    onRelease?.();
  };
  // Give the browser time to retain large downloads before releasing the file.
  const timer = setTimeout(release, 60_000);
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    window.addEventListener("pagehide", release, { once: true });
  } catch (error) {
    release();
    throw error;
  } finally {
    anchor.remove();
  }
}

const OPFS_TMP_PREFIX = ".openreel-export-";
const OPFS_TMP_TTL_MS = 60 * 60 * 1000;

type OpfsWriteHandle = FileSystemFileHandle & {
  createWritable?: (opts?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>;
};

type OpfsDirHandle = FileSystemDirectoryHandle & {
  keys?: () => AsyncIterableIterator<string>;
};

async function getOpfsRoot(): Promise<OpfsDirHandle | null> {
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<OpfsDirHandle>;
    };
    if (!storage || typeof storage.getDirectory !== "function") return null;
    return await storage.getDirectory();
  } catch {
    return null;
  }
}

async function sweepStaleOpfsTemps(root: OpfsDirHandle, now: number): Promise<void> {
  if (typeof root.keys !== "function") return;
  try {
    const stale: string[] = [];
    for await (const name of root.keys()) {
      if (!name.startsWith(OPFS_TMP_PREFIX)) continue;
      const stamp = Number(name.slice(OPFS_TMP_PREFIX.length).split("-")[0]);
      if (Number.isFinite(stamp) && now - stamp > OPFS_TMP_TTL_MS) stale.push(name);
    }
    for (const name of stale) {
      await root.removeEntry(name).catch(() => undefined);
    }
  } catch {
    void 0;
  }
}

async function createOpfsDownloadWritable(
  filename: string,
): Promise<FileSystemWritableFileStream | null> {
  const root = await getOpfsRoot();
  if (!root) return null;

  const now = Date.now();
  await sweepStaleOpfsTemps(root, now);

  const tmpName = `${OPFS_TMP_PREFIX}${now}-${Math.random().toString(36).slice(2)}.tmp`;
  let fileHandle: OpfsWriteHandle;
  let writable: FileSystemWritableFileStream;
  try {
    fileHandle = (await root.getFileHandle(tmpName, { create: true })) as OpfsWriteHandle;
    if (typeof fileHandle.createWritable !== "function") {
      await root.removeEntry(tmpName).catch(() => undefined);
      return null;
    }
    writable = await fileHandle.createWritable({ keepExistingData: false });
  } catch (error) {
    await root.removeEntry(tmpName).catch(() => undefined);
    console.warn("[export-runner] OPFS streaming unavailable; using in-memory fallback", error);
    return null;
  }

  return {
    async seek(position: number) {
      await writable.seek(position);
    },
    async write(data: unknown) {
      await writable.write(data as Parameters<typeof writable.write>[0]);
    },
    async truncate(size: number) {
      await writable.truncate(size);
    },
    async close() {
      await writable.close();
      const file = await fileHandle.getFile();
      if (file.size === 0) {
        await root.removeEntry(tmpName).catch(() => undefined);
        throw new Error("Export produced an empty file");
      }
      triggerAnchorDownload(file, filename, () => {
        root.removeEntry(tmpName).catch(() => undefined);
      });
    },
    async abort() {
      try {
        await writable.abort();
      } catch {
        void 0;
      }
      await root.removeEntry(tmpName).catch(() => undefined);
    },
  } as unknown as FileSystemWritableFileStream;
}

function createBufferedDownloadWritable(
  filename: string,
  mime: string,
): FileSystemWritableFileStream {
  let buffer = new Uint8Array(1024 * 1024);
  let length = 0;
  let cursor = 0;
  let finished = false;
  const checkOpen = () => { if (finished) throw new Error("Export destination is closed"); };
  const validPosition = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid export file position");
  };
  const grow = (needed: number) => {
    if (needed > 128 * 1024 * 1024) throw new Error("This export is too large for an in-memory download. Choose a file location or enable browser storage and try again.");
    if (needed <= buffer.length) return;
    const next = new Uint8Array(Math.max(needed, buffer.length * 2));
    next.set(buffer.subarray(0, length));
    buffer = next;
  };
  const sink = {
    async seek(position: number) { checkOpen(); validPosition(position); cursor = position; },
    async write(data: unknown) {
      checkOpen();
      if (data && typeof data === "object" && "type" in data && !(data instanceof Blob)) {
        const command = data as { type: string; data?: unknown; position?: number; size?: number };
        if (command.type === "seek") return sink.seek(command.position!);
        if (command.type === "truncate") return sink.truncate(command.size!);
        if (command.type !== "write") throw new Error("Unsupported export write command");
        if (command.position !== undefined) await sink.seek(command.position);
        data = command.data;
      }
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes) throw new Error("Unsupported export write data");
      const end = cursor + bytes.byteLength;
      validPosition(end);
      grow(end);
      buffer.set(bytes, cursor);
      length = Math.max(length, end);
      cursor = end;
    },
    async close() {
      checkOpen();
      if (!length) throw new Error("Export produced an empty file");
      triggerAnchorDownload(new Blob([buffer.slice(0, length)], { type: mime }), filename);
      finished = true;
      buffer = new Uint8Array(0);
    },
    async abort() { finished = true; buffer = new Uint8Array(0); length = 0; cursor = 0; },
    async truncate(size: number) {
      checkOpen(); validPosition(size); grow(size);
      buffer.fill(0, Math.min(length, size), Math.max(length, size));
      length = size;
      cursor = Math.min(cursor, size);
    },
  };
  return sink as unknown as FileSystemWritableFileStream;
}

async function createFallbackWritable(
  filename: string,
  mime: string,
): Promise<FileSystemWritableFileStream> {
  return (await createOpfsDownloadWritable(filename)) ?? createBufferedDownloadWritable(filename, mime);
}

export function createCapturingWritable(
  target: FileSystemWritableFileStream,
  mime: string,
  onComplete: (blob: Blob) => void,
): FileSystemWritableFileStream {
  // 捕获必须保留写入位置：mp4 封装收尾会回到文件头定点回填 mdat 长度，
  // 无条件追加会让长度字段停在占位值、解析器读不到尾部的 moov。
  const capture = createWritableCapture(target as unknown as WritableLike);

  return {
    seek: (position: number) => capture.seek(position),
    write: (data: unknown) => capture.write(data),
    truncate: (size: number) => capture.truncate(size),
    async close() {
      await target.close();
      onComplete(new Blob([capture.captured.toUint8Array()], { type: mime }));
    },
    async abort() {
      if (typeof target.abort === "function") {
        await target.abort();
      }
    },
  } as unknown as FileSystemWritableFileStream;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (typeof result !== "string") {
        resolve("");
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to encode blob to base64"));
    reader.readAsDataURL(blob);
  });
}

/** Compatibility upload for the legacy Motion callback. */
export async function persistExportBlobToHost(
  projectId: string,
  blob: Blob,
  metadata: { durationMs?: number; width?: number; height?: number } = {},
): Promise<{ path?: string; bytes?: number; revision?: string }> {
  void metadata;
  try {
    if (!blob || blob.size === 0) return {};
    const res = await fetch(`/omnimux-clip/api/projects/${encodeURIComponent(projectId)}/save-export`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (!res.ok) {
      console.warn("[export-runner] persistExportBlobToHost rejected:", res.status);
      return {};
    }
    const body = (await res.json()) as { path?: string; bytes?: number; revision?: string };
    return {
      path: body.path,
      bytes: body.bytes,
      revision: typeof body.revision === "string" && body.revision ? body.revision : undefined,
    };
  } catch (err) {
    console.warn("[export-runner] persistExportBlobToHost failed:", err);
    return {};
  }
}

export async function createDownloadWritable(
  filename: string,
  mime: string,
  options?: { delivery?: ExportDeliveryMode; canvasMode?: boolean },
): Promise<FileSystemWritableFileStream> {
  const ext = filename.split(".").pop() || "mp4";
  if (options?.canvasMode !== false && isCanvasClipExportSession()) {
    if (ext.toLowerCase() !== "mp4") throw new Error(clipNow()("Choose MP4 to send a video to the canvas."));
    return createSilentCanvasWritable(mime) as unknown as FileSystemWritableFileStream;
  }
  if (options?.delivery === "download") return createFallbackWritable(filename, mime);

  if (typeof window.openreel?.fs?.showSaveDialog === "function") {
    const chosen = await window.openreel.fs.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: "Media file", extensions: [ext] }],
    });
    if (!chosen) {
      throw new DOMException("User cancelled", "AbortError");
    }
    (window as { __openreelExportPath?: string }).__openreelExportPath = chosen;
    const handleId = await window.openreel.fs.openWrite(chosen);
    let cursor = 0;
    return {
      async seek(position: number) {
        cursor = position;
      },
      async write(data: unknown) {
        let bytes: ArrayBuffer | Uint8Array;
        if (data instanceof ArrayBuffer) {
          bytes = data;
        } else if (data instanceof Uint8Array) {
          bytes = data;
        } else if (ArrayBuffer.isView(data)) {
          bytes = new Uint8Array(
            data.buffer as ArrayBuffer,
            data.byteOffset,
            data.byteLength,
          );
        } else {
          return;
        }
        await window.openreel!.fs.writeChunk(handleId, bytes, cursor);
        cursor += bytes.byteLength;
      },
      async close() {
        await window.openreel!.fs.closeWrite(handleId);
      },
      async abort() {
        await window.openreel!.fs.abortWrite(handleId);
      },
      async truncate() {},
    } as unknown as FileSystemWritableFileStream;
  }

  if ("showSaveFilePicker" in window) {
    let destinationChosen = false;
    try {
      const handle = await (
        window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Media file",
            accept: { [mime]: [`.${ext}`] },
          },
        ],
      });
      destinationChosen = true;
      // A chosen destination that fails to open must be reported, not changed.
      return await handle.createWritable();
    } catch (error) {
      if (destinationChosen) throw error;
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      if (name === "AbortError") {
        throw error;
      }
      if (!["SecurityError", "NotSupportedError"].includes(name)) throw error;
      console.warn(
        "[export-runner] showSaveFilePicker unavailable; streaming to a downloaded file instead",
        error,
      );
    }
  }

  return createFallbackWritable(filename, mime);
}

const INITIAL_STATE: ExportRunnerState = {
  isExporting: false,
  canvasReserved: false,
  savingToCanvas: false,
  progress: 0,
  phase: "",
  error: null,
  complete: false,
};

interface ExportRunnerOptions {
  project: Project;
  canvasMode?: boolean;
  onExported?: (settings: Partial<VideoExportSettings>) => void;
}

interface CanvasExportAttempt {
  controller: AbortController;
  canReport: () => boolean;
  reservation?: ReturnType<typeof reserveCanvasExport>;
  cancellation?: Promise<void>;
}

interface UseExportRunner {
  state: ExportRunnerState;
  runExport: (
    videoSettings: Partial<VideoExportSettings>,
    ext: string,
    writableStream: FileSystemWritableFileStream,
  ) => Promise<boolean>;
  runAudioExport: (settings: Partial<AudioExportSettings>, writable: FileSystemWritableFileStream) => Promise<void>;
  showSavePicker: (filename: string, ext: string, opts?: { streamToFile?: boolean; delivery?: ExportDeliveryMode }) => Promise<FileSystemWritableFileStream>;
  reportProgress: (progress01: number, phase: string) => void;
  markComplete: () => void;
  beginExport: (writable?: FileSystemWritableFileStream) => () => void;
  assertNotCancelled: () => void;
  finishExportSoon: () => void;
  failExport: (error: unknown) => void;
  cancel: () => void | Promise<void>;
  resetError: () => void;
}

export function useExportRunner(options: ExportRunnerOptions): UseExportRunner {
  const { project, canvasMode = false, onExported } = options;
  const [state, setState] = useState<ExportRunnerState>(INITIAL_STATE);
  const epoch = useRef(0);
  const running = useRef(false);
  const cancelled = useRef(false);
  const attached = useRef(true);
  const activeCanvas = useRef<CanvasExportAttempt | null>(null);
  const activeWritable = useRef<FileSystemWritableFileStream | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const assertNotCancelled = useCallback(() => {
    if (cancelled.current) throw new DOMException("Export cancelled", "AbortError");
  }, []);

  const beginExport = useCallback((writable?: FileSystemWritableFileStream) => {
    if (running.current || activeCanvas.current) {
      void writable?.abort().catch(() => undefined);
      throw new Error("The previous export is still finishing. Please retry in a moment.");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    epoch.current += 1;
    cancelled.current = false;
    activeWritable.current = writable ?? null;
    setState({
      isExporting: true,
      canvasReserved: false,
      savingToCanvas: false,
      progress: 0,
      phase: "Initializing...",
      error: null,
      complete: false,
    });
    const startedEpoch = epoch.current;
    return () => {
      if (cancelled.current || epoch.current !== startedEpoch) throw new DOMException("Export cancelled", "AbortError");
    };
  }, []);

  const reportProgress = useCallback((progress01: number, phase: string) => {
    if (cancelled.current) return;
    setState((prev) => ({
      ...prev,
      progress: progress01 * 100,
      phase: progressPhaseLabel(phase),
    }));
  }, []);

  const markComplete = useCallback(() => {
    assertNotCancelled();
    activeWritable.current = null;
    setState((prev) => ({ ...prev, isExporting: false, progress: 100, complete: true, phase: "Saved!" }));
  }, [assertNotCancelled]);

  const finishExportSoon = useCallback(() => {
    const completedEpoch = epoch.current;
    resetTimer.current = setTimeout(() => {
      if (epoch.current === completedEpoch) setState(INITIAL_STATE);
    }, 2000);
  }, []);

  const failExport = useCallback((error: unknown) => {
    void activeWritable.current?.abort().catch(() => undefined);
    activeWritable.current = null;
    if (cancelled.current || (error && typeof error === "object" && "name" in error && error.name === "AbortError")) {
      setState(INITIAL_STATE);
      return;
    }
    setState((prev) => ({
      ...prev,
      isExporting: false,
      canvasReserved: false,
      savingToCanvas: false,
      error: error instanceof Error ? error.message : "Export failed",
    }));
  }, []);

  const resetError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const runExport = useCallback(
    async (
      videoSettings: Partial<VideoExportSettings>,
      ext: string,
      writableStream: FileSystemWritableFileStream,
    ): Promise<boolean> => {
      const busy = running.current || activeCanvas.current !== null;
      const releaseCanvasRender = canvasMode && !busy ? tryLockNativeVideoRender() : undefined;
      if (busy || (canvasMode ? !releaseCanvasRender : nativeVideoRender)) {
        await writableStream.abort().catch(() => undefined);
        throw new Error("An export is already running");
      }
      if (!canvasMode) standaloneVideoRenders += 1;
      const releaseRender = releaseCanvasRender ?? (() => { standaloneVideoRenders -= 1; });
      const runEpoch = epoch.current;
      running.current = true;
      activeWritable.current = writableStream;
      const isCurrent = () => epoch.current === runEpoch && !cancelled.current;
      const checkCurrent = () => {
        if (!isCurrent()) throw new DOMException("Export cancelled", "AbortError");
      };
      const engine = getExportEngine();
      let generator: ReturnType<typeof engine.exportVideo> | undefined;
      const session = canvasMode ? getActiveClipSession() : null;
      const canvas = session?.source === "canvas" ? session : null;
      const isVisible = () => attached.current && (!canvas || getActiveClipSession() === canvas);
      const canReport = () => isVisible() && isCurrent();
      const attempt: CanvasExportAttempt | null = canvas ? { controller: new AbortController(), canReport: isVisible } : null;
      activeCanvas.current = attempt;
      const finishEncoding = () => {
        releaseRender();
        running.current = false;
        if (activeWritable.current === writableStream) activeWritable.current = null;
      };
      let savingToCanvas = false;
      let capturedBlob: Blob | null = null;
      const destination = canvas
        ? createCapturingWritable(writableStream, mimeForExt(ext), (blob) => { capturedBlob = blob; })
        : writableStream;
      try {
        const editor = canvas ? useProjectStore.getState() : null;
        const modifiedAt = editor?.project.modifiedAt;
        const checkSource = () => {
          checkCurrent();
          if (!editor) return;
          const latest = useProjectStore.getState();
          if (!latest.hasOpenProject || latest.project !== editor.project || latest.actionExecutor !== editor.actionExecutor
            || latest.project.modifiedAt !== modifiedAt) {
            throw new Error("The canvas project changed while starting or rendering the export");
          }
        };
        if (canvasMode && (!canvas?.workspaceId || !canvas.nodeId || canvas.projectId !== project.id
          || editor?.project.id !== project.id || modifiedAt !== project.modifiedAt)) {
          throw new Error("The canvas project is no longer open");
        }
        if (canvas && (ext !== "mp4" || extForFormat(videoSettings.format ?? "mp4", videoSettings.codec) !== "mp4")) {
          throw new Error(clipNow()("Choose MP4 to send a video to the canvas."));
        }
        const exportProject = canvas ? cloneProjectSnapshot(project) : project;
        if (attempt && canvas) attempt.reservation = reserveCanvasExport(canvas);
        const canvasJob = attempt?.reservation ? await attempt.reservation : undefined;
        checkSource();
        if (canvasJob && canReport()) setState((prev) => ({ ...prev, canvasReserved: true }));
        await engine.initialize();
        checkSource();
        await ensureProjectFonts(exportProject);
        checkSource();
        // "Use previews": frames already in the render cache replace re-rendering.
        const cachedFrames = getUseExportPreviews()
          ? createExportFrameSource(exportProject, {
              width: videoSettings.width ?? 1920,
              height: videoSettings.height ?? 1080,
              frameRate: videoSettings.frameRate ?? 30,
              upscaling: videoSettings.upscaling,
            })
          : null;
        generator = engine.exportVideo(exportProject, videoSettings, destination, cachedFrames ? { cachedFrames } : {});
        let step = canvas ? await startWebCodecsVideoExport(generator) : await generator.next();
        while (!step.done) {
          checkSource();
          const { progress, phase } = step.value;
          if (canReport()) setState((prev) => ({ ...prev, progress: progress * 100, phase: progressPhaseLabel(phase) }));
          step = await generator.next();
        }
        checkSource();
        const finalResult = step.value;
        generator = undefined;

        if (finalResult?.success) {
          if (canvasJob && attempt) {
            if (!capturedBlob) throw new Error("The canvas export is no longer available");
            // The upload owns the reservation and can finish after the editor exits.
            const upload = uploadClipExport(canvasJob, capturedBlob, attempt.controller.signal);
            savingToCanvas = true;
            finishEncoding();
            if (canReport()) setState((prev) => ({ ...prev, savingToCanvas: true }));

            const receipt = await upload;
            if (!canReport()) return false;
            if (!receipt?.fileSaved || (receipt.status !== "superseded" && !receipt.canvasCommitted)) {
              throw new Error(receipt?.error?.message ?? "Canvas export was not persisted to the local library");
            }
          }
          const smartRender = finalResult.stats?.smartRender;
          const sourceMedia = finalResult.stats?.sourceMedia;
          const lightLevel = finalResult.stats?.hdrLightLevel;
          const lightNote = lightLevel ? `Measured from the rendered frames: MaxCLL ${lightLevel.maxCll} nits, MaxFALL ${lightLevel.maxFall} nits.` : "";
          const note = [smartRender?.summary, sourceMedia ? describeExportSource(sourceMedia, window.openreel?.platform === "desktop") : "", lightNote].filter(Boolean).join(" ");
          if (note && !canvas) toast.info(clipNow()("Export finished"), note);
          setState((prev) => ({ ...prev, isExporting: false, canvasReserved: false, savingToCanvas: false, progress: 100, complete: true, phase: "Saved!" }));
          onExported?.(videoSettings);
          return true;
        } else {
          if (finalResult?.error?.code === "CANCELLED") throw new DOMException("Export cancelled", "AbortError");
          throw new Error(finalResult?.error?.message || "Export failed");
        }
      } catch (error) {
        if (!savingToCanvas) await writableStream.abort().catch(() => undefined);
        if (attempt?.controller.signal.aborted || (canvas && !isVisible())) return false;
        throw error;
      } finally {
        // Closing a generator runs cleanup if cancellation lands at a yield.
        try { await generator?.return({ success: false }); } catch { /* Preserve the original failure. */ }
        if (!savingToCanvas) finishEncoding();
        if (activeCanvas.current === attempt && !attempt?.cancellation) activeCanvas.current = null;
        if (canvas && attached.current && isCurrent() && !isVisible()) setState(INITIAL_STATE);
      }
    },
    [project, canvasMode, onExported],
  );

  const runAudioExport = useCallback(async (
    settings: Partial<AudioExportSettings>,
    writable: FileSystemWritableFileStream,
  ) => {
    if (running.current) {
      await writable.abort().catch(() => undefined);
      throw new Error("An export is already running");
    }
    const startedEpoch = epoch.current;
    running.current = true;
    activeWritable.current = writable;
    try {
      await runAudioExportToWritable(project, settings, writable, {
        assertNotCancelled: () => {
          if (cancelled.current || epoch.current !== startedEpoch) throw new DOMException("Export cancelled", "AbortError");
        },
        reportProgress,
      });
    } finally {
      running.current = false;
      if (activeWritable.current === writable) activeWritable.current = null;
    }
  }, [project, reportProgress]);

  const showSavePicker = useCallback(
    async (
      filename: string,
      ext: string,
      opts?: { streamToFile?: boolean; delivery?: ExportDeliveryMode },
    ): Promise<FileSystemWritableFileStream> => {
      const mime = mimeForExt(ext);
      if (canvasMode) {
        if (!isCanvasClipExportSession()) throw new Error("The canvas project is no longer open");
        if (ext !== "mp4") throw new Error(clipNow()("Choose MP4 to send a video to the canvas."));
        return createSilentCanvasWritable(mime) as unknown as FileSystemWritableFileStream;
      }

      if (typeof window.openreel?.fs?.showSaveDialog === "function") {
        const chosen = await window.openreel.fs.showSaveDialog({
          defaultPath: filename,
          filters: [{ name: "Media file", extensions: [ext] }],
        });
        if (!chosen) {
          throw new DOMException("User cancelled", "AbortError");
        }
        (window as { __openreelExportPath?: string }).__openreelExportPath = chosen;

        // The WAV path and any WebCodecs export (streamToFile) mux directly to
        // disk through the fs bridge. The native ffmpeg video path writes the
        // file itself via __openreelExportPath, so it gets the no-op stub below.
        if (ext === "wav" || ext === "ac3" || ext === "ec3" || opts?.streamToFile === true) {
          const handleId = await window.openreel.fs.openWrite(chosen);
          let cursor = 0;
          return {
            async seek(position: number) {
              cursor = position;
            },
            async write(data: unknown) {
              let bytes: ArrayBuffer | Uint8Array;
              if (data instanceof ArrayBuffer) {
                bytes = data;
              } else if (data instanceof Uint8Array) {
                bytes = data;
              } else if (ArrayBuffer.isView(data)) {
                bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
              } else {
                return;
              }
              await window.openreel!.fs.writeChunk(handleId, bytes, cursor);
              cursor += bytes.byteLength;
            },
            async close() {
              await window.openreel!.fs.closeWrite(handleId);
            },
            async abort() {
              await window.openreel!.fs.abortWrite(handleId);
            },
            async truncate() {},
          } as unknown as FileSystemWritableFileStream;
        }

        return {
          async seek() {},
          async write() {},
          async close() {},
          async abort() {},
          async truncate() {},
        } as unknown as FileSystemWritableFileStream;
      }

      return createDownloadWritable(filename, mime, { delivery: opts?.delivery, canvasMode: false });
    },
    [canvasMode],
  );

  const cancel = useCallback(() => {
    const attempt = activeCanvas.current;
    if (attempt?.cancellation) return attempt.cancellation;
    epoch.current += 1;
    cancelled.current = true;
    attempt?.controller.abort(new DOMException("Export cancelled", "AbortError"));
    void activeWritable.current?.abort().catch(() => undefined);
    if (running.current) getExportEngine().cancel();
    if (!attempt) {
      setState(INITIAL_STATE);
      return;
    }

    // If the reservation is in flight, wait for its proof so that the Host
    // can cancel this exact job even when the upload was already buffered.
    attempt.cancellation = (async () => {
      const job = await attempt.reservation?.catch(() => undefined);
      const receipt = job && await cancelClipExport(job);
      if (!attempt.canReport()) return;
      if (receipt?.status === "canvas-failed") throw new Error(receipt.error?.message || "Export failed");
      if (receipt?.fileSaved) {
        setState({ ...INITIAL_STATE, progress: 100, complete: true, phase: "Saved!" });
        finishExportSoon();
      } else {
        setState(INITIAL_STATE);
      }
    })().catch(error => {
      if (attempt.canReport()) setState({ ...INITIAL_STATE, error: error instanceof Error ? error.message : "Export failed" });
    }).finally(() => {
      if (activeCanvas.current === attempt) activeCanvas.current = null;
    });
    return attempt.cancellation;
  }, [finishExportSoon]);

  useEffect(() => {
    attached.current = true;
    return () => {
      attached.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
      // Leaving the editor does not cancel a canvas reservation or upload.
      if (activeCanvas.current) return;
      if (running.current || activeWritable.current) void cancel();
      else epoch.current += 1;
    };
  }, [cancel]);

  return {
    state,
    runExport,
    runAudioExport,
    showSavePicker,
    reportProgress,
    markComplete,
    beginExport,
    assertNotCancelled,
    finishExportSoon,
    failExport,
    cancel,
    resetError,
  };
}
