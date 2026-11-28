import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findChromePath } from '../../scripts/worktree-web-qa.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pluginsRoot = resolve(here, '..', '..')
const repoRoot = resolve(pluginsRoot, '..')
const require = createRequire(import.meta.url)

async function buildLiveKitHarnessHtml() {
  const esbuild = require(join(pluginsRoot, 'node_modules/esbuild'))
  const entryCode = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import {
      Button,
      CopyButton,
      Drawer,
      PageHeader,
      SelectableTile,
      Tabs,
      Badge,
    } from "dsh-ui-kit";

    function App() {
      const [tab, setTab] = useState("overview");
      const [drawerOpen, setDrawerOpen] = useState(false);
      const [selectedA, setSelectedA] = useState(true);
      const [rows] = useState(() => Array.from({ length: 500 }, (_, i) => i + 1));

      const tabItems = [
        { id: "overview", label: "总览", badge: 12 },
        { id: "assets", label: "云端素材库", badge: 48 },
        { id: "settings", label: "高级设置" },
      ];

      return (
        <div id="kit-harness">
          <PageHeader
            title="Live Kit E2E"
            subtitle="Real built bundle"
            refreshing={true}
            onRefresh={() => {}}
          />
          <Tabs id="live-tabs-underline" variant="underline" items={tabItems} activeId={tab} onChange={setTab} />
          <Tabs id="live-tabs-pill" variant="pill" items={tabItems} activeId={tab} onChange={setTab} />
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <CopyButton id="live-copy-btn" text="omx-e2e" label="复制指令" copiedLabel="已复制指令" />
            <Button id="live-open-drawer" size="sm" variant="primary" onClick={() => setDrawerOpen(true)}>打开</Button>
            <Button id="live-bg-btn" size="sm" variant="secondary" onClick={() => {
              const el = document.getElementById("live-bg-count");
              el.textContent = String(Number(el.textContent || "0") + 1);
            }}>底层(<span id="live-bg-count">0</span>)</Button>
            <Badge variant="success">60fps</Badge>
          </div>
          <div style={{ marginTop: 12 }}>
            <SelectableTile id="live-tile-a" mode="checkbox" selected={selectedA} onToggle={() => setSelectedA((v) => !v)} title="卡片" />
          </div>
          <div id="scroll-container" style={{ height: 220, overflowY: "auto", marginTop: 12 }}>
            {rows.map((idx) => (
              <div key={idx} style={{ height: 28 }}>Row {idx}</div>
            ))}
          </div>
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="E2E Drawer" width={340}>
            <div style={{ padding: 16 }}>
              <Button id="live-close-drawer" size="sm" onClick={() => setDrawerOpen(false)}>关闭</Button>
            </div>
          </Drawer>
        </div>
      );
    }
    createRoot(document.getElementById("root")).render(<App />);
  `

  const primitivesStub = `
    import React from "react";
    const makeIcon = (name) => (props) => React.createElement("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 16 16", "data-icon": name }, React.createElement("circle", { cx: 8, cy: 8, r: 5, fill: "none", stroke: "currentColor", strokeWidth: 1.5 }));
    export const IconCheckOutline16 = makeIcon("check");
    export const IconChevronDownOutline14 = makeIcon("chevron-down");
    export const IconChevronUpOutline14 = makeIcon("chevron-up");
    export const IconChevronLeftOutline14 = makeIcon("chevron-left");
    export const IconCloseFill14 = makeIcon("close-fill");
    export const IconCloseOutline16 = makeIcon("close");
    export const IconCopyOutline16 = makeIcon("copy");
    export const IconDownloadOutline16 = makeIcon("download");
    export const IconEditOutline16 = makeIcon("edit");
    export const IconEllipsisOutline16 = makeIcon("ellipsis");
    export const IconLoadingOutline16 = makeIcon("loading");
    export const IconPaperclipOutline16 = makeIcon("paperclip");
    export const IconPlayOutline16 = makeIcon("play");
    export const IconPlusOutline16 = makeIcon("plus");
    export const IconRefreshOutline14 = makeIcon("refresh14");
    export const IconRefreshOutline16 = makeIcon("refresh16");
    export const IconRightUpOutline14 = makeIcon("right-up");
    export const IconSearchOutline16 = makeIcon("search");
    export const IconTrashOutline16 = makeIcon("trash");
    export const Modal = ({ open, children }) => open ? React.createElement("div", { role: "dialog" }, children) : null;
    export const Tooltip = ({ children }) => children;
  `

  const buildRes = await esbuild.build({
    stdin: { contents: entryCode, resolveDir: join(pluginsRoot, 'packages/dsh-ui-kit'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'shim-primitives',
        setup(b) {
          b.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'shim' }))
          b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: primitivesStub, loader: 'js', resolveDir: pluginsRoot }))
        },
      },
    ],
  })

  const js = buildRes.outputFiles[0].text
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>dsh-ui-kit E2E</title>
<style>
  :root {
    --dsw-alias-bg-primary: #ffffff;
    --dsw-alias-bg-secondary: #f4f5f8;
    --dsw-alias-bg-layer-1: #eff1f5;
    --dsw-alias-bg-layer-2: #e6e9f0;
    --dsw-alias-bg-layer-3: #ffffff;
    --dsw-alias-border-l1: rgba(15, 20, 32, 0.12);
    --dsw-alias-border-l2: rgba(15, 20, 32, 0.2);
    --dsw-alias-label-primary: #14171f;
    --dsw-alias-label-secondary: #5a6170;
    --dsw-alias-label-tertiary: #8a92a2;
    --dsw-alias-interactive-bg-hover: rgba(15, 20, 32, 0.05);
    --dsw-alias-interactive-bg-active: rgba(15, 20, 32, 0.1);
    --dsw-alias-interactive-bg-brand-hover: rgba(65, 118, 230, 0.12);
    --dsw-alias-interactive-bg-primary: #4176e6;
    --dsw-alias-interactive-label-primary: #ffffff;
    --dsw-alias-brand-primary: #4176e6;
    --dsw-alias-state-success-primary: #16a34a;
    --dsw-alias-state-error-primary: #dc2626;
    --dsw-alias-bg-mask: rgba(15, 20, 32, 0.45);
  }
  body { margin: 0; background: var(--dsw-alias-bg-primary); color: var(--dsw-alias-label-primary); }
</style>
<script>
  try {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
  } catch {}
</script>
</head>
<body><div id="root"></div><script>${js}</script></body>
</html>`
}

