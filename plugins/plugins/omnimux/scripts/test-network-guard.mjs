// Test-only guard for the Hub's fetch-based HTTP runtime. Direct node:http or
// node:https calls are outside this guard and must be mocked by their caller.
const GUARD_STATE = Symbol.for('omnimux.test.network-guard')

function requestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return String(input)
  if (input && typeof input === 'object' && 'url' in input) return String(input.url)
  return String(input)
}

function installNetworkGuard() {
  if (globalThis[GUARD_STATE]) return globalThis[GUARD_STATE]
  const originalFetch = globalThis.fetch
  const state = {
    attempts: [],
    originalFetch,
    originalFetchCalls: 0,
  }
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input)
    state.attempts.push({
      url,
      method: typeof init?.method === 'string' ? init.method : 'GET',
    })
    const error = new Error(`omnimux test network guard blocked ${url}`)
    error.code = 'OMNIMUX_TEST_NETWORK_BLOCKED'
    throw error
  }
  globalThis[GUARD_STATE] = state
  return state
}

export function testNetworkAttempts() {
  return installNetworkGuard().attempts
}

export function resetTestNetworkAttempts() {
  const state = installNetworkGuard()
  state.attempts.length = 0
  state.originalFetchCalls = 0
}

export function testNetworkOriginalFetchCalls() {
  return installNetworkGuard().originalFetchCalls
}

installNetworkGuard()
