import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  BRAND_SVGS as KIT_BRAND_SVGS,
  CANONICAL_BRAND_NAMES as KIT_CANONICAL_BRAND_NAMES,
  isValidBrandId as kitIsValidBrandId,
  resolveModelBrand as kitResolveModelBrand,
  sanitizeBrandIconPath,
} from 'dsh-ui-kit/model-brands'
import {
  CANONICAL_BRAND_NAMES as CATALOG_CANONICAL_BRAND_NAMES,
  isValidBrandId as catalogIsValidBrandId,
  sanitizeBrandIconPath as catalogSanitizeBrandIconPath,
} from './brand-contract.js'
import {
  BRAND_SVGS as HUB_BRAND_SVGS,
  resolveModelBrand as hubResolveModelBrand,
} from '../brand/model-brands.js'
import {
  normalizePricingPayload,
  snapshotContentDigest,
  snapshotPresentationDigest,
} from './cloud/snapshot.js'
import { createCloudCatalogStore } from './cloud/store.js'
import { createLiveCatalog } from './cloud/live.js'
import { createCatalogRefresher } from './cloud/refresh.js'
import { buildModelCatalog } from './list.js'

function makeGatewayPricingPayload({
  brandName = 'Acme Labs',
  iconPath = 'M12 2L22 20H2Z',
  extraBrands = {},
  extraModels = [],
} = {}) {
  return {
    success: true,
    brands: {
      openai: { id: 'openai', name: 'OpenAI' },
      'acme-labs': {
        id: 'acme-labs',
        name: brandName,
        ...(iconPath !== undefined ? { icon_path: iconPath } : {}),
      },
      ...extraBrands,
    },
    usable_group: { default: 'Default' },
    group_ratio: { default: 1 },
    data: [
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
        model_name: 'gpt-acme-vision',
        display_name: 'Acme Vision',
        brand_id: 'acme-labs',
        brand_name: brandName,
        enable_groups: ['default'],
        supported_endpoint_types: ['image-generation', 'openai'],
        billing_mode: 'per_call',
        model_price: 0.05,
        contract: {
          schemaVersion: '2.0',
          model_id: 'gpt-acme-vision',
          family: 'image',
          status: 'documented',
          execution_status: 'live',
          brand_id: 'acme-labs',
          brand_name: brandName,
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
      ...extraModels,
    ],
  }
}

describe('Hybrid model-brand contract (Hub catalog + digest decoupling + security)', () => {
  it('normalizes gateway brands and rejects invalid brand IDs / malicious icon_path fail-closed', () => {
    const payload = makeGatewayPricingPayload({
      extraBrands: {
        'Bad_ID': { id: 'Bad_ID', name: 'Bad' },
        'xss-brand': { id: 'xss-brand', name: 'XSS Brand', icon_path: '<svg onload="alert(1)">' },
        'js-brand': { id: 'js-brand', name: 'JS Brand', icon_path: 'javascript:alert(1)' },
        'ws-brand': { id: 'ws-brand', name: 'WS Brand', icon_path: ' M0 0L10 10 ' },
        'huge-brand': { id: 'huge-brand', name: 'Huge Brand', icon_path: `M0 0${'L1 1'.repeat(1100)}` },
      },
      extraModels: [
        {
          model_name: 'xss-model-1',
          display_name: 'XSS Model',
          brand_id: 'xss-brand',
          brand_name: 'XSS Brand',
          enable_groups: ['default'],
          supported_endpoint_types: ['image'],
          contract: { schemaVersion: '2.0', operations: [] },
        },
      ],
    })
    const { snapshot, issues } = normalizePricingPayload(payload, { generatedAt: '2026-11-24T00:00:00.000Z' })

    assert.deepEqual(snapshot.brands['acme-labs'], {
      id: 'acme-labs',
      name: 'Acme Labs',
      iconPath: 'M12 2L22 20H2Z',
    })
    assert.equal(snapshot.brands.Bad_ID, undefined, 'invalid brand_id must be dropped')
    assert.equal(snapshot.brands['xss-brand']?.iconPath, undefined, 'raw <svg> icon_path must be stripped')
    assert.equal(snapshot.brands['js-brand']?.iconPath, undefined, 'javascript: icon_path must be stripped')
    assert.equal(snapshot.brands['ws-brand']?.iconPath, undefined, 'padded whitespace icon_path must be stripped')
    assert.equal(snapshot.brands['huge-brand']?.iconPath, undefined, 'oversize icon_path must be stripped')
    assert.ok(issues.some((i) => i.code === 'invalid-brand-meta' && i.detail === 'Bad_ID'))
    assert.ok(issues.some((i) => i.code === 'invalid-brand-icon-path' && i.detail === 'xss-brand'))
    assert.equal(sanitizeBrandIconPath('<svg><path d="M0 0"/></svg>'), null)
  })

  it('decouples execution fingerprint from brand display updates while refreshing cache, runtime index, and catalog UI', async () => {
    const first = normalizePricingPayload(
      makeGatewayPricingPayload({ brandName: 'Acme Labs', iconPath: 'M12 2L22 20H2Z' }),
      { generatedAt: '2026-11-24T00:00:00.000Z' },
    ).snapshot
    const second = normalizePricingPayload(
      makeGatewayPricingPayload({ brandName: 'Acme Studio', iconPath: 'M4 4H20V20H4Z' }),
      { generatedAt: '2026-11-24T00:05:00.000Z' },
    ).snapshot

    // 1. Execution digest is bit-for-bit identical; presentation digest advances.
    assert.equal(snapshotContentDigest(first), snapshotContentDigest(second))
    assert.notEqual(snapshotPresentationDigest(first), snapshotPresentationDigest(second))

    // 2. Built model catalog preserves execution fingerprint & contractFingerprint while updating brands & presentationFingerprint.
    const cat1 = buildModelCatalog({ snapshot: first, snapshotSource: 'remote', gatewayContracts: true })
    const cat2 = buildModelCatalog({ snapshot: second, snapshotSource: 'remote', gatewayContracts: true })

    assert.equal(cat1.fingerprint, cat2.fingerprint, 'catalog.fingerprint must ignore display-only brand updates')
    assert.equal(cat1.contractFingerprint, cat2.contractFingerprint)
    assert.notEqual(cat1.presentationFingerprint, cat2.presentationFingerprint, 'presentationFingerprint must advance')

    const row1 = cat1.image.find((m) => m.id === 'gpt-acme-vision')
    const row2 = cat2.image.find((m) => m.id === 'gpt-acme-vision')
    assert.equal(row1?.brandId, 'acme-labs')
    assert.equal(row1?.brandName, 'Acme Labs')
    assert.equal(row1?.brandIconPath, 'M12 2L22 20H2Z')
    assert.equal(row2?.brandId, 'acme-labs')
    assert.equal(row2?.brandName, 'Acme Studio')
    assert.equal(row2?.brandIconPath, 'M4 4H20V20H4Z')
    assert.equal(cat2.brands?.['acme-labs']?.name, 'Acme Studio')
    assert.equal(cat2.brands?.['acme-labs']?.iconPath, 'M4 4H20V20H4Z')

    // 3. Disk store accepts presentation-only refresh and skips identical refreshes.
    const home = mkdtempSync(join(tmpdir(), 'omnimux-brand-store-'))
    try {
      const store = createCloudCatalogStore(home)
      const r1 = store.acceptRefresh(first, { fetchedAt: '2026-11-24T00:00:00.000Z' })
      assert.equal(r1.accepted, true)

      const dup = store.acceptRefresh(
        { ...first, generatedAt: '2026-11-24T00:01:00.000Z' },
        { fetchedAt: '2026-11-24T00:01:00.000Z' },
      )
      assert.equal(dup.accepted, false)
      assert.equal(dup.reason, 'unchanged')

      const r2 = store.acceptRefresh(second, { fetchedAt: '2026-11-24T00:05:00.000Z' })
      assert.equal(r2.accepted, true, 'display-only brand update must flush to disk')
      assert.equal(r2.digest, r1.digest)
      assert.notEqual(r2.presentationDigest, r1.presentationDigest)

      // 4. Refresher fires onChanged when gateway updates brand display metadata.
      const liveHome = mkdtempSync(join(tmpdir(), 'omnimux-brand-live-'))
      try {
        let currentPayload = makeGatewayPricingPayload({ brandName: 'Acme Labs', iconPath: 'M12 2L22 20H2Z' })
        let changeCount = 0
        const live = createLiveCatalog({ home: liveHome, bundledDir: join(liveHome, 'no-bundled') })
        const refresher = createCatalogRefresher({
          live,
          url: 'https://gateway.example/api/pricing',
          ttlSeconds: 300,
          timeoutMs: 5000,
          fetchImpl: async () => ({ ok: true, status: 200, json: async () => currentPayload }),
          onChanged: () => { changeCount += 1 },
        })
        const firstRefresh = await refresher.refreshOnce(true)
        assert.equal(firstRefresh.changed, true)
        assert.equal(changeCount, 1)

        // Same payload -> no change event
        const noopRefresh = await refresher.refreshOnce(true)
        assert.equal(noopRefresh.changed, false)
        assert.equal(changeCount, 1)

        // Brand display update only -> fires onChanged!
        currentPayload = makeGatewayPricingPayload({ brandName: 'Acme Studio', iconPath: 'M4 4H20V20H4Z' })
        const brandRefresh = await refresher.refreshOnce(true)
        assert.equal(brandRefresh.changed, true)
        assert.equal(changeCount, 2)
      } finally {
        rmSync(liveHome, { recursive: true, force: true })
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('converges hub brand registry to dsh-ui-kit/model-brands and eliminates dangerouslySetInnerHTML in ModelPicker', () => {
    const probeIds = [
      'gpt-image-2.5',
      'muse-image',
      'nano-banana-2-lite',
      'seedream-5-5',
      'seedance-2-5',
      'claude-opus-4-6',
      'wan-3.0',
      'minimax-h3-video',
      'grok-4.6',
      'indextts-2',
      'opaque-unknown-99',
    ]
    for (const id of probeIds) {
      assert.equal(hubResolveModelBrand(id), kitResolveModelBrand(id), `brand parity for ${id}`)
    }
    assert.deepEqual(Object.keys(HUB_BRAND_SVGS).sort(), Object.keys(KIT_BRAND_SVGS).sort())
    assert.deepEqual(CATALOG_CANONICAL_BRAND_NAMES, KIT_CANONICAL_BRAND_NAMES)
    for (const candidate of ['openai', 'acme-labs', 'Bad_ID', ' openai ', '']) {
      assert.equal(catalogIsValidBrandId(candidate), kitIsValidBrandId(candidate), `brandId validator parity: ${candidate}`)
    }
    for (const path of ['M12 2L22 20H2Z', ' M0 0', '<svg onload=alert(1)>', 'M0\u00A00', '']) {
      assert.equal(catalogSanitizeBrandIconPath(path), sanitizeBrandIconPath(path), `iconPath validator parity: ${path}`)
    }

    const pickerSrc = readFileSync(
      new URL('../client/composer-quick-shortcuts/ModelPicker.jsx', import.meta.url),
      'utf8',
    )
    assert.doesNotMatch(pickerSrc, /dangerouslySetInnerHTML/, 'ModelPicker.jsx must not use dangerouslySetInnerHTML')
    assert.match(pickerSrc, /dsh-ui-kit\/model-brands/, 'ModelPicker.jsx must consume dsh-ui-kit/model-brands')
  })
})
