import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./r2-dist-sync.mjs', import.meta.url))
const good = Buffer.from('good latest bytes')
const tampered = Buffer.from('tampered latest bytes')

async function withServer(metadataSha256, body, fn) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/api/desktop/version-stable.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ version: '2.0.23', channel: 'stable', sha256: { macArm64: metadataSha256 } }))
      return
    }
    if (url.pathname.startsWith('/releases/latest/')) {
      response.writeHead(200, { 'content-length': String(body.length), 'content-type': 'application/octet-stream' })
      if (request.method === 'HEAD') response.end()
      else response.end(body)
      return
    }
    if (url.pathname.startsWith('/releases/v2.0.23/')) {
      response.writeHead(200, { 'content-length': '1' })
      response.end(request.method === 'HEAD' ? undefined : 'x')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}

function runVerify(baseUrl) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, 'verify', '--version', '2.0.23', '--required-platforms', 'mac-arm64', '--verify-hashes'], {
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
  await withServer(createHash('sha256').update(good).digest('hex'), tampered, async baseUrl => {
    const result = await runVerify(baseUrl)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /sha256 mismatch/)
  })
})

test('accepts matching metadata and latest artifact hashes', async () => {
  await withServer(createHash('sha256').update(good).digest('hex'), good, async baseUrl => {
    const result = await runVerify(baseUrl)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /\[SHA256\] mac-arm64/)
  })
})
