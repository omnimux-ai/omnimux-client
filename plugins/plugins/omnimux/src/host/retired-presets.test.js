import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PRODUCT_PRESET_ID,
  RETIRED_PRESET_IDS,
  installRetiredPresetRedirect,
  isRetiredPresetId,
  mountRetiredPresetRedirect,
} from './retired-presets.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(HERE, '../../../../presets/manifest.json')

function notFoundError(id) {
  const err = new Error(`Unknown agent preset: ${id}`)
  err.code = 'agent-preset/not-found'
  err.details = { agentPreset: id }
  return err
}

function createFakeRegistry(registered = ['omni-agent', 'cordis'], defaultId = 'omni-agent') {
  const known = new Set(registered)
  const calls = []
  return {
    calls,
    defaultId,
    async list() {
      return [...known].map((id) => ({ id }))
    },
    async remoteExportList() {
      return { presets: [...known].map((id) => ({ id, isDefault: id === this.defaultId })) }
    },
    async resolve(id) {
      const wanted = id ?? this.defaultId
      calls.push(['resolve', wanted])
      if (!known.has(wanted)) throw notFoundError(wanted)
      return { id: wanted }
    },
    async acquireScope(id) {
      const wanted = id ?? this.defaultId
      calls.push(['acquireScope', wanted])
      if (!known.has(wanted)) throw notFoundError(wanted)
      return { key: wanted }
    },
    async mount(agentCtx, id) {
      const wanted = id ?? this.defaultId
      calls.push(['mount', agentCtx, wanted])
      if (!known.has(wanted)) throw notFoundError(wanted)
      return { id: wanted }
    },
    async recompose(agentCtx, id) {
      const wanted = id ?? this.defaultId
      calls.push(['recompose', agentCtx, wanted])
      if (!known.has(wanted)) throw notFoundError(wanted)
      return { id: wanted }
    },
  }
}

/**
 * Mimics `@deepseek-ai/cordis` `createTraceable` Service Proxy:
 * - exposes the raw target on `Symbol.for('cordis.original')`
 * - returns a brand-new shadow function Proxy on every method read
 * - delegates writes to the target instance.
 */
function wrapLikeCordisServiceProxy(target) {
  const CORDIS_ORIGINAL = Symbol.for('cordis.original')
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === CORDIS_ORIGINAL) return obj
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value === 'function') {
        return new Proxy(value, {
          apply(fn, thisArg, args) {
            return Reflect.apply(fn, thisArg === receiver ? obj : thisArg, args)
          },
        })
      }
      return value
    },
    set(obj, prop, value) {
      if (prop === CORDIS_ORIGINAL) return false
      return Reflect.set(obj, prop, value, obj)
    },
  })
}

