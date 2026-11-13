import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VideoError } from '../errors.js'
import { executeVideoProcess } from './job.js'
import { materializeInput } from './job.js'
import { createSemaphore } from './queue.js'

let dir
let fakeFfmpeg
let fakeFfprobe

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'omnimux-video-job-'))
  fakeFfmpeg = join(dir, 'ffmpeg')
  fakeFfprobe = join(dir, 'ffprobe')
  await writeFile(fakeFfmpeg, `#!/bin/sh
echo "ffmpeg $*" >> "\${FAKE_FFMPEG_LOG:-/dev/null}"
if [ "\${FAKE_FFMPEG_FAIL_ALL:-0}" = "1" ]; then
  echo "fake ffmpeg fail" >&2
  exit 1
fi
if [ "\${FAKE_FFMPEG_FAIL_FIRST:-0}" = "1" ] && [ ! -f "\${FAKE_FFMPEG_MARKER:-/dev/null}" ]; then
  touch "\${FAKE_FFMPEG_MARKER}"
  echo "fake ffmpeg fail-first" >&2
  exit 1
fi
for last; do :; done
touch "$last"
exit 0
`)
  await writeFile(fakeFfprobe, `#!/bin/sh
echo "ffprobe $*" >> "\${FAKE_FFPROBE_LOG:-/dev/null}"
cat <<'EOF'
{"streams":[{"codec_name":"h264","width":320,"height":240,"pix_fmt":"yuv420p"}],"format":{"duration":"1.0","size":"1234","bit_rate":"500000"}}
EOF
exit 0
`)
  await chmod(fakeFfmpeg, 0o755)
  await chmod(fakeFfprobe, 0o755)
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

const bin = () => ({ ffmpeg: fakeFfmpeg, ffprobe: fakeFfprobe, version: '8.1.2', missing: false })
const acquire = createSemaphore(2)
const videoConfig = { video: { ffmpegPath: '', maxConcurrent: 2 } }

test('executeVideoProcess: bin.missing throws ffmpeg-missing without spawning', async () => {
  const procs = new Set()
  await assert.rejects(
    () => executeVideoProcess({
      capability: 'video_trim',
      input: { videoUrl: '/a.mp4' },
      dest: join(dir, 'o.mp4'),
      bin: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', version: null, missing: true },
      acquire: async (fn) => fn(),
      procs,
      videoConfig,
    }),
    (e) => e instanceof VideoError && e.code === 'ffmpeg-missing' && /brew install ffmpeg/.test(e.message),
  )
})

test('executeVideoProcess: unknown capability lists the 11 slugs', async () => {
  await assert.rejects(
    () => executeVideoProcess({
      capability: 'nope',
      input: {},
      dest: join(dir, 'o.mp4'),
      bin: bin(),
      acquire: async (fn) => fn(),
      procs: new Set(),
      videoConfig,
    }),
    (e) => e instanceof VideoError && e.code === 'unknown-capability' && e.message.includes('video_trim') && e.message.includes('video_export'),
  )
})

test('executeVideoProcess: trim happy path writes dest and returns files', async () => {
  const log = join(dir, 'log-ffmpeg.txt')
  const out = join(dir, 'trim-out.mp4')
  const procs = new Set()
  const prev = process.env.FAKE_FFMPEG_LOG
  try {
    process.env.FAKE_FFMPEG_LOG = log
    const result = await executeVideoProcess({
      capability: 'video_trim',
      input: { videoUrl: '/a.mp4', durationSeconds: 1 },
      dest: out,
      bin: bin(),
      acquire,
      procs,
      videoConfig,
    })
    assert.equal(result.mode, 'live')
    assert.equal(result.files[0].path, out)
    const logText = await readFile(log, 'utf8')
    assert.match(logText, /-hide_banner -loglevel error -y/)
    assert.match(logText, /-c copy/)
  } finally {
    process.env.FAKE_FFMPEG_LOG = prev
  }
})

test('executeVideoProcess: trim falls back from copy to reencode', async () => {
  const marker = join(dir, 'marker.txt')
  const log = join(dir, 'log-fallback.txt')
  const out = join(dir, 'trim-fallback.mp4')
  const prev = { failFirst: process.env.FAKE_FFMPEG_FAIL_FIRST, marker: process.env.FAKE_FFMPEG_MARKER, log: process.env.FAKE_FFMPEG_LOG }
  try {
    process.env.FAKE_FFMPEG_FAIL_FIRST = '1'
    process.env.FAKE_FFMPEG_MARKER = marker
    process.env.FAKE_FFMPEG_LOG = log
    const result = await executeVideoProcess({
      capability: 'video_trim',
      input: { videoUrl: '/a.mp4', durationSeconds: 1 },
      dest: out,
      bin: bin(),
      acquire,
      procs: new Set(),
      videoConfig,
    })
    assert.equal(result.mode, 'live')
    const logText = await readFile(log, 'utf8')
    assert.match(logText, /-c copy/)
    assert.match(logText, /libx264/)
  } finally {
    process.env.FAKE_FFMPEG_FAIL_FIRST = prev.failFirst
    process.env.FAKE_FFMPEG_MARKER = prev.marker
    process.env.FAKE_FFMPEG_LOG = prev.log
  }
})

test('executeVideoProcess: failure cleans up the partial dest file', async () => {
  const log = join(dir, 'log-fail.txt')
  const out = join(dir, 'trim-fail.mp4')
  const prev = process.env.FAKE_FFMPEG_FAIL_ALL
  try {
    process.env.FAKE_FFMPEG_FAIL_ALL = '1'
    process.env.FAKE_FFMPEG_LOG = log
    await assert.rejects(
      () => executeVideoProcess({
        capability: 'video_trim',
        input: { videoUrl: '/a.mp4', durationSeconds: 1 },
        dest: out,
        bin: bin(),
        acquire,
        procs: new Set(),
        videoConfig,
      }),
      (e) => e instanceof VideoError && e.code === 'video-ffmpeg-failed',
    )
  } finally {
    process.env.FAKE_FFMPEG_FAIL_ALL = prev
  }
  await assert.rejects(() => import('node:fs/promises').then((fs) => fs.stat(out)), /ENOENT/)
})

test('executeVideoProcess: media_metadata needs no dest and returns result', async () => {
  const result = await executeVideoProcess({
    capability: 'media_metadata',
    input: { mediaUrl: '/a.mp4' },
    dest: undefined,
    bin: bin(),
    acquire,
    procs: new Set(),
    videoConfig,
  })
  assert.equal(result.mode, 'live')
  assert.equal(result.result.width, 320)
  assert.equal(result.result.duration, 1)
})

test('executeVideoProcess: invalid input throws video-invalid-input before spawn', async () => {
  await assert.rejects(
    () => executeVideoProcess({
      capability: 'video_trim',
      input: {},
      dest: join(dir, 'o.mp4'),
      bin: bin(),
      acquire: async (fn) => fn(),
      procs: new Set(),
      videoConfig,
    }),
    (e) => e instanceof VideoError && e.code === 'video-invalid-input',
  )
})

test('materializeInput: local paths pass through untouched', async () => {
  const p = await materializeInput('/a/b.mp4', dir, 'x')
  assert.equal(p, '/a/b.mp4')
})