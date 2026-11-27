import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { PassThrough } from 'node:stream'
import {
  attachPage,
  browserArgs,
  createEphemeralPublicProxy,
  isSafeBrowserRequestUrl,
} from './cdp-client.js'

function createFakeSocket(onSend) {
  const listeners = new Map()
  const sent = []
  return {
    readyState: 1,
    sent,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    send(raw) {
      const msg = JSON.parse(raw)
      sent.push(msg)
      if (typeof onSend === 'function') onSend(msg, this)
      if (msg.id) {
        let result = {}
        if (msg.method === 'Target.createTarget') result = { targetId: 't-1' }
        else if (msg.method === 'Target.attachToTarget') result = { sessionId: 's-1' }
        queueMicrotask(() => {
          this.emit('message', { data: JSON.stringify({ id: msg.id, result }) })
        })
      }
    },
    emit(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
    close() {},
  }
}

function sendProxyHttp(proxyPort, targetUrl) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: targetUrl,
      headers: { host: new URL(targetUrl).host },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

function sendProxyConnect(proxyPort, authority) {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host: '127.0.0.1', port: proxyPort }, () => {
      sock.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
    })
    const chunks = []
    sock.on('data', (c) => {
      chunks.push(c)
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.includes('\r\n\r\n')) {
        sock.end()
        resolve(text)
      }
    })
    sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    sock.on('error', reject)
  })
}

