/**
 * Browser journey verifying OmniMux plugin-manager tier visibility:
 * - Core base bundles (`omnimux`, `dsh-better-sidebar`) are hidden from Installed plugins.
 * - Model settings remain reachable under Built-in plugin settings (`omnimux-model-settings`).
 * - Shipped business bundles (`omnimux-workflow`) are listed, open detail without an Uninstall
 *   button, and render one shared model settings section via `plugins.detail.section`.
 */
import assert from 'node:assert/strict'

const OPEN_PLUGINS_PANEL_SCRIPT = `(() => {
  const clickMatching = (selector, text) => {
    const target = [...document.querySelectorAll(selector)].find((el) => el.textContent?.trim() === text)
    if (!target) return false
    target.click()
    return true
  }
  return clickMatching('button, [role="menuitem"]', '插件') || clickMatching('button, [role="menuitem"]', 'Plugins')
})()`

const INSPECT_LIST_SCRIPT = `(() => ({
  modelSettingsItem: document.querySelectorAll('[data-plugin-item="omnimux-model-settings"]').length,
  omnimuxCard: document.querySelectorAll('[data-plugin-package="omnimux"]').length,
  sidebarCard: document.querySelectorAll('[data-plugin-package="dsh-better-sidebar"]').length,
  workflowCard: document.querySelectorAll('[data-plugin-package="omnimux-workflow"]').length,
}))()`

const INSPECT_MODEL_ITEM_SCRIPT = `(() => {
  const syncEl = document.querySelector('[data-section="catalog-sync"]')
  const modelsEl = document.querySelector('[data-section="canvas-models"]')
  const syncBtn = [...(syncEl?.querySelectorAll('button') ?? [])]
    .some((btn) => /立即同步|Sync now/.test(btn.textContent || ''))
  return {
    hasSyncSection: Boolean(syncEl),
    hasModelsSection: Boolean(modelsEl),
    hasSyncButton: syncBtn,
    modelRowCount: modelsEl?.querySelectorAll('.omnimux-models-card__row').length ?? 0,
  }
})()`

const INSPECT_WORKFLOW_DETAIL_SCRIPT = `(() => {
  const root = document.querySelector('[data-plugin-detail="omnimux-workflow"]')
  if (!root) return null
  const headerButtons = [...root.querySelectorAll('[data-plugin-page-header="detail"] button')]
  return {
    totalSections: root.querySelectorAll('.omnimux-settings-sections').length,
    viaBundleConfig: root.querySelectorAll('[data-slot="plugins.bundle.config"] .omnimux-settings-sections').length,
    viaDetailSection: root.querySelectorAll('[data-slot="plugins.detail.section"] .omnimux-settings-sections').length,
    catalogSync: root.querySelectorAll('[data-section="catalog-sync"]').length,
    runtimeCard: root.querySelectorAll('[data-section="runtime"]').length,
    canvasModels: root.querySelectorAll('[data-section="canvas-models"]').length,
    uninstallCount: headerButtons.filter((btn) => /^(卸载|Uninstall)$/.test(btn.textContent?.trim() || '')).length,
  }
})()`

