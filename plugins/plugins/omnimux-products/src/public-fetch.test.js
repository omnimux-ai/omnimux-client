import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { publicFetch, publicLookup } from './public-fetch.js'
import { isSyntheticProxyIpv4 } from './public-host.js'

const resolveWith = (rows, all = false) => new Promise((resolve, reject) => {
  publicLookup(async () => rows)('shop.example', { all }, (err, value, family) => err ? reject(err) : resolve({ value, family }))
})
test('socket lookup rejects private, mapped, reserved and mixed DNS responses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '198.51.100.3', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', 'fe80::1']) {
    await assert.rejects(resolveWith([{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]), /non-public/)
  }
  await assert.rejects(resolveWith([]), /non-public/)
})
test('socket receives the exact checked public IPv4 and IPv6 answers', async () => {
  assert.deepEqual(await resolveWith([{ address: '8.8.4.4', family: 4 }]), { value: '8.8.4.4', family: 4 })
  const rows = [{ address: '2606:4700::1111', family: 6 }]
  assert.deepEqual(await resolveWith(rows, true), { value: rows, family: undefined })
})
test('transport pins its lookup and preserves original HTTPS Host, SNI and signed query', async () => {
  let lookups = 0
  let checked
  const url = 'https://cdn.example/image?signature=a%2Fb&expires=999'
  const response = await publicFetch(url, {}, {
    lookup: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }] },
    request: (target, options, done) => {
      assert.equal(target.href, url)
      assert.equal(options.servername, 'cdn.example')
      assert.equal(options.agent, false)
      const req = new EventEmitter()
      req.end = () => options.lookup(target.hostname, {}, (error, address) => {
        assert.ifError(error); checked = address
        const incoming = Readable.from([Buffer.from('ok')])
        incoming.statusCode = 200; incoming.headers = {}
        done(incoming)
      })
      return req
    },
  })
  assert.equal(await response.text(), 'ok')
  assert.equal(checked, '8.8.8.8')
  assert.equal(lookups, 1)
})
test('unsafe URL never invokes transport', async () => {
  for (const url of ['http://127.1/x', 'http://[::ffff:127.0.0.1]/', 'http://localhost./', 'https://u:p@example.com/', 'file:///tmp/x']) {
    await assert.rejects(publicFetch(url, {}, { request: () => assert.fail('dialed unsafe URL') }))
  }
})

test('asynchronous invalid response construction rejects and destroys the request and response', async () => {
  for (const init of [{}, { method: 'HEAD' }]) {
    for (const bad of [{ status: 600, headers: {} }, { status: 200, headers: { 'invalid header': 'value' } }]) {
      let incoming, requestDestroyed = false
      await assert.rejects(publicFetch('https://cdn.example/a', init, {
        request: (_target, _options, done) => {
          const req = new EventEmitter()
          req.destroy = () => { requestDestroyed = true }
          req.end = () => setImmediate(() => {
            incoming = Readable.from([Buffer.from('untrusted')])
            incoming.statusCode = bad.status
            incoming.headers = bad.headers
            done(incoming)
          })
          return req
        },
      }), /unsupported HTTP status|invalid header name/i)
      assert.equal(incoming.destroyed, true)
      assert.equal(requestDestroyed, true)
    }
  }
})

test('asynchronous ordinary response statuses retain their body and status', async () => {
  for (const status of [200, 302, 404, 599, 204, 304]) {
    const response = await publicFetch('https://cdn.example/a', {}, {
      request: (_target, _options, done) => {
        const req = new EventEmitter()
        req.destroy = () => assert.fail('valid response destroyed')
        req.end = () => setImmediate(() => {
          const incoming = Readable.from([Buffer.from('body')])
          incoming.statusCode = status
          incoming.headers = {}
          done(incoming)
        })
        return req
      },
    })
    assert.equal(response.status, status)
    assert.equal(await response.text(), [204, 304].includes(status) ? '' : 'body')
  }
})

test('bodyless asynchronous responses never decode their content-encoding header', async () => {
  for (const encoding of ['gzip', 'deflate', 'br']) {
    for (const [method, status] of [['HEAD', 200], ['GET', 204], ['GET', 205], ['GET', 304]]) {
      const response = await publicFetch('https://cdn.example/a', { method }, {
        request: (_target, _options, done) => {
          const req = new EventEmitter()
          req.destroy = () => {}
          req.end = () => setImmediate(() => {
            const incoming = Readable.from([])
            incoming.statusCode = status
            incoming.headers = { 'content-encoding': encoding }
            done(incoming)
          })
          return req
        },
      })
      assert.equal(response.status, status)
      assert.equal(await response.text(), '')
      // Flush asynchronous stream/decompress work so any uncaught error fails this test.
      await new Promise(resolve => setImmediate(resolve))
    }
  }
})

test('a malformed encoded GET rejects its body read instead of emitting an uncaught error', async () => {
  for (const encoding of ['gzip', 'deflate', 'br']) {
    const response = await publicFetch('https://cdn.example/a', {}, {
      request: (_target, _options, done) => {
        const req = new EventEmitter()
        req.destroy = () => {}
        req.end = () => setImmediate(() => {
          const incoming = Readable.from([])
          incoming.statusCode = 200
          incoming.headers = { 'content-encoding': encoding }
          done(incoming)
        })
        return req
      },
    })
    await assert.rejects(response.text())
  }
})

