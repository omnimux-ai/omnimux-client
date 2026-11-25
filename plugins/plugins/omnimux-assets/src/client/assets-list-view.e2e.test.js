import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { ASSETS_CSS } from './styles.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRequire = createRequire(join(here, '..', '..', 'package.json'))

const HOST_THEME_CSS = `
:where(.omnimux-assets-list-wrap, .omnimux-assets-list-table) { box-sizing: content-box; }
body {
  --dsw-alias-bg-base: rgb(255, 255, 255);
  --dsw-alias-bg-layer-1: rgb(255, 255, 255);
  --dsw-alias-bg-layer-2: rgb(255, 255, 255);
  --dsw-alias-bg-module-platform: rgb(245, 246, 247);
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);
  --dsw-alias-border-l3: rgba(0, 0, 0, 0.12);
  --dsw-alias-border-l4: rgba(0, 0, 0, 0.16);
  --dsw-alias-brand-primary: rgb(15, 17, 21);
  --dsw-alias-button-primary-fill: rgb(15, 17, 21);
  --dsw-alias-button-primary-hover: rgb(67, 69, 74);
  --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);
  --dsw-alias-interactive-bg-active: rgba(38, 49, 72, 0.1);
  --dsw-alias-interactive-bg-hover-danger: rgba(236, 19, 19, 0.05);
  --dsw-alias-label-primary: rgb(15, 17, 21);
  --dsw-alias-label-primary-foreground: rgb(255, 255, 255);
  --dsw-alias-label-secondary: rgb(97, 102, 107);
  --dsw-alias-label-tertiary: rgb(129, 133, 140);
  --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  --dsw-alias-state-warn-label: rgb(221, 134, 41);
  --dsw-alias-state-warn-tertiary: rgb(254, 245, 231);
  --dsw-alias-state-error-primary: rgb(236, 19, 19);
  --dsw-shadow-lv3: 0 12px 32px rgba(15, 17, 21, 0.16);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
}
body[data-ds-dark-theme] {
  --dsw-alias-bg-base: rgb(21, 21, 23);
  --dsw-alias-bg-layer-1: rgb(35, 35, 36);
  --dsw-alias-bg-layer-2: rgb(44, 44, 46);
  --dsw-alias-bg-module-platform: rgb(53, 54, 56);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-border-l4: rgba(255, 255, 255, 0.2);
  --dsw-alias-brand-primary: rgb(249, 250, 251);
  --dsw-alias-button-primary-fill: rgb(249, 250, 251);
  --dsw-alias-button-primary-hover: rgb(235, 238, 242);
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.14);
  --dsw-alias-interactive-bg-hover-danger: rgba(242, 90, 90, 0.15);
  --dsw-alias-label-primary: rgb(249, 250, 251);
  --dsw-alias-label-primary-foreground: rgb(15, 17, 21);
  --dsw-alias-label-secondary: rgb(207, 211, 214);
  --dsw-alias-label-tertiary: rgb(173, 178, 184);
  --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  --dsw-alias-state-warn-label: rgb(245, 158, 11);
  --dsw-alias-state-warn-tertiary: rgb(39, 36, 31);
  --dsw-alias-state-error-primary: rgb(242, 90, 90);
  --dsw-shadow-lv3: 0 14px 36px rgba(0, 0, 0, 0.52);
}
`

const PORTRAIT_DATA_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320"><rect width="240" height="320" fill="#3a4f7a"/><circle cx="120" cy="110" r="46" fill="#f2d2c4"/></svg>',
)

