/**
 * scripts/lib/smoke-probe-utils.mjs
 *
 * Utility functions for cold-start HTTP smoke probes, DOM skeleton validation,
 * recovery overlay detection, and CDP console error inspection.
 */

/**
 * Probe an HTTP endpoint and return response metadata and body.
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string, string> }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, body: string, headers: Record<string, string>, durationMs: number, error?: string }>}
 */
export async function probeHttpEndpoint(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000
  const startTime = Date.now()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        'User-Agent': 'OmniMux-Smoke-Probe/1.0',
        ...(opts.headers || {}),
      },
    })
    clearTimeout(timeoutId)

    const durationMs = Date.now() - startTime
    const body = await res.text()
    const headerObj = {}
    res.headers.forEach((v, k) => { headerObj[k.toLowerCase()] = v })

    return {
      ok: res.ok,
      status: res.status,
      body,
      headers: headerObj,
      durationMs,
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    return {
      ok: false,
      status: 0,
      body: '',
      headers: {},
      durationMs,
      error: err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message,
    }
  }
}

/**
 * Analyze HTML skeleton for boot hanging, recovery overlays, or runtime crashes.
 * @param {string} html HTML text returned from the root URL
 * @returns {{
 *   valid: boolean,
 *   hasRootContainer: boolean,
 *   hasBootHanging: boolean,
 *   hasRecoveryOverlay: boolean,
 *   fatalErrors: string[],
 *   issues: string[]
 * }}
 */
export function analyzeHtmlSkeleton(html) {
  const issues = []
  const fatalErrors = []

  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    issues.push('Empty HTML response body')
    return {
      valid: false,
      hasRootContainer: false,
      hasBootHanging: false,
      hasRecoveryOverlay: false,
      fatalErrors,
      issues,
    }
  }

  // 1. Check root DOM container existence
  const hasRootContainer =
    html.includes('id="root"') ||
    html.includes('id="app"') ||
    html.includes('id="__dsh_root__"') ||
    html.includes('<div id=root')

  if (!hasRootContainer) {
    issues.push('Missing root container element (#root or #app)')
  }

  // 2. Check for boot hanging / failed boot markers
  const hasBootHanging =
    html.includes('data-dsh-boot="hanging"') ||
    html.includes('data-dsh-boot="failed"') ||
    html.includes('data-dsh-boot="error"') ||
    html.includes('data-dsh-boot-error') ||
    html.includes('class="dsh-boot-error"')

  if (hasBootHanging) {
    issues.push('Detected boot hanging or failed boot state marker (data-dsh-boot="hanging/error")')
    fatalErrors.push('data-dsh-boot hanging/error')
  }

  // 3. Check for Desktop Recovery overlay (safe mode / emergency fallback)
  const hasRecoveryOverlay =
    html.includes('data-dsh-desktop-recovery') ||
    html.includes('id="dsh-desktop-recovery"') ||
    html.includes('class="dsh-recovery-overlay"') ||
    html.includes('data-recovery-mode="true"')

  if (hasRecoveryOverlay) {
    issues.push('Detected Desktop Recovery overlay (data-dsh-desktop-recovery) - app booted in recovery fallback')
    fatalErrors.push('data-dsh-desktop-recovery active')
  }

  // 4. Check for fatal unhandled exception markers
  const crashPatterns = [
    /Uncaught\s+(TypeError|ReferenceError|SyntaxError)/i,
    /ChunkLoadError:\s+Loading chunk/i,
    /Fatal\s+JavaScript\s+Error/i,
  ]

  for (const pattern of crashPatterns) {
    const match = pattern.exec(html)
    if (match) {
      issues.push(`Detected fatal runtime crash in HTML output: ${match[0]}`)
      fatalErrors.push(match[0])
    }
  }

  const valid = issues.length === 0 && fatalErrors.length === 0

  return {
    valid,
    hasRootContainer,
    hasBootHanging,
    hasRecoveryOverlay,
    fatalErrors,
    issues,
  }
}

/**
 * Optional CDP / DevTools probe to inspect browser console errors if CDP port is open.
 * @param {number | string} portOrUrl CDP HTTP port (e.g. 9222) or URL
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ available: boolean, targets?: any[], error?: string }>}
 */
export async function probeCdpConsole(portOrUrl, opts = {}) {
  const baseUrl = typeof portOrUrl === 'number' ? `http://127.0.0.1:${portOrUrl}` : portOrUrl
  const versionUrl = `${baseUrl.replace(/\/$/, '')}/json/version`

  try {
    const res = await probeHttpEndpoint(versionUrl, { timeoutMs: opts.timeoutMs ?? 1500 })
    if (res.ok && res.body) {
      const versionData = JSON.parse(res.body)
      return {
        available: true,
        targets: [versionData],
      }
    }
  } catch {
    // Ignore CDP errors
  }

  return {
    available: false,
  }
}
