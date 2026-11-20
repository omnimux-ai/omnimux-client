import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setCurrentSnapshotResolver } from './cloud/current.js'
import { normalizePricingPayload } from './cloud/snapshot.js'
import { guardSubmit } from './contract/submit-guard/index.js'
import { buildModelCatalog } from './list.js'
import { getRuntimeContractIndex } from './runtime-index.js'
import { executeOmnimuxVideo } from '../media/video.js'

// Additional consumer edge cases use an ID absent from local model registries.
const MODEL = 'atlas-fixture-71'
const KEY = 'sk-fixture-only'
const GATEWAY_BASE = 'https://gateway.example.test/v1'
const FIRST_FRAME = 'https://media.example.test/frame.png'
const VIDEO = 'https://media.example.test/result.mp4'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function operation(id, modeKind, inputs, parameters = []) {
  return {
    id, modeKind, executable: true,
    inputs: [{ type: 'text', slot: 'prompt', required: true }, ...inputs],
    parameters, output: { type: 'video', formats: ['mp4'] },
  }
}

const frame = { type: 'image', slot: 'first_frame', role: 'first_frame', required: true, min: 1, max: 1, allowedMimes: ['image/png'] }
const ref = (max) => ({ type: 'image', slot: 'reference_images', role: 'reference', required: true, min: 1, max })
const variant = (duration, aspectRatio, resolution) => [
  { name: 'duration', type: 'integer', fixed: duration },
  { name: 'aspect_ratio', type: 'enum', enum: [aspectRatio], default: aspectRatio },
  ...(resolution ? [{ name: 'resolution', type: 'enum', enum: [resolution] }] : []),
]

function groupedResponse() {
  const firstFrame = operation('first_frame', 'first_frame', [frame], variant(10, 'adaptive'))
  const multi = (max) => operation('video_multi_ref', 'image_reference', [ref(max)], variant(5, '16:9'))
  const nativeFrame = (duration, resolution) => ({
    ...operation('first_frame', 'first_frame', [frame], variant(duration, 'adaptive', resolution)),
    gateway_protocol: 'video_generations',
  })
  return {
    data: [{
      model_name: MODEL, display_name: 'Synthetic Atlas',
      billing_mode: 'per_task', model_price: 0.2,
      enable_groups: ['budget', 'premium', 'forbidden', 'empty', 'unknown', 'auto'],
      contract: {
        family: 'video', schemaVersion: '2.0', contractVersion: 'fixture-contract-v2',
        gateway_protocol: 'openai_video', operations: [firstFrame, multi(6)],
      },
      effective_video: {
        version: 'fixture-effective-v1',
        groups: {
          budget: [nativeFrame(10, '1080p'), nativeFrame(5, '720p'), { ...multi(2), gateway_protocol: 'video_generations' }],
          premium: [firstFrame, multi(6)],
          forbidden: [firstFrame],
          empty: [],
          unknown: [{ ...firstFrame, gateway_protocol: 'future-video' }],
          auto: [firstFrame],
        },
      },
    }],
    usable_group: { budget: 'Budget', premium: 'Premium', empty: 'Empty', unknown: 'Unknown', auto: 'Automatic' },
    group_ratio: { budget: 0.5, premium: 2, forbidden: 1, empty: 1, unknown: 1, auto: 1 },
  }
}

function snapshotOf(payload = groupedResponse()) {
  return normalizePricingPayload(payload).snapshot
}

function validate(snapshot, request) {
  return guardSubmit({
    model: MODEL, group: 'premium', operation: 'first_frame', prompt: 'fixture',
    assets: [{ type: 'image', role: 'first_frame', mime: 'image/png', pathOrUrl: FIRST_FRAME }],
    ...request,
  }, {
    index: getRuntimeContractIndex({ snapshot }).index,
    snapshot,
    seam: 'videoGenerate',
    outputType: 'video',
  })
}

// Exact HTTP fixture bytes produced by gateway PR #76. See the testdata README.
async function readProducerFixture(file, hash, model, effectiveVersion) {
  const bytes = await readFile(new URL(`./testdata/gateway-grouped-video/${file}`, import.meta.url))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
  const response = JSON.parse(bytes)
  const pricing = response['/api/pricing']
  const row = pricing.data.find((entry) => entry.model_name === model)
  assert.deepEqual(row.effective_video, response[`/api/model_contract/${model}`].data.effective_video)
  assert.equal(row.effective_video.version, effectiveVersion)
  return snapshotOf(pricing)
}

