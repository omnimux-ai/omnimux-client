/**
 * E2E: 验证 omnimux-products 的 ProductFormPage 二级表单内 <PageHeader> 面包屑返回按钮
 * 在 macOS Electron app-region 规则下的真实可点击性。
 *
 * 根因：ProductFormPage 虽外包 `.omnimux-products-subscreen` (`no-drag`)，但在其内部
 * DOM 序更靠后地渲染了 `<PageHeader>`（`.dshUk-PageHeader-pageHeader` 带 `drag`）；
 * 此前 `dsh-ui-kit/src/stage/PageHeader.module.css` `.breadcrumb` 与 `omnimux-products`
 * 返回区均未声明 `no-drag`，且 `PageHeader` 未带 `[data-window-drag]`，导致 `base.css`
 * 把返回箭头 IconButton 与「产品库」Button 重置为 `initial` (`none`) 后仍落入内层
 * `PageHeader` 的 `drag` 矩形而被吞没点击。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertPng, findChromePath } from '../../../../scripts/worktree-web-qa.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const productsRoot = resolve(here, '../..')
const repoRoot = resolve(productsRoot, '../../..')

/** 与 app/deepseek-harness/packages/client/web/src/base.css 对齐的 macOS app-region 核心规则（无子模块 CI 兜底）。 */
const FALLBACK_BASE_DARWIN_APP_REGION_CSS = `
:where(html[data-platform='darwin'] *) { -webkit-app-region: initial; }
html[data-platform='darwin'] [data-window-drag] { -webkit-app-region: drag; }
html[data-platform='darwin'] [data-window-drag-exclude] { -webkit-app-region: no-drag; }
html[data-platform='darwin'] body > :not(#root) { -webkit-app-region: no-drag; }
html[data-platform='darwin'] :where([data-window-drag], [data-window-drag-controls]) :is(
  button, a, input, select, textarea, summary, [contenteditable='true'], [tabindex],
  [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='tooltip'],
  [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'],
  [role='menuitemradio'], [role='option'], [role='checkbox'], [role='radio'], [role='switch'],
  [role='slider'], [role='combobox'], [role='textbox']
):where(:not([data-window-drag-exclude] *)) {
  -webkit-app-region: no-drag;
}
`

function loadBaseCss() {
  const submoduleCss = join(repoRoot, 'app/deepseek-harness/packages/client/web/src/base.css')
  return existsSync(submoduleCss) ? readFileSync(submoduleCss, 'utf8') : FALLBACK_BASE_DARWIN_APP_REGION_CSS
}

