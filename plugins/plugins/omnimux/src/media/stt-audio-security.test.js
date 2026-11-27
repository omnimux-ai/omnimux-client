import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { isPublicAudioUrl, loadAudioBytes } from './stt-audio.js'

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

describe('omnimux stt-audio SSRF & credential-scoping hardening (#367)', () => {
  it('rejects private, loopback, metadata, non-global IPv6, and alternative numeric IPv4 URLs', async () => {
    for (const url of [
      'http://127.0.0.1/a.mp3',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/a.mp3',
      'http://[fe80::1]/a.mp3',
      'http://[ff02::1]/a.mp3',
      'http://[2002:7f00:1::1]/a.mp3',
      'http://[64:ff9b::127.0.0.1]/a.mp3',
      'http://0177.0.0.1/a.mp3',
      'http://2130706433/a.mp3',
      'https://user:pass@cdn.example.com/a.mp3',
      'http://metadata.google.internal/a.mp3',
      'http://localhost../a.mp3',
      'http://127.0.0.1../a.mp3',
    ]) {
      assert.equal(isPublicAudioUrl(url), false, `expected ${url} to be rejected`)
      await assert.rejects(() => loadAudioBytes(url), /not a public http\(s\) host/i)
    }
  })

  it('ignores globalThis.fetch to keep DNS IP pinning active and rejects invalid HTTP status codes cleanly', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
    let pinnedIp = null
    const okImpl = makeMockRequest((_url, opts, incoming) => {
      opts.lookup('cdn.example.com', { all: false }, (_err, ip) => { pinnedIp = ip })
      incoming.statusCode = 200
      incoming.headers = { 'content-type': 'audio/mpeg' }
      incoming.end(Buffer.from('ID3-pinned'))
    })
    const ok = await loadAudioBytes('https://cdn.example.com/a.mp3', {
      fetcher: globalThis.fetch,
      lookup,
      requestImpl: okImpl,
    })
    assert.equal(pinnedIp, '93.184.216.34')
    assert.equal(ok.bytes.toString(), 'ID3-pinned')

    const badStatusImpl = makeMockRequest((_url, _opts, incoming) => {
      incoming.statusCode = 101
      incoming.headers = {}
      incoming.end()
    })
    await assert.rejects(
      () => loadAudioBytes('https://cdn.example.com/a.mp3', { lookup, requestImpl: badStatusImpl }),
      /invalid HTTP status: 101/i,
    )
  })

  it('rejects hostnames that resolve to private IPs or redirect to private IPs', async () => {
    await assert.rejects(
      () => loadAudioBytes('https://rebind.example.com/a.mp3', {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      /non-public IP/i,
    )

    let requestCount = 0
    const requestImpl = makeMockRequest((_url, _opts, incoming) => {
      requestCount += 1
      incoming.statusCode = 302
      incoming.headers = { location: 'http://169.254.169.254/latest/meta-data/' }
      incoming.end()
    })
    await assert.rejects(
      () => loadAudioBytes('https://cdn.example.com/a.mp3', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        requestImpl,
      }),
      /not a public http\(s\) host/i,
    )
    assert.equal(requestCount, 1)
  })

  it('attaches Authorization Bearer ONLY on https://*.omnimux.ai and strips it on http:// or cross-host redirect', async () => {
    const seen = []
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }]

    // 1. Plain HTTP to omnimux.ai must NEVER receive the Bearer token.
    const httpImpl = makeMockRequest((url, opts, incoming) => {
      seen.push({ href: url.href, auth: opts.headers.authorization })
      incoming.statusCode = 200
      incoming.headers = { 'content-type': 'audio/mpeg' }
      incoming.end(Buffer.from('ID3-audio'))
    })
    await loadAudioBytes('http://api.omnimux.ai/audio/1.mp3', {
      apiKey: 'secret-test-key',
      lookup,
      requestImpl: httpImpl,
    })
    assert.equal(seen[0].auth, undefined)

    // 2. HTTPS to omnimux.ai receives Bearer, then redirects to third-party CDN which must NOT receive Bearer.
    const redirSeen = []
    const redirImpl = makeMockRequest((url, opts, incoming) => {
      redirSeen.push({ host: url.hostname, auth: opts.headers.authorization })
      if (url.hostname === 'api.omnimux.ai') {
        incoming.statusCode = 302
        incoming.headers = { location: 'https://cdn.thirdparty.example/file.mp3' }
        incoming.end()
      } else {
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'audio/mpeg' }
        incoming.end(Buffer.from('ID3-audio-ok'))
      }
    })
    const result = await loadAudioBytes('https://api.omnimux.ai/audio/2.mp3', {
      apiKey: 'secret-test-key',
      lookup,
      requestImpl: redirImpl,
    })
    assert.equal(redirSeen.length, 2)
    assert.equal(redirSeen[0].auth, 'Bearer secret-test-key')
    assert.equal(redirSeen[1].auth, undefined)
    assert.equal(result.bytes.toString(), 'ID3-audio-ok')
  })
})