describe('retired-presets runtime redirect', () => {
  it('stays aligned with presets/manifest.json retiredPresetRedirects', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    assert.deepEqual([...RETIRED_PRESET_IDS], manifest.retiredPresetRedirects)
  })

  it('recognizes all retired presets and expert-* subagents while keeping active presets untouched', () => {
    for (const id of RETIRED_PRESET_IDS) {
      assert.equal(isRetiredPresetId(id), true, `expected ${id} to be retired`)
    }
    assert.equal(isRetiredPresetId('expert-video'), true)
    assert.equal(isRetiredPresetId('expert-ad-creative'), true)
    assert.equal(isRetiredPresetId('omni-agent'), false)
    assert.equal(isRetiredPresetId('cordis'), false)
    assert.equal(isRetiredPresetId('custom-user-agent'), false)
    assert.equal(isRetiredPresetId(''), false)
    assert.equal(isRetiredPresetId(null), false)
  })

  it('keeps list() and remoteExportList() strictly unchanged (only omni-agent and cordis)', async () => {
    const registry = createFakeRegistry(['omni-agent', 'cordis'])
    const dispose = installRetiredPresetRedirect(registry)
    try {
      const list = await registry.list()
      const exported = await registry.remoteExportList()
      assert.deepEqual(list.map((p) => p.id), ['omni-agent', 'cordis'])
      assert.deepEqual(exported.presets.map((p) => p.id), ['omni-agent', 'cordis'])
    } finally {
      dispose()
    }
  })

  it('redirects retired preset IDs across resolve, acquireScope, mount and recompose', async () => {
    const registry = createFakeRegistry(['omni-agent', 'cordis'])
    const dispose = installRetiredPresetRedirect(registry)
    try {
      for (const retiredId of ['tiktok-agent', 'instagram-agent', 'standard', 'drama-agent', 'expert-video']) {
        assert.deepEqual(await registry.resolve(retiredId), { id: DEFAULT_PRODUCT_PRESET_ID })
        assert.deepEqual(await registry.acquireScope(retiredId), { key: DEFAULT_PRODUCT_PRESET_ID })
        assert.deepEqual(await registry.mount('ctx-a', retiredId), { id: DEFAULT_PRODUCT_PRESET_ID })
        assert.deepEqual(await registry.recompose('ctx-b', retiredId), { id: DEFAULT_PRODUCT_PRESET_ID })
      }
      assert.deepEqual(await registry.resolve('cordis'), { id: 'cordis' })
    } finally {
      dispose()
    }
  })

  it('does not swallow unknown user-authored preset errors or non-not-found errors', async () => {
    const registry = createFakeRegistry(['omni-agent', 'cordis'])
    const dispose = installRetiredPresetRedirect(registry)
    try {
      await assert.rejects(
        () => registry.resolve('my-missing-custom-preset'),
        (err) => err?.code === 'agent-preset/not-found',
      )
      await assert.rejects(
        () => registry.mount('ctx', 'unknown-agent'),
        (err) => err?.code === 'agent-preset/not-found',
      )
    } finally {
      dispose()
    }
  })

  it('honors a registered preset if explicitly present and restores original methods on dispose', async () => {
    const registry = createFakeRegistry(['omni-agent', 'cordis', 'standard'])
    const originalResolve = registry.resolve
    const dispose = installRetiredPresetRedirect(registry)
    assert.deepEqual(await registry.resolve('standard'), { id: 'standard' })
    dispose()
    assert.equal(registry.resolve, originalResolve)
    const emptyRegistry = createFakeRegistry(['omni-agent', 'cordis'])
    const disposeEmpty = installRetiredPresetRedirect(emptyRegistry)
    disposeEmpty()
    await assert.rejects(
      () => emptyRegistry.resolve('tiktok-agent'),
      (err) => err?.code === 'agent-preset/not-found',
    )
  })

  it('mounts cleanly through ctx.inject and registers HMR cleanup effect', async () => {
    const registry = createFakeRegistry(['omni-agent', 'cordis'])
    let cleanup = null
    const ctx = {
      inject(deps, cb) {
        assert.deepEqual(deps, ['agentPresets'])
        cb({
          agentPresets: registry,
          effect(factory) {
            cleanup = factory()
          },
        })
      },
    }
    mountRetiredPresetRedirect(ctx)
    assert.deepEqual(await registry.resolve('tiktok-agent'), { id: 'omni-agent' })
    assert.equal(typeof cleanup, 'function')
    cleanup()
    await assert.rejects(
      () => registry.resolve('tiktok-agent'),
      (err) => err?.code === 'agent-preset/not-found',
    )
  })

  it('redirects implicit default lookups and marks omni-agent default when legacy defaultId is retired', async () => {
    const registry = createFakeRegistry(['omni-agent', 'cordis'], 'standard')
    const dispose = installRetiredPresetRedirect(registry)
    try {
      assert.deepEqual(await registry.resolve(), { id: DEFAULT_PRODUCT_PRESET_ID })
      assert.deepEqual(await registry.acquireScope(), { key: DEFAULT_PRODUCT_PRESET_ID })
      assert.deepEqual(await registry.mount('ctx-implicit'), { id: DEFAULT_PRODUCT_PRESET_ID })
      const exported = await registry.remoteExportList()
      assert.deepEqual(exported.presets, [
        { id: 'omni-agent', isDefault: true },
        { id: 'cordis', isDefault: false },
      ])
    } finally {
      dispose()
    }
  })

  it('preserves explicit cordis or unknown custom defaultId in remoteExportList', async () => {
    const cordisDefault = createFakeRegistry(['omni-agent', 'cordis'], 'cordis')
    const disposeCordis = installRetiredPresetRedirect(cordisDefault)
    try {
      const exported = await cordisDefault.remoteExportList()
      assert.deepEqual(exported.presets, [
        { id: 'omni-agent', isDefault: false },
        { id: 'cordis', isDefault: true },
      ])
    } finally {
      disposeCordis()
    }

    const customDefault = createFakeRegistry(['omni-agent', 'cordis'], 'my-custom-agent')
    const disposeCustom = installRetiredPresetRedirect(customDefault)
    try {
      await assert.rejects(
        () => customDefault.resolve(),
        (err) => err?.code === 'agent-preset/not-found',
      )
      const exported = await customDefault.remoteExportList()
      assert.deepEqual(exported.presets, [
        { id: 'omni-agent', isDefault: false },
        { id: 'cordis', isDefault: false },
      ])
    } finally {
      disposeCustom()
    }
  })

  it('reads DSH RemoteError.details.agentPreset even when this.defaultId is absent or changed', async () => {
    const calls = []
    const registry = {
      defaultId: undefined,
      async resolve(id) {
        calls.push(id)
        if (id === 'omni-agent') return { id: 'omni-agent' }
        throw notFoundError('tiktok-agent')
      },
    }
    const dispose = installRetiredPresetRedirect(registry)
    try {
      assert.deepEqual(await registry.resolve(), { id: DEFAULT_PRODUCT_PRESET_ID })
      assert.deepEqual(calls, [undefined, DEFAULT_PRODUCT_PRESET_ID])
    } finally {
      dispose()
    }
  })

  it('unwraps Cordis Service Proxy so dispose restores prototype methods and HMR cycles do not stack wrappers', async () => {
    class PrototypeRegistry {
      constructor() {
        this.known = new Set(['omni-agent', 'cordis'])
        this.defaultId = 'standard'
        this.calls = []
      }
      async resolve(id) {
        const wanted = id ?? this.defaultId
        this.calls.push(wanted)
        if (!this.known.has(wanted)) throw notFoundError(wanted)
        return { id: wanted }
      }
      async remoteExportList() {
        return { presets: [...this.known].map((id) => ({ id, isDefault: id === this.defaultId })) }
      }
    }

    const rawInstance = new PrototypeRegistry()
    const proxy = wrapLikeCordisServiceProxy(rawInstance)

    // Simulate 3 HMR mount/dispose cycles through the Cordis Service Proxy
    for (let cycle = 0; cycle < 3; cycle++) {
      rawInstance.calls.length = 0
      const dispose = installRetiredPresetRedirect(proxy)
      assert.equal(Object.hasOwn(rawInstance, 'resolve'), true)
      assert.equal(Object.hasOwn(rawInstance, 'remoteExportList'), true)

      assert.deepEqual(await proxy.resolve('tiktok-agent'), { id: DEFAULT_PRODUCT_PRESET_ID })
      assert.deepEqual(rawInstance.calls, ['tiktok-agent', DEFAULT_PRODUCT_PRESET_ID])

      const exported = await proxy.remoteExportList()
      assert.deepEqual(exported.presets, [
        { id: 'omni-agent', isDefault: true },
        { id: 'cordis', isDefault: false },
      ])

      dispose()
      assert.equal(Object.hasOwn(rawInstance, 'resolve'), false)
      assert.equal(Object.hasOwn(rawInstance, 'remoteExportList'), false)
      await assert.rejects(
        () => proxy.resolve('tiktok-agent'),
        (err) => err?.code === 'agent-preset/not-found',
      )
    }
  })
})
