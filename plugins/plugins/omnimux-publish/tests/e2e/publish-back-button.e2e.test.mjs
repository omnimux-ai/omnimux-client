/**
 * E2E: 验证 omnimux-publish 子视图「返回列表」在 macOS Electron app-region 规则下的真实可点击性。
 *
 * 根因：PublishStage 挂载的一级页 <PageHeader> 带有 `-webkit-app-region: drag`，
 * 当 Composer 或 RecordDetail 以 `.omnimux-publish-subscreen` 覆盖其上时，若子屏容器
 * 与返回按钮未显式声明 `no-drag` / `data-window-drag-exclude`，macOS Electron 原生
 * 区域收集（按 DOM 文档序而非 z-index 裁决）会让「返回列表」中心点落入 PageHeader
 * 的 `drag` 矩形内，导致点击被窗口拖拽层吞没。
 *
 * 覆盖路径：
 * 1. 新建发布 -> 类型选择页「返回列表」
 * 2. 视频编辑页「返回列表」（含暗色宽屏 + 真实截图留证）
 * 3. 图文编辑页「返回列表」（含亮色窄屏 820x720 + 真实截图留证）
 * 4. 记录详情页加载中占位态与已加载态「返回列表」（含详情「刷新」按钮检查）
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
const publishRoot = resolve(here, '../..')
const repoRoot = resolve(publishRoot, '../../..')

/** 与 app/deepseek-harness/packages/client/web/src/base.css 对齐的 macOS app-region 核心规则（无子模块 CI 兜底）。 */
const FALLBACK_BASE_DARWIN_APP_REGION_CSS = `
:where(html[data-platform='darwin'] *) { -webkit-app-region: initial; }
html[data-platform='darwin'] [data-window-drag] { -webkit-app-region: drag; }
html[data-platform='darwin'] [data-window-drag-exclude] { -webkit-app-region: no-drag; }
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

async function bundlePublishStage() {
  const req = createRequire(join(publishRoot, 'package.json'))
  const { build } = req('esbuild')
  const kitJsPath = join(repoRoot, 'plugins/packages/dsh-ui-kit/lib/index.js')
  const entryCode = `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { PublishStage } from './plugins/plugins/omnimux-publish/src/client/PublishStage.jsx'
    import { zh } from './plugins/plugins/omnimux-publish/src/client/locales.js'
    const t = (key, vars) => {
      let s = zh[key] || key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', String(v))
      return s
    }
    createRoot(document.getElementById('stage-root')).render(React.createElement(PublishStage, { t, visible: true }))
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
      join(publishRoot, 'node_modules'),
      join(repoRoot, 'plugins/node_modules'),
      join(repoRoot, 'node_modules'),
    ],
    plugins: [{
      name: 'host-primitives-shim',
      setup(ctx) {
        ctx.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: kitJsPath }))
        ctx.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'prim', namespace: 'shim' }))
        ctx.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
          loader: 'jsx',
          resolveDir: publishRoot,
          contents: `
            import React from 'react'
            const Svg = (p) => React.createElement('svg', p)
            export const Tooltip = ({ children }) => children
            export const Menu = () => null
            export const Modal = ({ open, children }) => open ? React.createElement('div', { role: 'dialog' }, children) : null
            export const Input = (props) => React.createElement('input', props)
            export const Select = ({ children, ...p }) => React.createElement('div', p, children)
            export const IconCheckOutlineRegular = Svg
            export const IconChevronDownOutlineRegular = Svg
            export const IconChevronUpOutlineRegular = Svg
            export const IconChevronLeftOutlineRegular = Svg
            export const IconCloseFillRegular = Svg
            export const IconCloseOutlineRegular = Svg
            export const IconCopyOutlineRegular = Svg
            export const IconDownloadOutlineRegular = Svg
            export const IconEditOutlineRegular = Svg
            export const IconEllipsisOutlineRegular = Svg
            export const IconLoadingOutlineRegular = Svg
            export const IconPaperclipOutlineRegular = Svg
            export const IconPlayOutlineRegular = Svg
            export const IconPlusOutlineRegular = Svg
            export const IconRefreshOutlineRegular = Svg
            export const IconRightUpOutlineRegular = Svg
            export const IconSearchOutlineRegular = Svg
            export const IconTrashOutlineRegular = Svg
          `,
        }))
      },
    }],
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

