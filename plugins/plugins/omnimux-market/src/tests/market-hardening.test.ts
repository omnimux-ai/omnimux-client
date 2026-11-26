import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { sanitizePatch, validateConfigPatchInput, withDefaults } from '../config-store.js'
import { handleApi, MAX_API_BODY_BYTES } from '../local-api.js'
import { trustedRestartRequest } from '../restart.js'
import { unzipToFiles } from '../unzip.js'

function makeZipFromEntries(entries: Array<{ name: string; data: Buffer; method?: number; uncompSizeOverride?: number }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const method = entry.method ?? 0
    const comp = method === 8 ? deflateRawSync(entry.data) : entry.data
    const uncompSize = entry.uncompSizeOverride ?? entry.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(uncompSize, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, comp)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(uncompSize, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdBuf, eocd])
}

function mockJsonRequest(method: string, url: string, headers: Record<string, string>, payload: string | Buffer): IncomingMessage {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  const stream = Readable.from(buf.length ? [buf] : []) as unknown as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = { ...headers }
  return stream
}

function mockJsonResponse(): { res: ServerResponse; status: () => number; body: () => Record<string, unknown> } {
  let code = 0
  let raw = ''
  const headers: Record<string, unknown> = {}
  const res = {
    get statusCode() { return code },
    set statusCode(v: number) { code = v },
    setHeader(k: string, v: unknown) { headers[k.toLowerCase()] = v },
    end(chunk?: unknown) { raw = chunk === undefined ? '' : String(chunk) },
  } as unknown as ServerResponse
  return {
    res,
    status: () => code,
    body: () => (raw ? JSON.parse(raw) as Record<string, unknown> : {}),
  }
}

test('trustedRestartRequest rejects same-site, spoofed x-forwarded-host, and port mismatch (#362)', () => {
  const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: '127.0.0.1' } }) as Parameters<typeof trustedRestartRequest>[0]

  // Valid same-origin
  assert.equal(trustedRestartRequest(req({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'same-origin',
  })), true)

  // Reject sec-fetch-site: same-site (another localhost port / sibling subdomain)
  assert.equal(trustedRestartRequest(req({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'same-site',
  })), false)

  // Reject spoofed x-forwarded-host even when it matches attacker Origin
  assert.equal(trustedRestartRequest(req({
    host: '127.0.0.1:3080',
    origin: 'https://evil.example',
    'x-forwarded-host': 'evil.example',
  })), false)

  // Reject implicit vs explicit port mismatch (http default port 80 vs explicit 8080)
  assert.equal(trustedRestartRequest(req({
    host: '127.0.0.1',
    origin: 'http://127.0.0.1:8080',
  })), false)
  assert.equal(trustedRestartRequest(req({
    host: '127.0.0.1:8080',
    origin: 'http://127.0.0.1',
  })), false)

  // Explicit default port matches omitted default port on same scheme
  assert.equal(trustedRestartRequest(req({
    host: 'example.com',
    origin: 'https://example.com:443',
  })), true)
  assert.equal(trustedRestartRequest(req({
    host: 'example.com:80',
    origin: 'https://example.com',
  })), false)

  // Unnormalized Origin with path/query/backslash/userinfo/tab/empty-port rejected
  for (const badOrigin of [
    'http://127.0.0.1:3080/evil',
    'http://127.0.0.1:3080\\',
    'http://127.0.0.1:3080\\..',
    'http://@127.0.0.1:3080',
    'http://127.0.0.1\t:3080',
    'http://127.0.0.1:',
  ]) {
    assert.equal(trustedRestartRequest(req({
      host: '127.0.0.1:3080',
      origin: badOrigin,
    })), false, `expected ${JSON.stringify(badOrigin)} rejected`)
  }

  // Comma-joined / array / duplicate Sec-Fetch-Site or duplicate rawHeaders rejected
  assert.equal(trustedRestartRequest(req({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'same-origin, cross-site',
  })), false)
  assert.equal(trustedRestartRequest({
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    rawHeaders: ['Host', '127.0.0.1:3080', 'Host', 'evil.example', 'Origin', 'http://127.0.0.1:3080'],
    socket: { remoteAddress: '127.0.0.1' },
  } as Parameters<typeof trustedRestartRequest>[0]), false)
})

