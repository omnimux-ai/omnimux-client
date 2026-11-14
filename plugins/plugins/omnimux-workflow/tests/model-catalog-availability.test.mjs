import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildModelCatalog } from '../../omnimux/src/catalog/list.js'
import { projectCanvasCatalog } from '../src/shared/generationPolicy.ts'
import { buildFilteredModelOptions } from '../src/shared/validation/operationUi.ts'
import { buildUpstreamFingerprint, planAutoAdaptation } from '../src/shared/validation/compatKernel.ts'

const bundled = JSON.parse(readFileSync(new URL('../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'))
const fingerprint = buildUpstreamFingerprint({ prompt: 'make a clip' })

test('stale unsupported preference never wins auto-adaptation', () => {
  const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }))
  const picked = planAutoAdaptation({
    catalog,
    fingerprint,
    outputType: 'audio',
    preferredModelId: 'suno-sounds',
  })
  assert.ok(picked)
  assert.notEqual(picked.modelId, 'suno-sounds')
  assert.equal(picked.modelId, 'suno')

  const options = buildFilteredModelOptions({ catalog, fingerprint, outputType: 'audio' })
  assert.equal(options.options.some((option) => option.id === 'suno-sounds'), false)
})

test('gateway v2 video model with an adapter profile becomes selectable without local YAML', () => {
  const snapshot = structuredClone(bundled)
  snapshot.models.push({
    id: 'synthetic-video',
    displayName: 'Synthetic Video',
    enableGroups: ['default'],
    supportedEndpointTypes: ['openai'],
    billing: { mode: 'per_task', modelPrice: 1, modelRatio: 0, quotaType: 1, expr: null },
    contract: {
      model_id: 'synthetic-video',
      schemaVersion: '2.0',
      contractVersion: 'fixture',
      family: 'video',
      status: 'documented',
      operation_ids: ['text_to_video'],
      operations: [{
        id: 'text_to_video',
        executable: true,
        inputs: [{ slot: 'prompt', type: 'text', required: true }],
        output: { type: 'video', formats: ['mp4'], sizes: ['1280x720'] },
      }],
    },
  })

  const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot }))
  const row = catalog.video.find((candidate) => candidate.id === 'synthetic-video')
  assert.equal(row?.executionStatus, 'ready')
  assert.equal(row?.selectable, true)

  const picked = planAutoAdaptation({
    catalog,
    fingerprint,
    outputType: 'video',
    preferredModelId: 'synthetic-video',
  })
  assert.equal(picked?.modelId, 'synthetic-video')
})

test('wan-3.0 is executable after the video overlay and unsold local rows stay unselectable', () => {
  const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }))
  assert.equal(catalog.video.find((row) => row.id === 'wan-3.0')?.selectable, true)
  assert.equal(catalog.models.find((row) => row.id === 'seedance-2-0-fast')?.selectable, false)
})