function buildTestHtml(bundledJs) {
  const baseCss = loadBaseCss()
  const dockkitAndThemeCss = `
    html, body, #root { margin: 0; width: 100%; height: 100%; }
    :root {
      --dsw-alias-bg-base: #ffffff;
      --dsw-alias-bg-layer-1: #f8fafc;
      --dsw-alias-bg-layer-2: #f1f5f9;
      --dsw-alias-bg-elevated: #ffffff;
      --dsw-alias-border-l1: rgba(15, 23, 42, 0.1);
      --dsw-alias-border-l2: rgba(15, 23, 42, 0.18);
      --dsw-alias-border-l3: rgba(15, 23, 42, 0.28);
      --dsw-alias-label-primary: #0f172a;
      --dsw-alias-label-primary-foreground: #ffffff;
      --dsw-alias-label-secondary: #475569;
      --dsw-alias-label-tertiary: #64748b;
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
      --dsw-alias-state-warn-tertiary: rgba(245, 158, 11, 0.12);
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
      --dsw-alias-label-primary: #f4f4f6;
      --dsw-alias-label-primary-foreground: #111113;
      --dsw-alias-label-secondary: #a1a1aa;
      --dsw-alias-label-tertiary: #71717a;
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
  `
  return `<!doctype html>
<html lang="zh-CN" data-platform="darwin">
<head>
  <meta charset="utf-8" />
  <style>${baseCss}\n${dockkitAndThemeCss}</style>
</head>
<body data-ds-dark-theme="true">
  <div id="root">
    <section class="pane">
      <div class="tabStrip" data-window-drag="true"><span>发布</span></div>
      <div class="paneBody" id="stage-root"></div>
    </section>
  </div>
  <script>${bundledJs}</script>
</body>
</html>`
}

const REGION_INSPECT_FN = `
  function inspectSubscreenButton(label) {
    const btn = [...document.querySelectorAll('.omnimux-publish-subscreen button')]
      .find((node) => (node.textContent || '').includes(label));
    if (!btn) return { found: false };
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(x, y);
    const regions = [];
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const region = style.getPropertyValue('-webkit-app-region').trim();
      if (!region || region === 'none' || style.visibility !== 'visible' || ['none', 'contents', 'inline'].includes(style.display)) {
        continue;
      }
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      regions.push({ region, box, cls: el.className || el.tagName });
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
      hitByElementFromPoint: Boolean(topEl && btn.contains(topEl)),
      decidedRegion,
      draggable: decidedRegion === 'drag',
      owner,
    };
  }
`