const MODEL_NATIVE = 'example-group-video'
const MODEL_MIXED = 'example-mixed-video'
const sameProtocolSnapshot = () => readProducerFixture('catalog.json',
  '47e93b12896a9e5b38f0fef000a9436ddd495978b01f9a33f652ce42f4b6237a', MODEL_NATIVE, 'e086f5bb6394f409')
const mixedProtocolSnapshot = () => readProducerFixture('mixed-catalog.json',
  '705177ba7ec0cb0cdd220eae99fdabbcfbfe49d1f884684acdb75b49ee7e9d2a', MODEL_MIXED, '58cff3fa201d19bf')

test('the gateway-generated examples retain whole group variants and required parameters without defaults', async () => {
  for (const [model, snapshot] of [[MODEL_NATIVE, await sameProtocolSnapshot()], [MODEL_MIXED, await mixedProtocolSnapshot()]]) {
    const item = buildModelCatalog({ snapshot, env: {} }).video.find((row) => row.id === model)
    assert.equal(item.selectable, true)
    assert.deepEqual(item.channelGroups.map((group) => group.id), ['default', 'narrow'])
    const request = { model, group: 'default', operation: 'first_frame' }
    assert.match(validate(snapshot, request).message, /请设置参数「duration」/)
    assert.match(validate(snapshot, { ...request, duration: 7 }).message, /duration.*outside/)
    assert.equal(validate(snapshot, { ...request, group: 'fixture-hidden', duration: 5 }).ok, false)
    const accepted = validate(snapshot, { ...request, duration: 5 })
    assert.equal(accepted.ok, true, accepted.message)
    assert.equal(accepted.operation.gatewayProtocol, 'video_generations')
    assert.deepEqual(accepted.vendorPayload, {
      prompt: 'fixture', operation: 'first_frame', duration: 5, size: 'adaptive', output_format: 'mp4',
      image_with_roles: [{ url: FIRST_FRAME, role: 'first_frame' }],
    })
  }

  const snapshot = await sameProtocolSnapshot()
  const assets = [1, 2, 3].map((number) => ({
    type: 'image', role: 'reference', mime: 'image/png', pathOrUrl: `https://media.example.test/ref-${number}.png`,
  }))
  const request = { model: MODEL_NATIVE, group: 'default', operation: 'video_multi_ref', duration: 5, assets }
  const accepted = validate(snapshot, { ...request, resolution: '480p' })
  assert.equal(accepted.ok, true, accepted.message)
  assert.equal(validate(snapshot, { ...request, resolution: '720p' }).ok, false)
  assert.equal(validate(snapshot, { ...request, group: 'narrow', resolution: '480p' }).ok, false)
})

test('gateway-only id projects only authorized and supported groups with complete variants', () => {
  const catalog = buildModelCatalog({ snapshot: snapshotOf(), env: {} })
  for (const rows of [catalog.models, catalog.video]) {
    const model = rows.find((entry) => entry.id === MODEL)
    assert.equal(model.selectable, true)
    assert.equal(model.effectiveVideoVersion, 'fixture-effective-v1')
    assert.deepEqual(model.channelGroups.map((group) => [group.id, group.label, group.pricing.groupRatio]), [
      ['budget', 'Budget', 0.5], ['premium', 'Premium', 2],
    ])
    const [budget, premium] = model.channelGroups
    assert.deepEqual(budget.effectiveOperations.filter((op) => op.id === 'first_frame').map((op) => [
      op.parameters.duration.defaultValue, op.parameters.resolution.defaultValue,
    ]), [[10, '1080p'], [5, '720p']])
    assert.equal(premium.effectiveOperations[0].gatewayProtocol, 'openai_video')
    assert.equal(budget.effectiveOperations[0].gatewayProtocol, 'video_generations')
    assert.deepEqual([budget, premium].map((group) => group.effectiveOperations
      .find((op) => op.id === 'video_multi_ref').inputs.find((input) => input.role === 'reference').max), [2, 6])
  }
})