async function launchHeadlessChrome(profileDir) {
  mkdirSync(profileDir, { recursive: true })
  const chromeArgs = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ]
  if (process.platform === 'linux') {
    chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage')
  }
  const proc = spawn(findChromePath(), chromeArgs)

  const cdpPort = await new Promise((resolvePort, rejectPort) => {
    const portFile = join(profileDir, 'DevToolsActivePort')
    const stderrTail = []
    let settled = false
    const finish = (fn, val) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(deadline)
      fn(val)
    }
    const poll = setInterval(() => {
      try {
        if (!existsSync(portFile)) return
        const p = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim())
        if (Number.isInteger(p) && p > 0) finish(resolvePort, p)
      } catch {}
    }, 80)
    const deadline = setTimeout(() => finish(rejectPort, new Error(`Chrome timeout: ${stderrTail.join('')}`)), 25000)
    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString()
      stderrTail.push(s)
      const m = s.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (m) finish(resolvePort, Number(m[1]))
    })
    proc.on('error', (err) => finish(rejectPort, err))
  })

  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json())
  const pageTarget = targets.find((t) => t.type === 'page')
  assert.ok(pageTarget?.webSocketDebuggerUrl, 'Expected page CDP target')

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  let seq = 0
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      const onMsg = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id === id) {
          ws.removeEventListener('message', onMsg)
          if (msg.error) rej(new Error(`CDP ${method}: ${JSON.stringify(msg.error)}`))
          else res(msg.result || msg)
        }
      }
      ws.addEventListener('message', onMsg)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  await send('Page.enable')
  await send('Runtime.enable')

  const evaluate = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (out.exceptionDetails) {
      throw new Error(`Browser exception: ${JSON.stringify(out.exceptionDetails)}`)
    }
    return out.result?.value
  }

  return { proc, ws, send, evaluate }
}

