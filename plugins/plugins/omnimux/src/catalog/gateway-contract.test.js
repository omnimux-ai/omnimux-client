import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildModelCatalog } from './list.js'
import { getGatewayTextRows, getRuntimeContractIndex } from './runtime-index.js'
import { parseTextConfig, resolveTextRoute } from '../text/catalog.js'
import { guardSubmit } from './contract/submit-guard/index.js'

const bundled = JSON.parse(readFileSync(new URL('./cloud/bundled/pricing.json', import.meta.url), 'utf8'))
const snapshot = bundled

test('Gateway Contract v2 fills text and image buckets without local YAML', () => {
  const catalog = buildModelCatalog({ env: {}, snapshot })
  assert.deepEqual(catalog.text.map((row) => row.id).sort(), ['gemini-3.8-flash', 'gemini-4-argon', 'seed-evolving'])
  assert.deepEqual(catalog.image.map((row) => row.id).sort(), ['gpt-image-2.5', 'muse-image', 'nano-banana-2-1', 'nano-banana-2-lite', 'seedream-5-5'])
  assert.equal(catalog.gateway.missingContract.length, 0)
  assert.deepEqual(catalog.gateway.adapterUnsupported, ['suno-sounds'])

  const argon = catalog.models.find((row) => row.id === 'gemini-4-argon')
  assert.equal(argon?.gateway?.schemaVersion, '2.0')
  assert.equal(argon?.gateway?.status, 'partial')
  assert.match(argon?.label ?? '', /^Gemini 4 Argon$/)
  assert.equal(argon?.executionStatus, 'unverified')
  assert.equal(argon?.executionProfile?.contextWindowTokens, undefined)
  assert.equal(argon?.executionProfile?.maxOutputTokens, undefined)
  assert.ok(argon?.executionProfile?.unknowns.includes('context_window_tokens'))
  assert.ok(argon?.executionProfile?.unknowns.includes('max_output_tokens'))
  assert.deepEqual(argon?.executionProfile?.inputModalities, ['text', 'image', 'video', 'pdf'])
  assert.equal(argon?.executionProfile?.streaming, true)

  const flash = catalog.models.find((row) => row.id === 'gemini-3.8-flash')
  assert.equal(flash?.executionStatus, 'ready')
  assert.equal(flash?.executionProfile?.contextWindowTokens, 1048576)
  assert.equal(flash?.executionProfile?.maxOutputTokens, 65536)
  assert.equal(flash?.executionProfile?.toolCalling, true)
  assert.equal(flash?.executionProfile?.promptCaching, true)
  assert.ok(catalog.text.find((row) => row.id === 'gemini-4-argon')?.inputCapability?.modalities.includes('document'))

  const gpt = catalog.models.find((row) => row.id === 'gpt-image-2.5')
  const reference = gpt?.operations.find((operation) => operation.id === 'multi_reference')?.inputs.find((input) => input.type === 'image')
  assert.equal(reference?.max, 1)
  assert.deepEqual(gpt?.parameters?.quality?.options, [{ value: 'medium' }])
  assert.deepEqual(gpt?.parameters?.resolution?.options, [{ value: '1K' }])

  const museVideo = catalog.models.find((row) => row.id === 'muse-video')
  assert.equal(museVideo?.family, 'muse')
  assert.equal(museVideo?.label, 'Muse Video')
  assert.equal(museVideo?.executionStatus, 'ready')
  assert.equal(museVideo?.selectable, true)
  const museImage = catalog.models.find((row) => row.id === 'muse-image')
  assert.equal(museImage?.family, 'muse')
  assert.equal(museImage?.label, 'Muse Image')
  assert.equal(museImage?.executionStatus, 'ready')
  assert.equal(museImage?.selectable, true)

  const nanoLite = catalog.models.find((row) => row.id === 'nano-banana-2-lite')
  const nanoRef = nanoLite?.operations.find((operation) => operation.id === 'image_to_image')?.inputs.find((input) => input.type === 'image')
  assert.equal(nanoRef?.max, 14)
})

