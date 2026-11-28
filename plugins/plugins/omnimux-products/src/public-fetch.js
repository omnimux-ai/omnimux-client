import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { createUnzip, createBrotliDecompress } from 'node:zlib'
import { isPrivateHost, isSyntheticProxyIpv4, normalizeHostname } from './public-host.js'

/** Resolve once inside the socket lookup: the checked answer is the connected address. */
export function publicLookup(resolver = lookup, options = {}) {
  const allowCheck = typeof options?.allowSyntheticProxyForHostname === 'function'
    ? options.allowSyntheticProxyForHostname
    : null
  return (hostname, lookupOptions, callback) => {
    const normalizedHost = normalizeHostname(hostname)
    Promise.resolve().then(async () => {
      const allowSyntheticProxy = Boolean(
        allowCheck
        && normalizedHost
        && !isIP(normalizedHost)
        && !isPrivateHost(normalizedHost)
        && allowCheck(normalizedHost) === true,
      )
      const addresses = await resolver(hostname, { all: true, verbatim: true })
      const isAllowedAddress = ({ address, family }) => {
        if (!isIP(address) || isIP(address) !== family) return false
        if (!isPrivateHost(address)) return true
        return allowSyntheticProxy && family === 4 && isSyntheticProxyIpv4(address)
      }
      if (!addresses.length || !addresses.every(isAllowedAddress)) {
        throw new Error('remote host resolved to a non-public address')
      }
      if (lookupOptions?.all) callback(null, addresses)
      else callback(null, addresses[0].address, addresses[0].family)
    }).catch((error) => callback(error))
  }
}

/** Single-hop HTTP transport; no redirects or additional DNS lookup are delegated. */
export function publicFetch(input, init = {}, deps = {}) {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHost(url.hostname)) {
    return Promise.reject(new Error('remote URL must use a public HTTP(S) host'))
  }
  const request = deps.request ?? (url.protocol === 'https:' ? httpsRequest : httpRequest)
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: init.method ?? 'GET',
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), 'accept-encoding': 'identity' },
      signal: init.signal,
      agent: false,
      lookup: publicLookup(deps.lookup, { allowSyntheticProxyForHostname: deps.allowSyntheticProxyForHostname }),
      // Keep the URL hostname for Host and certificate verification; lookup only selects the address.
      ...(url.protocol === 'https:' && !isIP(normalizeHostname(url.hostname)) ? { servername: normalizeHostname(url.hostname) } : {}),
    }, (incoming) => {
      let body = incoming
      try {
        const status = incoming.statusCode ?? 500
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          throw new Error('remote response has an unsupported HTTP status')
        }
        const headers = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
        }
        if (init.method === 'HEAD' || [204, 205, 304].includes(status)) {
          incoming.on('error', reject)
          incoming.resume()
          resolve(new Response(null, { status, headers }))
          return
        }
        const encoding = headers.get('content-encoding')?.toLowerCase()
        if (encoding === 'gzip' || encoding === 'deflate' || encoding === 'br') {
          body = encoding === 'br' ? createBrotliDecompress() : createUnzip()
          incoming.on('error', (error) => body.destroy(error))
          body.on('close', () => incoming.destroy())
          incoming.pipe(body)
          headers.delete('content-length')
          headers.delete('content-encoding')
        }
        resolve(new Response(Readable.toWeb(body), { status, headers }))
      } catch (error) {
        body.destroy()
        if (body !== incoming) incoming.destroy()
        req.destroy()
        reject(error)
      }
    })
    req.on('error', reject)
    req.end()
  })
}
