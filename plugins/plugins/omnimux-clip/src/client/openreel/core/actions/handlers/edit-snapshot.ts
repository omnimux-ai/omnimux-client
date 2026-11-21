import type { Project } from "../../types/project";
import { registerActionHandler, createInverseAction } from "../registry";
import { syncActiveSequence, withNestProjection } from "../../timeline/sequences";

export function cloneEditSnapshot(snapshot: EditSnapshot): EditSnapshot {
  const { mediaLibrary, ...data } = snapshot;
  return {
    ...structuredClone(data),
    // Media bytes, file handles and waveform buffers are immutable sources.
    mediaLibrary: { ...mediaLibrary, items: mediaLibrary.items.map((item) => ({ ...item })) },
  };
}

/** Internal commit boundary. External documents must pass the portable validator. */
export type EditSnapshot = Pick<Project, "name" | "settings" | "timeline" | "mediaLibrary" | "textClips" | "shapeClips" | "svgClips" | "stickerClips" | "adjustmentLayers" | "masks" | "particleEffects" | "multicamGroups" | "multicamSources" | "compoundClips" | "sequences" | "activeSequenceId" | "openSequenceIds" | "nestedInstances" | "motionCompositions" | "motionInstances" | "generatedShaders" | "creation" | "graphicInstances" | "linkedCompositions" | "bins">;
export function editSnapshot(source: Project): EditSnapshot {
  // The stored active sequence is stale until flushed: snapshot a consistent view.
  const project = syncActiveSequence(source);
  const { sequences, activeSequenceId, openSequenceIds } = project;
  const { name, settings, timeline, mediaLibrary, textClips, shapeClips, svgClips, stickerClips, adjustmentLayers, masks, particleEffects, multicamGroups, multicamSources, compoundClips, nestedInstances, motionCompositions, motionInstances, generatedShaders, creation, graphicInstances, linkedCompositions, bins } = project;
  return { name, settings, timeline, mediaLibrary, textClips, shapeClips, svgClips, stickerClips, adjustmentLayers, masks, particleEffects, multicamGroups, multicamSources, compoundClips, sequences, activeSequenceId, openSequenceIds, nestedInstances, motionCompositions, motionInstances, generatedShaders, creation, graphicInstances, linkedCompositions, bins };
}
const optionalSnapshotFields = [
  "textClips", "shapeClips", "svgClips", "stickerClips", "adjustmentLayers",
  "masks", "particleEffects", "multicamGroups", "multicamSources", "compoundClips", "sequences", "activeSequenceId", "openSequenceIds", "nestedInstances",
  "motionCompositions", "motionInstances", "generatedShaders", "creation", "graphicInstances", "linkedCompositions",
] as const satisfies readonly (keyof EditSnapshot)[];
export function applyEditSnapshot(project: Project, snapshot: EditSnapshot): Project {
  Object.assign(project, cloneEditSnapshot(snapshot), { modifiedAt: Date.now() });
  for (const field of optionalSnapshotFields) {
    if (snapshot[field] === undefined) Reflect.deleteProperty(project, field);
  }
  // Older snapshots that never mention bins leave them alone.
  if ("bins" in snapshot && snapshot.bins === undefined) Reflect.deleteProperty(project, "bins");
  if (project.sequences) {
    // compoundClips is a projection of the non-active sequences: rebuild it.
    Object.assign(project, { compoundClips: withNestProjection({ ...project, compoundClips: undefined }).compoundClips });
  }
  return project;
}

registerActionHandler({
  type: "project/applyEditSnapshot",
  validate(action) { return action.params.snapshot && typeof action.params.snapshot === "object" ? { valid: true, errors: [] } : { valid: false, errors: [{ code: "INVALID_PARAMS", message: "Missing edit snapshot" }] }; },
  apply(action, project) { applyEditSnapshot(project, action.params.snapshot as EditSnapshot); },
  invert(action, before) { return createInverseAction(action, "project/applyEditSnapshot", { snapshot: editSnapshot(before) }); },
});
