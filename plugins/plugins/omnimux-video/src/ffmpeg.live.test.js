import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBin, spawnFfmpeg, spawnFfprobe } from './engine/ffmpeg.js'
import { executeVideoProcess } from './engine/job.js'
import { createSemaphore } from './engine/queue.js'
import { VideoError } from './errors.js'

/**
 * Live smoke tests against a real ffmpeg. Skipped when
 * OMNIMUX_VIDEO_SKIP_FFMPEG=1 or when ffmpeg/ffprobe are not on PATH.
 */
const SKIP = process.env.OMNIMUX_VIDEO_SKIP_FFMPEG === '1'
const bin = resolveBin({})
const enabled = !SKIP && !bin.missing

let dir
const acquire = createSemaphore(1)
const videoConfig = { video: { ffmpegPath: '', maxConcurrent: 1 } }
const runFfmpeg = (args) => spawnFfmpeg({ bin, args, timeoutMs: 120_000 })
const runFprobe = (args) => spawnFfprobe({ bin, args, timeoutMs: 30_000 })

before(async () => {
  if (!enabled) return
  dir = await mkdtemp(join(tmpdir(), 'omnimux-video-live-'))
  // 1s color block with audio
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', join(dir, 'fixture.mp4'),
  ])
  // 1s color block WITHOUT audio
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', join(dir, 'noaudio.mp4'),
  ])
  // second same-encoded clip for merge
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1',
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', join(dir, 'fixture2.mp4'),
  ])
  // two still images
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=1', '-frames:v', '1', '-y', join(dir, 'img1.png')])
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1', '-frames:v', '1', '-y', join(dir, 'img2.png')])
})

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

const maybe = (name, fn) => {
  if (!enabled) {
    test(name, { skip: 'no ffmpeg (set OMNIMUX_VIDEO_SKIP_FFMPEG=1 to skip explicitly)' }, () => {})
    return
  }
  test(name, fn)
}

const exec = (capability, input, dest) => executeVideoProcess({
  capability, input, dest, bin, acquire, procs: new Set(), videoConfig,
})

maybe('smoke: media_metadata reads duration/width/height', async () => {
  const out = await exec('media_metadata', { mediaUrl: join(dir, 'fixture.mp4') }, undefined)
  assert.equal(out.mode, 'live')
  assert.ok(Math.abs(out.result.duration - 1) < 0.2, `duration ${out.result.duration}`)
  assert.equal(out.result.width, 320)
  assert.equal(out.result.height, 240)
})

maybe('smoke: video_trim 0-0.5s produces a file', async () => {
  const dest = join(dir, 'trim.mp4')
  const out = await exec('video_trim', { videoUrl: join(dir, 'fixture.mp4'), startSeconds: 0, durationSeconds: 0.5 }, dest)
  assert.equal(out.mode, 'live')
  await assert.doesNotReject(() => stat(dest))
  const meta = await exec('media_metadata', { mediaUrl: dest }, undefined)
  assert.ok(Math.abs(meta.result.duration - 0.5) < 0.15, `trimmed duration ${meta.result.duration}`)
})

maybe('smoke: video_split two segments in dest dir', async () => {
  const destDir = join(dir, 'split-dir')
  const out = await exec('video_split', {
    videoUrl: join(dir, 'fixture.mp4'),
    segments: [{ startSeconds: 0, durationSeconds: 0.4 }, { startSeconds: 0.4, endSeconds: 0.9 }],
  }, destDir)
  assert.equal(out.files.length, 2)
  assert.ok(out.files.every((f) => /segment-\d{3}\.mp4$/.test(f.path)))
  await assert.doesNotReject(() => stat(join(destDir, 'segment-001.mp4')))
  await assert.doesNotReject(() => stat(join(destDir, 'segment-002.mp4')))
})

maybe('smoke: audio_extract with audio track', async () => {
  const dest = join(dir, 'audio.mp3')
  const out = await exec('audio_extract', { videoUrl: join(dir, 'fixture.mp4'), outputFormat: 'mp3' }, dest)
  assert.equal(out.mode, 'live')
  assert.ok(!out.no_audio_stream)
  await assert.doesNotReject(() => stat(dest))
})

maybe('smoke: audio_extract on no-audio video → no_audio_stream true under result', async () => {
  const out = await exec('audio_extract', { videoUrl: join(dir, 'noaudio.mp4') }, join(dir, 'nope.mp3'))
  assert.equal(out.mode, 'live')
  assert.equal(out.result?.no_audio_stream, true)
  assert.equal(out.result?.duration, 0)
  assert.deepEqual(out.files, [])
})

maybe('smoke: video_scene_detect finds cuts and extracts frames', async () => {
  // Two high-contrast solid-color clips (red → white), concat into a 2s cut.
  // High contrast is required: ffmpeg's `scene` metric stays near-zero for
  // subtle hue flips (e.g. red→green), so we assert on a detectable jump.
  const red = join(dir, 'sc-red.mp4')
  const white = join(dir, 'sc-white.mp4')
  const sceneIn = join(dir, 'scene.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', red])
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', white])
  await runFfmpeg([
    '-i', red, '-i', white,
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[out]',
    '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', sceneIn,
  ])
  const destDir = join(dir, 'scene-dir')
  const out = await exec('video_scene_detect', { videoUrl: sceneIn }, destDir)
  assert.equal(out.mode, 'live')
  assert.ok(out.result?.count >= 1, `scene count should be >= 1, got ${out.result?.count}`)
  await assert.doesNotReject(() => stat(join(destDir, 'frame-001.jpg')))
})