test('Gateway text rows and SubmitGuard admit gateway-only models', () => {
  const runtime = getRuntimeContractIndex({ snapshot })
  const rows = getGatewayTextRows({ snapshot })
  assert.deepEqual(rows.map((row) => row.id), ['gemini-3.8-flash', 'gemini-4-argon', 'seed-evolving'])

  const text = parseTextConfig({})
  const route = resolveTextRoute({
    model: 'gemini-4-argon',
    references: [{ type: 'image', pathOrUrl: 'https://example.test/cat.png' }],
  }, text, {}, {}, rows)
  assert.equal(route.modelId, 'gemini-4-argon')
  assert.ok(route.input.includes('image'))

  for (const [model, operation, capability] of [
    ['gemini-4-argon', 'chat', 'text'],
    ['nano-banana-2-lite', 'text_to_image', 'image'],
  ]) {
    const result = guardSubmit(
      { prompt: 'fixture', model, operation, assets: [] },
      { index: runtime.index, seam: capability === 'text' ? 'textComplete' : 'imageGenerate', capability, outputType: capability },
    )
    assert.equal(result.ok, true, `${model}: ${result.message ?? result.code}`)
  }
})

test('a v1 cached snapshot supplements missing contracts from bundled v2', () => {
  const legacy = structuredClone(bundled)
  for (const model of legacy.models ?? []) {
    if (model.contract) model.contract = { ...model.contract, schemaVersion: '1.0' }
  }
  legacy.generatedAt = '2026-11-03T07:06:42.228Z'
  const catalog = buildModelCatalog({ env: {}, snapshot: legacy })
  assert.deepEqual(catalog.text.map((row) => row.id).sort(), ['gemini-3.8-flash', 'gemini-4-argon', 'seed-evolving'])
  assert.deepEqual(catalog.image.map((row) => row.id).sort(), ['gpt-image-2.5', 'muse-image', 'nano-banana-2-1', 'nano-banana-2-lite', 'seedream-5-5'])
  assert.deepEqual(catalog.gateway.missingContract, [])
  assert.deepEqual(catalog.gateway.adapterUnsupported, ['suno-sounds'])
})

test('video/audio gateway contracts overlay without per-model YAML', () => {
  const catalog = buildModelCatalog({ env: {}, snapshot })
  const wan = catalog.models.find((row) => row.id === 'wan-3.0')
  assert.equal(wan?.executionStatus, 'ready')
  assert.equal(wan?.selectable, true)
  assert.equal(wan?.operations?.filter((operation) => operation.listed).length, 6)
  assert.equal(catalog.audio.some((row) => row.id === 'suno-sounds'), false)
})

test('Muse ordered reference slots keep the gateway minimum through catalog and submission', () => {
  const catalog = buildModelCatalog({ env: {} })
  assert.equal(catalog.gateway.source, 'bundled')
  const model = catalog.models.find((row) => row.id === 'muse-video')
  assert.deepEqual(model.operations.filter((operation) => operation.listed).map((operation) => operation.id), [
    'text_to_video', 'first_frame', 'video_multi_ref',
  ])
  const operation = model.operations.find((entry) => entry.id === 'video_multi_ref')
  const slot = operation.inputs.find((input) => input.slot === 'reference_images')
  assert.equal(slot.min, 2)
  assert.equal(slot.max, 2)
  assert.equal(slot.role, 'reference')
  assert.equal(slot.firstItemRole, 'first_frame')
  assert.deepEqual(slot.allowedMimes, ['image/jpeg', 'image/png', 'image/webp'])

  const { index } = getRuntimeContractIndex()
  const urls = ['https://example.test/z.png', 'https://example.test/a.png']
  const assets = urls.map((pathOrUrl) => ({ type: 'image', role: 'reference', pathOrUrl, mime: 'image/png' }))
  const submit = (assets) => guardSubmit(
    { model: model.id, operation: 'video_multi_ref', prompt: 'fixture', aspectRatio: '9:16', duration: 5, assets },
    { index, seam: 'videoGenerate', capability: 'video', outputType: 'video' },
  )
  for (const insufficientAssets of [[], assets.slice(0, 1)]) {
    assert.equal(submit(insufficientAssets).code, 'min_unsatisfied')
  }
  assert.equal(submit([...assets, { ...assets[0], pathOrUrl: 'https://example.test/extra.png' }]).code, 'slot_capacity')

  const result = submit(assets)
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.vendorPayload, {
    prompt: 'fixture', operation: 'video_multi_ref', image_urls: urls,
    aspect_ratio: '9:16', duration: 5, output_format: 'mp4',
  })
})

