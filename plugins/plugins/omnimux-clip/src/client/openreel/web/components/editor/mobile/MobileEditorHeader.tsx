import { useState, type ReactNode } from "react";
import { Button } from "@openreel/ui";
import { useRouter } from "../../../hooks/use-router";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { ProjectSwitcher } from "../ProjectSwitcher";
import { WorkspaceSaveStatus } from "../WorkspaceSaveStatus";
import { MobileEditorIcon } from "./MobileEditorIcon";
import { clipNow } from "../../../../../i18n/index.js";
import { useClipT } from "../../../../../i18n/index.js";

export function MobileEditorHeader({onExport, menu, exportControl, exportLabel = "Export", exportDisabled = false}: {
  onExport: () => void; menu: ReactNode; exportControl?: ReactNode; exportLabel?: string; exportDisabled?: boolean;
}) {
  const t = useClipT();
  const project = useProjectStore(state => state.project);
  const [leaving, setLeaving] = useState(false);
  const {navigate} = useRouter();
  const android = /Android/i.test(navigator.userAgent);
  const back = async () => {
    if (leaving) return;
    setLeaving(true);
    try { await useProjectStore.getState().forceSave(); navigate("recent"); }
    catch { toast.error(clipNow()("Project could not be saved"), clipNow()("Your project is still open. Try saving it again.")); }
    finally { setLeaving(false); }
  };
  return <div className="mobile-editor-topbar" data-platform={android ? "android" : "ios"}>
    <Button variant="ghost" size="icon" className="mobile-editor-icon-button" aria-label={android ? t("Close project") : t("Back to projects")} disabled={leaving} onClick={() => void back()}><MobileEditorIcon name={android ? "close" : "back"}/></Button>
    <div className="mobile-editor-title">
      <ProjectSwitcher menuContent={menu} trigger={<Button variant="ghost" aria-label={t("Project menu")} className="mobile-editor-title-button"><strong>{project.name}</strong><span>{Math.min(project.settings.width, project.settings.height)}{t("p ·")} {project.settings.frameRate} {t("fps ·")} <WorkspaceSaveStatus/></span></Button>}/>
    </div>
    {exportControl ?? <Button className="mobile-editor-export" disabled={exportDisabled} onClick={onExport}>{exportLabel}</Button>}
  </div>;
}