export default async function pluginManagerTierVisibilityJourney({ send, sleep, evidenceDir, io }) {
  const runJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return res?.result?.value
  }
  const pollUntil = async (predicateExpr, maxMs = 15000) => {
    const until = Date.now() + maxMs
    while (Date.now() < until) {
      if (await runJs(predicateExpr)) return true
      await sleep(200)
    }
    return false
  }

  const assertions = []
  const record = (name, ok, detail) => {
    assert.equal(Boolean(ok), true, detail ? `${name}: ${detail}` : name)
    assertions.push({ name, pass: true, ...(detail ? { detail } : {}) })
  }

  try {
    // Navigate into the official Plugins page via More menu when needed.
    const openedDirect = await runJs(OPEN_PLUGINS_PANEL_SCRIPT)
    if (!openedDirect) {
      record('more-menu-ready', await pollUntil(`[...document.querySelectorAll('button')].some((b) => /^(更多|More)$/.test(b.textContent?.trim() || ''))`))
      await runJs(`[...document.querySelectorAll('button')].find((b) => /^(更多|More)$/.test(b.textContent?.trim() || ''))?.click()`)
      record('plugins-entry-ready', await pollUntil(`[...document.querySelectorAll('button, [role="menuitem"]')].some((b) => /^(插件|Plugins)$/.test(b.textContent?.trim() || ''))`))
      await runJs(OPEN_PLUGINS_PANEL_SCRIPT)
    }

    // 1. Verify list visibility: model settings item present, core bases hidden, workflow card visible.
    record('list-loaded', await pollUntil(`!!document.querySelector('[data-plugin-package="omnimux-workflow"]')`))
    const listSnapshot = await runJs(INSPECT_LIST_SCRIPT)
    assert.equal(listSnapshot?.modelSettingsItem, 1, 'built-in model settings entry must remain visible')
    assert.equal(listSnapshot?.omnimuxCard, 0, 'omnimux core base bundle must stay hidden from Installed plugins')
    assert.equal(listSnapshot?.sidebarCard, 0, 'dsh-better-sidebar infrastructure bundle must stay hidden from Installed plugins')
    assert.equal(listSnapshot?.workflowCard, 1, 'shipped business bundle omnimux-workflow must appear in Installed plugins')
    record('tier-visibility-list', true, JSON.stringify(listSnapshot))

    // 2. Open built-in model settings item and verify full card renders.
    await runJs(`document.querySelector('[data-plugin-item="omnimux-model-settings"] button')?.click()`)
    record('model-settings-rendered', await pollUntil(`!!document.querySelector('[data-section="canvas-models"]')`))
    const itemSnapshot = await runJs(INSPECT_MODEL_ITEM_SCRIPT)
    assert.equal(itemSnapshot?.hasSyncSection, true, 'catalog sync section must render in built-in model settings')
    assert.equal(itemSnapshot?.hasSyncButton, true, 'sync button must render in built-in model settings')
    assert.ok(Number(itemSnapshot?.modelRowCount) >= 5, `expected >= 5 model rows, got ${itemSnapshot?.modelRowCount}`)
    record('builtin-model-settings', true, JSON.stringify(itemSnapshot))

    // 3. Return to list and open shipped business bundle detail; confirm no Uninstall button and single settings section.
    await runJs(`document.querySelector('[data-plugin-page-header] button')?.click()`)
    record('returned-to-list', await pollUntil(`!!document.querySelector('[data-plugin-package="omnimux-workflow"]')`))
    await runJs(`(() => {
      const card = document.querySelector('[data-plugin-package="omnimux-workflow"]')
      const openBtn = card ? [...card.querySelectorAll('button')].find((b) => b.getAttribute('role') !== 'switch') : null
      openBtn?.click()
    })()`)
    record('workflow-detail-opened', await pollUntil(`!!document.querySelector('[data-plugin-detail="omnimux-workflow"]')`))
    const detailSnapshot = await runJs(INSPECT_WORKFLOW_DETAIL_SCRIPT)
    assert.equal(detailSnapshot?.totalSections, 1, 'business bundle must render exactly one shared model settings section')
    assert.equal(detailSnapshot?.viaBundleConfig, 0, 'business bundle must not mount through plugins.bundle.config')
    assert.equal(detailSnapshot?.viaDetailSection, 1, 'business bundle must render shared section through plugins.detail.section')
    assert.equal(detailSnapshot?.catalogSync, 1, 'business bundle must render one catalog sync card')
    assert.equal(detailSnapshot?.runtimeCard, 1, 'business bundle must render one runtime card')
    assert.equal(detailSnapshot?.canvasModels, 1, 'business bundle must render one canvas models card')
    assert.equal(detailSnapshot?.uninstallCount, 0, 'shipped business bundle detail must not expose an Uninstall button')
    record('business-bundle-detail-no-uninstall', true, JSON.stringify(detailSnapshot))

    const capture = await send('Page.captureScreenshot', { format: 'png' })
    if (capture?.data && evidenceDir && io?.writeFileSync) {
      io.writeFileSync(`${evidenceDir}/plugin-manager-tier-visibility.png`, Buffer.from(capture.data, 'base64'))
    }
  } catch (err) {
    assertions.push({ name: 'journey-error', pass: false, detail: err instanceof Error ? err.message : String(err) })
  }
  return { assertions }
}
