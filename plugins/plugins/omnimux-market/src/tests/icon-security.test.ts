import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { withDefaults } from '../config-store.js'
import {
  ICON_SECURITY_HEADERS,
  assertSafePublicHttpsUrl,
  isBlockedIconIp,
  sniffSafeRasterImageMime,
  type IconHttpsRequest,
} from '../icon-guard.js'
import { handleIcon, type HandleIconDeps } from '../local-api.js'

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

async function callIcon(
  target: string,
  deps?: HandleIconDeps,
): Promise<{ status: number; body: Buffer | string; headers: Record<string, string> }> {
  const result = { status: 0, body: '' as Buffer | string, headers: {} as Record<string, string> }
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string): void => { result.headers[name.toLowerCase()] = value },
    end(body: Buffer | string): void { result.status = this.statusCode; result.body = body },
  }
  await handleIcon(
    { url: `/?url=${encodeURIComponent(target)}` } as IncomingMessage,
    response as unknown as ServerResponse,
    withDefaults({}),
    deps,
  )
  return result
}

test('icon proxy blocks non-HTTPS, loopback, private, metadata, and IPv6 reserved targets before fetching', async () => {
  const blocked = [
    'http://example.com/icon.png',
    'https://127.0.0.1/icon.png',
    'https://localhost/icon.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.1/icon.png',
    'https://172.16.0.1/icon.png',
    'https://192.168.1.1/icon.png',
    'https://100.64.0.1/icon.png',
    'https://[::1]/icon.png',
    'https://[::ffff:127.0.0.1]/icon.png',
    'https://[fc00::1]/icon.png',
    'https://[fe80::1]/icon.png',
    'https://[::ffff:0:127.0.0.1]/icon.png',
    'https://[64:ff9b:1::127.0.0.1]/icon.png',
    'https://[2001::1]/icon.png',
    'https://[3fff::1]/icon.png',
    'https://[4000::1]/icon.png',
    'https://example.com:6379/icon.png',
    'https://user:pass@example.com/icon.png',
  ]
  let fetchCalled = 0
  for (const target of blocked) {
    const res = await callIcon(target, {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => {
        fetchCalled += 1
        return new Response(VALID_PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      },
    })
    assert.equal(res.status, 400, `expected 400 for ${target}, got ${res.status}`)
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
  }
  assert.equal(fetchCalled, 0)
  assert.equal(isBlockedIconIp('8.8.8.8'), false)
  assert.equal(isBlockedIconIp('2606:4700:4700::1111'), false)
  assert.equal(isBlockedIconIp('64:ff9b::1'), true)
  assert.equal(isBlockedIconIp('64:ff9b:1::127.0.0.1'), true)
  assert.equal(isBlockedIconIp('::ffff:0:127.0.0.1'), true)
  assert.equal(isBlockedIconIp('2001::1'), true)
  assert.equal(isBlockedIconIp('2001:2::1'), true)
  assert.equal(isBlockedIconIp('3fff::1'), true)
  assert.equal(isBlockedIconIp('4000::1'), true)
  assert.equal(isBlockedIconIp('fec0::1'), true)
})

test('icon proxy pins validated DNS IP on socket connect to prevent TOCTOU DNS rebinding', async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'market-icon-pin-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmpHome
  try {
    let lookupCalls = 0
    let connectedAddress = ''
    let observedServername = ''
    let observedAgent: unknown = 'unset'
    const fakeRequest = ((
      _url: unknown,
      opts: { lookup?: (h: string, o: Record<string, unknown>, cb: (err: Error | null, addr: string, fam: number) => void) => void; servername?: string; agent?: unknown },
      onResponse: (res: IncomingMessage) => void,
    ) => {
      observedServername = String(opts.servername || '')
      observedAgent = opts.agent
      opts.lookup?.('rebind.example.net', {}, (err, addr) => {
        assert.equal(err, null)
        connectedAddress = addr
      })
      const req = new EventEmitter() as unknown as ClientRequest
      ;(req as unknown as { end: () => void }).end = () => {
        const stream = new PassThrough()
        const incoming = stream as unknown as IncomingMessage
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'image/png' }
        onResponse(incoming)
        stream.end(VALID_PNG)
      }
      ;(req as unknown as { destroy: () => void }).destroy = () => {}
      return req
    }) as unknown as IconHttpsRequest

    // Simulate a TTL=0 rebinding DNS server that returns a public IP once and 127.0.0.1 if queried again
    const res = await callIcon('https://rebind.example.net/avatar.png', {
      lookup: async () => {
        lookupCalls += 1
        return lookupCalls === 1
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }]
      },
      requestImpl: fakeRequest,
    })
    assert.equal(res.status, 200)
    assert.equal(lookupCalls, 1)
    assert.equal(connectedAddress, '93.184.216.34')
    assert.equal(observedServername, 'rebind.example.net')
    assert.equal(observedAgent, false)
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(tmpHome, { recursive: true, force: true })
  }
})

test('icon proxy blocks DNS rebinding to private IP and rejects non-HTTPS or private redirects', async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'market-icon-ssrf-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmpHome
  try {
    let called = false
    const dnsPrivate = await callIcon('https://private.example.net/a.png', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async () => {
        called = true
        return new Response(VALID_PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      },
    })
    assert.equal(dnsPrivate.status, 400)
    assert.equal(called, false)

    await assert.rejects(
      () => assertSafePublicHttpsUrl('https://nxdomain.example.net/a.png', async () => { throw new Error('ENOTFOUND') }),
    )

    const visited: string[] = []
    const redirHttp = await callIcon('https://public.example.net/start.png', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async (input) => {
        visited.push(String(input))
        return new Response(null, { status: 302, headers: { location: 'http://public.example.net/downgrade.png' } })
      },
    })
    assert.equal(redirHttp.status, 400)
    assert.deepEqual(visited, ['https://public.example.net/start.png'])

    const redirMeta = await callIcon('https://public.example.net/meta.png', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }),
    })
    assert.equal(redirMeta.status, 400)
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(tmpHome, { recursive: true, force: true })
  }
})