test('Muse accepts the expanded gateway reference range and preserves request order', () => {
  const expandedSnapshot = structuredClone(bundled)
  const rawModel = expandedSnapshot.models.find((model) => model.id === 'muse-video')
  const rawOperation = rawModel.contract.operations.find((operation) => operation.id === 'video_multi_ref')
  rawOperation.inputs.find((input) => input.slot === 'reference_images').max = 10

  const catalog = buildModelCatalog({ env: {}, snapshot: expandedSnapshot })
  const model = catalog.models.find((row) => row.id === 'muse-video')
  const operation = model.operations.find((entry) => entry.id === 'video_multi_ref')
  const slot = operation.inputs.find((input) => input.slot === 'reference_images')
  assert.deepEqual([slot.min, slot.max, slot.role, slot.firstItemRole], [2, 10, 'reference', 'first_frame'])

  const { index } = getRuntimeContractIndex({ snapshot: expandedSnapshot })
  const context = { index, seam: 'videoGenerate', capability: 'video', outputType: 'video' }
  const urls = Array.from({ length: 11 }, (_, i) => `https://example.test/frame-${11 - i}.png`)
  const assets = urls.map((pathOrUrl) => ({ type: 'image', role: 'reference', pathOrUrl, mime: 'image/png' }))
  const submit = (assets) => guardSubmit(
    { model: model.id, operation: 'video_multi_ref', prompt: 'fixture', aspectRatio: '9:16', duration: 5, assets },
    context,
  )

  assert.equal(submit(assets.slice(0, 1)).code, 'min_unsatisfied')
  for (const count of [2, 3, 10]) {
    const result = submit(assets.slice(0, count))
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(result.vendorPayload, {
      prompt: 'fixture', operation: 'video_multi_ref', image_urls: urls.slice(0, count),
      aspect_ratio: '9:16', duration: 5, output_format: 'mp4',
    })
  }
  assert.equal(submit(assets).code, 'slot_capacity')

  const firstFrame = guardSubmit({
    model: model.id, operation: 'first_frame', prompt: 'fixture', aspectRatio: 'adaptive', duration: 10,
    assets: [{ ...assets[0], role: 'first_frame' }],
  }, context)
  assert.equal(firstFrame.ok, true, firstFrame.message)
  assert.deepEqual(firstFrame.vendorPayload, {
    prompt: 'fixture', operation: 'first_frame', image: urls[0],
    aspect_ratio: 'adaptive', duration: 10, output_format: 'mp4',
  })
})