describe('publish subscreen back button clickability E2E', () => {
  it('keeps 返回列表 out of macOS PageHeader drag region and returns to list on real clicks across all subscreens', { timeout: 60_000 }, async () => {
    const bundledJs = await bundlePublishStage()
    const html = buildTestHtml(bundledJs)

    let releaseDetail = null
    let resolveDetailRequested = null
    const detailRequested = new Promise((resolve) => {
      resolveDetailRequested = resolve
    })
    const server = http.createServer((req, res) => {
      const pathname = (req.url || '/').split('?')[0]
      if (pathname === '/omnimux/publish/records') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          records: [{
            id: 'rec-e2e-1',
            type: 'video',
            status: 'sent_to_inbox',
            title: '端到端测试发布记录',
            description: '验证返回列表点击',
            topics: [],
            media_ids: [],
            account_ids: ['acc-1'],
            created_at: '2026-11-26T00:00:00Z',
            updated_at: '2026-11-26T00:00:00Z',
            subtasks: [{ id: 't1', platform: 'tiktok', account_id: 'acc-1', status: 'sent_to_inbox', provider: 'tiktok_direct' }],
          }],
        }))
        return
      }
      if (pathname === '/omnimux/publish/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ rev: 1, counts: { total: 1, draft: 0, submitted: 0, reviewing: 0, published: 0, failed: 0 } }))
        return
      }
      if (pathname === '/omnimux/publish/capabilities') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } }))
        return
      }
      if (pathname === '/omnimux/accounts') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          accounts: [{
            id: 'acc-1',
            platform: 'tiktok',
            provider: 'tiktok_direct',
            display_name: 'GeminiX',
            username: 'geminix',
            status: 'active',
            usable: true,
            capabilities: { upload_draft: true, publish_direct: false },
          }],
        }))
        return
      }
      if (pathname.startsWith('/omnimux/publish/records/')) {
        const respond = () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            record: {
              id: 'rec-e2e-1',
              type: 'video',
              status: 'sent_to_inbox',
              title: '端到端测试发布记录',
              description: '验证返回列表点击',
              topics: [],
              media_ids: [],
              account_ids: ['acc-1'],
              subtasks: [{ id: 't1', platform: 'tiktok', account_id: 'acc-1', status: 'sent_to_inbox', provider: 'tiktok_direct' }],
            },
            media: [],
          }))
        }
        releaseDetail = respond
        resolveDetailRequested?.()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })

    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    const profileDir = mkdtempSync(join(tmpdir(), 'omx-publish-back-e2e-'))
    const evidenceDir = join(repoRoot, '.workbuddy/evidence/fix-publish-back-button')
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
        waitForCondition(`Boolean(document.querySelector(".omnimux-publish-subscreen")) === ${expectedOpen}`, `subscreen=${expectedOpen}`)

      await send('Page.enable')
      await send('Runtime.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/` })

      await waitForCondition('document.querySelector(".omnimux-publish-asset-card")', 'initial asset card list')

      // 1. Composer 类型选择页：检查「返回列表」app-region 并真实鼠标点击返回
      await evalJson('[...document.querySelectorAll("button")].find((b) => b.textContent.includes("新增发布")).click(); return true')
      await waitForSubscreen(true)
      const typeBack = await evalJson(`${REGION_INSPECT_FN} return inspectSubscreenButton('返回列表')`)
      assert.equal(typeBack.found, true)
      assert.equal(typeBack.hitByElementFromPoint, true)
      assert.equal(typeBack.draggable, false, `type-pick back button must not be drag: ${JSON.stringify(typeBack)}`)
      assert.equal(typeBack.decidedRegion, 'no-drag')
      await mouseClickAt(typeBack.x, typeBack.y)
      await waitForSubscreen(false)

      // 2. Composer 视频编辑页（暗色宽屏）：检查「返回列表」并真实鼠标点击返回
      await evalJson('[...document.querySelectorAll("button")].find((b) => b.textContent.includes("新增发布")).click(); return true')
      await waitForSubscreen(true)
      await evalJson('document.querySelector(".omnimux-publish-type-card").click(); return true')
      await waitForCondition(
        'document.querySelector(".omnimux-publish-editor-head") && document.querySelector(".omnimux-publish-subscreen")?.textContent.includes("GeminiX")',
        'video composer editor + accounts settled',
      )
      await evalJson('return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
      const editorBack = await evalJson(`${REGION_INSPECT_FN} return inspectSubscreenButton('返回列表')`)
      assert.equal(editorBack.found, true)
      assert.equal(editorBack.hitByElementFromPoint, true)
      assert.equal(editorBack.draggable, false, `editor back button must not be drag: ${JSON.stringify(editorBack)}`)
      assert.equal(editorBack.decidedRegion, 'no-drag')
      const composerShot = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
      assertPng(composerShot)
      writeFileSync(join(evidenceDir, 'real-after-composer-dark.png'), composerShot)
      await mouseClickAt(editorBack.x, editorBack.y)
      await waitForSubscreen(false)

      // 3. RecordDetail 加载态 & 已加载态：检查「返回列表」与「刷新」并真实鼠标点击返回
      await evalJson('document.querySelector(".omnimux-publish-asset-card").click(); return true')
      await waitForSubscreen(true)
      await Promise.race([
        detailRequested,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for detail HTTP request')), 5000)),
      ])
      const detailLoadingBack = await evalJson(`${REGION_INSPECT_FN} return { headCount: document.querySelectorAll('.omnimux-publish-detail-head').length, back: inspectSubscreenButton('返回列表') }`)
      assert.equal(detailLoadingBack.headCount, 1)
      assert.equal(detailLoadingBack.back.found, true)
      assert.equal(detailLoadingBack.back.draggable, false, `detail loading back button must not be drag: ${JSON.stringify(detailLoadingBack)}`)
      assert.equal(typeof releaseDetail, 'function', 'detail request handler must be armed before release')
      releaseDetail()
      releaseDetail = null
      await waitForCondition('document.querySelector(".omnimux-publish-tasks")', 'detail subtasks rendered')
      const detailLoaded = await evalJson(`${REGION_INSPECT_FN} return { back: inspectSubscreenButton('返回列表'), refresh: inspectSubscreenButton('同步平台状态') }`)
      assert.equal(detailLoaded.back.found, true)
      assert.equal(detailLoaded.back.hitByElementFromPoint, true)
      assert.equal(detailLoaded.back.draggable, false)
      assert.equal(detailLoaded.refresh.found, true)
      assert.equal(detailLoaded.refresh.draggable, false)
      const detailShot = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
      assertPng(detailShot)
      writeFileSync(join(evidenceDir, 'real-after-detail-dark.png'), detailShot)
      await mouseClickAt(detailLoaded.back.x, detailLoaded.back.y)
      await waitForSubscreen(false)

      // 4. 亮色主题 + 窄屏（820x720）：检查图文编辑页「返回列表」
      await evalJson('document.body.removeAttribute("data-ds-dark-theme"); return true')
      await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 720, deviceScaleFactor: 2, mobile: false })
      await evalJson('[...document.querySelectorAll("button")].find((b) => b.textContent.includes("新增发布")).click(); return true')
      await waitForSubscreen(true)
      await evalJson('[...document.querySelectorAll(".omnimux-publish-type-card")].find((b) => b.textContent.includes("图文")).click(); return true')
      await waitForCondition(
        'document.querySelector(".omnimux-publish-editor-head") && document.querySelector(".omnimux-publish-subscreen")?.textContent.includes("GeminiX")',
        'image composer editor + accounts settled (light narrow)',
      )
      await evalJson('return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
      const narrowBack = await evalJson(`${REGION_INSPECT_FN} return inspectSubscreenButton('返回列表')`)
      assert.equal(narrowBack.found, true)
      assert.equal(narrowBack.hitByElementFromPoint, true)
      assert.equal(narrowBack.draggable, false)
      assert.equal(narrowBack.decidedRegion, 'no-drag')
      const narrowShot = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
      assertPng(narrowShot)
      writeFileSync(join(evidenceDir, 'real-after-composer-light-narrow.png'), narrowShot)
      await mouseClickAt(narrowBack.x, narrowBack.y)
      await waitForSubscreen(false)
    } finally {
      try { ws?.close() } catch {}
      try { chrome?.kill('SIGKILL') } catch {}
      try { server?.close() } catch {}
      try { rmSync(profileDir, { recursive: true, force: true }) } catch {}
    }
  })
})