test('icon proxy rejects HTML/SVG/spoofed raster payloads, enforces byte cap, and emits sandbox CSP + nosniff on valid PNG', async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'market-icon-mime-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmpHome
  try {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

    const svgRes = await callIcon('https://cdn.example.net/evil.svg', {
      lookup: publicLookup,
      fetchImpl: async () => new Response('<svg onload="alert(1)"></svg>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }),
    })
    assert.equal(svgRes.status, 415)

    const htmlRes = await callIcon('https://cdn.example.net/evil.html', {
      lookup: publicLookup,
      fetchImpl: async () => new Response('<html><script>alert(1)</script></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    })
    assert.equal(htmlRes.status, 415)

    // Spoofed Content-Type: image/png carrying HTML/SVG bytes must fail magic-byte sniff
    const spoofedRes = await callIcon('https://cdn.example.net/spoof.png', {
      lookup: publicLookup,
      fetchImpl: async () => new Response('<svg onload="alert(1)"></svg>', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    })
    assert.equal(spoofedRes.status, 415)
    assert.equal(sniffSafeRasterImageMime(Buffer.from('<svg></svg>')), null)

    // Oversized icon rejected with 413
    const hugeRes = await callIcon('https://cdn.example.net/huge.png', {
      lookup: publicLookup,
      maxBytes: 128,
      fetchImpl: async () => new Response(Buffer.concat([VALID_PNG, Buffer.alloc(256)]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    })
    assert.equal(hugeRes.status, 413)

    // Valid PNG succeeds with sandbox CSP, nosniff, and disk cache quota enforcement
    const okRes = await callIcon('https://cdn.example.net/good.png', {
      lookup: publicLookup,
      cacheMaxEntries: 2,
      fetchImpl: async () => new Response(VALID_PNG, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    })
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers['content-type'], 'image/png')
    assert.equal(okRes.headers['x-content-type-options'], ICON_SECURITY_HEADERS['x-content-type-options'])
    assert.equal(okRes.headers['content-security-policy'], ICON_SECURITY_HEADERS['content-security-policy'])

    // Subsequent writes beyond cacheMaxEntries must be automatically pruned by handleIcon
    for (let i = 1; i <= 3; i += 1) {
      await callIcon(`https://cdn.example.net/avatar-${i}.png`, {
        lookup: publicLookup,
        cacheMaxEntries: 2,
        fetchImpl: async () => new Response(VALID_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      })
    }
    const cacheDir = join(tmpHome, 'cache', 'market-avatars')
    const binFiles = readdirSync(cacheDir).filter((f) => f.endsWith('.bin'))
    assert.ok(binFiles.length <= 2, `expected <= 2 cached icons via auto-prune, got ${binFiles.length}`)

    // cacheMaxBytes eviction must also trigger automatically via handleIcon
    const mediumPng = Buffer.concat([VALID_PNG, Buffer.alloc(60)])
    for (let i = 1; i <= 3; i += 1) {
      await callIcon(`https://cdn.example.net/bytes-${i}.png`, {
        lookup: publicLookup,
        cacheMaxEntries: 10,
        cacheMaxBytes: mediumPng.length + 10,
        fetchImpl: async () => new Response(mediumPng, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      })
    }
    const afterBytesBin = readdirSync(cacheDir).filter((f) => f.endsWith('.bin'))
    assert.equal(afterBytesBin.length, 1, `expected 1 cached icon under cacheMaxBytes, got ${afterBytesBin.length}`)

    // Pre-existing disk cache for blocked URLs or symlinked cache files must never be served
    mkdirSync(cacheDir, { recursive: true })
    const blockedUrl = 'https://127.0.0.1/cached-evil.png'
    const blockedHash = createHash('sha256').update(blockedUrl).digest('hex')
    writeFileSync(join(cacheDir, `${blockedHash}.bin`), VALID_PNG)
    writeFileSync(join(cacheDir, `${blockedHash}.meta.json`), JSON.stringify({ url: blockedUrl, contentType: 'image/png', savedAt: Date.now() }))
    const blockedCachedRes = await callIcon(blockedUrl, { lookup: publicLookup })
    assert.equal(blockedCachedRes.status, 400)

    const symUrl = 'https://cdn.example.net/symlinked-cache.png'
    const symHash = createHash('sha256').update(symUrl).digest('hex')
    const outsidePng = join(tmpHome, 'outside.png')
    writeFileSync(outsidePng, VALID_PNG)
    symlinkSync(outsidePng, join(cacheDir, `${symHash}.bin`))
    writeFileSync(join(cacheDir, `${symHash}.meta.json`), JSON.stringify({ url: symUrl, contentType: 'image/png', savedAt: Date.now() }))
    let fetchedAfterSymlink = 0
    const symRes = await callIcon(symUrl, {
      lookup: publicLookup,
      fetchImpl: async () => {
        fetchedAfterSymlink += 1
        return new Response(VALID_PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      },
    })
    assert.equal(symRes.status, 200)
    assert.equal(fetchedAfterSymlink, 1)
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(tmpHome, { recursive: true, force: true })
  }
})
