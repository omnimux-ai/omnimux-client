import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { executeOmnimuxVideo } from './video.js'
import { mapOmnimuxInput } from './vendors/omnimux.js'

const MODEL = 'minimax-h3-video'
const BASE = 'https://gateway.example.test/v1'
const IMAGE = 'https://assets.example.test/portrait.png'
const TAIL = 'https://assets.example.test/tail.png'
const AUDIO = 'https://assets.example.test/driver.wav'
const VIDEO = 'https://assets.example.test/result.mp4'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const WAV = Buffer.concat([
  // 5 seconds of mono PCM at 8 kHz. The Hub probes the input bytes.
  Buffer.from('524946462438010057415645666d74201000000001000100401f0000803e0000020010006461746100380100', 'hex'),
  Buffer.alloc(80_000),
])
const VIDEO_BYTES = Buffer.from('mock MP4 content')
const CATALOG_SLOTS = [
  { type: 'image', role: 'reference', targetSlot: 'reference_image', pathOrUrl: IMAGE },
  { type: 'audio', role: 'reference', targetSlot: 'reference_audio', pathOrUrl: AUDIO },
]
const LEGACY_SLOTS = [
  { type: 'image', role: 'first_frame', targetSlot: 'character', pathOrUrl: IMAGE },
  { type: 'audio', role: 'audio_track', targetSlot: 'driving_audio', pathOrUrl: AUDIO },
]

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'omnimux-h3-video-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const calls = []
  const fetcher = async (url, init = {}) => {
    const address = String(url)
    const method = init.method ?? 'GET'
    const group = new Headers(init.headers).get('X-Omnimux-Group')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ address, method, group, body })
    if (address === IMAGE || address === TAIL) return new Response(PNG, { headers: { 'content-type': 'image/png' } })
    if (address === AUDIO) return new Response(WAV, { headers: { 'content-type': 'audio/wav' } })
    if (address === VIDEO) return new Response(VIDEO_BYTES, { headers: { 'content-type': 'video/mp4' } })
    if (address === BASE + '/tasks/autodl' && method === 'POST') {
      return Response.json({ task_id: 'task-h3-' + directory.split('-').at(-1) })
    }
    if (address.startsWith(BASE + '/tasks/') && method === 'GET') {
      return address.endsWith('/artifacts')
        ? Response.json({ artifacts: [{ url: VIDEO }] })
        : Response.json({ status: 'completed' })
    }
    assert.fail('Unexpected network request: ' + method + ' ' + address)
  }
  const dest = join(directory, 'video.mp4')
  const execute = (overrides = {}) => executeOmnimuxVideo({
    model: MODEL,
    operation: 'digital_human',
    prompt: '',
    references: CATALOG_SLOTS,
    duration: 5,
    dest,
    wait: false,
    env: { OMNIMUX_API_KEY: 'sk-test', OMNIMUX_BASE_URL: BASE },
    fetcher,
    ...overrides,
  })
  return { calls, dest, execute, submissions: () => calls.filter(call => call.method === 'POST') }
}

const expectedLipSync = {
  model: MODEL,
  operation: 'digital_human',
  duration: 5,
  resolution: '768p',
  aspect_ratio: '16:9',
  metadata: { ref_image_0: IMAGE, ref_audio_0: AUDIO, audio_duration: 5 },
  audio_urls: [AUDIO],
}

for (const group of [null, 'default', 'minimax-h3-video-fast', 'minimax-h3-video-pro']) {
  test('H3 submits lip-sync with both media slots on ' + (group ?? 'automatic routing'), async (t) => {
    const { execute, submissions } = fixture(t)
    const result = await execute(group ? {
      allowedGroups: [group],
      prompt: 'stale node text must not affect the gateway workflow',
      references: LEGACY_SLOTS,
    } : {})
    assert.equal(result.mode, 'submitted')
    assert.match(result.taskId, /^task-h3-/)
    assert.deepEqual(submissions(), [{
      address: BASE + '/tasks/autodl',
      method: 'POST',
      group,
      body: expectedLipSync,
    }])
  })
}

