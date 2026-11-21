import React, { Suspense, lazy } from "react";
import { useClipT } from "../../../../../i18n/index.js";

// Looks, LUT library and saved looks (graded real-footage previews) load on demand: out of the editor chunk.
const LooksAndLuts = lazy(() => import("./looks/LooksAndLutsSection"));

interface Props {
  clipId: string;
}

/** Built-in looks, the LUT library, saved looks and the Input LUT slot, in one place. */
export const ColorLibrarySection: React.FC<Props> = ({ clipId }) => {
  const t = useClipT();
  return (
  <Suspense fallback={<div className="h-24 animate-pulse rounded-[7px] bg-bg-2" role="status" aria-label={t("Loading looks and LUTs")} />}>
    <LooksAndLuts clipId={clipId} />
  </Suspense>
);
};
