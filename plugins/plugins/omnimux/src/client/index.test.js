import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const ENTRY_PATH = join(here, 'index.js')
const ENTRY_SOURCE = readFileSync(ENTRY_PATH, 'utf8')

/**
 * Collect the binding names each import declaration needs from its module. The
 * regression harness stubs every dependency so it can execute the real client
 * entry without a browser renderer, while the generation-feedback imports stay
 * as free identifiers exactly like the broken production bundle.
 */
function collectImportSpecs(source) {
  const specs = new Map()
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(re)) {
    const [, defaultName, named, namespace, moduleId] = match
    if (!defaultName && !named && !namespace) continue
    let entry = specs.get(moduleId)
    if (!entry) {
      entry = { hasDefault: false, names: new Set() }
      specs.set(moduleId, entry)
    }
    if (defaultName) entry.hasDefault = true
    if (named) {
      for (const part of named.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim()
        if (name) entry.names.add(name)
      }
    }
  }
  return specs
}

function stubModules(source, overrides) {
  const modules = new Map()
  for (const [moduleId, entry] of collectImportSpecs(source)) {
    const module = {}
    for (const name of entry.names) module[name] = () => undefined
    if (entry.hasDefault) module.default = function Stub() { return null }
    Object.assign(module, overrides.get(moduleId))
    modules.set(moduleId, module)
  }
  return modules
}

function createHarness(source) {
  const spies = {
    createGenerationFeedback: 0,
    feedbackDisposed: 0,
    getGlobalMediaViewerStore: 0,
    options: null,
  }
  const store = { getSnapshot: () => ({ generationTasks: [] }), updateGeneration: () => {} }
  const modules = stubModules(source, new Map([
    ['./media-viewer/generation-feedback.js', {
      createGenerationFeedback(options) {
        spies.createGenerationFeedback += 1
        spies.options = options
        return { dispose() { spies.feedbackDisposed += 1 } }
      },
    }],
    ['./media-viewer/media-viewer-store.js', {
      getGlobalMediaViewerStore() {
        spies.getGlobalMediaViewerStore += 1
        return store
      },
    }],
    ['react', { createElement: () => null }],
    ['./api.js', { getStatusCached: () => Promise.resolve({}) }],
    ['./chrome.js', { installHubChrome: () => (key) => key }],
    ['./workbench.js', { installWorkbenchGlobal: () => ({ bind() {} }) }],
    ['./attachments/store.ts', {
      getGlobalAttachmentStore: () => ({
        installGlobalEvents: () => () => {},
        getActiveSessionId: () => null,
        getSnapshot: () => [],
        removeAttachment() {},
      }),
    }],
    ['./composer-add/attachment-admission.js', { createAttachmentAdmission: () => ({ dispose() {} }) }],
    ['./attachments/clipComposer.js', { createClipComposer: () => undefined }],
    ['./composer-add/commands.js', { installComposerAddCommands: () => () => {} }],
    ['./composer-add/install.js', { installComposerAddCapture: () => ({ dispose() {} }) }],
    ['./events-client.js', {
      createEventsClient: () => ({ connect() {}, disconnect() {} }),
      installHubEventsGlobal: () => () => {},
    }],
    ['../hmr/client.js', { installWebSocketHmr: () => ({ dispose() {} }) }],
  ]))
  const fakeRequire = (moduleId) => {
    if (!modules.has(moduleId)) throw new Error(`unexpected client entry import: ${moduleId}`)
    return modules.get(moduleId)
  }

  const effects = []
  function makeEffect(fn, label) {
    const effect = { label, disposed: false }
    const cleanup = fn()
    effect.dispose = () => {
      if (effect.disposed) return
      effect.disposed = true
      cleanup?.()
    }
    effects.push(effect)
    return effect
  }
  function createConnectionCtx() {
    const connectionEffects = []
    return {
      connection: { openWebSocket: () => ({ close() {} }) },
      effect(fn, label) {
        const effect = makeEffect(fn, label)
        connectionEffects.push(effect)
        return effect
      },
      inject(deps, callback) {
        if (!deps.includes('sessions')) return { dispose() {} }
        const innerEffects = []
        const innerCtx = {
          sessions: {},
          effect(fn, label) {
            const effect = makeEffect(fn, label)
            innerEffects.push(effect)
            return effect
          },
        }
        callback(innerCtx)
        return { dispose() { innerEffects.forEach((effect) => effect.dispose()) } }
      },
      disposeAll() { connectionEffects.forEach((effect) => effect.dispose()) },
    }
  }

  let connectionBinding = null
  const ctx = {
    slots: {
      inject() { return { dispose() {} } },
      register() { return { dispose() {} } },
    },
    locale: { register() {}, bind() { return (key) => key } },
    effect(fn, label) { return makeEffect(fn, label) },
    inject(deps, callback) {
      if (deps.length === 1 && deps[0] === 'connection') {
        const connectionCtx = createConnectionCtx()
        callback(connectionCtx)
        connectionBinding = { dispose: () => connectionCtx.disposeAll() }
        return connectionBinding
      }
      return { dispose() {} }
    },
    get() { return undefined },
  }

  const moduleObj = { exports: {} }
  const compiled = transformSync(source, {
    format: 'cjs',
    loader: 'js',
    target: 'node22',
    sourcefile: ENTRY_PATH,
  })
  new Function('module', 'exports', 'require', 'window', 'document', compiled.code)(
    moduleObj,
    moduleObj.exports,
    fakeRequire,
    {},
    { getElementById: () => null },
  )

  return {
    apply() { moduleObj.exports.apply(ctx) },
    disposeConnection() {
      assert.ok(connectionBinding, 'client entry must register a connection injection')
      connectionBinding.dispose()
    },
    spies,
    store,
  }
}