describe('omnimux-products CDP Fetch interception & IP-pinned proxy SSRF hardening (#367)', () => {
  it('blocks loopback, private, metadata, file://, credentials, and DNS-rebound URLs in isSafeBrowserRequestUrl', async () => {
    const publicDns = async () => [{ address: '93.184.216.34', family: 4 }]
    const privateDns = async () => [{ address: '127.0.0.1', family: 4 }]

    assert.equal(await isSafeBrowserRequestUrl('https://example.com/landing', publicDns), true)
    assert.equal(await isSafeBrowserRequestUrl('about:blank', publicDns), true)
    assert.equal(await isSafeBrowserRequestUrl('data:image/png;base64,AAAA', publicDns), true)

    for (const blocked of [
      'http://127.0.0.1:64245/api/secret',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/admin',
      'http://198.18.0.1/bench',
      'http://[::1]/local',
      'http://[::ffff:127.0.0.1]/local',
      'http://[fe80::1]/link-local',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://0177.0.0.1/',
      'http://localhost../',
      'file:///etc/passwd',
      'chrome://settings',
      'https://user:pass@example.com/',
    ]) {
      assert.equal(await isSafeBrowserRequestUrl(blocked, publicDns), false, `expected ${blocked} to be blocked`)
    }
    assert.equal(await isSafeBrowserRequestUrl('https://rebind.example.com/', privateDns), false)
  })

  it('configures browserArgs with proxy, <-loopback> bypass override, QUIC disabled, and host-resolver-rules', () => {
    const args = browserArgs('/tmp/profile', { proxyServer: 'http://127.0.0.1:41234' })
    assert.ok(args.includes('--proxy-server=http://127.0.0.1:41234'))
    assert.ok(args.includes('--proxy-bypass-list=<-loopback>'))
    assert.ok(args.includes('--disable-quic'))
    assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'))
  })

  it('ephemeral public proxy blocks HTTP and CONNECT to loopback/metadata/DNS-rebound targets and pins public IPs', async () => {
    const dialedTcp = []
    const dialedHttp = []
    const resolver = async (host) => {
      if (host === 'public.example.com') return [{ address: '93.184.216.34', family: 4 }]
      if (host === 'rebind.example.com') return [{ address: '169.254.169.254', family: 4 }]
      return [{ address: '127.0.0.1', family: 4 }]
    }
    const connectImpl = (opts) => {
      dialedTcp.push({ host: opts.host, port: opts.port, family: opts.family })
      const fake = new PassThrough()
      queueMicrotask(() => {
        fake.emit('connect')
        fake.end('TUNNEL-OK')
      })
      return fake
    }
    const httpRequestImpl = (opts, onResponse) => {
      dialedHttp.push({ host: opts.host, port: opts.port, headersHost: opts.headers?.host })
      const req = new EventEmitter()
      req.end = () => {
        const res = new PassThrough()
        res.statusCode = 200
        res.headers = { 'content-type': 'text/plain' }
        onResponse(res)
        res.end('PUBLIC-OK')
      }
      req.write = () => true
      req.destroy = () => {}
      return req
    }

    const proxy = await createEphemeralPublicProxy({ resolver, connectImpl, httpRequestImpl })
    try {
      for (const badUrl of [
        'http://127.0.0.1:64245/internal',
        'http://169.254.169.254/latest/meta-data/',
        'http://rebind.example.com/secret',
      ]) {
        const res = await sendProxyHttp(proxy.port, badUrl)
        assert.equal(res.status, 403, `expected HTTP 403 for ${badUrl}`)
      }
      assert.equal(dialedHttp.length, 0, 'blocked HTTP targets must never open upstream sockets')

      for (const badAuthority of [
        '127.0.0.1:443',
        '[::1]:443',
        '169.254.169.254:80',
        'rebind.example.com:443',
      ]) {
        const head = await sendProxyConnect(proxy.port, badAuthority)
        assert.match(head, /^HTTP\/1\.1 403 Forbidden/i, `expected CONNECT 403 for ${badAuthority}`)
      }
      assert.equal(dialedTcp.length, 0, 'blocked CONNECT targets must never open upstream TCP sockets')

      // Public HTTP target dials the pinned IP directly
      const okHttp = await sendProxyHttp(proxy.port, 'http://public.example.com/page')
      assert.equal(okHttp.status, 200)
      assert.equal(okHttp.body, 'PUBLIC-OK')
      assert.deepEqual(dialedHttp, [{ host: '93.184.216.34', port: 80, headersHost: 'public.example.com' }])

      // Public CONNECT target (HTTPS / WSS) dials the pinned IP directly
      const okConnect = await sendProxyConnect(proxy.port, 'public.example.com:443')
      assert.match(okConnect, /^HTTP\/1\.1 200 Connection Established/i)
      assert.deepEqual(dialedTcp, [{ host: '93.184.216.34', port: 443, family: 4 }])
    } finally {
      await proxy.close()
    }
  })

  it('registers Fetch.requestPaused before Fetch.enable and auto-attaches Fetch guard on child targets', async () => {
    let earlyPausedEmitted = false
    const ws = createFakeSocket((msg, sock) => {
      // Simulate an immediate Fetch.requestPaused event arriving during the Fetch.enable roundtrip.
      if (msg.method === 'Fetch.enable' && msg.sessionId === 's-1' && !earlyPausedEmitted) {
        earlyPausedEmitted = true
        sock.emit('message', {
          data: JSON.stringify({
            method: 'Fetch.requestPaused',
            sessionId: 's-1',
            params: { requestId: 'req-early', request: { url: 'http://127.0.0.1:64245/early' } },
          }),
        })
      }
    })
    const resolver = async (host) => {
      if (host === 'public.example.com') return [{ address: '93.184.216.34', family: 4 }]
      if (host === 'rebind.example.com') return [{ address: '169.254.169.254', family: 4 }]
      return [{ address: '10.0.0.8', family: 4 }]
    }
    const page = await attachPage(
      { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test' },
      { kind: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
      { socketFactory: () => ws, resolver },
    )

    assert.ok(ws.sent.some((m) => m.method === 'Fetch.enable' && m.sessionId === 's-1'))
    assert.ok(ws.sent.some((m) => m.method === 'Target.setAutoAttach' && m.sessionId === 's-1'))

    // Simulate a child target (OOPIF / popup / worker) attaching with waitingForDebugger=true
    ws.emit('message', {
      data: JSON.stringify({
        method: 'Target.attachedToTarget',
        params: { sessionId: 's-child', waitingForDebugger: true, targetInfo: { type: 'iframe' } },
      }),
    })
    await new Promise((r) => setTimeout(r, 20))

    assert.ok(ws.sent.some((m) => m.method === 'Fetch.enable' && m.sessionId === 's-child'))
    assert.ok(ws.sent.some((m) => m.method === 'Runtime.runIfWaitingForDebugger' && m.sessionId === 's-child'))

    ws.emit('message', {
      data: JSON.stringify({
        method: 'Fetch.requestPaused',
        sessionId: 's-child',
        params: { requestId: 'req-child-file', request: { url: 'file:///etc/passwd' } },
      }),
    })
    ws.emit('message', {
      data: JSON.stringify({
        method: 'Fetch.requestPaused',
        sessionId: 's-1',
        params: { requestId: 'req-rebind', request: { url: 'https://rebind.example.com/meta' } },
      }),
    })
    ws.emit('message', {
      data: JSON.stringify({
        method: 'Fetch.requestPaused',
        sessionId: 's-1',
        params: { requestId: 'req-public', request: { url: 'https://public.example.com/app.js' } },
      }),
    })

    await new Promise((r) => setTimeout(r, 30))

    assert.ok(
      ws.sent.some((m) => m.method === 'Fetch.failRequest' && m.sessionId === 's-1' && m.params?.requestId === 'req-early' && m.params?.errorReason === 'BlockedByClient'),
      'early paused request arriving during Fetch.enable must be intercepted',
    )
    assert.ok(
      ws.sent.some((m) => m.method === 'Fetch.failRequest' && m.sessionId === 's-child' && m.params?.requestId === 'req-child-file' && m.params?.errorReason === 'BlockedByClient'),
      'child target file:// request must fail with BlockedByClient',
    )
    assert.ok(
      ws.sent.some((m) => m.method === 'Fetch.failRequest' && m.sessionId === 's-1' && m.params?.requestId === 'req-rebind' && m.params?.errorReason === 'BlockedByClient'),
      'DNS-rebound request must fail with BlockedByClient',
    )
    assert.ok(
      ws.sent.some((m) => m.method === 'Fetch.continueRequest' && m.sessionId === 's-1' && m.params?.requestId === 'req-public'),
      'public subrequest must continue',
    )

    await page.close()
  })
})
