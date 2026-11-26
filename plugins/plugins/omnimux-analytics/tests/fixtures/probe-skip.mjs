/**
 * Skip a node:test case with the explicit environment marker consumed by
 * `run-workspace-tests`. Kept in a test fixture so the test file's assertions
 * stay untouched and only the runtime skip reason is added.
 */
export function skipProbeUnavailable(t, probe) {
  if (probe?.skipped !== true) return
  t.skip(`[environment-unavailable] ${probe.reason ?? 'Chrome probe unavailable'}`)
}
