/**
 * Pure view-model for the universal login gate.
 * LoginGate.jsx renders this snapshot; L1 tests assert phases without React.
 */

export const LOGIN_GATE_COPY_KEYS = {
  brandTitle: 'auth.gate.brandTitle',
  headline: 'auth.gate.headline',
  subdeck: 'auth.gate.subdeck',
  feature1: 'auth.gate.feature1',
  feature2: 'auth.gate.feature2',
  feature3: 'auth.gate.feature3',
  cta: 'auth.gate.cta',
  waitingDeviceCode: 'auth.gate.waitingDeviceCode',
  reopen: 'auth.gate.reopen',
  tag: 'auth.gate.tag',
  close: 'auth.gate.close',
  retry: 'auth.gate.retry',
  cancel: 'auth.gate.cancel',
}

export const LOGIN_GATE_FEATURE_KEYS = [
  LOGIN_GATE_COPY_KEYS.feature1,
  LOGIN_GATE_COPY_KEYS.feature2,
  LOGIN_GATE_COPY_KEYS.feature3,
]

/**
 * Map a gate store snapshot onto the 1:1 modal slots.
 * @param {{ phase?: string, user_code?: string, verification_url?: string } | null | undefined} gate
 */
export function describeLoginGate(gate) {
  const phase = gate && typeof gate.phase === 'string' ? gate.phase : 'closed'
  // checking is an internal in-flight lock. Never portal the marketing
  // window, never show the waiting spinner.
  if (phase === 'closed' || phase === 'checking') {
    return {
      visible: false,
      phase,
      showHero: false,
      showCta: false,
      showWaiting: false,
      showRetry: false,
      showError: false,
      userCode: '',
      verificationUrl: '',
      intent: null,
    }
  }
  const failed = phase === 'denied' || phase === 'expired' || phase === 'error'
  const waiting = phase === 'waiting'
  const starting = phase === 'starting'
  const userCode = typeof gate.user_code === 'string' && gate.user_code ? gate.user_code : '—'
  const verificationUrl = typeof gate.verification_url === 'string' ? gate.verification_url : ''
  return {
    visible: true,
    phase,
    showHero: true,
    showCta: phase === 'prompt' || failed,
    showWaiting: waiting || starting,
    showRetry: failed,
    showError: failed,
    userCode,
    verificationUrl,
    intent: failed ? 'retry' : phase === 'prompt' ? 'begin' : waiting ? 'open-url' : null,
  }
}

/**
 * Fire the CTA / retry / re-open-url intent for a view snapshot.
 * @param {ReturnType<typeof describeLoginGate>} view
 * @param {{ begin: () => void, retry: () => void, openUrl: (url: string) => void }} handlers
 * @returns {'begin' | 'retry' | 'open-url' | 'noop'}
 */
export function runLoginGateIntent(view, handlers) {
  if (!view || !view.visible || !view.intent) return 'noop'
  if (view.intent === 'begin') {
    handlers.begin()
    return 'begin'
  }
  if (view.intent === 'retry') {
    handlers.retry()
    return 'retry'
  }
  if (view.intent === 'open-url' && view.verificationUrl) {
    handlers.openUrl(view.verificationUrl)
    return 'open-url'
  }
  return 'noop'
}