maybe('smoke: video_merge two same-encoded clips', async () => {
  const dest = join(dir, 'merged.mp4')
  const out = await exec('video_merge', {
    videoUrls: [join(dir, 'fixture.mp4'), join(dir, 'fixture2.mp4')],
    keepAudio: true,
  }, dest)
  assert.equal(out.mode, 'live')
  await assert.doesNotReject(() => stat(dest))
  const meta = await exec('media_metadata', { mediaUrl: dest }, undefined)
  assert.ok(Math.abs(meta.result.duration - 2) < 0.3, `merged duration ${meta.result.duration}`)
})

maybe('smoke: slideshow_export two images', async () => {
  const dest = join(dir, 'slideshow.mp4')
  const out = await exec('slideshow_export', {
    imageUrls: [join(dir, 'img1.png'), join(dir, 'img2.png')],
    durationPerImage: 0.5,
    resolution: '720p',
    aspectRatio: '9:16',
    transitionType: 'none',
  }, dest)
  assert.equal(out.mode, 'live')
  await assert.doesNotReject(() => stat(dest))
  assert.equal(out.result.canvas, '720x1280')
})

maybe('smoke: video_export two clips, 720x1280 canvas', async () => {
  const dest = join(dir, 'export.mp4')
  const out = await exec('video_export', {
    clips: [
      { url: join(dir, 'fixture.mp4'), type: 'video', duration: 0.6 },
      { url: join(dir, 'fixture2.mp4'), type: 'video', duration: 0.6 },
    ],
    resolution: '720p',
    aspectRatio: '9:16',
    frameRate: 30,
  }, dest)
  assert.equal(out.mode, 'live')
  await assert.doesNotReject(() => stat(dest))
  const probe = await runFprobe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', dest])
  const info = JSON.parse(probe)
  const s = info.streams[0]
  assert.equal(s.width, 720)
  assert.equal(s.height, 1280)
  assert.ok(Math.abs(Number(s.duration) - 1.2) < 0.4, `export duration ${s.duration}`)
})

maybe('smoke: video_export burns subtitles (or reports missing libass)', async () => {
  const dest = join(dir, 'export-sub.mp4')
  const input = {
    clips: [
      { url: join(dir, 'fixture.mp4'), type: 'video', duration: 0.6 },
      { url: join(dir, 'fixture2.mp4'), type: 'video', duration: 0.6 },
    ],
    resolution: '720p',
    aspectRatio: '9:16',
    frameRate: 30,
    subtitles: { segments: [{ start: 0, duration: 0.6, text: 'hello world' }] },
  }
  const libass = await hasFilter('ass')
  try {
    const out = await exec('video_export', input, dest)
    assert.equal(out.mode, 'live')
    await assert.doesNotReject(() => stat(dest))
    const probe = await runFprobe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', dest])
    const s = JSON.parse(probe).streams[0]
    assert.equal(s.width, 720)
    assert.equal(s.height, 1280)
  } catch (error) {
    if (libass) throw error // should have worked
    // Documented environment limitation: no libass in this ffmpeg build.
    assert.equal(error.code, 'video-export-failed')
    assert.match(error.hint ?? '', /libass/)
  }
})

/** True when the current ffmpeg exposes the given filter. */
async function hasFilter(name) {
  try {
    const { stdout } = await runFfmpeg(['-filters'])
    return new RegExp(`\\s${name}\\s`).test(stdout)
  } catch {
    return false
  }
}

maybe('smoke: video_depth produces grayscale depth output with audio', async () => {
  const dest = join(dir, 'depth.mp4')
  const out = await executeVideoProcess({
    capability: 'video_depth',
    input: {
      videoUrl: join(dir, 'fixture.mp4'),
      maxEdge: 308,
      keepAudio: true,
      durationSeconds: 0.5,
      provider: 'cpu',
    },
    dest,
    bin,
    acquire,
    procs: new Set(),
    videoConfig: { video: { ffmpegPath: '', maxConcurrent: 1, pythonPath: '', modelsDir: '' } },
  })
  assert.equal(out.mode, 'live')
  assert.equal(out.files[0].path, dest)
  const st = await stat(dest)
  assert.ok(st.size > 1000)
  const probeStdout = await runFprobe([
    '-show_entries', 'stream=codec_type,width,height',
    '-of', 'json',
    dest,
  ])
  const info = JSON.parse(probeStdout || '{}')
  const hasVideo = (info.streams || []).some((s) => s.codec_type === 'video')
  const hasAudio = (info.streams || []).some((s) => s.codec_type === 'audio')
  assert.equal(hasVideo, true)
  assert.equal(hasAudio, true)
})

maybe('smoke: bogus ffmpegPath → ffmpeg-missing', async () => {
  const missing = resolveBin({ ffmpegPath: '/nonexistent/ffmpeg-xyz' })
  assert.equal(missing.missing, true)
  await assert.rejects(
    () => executeVideoProcess({
      capability: 'video_trim',
      input: { videoUrl: join(dir, 'fixture.mp4') },
      dest: join(dir, 'never.mp4'),
      bin: missing,
      acquire: async (fn) => fn(),
      procs: new Set(),
      videoConfig,
    }),
    (e) => e instanceof VideoError && e.code === 'ffmpeg-missing',
  )
})