import { executeOmnimuxMedia } from './execute.js'
import { parseMediaConfig, resolveMediaRoute } from './route.js'

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function readOmnimuxImageConfig(env = process.env) {
  const route = resolveMediaRoute('image', {}, parseMediaConfig(undefined), env)
  return { baseUrl: route.baseUrl, apiKey: route.apiKey, modelId: route.modelId }
}

/**
 * @param {Parameters<typeof executeOmnimuxMedia>[1]} input
 */
export function executeOmnimuxImage(input) {
  return executeOmnimuxMedia('image', input)
}
