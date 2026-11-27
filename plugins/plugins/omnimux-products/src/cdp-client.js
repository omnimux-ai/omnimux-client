/**
 * A minimal Chrome DevTools Protocol client — four domains, zero dependencies.
 *
 * Playwright and puppeteer would each pull a second browser and hundreds of
 * megabytes of native code into a plugin whose host already ships Chromium.
 * This module speaks CDP over Node's built-in global `WebSocket` instead:
 * `Target.createTarget` → `Target.attachToTarget` → `Emulation.setDeviceMetricsOverride`
 * → `Page.navigate` → `Page.captureScreenshot`.
 *
 * Outbound SSRF defense is enforced at TWO layers:
 * 1. An ephemeral local HTTP/CONNECT proxy bound to `127.0.0.1:0` that
 *    validates every destination host and DNS answer against `isPrivateHost`
 *    and dials ONLY the validated public IP (defeating DNS rebinding,
 *    WebSockets, OOPIFs, Workers, and popups), paired with Chromium's
 *    `--proxy-server`, `--proxy-bypass-list=<-loopback>`, `--disable-quic`,
 *    and `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`.
 * 2. CDP `Fetch.enable` + `Target.setAutoAttach` across the page and child
 *    targets to block non-network schemes (`file://`, `chrome://`, etc.).
 *
 * Every failure is raised as a `CdpError` carrying one of the contract reason
 * codes, so the caller never has to classify a raw protocol error.
 *
 * Spec: `specs/digital-product-website-screenshots.spec.md` §2.1, §4.
 */
import { spawn } from 'node:child_process'
import { lookup as dnsLookup } from 'node:dns/promises'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect as netConnect, isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPrivateHost, normalizeHostname } from './public-host.js'
import {
  CAPTURE_BEYOND_VIEWPORT,
  NAV_TIMEOUT_MS,
  PORT_DISCOVERY_MS,
  SCREENSHOT_REASON,
} from './screenshot-contract.js'

const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])
const INLINE_SAFE_PROTOCOLS = new Set(['data:', 'blob:'])
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
])

/**
 * Resolve a hostname to validated public IP addresses (never private, loopback,
 * link-local, metadata, or non-global IPv6). Returns `null` if unsafe or
 * unresolvable.
 *
 * @param {unknown} rawHost
 * @param {typeof dnsLookup} [resolver]
 * @returns {Promise<Array<{ address: string, family: number }> | null>}
 */
export async function resolvePublicAddresses(rawHost, resolver = dnsLookup) {
  const rawText = String(rawHost ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!rawText || rawText.includes('..') || /[\s\u0000-\u001f]/.test(rawText)) return null
  const host = normalizeHostname(rawText)
  if (!host || isPrivateHost(host)) return null
  const literalFamily = isIP(host)
  if (literalFamily !== 0) {
    return [{ address: host, family: literalFamily }]
  }
  try {
    const answers = await resolver(host, { all: true, verbatim: true })
    if (!Array.isArray(answers) || answers.length === 0) return null
    const addresses = []
    for (const entry of answers) {
      const address = typeof entry === 'string' ? entry : entry?.address
      const family = typeof address === 'string' ? isIP(address) : 0
      if (family === 0 || isPrivateHost(address)) return null
      addresses.push({ address, family })
    }
    return addresses
  } catch {
    return null
  }
}

/**
 * Parse a `CONNECT` authority (`host:port` or `[ipv6]:port`).
 * @param {unknown} authority
 * @returns {{ host: string, port: number } | null}
 */
