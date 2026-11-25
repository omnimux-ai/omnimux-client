/** Exercise the installed Next-channel dsh-plugin-manager patch against protectedBundles (bundle + row level) and Dev overrides. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const appRoot = resolve(import.meta.dirname, '..')
const nextDir = resolve(appRoot, 'dsh-desktop-next')
const installAnchor = join(nextDir, 'package.json')
const nextManifest = JSON.parse(readFileSync(installAnchor, 'utf8'))
const pluginTiers = JSON.parse(readFileSync(resolve(appRoot, 'config/plugin-tiers.json'), 'utf8'))

function resolveInNext(specifier) {
  try {
    return createRequire(installAnchor).resolve(specifier)
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${specifier}'`)) return undefined
    throw error
  }
}

const pluginManagerEntry = resolveInNext('@deepseek-ai/dsh-plugin-manager')
const cordisEntry = resolveInNext('@deepseek-ai/cordis')
const skip = (pluginManagerEntry === undefined || cordisEntry === undefined)
  && 'runtime dependencies are not installed; run `corepack yarn install` to exercise dsh-plugin-manager'

const MANAGER_OPTIONS = {
  outputBytes: 64 * 1024,
  lockWaitMs: 5000,
  inspectTimeoutMs: 5000,
  githubConnectionTimeoutMs: 5000,
  gitTransportTimeoutMs: 5000,
  idleTimeoutMs: 5000,
  pnpmCommand: 'pnpm',
  versionListLimit: 10,
  versionLookupConcurrency: 2,
  registry: undefined,
  fallbackRegistries: [],
  detailMaxBytes: 64 * 1024,
  detailImageMaxBytes: 64 * 1024,
  detailNpmFileSources: [],
  detailFetchTimeoutMs: 5000,
}

function makeLoaderEntries() {
  const includeParent = { tree: { ctx: { baseUrl: undefined, fiber: { entry: { id: 'include' } } } } }
  return [
    { id: 'include:omnimux', disabled: false, options: { id: 'omnimux', name: 'omnimux' }, parent: includeParent, fiber: { state: 2 } },
    { id: 'include:better-sidebar', disabled: false, options: { id: 'better-sidebar', name: 'dsh-better-sidebar' }, parent: includeParent, fiber: { state: 2 } },
    { id: 'include:omnimux-workflow', disabled: false, options: { id: 'omnimux-workflow', name: 'omnimux-workflow' }, parent: includeParent, fiber: { state: 2 } },
  ]
}

async function withManager(dependencies, run) {
  const [{ Context }, { PluginManager }] = await Promise.all([
    import(pathToFileURL(cordisEntry).href),
    import(pathToFileURL(pluginManagerEntry).href),
  ])
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-protected-bundles-'))
  try {
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-protected-test',
      private: true,
      dependencies,
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            'dsh-better-sidebar',
            'omnimux',
            'omnimux-workflow',
          ],
        },
      },
    }, null, 2) + '\n', 'utf8')

    const patchPath = join(profileDir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n', 'utf8')
    const ctx = new Context()
    const loaderEntries = makeLoaderEntries()
    ctx.provide('loader', { entries: () => loaderEntries }, true)
    ctx.provide('profileContext', {
      dir: profileDir,
      name: 'test',
      patchPath,
      installAnchor,
      cwd: profileDir,
      home: profileDir,
      startedBundles: ['dsh-better-sidebar', 'omnimux', 'omnimux-workflow'],
      overlays: [],
      telemetryDisabledEnv: undefined,
    }, true)

    const manager = new PluginManager(ctx, MANAGER_OPTIONS)
    try {
      await run({ manager, profileDir })
    } finally {
      await ctx.fiber?.dispose?.()
    }
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
}

test('dsh-desktop-next: dsh.protectedBundles stays aligned with plugin-tiers.json and guards both bundles and plugin rows on fresh install', { skip }, async () => {
  const expectedProtected = [...new Set(['omnimux', ...pluginTiers.tiers.infrastructure])]
  assert.deepEqual(
    nextManifest.dsh?.protectedBundles,
    expectedProtected,
    'dsh-desktop-next/package.json#dsh.protectedBundles must match ["omnimux", ...plugin-tiers.json#tiers.infrastructure]',
  )

  await withManager({}, async ({ manager, profileDir }) => {
    const bundles = await manager.listBundles()
    const byName = new Map(bundles.map(bundle => [bundle.name, bundle]))

    for (const core of expectedProtected) {
      const entry = byName.get(core)
      assert.ok(entry, `listBundles() must include ${core}`)
      assert.equal(entry.availability, 'installation', `${core} availability`)
      assert.equal(entry.installed, false, `${core} installed on fresh install`)
      assert.equal(entry.readOnlyReason, 'management-required', `${core} must be Host-protected`)
      assert.equal(entry.removable, false, `${core} must not be removable`)

      const disableResult = await manager.setBundleEnabled(core, false)
      assert.equal(disableResult.application, 'failed', `disabling ${core} must fail`)
      assert.equal(disableResult.error?.code, 'management-required', `disabling ${core} must return management-required`)

      const removeCoreResult = await manager.removeBundle(core)
      assert.equal(removeCoreResult.application, 'failed', `removing ${core} must fail`)
      assert.equal(removeCoreResult.error?.code, 'not-removable', `removing ${core} must return not-removable`)
    }

    // Row-level protection: listPlugins() and setPluginEnabled() (also backing Agent plugin_manager tool)
    // must guard core base plugin entries while keeping shipped business plugin rows addressable.
    const plugins = await manager.listPlugins()
    const pluginById = new Map(plugins.map(row => [row.entryId, row]))
    for (const protectedEntryId of ['include:omnimux', 'include:better-sidebar']) {
      const row = pluginById.get(protectedEntryId)
      assert.ok(row, `listPlugins() must include ${protectedEntryId}`)
      assert.equal(row.readOnlyReason, 'management-required', `${protectedEntryId} row must be Host-protected`)
      assert.equal(row.patchId, undefined, `${protectedEntryId} row must not expose a writable patchId`)

      const disableRowResult = await manager.setPluginEnabled(protectedEntryId, false)
      assert.equal(disableRowResult.application, 'failed', `disabling row ${protectedEntryId} must fail`)
      assert.equal(disableRowResult.error?.code, 'management-required', `disabling row ${protectedEntryId} must return management-required`)
    }

    const workflowRow = pluginById.get('include:omnimux-workflow')
    assert.ok(workflowRow, 'listPlugins() must include include:omnimux-workflow')
    assert.equal(workflowRow.readOnlyReason, undefined, 'business plugin row must remain toggleable')
    assert.equal(workflowRow.patchId, 'omnimux-workflow')

    const workflow = byName.get('omnimux-workflow')
    assert.ok(workflow, 'listBundles() must include shipped business bundle omnimux-workflow')
    assert.equal(workflow.availability, 'installation')
    assert.equal(workflow.installed, false)
    assert.equal(workflow.official, false)
    assert.equal(workflow.readOnlyReason, undefined)
    assert.equal(workflow.removable, false)
    assert.equal(workflow.enabled, true)

    for (const beta of pluginTiers.tiers.beta) {
      const betaBundle = byName.get(beta)
      assert.ok(betaBundle, `listBundles() must include shipped beta bundle ${beta}`)
      assert.equal(betaBundle.listedByDefault, false, `${beta} must declare listedByDefault: false`)
      assert.equal(betaBundle.enabled, false)
    }

    // Shipped business bundle can be disabled and re-enabled in profile manifest.
    const disabled = await manager.setBundleEnabled('omnimux-workflow', false)
    assert.notEqual(disabled.application, 'failed', `disabling omnimux-workflow must succeed: ${JSON.stringify(disabled)}`)
    const manifestAfterDisable = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    assert.equal(manifestAfterDisable.dsh.profile.bundles.includes('omnimux-workflow'), false)

    const reenabled = await manager.setBundleEnabled('omnimux-workflow', true)
    assert.notEqual(reenabled.application, 'failed', `re-enabling omnimux-workflow must succeed: ${JSON.stringify(reenabled)}`)
    const manifestAfterEnable = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    assert.equal(manifestAfterEnable.dsh.profile.bundles.includes('omnimux-workflow'), true)

    // Shipped business bundle must refuse uninstall on Host.
    const removeResult = await manager.removeBundle('omnimux-workflow')
    assert.equal(removeResult.application, 'failed', 'removing shipped omnimux-workflow must fail')
    assert.equal(removeResult.error?.code, 'not-removable', 'removing shipped omnimux-workflow must return not-removable')
  })
})

test('dsh-desktop-next: Dev omnimux:sync profile dependencies keep core bundles protected and shipped business bundles non-removable', { skip }, async () => {
  await withManager({
    omnimux: nextManifest.dependencies.omnimux,
    'dsh-better-sidebar': nextManifest.dependencies['dsh-better-sidebar'],
    'omnimux-workflow': nextManifest.dependencies['omnimux-workflow'],
  }, async ({ manager }) => {
    const bundles = await manager.listBundles()
    const byName = new Map(bundles.map(bundle => [bundle.name, bundle]))

    for (const core of ['omnimux', 'dsh-better-sidebar']) {
      const entry = byName.get(core)
      assert.ok(entry, `Dev listBundles() must include ${core}`)
      assert.equal(entry.installed, true, `Dev ${core} must report installed=true`)
      assert.equal(entry.availability, 'installation', `Dev ${core} must stay availability=installation`)
      assert.equal(entry.removable, false, `Dev ${core} must stay removable=false`)
      assert.equal(entry.readOnlyReason, 'management-required', `Dev ${core} must stay management-required`)

      const disableCore = await manager.setBundleEnabled(core, false)
      assert.equal(disableCore.application, 'failed')
      assert.equal(disableCore.error?.code, 'management-required')

      const removeCore = await manager.removeBundle(core)
      assert.equal(removeCore.application, 'failed')
      assert.equal(removeCore.error?.code, 'not-removable')
    }

    const workflow = byName.get('omnimux-workflow')
    assert.ok(workflow, 'Dev listBundles() must include omnimux-workflow')
    assert.equal(workflow.installed, true, 'Dev omnimux-workflow must report installed=true')
    assert.equal(workflow.availability, 'installation', 'Dev omnimux-workflow must stay availability=installation')
    assert.equal(workflow.removable, false, 'Dev omnimux-workflow must stay removable=false')
    assert.equal(workflow.readOnlyReason, undefined, 'Dev omnimux-workflow must stay toggleable')

    const removeWorkflow = await manager.removeBundle('omnimux-workflow')
    assert.equal(removeWorkflow.application, 'failed')
    assert.equal(removeWorkflow.error?.code, 'not-removable')

    for (const protectedEntryId of ['include:omnimux', 'include:better-sidebar']) {
      const disableRow = await manager.setPluginEnabled(protectedEntryId, false)
      assert.equal(disableRow.application, 'failed')
      assert.equal(disableRow.error?.code, 'management-required')
    }
  })
})
