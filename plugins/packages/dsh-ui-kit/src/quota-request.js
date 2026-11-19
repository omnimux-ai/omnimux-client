/** Stateless UI adapter for the hub-owned quota seam. Resolve it per action
 * because the four plugin clients can load before the hub installs its globals. */
function quotaApi() {
  return typeof window !== 'undefined' ? window.__omnimuxQuota : undefined
}

export function isQuotaHttpResult(result) {
  if (!result || result.ok || result.status === 401) return false
  return result.status === 402 || result.body?.error === 'quota-exceeded'
}

export function notifyQuota(result, context) {
  const quota = quotaApi()
  if (typeof quota?.notify === 'function' && isQuotaHttpResult(result)) {
    quota.notify({ status: result.status, body: result.body, code: result.body?.error }, context)
  }
  return result
}

/** Project the hub precheck into the same result shape as a Host response. */
export async function quotaPrecheckFailure(context) {
  const quota = quotaApi()
  if (typeof quota?.ensureQuota !== 'function') return undefined
  const gate = await quota.ensureQuota(context)
  if (gate?.ok !== false) return undefined
  if (gate.reason === 'quota') return { ok: false, status: 402, body: { error: 'quota-exceeded' } }
  return { ok: false, status: 401, body: { error: 'needs-omnimux' } }
}

export function quotaGuard(fn, context, { precheck = true } = {}) {
  return async (...args) => {
    if (precheck) {
      const failure = await quotaPrecheckFailure(context)
      if (failure) return failure
    }
    return notifyQuota(await fn(...args), context)
  }
}
