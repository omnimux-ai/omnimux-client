import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button, IconButton } from "dsh-ui-kit";
import { Dialog, DialogClose, DialogContent, DialogTitle, Input } from "@openreel/ui";
import { useEditorPortalRoot } from "@openreel/ui/lib/portal-root";
import { Check, Film, Image as ImageIcon, Music, Search, X } from "@/icons/lucide-compat";
import { useVisibleEditorPane } from "../../../../hooks/useVisibleEditorPane";
import { useClipT } from "../../../../i18n/index.js";
import { fetchLibraryMedia, filterLibraryMedia, type LibraryMedia, type LibraryMediaFilter } from "./asset-library-media";

const typeLabels = { all: "All", video: "Video", image: "Image", audio: "Audio" } as const;
const typeIcons = { video: Film, image: ImageIcon, audio: Music } as const;
const mediaFilters = Object.keys(typeLabels) as LibraryMediaFilter[];
const LIBRARY_TIMEOUT_MS = 15_000;

interface PickerProps {
  open: boolean;
  busy: boolean;
  importedIds: ReadonlySet<string>;
  allowedType?: "video" | "image" | "audio";
  singleSelect?: boolean;
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onImport: (items: readonly LibraryMedia[]) => void;
  restoreFocus: () => void;
}

export function AssetLibraryPicker({
  open,
  busy,
  importedIds,
  allowedType,
  singleSelect,
  title,
  confirmLabel,
  onClose,
  onImport,
  restoreFocus,
}: PickerProps) {
  const t = useClipT();
  const input = useRef<HTMLInputElement>(null);
  const portal = useEditorPortalRoot();
  const pane = useVisibleEditorPane(open ? portal : null);
  const style = pane?.clipped ? {
    left: pane.left + pane.width / 2,
    top: pane.top + pane.height / 2,
    width: Math.max(0, pane.width - 24),
    maxHeight: Math.max(0, pane.height - 24),
  } : undefined;

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="clip-library-picker absolute flex max-w-none flex-col gap-0 overflow-hidden p-0"
        style={style}
        onOpenAutoFocus={event => {
          if (!input.current) return;
          event.preventDefault();
          input.current.focus();
        }}
        onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}
      >
        <div className="clip-library-picker-header">
          <DialogTitle>{title ?? t("Import from OmniMux Assets")}</DialogTitle>
          <DialogClose asChild>
            <IconButton aria-label={t("Close")} size="sm"><X size={16} /></IconButton>
          </DialogClose>
        </div>
        <PickerContents
          open={open}
          input={input}
          busy={busy}
          importedIds={importedIds}
          allowedType={allowedType}
          singleSelect={singleSelect}
          confirmLabel={confirmLabel}
          onImport={onImport}
        />
      </DialogContent>
    </Dialog>
  );
}

type LibraryState = { state: "loading" } | { state: "failed" } | { state: "ready"; items: LibraryMedia[] };

function PickerContents({
  open,
  input,
  busy,
  importedIds,
  allowedType,
  singleSelect,
  confirmLabel,
  onImport,
}: Pick<PickerProps, "open" | "busy" | "importedIds" | "allowedType" | "singleSelect" | "confirmLabel" | "onImport"> & {
  input: RefObject<HTMLInputElement>;
}) {
  const t = useClipT();
  const [library, setLibrary] = useState<LibraryState>({ state: "loading" });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryMediaFilter>(allowedType ?? "all");
  const [selected, setSelected] = useState(() => new Set<string>());

  useEffect(() => {
    setFilter(allowedType ?? "all");
    setSelected(new Set());
  }, [allowedType, singleSelect, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LIBRARY_TIMEOUT_MS)]);
    setLibrary({ state: "loading" });
    void fetchLibraryMedia(signal).then(items => {
      if (!controller.signal.aborted) setLibrary({ state: "ready", items });
    }, () => {
      if (!controller.signal.aborted) setLibrary({ state: "failed" });
    });
    return () => controller.abort();
  }, [open, retry]);

  const items = library.state === "ready" ? library.items : undefined;
  const effectiveFilter: LibraryMediaFilter = allowedType ?? filter;
  const shown = useMemo(() => filterLibraryMedia(items ?? [], effectiveFilter, query), [items, effectiveFilter, query]);
  const chosen = useMemo(() => {
    const byId = new Map(items?.map(item => [item.id, item]));
    return [...selected].flatMap(id => {
      const item = byId.get(id);
      return item && (!importedIds.has(id) || singleSelect) ? [item] : [];
    });
  }, [items, selected, importedIds, singleSelect]);
  const toggle = (id: string) => setSelected(previous => {
    if (singleSelect) {
      return previous.has(id) ? new Set() : new Set([id]);
    }
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <>
      <div className="clip-library-picker-tools">
        <div className="clip-library-picker-filters" role="group" aria-label={t("Asset types")}>
          {(allowedType ? [allowedType] : mediaFilters).map(type => (
            <Button key={type} size="xs" variant="outline" aria-pressed={effectiveFilter === type} onClick={() => setFilter(type)}>
              {t(typeLabels[type])}
            </Button>
          ))}
        </div>
        <label className="clip-library-search">
          <Search size={14} aria-hidden />
          <Input ref={input} type="search" aria-label={t("Search assets")} placeholder={t("Search assets")} value={query} onChange={event => setQuery(event.currentTarget.value)} />
        </label>
      </div>
      <div className="clip-library-picker-body" aria-busy={library.state === "loading"}>
        {library.state === "loading" ? (
          <div className="clip-library-picker-message" role="status">{t("Loading assets…")}</div>
        ) : library.state === "failed" ? (
          <div className="clip-library-picker-message">
            <span role="alert">{t("Could not load the asset library.")}</span>
            <Button size="sm" onClick={() => setRetry(count => count + 1)}>{t("Retry")}</Button>
          </div>
        ) : shown.length > 0 ? (
          <div className="clip-library-picker-grid">
            {shown.map(item => (
              <AssetCard key={item.id} item={item} imported={!singleSelect && importedIds.has(item.id)} chosen={selected.has(item.id)} onToggle={() => toggle(item.id)} />
            ))}
          </div>
        ) : (
          <div className="clip-library-picker-message">{t(items?.length ? "No matching assets" : "No importable assets")}</div>
        )}
      </div>
      <div className="clip-library-picker-footer">
        <span aria-live="polite">{t("{0} selected", [chosen.length])}</span>
        <div className="clip-library-picker-actions">
          <DialogClose asChild><Button variant="ghost" size="sm">{t("Cancel")}</Button></DialogClose>
          <Button variant="primary" size="sm" disabled={!chosen.length || busy} onClick={() => onImport(chosen)}>
            {confirmLabel ?? (chosen.length ? t(chosen.length === 1 ? "Import {0} item" : "Import {0} items", [chosen.length]) : t("Import"))}
          </Button>
        </div>
      </div>
    </>
  );
}