async function bundleAssetsWithProductForm() {
  const req = createRequire(join(repoRoot, 'plugins/plugins/omnimux-assets/package.json'))
  const { build } = req('esbuild')
  const kitJsPath = join(repoRoot, 'plugins/packages/dsh-ui-kit/lib/index.js')
  const entryCode = `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { AssetsStage } from './plugins/plugins/omnimux-assets/src/client/AssetsStage.jsx'
    import { zh as assetsZh } from './plugins/plugins/omnimux-assets/src/client/locales.js'
    import { zh as productsZh } from './plugins/plugins/omnimux-products/src/client/locales.js'
    const makeT = (dict) => (key, vars) => {
      let s = dict[key] || key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', String(v))
      return s
    }
    const t = makeT(assetsZh)
    const productT = makeT({ ...assetsZh, ...productsZh })
    createRoot(document.getElementById('stage-root')).render(
      React.createElement(AssetsStage, {
        t,
        productT,
        visible: true,
        tab: { meta: { filterType: 'product' } },
      })
    )
  `
  const result = await build({
    absWorkingDir: repoRoot,
    stdin: { contents: entryCode, resolveDir: repoRoot, loader: 'jsx' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    nodePaths: [
      join(repoRoot, 'plugins/plugins/omnimux-assets/node_modules'),
      join(productsRoot, 'node_modules'),
      join(repoRoot, 'plugins/node_modules'),
      join(repoRoot, 'node_modules'),
    ],
    plugins: [{
      name: 'host-and-workspace-shims',
      setup(ctx) {
        ctx.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: kitJsPath }))
        ctx.onResolve({ filter: /^dsh-ui-kit\/native-file-picker$/ }, () => ({
          path: join(repoRoot, 'plugins/packages/dsh-ui-kit/src/native-file-picker.js'),
        }))
        ctx.onResolve({ filter: /^omnimux-products\/ui$/ }, () => ({
          path: join(productsRoot, 'src/client/ui.js'),
        }))
        ctx.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
          path: 'prim',
          namespace: 'shim-prim',
        }))
        ctx.onLoad({ filter: /.*/, namespace: 'shim-prim' }, () => ({
          loader: 'jsx',
          resolveDir: productsRoot,
          contents: `
            import React from 'react'
            import { createPortal } from 'react-dom'
            const Svg = (p) => React.createElement('svg', p)
            export const Tooltip = ({ children }) => children
            export const Menu = () => null
            export const Modal = ({ open, title, children, footer }) => open
              ? createPortal(
                  React.createElement('div', { className: 'mock-modal-backdrop' },
                    React.createElement('div', { role: 'dialog', 'aria-modal': 'true' },
                      title ? React.createElement('h2', null, title) : null,
                      children,
                      footer,
                    )
                  ),
                  document.body
                )
              : null
            export const Input = React.forwardRef((props, ref) => React.createElement('input', { ...props, ref }))
            export const Select = ({ children, ...p }) => React.createElement('div', p, children)
            export const IconCheckOutline16 = Svg
            export const IconCheckOutlineRegular = Svg
            export const IconChevronDownOutline14 = Svg
            export const IconChevronDownOutlineRegular = Svg
            export const IconChevronUpOutline14 = Svg
            export const IconChevronUpOutlineRegular = Svg
            export const IconChevronLeftOutline14 = Svg
            export const IconChevronLeftOutlineRegular = Svg
            export const IconCloseFill14 = Svg
            export const IconCloseFillRegular = Svg
            export const IconCloseOutline16 = Svg
            export const IconCloseOutlineRegular = Svg
            export const IconCopyOutline16 = Svg
            export const IconCopyOutlineRegular = Svg
            export const IconDownloadOutline16 = Svg
            export const IconDownloadOutlineRegular = Svg
            export const IconEditOutline16 = Svg
            export const IconEditOutlineRegular = Svg
            export const IconEllipsisOutline16 = Svg
            export const IconEllipsisOutlineRegular = Svg
            export const IconLoadingOutline16 = Svg
            export const IconLoadingOutlineRegular = Svg
            export const IconPaperclipOutline16 = Svg
            export const IconPaperclipOutlineRegular = Svg
            export const IconPlayOutline16 = Svg
            export const IconPlayOutlineRegular = Svg
            export const IconPlusOutline16 = Svg
            export const IconPlusOutlineRegular = Svg
            export const IconRefreshOutline14 = Svg
            export const IconRefreshOutlineRegular = Svg
            export const IconRefreshOutline16 = Svg
            export const IconRightUpOutline14 = Svg
            export const IconRightUpOutlineRegular = Svg
            export const IconSearchOutline16 = Svg
            export const IconSearchOutlineRegular = Svg
            export const IconTrashOutline16 = Svg
            export const IconTrashOutlineRegular = Svg
          `,
        }))
        for (const pkg of [
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-slots',
          '@deepseek-ai/cordis',
        ]) {
          ctx.onResolve({ filter: new RegExp(`^${pkg.replace('/', '\\/')}$`) }, () => ({
            path: pkg,
            namespace: 'shim-noop',
          }))
        }
        ctx.onLoad({ filter: /.*/, namespace: 'shim-noop' }, () => ({
          loader: 'js',
          contents: 'export default {}; export const defineExtension = (x) => x;',
        }))
      },
    }],
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