test('gateway video mode names reach both catalog projections independently of image count', () => {
  const fixture = structuredClone(bundled)
  const muse = fixture.models.find((model) => model.id === 'muse-video')
  const museReference = muse.contract.operations.find((operation) => operation.id === 'video_multi_ref')
  const museFirstFrame = muse.contract.operations.find((operation) => operation.id === 'first_frame')
  const seedance = fixture.models.find((model) => model.id === 'seedance-2-5')
  const seedanceReference = seedance.contract.operations.find((operation) => operation.id === 'video_multi_ref')
  museReference.modeKind = 'image_reference'
  museFirstFrame.modeKind = 'first_frame'
  seedanceReference.modeKind = 'multimodal_reference'

  for (const max of [2, 10]) {
    museReference.inputs.find((input) => input.slot === 'reference_images').max = max
    const catalog = buildModelCatalog({ env: {}, snapshot: fixture })
    for (const rows of [catalog.models, catalog.video]) {
      const findOperation = (modelId, operationId) => rows
        .find((model) => model.id === modelId).operations
        .find((operation) => operation.id === operationId)
      const reference = findOperation('muse-video', 'video_multi_ref')
      assert.equal(reference.modeKind, 'image_reference')
      assert.equal(reference.label, '图片参考')
      assert.equal(reference.labelEn, 'Image reference')
      assert.equal(reference.inputs.find((input) => input.slot === 'reference_images').max, max)

      const firstFrame = findOperation('muse-video', 'first_frame')
      assert.equal(firstFrame.modeKind, 'first_frame')
      assert.equal(firstFrame.label, '首帧驱动')
      assert.equal(firstFrame.labelEn, 'First-frame driven')

      const multimodal = findOperation('seedance-2-5', 'video_multi_ref')
      assert.equal(multimodal.modeKind, 'multimodal_reference')
      assert.equal(multimodal.label, '全能参考')
      assert.equal(multimodal.labelEn, 'All-reference video')
    }
  }
})

test('missing and unknown mode kinds retain the approved operation label', () => {
  const fixture = structuredClone(bundled)
  const muse = fixture.models.find((model) => model.id === 'muse-video')
  const operation = muse.contract.operations.find((entry) => entry.id === 'video_multi_ref')
  const read = () => buildModelCatalog({ env: {}, snapshot: fixture })
  const readReference = (catalog) => catalog.models.find((model) => model.id === muse.id)
    .operations.find((entry) => entry.id === operation.id)

  delete operation.modeKind
  const legacy = read()
  assert.equal(readReference(legacy).modeKind, undefined)
  assert.equal(readReference(legacy).label, '全能参考')
  const legacyIndexFingerprint = getRuntimeContractIndex({ snapshot: fixture }).index.contentFingerprint

  operation.modeKind = 'future_reference'
  const future = read()
  assert.equal(readReference(future).modeKind, 'future_reference')
  assert.equal(readReference(future).label, '全能参考')
  assert.notEqual(future.fingerprint, legacy.fingerprint)
  assert.notEqual(getRuntimeContractIndex({ snapshot: fixture }).index.contentFingerprint, legacyIndexFingerprint)
})

test('the bundled snapshot carries the live 16-model membership, including Muse and excluding delisted rows', () => {
  const ids = snapshot.models.map((row) => row.id).sort()
  assert.equal(ids.length, 16)
  assert.ok(ids.includes('muse-video'))
  assert.ok(ids.includes('muse-image'))
  assert.ok(!ids.includes('gemini-3.1-flash-lite-image'))
  assert.equal(snapshot.source, 'pricing')
  assert.ok(Number.isFinite(Date.parse(snapshot.generatedAt)))
})

test('a sold model with no v2 contract is reported as missingContract, not adapterUnsupported', () => {
  const withMissing = structuredClone(bundled)
  withMissing.models.push({
    id: 'synthetic-no-contract',
    displayName: 'Synthetic No Contract',
    enableGroups: ['default'],
    supportedEndpointTypes: ['openai'],
    billing: { mode: 'per_task', modelPrice: 1, modelRatio: 0, quotaType: 1, expr: null },
  })
  const catalog = buildModelCatalog({ env: {}, snapshot: withMissing })
  assert.deepEqual(catalog.gateway.missingContract, ['synthetic-no-contract'])
  assert.equal(catalog.gateway.adapterUnsupported.includes('synthetic-no-contract'), false)
  assert.equal(catalog.models.some((row) => row.id === 'synthetic-no-contract'), false)
})