function displayDuration(value: number | undefined) {
  if (!value || !Number.isFinite(value) || value < 0) return undefined;
  if (value < 1) return `${Number(value.toPrecision(2))} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function AssetCard({ item, imported, chosen, onToggle }: {
  item: LibraryMedia;
  imported: boolean;
  chosen: boolean;
  onToggle: () => void;
}) {
  const t = useClipT();
  const preview = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [videoFrame, setVideoFrame] = useState(false);
  const [metadata, setMetadata] = useState<{ duration?: number; width?: number; height?: number }>({});
  const Icon = typeIcons[item.type];
  const coverUrl = !coverFailed && item.coverUrl;
  const duration = displayDuration(metadata.duration);

  useEffect(() => {
    const target = preview.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  function readVideoMetadata(video: HTMLVideoElement) {
    setMetadata({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
  }

  return (
    <Button
      className="clip-library-card"
      variant="secondary"
      aria-pressed={!imported && chosen}
      disabled={imported}
      onClick={onToggle}
    >
      <span className="clip-library-card-preview" ref={preview} aria-hidden="true">
        <Icon size={22} />
        {visible && !previewFailed && item.type === "image" && (
          <img src={item.url} alt="" decoding="async" onError={() => setPreviewFailed(true)} onLoad={event => {
            setMetadata({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
          }} />
        )}
        {visible && !previewFailed && item.type === "video" && (
          <video src={item.url} muted playsInline preload="metadata" hidden={Boolean(coverUrl) || !videoFrame}
            onError={() => setPreviewFailed(true)}
            onLoadedMetadata={event => readVideoMetadata(event.currentTarget)}
            onDurationChange={event => readVideoMetadata(event.currentTarget)}
            onLoadedData={() => setVideoFrame(true)} />
        )}
        {visible && coverUrl && <img src={coverUrl} alt="" decoding="async" onError={() => setCoverFailed(true)} />}
        {visible && !previewFailed && item.type === "audio" && (
          <audio src={item.url} preload="metadata" hidden onError={() => setPreviewFailed(true)} onDurationChange={event => {
            setMetadata({ duration: event.currentTarget.duration });
          }} />
        )}
        {!imported && chosen && <span className="clip-library-card-check"><Check size={14} /></span>}
      </span>
      <span className="clip-library-card-copy">
        <strong title={item.name}>{item.name}</strong>
        {item.assetName && item.assetName !== item.name && <span className="clip-library-card-name" title={item.assetName}>{item.assetName}</span>}
        <span className="clip-library-card-meta">
          <span>{t(typeLabels[item.type])}</span>
          {duration && <span>{duration}</span>}
          {Boolean(metadata.width && metadata.height) && <span>{metadata.width}×{metadata.height}</span>}
        </span>
        {imported && <span className="clip-library-card-imported"><Check size={12} aria-hidden />{t("Already imported")}</span>}
      </span>
    </Button>
  );
}