function buildTestHtml(bundledJs) {
  const baseCss = loadBaseCss()
  const hostAndThemeCss = `
    html, body, #root { margin: 0; width: 100%; height: 100%; }
    :root {
      --dsw-alias-bg-base: #ffffff;
      --dsw-alias-bg-layer-1: #f8fafc;
      --dsw-alias-bg-layer-2: #f1f5f9;
      --dsw-alias-bg-elevated: #ffffff;
      --dsw-alias-border-l1: rgba(15, 23, 42, 0.1);
      --dsw-alias-border-l2: rgba(15, 23, 42, 0.18);
      --dsw-alias-border-l3: rgba(15, 23, 42, 0.28);
      --dsw-alias-border-l4: rgba(15, 23, 42, 0.4);
      --dsw-alias-label-primary: #0f172a;
      --dsw-alias-label-primary-foreground: #ffffff;
      --dsw-alias-label-secondary: #475569;
      --dsw-alias-label-tertiary: #64748b;
      --dsw-alias-label-dimmed: #94a3b8;
      --dsw-alias-button-primary-fill: #0f172a;
      --dsw-alias-button-primary-hover: #1e293b;
      --dsw-alias-interactive-bg-hover: rgba(15, 23, 42, 0.06);
      --dsw-alias-interactive-bg-active: rgba(15, 23, 42, 0.1);
      --dsw-alias-brand-primary: #0f172a;
      --dsw-alias-brand: #0f172a;
      --dsw-alias-state-business-primary: #0f172a;
      --dsw-alias-state-business-tertiary: #f1f5f9;
      --dsw-alias-state-error-primary: #ef4444;
      --dsw-alias-state-warn-primary: #f59e0b;
      --dsw-alias-state-success-primary: #10b981;
    }
    body[data-ds-dark-theme="true"] {
      --dsw-alias-bg-base: #141417;
      --dsw-alias-bg-layer-1: #1c1d22;
      --dsw-alias-bg-layer-2: #24262d;
      --dsw-alias-bg-elevated: #27272a;
      --dsw-alias-border-l1: rgba(255, 255, 255, 0.08);
      --dsw-alias-border-l2: rgba(255, 255, 255, 0.14);
      --dsw-alias-border-l3: rgba(255, 255, 255, 0.22);
      --dsw-alias-border-l4: rgba(255, 255, 255, 0.32);
      --dsw-alias-label-primary: #f4f4f6;
      --dsw-alias-label-primary-foreground: #111113;
      --dsw-alias-label-secondary: #a1a1aa;
      --dsw-alias-label-tertiary: #71717a;
      --dsw-alias-label-dimmed: #52525b;
      --dsw-alias-button-primary-fill: #f4f4f6;
      --dsw-alias-button-primary-hover: #e4e4e7;
      --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
      --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.12);
      --dsw-alias-brand-primary: #f4f4f6;
      --dsw-alias-brand: #f4f4f6;
      --dsw-alias-state-business-primary: #f4f4f6;
      --dsw-alias-state-business-tertiary: #24262d;
    }
    html[data-platform='darwin'] .pane {
      -webkit-app-region: no-drag;
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .tabStrip {
      height: 40px;
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      background: var(--dsw-alias-bg-layer-1);
      color: var(--dsw-alias-label-primary);
      border-bottom: 1px solid var(--dsw-alias-border-l1);
      font-size: 13px;
    }
    .paneBody {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .mock-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 900;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mock-modal-backdrop [role="dialog"] {
      width: 400px;
      max-width: calc(100vw - 32px);
      padding: 20px;
      border-radius: 14px;
      background: var(--dsw-alias-bg-layer-1);
      color: var(--dsw-alias-label-primary);
      border: 1px solid var(--dsw-alias-border-l2);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
  `
  return `<!doctype html>
<html lang="zh-CN" data-platform="darwin">
<head>
  <meta charset="utf-8" />
  <style>${baseCss}\n${hostAndThemeCss}</style>
</head>
<body data-ds-dark-theme="true">
  <div id="root">
    <section class="pane">
      <div class="tabStrip" data-window-drag="true"><span>资产库</span></div>
      <div class="paneBody" id="stage-root"></div>
    </section>
  </div>
  <script>${bundledJs}</script>
</body>
</html>`
}

