/** Exercise the installed Next-channel dsh-plugin-manager patch against protectedBundles and shipped business bundles. */
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

test('dsh-desktop-next: installation dsh.protectedBundles protects core base bundles while shipped business bundles stay toggleable and non-removable', { skip }, async () => {
  assert.ok(
    Array.isArray(nextManifest.dsh?.protectedBundles)
      && nextManifest.dsh.protectedBundles.includes('omnimux')
      && nextManifest.dsh.protectedBundles.includes('dsh-better-sidebar'),
    'dsh-desktop-next/package.json must declare omnimux and dsh-better-sidebar in dsh.protectedBundles',
  )

  const [{ Context }, { PluginManager }] = await Promise.all([
    import(pathToFileURL(cordisEntry).href),
    import(pathToFileURL(pluginManagerEntry).href),
  ])

  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-protected-bundles-'))
  try {
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-protected-test',
      private: true,
      dependencies: {},
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
    ctx.provide('loader', { entries: () => [] }, true)
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

    const manager = new PluginManager(ctx, {
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
    })

    try {
      const bundles = await manager.listBundles()
      const byName = new Map(bundles.map(bundle => [bundle.name, bundle]))

      for (const core of ['omnimux', 'dsh-better-sidebar']) {
        const entry = byName.get(core)
        assert.ok(entry, `listBundles() must include ${core}`)
        assert.equal(entry.availability, 'installation', `${core} availability`)
        assert.equal(entry.readOnlyReason, 'management-required', `${core} must be Host-protected`)
        assert.equal(entry.removable, false, `${core} must not be removable`)

        const disableResult = await manager.setBundleEnabled(core, false)
        assert.equal(disableResult.application, 'failed', `disabling ${core} must fail`)
        assert.equal(disableResult.error?.code, 'management-required', `disabling ${core} must return management-required`)
      }

      const workflow = byName.get('omnimux-workflow')
      assert.ok(workflow, 'listBundles() must include shipped business bundle omnimux-workflow')
      assert.equal(workflow.availability, 'installation')
      assert.equal(workflow.installed, false)
      assert.equal(workflow.official, false)
      assert.equal(workflow.readOnlyReason, undefined)
      assert.equal(workflow.removable, false)
      assert.equal(workflow.enabled, true)

      const accounts = byName.get('omnimux-accounts')
      assert.ok(accounts, 'listBundles() must include shipped beta bundle omnimux-accounts')
      assert.equal(accounts.listedByDefault, false, 'beta bundle must declare listedByDefault: false')
      assert.equal(accounts.enabled, false)

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
    } finally {
      await ctx.fiber?.dispose?.()
    }
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
})
