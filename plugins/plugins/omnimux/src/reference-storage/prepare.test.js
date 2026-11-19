import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareReferencePayload, verifyRemoteReference } from './prepare.js'

function deps() {
  const calls = []
  const credentials = { async resolve(ref) { return { value: ref.endsWith('_SECRET') ? 'synthetic-secret' : 'synthetic-access' } } }
  const settings = { enabled: true, endpoint: 'https://storage.example.test', bucket: 'reference-media', region: 'auto', publicBaseUrl: 'https://media.example.test', credentialId: '0123456789abcdef0123456789abcdef' }
  async function upload(source, options) { calls.push({ source, options }); return 'https://media.example.test/reference.png' }
  return { calls, credentials, config: settings, upload }
}
test('all supported reference fields share preparation and preserve roles and unrelated text', async () => {
  const d = deps()
  const input = { prompt: '/private/prompt-not-a-file', image: '/tmp/ref.png', images: ['/tmp/ref.png'], references: [{ type: 'image', role: 'style', pathOrUrl: '/tmp/ref.png' }], audioTrack: { type: 'audio', pathOrUrl: '/tmp/audio.wav' }, video_urls: ['/tmp/ref.mp4'] }
  const result = await prepareReferencePayload(input, d)
  assert.equal(d.calls.length, 3)
  assert.equal(result.image, 'https://media.example.test/reference.png')
  assert.equal(result.references.at(0).pathOrUrl, result.image)
  assert.equal(result.references.at(0).role, 'style')
  assert.equal(result.prompt, input.prompt)
  assert.equal(input.image, '/tmp/ref.png')
})
test('disabled settings do not resolve credentials or upload; pure text needs no cloud access', async () => {
  const d = deps()
  d.config.enabled = false
  d.credentials.resolve = async () => { throw Error('must not resolve') }
  assert.deepEqual(await prepareReferencePayload({ image: '/tmp/ref.png' }, d), { image: '/tmp/ref.png' })
  d.config.enabled = true
  assert.deepEqual(await prepareReferencePayload({ prompt: 'no references' }, d), { prompt: 'no references' })
})
test('upload failure propagates without old cloud fallback or partial payload return', async () => {
  const d = deps()
  d.upload = async () => { throw Error('upload refused') }
  await assert.rejects(prepareReferencePayload({ image: '/tmp/ref.png' }, d), /upload refused/)
})
test('remote video and audio declarations cannot disguise ordinary text', async () => {
  for (const mime of ['video/mp4', 'audio/mpeg']) await assert.rejects(verifyRemoteReference('https://existing.example.test/ref', { request: async () => new Response('ordinary text', { headers: { 'content-type': mime } }) }))
})

test('typed image reference rejects an audio response instead of preserving false image identity', async () => {
  const d = deps()
  const wav = Buffer.alloc(46)
  wav.write('RIFF', 0); wav.write('WAVE', 8)
  d.request = async () => new Response(wav, { headers: { 'content-type': 'audio/wav' } })
  await assert.rejects(prepareReferencePayload({ references: [{ type: 'image', pathOrUrl: 'https://existing.example.test/changed.png' }] }, d))
})

test('same media type with changed bytes cannot replace the admitted reference', async () => {
  const d = deps()
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4o6EBAAMQAS0ujiXaAAAAAElFTkSuQmCC', 'base64')
  const changed = Buffer.from(original)
  changed.writeUInt8(1, changed.length - 1)
  const url = 'https://existing.example.test/changed.png'
  d.expectedAssets = [{ type: 'image', pathOrUrl: url, mime: 'image/png', sizeBytes: original.length, contentDigest: createHash('sha256').update(original).digest('hex') }]
  d.request = async () => new Response(changed, { headers: { 'content-type': 'image/png' } })
  await assert.rejects(prepareReferencePayload({ image: url }, d), /发生变化/)
  d.request = async () => new Response(original, { headers: { 'content-type': 'image/png' } })
  assert.equal((await prepareReferencePayload({ image: url }, d)).image, url)
})

