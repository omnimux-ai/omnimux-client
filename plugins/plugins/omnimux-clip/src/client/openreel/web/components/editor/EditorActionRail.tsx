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
    label: string,
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <Tooltip key={label}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(label)}
          aria-pressed={active}
          className={`workspace-rail-button ${active ? "is-active" : ""}`}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{t(label)}</TooltipContent>
    </Tooltip>
  );
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
            label,
            section === value,
            () => setSection(value),
            <Icon />,
          ),
        )}
        </div>
        {railButton(
          "Project settings",
          section === "settings",
          () => setSection("settings"),
          <SlidersHorizontal />,
        )}
      </nav>
    </TooltipProvider>
  );
}
