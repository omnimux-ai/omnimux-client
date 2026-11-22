import { useRef, type RefObject } from "react";
import { Button, IconButton } from "dsh-ui-kit";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@openreel/ui";
import { useEditorPortalRoot } from "@openreel/ui/lib/portal-root";
import { ChevronDown, File, FolderOpen, Sparkles } from "@/icons/lucide-compat";
import { MediaLibraryIcon } from "@/icons/media-library";
import { useClipT } from "../../../../i18n/index.js";
import type { BridgeImportProgress } from "./useBridgedMediaImport";

interface BridgeActions {
  libraryDisabled: boolean;
  canvasDisabled: boolean;
  onLibrary: (trigger: HTMLButtonElement | null) => void;
  onCanvas: () => void;
}

export function MediaImportActions({ trigger, onLocal, onRecord, ...bridge }: BridgeActions & {
  trigger: RefObject<HTMLButtonElement>;
  onLocal: () => void;
  onRecord: () => void;
}) {
  const t = useClipT();
  const portal = useEditorPortalRoot();
  const handoffToPicker = useRef(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            aria-label={t("Import media")}
            data-media-action="import"
            size="sm"
            trailingIcon={<ChevronDown size={12} />}
          >{t("Import")}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="clip-media-import-menu"
          align="end"
          collisionBoundary={portal}
          collisionPadding={8}
          onCloseAutoFocus={event => {
            if (handoffToPicker.current) event.preventDefault();
            handoffToPicker.current = false;
          }}
        >
          <DropdownMenuItem onSelect={onLocal}><File size={14} />{t("Local files…")}</DropdownMenuItem>
          <DropdownMenuItem disabled={bridge.libraryDisabled} onSelect={() => {
            handoffToPicker.current = true;
            bridge.onLibrary(trigger.current);
          }}><FolderOpen size={14} />{t("Import from Assets…")}</DropdownMenuItem>
          <DropdownMenuItem disabled={bridge.canvasDisabled} onSelect={bridge.onCanvas}>
            <Sparkles size={14} />{t("Generate in Canvas…")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton size="sm" variant="secondary" data-media-action="record" aria-label={t("Record")} onClick={onRecord}>
        <MediaLibraryIcon name="record" />
      </IconButton>
    </>
  );
}

export function AssetBridgeShortcuts({ empty, ...bridge }: BridgeActions & { empty?: boolean }) {
  const t = useClipT();
  const className = empty ? "workspace-start-link clip-media-bridge-entry" : "clip-media-bridge-pill";
  const buttons = (
    <>
      <Button className={className} size="xs" leadingIcon={<FolderOpen size={14} />} disabled={bridge.libraryDisabled}
        onClick={event => bridge.onLibrary(event.currentTarget)}>
        {t(empty ? "Import from Assets" : "From Assets")}
      </Button>
      <Button className={className} size="xs" leadingIcon={<Sparkles size={14} />} disabled={bridge.canvasDisabled} onClick={bridge.onCanvas}>
        {t(empty ? "Generate media in Canvas" : "In Canvas")}
      </Button>
    </>
  );
  return empty ? buttons : <div className="clip-media-bridge-shortcuts">{buttons}</div>;
}

export function AssetBridgeFeedback({ progress, failed, canvasIssue, canRetry }: {
  progress: BridgeImportProgress | null;
  failed: ReadonlyArray<{ id: string; name: string; retry: () => void }>;
  canvasIssue: "save-failed" | "unavailable" | null;
  canRetry: boolean;
}) {
  const t = useClipT();
  if (!progress && !failed.length && !canvasIssue) return null;
  return (
    <div className="clip-media-bridge-feedback">
      {progress && (
        <div className="clip-media-bridge-progress">
          <span role="status">{t("Importing media ({0}/{1})", [progress.done, progress.total])}</span>
          <progress aria-label={t("Media import progress")} value={progress.done} max={progress.total} />
        </div>
      )}
      {canvasIssue && <p role="alert">{t(canvasIssue === "save-failed" ? "Could not save the draft. Try opening Canvas again." : "Canvas is unavailable.")}</p>}
      {failed.map(item => (
        <div className="clip-media-bridge-failure" key={item.id}>
          <span role="alert" title={item.name}>{t("Could not import {0}", [item.name])}</span>
          <Button size="xs" variant="outline" disabled={!canRetry} aria-label={t("Retry import of {0}", [item.name])} onClick={item.retry}>
            {t("Retry")}
          </Button>
        </div>
      ))}
    </div>
  );
}
