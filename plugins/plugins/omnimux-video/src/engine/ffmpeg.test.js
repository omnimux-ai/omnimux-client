import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VideoError } from '../errors.js'
import {
  parseVersion,
  versionTuple,
  supportsXfade,
  truncateTail,
  resolveBinaryPaths,
  resolveBin,
  spawnFfmpeg,
  spawnFfprobe,
  killAll,
} from './ffmpeg.js'

test('parseVersion extracts semver from ffmpeg -version output', () => {
  assert.equal(parseVersion('ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers'), '8.1.2')
  assert.equal(parseVersion('ffmpeg version 4.3.1'), '4.3.1')
  assert.equal(parseVersion('garbage'), null)
})

test('versionTuple parses major.minor.patch', () => {
  assert.deepEqual(versionTuple('8.1.2'), [8, 1, 2])
  assert.deepEqual(versionTuple('4.3'), [4, 3, 0])
  assert.deepEqual(versionTuple(null), [0, 0, 0])
})

test('supportsXfade requires >= 4.3', () => {
  assert.equal(supportsXfade('8.1.2'), true)
  assert.equal(supportsXfade('4.3.0'), true)
  assert.equal(supportsXfade('4.2.9'), false)
  assert.equal(supportsXfade('3.4'), false)
  assert.equal(supportsXfade(null), false)
})

test('truncateTail caps long text and keeps the tail', () => {
  const long = 'x'.repeat(2000)
  const out = truncateTail(long, 800)
  assert.ok(out.length < 1000)
  assert.ok(out.endsWith('x'.repeat(800)))
  assert.ok(out.startsWith('…[truncated'))
  assert.equal(truncateTail('short', 800), 'short')
})

test('resolveBinaryPaths: empty → PATH names', () => {
  assert.deepEqual(resolveBinaryPaths(''), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })
  assert.deepEqual(resolveBinaryPaths('  '), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })
})

test('resolveBinaryPaths: file path → sibling ffprobe', () => {
  assert.deepEqual(resolveBinaryPaths('/opt/homebrew/bin/ffmpeg'), {
    ffmpeg: '/opt/homebrew/bin/ffmpeg',
    ffprobe: '/opt/homebrew/bin/ffprobe',
  })
})

test('resolveBin: bogus path → missing:true, never throws', () => {
  const bin = resolveBin({ ffmpegPath: '/nonexistent/ffmpeg-xyz' })
  assert.equal(bin.missing, true)
  assert.equal(bin.version, null)
})

test('resolveBin: directory path resolves binaries inside it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omnimux-video-bin-'))
  try {
    const { ffmpeg, ffprobe } = resolveBinaryPaths(dir)
    assert.equal(ffmpeg, join(dir, 'ffmpeg'))
    assert.equal(ffprobe, join(dir, 'ffprobe'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function mockRunChild(result) {
  return () => ({
    child: { kill() {} },
    done: Promise.resolve(result),
  })
}

test('spawnFfmpeg prepends -hide_banner -loglevel error -y', async () => {
  let seen = null
  const runChild = (cmd, args) => {
    seen = { cmd, args }
    return { child: { kill() {} }, done: Promise.resolve({ code: 0, stdout: '', stderr: '' }) }
  }
  const out = await spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: ['-i', 'x.mp4', 'out.mp4'], runChild })
  assert.equal(out.code, 0)
  assert.deepEqual(seen.args, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'x.mp4', 'out.mp4'])
})

test('spawnFfmpeg loglevel defaults to error but is overridable', async () => {
  let seen = null
  const runChild = (cmd, args) => {
    seen = { cmd, args }
    return { child: { kill() {} }, done: Promise.resolve({ code: 0, stdout: '', stderr: '' }) }
  }
  await spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: ['-i', 'x.mp4'], runChild })
  assert.deepEqual(seen.args.slice(0, 3), ['-hide_banner', '-loglevel', 'error'])
  await spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: ['-i', 'x.mp4'], runChild, loglevel: 'info' })
  assert.deepEqual(seen.args.slice(0, 3), ['-hide_banner', '-loglevel', 'info'])
})

test('spawnFfmpeg throws video-ffmpeg-failed on non-zero exit', async () => {
  await assert.rejects(
    () => spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: [], runChild: mockRunChild({ code: 1, stdout: '', stderr: 'boom' }) }),
    (e) => e instanceof VideoError && e.code === 'video-ffmpeg-failed' && e.message.includes('boom'),
  )
})

test('spawnFfmpeg throws video-timeout when the child never finishes', async () => {
  const runChild = () => {
    const child = { kill() { resolve({ code: 137, stdout: '', stderr: 'killed' }) } }
    let resolve
    const done = new Promise((r) => { resolve = r })
    return { child, done }
  }
  await assert.rejects(
    () => spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: [], timeoutMs: 30, runChild }),
    (e) => e instanceof VideoError && e.code === 'video-timeout',
  )
})

test('spawnFfmpeg throws video-canceled on abort', async () => {
  const ac = new AbortController()
  const runChild = () => {
    const child = { kill() { resolve({ code: 143, stdout: '', stderr: '' }) } }
    let resolve
    const done = new Promise((r) => { resolve = r })
    return { child, done }
  }
  const pending = spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: [], signal: ac.signal, runChild })
  setTimeout(() => ac.abort(), 10)
  await assert.rejects(
    () => pending,
    (e) => e instanceof VideoError && e.code === 'video-canceled',
  )
})

test('spawnFfprobe returns stdout text on success', async () => {
  const runChild = () => ({ child: { kill() {} }, done: Promise.resolve({ code: 0, stdout: '{"ok":true}', stderr: '' }) })
  const text = await spawnFfprobe({ bin: { ffprobe: 'ffprobe' }, args: ['-of', 'json', 'x'], runChild })
  assert.equal(text, '{"ok":true}')
})

test('spawnFfprobe throws on non-zero', async () => {
  await assert.rejects(
    () => spawnFfprobe({ bin: { ffprobe: 'ffprobe' }, args: [], runChild: mockRunChild({ code: 2, stdout: '', stderr: 'bad' }) }),
    (e) => e instanceof VideoError && e.code === 'video-ffmpeg-failed',
  )
})

test('procs registry: children are added and removed', async () => {
  const procs = new Set()
  const runChild = () => {
    const child = { kill() {} }
    return { child, done: Promise.resolve({ code: 0, stdout: '', stderr: '' }) }
  }
  await spawnFfmpeg({ bin: { ffmpeg: 'ffmpeg' }, args: [], procs, runChild })
  assert.equal(procs.size, 0) // removed in finally
})

test('killAll kills every tracked child', () => {
  const procs = new Set()
  const killed = []
  procs.add({ kill: (sig) => killed.push(sig) })
  procs.add({ kill: (sig) => killed.push(sig) })
  killAll(procs)
  assert.deepEqual(killed, ['SIGKILL', 'SIGKILL'])
})