/**
 * Shared open state for the sidebar analytics entry and the center stage.
 * Consumes standard StageStore from dsh-ui-kit.
 */
import { createStageStore as createKitStageStore } from 'dsh-ui-kit'
import { STAGE_ID } from './defaults.js'

export const PRODUCT_STAGE_EVENT = 'dsh-product-stage'

export function createStageStore(getStage) {
  return createKitStageStore(STAGE_ID, getStage)
}
