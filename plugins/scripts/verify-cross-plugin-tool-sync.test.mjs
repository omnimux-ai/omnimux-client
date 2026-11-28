import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as productsPlugin from '../plugins/omnimux-products/src/index.js'
import * as tiktokSelectionPlugin from '../plugins/omnimux-tiktok-selection/src/index.js'

test('cross-plugin tiktok-selection sync writes to real omnimux-products through ctx.tools.execute batch contract', async () => {
  const home = mkdtempSync(join(tmpdir(), 'omnimux-414-cross-sync-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const registered = new Map()
  const batchCalls = []
  const directDefinitionCalls = []
  const toolsService = {
    register(def) {
      registered.set(def.name, def)
      return () => registered.delete(def.name)
    },
    get(name) {
      const def = registered.get(name)
      if (!def) return undefined
      return {
        ...def,
        execute: async (args, exec) => {
          directDefinitionCalls.push(name)
          return def.execute(args, exec)
        },
      }
    },
    executable(name) {
      return this.get(name)
    },
    async execute(batchInput) {
      batchCalls.push(batchInput)
      const results = []
      for (const call of batchInput.calls || []) {
        const def = registered.get(call.name)
        const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments || {})
        try {
          const value = await def.execute(args, { signal: batchInput.signal })
          results.push({ callId: call.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify(value) }], value } })
        } catch (err) {
          results.push({ callId: call.id, result: { isError: true, content: [{ type: 'text', text: err.message }], error: { message: err.message } } })
        }
      }
      return { results }
    },
  }
  const disposers = []
  const ctx = {
    tools: toolsService,
    systemPrompt: { section: () => () => {} },
    inject: () => {},
    get: (name) => (name === 'tools' ? toolsService : undefined),
    effect: (fn) => {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
    },
  }
  try {
    productsPlugin.apply(ctx)
    const { store } = tiktokSelectionPlugin.apply(ctx, { home, enableScheduler: false })
    const { added } = store.ingestProducts([
      {
        productId: 'tt_e2e_001',
        region: 'US',
        title: 'Portable Mini Espresso Maker / USB-C Travel Coffee Brewer Pro 2026 Edition',
        category: 'Home Appliances',
        sales7d: 900,
        commissionRate: 16,
      },
    ])
    const syncTool = registered.get('tiktok_selection_generate_assets')
    const res = await syncTool.execute({ kind: 'sync_omnimux_products', productIds: [added[0].id] })
    strictEqual(res.succeeded, 1)
    strictEqual(batchCalls.length, 1)
    strictEqual(batchCalls[0].calls[0].name, 'products_create')
    strictEqual(directDefinitionCalls.length, 0)
    const created = await registered.get('products_get').execute({ id: res.results[0].syncedProductId })
    ok(created.product.name.length <= 40, `expected <=40 chars, got ${created.product.name.length}`)
    strictEqual(created.product.name.includes('/'), false)
  } finally {
    for (const d of disposers) d()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})
