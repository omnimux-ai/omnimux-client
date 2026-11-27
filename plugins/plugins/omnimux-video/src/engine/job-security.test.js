import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { applyInputProtocolWhitelist, spawnFfmpeg, spawnFfprobe } from './ffmpeg.js'
import { assertSafeRemoteMediaUrl, materializeInput } from './job.js'
import * as probe from './capabilities/probe.js'
import * as trim from './capabilities/trim.js'
import * as split from './capabilities/split.js'
import * as audio from './capabilities/audio.js'
import * as scene from './capabilities/scene.js'
import * as thumb from './capabilities/thumb.js'
import * as inline from './capabilities/inline.js'
import * as slideshow from './capabilities/slideshow.js'

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

describe('omnimux-video materializeInput, FFmpeg protocol whitelist, and capability SSRF hardening (#367)', () => {
  it('injects -protocol_whitelist file,pipe before every -i in spawnFfmpeg and in spawnFfprobe', async () => {
    assert.deepEqual(
      applyInputProtocolWhitelist(['-ss', '1', '-i', '/a.mp4', '-stream_loop', '-1', '-i', '/b.mp3', '/out.mp4']),
      ['-ss', '1', '-protocol_whitelist', 'file,pipe', '-i', '/a.mp4', '-stream_loop', '-1', '-protocol_whitelist', 'file,pipe', '-i', '/b.mp3', '/out.mp4'],
    )

    let seenFfmpeg = null
    let seenFfprobe = null
    const runChild = (cmd, args) => {
      if (cmd === 'ffmpeg') seenFfmpeg = args
      else seenFfprobe = args
      return { child: { kill() {} }, done: Promise.resolve({ code: 0, stdout: '{}', stderr: '' }) }
    }
    await spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: ['-i', '/a.mp4', '-i', '/b.mp4', '/out.mp4'], runChild })
    await spawnFfprobe({ bin: { ffprobe: 'ffprobe' }, args: ['-of', 'json', '/a.mp4'], runChild })

    assert.equal(seenFfmpeg.filter((a) => a === '-protocol_whitelist').length, 2)
    assert.deepEqual(seenFfprobe.slice(0, 5), ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe'])
  })

  it('rejects loopback, metadata, private IPv4/IPv6, double-dot hosts, credentials, and DNS rebinding', async () => {
    for (const url of [
      'http://127.0.0.1/secret.mp4',
      'http://127.0.0.1../secret.mp4',
      'http://localhost../secret.mp4',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/a.mp4',
      'http://[::ffff:127.0.0.1]/a.mp4',
      'http://[64:ff9b::127.0.0.1]/a.mp4',
      'http://[fe80::1]/a.mp4',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://0177.0.0.1/a.mp4',
      'https://user:pass@cdn.example.com/a.mp4',
    ]) {
      await assert.rejects(() => assertSafeRemoteMediaUrl(url), /not allowed|not public|credentials|http\(s\)/i)
    }

    await assert.rejects(
      () => assertSafeRemoteMediaUrl('https://evil.example.com/v.mp4', async () => [{ address: '10.0.0.5', family: 4 }]),
      /non-public IP/i,
    )
  })

  it('rejects non-http(s) URI and FFmpeg protocol schemes in materializeInput while allowing POSIX and Windows paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-scheme-'))
    try {
      for (const bad of [
        'concat:http://127.0.0.1:8080/a.mp4',
        'subfile:,,start,0,end,100,,http://169.254.169.254/latest/meta-data/',
        'tcp://127.0.0.1:6379/',
        'ftp://example.com/a.mp4',
        'hls+http://example.com/list.m3u8',
        'file:///etc/passwd',
        'data:video/mp4;base64,AAAA',
      ]) {
        await assert.rejects(() => materializeInput(bad, dir, 'x'), /unsupported media URI scheme/i)
      }
      assert.equal(await materializeInput('/tmp/local.mp4', dir, 'ok'), '/tmp/local.mp4')
      assert.equal(await materializeInput('C:\\Users\\demo\\clip.mp4', dir, 'win'), 'C:\\Users\\demo\\clip.mp4')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects redirects to internal addresses and invalid upstream HTTP status codes cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-sec-'))
    try {
      let requestCount = 0
      const lookup = async (host) => {
        if (host === 'cdn.example.com') return [{ address: '93.184.216.34', family: 4 }]
        return [{ address: '127.0.0.1', family: 4 }]
      }
      const requestImpl = makeMockRequest((_url, _opts, incoming) => {
        requestCount += 1
        incoming.statusCode = 302
        incoming.headers = { location: 'http://127.0.0.1:8080/internal' }
        incoming.end()
      })
      await assert.rejects(
        () => materializeInput('https://cdn.example.com/clip.mp4', dir, 'in', { lookup, requestImpl }),
        /not public|not allowed/i,
      )
      assert.equal(requestCount, 1)

      const badStatusImpl = makeMockRequest((_url, _opts, incoming) => {
        incoming.statusCode = 101
        incoming.headers = {}
        incoming.end()
      })
      await assert.rejects(
        () => materializeInput('https://cdn.example.com/clip.mp4', dir, 'bad', { lookup, requestImpl: badStatusImpl }),
        /unexpected HTTP status 101/i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('streams downloads directly to disk, cleans up .part files on oversize, and pins validated DNS IP even if fetcher=globalThis.fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-cap-'))
    try {
      const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
      const oversizeImpl = makeMockRequest((_url, _opts, incoming) => {
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'video/mp4' }
        incoming.end(Buffer.alloc(2048, 0x41))
      })
      await assert.rejects(
        () => materializeInput('https://cdn.example.com/huge.mp4', dir, 'huge', { lookup, requestImpl: oversizeImpl, maxBytes: 1024 }),
        /exceeds 1024 byte limit/i,
      )
      assert.deepEqual(readdirSync(dir), [], 'oversize failure must leave zero .part files in tmpDir')

      let pinnedIp = null
      const okPayload = Buffer.from('0000001866747970', 'hex')
      const okImpl = makeMockRequest((_url, opts, incoming) => {
        opts.lookup('cdn.example.com', { all: false }, (_err, ip) => { pinnedIp = ip })
        incoming.statusCode = 200
        incoming.headers = { 'content-type': 'video/mp4', 'content-length': String(okPayload.length) }
        incoming.end(okPayload)
      })
      const file = await materializeInput('https://cdn.example.com/small.mp4', dir, 'small', {
        fetcher: globalThis.fetch,
        lookup,
        requestImpl: okImpl,
        maxBytes: 1024,
      })
      assert.equal(pinnedIp, '93.184.216.34')
      assert.deepEqual(readFileSync(file), okPayload)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('all sibling capabilities materialize inputs and block unsafe URLs before spawning ffmpeg/ffprobe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-video-caps-'))
    try {
      let spawned = 0
      const makeCtx = () => ({
        dest: join(dir, 'out.mp4'),
        tmpDir: dir,
        binVersion: '8.1.2',
        addFile() {},
        materialize: (u, l) => materializeInput(u, dir, l),
        runFprobe: async () => { spawned += 1; return '{}' },
        runFfmpeg: async () => { spawned += 1; return { code: 0, stdout: '', stderr: '' } },
        statBytes: async () => 100,
      })

      await assert.rejects(() => probe.execute({ mediaUrl: 'http://127.0.0.1:8080/x.mp4' }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => trim.execute({ videoUrl: 'http://169.254.169.254/v.mp4' }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => split.execute({ videoUrl: 'concat:http://127.0.0.1/v.mp4', segments: [{ startSeconds: 0, durationSeconds: 1 }] }, makeCtx()), /unsupported media URI scheme/i)
      await assert.rejects(() => audio.executeExtract({ videoUrl: 'http://127.0.0.1/v.mp4' }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => audio.executePrepare({ audioUrl: 'http://127.0.0.1/a.mp3' }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => scene.execute({ videoUrl: 'http://127.0.0.1/v.mp4' }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => thumb.execute({ videoUrl: 'http://127.0.0.1/v.mp4' }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => inline.execute({ videoUrl: 'http://127.0.0.1/v.mp4', preserveTimeline: false }, makeCtx()), /not public|not allowed/i)
      await assert.rejects(() => slideshow.execute({ imageUrls: ['http://127.0.0.1/img.jpg'] }, makeCtx()), /not public|not allowed/i)
      assert.equal(spawned, 0, 'no capability may invoke ffprobe/ffmpeg when input URL is unsafe')

      // Slideshow must also materialize audioUrl (even when imageUrls are local paths)
      const seenSlideshowAudio = []
      await assert.rejects(
        () => slideshow.execute({ imageUrls: ['/local/a.jpg'], audioUrl: 'http://127.0.0.1/bgm.mp3' }, {
          ...makeCtx(),
          runFprobe: async () => JSON.stringify({ streams: [{ width: 100, height: 100 }] }),
          runFfmpeg: async (args) => { seenSlideshowAudio.push(args) },
        }),
        /not public|not allowed/i,
      )
      assert.ok(seenSlideshowAudio.every((args) => !args.includes('http://127.0.0.1/bgm.mp3')))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