test('the guard selects one whole variant and rejects omissions, empty groups, and cross-group fallbacks', () => {
  const snapshot = snapshotOf()
  const openai = validate(snapshot, { duration: 10, aspectRatio: 'adaptive' })
  assert.equal(openai.ok, true, openai.message)
  assert.deepEqual(openai.vendorPayload, { prompt: 'fixture', operation: 'first_frame', image: FIRST_FRAME, duration: 10, aspect_ratio: 'adaptive' })
  const native = validate(snapshot, { group: 'budget', duration: 5, resolution: '720p' })
  assert.equal(native.ok, true, native.message)
  assert.deepEqual(native.vendorPayload.image_with_roles, [{ url: FIRST_FRAME, role: 'first_frame' }])
  assert.equal(native.vendorPayload.image, undefined)
  assert.equal(validate(snapshot, { group: 'budget', duration: 5, resolution: '1080p' }).ok, false)
  assert.equal(validate(snapshot, { group: 'premium', resolution: '1080p' }).ok, false)
  for (const group of ['', 'auto', 'forbidden', 'unknown', 'empty']) {
    assert.equal(validate(snapshot, { group }).ok, false, group)
  }
  assert.equal(validate(snapshot, { operation: '' }).ok, false)
  const references = Array.from({ length: 3 }, (_, id) => ({
    type: 'image', role: 'reference', pathOrUrl: `https://media.example.test/${id}.png`,
  }))
  const multi = validate(snapshot, { operation: 'video_multi_ref', assets: references })
  assert.equal(multi.ok, true, multi.message)
  assert.deepEqual(multi.vendorPayload.images, references.map((image) => image.pathOrUrl))
  assert.equal(multi.vendorPayload.image, undefined)
  assert.equal(multi.vendorPayload.image_urls, undefined)
  assert.equal(validate(snapshot, { operation: 'video_multi_ref', assets: references, group: 'budget' }).ok, false)
})

test('no grouped publication preserves legacy; malformed or withdrawn groups do not restore model rules', () => {
  const payload = groupedResponse()
  const [row] = payload.data
  for (const declaration of [{ version: 'empty-version', groups: {} }, null]) {
    row.effective_video = declaration
    const snapshot = snapshotOf(payload)
    const model = buildModelCatalog({ snapshot, env: {} }).models.find((entry) => entry.id === MODEL)
    assert.equal(model.selectable, false)
    assert.deepEqual(model.channelGroups, [])
    assert.equal(validate(snapshot, {}).ok, false)
  }
  delete row.effective_video
  const snapshot = snapshotOf(payload)
  const model = buildModelCatalog({ snapshot, env: {} }).models.find((entry) => entry.id === MODEL)
  assert.equal(model.selectable, true)
  assert.equal(model.effectiveVideoVersion, undefined)
  assert.equal(validate(snapshot, {}).ok, true)
})

