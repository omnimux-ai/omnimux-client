import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { assertDownloadableUrl, isPrivateAddress } from './url-policy.js'
import { downloadMedia } from './downloader.js'

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function makeMockRequest(handler) {
  return (url, opts, onResponse) => {
    const req = new EventEmitter()
    req.end = () => {
      const incoming = new PassThrough()
      handler(url, opts, incoming, req)
      onResponse(incoming)
    }
    return req
  }
}

describe('omnimux-inspiration downloader & url-policy security (#367)', () => {
  it('blocks full IPv6 non-global ranges (multicast, site-local, 6to4, NAT64, discard, Teredo, doc)', () => {
    for (const ip of [
      'ff02::1',
      'fec0::1',
      '2002:7f00:0001::1',
      '64:ff9b::127.0.0.1',
      '64:ff9b:1::1',
      '100::1',
      '2001::1',
      '2001:db8::1',
      '3fff::1',
      '::ffff:0:127.0.0.1',
      '::ffff:169.254.169.254',
      'fe80::1%en0',
      'fc00::1',
      '::1',
      '::',
    ]) {
      assert.equal(isPrivateAddress(ip), true, `expected ${ip} to be classified non-public`)
    }
    assert.equal(isPrivateAddress('2606:4700:4700::1111'), false)
    assert.equal(isPrivateAddress('93.184.216.34'), false)
  })

  it('rejects embedded credentials and non-canonical numeric IPv4 in assertDownloadableUrl', async () => {
    await assert.rejects(
      () => assertDownloadableUrl('https://user:pass@cdn.example.com/a.png', { resolver: async () => [{ address: '93.184.216.34', family: 4 }] }),
      /拒绝下载|仅允许公网|credentials/i,
    )
    await assert.rejects(
      () => assertDownloadableUrl('http://0177.0.0.1/a.png'),
      /拒绝下载|仅允许公网|private|local|numeric/i,
    )
    await assert.rejects(
      () => assertDownloadableUrl('http://2130706433/a.png'),
      /拒绝下载|仅允许公网|private|local|numeric/i,
    )
    await assert.rejects(
      () => assertDownloadableUrl('http://localhost../a.png'),
      /拒绝下载|仅允许公网|无效|private|local/i,
    )
    await assert.rejects(
      () => assertDownloadableUrl('http://127.0.0.1../a.png'),
      /拒绝下载|仅允许公网|无效|private|local/i,
    )
  })

  it('pins DNS even when globalThis.fetch is passed as opts.fetcher', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'insp-dl-globalfetch-'))
    try {
      let pinnedIp = null
      const resolver = async () => [{ address: '93.184.216.34', family: 4 }]
      const requestImpl = makeMockRequest((_url, opts, incoming) => {
        opts.lookup('cdn.example.com', { all: false }, (_err, address) => { pinnedIp = address })
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'image/png', 'content-length': String(TINY_PNG.length) }
        incoming.end(TINY_PNG)
      })
      const saved = await downloadMedia('https://cdn.example.com/pic.png', dir, {
        fetcher: globalThis.fetch,
        resolver,
        requestImpl,
      })
      assert.equal(pinnedIp, '93.184.216.34')
      assert.deepEqual(readFileSync(saved), TINY_PNG)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pins the validated DNS IP into the socket connect lookup (defeating TTL=0 DNS rebinding)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'insp-dl-pin-'))
    try {
      let resolverCalls = 0
      const resolver = async () => {
        resolverCalls += 1
        // Second call would rebind to loopback if unpinned.
        if (resolverCalls === 1) return [{ address: '93.184.216.34', family: 4 }]
        return [{ address: '127.0.0.1', family: 4 }]
      }
      let dialedAddress = null
      let seenServername = null
      let seenAgent = 'unset'
      const requestImpl = makeMockRequest((_url, opts, incoming) => {
        seenAgent = opts.agent
        seenServername = opts.servername
        opts.lookup('rebind.example.com', { all: false }, (err, address) => {
          assert.equal(err, null)
          dialedAddress = address
        })
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'image/png', 'content-length': String(TINY_PNG.length) }
        incoming.end(TINY_PNG)
      })
      const saved = await downloadMedia('https://rebind.example.com/pic.png', dir, {
        resolver,
        requestImpl,
      })
      assert.equal(resolverCalls, 1)
      assert.equal(dialedAddress, '93.184.216.34')
      assert.equal(seenServername, 'rebind.example.com')
      assert.equal(seenAgent, false)
      assert.deepEqual(readFileSync(saved), TINY_PNG)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('strips Cookie and Authorization headers across cross-origin redirects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'insp-dl-redir-'))
    try {
      const seenHeaders = []
      const resolver = async () => [{ address: '93.184.216.34', family: 4 }]
      const requestImpl = makeMockRequest((url, opts, incoming) => {
        seenHeaders.push({ host: url.hostname, headers: { ...opts.headers } })
        if (url.hostname === 'origin-a.example.com') {
          incoming.statusCode = 302
          incoming.headers = { location: 'https://cdn-b.example.com/pic.png' }
          incoming.end()
        } else {
          incoming.statusCode = 200
          incoming.headers = { 'content-type': 'image/png' }
          incoming.end(TINY_PNG)
        }
      })
      await downloadMedia('https://origin-a.example.com/pic.png', dir, {
        resolver,
        requestImpl,
        headers: {
          Cookie: 'session=secret',
          Authorization: 'Bearer top-secret',
          Referer: 'https://origin-a.example.com/',
          'User-Agent': 'OmniMuxTest/1.0',
        },
      })
      assert.equal(seenHeaders.length, 2)
      assert.equal(seenHeaders[0].headers.Cookie, 'session=secret')
      assert.equal(seenHeaders[0].headers.Authorization, 'Bearer top-secret')
      assert.equal(seenHeaders[1].headers.Cookie, undefined)
      assert.equal(seenHeaders[1].headers.Authorization, undefined)
      assert.equal(seenHeaders[1].headers['User-Agent'], 'OmniMuxTest/1.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