test('conflicting admitted identities for one source fail before preparation', async () => {
  const d = deps()
  const url = 'https://existing.example.test/conflict.png'
  d.expectedAssets = [{ pathOrUrl: url, type: 'image', mime: 'image/png', sizeBytes: 10, contentDigest: 'first' }, { pathOrUrl: url, type: 'image', mime: 'image/png', sizeBytes: 10, contentDigest: 'second' }]
  d.verifyRemote = async () => { throw Error('must not fetch conflicting source') }
  await assert.rejects(prepareReferencePayload({ image: url }, d), /身份不一致/)
})

test('public document references keep existing document admission and are not routed into media storage', async () => {
  const d = deps()
  const url = 'https://existing.example.test/reference.pdf'
  d.expectedAssets = [{ pathOrUrl: url, type: 'document', mime: 'application/pdf', sizeBytes: 24 }]
  d.request = async () => { throw Error('document must not use media upload') }
  assert.equal((await prepareReferencePayload({ file_url: url }, d)).file_url, url)
  assert.equal(d.calls.length, 0)
})

test('mapped metadata audio is prepared without changing unrelated metadata', async () => {
  const d = deps()
  const result = await prepareReferencePayload({ metadata: { audio: '/tmp/audio.wav', speech: 'retain words' } }, d)
  assert.equal(d.calls.length, 1)
  assert.equal(result.metadata.audio, 'https://media.example.test/reference.png')
  assert.equal(result.metadata.speech, 'retain words')
})

test('official H3 prepares numbered image and audio slots and frames only once per source', async () => {
  const d = deps()
  const image = '/tmp/face.png'
  const audio = '/tmp/voice.wav'
  const remote = 'https://existing.example.test/last.png'
  const imageAsset = { type: 'image', pathOrUrl: image, contentDigest: 'fixture-image' }
  const audioAsset = { type: 'audio', pathOrUrl: audio, contentDigest: 'fixture-audio' }
  const remoteAsset = { type: 'image', pathOrUrl: remote, contentDigest: 'fixture-remote' }
  d.expectedAssets = [imageAsset, audioAsset, remoteAsset]
  const checks = []
  d.verifyRemote = async (url, options) => { checks.push([url, options.expectedType, options.expectedAsset]) }
  d.upload = async (source, options) => {
    d.calls.push([source, options.expectedAsset])
    return `https://media.example.test/${source.split('/').at(-1)}`
  }
  const metadata = {
    ref_image_0: image, ref_image_10: remote, first_frame: image, last_frame: remote,
    ref_audio_0: audio, audio_duration: 5, ref_audio_0_extra: '/tmp/unknown.wav',
    nested: { ref_image_0: '/tmp/ignored.png' },
  }
  const input = { audio_urls: [audio], metadata }
  assert.deepEqual((await prepareReferencePayload({ metadata }, d)).metadata, metadata)
  assert.deepEqual(d.calls, [])
  assert.deepEqual(checks, [])

  const result = await prepareReferencePayload(input, { ...d, hostH3Metadata: true })
  assert.deepEqual(d.calls, [[audio, audioAsset], [image, imageAsset]])
  assert.deepEqual(checks, [[remote, 'image', remoteAsset]])
  assert.deepEqual(result.metadata, {
    ...metadata, ref_image_0: 'https://media.example.test/face.png', first_frame: 'https://media.example.test/face.png',
    ref_audio_0: 'https://media.example.test/voice.wav',
  })
  assert.deepEqual(result.audio_urls, [result.metadata.ref_audio_0])
  assert.equal(input.metadata.ref_audio_0, audio)
})

test('existing public media is verified but never copied into user storage', async () => {
  const d = deps()
  let checks = 0
  d.verifyRemote = async url => { assert.equal(url, 'https://existing.example.test/ref.png'); checks++ }
  const result = await prepareReferencePayload({ image: 'https://existing.example.test/ref.png' }, d)
  assert.equal(result.image, 'https://existing.example.test/ref.png')
  assert.equal(d.calls.length, 0)
  assert.equal(checks, 1)
})
