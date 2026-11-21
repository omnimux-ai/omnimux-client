import React from "react";
import {
  KeyframesSection,
  ClipTransitionSection,
  MotionPresetsPanel,
  MotionPathSection,
  EmphasisAnimationSection,
  TextAnimationSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { TextScrollSection } from "../TextScrollSection";
import { SavedStylesSection } from "../SavedStylesSection";
import { useClipT } from "../../../../../../i18n/index.js";

interface AnimateTabProps {
  clipId: string;
  clipType: string | null;
  showTextSection: boolean;
}

export const AnimateTab: React.FC<AnimateTabProps> = ({
  clipId,
  clipType,
  showTextSection,
}) => {
  const t = useClipT();
  return (
    <>
      <InspectorSection title={t("Keyframes")} sectionId="keyframes">
        <KeyframesSection clipId={clipId} />
      </InspectorSection>
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title={t("Transitions")}
          sectionId="transitions"
          defaultOpen={false}
        >
          <ClipTransitionSection clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title={t("Motion Presets")}
          sectionId="motion-presets"
          defaultOpen={false}
        >
          <MotionPresetsPanel clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title={t("Motion Path")}
          sectionId="motion-path"
          defaultOpen={false}
        >
          <MotionPathSection clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title={t("Emphasis Animation")}
          sectionId="emphasis-animation"
          defaultOpen={false}
        >
          <EmphasisAnimationSection clipId={clipId} />
        </InspectorSection>
      )}
      {showTextSection && (
        <InspectorSection
          title={t("Text Animation")}
          sectionId="text-animation"
          defaultOpen={false}
        >
          <TextAnimationSection clipId={clipId} />
        </InspectorSection>
      )}
      {showTextSection && (
        <InspectorSection title={t("Roll / Crawl")} sectionId="text-scroll" defaultOpen={false}>
          <TextScrollSection clipId={clipId} />
        </InspectorSection>
      )}
      {showTextSection && (
        <InspectorSection title={t("Saved Styles")} sectionId="text-saved-styles" defaultOpen={false}>
          <SavedStylesSection kind="text" targetId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