function parseConnectAuthority(authority) {
  const text = String(authority ?? '').trim()
  if (!text || /[\s\u0000-\u001f/@?#\\]/.test(text)) return null
  let host = ''
  let portStr = ''
  if (text.startsWith('[')) {
    const endBracket = text.indexOf(']')
    if (endBracket < 2 || text[endBracket + 1] !== ':') return null
    host = text.slice(1, endBracket)
    portStr = text.slice(endBracket + 2)
  } else {
    const colon = text.lastIndexOf(':')
    if (colon <= 0) return null
    host = text.slice(0, colon)
    portStr = text.slice(colon + 1)
    if (host.includes(':')) return null
  }
  if (!/^\d{1,5}$/.test(portStr)) return null
  const port = Number(portStr)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port }
}

/**
 * Create an ephemeral loopback HTTP/CONNECT proxy that validates destination
 * hosts and DNS answers against `isPrivateHost` and dials ONLY the validated
 * public IP (defeating DNS rebinding, WebSockets, OOPIFs, Workers, and popups).
 *
 * @param {{ resolver?: typeof dnsLookup, connectImpl?: typeof netConnect, httpRequestImpl?: typeof httpRequest }} [opts]
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> }>}
 */
export async function createEphemeralPublicProxy(opts = {}) {
  const resolver = opts.resolver ?? dnsLookup
  const connectImpl = opts.connectImpl ?? netConnect
  const httpRequestImpl = opts.httpRequestImpl ?? httpRequest
  /** @type {Set<import('node:net').Socket>} */
  const activeSockets = new Set()

  const trackSocket = (socket) => {
    if (!socket) return
    activeSockets.add(socket)
    socket.once('close', () => activeSockets.delete(socket))
  }

  const server = createHttpServer((clientReq, clientRes) => {
    trackSocket(clientReq.socket)
    const deny = (status = 403, message = 'Blocked by SSRF policy') => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(status, { 'content-type': 'text/plain', connection: 'close' })
      }
      clientRes.end(message)
    }

    let parsed
    try {
      parsed = new URL(String(clientReq.url ?? ''))
    } catch {
      deny(403)
      return
    }
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password) {
      deny(403)
      return
    }
    const port = parsed.port ? Number(parsed.port) : 80
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      deny(403)
      return
    }

    void (async () => {
      const addresses = await resolvePublicAddresses(parsed.hostname, resolver)
      if (!addresses || addresses.length === 0) {
        deny(403)
        return
      }
      const headers = {}
      for (const [k, v] of Object.entries(clientReq.headers)) {
        if (v === undefined) continue
        if (HOP_BY_HOP_HEADERS.has(k.toLowerCase())) continue
        headers[k] = v
      }
      headers.host = parsed.host
      headers.connection = 'close'

      const upstreamReq = httpRequestImpl({
        host: addresses[0].address,
        family: addresses[0].family,
        port,
        method: clientReq.method,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        agent: false,
      }, (upstreamRes) => {
        trackSocket(upstreamRes.socket)
        const resHeaders = {}
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (v !== undefined && !HOP_BY_HOP_HEADERS.has(k.toLowerCase())) resHeaders[k] = v
        }
        if (!clientRes.headersSent) {
          clientRes.writeHead(upstreamRes.statusCode ?? 502, resHeaders)
        }
        upstreamRes.pipe(clientRes)
        upstreamRes.on('error', () => {
          try { clientRes.destroy() } catch { /* ignore */ }
        })
      })

      upstreamReq.on('socket', trackSocket)
      upstreamReq.on('error', () => {
        deny(502, 'Upstream connection failed')
      })
      clientReq.on('error', () => {
        try { upstreamReq.destroy() } catch { /* ignore */ }
      })
      clientReq.pipe(upstreamReq)
    })()
  })

  server.on('connect', (req, clientSocket, head) => {
    trackSocket(clientSocket)
    const deny = (statusLine = '403 Forbidden') => {
      try {
        if (!clientSocket.destroyed) {
          clientSocket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`)
        }
      } catch {
        // Already closed.
      }
      try { clientSocket.destroy() } catch { /* ignore */ }
    }

    const parsed = parseConnectAuthority(req.url)
    if (!parsed) {
      deny('403 Forbidden')
      return
    }

    void (async () => {
      const addresses = await resolvePublicAddresses(parsed.host, resolver)
      if (!addresses || addresses.length === 0) {
        deny('403 Forbidden')
        return
      }
      if (clientSocket.destroyed) return
      let upstream
      try {
        upstream = connectImpl({
          host: addresses[0].address,
          port: parsed.port,
          family: addresses[0].family,
        })
      } catch {
        deny('502 Bad Gateway')
        return
      }
      trackSocket(upstream)

      let established = false
      upstream.once('connect', () => {
        established = true
        if (clientSocket.destroyed) {
          try { upstream.destroy() } catch { /* ignore */ }
          return
        }
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head && head.length > 0) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      upstream.on('error', () => {
        if (!established) deny('502 Bad Gateway')
        else try { clientSocket.destroy() } catch { /* ignore */ }
      })
      clientSocket.on('error', () => {
        try { upstream.destroy() } catch { /* ignore */ }
      })
      clientSocket.once('close', () => {
        try { upstream.destroy() } catch { /* ignore */ }
      })
      upstream.once('close', () => {
        try { clientSocket.destroy() } catch { /* ignore */ }
      })
    })()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  if (typeof server.unref === 'function') server.unref()
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  let closed = false
  return {
    port,
    url: `http://127.0.0.1:${String(port)}`,
    async close() {
      if (closed) return
      closed = true
      for (const socket of [...activeSockets]) {
        try { socket.destroy() } catch { /* ignore */ }
      }
      activeSockets.clear()
      await new Promise((resolve) => {
        try {
          server.close(() => resolve())
        } catch {
          resolve()
        }
      })
    },
  }
}

/**
 * Determine whether a CDP browser request (navigation, redirect, or subresource)
 * targets a safe public network destination (or inline non-network resource).
 * Refuses `file:`, `chrome:`, `ftp:`, embedded credentials, private/loopback/metadata
 * IPs, and hostnames whose DNS lookup resolves to any non-public IP.
 *
 * @param {unknown} rawUrl
 * @param {typeof dnsLookup} [resolver]
 * @returns {Promise<boolean>}
 */
export async function isSafeBrowserRequestUrl(rawUrl, resolver = dnsLookup) {
  const text = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!text) return false
  if (text === 'about:blank') return true
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return false
  }
  if (INLINE_SAFE_PROTOCOLS.has(parsed.protocol)) return true
  if (!NETWORK_PROTOCOLS.has(parsed.protocol)) return false
  if (parsed.username || parsed.password) return false
  const addresses = await resolvePublicAddresses(parsed.hostname, resolver)
  return Boolean(addresses && addresses.length > 0)
}

/** One connection per socket, keyed weakly so nothing leaks between runs. */
const CONNECTIONS = new WeakMap()

/**
 * A CDP or browser-level failure tagged with a contract reason code.
 */
export class CdpError extends Error {
  /**
   * @param {string} reason one of `SCREENSHOT_REASON`
   * @param {string} message
   */
  constructor(reason, message) {
    super(message)
    this.name = 'CdpError'
    this.reason = reason
  }
}

/**
 * @param {string} userDataDir
 * @param {{ proxyServer?: string | null }} [opts]
 * @returns {string[]} the switches for a throwaway, headless, network-quiet run
 */
export function browserArgs(userDataDir, opts = {}) {
  const proxyArgs = typeof opts.proxyServer === 'string' && opts.proxyServer.trim()
    ? [
        `--proxy-server=${opts.proxyServer.trim()}`,
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
      ]
    : []
  return [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1440,900',
    ...proxyArgs,
    'about:blank',
  ]
}

/**
 * Read `DevToolsActivePort` until the browser writes the port it chose.
 *
 * The file holds two lines: the port, then the WebSocket path.
 *
 * @param {string} portFile
 * @param {{ budgetMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number, read?: (file: string) => string }} [deps]
 * @returns {Promise<{ port: number, wsPath: string }>}
 * @throws {CdpError} `launch-failed`
 */
export async function discoverEndpoint(portFile, deps = {}) {
  const budgetMs = Number.isFinite(deps.budgetMs) ? Number(deps.budgetMs) : PORT_DISCOVERY_MS
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const read = deps.read ?? ((file) => readFileSync(file, 'utf8'))
  const deadline = now() + budgetMs

  for (;;) {
    try {
      const lines = String(read(portFile)).split('\n').map((line) => line.trim()).filter(Boolean)
      const port = Number(lines[0])
      if (Number.isInteger(port) && port > 0) {
        return { port, wsPath: lines[1] ?? '/devtools/browser' }
      }
    } catch {
      // Not written yet — keep waiting inside the budget.
    }
    if (now() >= deadline) {
      throw new CdpError(SCREENSHOT_REASON.LAUNCH_FAILED, 'the browser never reported a debugging port')
    }
    await sleep(50)
  }
}

/**
 * Start one headless browser with its own throwaway profile and an ephemeral
 * IP-pinned public egress proxy.
 *
 * The profile directory and proxy are created here and destroyed by `dispose`,
 * so the user's own Chrome profile, cookies and sign-ins are never touched.
 *
 * @param {string} binPath
 * @param {{ userDataDir?: string, budgetMs?: number, spawnImpl?: typeof spawn, sleep?: Function, now?: Function, read?: Function, fetchVersion?: Function, resolver?: typeof dnsLookup, createProxy?: typeof createEphemeralPublicProxy, proxyServer?: string | null }} [opts]
 * @returns {Promise<{ child: import('node:child_process').ChildProcess, port: number, webSocketDebuggerUrl: string, userDataDir: string, proxyUrl: string | null, dispose: () => Promise<void> }>}
 * @throws {CdpError} `launch-failed`
 */
export async function launchBrowser(binPath, opts = {}) {
  const spawnImpl = opts.spawnImpl ?? spawn
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'omnimux-shots-'))
  let child = null
  let proxy = null
  try {
    let proxyServer = null
    if (opts.proxyServer === null) {
      proxyServer = null
    } else if (typeof opts.proxyServer === 'string' && opts.proxyServer.trim()) {
      proxyServer = opts.proxyServer.trim()
    } else {
      proxy = await (opts.createProxy ?? createEphemeralPublicProxy)({ resolver: opts.resolver })
      proxyServer = proxy.url
    }
    child = spawnImpl(binPath, browserArgs(userDataDir, { proxyServer }), { stdio: 'ignore', windowsHide: true })
    if (child && typeof child.on === 'function') child.on('error', () => {})
    const { port } = await discoverEndpoint(join(userDataDir, 'DevToolsActivePort'), {
      budgetMs: opts.budgetMs ?? PORT_DISCOVERY_MS,
      sleep: opts.sleep,
      now: opts.now,
      read: opts.read,
    })
    const version = await (opts.fetchVersion ?? fetchVersionAt)(port)
    return {
      child,
      port,
      webSocketDebuggerUrl: version.webSocketDebuggerUrl,
      userDataDir,
      proxyUrl: proxyServer,
      dispose: () => dispose({ child, userDataDir, proxy }),
    }
  } catch (error) {
    await dispose({ child, userDataDir, proxy })
    if (error instanceof CdpError) throw error
    throw new CdpError(SCREENSHOT_REASON.LAUNCH_FAILED, messageOf(error))
  }
}