test('a new model starts and recovers on the recorded protocol and selected group after permission changes', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'gateway-video-group-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let snapshot = snapshotOf()
  let accountViewKey = 'synthetic-account-a'
  let switchAccountOnKeyCheck = true
  let changePriceOnKeyCheck = false
  setCurrentSnapshotResolver(() => ({
    snapshot, accountViewKey,
    async resolveGenerationKey({ apiKey, baseUrl }) {
      assert.ok(apiKey === undefined || apiKey === KEY)
      assert.equal(baseUrl, GATEWAY_BASE)
      if (switchAccountOnKeyCheck) accountViewKey = 'synthetic-account-b'
      if (changePriceOnKeyCheck) {
        const changed = groupedResponse()
        changed.group_ratio.premium = 3
        snapshot = snapshotOf(changed)
      }
      return KEY
    },
  }))
  t.after(async () => {
    setCurrentSnapshotResolver(null)
    if (previousHome !== undefined) process.env.DSH_HOME = previousHome
    else delete process.env.DSH_HOME
    await rm(home, { recursive: true, force: true })
  })
  const requests = []
  const videoBytes = Buffer.from('00000018667479706D703432000000006D70343269736F6D', 'hex')
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    if (url === FIRST_FRAME) return new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } })
    const headers = new Headers(init.headers)
    const group = headers.get('X-Omnimux-Group')
    const protocol = headers.get('X-OmniMux-Video-Protocol')
    requests.push({ url, method, group, ...(protocol && { protocol }), ...(init.body ? { body: JSON.parse(init.body) } : {}) })
    if (method === 'POST' && url === `${GATEWAY_BASE}/videos`) return Response.json({ task_id: 'synthetic-video-task', status: 'submitted' })
    if (method === 'POST' && url === `${GATEWAY_BASE}/video/generations`) return Response.json({ task_id: 'synthetic-native-task', status: 'submitted' })
    if (url === `${GATEWAY_BASE}/videos/synthetic-video-task` || url === `${GATEWAY_BASE}/video/generations/synthetic-native-task`) {
      return Response.json({ status: 'completed', video_url: VIDEO })
    }
    if (url === VIDEO) return new Response(videoBytes, { headers: { 'content-type': 'video/mp4' } })
    throw new Error(`Unexpected synthetic transport: ${method} ${url}`)
  }
  const dest = join(home, 'result.mp4')
  const env = { OMNIMUX_BASE_URL: GATEWAY_BASE }
  const request = {
    model: MODEL, allowedGroups: ['premium'], operation: 'first_frame', prompt: 'fixture',
    references: [{ type: 'image', role: 'first_frame', pathOrUrl: FIRST_FRAME }],
    duration: 10, aspectRatio: 'adaptive', wait: false, uploadLocalAssets: false,
    dest, fetcher, env,
  }
  await assert.rejects(executeOmnimuxVideo({ ...request, allowedGroups: ['premium', 'budget'] }), { code: 'unknown-group' })
  await assert.rejects(executeOmnimuxVideo({ ...request, effectiveVideoVersion: 'older-capability-version' }), { code: 'unknown-group' })
  await assert.rejects(executeOmnimuxVideo(request), { code: 'unknown-group' })
  assert.equal(requests.length, 0, 'an account switch with otherwise unchanged grants must stop before POST')
  switchAccountOnKeyCheck = false
  changePriceOnKeyCheck = true
  await assert.rejects(executeOmnimuxVideo(request), { code: 'unknown-group' })
  assert.equal(requests.length, 0, 'a price change with the same capability version must stop before POST')
  changePriceOnKeyCheck = false
  snapshot = snapshotOf()
  const submitted = await executeOmnimuxVideo(request)
  assert.equal(submitted.mode, 'submitted')
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], {
    url: `${GATEWAY_BASE}/videos`, method: 'POST', group: 'premium',
    body: { prompt: 'fixture', operation: 'first_frame', image: FIRST_FRAME, duration: 10, aspect_ratio: 'adaptive', model: MODEL },
  })

  const restricted = groupedResponse()
  delete restricted.usable_group.premium
  snapshot = snapshotOf(restricted)
  await assert.rejects(executeOmnimuxVideo(request), { code: 'unknown-group' })
  accountViewKey = 'synthetic-account-a'
  await assert.rejects(executeOmnimuxVideo({ taskRef: submitted.taskRef, dest, fetcher, env }), { code: 'needs-omnimux' })
  assert.equal(requests.length, 1, 'a different account cannot query the accepted task')
  accountViewKey = 'synthetic-account-b'
  const recovered = await executeOmnimuxVideo({ taskRef: submitted.taskRef, dest, fetcher, env })
  assert.equal(recovered.mode, 'live')
  assert.deepEqual(await readFile(dest), videoBytes)
  assert.equal(requests.filter((req) => req.method === 'POST').length, 1)
  assert.deepEqual(requests[1], { url: `${GATEWAY_BASE}/videos/synthetic-video-task`, method: 'GET', group: 'premium' })
  const budget = await executeOmnimuxVideo({ ...request, allowedGroups: ['budget'], duration: 5, resolution: '720p' })
  assert.equal(budget.taskId, 'synthetic-native-task')
  assert.deepEqual(requests.at(-1), {
    url: `${GATEWAY_BASE}/video/generations`, method: 'POST', group: 'budget', protocol: 'video_generations',
    body: {
      prompt: 'fixture', operation: 'first_frame', model: MODEL, duration: 5, size: 'adaptive', resolution: '720p',
      image_with_roles: [{ url: FIRST_FRAME, role: 'first_frame' }],
    },
  })

  snapshot = await mixedProtocolSnapshot()
  const mixed = await executeOmnimuxVideo({ ...request, model: MODEL_MIXED, allowedGroups: ['default'], duration: 5 })
  assert.equal(mixed.taskId, 'synthetic-native-task')
  assert.deepEqual(requests.at(-1), {
    url: `${GATEWAY_BASE}/video/generations`, method: 'POST', group: 'default', protocol: 'video_generations',
    body: {
      prompt: 'fixture', operation: 'first_frame', model: MODEL_MIXED, duration: 5, size: 'adaptive', output_format: 'mp4',
      image_with_roles: [{ url: FIRST_FRAME, role: 'first_frame' }],
    },
  })
  const finished = await executeOmnimuxVideo({ taskRef: mixed.taskRef, dest, fetcher, env })
  assert.equal(finished.mode, 'live')
  assert.equal(requests.filter((entry) => entry.method === 'POST' && entry.body.model === MODEL_MIXED).length, 1)
  assert.deepEqual(requests.filter((entry) => entry.method === 'GET').at(-2), {
    url: `${GATEWAY_BASE}/video/generations/synthetic-native-task`, method: 'GET', group: 'default',
  })
  assert.deepEqual(await readFile(dest), videoBytes)
})
