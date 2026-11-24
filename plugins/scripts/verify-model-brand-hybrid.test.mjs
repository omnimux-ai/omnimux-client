import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizePricingPayload } from '../plugins/omnimux/src/catalog/cloud/snapshot.js'
import { buildModelCatalog } from '../plugins/omnimux/src/catalog/list.js'
import { readCanvasCatalog } from '../plugins/omnimux-workflow/src/workflow/seam/canvasCatalog.ts'
import { buildFilteredModelOptions } from '../plugins/omnimux-workflow/src/shared/validation/operationUi.ts'
import { groupPickerCandidates } from '../plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/modelPickerCandidates.ts'

describe('Cross-plugin hybrid model-brand contract (Hub -> Workflow seam)', () => {
  it('propagates unknown gateway brand_id end-to-end without gpt- prefix hijacking family or cascade menu group', () => {
    const pricingPayload = {
      success: true,
      brands: {
        openai: { id: 'openai', name: 'OpenAI' },
        bytedance: { id: 'bytedance', name: 'ByteDance' },
        'acme-labs': { id: 'acme-labs', name: 'Acme Labs', icon_path: 'M12 2L22 20H2Z' },
      },
      usable_group: { default: 'Default' },
      group_ratio: { default: 1 },
      data: [
        {
          model_name: 'gpt-acme-vision',
          display_name: 'Acme Vision',
          brand_id: 'acme-labs',
          brand_name: 'Acme Labs',
          enable_groups: ['default'],
          supported_endpoint_types: ['image'],
          billing_mode: 'per_call',
          model_price: 0.05,
          contract: {
            schemaVersion: '2.0',
            model_id: 'gpt-acme-vision',
            family: 'image',
            status: 'documented',
            execution_status: 'live',
            brand_id: 'acme-labs',
            brand_name: 'Acme Labs',
            operations: [
              {
                id: 'text_to_image',
                executable: true,
                output: { type: 'image' },
                inputs: [{ slot: 'prompt', type: 'text', required: true }],
              },
            ],
          },
        },
        {
          model_name: 'gpt-image-2.5',
          display_name: 'GPT Image 2.5',
          brand_id: 'openai',
          brand_name: 'OpenAI',
          enable_groups: ['default'],
          supported_endpoint_types: ['image'],
          billing_mode: 'per_call',
          model_price: 0.04,
          contract: {
            schemaVersion: '2.0',
            model_id: 'gpt-image-2.5',
            family: 'image',
            status: 'documented',
            execution_status: 'live',
            brand_id: 'openai',
            brand_name: 'OpenAI',
            operations: [
              {
                id: 'text_to_image',
                executable: true,
                output: { type: 'image' },
                inputs: [{ slot: 'prompt', type: 'text', required: true }],
              },
            ],
          },
        },
        {
          model_name: 'seedream-9-9',
          display_name: 'Seedream 9.9',
          brand_id: 'bytedance',
          brand_name: 'ByteDance',
          enable_groups: ['default'],
          supported_endpoint_types: ['image'],
          billing_mode: 'per_call',
          model_price: 0.03,
          contract: {
            schemaVersion: '2.0',
            model_id: 'seedream-9-9',
            family: 'image',
            status: 'documented',
            execution_status: 'live',
            brand_id: 'bytedance',
            brand_name: 'ByteDance',
            operations: [
              {
                id: 'text_to_image',
                executable: true,
                output: { type: 'image' },
                inputs: [{ slot: 'prompt', type: 'text', required: true }],
              },
            ],
          },
        },
      ],
    }

    const { snapshot } = normalizePricingPayload(pricingPayload, {
      generatedAt: '2026-11-24T00:00:00.000Z',
    })
    const hubCatalog = buildModelCatalog({
      snapshot,
      snapshotSource: 'remote',
      gatewayContracts: true,
    })

    const canvasCatalog = readCanvasCatalog((name) => {
      if (name === 'imageGenerate') return { execute: () => {} }
      if (name === 'modelCatalog') return { list: () => hubCatalog }
      return undefined
    })

    const filtered = buildFilteredModelOptions({
      catalog: canvasCatalog,
      outputType: 'image',
      allowUnassignedInputs: true,
    })
    const groups = groupPickerCandidates(filtered.options)

    const acmeGroup = groups.find((g) => g.id === 'acme-labs')
    const openaiGroup = groups.find((g) => g.id === 'openai')
    const seedreamGroup = groups.find((g) => g.id === 'seedream')

    assert.ok(acmeGroup, 'Acme Labs must remain its own group and never merge into OpenAI')
    assert.equal(acmeGroup.name, 'Acme Labs')
    assert.equal(acmeGroup.brandId, 'acme-labs')
    assert.equal(acmeGroup.brandIconPath, 'M12 2L22 20H2Z')
    assert.deepEqual(acmeGroup.rows.map((r) => r.id), ['gpt-acme-vision'])

    assert.ok(openaiGroup, 'OpenAI group must contain only OpenAI models')
    assert.equal(openaiGroup.name, 'OpenAI')
    assert.equal(openaiGroup.brandId, 'openai')
    assert.deepEqual(openaiGroup.rows.map((r) => r.id), ['gpt-image-2.5'])

    assert.ok(seedreamGroup, 'ByteDance Seedream product sub-family must remain intact')
    assert.equal(seedreamGroup.name, 'Seedream')
    assert.equal(seedreamGroup.brandId, 'bytedance')
    assert.deepEqual(seedreamGroup.rows.map((r) => r.id), ['seedream-9-9'])
  })
})