async function buildBrowserBundle() {
  const esbuild = pluginRequire('esbuild')
  const entry = `
    import React, { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import { AssetGrid } from ${JSON.stringify(join(here, 'AssetGrid.jsx'))}
    import { zh } from ${JSON.stringify(join(here, 'locales.js'))}

    const PORTRAIT = ${JSON.stringify(PORTRAIT_DATA_URL)}
    const ASSETS = [
      {
        id: 'a1',
        name: '科技 Vlogger 粉衣女郎 Yuna',
        type: 'character',
        description: '室内自然光半身立绘\\n云端分类：角色 / 女性角色\\n云端来源：character-female-yuna',
        files: [{ id: 'f1', original_name: 'yuna.png', real_path: '/tmp/yuna.png', mime: 'image/png' }],
        updated_at: '2026-11-25T18:50:00Z',
      },
      {
        id: 'a2',
        name: '霓虹雨夜便利店街景',
        type: 'scene',
        description: '16:9 夜景空镜',
        files: [
          { id: 'f2', original_name: 'street.jpg', real_path: '/tmp/street.jpg', mime: 'image/jpeg' },
          { id: 'f3', original_name: 'rain.mp4', real_path: '/tmp/rain.mp4', mime: 'video/mp4' },
        ],
        updated_at: '2026-11-25T16:00:00Z',
      },
      {
        id: 'a3',
        name: '小红书美妆脚本手册',
        type: 'knowledge',
        description: '云端分类：知识包\\n云端来源：doc-01',
        files: [{ id: 'f4', original_name: 'guide.md', real_path: '/tmp/guide.md', mime: 'text/markdown' }],
        updated_at: '2026-11-24T12:00:00Z',
      },
      {
        id: 'a4',
        name: '机械键盘道具',
        type: 'prop',
        description: '外置盘缺失测试',
        files: [],
        missing_file_count: 1,
        updated_at: '2026-11-20T08:00:00Z',
      },
    ]

    window.__probeEvents = { opened: [], previewed: [], copied: [], removed: [], added: [] }
    function App() {
      const [selectedIds, setSelectedIds] = useState(() => new Set())
      return React.createElement(AssetGrid, {
        t: (k) => zh[k] ?? k,
        assets: ASSETS,
        viewMode: 'list',
        emptyLabel: 'empty',
        selectedIds,
        onSelectionChange: setSelectedIds,
        onOpen: (a) => window.__probeEvents.opened.push(a.id),
        onPreview: (item) => window.__probeEvents.previewed.push(item.sourceAssetId),
        onCopy: (a) => window.__probeEvents.copied.push(a.id),
        onRemove: (a) => window.__probeEvents.removed.push(a.id),
        onAddToConversation: (a) => window.__probeEvents.added.push(a.id),
      })
    }

    // Intercept previewUrl images so cover images decode synchronously in offline Chromium
    const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get() { return origSrcDesc.get.call(this) },
      set(val) {
        const mapped = typeof val === 'string' && val.startsWith('/omnimux/assets/library/preview') ? PORTRAIT : val
        origSrcDesc.set.call(this, mapped)
      },
    })

    createRoot(document.getElementById('probe-root')).render(React.createElement(App))
  `
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: here, loader: 'jsx' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'stub-host-primitives',
        setup(build) {
          build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
            path: 'stub-primitives',
            namespace: 'stub-primitives',
          }))
          build.onLoad({ filter: /./, namespace: 'stub-primitives' }, () => ({
            contents: 'export const Tooltip = ({ children }) => children; export const Menu = () => null; export const Modal = () => null;',
            loader: 'js',
          }))
        },
      },
    ],
  })
  return built.outputFiles[0].text
}

