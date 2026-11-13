import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { apply, PRODUCT_TOOL_NAMES } from './index.js'

let root
let prevHome

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'products-tools-'))
  prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  writeFileSync(join(root, 'hero.png'), 'png')
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  rmSync(root, { recursive: true, force: true })
})

function harness() {
  /** @type {Map<string, any>} */
  const tools = new Map()
  const ctx = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
      },
    },
    systemPrompt: {
      section() {},
    },
    inject() {},
  }
  apply(ctx)
  return tools
}

describe('products tools', () => {
  it('registers all seven tools including products_delete', () => {
    const tools = harness()
    assert.deepEqual([...tools.keys()], [...PRODUCT_TOOL_NAMES])
    assert.equal(tools.has('products_delete'), true)
  })

  it('create requires content; list/search/get/update/read_media share the store', async () => {
    const tools = harness()
    await assert.rejects(
      () => tools.get('products_create').execute({ name: '空货' }),
      (error) => error.code === 'content-required',
    )

    const created = await tools.get('products_create').execute({
      name: '某防晒',
      selling_points: '清爽不粘腻',
      media: [{ real_path: join(root, 'hero.png') }],
    })
    assert.equal(created.product.cite, '@产品/某防晒')

    const listed = await tools.get('products_list').execute({})
    assert.equal(listed.products.length, 1)
    assert.equal(listed.products[0].media_count, 1)
    assert.equal(listed.products[0].media, undefined)

    const found = await tools.get('products_search').execute({ query: '清爽' })
    assert.equal(found.products[0].handle, '某防晒')

    const got = await tools.get('products_get').execute({ id: '某防晒' })
    assert.equal(got.product.brand_strategy, null)
    assert.equal(got.product.media.length, 1)

    const gallery = await tools.get('products_read_media').execute({ id: created.product.id })
    assert.equal(gallery.media.length, 1)

    const updated = await tools.get('products_update').execute({ id: created.product.id, price: '199' })
    assert.equal(updated.product.price, '199')

    await assert.rejects(
      () => tools.get('products_get').execute({ id: 'nope' }),
      (error) => error.code === 'product-not-found',
    )
  })

  it('create digital + strategy persists; strategy-only satisfies content; price-only update keeps strategy; delete works with confirm', async () => {
    const tools = harness()
    await assert.rejects(
      () => tools.get('products_create').execute({
        name: '空数字货',
        kind: 'digital',
      }),
      (error) => error.code === 'content-required',
    )

    const created = await tools.get('products_create').execute({
      name: '数字货',
      kind: 'digital',
      brand_strategy: { brand_basic_info: { product: { name: 'X' } } },
    })
    assert.equal(created.product.kind, 'digital')
    assert.equal(created.product.brand_strategy.brand_basic_info.product.name, 'X')

    const updated = await tools.get('products_update').execute({
      id: created.product.id,
      price: '99',
    })
    assert.equal(updated.product.price, '99')
    assert.equal(updated.product.brand_strategy.brand_basic_info.product.name, 'X')

    // Test products_delete without confirm
    await assert.rejects(
      () => tools.get('products_delete').execute({ id: created.product.id, confirm: false }),
      (error) => error.code === 'confirmation-required',
    )

    // Test products_delete with confirm
    const deleteRes = await tools.get('products_delete').execute({ id: created.product.id, confirm: true })
    assert.equal(deleteRes.ok, true)
    assert.equal(deleteRes.id, created.product.id)
    assert.equal(deleteRes.deleted, true)

    // Verify it is gone
    await assert.rejects(
      () => tools.get('products_get').execute({ id: created.product.id }),
      (error) => error.code === 'product-not-found',
    )
  })
})
