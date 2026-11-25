/**
 * Browser journey for the dynamic model settings card on the official Plugins page.
 * The app QA runner provides the authenticated page and screenshot evidence.
 */
import assert from 'node:assert/strict'

export default async function modelSettingsJourney({ send, sleep, evidenceDir, io }) {
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return reply?.result?.value
  }
  const waitFor = async (expression, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return true
      await sleep(200)
    }
    return false
  }
  const result = []
  const check = (name, pass, detail) => {
    assert.equal(Boolean(pass), true, detail || name)
    result.push({ name, pass: Boolean(pass), ...(detail ? { detail } : {}) })
  }

  try {
    check('more-menu-visible', await waitFor(`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '更多')`))
    await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '更多')?.click()`)
    check('official-plugins-menu-item-visible', await waitFor(`[...document.querySelectorAll('button, [role="menuitem"]')].some((item) => item.textContent.trim() === '插件')`))
    await evaluate(`[...document.querySelectorAll('button, [role="menuitem"]')].find((item) => item.textContent.trim() === '插件')?.click()`)
    check('model-settings-item-visible', await waitFor(`!!document.querySelector('[data-plugin-item="omnimux-model-settings"]')`))
    await evaluate(`document.querySelector('[data-plugin-item="omnimux-model-settings"] button')?.click()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await sleep(500)
    check('catalog-sync-section-visible', await waitFor(`!!document.querySelector('[data-section="catalog-sync"]')`))
    check('model-groups-visible', await waitFor(`!!document.querySelector('[data-section="canvas-models"]')`))
    const observed = await evaluate(`(() => {
      const sync = document.querySelector('[data-section="catalog-sync"]')
      const card = document.querySelector('[data-section="canvas-models"]')
      return {
        syncText: sync?.textContent || '',
        modelRowCount: card?.querySelectorAll('.omnimux-models-card__row').length || 0,
        hasSyncButton: [...document.querySelectorAll('[data-section="catalog-sync"] button')]
          .some(button => button.textContent.includes('立即同步') || button.textContent.includes('Sync now')),
      }
    })()`)
    check('catalog-sync-button-visible', observed?.hasSyncButton === true, observed?.syncText)
    check('model-default-rows-rendered', Number(observed?.modelRowCount) >= 5, String(observed?.modelRowCount))

    // Core base bundles stay hidden from "Installed plugins"; shipped business
    // bundles remain visible without an Uninstall button and mount one shared
    // model settings section under `plugins.detail.section`.
    await evaluate(`document.querySelector('[data-plugin-page-header] button')?.click()`)
    check('workflow-card-visible', await waitFor(`!!document.querySelector('[data-plugin-package="omnimux-workflow"]')`))
    const baseVisibility = await evaluate(`({
      omnimux: document.querySelectorAll('[data-plugin-package="omnimux"]').length,
      sidebar: document.querySelectorAll('[data-plugin-package="dsh-better-sidebar"]').length,
    })`)
    assert.equal(baseVisibility?.omnimux, 0, 'omnimux core base bundle must stay hidden from Installed plugins')
    assert.equal(baseVisibility?.sidebar, 0, 'dsh-better-sidebar infrastructure bundle must stay hidden from Installed plugins')
    check('core-base-bundles-hidden', baseVisibility?.omnimux === 0 && baseVisibility?.sidebar === 0, JSON.stringify(baseVisibility))
    await evaluate(`(() => {
      const card = document.querySelector('[data-plugin-package="omnimux-workflow"]')
      const open = card ? [...card.querySelectorAll('button')].find((button) => button.getAttribute('role') !== 'switch') : null
      open?.click()
    })()`)
    check('workflow-bundle-detail-visible', await waitFor(`!!document.querySelector('[data-plugin-detail="omnimux-workflow"]')`))
    const bundle = await evaluate(`(() => {
      const detail = document.querySelector('[data-plugin-detail="omnimux-workflow"]')
      return detail ? {
        settingsSections: detail.querySelectorAll('.omnimux-settings-sections').length,
        catalogSync: detail.querySelectorAll('[data-section="catalog-sync"]').length,
        bundleConfig: detail.querySelectorAll('[data-slot="plugins.bundle.config"] .omnimux-settings-sections').length,
        detailSection: detail.querySelectorAll('[data-slot="plugins.detail.section"] .omnimux-settings-sections').length,
        runtime: detail.querySelectorAll('[data-section="runtime"]').length,
        canvasModels: detail.querySelectorAll('[data-section="canvas-models"]').length,
        uninstallButtons: [...detail.querySelectorAll('[data-plugin-page-header="detail"] button')]
          .filter((button) => button.textContent.trim() === '卸载' || button.textContent.trim() === 'Uninstall').length,
      } : null
    })()`)
    assert.equal(bundle?.settingsSections, 1, 'business bundle must render one shared model settings section')
    assert.equal(bundle?.catalogSync, 1, 'business bundle must render one catalog sync card')
    assert.equal(bundle?.bundleConfig, 0, 'business bundle must not double-mount through plugins.bundle.config')
    assert.equal(bundle?.detailSection, 1, 'plugins.detail.section must render the shared model settings card on sibling omnimux-* bundles')
    assert.equal(bundle?.runtime, 1, 'business bundle must render one model service card')
    assert.equal(bundle?.canvasModels, 1, 'business bundle must render one creative canvas models card')
    assert.equal(bundle?.uninstallButtons, 0, 'shipped business bundle detail must not expose an Uninstall button')
    check('bundle-model-settings-single', bundle?.settingsSections === 1 && bundle?.catalogSync === 1, JSON.stringify(bundle))
    check('business-bundle-detail-no-uninstall', bundle?.detailSection === 1 && bundle?.uninstallButtons === 0, JSON.stringify(bundle))

    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    if (screenshot?.data && evidenceDir && io?.writeFileSync) {
      io.writeFileSync(`${evidenceDir}/omnimux-bundle-single-card.png`, Buffer.from(screenshot.data, 'base64'))
    }
  } catch (error) {
    result.push({ name: 'journey-error', pass: false, detail: error instanceof Error ? error.message : String(error) })
  }
  return { assertions: result }
}
