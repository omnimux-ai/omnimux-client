import { randomBytes } from 'node:crypto'

/**
 * In-memory device flows. device_code never leaves this map.
 */
export function createPendingStore() {
  /** @type {Map<string, { deviceCode: string, expiresAt: number, intervalMs: number, siteBaseUrl: string }>} */
  const flows = new Map()

  /**
   * @param {{ deviceCode: string, expiresAt: number, intervalMs: number, siteBaseUrl: string }} record
   */
  function save(record) {
    const flowId = randomBytes(16).toString('hex')
    flows.set(flowId, record)
    return flowId
  }

  /**
   * @param {string} flowId
   */
  function get(flowId) {
    const record = flows.get(flowId)
    if (!record) return undefined
    if (Date.now() > record.expiresAt) {
      flows.delete(flowId)
      return undefined
    }
    return record
  }

  /**
   * @param {string} flowId
   */
  function remove(flowId) {
    flows.delete(flowId)
  }

  function clear() {
    flows.clear()
  }

  return { save, get, remove, clear }
}
