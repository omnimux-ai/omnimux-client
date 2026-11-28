import {
  Film,
  Music2,
  Type,
  Pencil,
  PanelsTopLeft,
  Shapes,
  BookText,
  SlidersHorizontal,
  Bookmark,
  MessageCircle,
  History,
} from "lucide-react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@openreel/ui";
import {
  useEditorWorkspaceStore,
} from "../../stores/editor-workspace-store";
import { useClipT } from "../../../../i18n/index.js";
import { SIMPLE_RAIL_SECTIONS } from "../../../../simple-mode/uiModeStore.js";

const tools = [
  ["media", "Media", Film],
  ["audio", "Audio", Music2],
  ["text", "Text & captions", Type],
  ["effects", "Effects", Pencil],
  ["transitions", "Transitions", PanelsTopLeft],
  ["graphics", "Graphics", Shapes],
  ["recipes", "Recipes", BookText],
  ["markers", "Markers", Bookmark],
  ["comments", "Comments", MessageCircle],
  ["versions", "Versions", History],
] as const;

export function EditorActionRail() {
  const t = useClipT();
  const section = useEditorWorkspaceStore((s) => s.section);
  const setSection = useEditorWorkspaceStore((s) => s.setSection);
  const railButton = (
    value: string,
    label: string,
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => {
    const simpleLabel = (SIMPLE_RAIL_SECTIONS as Record<string, string>)[value];
    const proOnly = !simpleLabel;
    return (
      <Tooltip key={value}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(simpleLabel ?? label)}
            aria-pressed={active}
            data-clip-section={value}
            data-clip-pro-only={proOnly ? "true" : undefined}
            className={`workspace-rail-button ${active ? "is-active" : ""}`}
            onClick={onClick}
          >
            {icon}
            {simpleLabel ? <span className="clip-rail-label">{t(simpleLabel)}</span> : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t(simpleLabel ?? label)}</TooltipContent>
      </Tooltip>
    );
  };
  return (
    <TooltipProvider delayDuration={350}>
      <nav
        data-tour="toolbar"
        aria-label={t("Editor tools")}
        className="workspace-rail"
      >
        <div className="workspace-rail-scroll" data-testid="workspace-rail-scroll">
        {tools.map(([value, label, Icon]) =>
          railButton(
            value,
            label,
            section === value,
            () => setSection(value),
            <Icon />,
          ),
        )}
        </div>
        {railButton(
          "settings",
          "Project settings",
          section === "settings",
          () => setSection("settings"),
          <SlidersHorizontal />,
        )}
      </nav>
    </TooltipProvider>
  );
}
