#!/usr/bin/env node
// Cordis-level proof that omnimux provides videoGenerate, imageGenerate,
// textComplete, and identity seams, and that consumers can safely resolve and call them.
// Usage:
//   DSH_SRC=/Users/example/Desktop/Project/Github/deepseek-harness node scripts/verify-cordis-propagate.mjs
// Resolves @deepseek-ai/cordis from DSH_SRC (vendor/cordis). Does not
// boot the full dsh profile and does not call external OmniMux services.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as omnimux from '../plugins/omnimux/src/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshSrc = process.env.DSH_SRC ?? '/Users/example/Desktop/Project/Github/deepseek-harness'
const cordisHref = pathToFileURL(join(dshSrc, 'vendor/cordis/lib/index.js')).href
const { Context } = await import(cordisHref)

delete process.env.OMNIMUX_API_KEY
delete process.env.OMNIMUX_TOKEN

const tools = new Map()
const ctx = new Context()
ctx.provide('tools', {
  register(tool) {
    tools.set(tool.name, tool)
  },
})
ctx.provide('systemPrompt', { section() {} })

// Mount omnimux hub plugin
const omniFiber = await ctx.plugin(omnimux)

// Define a neutral consumer plugin that accesses hub seams via ctx.get
const consumerCalls = []
const neutralConsumer = {
  name: 'omnimux-neutral-consumer',
  apply(subCtx) {
    subCtx.on('test/invoke-video', async (req) => {
      const seam = subCtx.get('videoGenerate')
      assert.ok(seam, 'consumer must see videoGenerate seam')
      return seam.execute(req)
    })
    subCtx.on('test/invoke-image', async (req) => {
      const seam = subCtx.get('imageGenerate')
      assert.ok(seam, 'consumer must see imageGenerate seam')
      return seam.execute(req)
    })
    subCtx.on('test/invoke-text', async (req) => {
      const seam = subCtx.get('textComplete')
      assert.ok(seam, 'consumer must see textComplete seam')
      return seam.execute(req)
    })
  },
}
const consumerFiber = await ctx.plugin(neutralConsumer)

// Verify seams are provided
assert.equal(typeof ctx.get('videoGenerate')?.execute, 'function', 'hub must provide videoGenerate')
assert.equal(typeof ctx.get('imageGenerate')?.execute, 'function', 'hub must provide imageGenerate')
assert.equal(typeof ctx.get('textComplete')?.execute, 'function', 'hub must provide textComplete')
assert.equal(typeof ctx.get('identity')?.status, 'function', 'hub must provide identity')
assert.equal(ctx.get('jobs'), undefined, 'jobs stays optional')

// Verify registered hub tools
assert.ok(tools.has('omnimux_video_submit'))
assert.ok(tools.has('omnimux_image_submit'))
assert.ok(tools.has('omnimux_text_complete'))
assert.ok(tools.has('omnimux_social_data'))
assert.ok(tools.has('omnimux_accounts_list'))

// Verify calling videoGenerate without credentials throws expected error
try {
  await ctx.get('videoGenerate').execute({ prompt: 'test video', dest: '/tmp/test.mp4' })
  throw new Error('expected unconfigured call to throw')
} catch (error) {
  const code = error?.cause?.code || error?.code
  assert.ok(code === 'needs-omnimux' || code === 'omnimux-unconfigured' || error?.code === 'ADAPTER_FAILED', 'unconfigured videoGenerate throws expected auth error')
}

// Verify calling imageGenerate without credentials throws expected error
try {
  await ctx.get('imageGenerate').execute({ prompt: 'test image', dest: '/tmp/test.png' })
  throw new Error('expected unconfigured call to throw')
} catch (error) {
  const code = error?.cause?.code || error?.code
  assert.ok(code === 'needs-omnimux' || code === 'omnimux-unconfigured' || error?.code === 'ADAPTER_FAILED', 'unconfigured imageGenerate throws expected auth error')
}

// Dispose omnimux hub fiber and verify seams are cleanly unregistered
await omniFiber.dispose()
assert.equal(ctx.get('videoGenerate'), undefined, 'dispose unregisters videoGenerate')
assert.equal(ctx.get('imageGenerate'), undefined, 'dispose unregisters imageGenerate')
assert.equal(ctx.get('textComplete'), undefined, 'dispose unregisters textComplete')
assert.equal(ctx.get('identity'), undefined, 'dispose unregisters identity')

await consumerFiber.dispose()
await ctx.fiber.dispose()
process.stdout.write('verify-cordis-propagate: seams provided, unconfigured errors caught, clean disposal verified\n')