test('H3 can infer lip-sync from the original saved slot IDs', async (t) => {
  const { execute, submissions } = fixture(t)
  await execute({ operation: undefined, references: LEGACY_SLOTS })
  assert.deepEqual(submissions().map(({ body }) => body), [expectedLipSync])
})

test('H3 rejects missing driving audio before submitting', async (t) => {
  const { execute, submissions } = fixture(t)
  await assert.rejects(execute({ references: [CATALOG_SLOTS[0]] }), (error) => {
    assert.equal(error.details?.guardCode, 'min_unsatisfied')
    return true
  })
  assert.equal(submissions().length, 0)
})

test('H3 retains text, frame-order and multi-reference audio in the other operations', async (t) => {
  const { execute, submissions } = fixture(t)
  await assert.rejects(execute({ operation: 'text_to_video', references: [] }), (error) => {
    assert.equal(error.details?.guardCode, 'prompt_required')
    return true
  })
  assert.equal(submissions().length, 0)
  await execute({ operation: 'text_to_video', prompt: 'text video', references: [] })
  await execute({
    operation: 'first_last_frame',
    prompt: 'frame transition',
    references: [
      { type: 'image', role: 'first_frame', targetSlot: 'first_frame', pathOrUrl: IMAGE },
      { type: 'image', role: 'last_frame', targetSlot: 'last_frame', pathOrUrl: TAIL },
    ],
  })
  await execute({
    operation: 'video_multi_ref',
    prompt: 'combine references',
    references: [
      { ...CATALOG_SLOTS[0], targetSlot: 'reference_images' },
      { ...CATALOG_SLOTS[1], targetSlot: 'reference_audios' },
    ],
  })
  const [text, frames, multiple] = submissions().map(({ body }) => body)
  assert.equal(text.prompt, 'text video')
  assert.equal(text.metadata, undefined)
  assert.equal(frames.prompt, 'frame transition')
  assert.equal(frames.metadata.first_frame, IMAGE)
  assert.equal(frames.metadata.last_frame, TAIL)
  assert.equal(multiple.prompt, 'combine references')
  assert.deepEqual(multiple.metadata, { ref_image_0: IMAGE, ref_audio_0: AUDIO })
  assert.equal(multiple.audio_urls, undefined)
})

test('H3 collects an existing task ID without submitting again', async (t) => {
  const { calls, dest, execute, submissions } = fixture(t)
  const taskId = 'task-id-from-another-install-87'
  const result = await execute({ taskId })
  assert.equal(result.mode, 'live')
  assert.equal(result.taskId, taskId)
  assert.ok(readFileSync(dest).equals(VIDEO_BYTES))
  assert.equal(submissions().length, 0)
  assert.deepEqual(calls.map(call => call.address), [
    BASE + '/tasks/' + taskId,
    BASE + '/tasks/' + taskId + '/artifacts',
    VIDEO,
  ])
})

test('H3 keeps the driving audio in legacy mapping while BYOK uses its existing fields', () => {
  const request = {
    model: MODEL,
    operation: 'digital_human',
    prompt: 'old prompt',
    image: IMAGE,
    audioTrack: { type: 'audio', role: 'audio_track', pathOrUrl: AUDIO },
    duration: 5,
  }
  assert.deepEqual(mapOmnimuxInput('video', { ...request, references: LEGACY_SLOTS }), {
    operation: 'digital_human',
    duration: 5,
    metadata: expectedLipSync.metadata,
    audio_urls: [AUDIO],
  })
  assert.throws(() => mapOmnimuxInput('video', { ...request, audioTrack: undefined }), { code: 'omnimux-invalid-request' })
  assert.deepEqual(mapOmnimuxInput('video', { ...request, guardPlan: { byok: true } }), {
    prompt: request.prompt,
    duration: 5,
    image: IMAGE,
    audioTrack: request.audioTrack,
  })
})