test('config-store & handleConfigRoute restrict apiBase, webBase, and skillsDir (#362)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-mkt-cfg-'))
  const outsideDir = await mkdtemp(join(tmpdir(), 'omnimux-mkt-outside-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    await mkdir(join(dir, 'skills', 'real', 'sub'), { recursive: true })
    await symlink(outsideDir, join(dir, 'symlink-skills'))
    await symlink(join(dir, 'skills', 'real'), join(dir, 'inner-link'))

    // Reject http:, loopback, private IP, metadata, credentials, non-443 port, empty ?/#/@, tabs, single-label hosts
    for (const badUrl of [
      'http://api.skillhub.cn',
      'https://127.0.0.1/api',
      'https://169.254.169.254/latest',
      'https://localhost/api',
      'https://user:pass@api.skillhub.cn',
      'https://api.skillhub.cn:8443',
      'https://api.skillhub.cn?',
      'https://api.skillhub.cn#',
      'https://@api.skillhub.cn',
      'https://api.skill\thub.cn',
      'https://intranet',
    ]) {
      assert.equal(sanitizePatch({ apiBase: badUrl }).apiBase, undefined, `expected ${badUrl} rejected`)
      assert.ok(validateConfigPatchInput({ apiBase: badUrl }, dir))
      assert.ok(validateConfigPatchInput({ webBase: badUrl }, dir))
    }

    // Reject skillsDir outside DSH_HOME, traversal, null byte, direct or intermediate symlinks
    for (const badDir of [
      '/etc',
      outsideDir,
      join(dir, '..', 'escape'),
      join(dir, 'symlink-skills'),
      join(dir, 'symlink-skills', 'nested'),
      join(dir, 'inner-link', 'sub'),
      `${join(dir, 'skills')}\0evil`,
      'relative/skills',
    ]) {
      assert.equal(sanitizePatch({ skillsDir: badDir }).skillsDir, undefined, `expected ${badDir} rejected`)
      assert.ok(validateConfigPatchInput({ skillsDir: badDir }, dir))
    }

    // Accept skillsDir inside a not-yet-created DSH_HOME (fresh install / clean CI runner)
    const freshHome = join(tmpdir(), `omnimux-mkt-fresh-${Date.now()}`)
    const freshSkills = join(freshHome, 'skills')
    assert.equal(validateConfigPatchInput({ skillsDir: freshSkills }, freshHome), null)

    // Accept valid HTTPS public URL and subdirectory inside DSH_HOME
    const validSkills = join(dir, 'skills', 'custom')
    const validPatch = sanitizePatch({
      apiBase: 'https://api.skillhub.cn/',
      webBase: 'https://skillhub.cn/',
      skillsDir: validSkills,
    })
    assert.equal(validPatch.apiBase, 'https://api.skillhub.cn')
    assert.equal(validPatch.webBase, 'https://skillhub.cn')
    assert.equal(validPatch.skillsDir, validSkills)
    assert.equal(validateConfigPatchInput({ apiBase: 'https://api.skillhub.cn', skillsDir: validSkills }, dir), null)

    // HTTP POST config save rejects unsafe skillsDir / apiBase with 400
    const cfg = withDefaults({ skillsDir: join(dir, 'skills') })
    const badReq = mockJsonRequest(
      'POST',
      '/api',
      { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
      JSON.stringify({ method: 'config', save: true, apiBase: 'http://169.254.169.254' }),
    )
    const badRes = mockJsonResponse()
    await handleApi(badReq, badRes.res, cfg)
    assert.equal(badRes.status(), 400)
    assert.equal(badRes.body().ok, false)
    assert.equal(cfg.apiBase, 'https://api.skillhub.cn')
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    await rm(dir, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
  }
})

test('handleApi enforces MAX_API_BODY_BYTES and returns HTTP 413 on oversized POST bodies (#362)', async () => {
  const cfg = withDefaults({})
  const oversized = Buffer.alloc(MAX_API_BODY_BYTES + 128, 0x61)
  const req = mockJsonRequest(
    'POST',
    '/api',
    { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    oversized,
  )
  const res = mockJsonResponse()
  await handleApi(req, res.res, cfg)
  assert.equal(res.status(), 413)
  assert.equal(res.body().ok, false)

  // Malformed JSON, JSON null, non-object JSON, and prototype method names return 400 (never 500 or hang)
  for (const badPayload of ['{bad', 'null', '[]', '123', '{"method":"toString"}', '{"method":"constructor"}']) {
    const r = mockJsonRequest(
      'POST',
      '/api',
      { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
      badPayload,
    )
    const out = mockJsonResponse()
    await handleApi(r, out.res, cfg)
    assert.equal(out.status(), 400, `expected 400 for ${badPayload}`)
    assert.equal(out.body().ok, false)
  }
})

test('unzipToFiles enforces zip-bomb ratio, size, entry count, depth, and path traversal bounds (#362)', () => {
  // 1. Zip bomb (highly compressible zeros -> > 100x compression ratio)
  const bombData = Buffer.alloc(512 * 1024, 0)
  const bombZip = makeZipFromEntries([{ name: 'SKILL.md', data: bombData, method: 8 }])
  assert.throws(() => unzipToFiles(bombZip), /压缩比|大小上限/)

  // 2. Spoofed small header uncompSize with large inflated stream aborted by maxOutputLength
  const spoofZip = makeZipFromEntries([{ name: 'SKILL.md', data: Buffer.alloc(32 * 1024, 0x41), method: 8, uncompSizeOverride: 10 }])
  assert.throws(() => unzipToFiles(spoofZip, { maxEntryBytes: 1024, maxTotalBytes: 2048 }), /上限/)

  // 3. Entry count limit
  const manyEntries = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('ok') }))
  const manyZip = makeZipFromEntries(manyEntries)
  assert.throws(() => unzipToFiles(manyZip, { maxEntries: 10 }), /条目数/)

  // 4. Path traversal, absolute paths, backslash, prototype-polluting segments, and excessive nesting depth
  for (const badName of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'dir\\file.txt', 'a/b/c/d/e/f/g.txt', '__proto__', 'a/__proto__/x.txt', 'constructor', 'prototype']) {
    const badZip = makeZipFromEntries([{ name: badName, data: Buffer.from('x') }])
    assert.throws(
      () => unzipToFiles(badZip, { maxPathDepth: 5 }),
      /不安全路径|非法|绝对路径|层级/,
      `expected ${badName} to be rejected`,
    )
  }

  // 5. Total bytes limit across multiple entries + legitimate 0-byte deflated entry when remaining === 0
  const multiZip = makeZipFromEntries([
    { name: 'a.txt', data: Buffer.alloc(600, 0x61) },
    { name: 'b.txt', data: Buffer.alloc(600, 0x62) },
  ])
  assert.throws(() => unzipToFiles(multiZip, { maxTotalBytes: 1000 }), /总大小/)

  const exactPlusEmptyDeflated = makeZipFromEntries([
    { name: 'full.txt', data: Buffer.alloc(100, 0x61), method: 0 },
    { name: 'empty.txt', data: Buffer.alloc(0), method: 8 },
  ])
  const exactFiles = unzipToFiles(exactPlusEmptyDeflated, { maxTotalBytes: 100 })
  assert.equal(exactFiles['full.txt']?.length, 100)
  assert.equal(exactFiles['empty.txt']?.length, 0)

  // 6. Normal skill zip still extracts cleanly
  const okZip = makeZipFromEntries([
    { name: 'SKILL.md', data: Buffer.from('# Normal Skill\nHello world'), method: 8 },
    { name: 'refs/guide.md', data: Buffer.from('guide text'), method: 0 },
  ])
  const files = unzipToFiles(okZip)
  assert.equal(files['SKILL.md']?.toString('utf8'), '# Normal Skill\nHello world')
  assert.equal(files['refs/guide.md']?.toString('utf8'), 'guide text')
})
