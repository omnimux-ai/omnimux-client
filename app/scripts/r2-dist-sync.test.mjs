import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { generateEd25519KeyPair, signManifestBytes } from './sign-release-manifest.mjs'

const script = fileURLToPath(new URL('./r2-dist-sync.mjs', import.meta.url))
const good = Buffer.from('good latest bytes')
const tampered = Buffer.from('tampered latest bytes')

async function withServer(options, fn) {
  const {
    metadataSha256,
    body,
    v2Manifest,
    v2Sig,
    versionedBody = body,
  } = options
  let baseUrl = ''
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/api/desktop/version-stable.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ version: '2.0.23', channel: 'stable', sha256: { macArm64: metadataSha256 } }))
      return
    }
    if (url.pathname === '/api/desktop/v2/stable.json' && v2Manifest !== undefined) {
      const payload = typeof v2Manifest === 'function' ? v2Manifest(baseUrl) : v2Manifest
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(payload)
      return
    }
    if (url.pathname === '/api/desktop/v2/stable.json.sig' && v2Sig !== undefined) {
      const payload = typeof v2Sig === 'function' ? v2Sig(baseUrl) : v2Sig
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(payload)
      return
    }
    if (url.pathname.startsWith('/releases/latest/')) {
      response.writeHead(200, { 'content-length': String(body.length), 'content-type': 'application/octet-stream' })
      if (request.method === 'HEAD') response.end()
      else response.end(body)
      return
    }
    if (url.pathname.startsWith('/releases/v2.0.23/')) {
      response.writeHead(200, { 'content-length': String(versionedBody.length), 'content-type': 'application/octet-stream' })
      if (request.method === 'HEAD') response.end()
      else response.end(versionedBody)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`
  try {
    return await fn(baseUrl)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}

function runVerify(baseUrl, extraArgs = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      script, 'verify', '--version', '2.0.23', '--required-platforms', 'mac-arm64', '--verify-hashes', ...extraArgs,
    ], {
      env: { ...process.env, OMNIMUX_DIST_BASE_URL: baseUrl },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

test('rejects a sha256 mismatch between metadata and the downloaded latest artifact', async () => {
  await withServer({ metadataSha256: createHash('sha256').update(good).digest('hex'), body: tampered }, async baseUrl => {
    const result = await runVerify(baseUrl)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /sha256 mismatch/)
  })
})

test('accepts matching legacy metadata and latest artifact hashes', async () => {
  await withServer({ metadataSha256: createHash('sha256').update(good).digest('hex'), body: good }, async baseUrl => {
    const result = await runVerify(baseUrl)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /\[SHA256\] mac-arm64/)
  })
})

test('verifies signed Manifest v2 and immutable versioned artifact hashes', async () => {
  const sha = createHash('sha256').update(good).digest('hex')
  const pair = generateEd25519KeyPair()
  const makeManifest = baseUrl => `${JSON.stringify({
    schemaVersion: 2,
    product: 'omnimux',
    channel: 'stable',
    version: '2.0.23',
    publishedAt: '2026-11-26T00:00:00.000Z',
    urgency: 'normal',
    rollout: { percentage: 100, salt: '2.0.23-stable' },
    releaseNotesUrl: 'https://github.com/omnimux-ai/omnimux-client/releases/tag/v2.0.23',
    notes: { zh: [], en: [] },
    artifacts: {
      'darwin-arm64': {
        url: `${baseUrl}/releases/v2.0.23/OmniMux-2.0.23-arm64.dmg`,
        sha256: sha,
        size: good.length,
        minOsVersion: '13.0',
      },
    },
  }, null, 2)}\n`

  await withServer({
    metadataSha256: sha,
    body: good,
    v2Manifest: makeManifest,
    v2Sig: baseUrl => JSON.stringify(signManifestBytes(Buffer.from(makeManifest(baseUrl), 'utf8'), {
      privateKey: pair.privateKeyBase64,
      keyId: 'k1',
    })),
  }, async baseUrl => {
    const ok = await runVerify(baseUrl, ['--require-v2', '--public-key', pair.publicKeyBase64])
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /\[MANIFEST v2 SIG\] verified Ed25519 signature/)
    assert.match(ok.stdout, /\[v2 SHA256\] mac-arm64/)

    const wrongPair = generateEd25519KeyPair()
    const badSig = await runVerify(baseUrl, ['--require-v2', '--public-key', wrongPair.publicKeyBase64])
    assert.equal(badSig.status, 1)
    assert.match(badSig.stdout, /signature verification failed/)
  })
})

test('fails --require-v2 when Manifest v2 is missing', async () => {
  await withServer({ metadataSha256: createHash('sha256').update(good).digest('hex'), body: good }, async baseUrl => {
    const result = await runVerify(baseUrl, ['--require-v2'])
    assert.equal(result.status, 1)
    assert.match(result.stdout, /\[MANIFEST v2\].*404/)
  })
})