describe('Apple motion system real-browser E2E', () => {
  it('verifies demo and compiled dsh-ui-kit components across viewports, themes, reduced-motion, 60fps & zero CLS', async () => {
    const demoHtml = readFileSync(join(repoRoot, 'ui-demo/apple-motion-system-demo.html'), 'utf8')
    const kitHtml = await buildLiveKitHarnessHtml()
    const profileDir = join(tmpdir(), `omx-motion-e2e-${randomUUID().slice(0, 8)}`)

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(req.url === '/kit-live' ? kitHtml : demoHtml)
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port

    let chrome = null
    try {
      chrome = await launchHeadlessChrome(profileDir)
      const { send, evaluate } = chrome

      // --- Target A: High-fidelity before/after demo ---
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/demo` })
      await new Promise((r) => setTimeout(r, 350))

      const demoDesktop = await evaluate(`(async function() {
        document.querySelector('[data-theme-btn="light"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const overflowLight = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);

        const tabs = Array.from(document.querySelectorAll('#tabs-after-underline [role="tab"]'));
        const w0 = tabs.map((t) => t.getBoundingClientRect().width);
        tabs[1]?.click();
        await new Promise((r) => setTimeout(r, 240));
        const w1 = tabs.map((t) => t.getBoundingClientRect().width);
        const tabDelta = Math.max(...w0.map((w, i) => Math.abs(w - w1[i])));

        const copyBtn = document.getElementById('copy-after-btn');
        const c0 = copyBtn.getBoundingClientRect().width;
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const c1 = copyBtn.getBoundingClientRect().width;

        let cls = 0;
        const po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) cls += entry.value;
          }
        });
        try { po.observe({ type: 'layout-shift', buffered: false }); } catch {}

        const frameTimes = [];
        await new Promise((done) => {
          let last = performance.now();
          let n = 0;
          const tick = (now) => {
            frameTimes.push(now - last);
            last = now;
            n++;
            if (n === 10) tabs[2]?.click();
            if (n === 25) tabs[0]?.click();
            if (n < 60) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame((t0) => { last = t0; requestAnimationFrame(tick); });
        });
        try { po.disconnect(); } catch {}
        const avg = frameTimes.filter((x) => x > 0).reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
        const fps = avg > 0 ? Math.round(1000 / avg) : 0;

        document.querySelector('[data-theme-btn="dark"]')?.click();
        await new Promise((r) => setTimeout(r, 100));
        const overflowDark = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
        return { overflowLight, overflowDark, tabDelta, copyDelta: Math.abs(c1 - c0), fps, cls };
      })()`)

      assert.equal(demoDesktop.overflowLight, 0)
      assert.equal(demoDesktop.overflowDark, 0)
      assert.equal(demoDesktop.tabDelta <= 0.5, true, `Demo Tabs width shift=${demoDesktop.tabDelta}`)
      assert.equal(demoDesktop.copyDelta <= 0.5, true, `Demo CopyButton width shift=${demoDesktop.copyDelta}`)
      assert.equal(demoDesktop.cls, 0)
      assert.equal(demoDesktop.fps >= 55, true, `Demo FPS=${demoDesktop.fps}`)

      // 390px mobile viewport
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await new Promise((r) => setTimeout(r, 150))
      const narrowOverflow = await evaluate(`Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)`)
      assert.equal(narrowOverflow, 0)

      // Reduced motion OS feature check
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      const reducedDur = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--omnimux-motion-dur-fast').trim()`)
      assert.equal(reducedDur, '0ms')

      // --- Target B: Real compiled dsh-ui-kit React components ---
      await send('Emulation.setEmulatedMedia', { features: [] })
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/kit-live` })
      await new Promise((r) => setTimeout(r, 350))

      const kitLive = await evaluate(`(async function() {
        const styleNode = document.querySelector('style[data-dsh-ui-kit="omnimux-motion-tokens"]');
        const rootStyle = getComputedStyle(document.documentElement);
        const underline = document.getElementById('live-tabs-underline');
        const pill = document.getElementById('live-tabs-pill');
        const tabs = Array.from(underline.querySelectorAll('[role="tab"]'));
        const tabTexts = tabs.map((t) => t.textContent);
        const wBefore = tabs.map((t) => t.getBoundingClientRect().width);
        tabs[1].click();
        await new Promise((r) => setTimeout(r, 240));
        const wAfter = tabs.map((t) => t.getBoundingClientRect().width);
        const tabDelta = Math.max(...wBefore.map((w, i) => Math.abs(w - wAfter[i])));

        const copyBtn = document.getElementById('live-copy-btn');
        const idleText = copyBtn.textContent;
        const c0 = copyBtn.getBoundingClientRect().width;
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 80));
        const copiedText = copyBtn.textContent;
        const c1 = copyBtn.getBoundingClientRect().width;

        document.getElementById('live-open-drawer').click();
        await new Promise((r) => setTimeout(r, 240));
        const dialog = document.querySelector('[role="dialog"]');
        const drawerRoot = dialog?.closest('[data-phase]');
        const phaseOpen = drawerRoot?.getAttribute('data-phase');

        document.getElementById('live-close-drawer').click();
        await new Promise((r) => setTimeout(r, 40));
        const phaseExiting = drawerRoot?.getAttribute('data-phase');
        const exitingPointerEvents = drawerRoot ? getComputedStyle(drawerRoot).pointerEvents : null;

        document.getElementById('live-open-drawer').click();
        await new Promise((r) => setTimeout(r, 240));
        const phaseInterrupted = drawerRoot?.getAttribute('data-phase');

        document.getElementById('live-close-drawer').click();
        await new Promise((r) => setTimeout(r, 260));

        const refreshAnims = Array.from(document.querySelectorAll('svg')).filter((el) => {
          const name = getComputedStyle(el).animationName;
          return name && name !== 'none';
        }).length;

        const scroller = document.getElementById('scroll-container');
        let scrollCls = 0;
        const spo = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) scrollCls += e.value;
          }
        });
        try { spo.observe({ type: 'layout-shift', buffered: false }); } catch {}
        const scrollTimes = [];
        await new Promise((done) => {
          let last = performance.now();
          let n = 0;
          const tick = (now) => {
            scrollTimes.push(now - last);
            last = now;
            n++;
            scroller.scrollTop = n * 40;
            if (n < 60) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame((t0) => { last = t0; requestAnimationFrame(tick); });
        });
        try { spo.disconnect(); } catch {}
        const scrollAvg = scrollTimes.filter((x) => x > 0).reduce((a, b) => a + b, 0) / Math.max(1, scrollTimes.length);
        const scrollFps = scrollAvg > 0 ? Math.round(1000 / scrollAvg) : 0;

        return {
          hasTokenNode: Boolean(styleNode),
          easeOut: rootStyle.getPropertyValue('--omnimux-motion-ease-out').trim(),
          easeSpatial: rootStyle.getPropertyValue('--omnimux-motion-ease-spatial').trim(),
          easeExit: rootStyle.getPropertyValue('--omnimux-motion-ease-exit').trim(),
          underlineReady: underline.getAttribute('data-indicator'),
          pillReady: pill.getAttribute('data-indicator'),
          tabTexts,
          tabDelta,
          idleText,
          copiedText,
          copyDelta: Math.abs(c1 - c0),
          phaseOpen,
          phaseExiting,
          exitingPointerEvents,
          phaseInterrupted,
          refreshAnims,
          scrollFps,
          scrollCls,
        };
      })()`)

      assert.equal(kitLive.hasTokenNode, true)
      assert.equal(kitLive.easeOut, 'cubic-bezier(0.16, 1, 0.3, 1)')
      assert.equal(kitLive.easeSpatial, 'cubic-bezier(0.32, 0.72, 0, 1)')
      assert.equal(kitLive.easeExit, 'cubic-bezier(0.32, 0, 0.67, 0)')
      assert.equal(kitLive.underlineReady, 'ready')
      assert.equal(kitLive.pillReady, 'ready')
      assert.deepEqual(kitLive.tabTexts, ['总览12', '云端素材库48', '高级设置'])
      assert.equal(kitLive.tabDelta <= 0.5, true, `Kit Tabs width shift=${kitLive.tabDelta}`)
      assert.equal(kitLive.idleText, '复制指令')
      assert.equal(kitLive.copiedText, '已复制指令')
      assert.equal(kitLive.copyDelta <= 0.5, true, `Kit CopyButton width shift=${kitLive.copyDelta}`)
      assert.equal(kitLive.phaseOpen, 'entered')
      assert.equal(kitLive.phaseExiting, 'exiting')
      assert.equal(kitLive.exitingPointerEvents, 'none')
      assert.equal(kitLive.phaseInterrupted, 'entered')
      assert.equal(kitLive.refreshAnims >= 1, true, 'PageHeader refresh icon should animate')
      assert.equal(kitLive.scrollCls, 0)
      assert.equal(kitLive.scrollFps >= 55, true, `500-row scroll FPS=${kitLive.scrollFps}`)

      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      const kitReducedDur = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--omnimux-motion-dur-fast').trim()`)
      assert.equal(kitReducedDur, '0ms')
    } finally {
      if (chrome?.ws) {
        try { chrome.ws.close() } catch {}
      }
      if (chrome?.proc) {
        try { chrome.proc.kill('SIGTERM') } catch {}
      }
      try { server.close() } catch {}
      try { rmSync(profileDir, { recursive: true, force: true }) } catch {}
    }
  })
})
