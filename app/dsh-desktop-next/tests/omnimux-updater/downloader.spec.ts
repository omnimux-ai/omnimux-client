import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { downloadOmniMuxArtifact } from '../../src/omnimux-updater/downloader.ts'
import type { UpdateArtifactRequest } from '../../src/omnimux-updater/types.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function buildDmg(size: number): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.alloc(size)
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251
  bytes.write('koly', size - 512, 'ascii')
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

it('downloads parallel Range chunks, retries transient chunk errors, and verifies SHA-256', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-dl-parallel-')); roots.push(dir)
  const dmg = buildDmg(12_288) // 3 slices of 4096 bytes
  const dest = join(dir, 'OmniMux-2.0.26-arm64.dmg')
  const url = 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg'

  let rangeCalls = 0
  let failedOnce = false
  const request: UpdateArtifactRequest = async (reqUrl, init) => {
    const range = new Headers(init.headers).get('Range')
    if (range === null) {
      return {
        finalUrl: reqUrl,
        response: new Response(new Uint8Array(dmg.bytes), {
          status: 200,
          headers: { 'content-length': String(dmg.bytes.byteLength), 'accept-ranges': 'bytes', etag: '"v26"' },
        }),
      }
    }
    rangeCalls += 1
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range)
    const start = Number(match![1])
    const end = Number(match![2])
    if (start === 4096 && !failedOnce) {
      failedOnce = true
      return { finalUrl: reqUrl, response: new Response('', { status: 503 }) }
    }
    return {
      finalUrl: reqUrl,
      response: new Response(new Uint8Array(dmg.bytes.subarray(start, end + 1)), {
        status: 206,
        headers: { 'content-length': String(end - start + 1) },
      }),
    }
  }

  const saved = await downloadOmniMuxArtifact({
    url,
    platform: 'darwin',
    destinationPath: dest,
    expectedSha256: dmg.sha256,
    expectedSize: dmg.bytes.byteLength,
    request,
    retryBaseDelayMs: 5,
    parallel: { concurrency: 3, chunkBytes: 4096, minBytes: 4096 },
  })
  expect(saved).toBe(dest)
  expect(await readFile(dest)).toEqual(dmg.bytes)
  expect(failedOnce).toBe(true)
  expect(rangeCalls).toBe(3) // 2 slices + 1 retry
})

it('fails with DOWNLOAD_TIMEOUT when the stream stalls past idleTimeoutMs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-dl-timeout-')); roots.push(dir)
  const dest = join(dir, 'OmniMux-2.0.26-arm64.dmg')
  const stalled = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      // never closes or sends further chunks
    },
  })
  await expect(downloadOmniMuxArtifact({
    url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg',
    platform: 'darwin',
    destinationPath: dest,
    expectedSha256: 'a'.repeat(64),
    idleTimeoutMs: 40,
    request: async url => ({ finalUrl: url, response: new Response(stalled, { status: 200 }) }),
  })).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' })
  expect(existsSync(dest)).toBe(false)
})

it('rejects SHA-256 mismatch and removes temporary partial file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-dl-badhash-')); roots.push(dir)
  const dmg = buildDmg(2048)
  const dest = join(dir, 'OmniMux-2.0.26-arm64.dmg')
  await expect(downloadOmniMuxArtifact({
    url: 'https://dl.omnimux.ai/releases/v2.0.26/OmniMux-2.0.26-arm64.dmg',
    platform: 'darwin',
    destinationPath: dest,
    expectedSha256: 'f'.repeat(64),
    expectedSize: dmg.bytes.byteLength,
    request: async url => ({ finalUrl: url, response: new Response(new Uint8Array(dmg.bytes), { status: 200 }) }),
  })).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
  expect(existsSync(dest)).toBe(false)
})
