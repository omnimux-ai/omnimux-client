import { useCallback, useLayoutEffect, useRef } from 'react'
import { errText, parsePickedPathsResult } from './feed-helpers.js'

/** Apply only the request that still belongs to the open form. */
export function useFormFilePicker({ active, owner, pickPath, t, setFormError }) {
  const pending = useRef(null)
  useLayoutEffect(() => () => { pending.current = null }, [active, owner])

  return useCallback(async (kind) => {
    if (!active || pending.current) return []
    const ticket = {}
    pending.current = ticket
    try {
      const result = await pickPath(kind)
      if (pending.current !== ticket) return []
      const parsed = parsePickedPathsResult(result, t)
      if (!parsed.ok) setFormError(parsed.error)
      return parsed.paths
    } catch (caught) {
      if (pending.current === ticket) setFormError(errText(caught))
      return []
    } finally {
      if (pending.current === ticket) pending.current = null
    }
  }, [active, pickPath, t, setFormError])
}
