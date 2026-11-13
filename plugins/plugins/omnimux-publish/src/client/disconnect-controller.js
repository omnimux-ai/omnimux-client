/**
 * Serializes destructive account disconnect requests independently from React state.
 * React state updates are asynchronous, so the mutable lock prevents two confirms
 * delivered in the same event turn from sending two DELETE requests.
 *
 * @param {{
 *   disconnect: (accountId: unknown) => Promise<{ ok: boolean, status: number, body: unknown }>,
 *   reload: () => Promise<unknown>,
 *   isMounted: () => boolean,
 *   isNeedsLogin: (result: { ok: boolean, status: number, body: unknown }) => boolean,
 *   errorText: (body: unknown, status: number) => string,
 *   onStart: (accountId: string) => void,
 *   onFailure: (message: string) => void,
 *   onNeedLogin: () => void,
 *   onSuccess: () => void,
 *   onFinally: () => void,
 * }} options
 */
export function createDisconnectController(options) {
  let locked = false

  return {
    /**
     * @param {unknown} accountId
     * @returns {Promise<void>}
     */
    async confirm(accountId) {
      if (locked) return
      locked = true
      const displayId = typeof accountId === 'string' ? accountId : ''
      if (options.isMounted()) options.onStart(displayId)

      try {
        const result = await options.disconnect(accountId)
        if (!options.isMounted()) return
        if (options.isNeedsLogin(result)) {
          options.onNeedLogin()
          return
        }
        if (!result.ok) {
          options.onFailure(options.errorText(result.body, result.status))
          return
        }
        options.onSuccess()
        if (options.isMounted()) await options.reload()
      } catch (caught) {
        if (options.isMounted()) {
          options.onFailure(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        locked = false
        if (options.isMounted()) options.onFinally()
      }
    },
  }
}