const REGION_INSPECT_FN = `
  function inspectElementRegion(selectorOrText) {
    let el = document.querySelector(selectorOrText);
    if (!el && !selectorOrText.startsWith('.') && !selectorOrText.startsWith('[')) {
      el = [...document.querySelectorAll('button')]
        .find((node) => (node.textContent || '').includes(selectorOrText));
    }
    if (!el) return { found: false };
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(x, y);
    const regions = [];
    for (const node of document.querySelectorAll('*')) {
      const style = getComputedStyle(node);
      const region = style.getPropertyValue('-webkit-app-region').trim();
      if (!region || region === 'none' || style.visibility !== 'visible' || ['none', 'contents', 'inline'].includes(style.display)) {
        continue;
      }
      const box = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      regions.push({ region, box, cls: node.className || node.tagName });
    }
    let owner = 'none';
    let decidedRegion = 'none';
    for (const entry of regions) {
      if (x >= entry.box.left && x < entry.box.right && y >= entry.box.top && y < entry.box.bottom) {
        decidedRegion = entry.region;
        owner = entry.cls;
      }
    }
    return {
      found: true,
      x,
      y,
      width: rect.width,
      height: rect.height,
      hitByElementFromPoint: Boolean(topEl && el.contains(topEl)),
      decidedRegion,
      draggable: decidedRegion === 'drag',
      owner,
    };
  }
`

