import { ClipDomainError } from '../../errors.js'
import { isMotionExpressionCodeApproved } from '../openreel/core/motion/motion-expressions'
import type { Project } from '../openreel/core/types/project'

/** Tool-driven rendering never invokes manually approved custom expressions. */
export function assertMotionPlaybackSafe(project: Project, time?: number): void {
  const hidden = new Set(project.timeline.tracks.filter(track => track.hidden).map(track => track.id))
  const instances = project.motionInstances ?? []
  const hasRenderedMotion = instances.some(instance => (!instance.trackId || !hidden.has(instance.trackId))
    && (time === undefined || (time >= instance.startTime && time < instance.startTime + instance.duration)))
  // Nested Motion layers can reference any composition in the library.
  if (hasRenderedMotion && project.motionCompositions?.some(composition => composition.layers.some(layer =>
    layer.expressions?.some(expression => expression.enabled && isMotionExpressionCodeApproved(expression))))) {
    throw new ClipDomainError('motion-expression-denied', 'Use the editor controls to render a project with approved Motion code')
  }
}

/** The capture copy stays safe even if the human grants approval during an async decode. */
export function projectWithMotionCodeDisabled(project: Project): Project {
  const { motionCompositions } = project
  if (!motionCompositions?.some(composition => composition.layers.some(layer => layer.expressions?.some(expression => expression.type === 'expression' && expression.enabled)))) {
    return project
  }
  return {
    ...project,
    motionCompositions: motionCompositions.map(composition => ({
      ...composition,
      layers: composition.layers.map(layer => ({
        ...layer,
        expressions: layer.expressions?.map(expression => expression.type === 'expression' ? { ...expression, enabled: false } : expression),
      })),
    })),
  }
}