/**
 * @param {number} port
 * @returns {Promise<{ webSocketDebuggerUrl: string }>}
 */
async function fetchVersionAt(port) {
  const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`)
  if (!response.ok) {
    throw new CdpError(SCREENSHOT_REASON.LAUNCH_FAILED, `the browser answered HTTP ${String(response.status)}`)
  }
  const body = await response.json()
  const url = typeof body?.webSocketDebuggerUrl === 'string' ? body.webSocketDebuggerUrl : ''
  if (!url) throw new CdpError(SCREENSHOT_REASON.LAUNCH_FAILED, 'the browser reported no debugger url')
  return { webSocketDebuggerUrl: url }
}

/**
 * Kill the process, shut down the ephemeral egress proxy, and remove the
 * throwaway profile. Best effort by contract: a cleanup failure must never
 * mask the result the caller already has.
 *
 * @param {{ child?: import('node:child_process').ChildProcess | null, userDataDir?: string, proxy?: { close?: () => Promise<void> } | null }} handle
 * @returns {Promise<void>}
 */
export async function dispose(handle = {}) {
  const child = handle.child
  if (child) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
  if (handle.proxy && typeof handle.proxy.close === 'function') {
    try {
      await handle.proxy.close()
    } catch {
      // Best-effort shutdown.
    }
  }
  if (handle.userDataDir) {
    try {
      rmSync(handle.userDataDir, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // A locked profile directory is not worth failing an import over.
    }
  }
}

/**
 * Wrap one socket in a request/response + event connection.
 *
 * @param {WebSocket} ws
 * @returns {{ send: (method: string, params?: object, sessionId?: string) => Promise<any>, on: (method: string, handler: Function) => () => void, close: () => void }}
 */
export function createConnection(ws) {
  let nextId = 1
  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  const pending = new Map()
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map()

  const onMessage = (event) => {
    const raw = typeof event === 'string' ? event : event?.data
    let payload = null
    try {
      payload = JSON.parse(String(raw))
    } catch {
      return
    }
    if (payload?.id != null && pending.has(payload.id)) {
      const waiter = pending.get(payload.id)
      pending.delete(payload.id)
      if (payload.error) {
        waiter.reject(new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, String(payload.error.message ?? 'CDP error')))
      } else {
        waiter.resolve(payload.result)
      }
      return
    }
    if (payload?.method) {
      const set = listeners.get(payload.method)
      if (!set) return
      for (const handler of [...set]) {
        try {
          handler(payload)
        } catch {
          // A listener must never break the transport.
        }
      }
    }
  }

  ws.addEventListener('message', onMessage)

  return {
    send(method, params = {}, sessionId) {
      const id = nextId
      nextId += 1
      const message = { id, method, params }
      if (sessionId) message.sessionId = sessionId
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
          ws.send(JSON.stringify(message))
        } catch (error) {
          pending.delete(id)
          reject(error instanceof Error ? error : new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, String(error)))
        }
      })
    },
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, new Set())
      listeners.get(method).add(handler)
      return () => listeners.get(method)?.delete(handler)
    },
    close() {
      try {
        ws.removeEventListener('message', onMessage)
      } catch {
        // Transport already torn down.
      }
      try {
        ws.close()
      } catch {
        // Nothing left to close.
      }
    },
  }
}

/**
 * Send one command over an existing socket, reusing its connection.
 *
 * @param {WebSocket} ws
 * @param {string | undefined} sessionId
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>}
 */
export function sendCommand(ws, sessionId, method, params = {}) {
  let connection = CONNECTIONS.get(ws)
  if (!connection) {
    connection = createConnection(ws)
    CONNECTIONS.set(ws, connection)
  }
  return connection.send(method, params, sessionId)
}

/**
 * Open one page target, size it to the viewport, and hand back the three verbs
 * the capture layer needs.
 *
 * @param {{ webSocketDebuggerUrl: string }} endpoint
 * @param {{ kind: string, width: number, height: number, deviceScaleFactor: number, isMobile: boolean, hasTouch: boolean }} viewport
 * @param {{ timeoutMs?: number, socketFactory?: (url: string) => WebSocket, send?: typeof sendCommand, resolver?: typeof dnsLookup }} [opts]
 * @returns {Promise<{ sessionId: string, targetId: string, navigate: (url: string, ms?: number) => Promise<void>, capture: () => Promise<Buffer>, close: () => Promise<void> }>}
 */
export async function attachPage(endpoint, viewport, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : NAV_TIMEOUT_MS
  const socketFactory = opts.socketFactory ?? ((url) => new WebSocket(url))
  const send = opts.send ?? sendCommand
  const ws = socketFactory(endpoint.webSocketDebuggerUrl)
  await waitForOpen(ws, timeoutMs)

  const connection = CONNECTIONS.get(ws) ?? createConnection(ws)
  CONNECTIONS.set(ws, connection)

  let offFetchPaused = () => {}
  let offTargetAttached = () => {}
  let offTargetDetached = () => {}

  try {
    const created = await send(ws, undefined, 'Target.createTarget', { url: 'about:blank' })
    const targetId = String(created?.targetId ?? '')
    if (!targetId) throw new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, 'the browser created no page target')
    const attached = await send(ws, undefined, 'Target.attachToTarget', { targetId, flatten: true })
    const sessionId = String(attached?.sessionId ?? '')
    if (!sessionId) throw new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, 'the page target refused a session')

    const guardedSessions = new Set([sessionId])

    // Register Fetch & child-target listeners BEFORE enabling Fetch/auto-attach
    // so no early paused request or child target misses interception.
    offFetchPaused = connection.on('Fetch.requestPaused', (payload) => {
      const eventSessionId = typeof payload?.sessionId === 'string' && payload.sessionId
        ? payload.sessionId
        : sessionId
      if (!guardedSessions.has(eventSessionId)) return
      const requestId = payload?.params?.requestId
      if (typeof requestId !== 'string' || !requestId) return
      const requestUrl = payload?.params?.request?.url
      void (async () => {
        let allowed = false
        try {
          allowed = await isSafeBrowserRequestUrl(requestUrl, opts.resolver)
        } catch {
          allowed = false
        }
        try {
          if (allowed) {
            await send(ws, eventSessionId, 'Fetch.continueRequest', { requestId })
          } else {
            await send(ws, eventSessionId, 'Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
          }
        } catch {
          // Session may already have closed while evaluating the intercepted request.
        }
      })()
    })

    offTargetAttached = connection.on('Target.attachedToTarget', (payload) => {
      const childSessionId = typeof payload?.params?.sessionId === 'string' ? payload.params.sessionId : ''
      if (!childSessionId || guardedSessions.has(childSessionId)) return
      guardedSessions.add(childSessionId)
      const waiting = payload?.params?.waitingForDebugger === true
      void (async () => {
        try {
          await send(ws, childSessionId, 'Fetch.enable', {
            patterns: [{ urlPattern: '*', requestStage: 'Request' }],
          })
        } catch {
          // Some child targets (e.g. non-network workers) may reject Fetch.enable;
          // all network egress still passes through the ephemeral IP-pinned proxy.
        } finally {
          if (waiting) {
            try {
              await send(ws, childSessionId, 'Runtime.runIfWaitingForDebugger')
            } catch {
              // Child target may already have closed.
            }
          }
        }
      })()
    })

    offTargetDetached = connection.on('Target.detachedFromTarget', (payload) => {
      const detachedSessionId = typeof payload?.params?.sessionId === 'string' ? payload.params.sessionId : ''
      if (detachedSessionId && detachedSessionId !== sessionId) {
        guardedSessions.delete(detachedSessionId)
      }
    })

    await send(ws, sessionId, 'Page.enable')
    await send(ws, sessionId, 'Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    })
    await send(ws, sessionId, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    }).catch(() => {})

    await send(ws, sessionId, 'Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: viewport.isMobile,
    })
    await send(ws, sessionId, 'Emulation.setTouchEmulationEnabled', {
      enabled: viewport.hasTouch === true,
      maxTouchPoints: viewport.hasTouch === true ? 5 : 1,
    })

    return {
      sessionId,
      targetId,
      async navigate(url, navTimeoutMs = timeoutMs) {
        const loaded = waitForEvent(connection, 'Page.loadEventFired', sessionId, navTimeoutMs)
        let outcome = null
        try {
          outcome = await send(ws, sessionId, 'Page.navigate', { url })
        } catch (error) {
          loaded.cancel()
          throw error
        }
        if (outcome?.errorText) {
          loaded.cancel()
          throw new CdpError(SCREENSHOT_REASON.NAV_FAILED, String(outcome.errorText))
        }
        await loaded.promise
      },
      async capture() {
        const shot = await send(ws, sessionId, 'Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: CAPTURE_BEYOND_VIEWPORT,
        })
        const data = typeof shot?.data === 'string' ? shot.data : ''
        if (!data) throw new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, 'the browser returned an empty frame')
        return Buffer.from(data, 'base64')
      },
      async close() {
        offFetchPaused()
        offTargetAttached()
        offTargetDetached()
        try {
          await send(ws, undefined, 'Target.closeTarget', { targetId })
        } catch {
          // The target may already be gone; the socket close below settles it.
        }
        connection.close()
      },
    }
  } catch (error) {
    offFetchPaused()
    offTargetAttached()
    offTargetDetached()
    connection.close()
    throw error
  }
}

/**
 * @param {WebSocket} ws
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForOpen(ws, timeoutMs) {
  if (ws.readyState === 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, 'the debugger socket could not be opened'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new CdpError(SCREENSHOT_REASON.CAPTURE_FAILED, 'the debugger socket did not open in time'))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    const cleanup = () => {
      clearTimeout(timer)
      try {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
      } catch {
        // Detached transport.
      }
    }
    ws.addEventListener('open', onOpen)
    ws.addEventListener('error', onError)
  })
}

/**
 * Wait for one event on one session, or fail with `nav-timeout`.
 *
 * The returned handle exposes `cancel()` so a navigation that fails on its own
 * does not leave a timer behind.
 *
 * @param {{ on: (method: string, handler: Function) => () => void }} connection
 * @param {string} method
 * @param {string} sessionId
 * @param {number} timeoutMs
 * @returns {{ promise: Promise<void>, cancel: () => void }}
 */
function waitForEvent(connection, method, sessionId, timeoutMs) {
  let settle = null
  const promise = new Promise((resolve, reject) => {
    let off = () => {}
    let timer = null
    off = connection.on(method, (payload) => {
      if (payload?.sessionId && sessionId && payload.sessionId !== sessionId) return
      settle = null
      clearTimeout(timer)
      off()
      resolve()
    })
    timer = setTimeout(() => {
      settle = null
      off()
      reject(new CdpError(SCREENSHOT_REASON.NAV_TIMEOUT, `no ${method} within ${String(timeoutMs)}ms`))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    settle = () => {
      clearTimeout(timer)
      off()
    }
  })
  return {
    promise,
    cancel: () => {
      if (typeof settle === 'function') settle()
    },
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function defaultSleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}