test('allows 198.18.0.0/15 fake-IP proxy answers only for explicitly allowlisted non-IP hostnames', async () => {
  const resolveFakeIp = async () => [{ address: '198.18.52.164', family: 4 }]
  const resolveWithOpts = (hostname, opts) => new Promise((resolve, reject) => {
    publicLookup(resolveFakeIp, opts)(hostname, {}, (err, value, family) => (err ? reject(err) : resolve({ value, family })))
  })

  await assert.rejects(resolveWithOpts('p16-oec-general.ttcdn-us.com'), /non-public/)
  await assert.rejects(
    resolveWithOpts('unlisted.example.com', { allowSyntheticProxyForHostname: (h) => h.endsWith('.ttcdn-us.com') }),
    /non-public/,
  )
  assert.deepEqual(
    await resolveWithOpts('p16-oec-general.ttcdn-us.com', { allowSyntheticProxyForHostname: (h) => h.endsWith('.ttcdn-us.com') }),
    { value: '198.18.52.164', family: 4 },
  )

  // Private, loopback, reserved, IPv4-mapped IPv6, and mixed DNS answers stay rejected even when allowlisted.
  for (const rows of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '10.0.0.1', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }],
    [{ address: '198.51.100.3', family: 4 }],
    [{ address: '::ffff:198.18.52.164', family: 6 }],
    [{ address: '198.18.52.164', family: 4 }, { address: '127.0.0.1', family: 4 }],
  ]) {
    await assert.rejects(
      new Promise((resolve, reject) => {
        publicLookup(async () => rows, { allowSyntheticProxyForHostname: () => true })(
          'p16-oec-general.ttcdn-us.com',
          {},
          (err, value, family) => (err ? reject(err) : resolve({ value, family })),
        )
      }),
      /non-public/,
    )
  }

  // Literal 198.18.x.x URLs remain refused before dialing even when opt-in callback returns true.
  await assert.rejects(
    publicFetch('https://198.18.52.164/a.webp', {}, {
      allowSyntheticProxyForHostname: () => true,
      request: () => assert.fail('dialed literal synthetic proxy IP'),
    }),
    /public HTTP\(S\) host/,
  )

  // Boundary checks on isSyntheticProxyIpv4 (strict canonical dotted-quad 198.18.0.0/15 only).
  assert.equal(isSyntheticProxyIpv4('198.18.0.0'), true)
  assert.equal(isSyntheticProxyIpv4('198.19.255.255'), true)
  assert.equal(isSyntheticProxyIpv4('198.17.255.255'), false)
  assert.equal(isSyntheticProxyIpv4('198.20.0.0'), false)
  assert.equal(isSyntheticProxyIpv4('198.18.01.1'), false)
  assert.equal(isSyntheticProxyIpv4('198.18.52.164.'), false)
  assert.equal(isSyntheticProxyIpv4('[198.18.52.164]'), false)

  // Exceptions thrown synchronously inside allowSyntheticProxyForHostname reject cleanly through lookup.
  await assert.rejects(
    resolveWithOpts('p16-oec-general.ttcdn-us.com', {
      allowSyntheticProxyForHostname: () => { throw new Error('callback boom') },
    }),
    /callback boom/,
  )
})

test('publicFetch forwards allowSyntheticProxyForHostname to socket lookup cleanly end to end', async () => {
  const dialed = []
  const okRes = await publicFetch('https://p16-oec-general.ttcdn-us.com/cover.webp', {}, {
    allowSyntheticProxyForHostname: (h) => h.endsWith('.ttcdn-us.com'),
    lookup: async () => [{ address: '198.18.52.164', family: 4 }],
    request: (target, options, done) => {
      const req = new EventEmitter()
      req.destroy = () => {}
      req.end = () => options.lookup(target.hostname, {}, (err, address, family) => {
        if (err) { req.emit('error', err); return }
        dialed.push({ host: target.hostname, address, family, servername: options.servername })
        const incoming = Readable.from([Buffer.from('webp-bytes')])
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'image/webp' }
        done(incoming)
      })
      return req
    },
  })
  assert.equal(okRes.status, 200)
  assert.equal(await okRes.text(), 'webp-bytes')
  assert.deepEqual(dialed, [{
    host: 'p16-oec-general.ttcdn-us.com',
    address: '198.18.52.164',
    family: 4,
    servername: 'p16-oec-general.ttcdn-us.com',
  }])

  // Unlisted host resolving to 198.18.x.x is rejected inside socket lookup before connecting.
  await assert.rejects(
    publicFetch('https://evil.example.com/cover.webp', {}, {
      allowSyntheticProxyForHostname: (h) => h.endsWith('.ttcdn-us.com'),
      lookup: async () => [{ address: '198.18.52.164', family: 4 }],
      request: (target, options) => {
        const req = new EventEmitter()
        req.destroy = () => {}
        req.end = () => options.lookup(target.hostname, {}, (err) => {
          if (err) req.emit('error', err)
          else assert.fail('unlisted host dialed fake IP')
        })
        return req
      },
    }),
    /non-public/,
  )
})
