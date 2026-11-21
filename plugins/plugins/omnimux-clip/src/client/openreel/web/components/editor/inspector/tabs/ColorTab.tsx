import React from "react";
import { ColorGradingSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { HslSecondarySection } from "../HslSecondarySection";
import { ComparisonSection } from "../ComparisonSection";
import { RawSourceSection } from "../RawSourceSection";
import { useClipT } from "../../../../../../i18n/index.js";

interface ColorTabProps {
  clipId: string;
  showColorGrading: boolean;
}

export const ColorTab: React.FC<ColorTabProps> = ({
  clipId,
  showColorGrading,
}) => {
  const t = useClipT();
  return (
    <>
      <RawSourceSection clipId={clipId} />
      {showColorGrading && (
        <>
          <InspectorSection
            title={t("Color Grading")}
            sectionId="color-grading"
            defaultOpen={false}
          >
            <ColorGradingSection clipId={clipId} />
          </InspectorSection>
          <InspectorSection
            title={t("HSL Secondary")}
            sectionId="hsl-secondary"
            defaultOpen={false}
          >
            <HslSecondarySection clipId={clipId} />
          </InspectorSection>
          <InspectorSection
            title={t("Comparison View")}
            sectionId="comparison-view"
            defaultOpen={false}
          >
            <ComparisonSection />
          </InspectorSection>
        </>
      )}
    </>
  );
};