function withoutImport(source, symbol, moduleId) {
  const line = `import { ${symbol} } from '${moduleId}'\n`
  assert.ok(source.includes(line), `fixture must contain import line: ${line.trim()}`)
  return source.replace(line, '')
}

test('client entry sessions injection initializes generation feedback and disposes it', () => {
  const harness = createHarness(ENTRY_SOURCE)
  harness.apply()

  assert.equal(harness.spies.createGenerationFeedback, 1)
  assert.equal(harness.spies.getGlobalMediaViewerStore, 1)
  assert.equal(harness.spies.feedbackDisposed, 0)
  assert.ok(harness.spies.options, 'createGenerationFeedback must receive its options')
  assert.equal(harness.spies.options.store, harness.store)
  assert.equal(typeof harness.spies.options.sessions, 'object')
  assert.equal(typeof harness.spies.options.getUiContext, 'function')
  assert.equal(typeof harness.spies.options.getSubmittedCanvasText, 'function')
  assert.equal(typeof harness.spies.options.subscribeSubmittedCanvasText, 'function')

  harness.disposeConnection()
  assert.equal(harness.spies.feedbackDisposed, 1)
})

test('client entry regression fails without the createGenerationFeedback import', () => {
  const broken = withoutImport(ENTRY_SOURCE, 'createGenerationFeedback', './media-viewer/generation-feedback.js')
  const harness = createHarness(broken)
  assert.throws(
    () => harness.apply(),
    (error) => error instanceof ReferenceError && /createGenerationFeedback is not defined/.test(error.message),
  )
})

test('client entry regression fails without the getGlobalMediaViewerStore import', () => {
  const broken = withoutImport(ENTRY_SOURCE, 'getGlobalMediaViewerStore', './media-viewer/media-viewer-store.js')
  const harness = createHarness(broken)
  assert.throws(
    () => harness.apply(),
    (error) => error instanceof ReferenceError && /getGlobalMediaViewerStore is not defined/.test(error.message),
  )
})