test('资产中心本地列表视图真实浏览器渲染：16:10 缩略图、表头对齐、全选/排序、悬停预览、双主题实体浮层与窄屏响应', async () => {
  const bundleCode = await buildBrowserBundle()

  const result = runStyleDomProbe({
    name: 'assets-list-view-real-render',
    styles: `${HOST_THEME_CSS}\n${ASSETS_CSS}`,
    viewportHeight: 900,
    waitForCompletion: true,
    html: `<div id="probe-host" style="width:1200px;padding:16px;"><div id="probe-root"></div></div><script>${bundleCode.replace(/<\/script/gi, '<\\/script')}</script>`,
    measure: () => {
      const finish = (payload) => {
        document.title = 'RESULT:' + JSON.stringify(payload)
      }
      setTimeout(() => {
        try {
          const thActions = document.querySelector('.omnimux-assets-th-actions').getBoundingClientRect()
          const tdActions = document.querySelector('.omnimux-assets-td-actions').getBoundingClientRect()
          const thFiles = document.querySelector('.omnimux-assets-th-files').getBoundingClientRect()
          const tdFiles = document.querySelector('.omnimux-assets-td-files').getBoundingClientRect()
          const thUpdated = document.querySelector('.omnimux-assets-th-updated').getBoundingClientRect()
          const tdUpdated = document.querySelector('.omnimux-assets-td-updated').getBoundingClientRect()
          const row0 = document.querySelector('.omnimux-assets-list-row')
          const row0Rect = row0.getBoundingClientRect()
          const thumb0 = row0.querySelector('.omnimux-assets-list-thumb')
          const thumb0Rect = thumb0.getBoundingClientRect()
          const thumbImg = thumb0.querySelector('.omnimux-assets-list-thumb-img')
          const addBtn0 = row0.querySelector('.omnimux-assets-list-add-btn')
          const moreBtn0 = row0.querySelector('.omnimux-assets-list-more-btn')
          const desc0 = row0.querySelector('.omnimux-assets-td-desc').textContent.trim()

          const lightGeometry = {
            actionsRightDelta: Math.abs(thActions.right - tdActions.right),
            filesRightDelta: Math.abs(thFiles.right - tdFiles.right),
            updatedRightDelta: Math.abs(thUpdated.right - tdUpdated.right),
            rowHeight: Math.round(row0Rect.height),
            thumbW: Math.round(thumb0Rect.width),
            thumbH: Math.round(thumb0Rect.height),
            thumbRadius: getComputedStyle(thumb0).borderRadius,
            thumbFit: thumbImg ? getComputedStyle(thumbImg).objectFit : null,
            defaultAddOpacity: getComputedStyle(addBtn0).opacity,
            defaultMoreOpacity: Number(getComputedStyle(moreBtn0).opacity),
            desc0,
            hasCloudMeta: /云端分类|云端来源/.test(desc0),
            rowDraggable: row0.getAttribute('draggable'),
          }

          // Select row 0 + Shift+Click row 2 -> mixed header checkbox + 3 selected rows
          const rowCbs = Array.from(document.querySelectorAll('tbody [role="checkbox"]'))
          rowCbs[0].click()
          rowCbs[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))

          // Open overflow menu in light theme; settle any active CSS transition under Chrome virtual-time-budget
          moreBtn0.click()

          setTimeout(() => {
            try {
              for (const anim of addBtn0.getAnimations()) anim.finish()
              const headerCb = document.querySelector('thead [role="checkbox"]')
              const menuLight = document.querySelector('.omnimux-assets-list-more-menu')
              const selectedRow0 = document.querySelector('.omnimux-assets-list-row[aria-selected="true"]')
              const selectionLight = {
                headerChecked: headerCb.getAttribute('aria-checked'),
                selectedCount: document.querySelectorAll('.omnimux-assets-list-row[aria-selected="true"]').length,
                selectedTrBg: selectedRow0 ? getComputedStyle(selectedRow0).backgroundColor : null,
                menuItemsCount: menuLight ? menuLight.querySelectorAll('[role="menuitem"]').length : 0,
                menuLightBg: menuLight ? getComputedStyle(menuLight).backgroundColor : null,
                menuLightBackdrop: menuLight ? getComputedStyle(menuLight).backdropFilter : null,
                addBtnOpacityWhenMenuOpen: getComputedStyle(addBtn0).opacity,
                addBtnPointerEventsWhenMenuOpen: getComputedStyle(addBtn0).pointerEvents,
              }

              // Switch to dark theme and verify menu surface + header background
              document.body.setAttribute('data-ds-dark-theme', '')
              const thName = document.querySelector('.omnimux-assets-th-name')
              for (const anim of thName.getAnimations()) anim.finish()
              const menuDarkBg = menuLight ? getComputedStyle(menuLight).backgroundColor : null
              const headDarkBg = getComputedStyle(thName).backgroundColor

              // Close menu via Escape, then trigger 200ms thumbnail hover preview
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
              thumb0.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

              setTimeout(() => {
                try {
                  const pop = document.querySelector('.omnimux-assets-list-preview-popover')
                  const popImg = pop ? pop.querySelector('.omnimux-assets-list-preview-img') : null
                  const hoverDark = {
                    mounted: Boolean(pop),
                    popDarkBg: pop ? getComputedStyle(pop).backgroundColor : null,
                    popBackdrop: pop ? getComputedStyle(pop).backdropFilter : null,
                    imgObjectFit: popImg ? getComputedStyle(popImg).objectFit : null,
                    imgW: popImg ? Math.round(popImg.getBoundingClientRect().width) : 0,
                    imgH: popImg ? Math.round(popImg.getBoundingClientRect().height) : 0,
                  }

                  // Escape must also dismiss hover preview
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

                  setTimeout(() => {
                    try {
                      const hoverDismissedByEsc = !document.querySelector('.omnimux-assets-list-preview-popover')

                      // Switch back light + shrink container to 740px narrow width
                      document.body.removeAttribute('data-ds-dark-theme')
                      const host = document.getElementById('probe-host')
                      host.style.width = '740px'
                      const wrap = document.querySelector('.omnimux-assets-list-wrap')
                      const narrow = {
                        descDisplay: getComputedStyle(document.querySelector('.omnimux-assets-th-desc')).display,
                        hasHorizOverflow: wrap.scrollWidth > wrap.clientWidth + 1,
                        actionsFits: document.querySelector('.omnimux-assets-th-actions').getBoundingClientRect().right <= wrap.getBoundingClientRect().right + 1,
                      }

                      // Sort by files asc/desc check
                      const filesHeader = document.querySelector('th[data-sort-key="files"]')
                      filesHeader.click()
                      setTimeout(() => {
                        const firstAfterSort = document.querySelector('tbody tr')?.getAttribute('data-asset-id')
                        finish({
                          done: true,
                          lightGeometry,
                          selectionLight,
                          menuDarkBg,
                          headDarkBg,
                          hoverDark,
                          hoverDismissedByEsc,
                          narrow,
                          firstAfterSort,
                        })
                      }, 40)
                    } catch (err) {
                      finish({ done: false, error: String(err) })
                    }
                  }, 40)
                } catch (err) {
                  finish({ done: false, error: String(err) })
                }
              }, 260)
            } catch (err) {
              finish({ done: false, error: String(err) })
            }
          }, 60)
        } catch (err) {
          finish({ done: false, error: String(err) })
        }
      }, 60)
      return { done: false }
    },
  })

  assert.equal(result.done, true, result.error || 'probe did not finish')

  // 1. 16:10 thumbnail, row height 52-56px, right-aligned headers
  assert.equal(result.lightGeometry.thumbW, 40)
  assert.equal(result.lightGeometry.thumbH, 28)
  assert.equal(result.lightGeometry.thumbRadius, '6px')
  assert.equal(result.lightGeometry.thumbFit, 'contain')
  assert.ok(result.lightGeometry.rowHeight >= 52 && result.lightGeometry.rowHeight <= 56, `row height ${result.lightGeometry.rowHeight}`)
  assert.ok(result.lightGeometry.actionsRightDelta < 1, `actions header/cell misaligned by ${result.lightGeometry.actionsRightDelta}px`)
  assert.ok(result.lightGeometry.filesRightDelta < 1, `files header/cell misaligned by ${result.lightGeometry.filesRightDelta}px`)
  assert.ok(result.lightGeometry.updatedRightDelta < 1, `updated header/cell misaligned by ${result.lightGeometry.updatedRightDelta}px`)
  assert.equal(result.lightGeometry.defaultAddOpacity, '0')
  assert.equal(result.lightGeometry.hasCloudMeta, false)
  assert.equal(result.lightGeometry.rowDraggable, 'true')

  // 2. Mixed selection, Shift+Click range select, hover-reveal when menu open, solid opaque menu in light & dark
  assert.equal(result.selectionLight.headerChecked, 'mixed')
  assert.equal(result.selectionLight.selectedCount, 3)
  assert.equal(result.selectionLight.selectedTrBg, 'rgba(0, 0, 0, 0)')
  assert.equal(result.selectionLight.menuItemsCount, 4)
  assert.equal(result.selectionLight.menuLightBg, 'rgb(255, 255, 255)')
  assert.equal(result.selectionLight.menuLightBackdrop, 'none')
  assert.equal(result.selectionLight.addBtnOpacityWhenMenuOpen, '1')
  assert.equal(result.selectionLight.addBtnPointerEventsWhenMenuOpen, 'auto')
  assert.equal(result.menuDarkBg, 'rgb(44, 44, 46)')
  assert.equal(result.headDarkBg, 'rgb(21, 21, 23)')

  // 3. 200ms thumbnail hover preview popover in dark mode + Escape dismissal
  assert.equal(result.hoverDark.mounted, true)
  assert.equal(result.hoverDark.popDarkBg, 'rgb(44, 44, 46)')
  assert.equal(result.hoverDark.popBackdrop, 'none')
  assert.equal(result.hoverDark.imgObjectFit, 'contain')
  assert.ok(result.hoverDark.imgW > 0 && result.hoverDark.imgW <= 340)
  assert.ok(result.hoverDark.imgH > 0 && result.hoverDark.imgH <= 340)
  assert.equal(result.hoverDismissedByEsc, true)

  // 4. Narrow container query collapses description cleanly with zero clipping
  assert.equal(result.narrow.descDisplay, 'none')
  assert.equal(result.narrow.hasHorizOverflow, false)
  assert.equal(result.narrow.actionsFits, true)

  // 5. Column header sorting updates rendered DOM row order
  assert.equal(result.firstAfterSort, 'a2')
})