describe('ProductFormPage breadcrumb back button clickability E2E', () => {
  it('keeps arrow back button and 产品库 crumb button out of PageHeader drag region and returns on real clicks', { timeout: 60_000 }, async () => {
    const bundledJs = await bundleAssetsWithProductForm()
    const html = buildTestHtml(bundledJs)

    const sampleDigitalProduct = {
      id: 'prod-1',
      name: 'OmniMux Studio',
      kind: 'digital',
      handle: 'omnimux-studio',
      selling_points: 'AI 内容电商团队工作台',
      audience: '品牌与内容团队',
      brand: 'OmniMux',
      features: '',
      price: '',
      sku: '',
      promotion: '',
      link: 'https://omnimux.example.com',
      categories: ['SaaS'],
      media: [],
      cover_media_id: null,
    }

    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1')
      const pathname = urlObj.pathname
      if (pathname === '/omnimux/assets/state' || pathname === '/omnimux/assets') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ lrev: 1, arev: 1, mrev: 1, assets: [] }))
        return
      }
      if (pathname === '/omnimux/products/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ rev: 1, products: [sampleDigitalProduct] }))
        return
      }
      if (pathname === '/omnimux/products/prod-1') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ product: sampleDigitalProduct }))
        return
      }
      if (pathname.startsWith('/omnimux/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, items: [], entries: [] }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })

    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    const profileDir = mkdtempSync(join(tmpdir(), 'omx-products-back-e2e-'))
    const evidenceDir = join(repoRoot, '.workbuddy/evidence/fix-products-form-back-button')
    mkdirSync(evidenceDir, { recursive: true })

    let chrome = null
    let ws = null

    try {
      const chromeArgs = [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--window-size=1280,800',
        'about:blank',
      ]
      if (process.platform === 'linux') {
        chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage')
      }
      chrome = spawn(findChromePath(), chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] })

      const cdpPort = await new Promise((resolvePort, rejectPort) => {
        const portFile = join(profileDir, 'DevToolsActivePort')
        let settled = false
        let stderrBuf = ''
        const finish = (fn, val) => {
          if (settled) return
          settled = true
          clearInterval(pollFile)
          clearTimeout(timer)
          fn(val)
        }
        const pollFile = setInterval(() => {
          try {
            if (!existsSync(portFile)) return
            const portNum = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim())
            if (Number.isInteger(portNum) && portNum > 0) finish(resolvePort, portNum)
          } catch {}
        }, 100)
        const timer = setTimeout(
          () => finish(rejectPort, new Error(`chrome-start-timeout; stderr=${stderrBuf.slice(-400)}`)),
          20_000,
        )
        chrome.stderr.on('data', (chunk) => {
          stderrBuf += chunk.toString()
          const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderrBuf)
          if (match) finish(resolvePort, Number(match[1]))
        })
        chrome.once('error', (err) => finish(rejectPort, err))
        chrome.once('exit', (code, signal) => finish(rejectPort, new Error(`chrome-exited-early code=${code} signal=${signal} stderr=${stderrBuf.slice(-400)}`)))
      })

      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      const pageTarget = targets.find((item) => item.type === 'page')
      assert.ok(pageTarget?.webSocketDebuggerUrl)
      ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
      await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no })

      let seq = 0
      const pending = new Map()
      const send = (method, params = {}) => new Promise((yes, no) => {
        const id = ++seq
        const timer = setTimeout(() => { pending.delete(id); no(new Error(`cdp-timeout:${method}`)) }, 15_000)
        pending.set(id, { yes: (v) => { clearTimeout(timer); yes(v) }, no: (e) => { clearTimeout(timer); no(e) } })
        ws.send(JSON.stringify({ id, method, params }))
      })
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (!msg.id || !pending.has(msg.id)) return
        const entry = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) entry.no(new Error(msg.error.message))
        else entry.yes(msg.result)
      }

      const evalJson = async (body) => {
        const res = await send('Runtime.evaluate', {
          expression: `JSON.stringify((() => { ${body} })())`,
          returnByValue: true,
          awaitPromise: true,
        })
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
        return JSON.parse(res.result.value)
      }

      const mouseClickAt = async (x, y) => {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      }

      const waitForCondition = async (expr, label) => {
        for (let i = 0; i < 60; i += 1) {
          if (await evalJson(`return Boolean(${expr})`)) return
          await new Promise((r) => setTimeout(r, 50))
        }
        assert.fail(`timed out waiting for ${label}`)
      }

      const waitForSubscreen = (expectedOpen) =>
        waitForCondition(
          expectedOpen
            ? 'Boolean(document.querySelector(".omnimux-products-subscreen")) && Number(getComputedStyle(document.querySelector(".omnimux-products-subscreen")).opacity) >= 0.99'
            : '!document.querySelector(".omnimux-products-subscreen")',
          `subscreen=${expectedOpen}`,
        )

      await send('Page.enable')
      await send('Runtime.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/` })

      await waitForCondition('document.querySelector(".omnimux-products-card")', 'initial product card list')

      // 1. Create Physical（暗色宽屏）：通过分流菜单打开，检查返回箭头与「产品库」app-region 并点击「产品库」返回
      await evalJson('document.querySelector(".omnimux-products-create-menu button").click(); return true')
      await waitForCondition('document.querySelector("[data-kind=\\"physical\\"]")', 'create menu opened')
      await evalJson('document.querySelector("[data-kind=\\"physical\\"]").click(); return true')
      await waitForSubscreen(true)
      await evalJson('return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')

      const createInspect = await evalJson(`
        ${REGION_INSPECT_FN}
        const innerHead = document.querySelector('.omnimux-products-subscreen > header');
        const headRect = innerHead ? innerHead.getBoundingClientRect() : null;
        return {
          arrow: inspectElementRegion('.omnimux-products-back-button'),
          crumb: inspectElementRegion('.omnimux-products-back-path button:not(.omnimux-products-back-button)'),
          breadcrumbRow: inspectElementRegion('.dshUk-PageHeader-breadcrumb'),
          innerHeader: inspectElementRegion('.omnimux-products-subscreen > header'),
          innerHeaderRegionProp: innerHead ? getComputedStyle(innerHead).getPropertyValue('-webkit-app-region').trim() : null,
          cancel: inspectElementRegion('取消'),
          save: inspectElementRegion('保存产品'),
          excludeAttr: document.querySelector('.omnimux-products-subscreen')?.hasAttribute('data-window-drag-exclude') ?? false,
        }
      `)
      assert.equal(createInspect.arrow.found, true)
      assert.equal(createInspect.arrow.hitByElementFromPoint, true)
      assert.equal(createInspect.arrow.draggable, false, `create back arrow must not be drag: ${JSON.stringify(createInspect.arrow)}`)
      assert.equal(createInspect.crumb.found, true)
      assert.equal(createInspect.crumb.hitByElementFromPoint, true)
      assert.equal(createInspect.crumb.draggable, false, `create crumb button must not be drag: ${JSON.stringify(createInspect.crumb)}`)
      assert.equal(createInspect.breadcrumbRow.found, true)
      assert.equal(createInspect.breadcrumbRow.draggable, false)
      assert.equal(createInspect.innerHeader.found, true)
      assert.equal(createInspect.innerHeader.draggable, false)
      assert.equal(createInspect.innerHeaderRegionProp, 'no-drag')
      assert.equal(createInspect.cancel.found, true)
      assert.equal(createInspect.cancel.hitByElementFromPoint, true)
      assert.equal(createInspect.cancel.draggable, false)
      assert.equal(createInspect.save.found, true)
      assert.equal(createInspect.save.hitByElementFromPoint, true)
      assert.equal(createInspect.save.draggable, false)
      assert.equal(createInspect.excludeAttr, true, 'subscreen must declare data-window-drag-exclude')

      // 验证兼容壳 (dsh-plugin-desktop + PRODUCT_STAGE_CHROME) 的 [class*="PageHeader"] 与 header 规则下依然为 no-drag
      const compatCheck = await evalJson(`
        ${REGION_INSPECT_FN}
        const style = document.createElement('style');
        style.id = 'compat-drag-probe';
        document.documentElement.setAttribute('data-dsh-product-stage', 'omnimux-assets');
        document.body.setAttribute('data-dsh-desktop-platform', 'darwin');
        style.textContent = [
          'body[data-dsh-desktop-platform="darwin"] header,',
          'body[data-dsh-desktop-platform="darwin"] [class*="PageHeader"] { -webkit-app-region: drag; }',
          'html[data-dsh-product-stage]:not([data-dsh-product-stage="omnimux-apps"]) header:not([data-window-drag-exclude] *) { -webkit-app-region: drag !important; }',
          'html[data-dsh-product-stage]:not([data-dsh-product-stage="omnimux-apps"]) header [class*="breadcrumb"],',
          'html[data-dsh-product-stage]:not([data-dsh-product-stage="omnimux-apps"]) header button { -webkit-app-region: no-drag !important; }'
        ].join(' ');
        document.head.appendChild(style);
        const res = {
          arrow: inspectElementRegion('.omnimux-products-back-button'),
          crumb: inspectElementRegion('.omnimux-products-back-path button:not(.omnimux-products-back-button)'),
          innerHeadProp: getComputedStyle(document.querySelector('.omnimux-products-subscreen > header')).getPropertyValue('-webkit-app-region').trim(),
        };
        style.remove();
        document.body.removeAttribute('data-dsh-desktop-platform');
        document.documentElement.removeAttribute('data-dsh-product-stage');
        return res;
      `)
      assert.equal(compatCheck.arrow.draggable, false, `compat arrow must stay no-drag: ${JSON.stringify(compatCheck.arrow)}`)
      assert.equal(compatCheck.crumb.draggable, false, `compat crumb must stay no-drag: ${JSON.stringify(compatCheck.crumb)}`)
      assert.equal(compatCheck.innerHeadProp, 'no-drag', 'compat inner PageHeader must stay no-drag against body[data-dsh-desktop-platform="darwin"] [class*="PageHeader"]')

      const createShot = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
      assertPng(createShot)
      writeFileSync(join(evidenceDir, 'real-after-create-dark.png'), createShot)

      await mouseClickAt(createInspect.crumb.x, createInspect.crumb.y)
      await waitForSubscreen(false)

      // 2. Edit Digital（暗色宽屏）：打开已有产品，真实鼠标点击左箭头 IconButton 返回列表
      await evalJson('document.querySelector(".omnimux-products-card").click(); return true')
      await waitForSubscreen(true)
      await evalJson('return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
      const editArrow = await evalJson(`${REGION_INSPECT_FN} return inspectElementRegion('.omnimux-products-back-button')`)
      assert.equal(editArrow.found, true)
      assert.equal(editArrow.hitByElementFromPoint, true)
      assert.equal(editArrow.draggable, false, `edit back arrow must not be drag: ${JSON.stringify(editArrow)}`)
      await mouseClickAt(editArrow.x, editArrow.y)
      await waitForSubscreen(false)

      // 3. 亮色主题 + 窄屏（820x720）+ Dirty Leave Guard：改名触发未保存圆点，点击返回弹窗并点「放弃修改」
      await evalJson('document.body.removeAttribute("data-ds-dark-theme"); return true')
      await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 720, deviceScaleFactor: 2, mobile: false })
      await evalJson('document.querySelector(".omnimux-products-card").click(); return true')
      await waitForSubscreen(true)
      await waitForCondition('document.querySelector("input[aria-label=\\"名称\\"]")', 'product name input')
      await evalJson(`
        const input = document.querySelector('input[aria-label="名称"]');
        const rect = input.getBoundingClientRect();
        input.focus();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      `).then(async (pt) => {
        await mouseClickAt(pt.x, pt.y)
        await send('Input.insertText', { text: ' 修改版' })
      })
      await waitForCondition('document.querySelector(".omnimux-products-dirty-dot")', 'dirty dot indicator')
      await evalJson('return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')

      const narrowBack = await evalJson(`
        ${REGION_INSPECT_FN}
        return {
          arrow: inspectElementRegion('.omnimux-products-back-button'),
          crumb: inspectElementRegion('.omnimux-products-back-path button:not(.omnimux-products-back-button)'),
        }
      `)
      assert.equal(narrowBack.arrow.found, true)
      assert.equal(narrowBack.arrow.hitByElementFromPoint, true)
      assert.equal(narrowBack.arrow.draggable, false, `narrow dirty back arrow must not be drag: ${JSON.stringify(narrowBack.arrow)}`)
      assert.equal(narrowBack.crumb.found, true)
      assert.equal(narrowBack.crumb.hitByElementFromPoint, true)
      assert.equal(narrowBack.crumb.draggable, false, `narrow dirty crumb must not be drag: ${JSON.stringify(narrowBack.crumb)}`)

      await mouseClickAt(narrowBack.arrow.x, narrowBack.arrow.y)
      await waitForCondition('document.querySelector("[role=\\"dialog\\"]")', 'unsaved changes dialog')
      const discardBtn = await evalJson(`${REGION_INSPECT_FN} return inspectElementRegion('放弃修改')`)
      assert.equal(discardBtn.found, true)
      assert.equal(discardBtn.hitByElementFromPoint, true)
      assert.equal(discardBtn.draggable, false, `modal discard button must not be drag: ${JSON.stringify(discardBtn)}`)

      const narrowShot = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
      assertPng(narrowShot)
      writeFileSync(join(evidenceDir, 'real-after-edit-light-narrow-dirty.png'), narrowShot)

      await mouseClickAt(discardBtn.x, discardBtn.y)
      await waitForSubscreen(false)
    } finally {
      try { ws?.close() } catch {}
      try { chrome?.kill('SIGKILL') } catch {}
      try { server?.close() } catch {}
      try { rmSync(profileDir, { recursive: true, force: true }) } catch {}
    }
  })
})
