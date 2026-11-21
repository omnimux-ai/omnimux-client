import React, { Suspense, lazy } from "react";
import { useClipT } from "../../../../../i18n/index.js";

// The look grid (real-footage previews) loads on demand: it stays out of the editor chunk.
const FilterLooksPanel = lazy(() => import("./looks/FilterLooksPanel"));

interface FilterPresetsPanelProps {
  clipId?: string;
  embedded?: boolean;
}

export const FilterPresetsPanel: React.FC<FilterPresetsPanelProps> = (props) => {
  const t = useClipT();
  return (
  <Suspense fallback={<div className="h-24 animate-pulse rounded-[7px] bg-bg-2" aria-label={t("Loading looks")} role="status" />}>
    <FilterLooksPanel {...props} />
  </Suspense>
);
};
