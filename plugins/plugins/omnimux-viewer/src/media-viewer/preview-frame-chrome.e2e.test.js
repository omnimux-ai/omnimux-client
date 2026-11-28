/**
 * 图像生成右侧预览图去黑边、去浅灰光晕与真圆角真实浏览器几何 E2E 回归测试 (Issue #434)
 * 对应规格：specs/fix-viewer-preview-chrome.spec.md
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChromePath } from '../../../../scripts/worktree-web-qa.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../../..');
const pluginsRoot = resolve(repoRoot, 'plugins');
const require = createRequire(join(pluginsRoot, 'plugins/omnimux-viewer/package.json'));
const esbuild = require('esbuild');

const FALLBACK_THEME_CSS = `
:root {
  --dsw-radius-xs: 4px;
  --dsw-radius-sm: 8px;
  --dsw-radius-md: 12px;
  --dsw-radius-lg: 16px;
  --dsw-font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
body {
  --dsw-alias-bg-base: rgb(255, 255, 255);
  --dsw-alias-bg-layer-1: rgb(255, 255, 255);
  --dsw-alias-bg-layer-2: rgb(245, 247, 250);
  --dsw-alias-bg-layer-3: rgb(235, 238, 242);
  --dsw-alias-bg-elevated: rgb(255, 255, 255);
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.24);
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);
  --dsw-alias-border-l3: rgba(0, 0, 0, 0.12);
  --dsw-alias-border-hover: rgba(0, 0, 0, 0.2);
  --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);
  --dsw-alias-interactive-bg-active: rgba(38, 49, 72, 0.1);
  --dsw-alias-label-primary: rgb(15, 17, 21);
  --dsw-alias-label-secondary: rgb(97, 102, 107);
  --dsw-alias-label-tertiary: rgb(129, 133, 140);
  --dsw-alias-brand-primary: rgb(15, 17, 21);
  --dsw-alias-state-error-primary: rgb(236, 19, 19);
}
body[data-ds-dark-theme] {
  --dsw-alias-bg-base: rgb(21, 21, 23);
  --dsw-alias-bg-layer-1: rgb(35, 35, 36);
  --dsw-alias-bg-layer-2: rgb(44, 44, 46);
  --dsw-alias-bg-layer-3: rgb(53, 54, 56);
  --dsw-alias-bg-elevated: rgb(28, 28, 31);
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.5);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-border-hover: rgba(255, 255, 255, 0.24);
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.14);
  --dsw-alias-label-primary: rgb(249, 250, 251);
  --dsw-alias-label-secondary: rgb(207, 211, 214);
  --dsw-alias-label-tertiary: rgb(173, 178, 184);
  --dsw-alias-brand-primary: rgb(249, 250, 251);
  --dsw-alias-state-error-primary: rgb(242, 90, 90);
}
`;

function loadHostThemeCss() {
  const basePath = join(repoRoot, 'app/deepseek-harness/packages/client/ui-theme/src/styles/base.css');
  const platformPath = join(repoRoot, 'app/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css');
  if (existsSync(basePath) && existsSync(platformPath)) {
    return `${readFileSync(basePath, 'utf8')}\n${readFileSync(platformPath, 'utf8')}`;
  }
  return FALLBACK_THEME_CSS;
}

async function buildRealViewerHtml(tmpDir) {
  const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MediaViewerTab } from './plugins/omnimux-viewer/src/media-viewer/MediaViewerTab.jsx';
import { getGlobalMediaViewerStore } from './plugins/omnimux/src/client/media-viewer/media-viewer-store.js';

function makeRaster(w, h, bgA, bgB) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, bgA);
  g.addColorStop(1, bgB);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
}

const CATALOG = {
  image: [{
    id: 'gpt-image-2-5',
    label: 'GPT Image 2.5',
    family: 'openai',
    parameters: {
      aspectRatio: { defaultValue: '1:1', options: ['1:1', '3:4', '16:9', '9:16'] },
      resolution: { defaultValue: '1K', options: ['1K'] },
      n: { defaultValue: 1, options: [1, 2, 4] },
    },
    channelGroups: [{
      id: 'standard',
      label: '标准版',
      default: true,
      pricing: { pointsEstimate: 1, billingMode: 'per_task', discountRate: 1 },
    }],
    operations: [{ id: 'text_to_image', output: { type: 'image' }, inputs: [{ slot: 'prompt', type: 'text', role: 'prompt', min: 1, max: 1 }] }],
  }],
};

window.fetch = async (url) => {
  const path = String(url);
  if (path === '/omnimux/model-catalog') {
    return new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path === '/omnimux/assets/state') {
    return new Response(JSON.stringify({ assets: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

try { window.localStorage.clear(); } catch {}

const store = getGlobalMediaViewerStore();
const now = 1760000000000;
store.addMedia({ id: 'portrait-1', sessionId: 's1', timestamp: now + 5000, type: 'image', status: 'completed', url: makeRaster(512, 890, '#1e1b5e', '#4f35b8'), title: '竖图 512x890' });
store.addMedia({ id: 'landscape-1', sessionId: 's1', timestamp: now + 4000, type: 'image', status: 'completed', url: makeRaster(1280, 720, '#36195b', '#e66c37'), title: '横图 1280x720' });
store.addMedia({ id: 'square-1', sessionId: 's1', timestamp: now + 3000, type: 'image', status: 'completed', url: makeRaster(800, 800, '#0f3443', '#2ab885'), title: '方图 800x800' });
store.addMedia({ id: 'gen-3-4', sessionId: 's1', timestamp: now + 2000, type: 'image', status: 'generating', aspectRatio: '3:4', title: '生成中 3:4' });
store.addMedia({ id: 'fail-1', sessionId: 's1', timestamp: now + 1000, type: 'image', status: 'failed', aspectRatio: '1:1', title: '失败态', failure: { reason: '请求超时', retryable: false } });
store.setActiveId('portrait-1');
window.__viewerStore = store;

const sessions = {
  list: {
    getSnapshot: () => ({ current: 's1' }),
    subscribe: () => () => {},
  },
};

createRoot(document.getElementById('root')).render(React.createElement(MediaViewerTab, { sessions }));
window.__viewerReady = true;
`;

  const bundleOut = join(tmpDir, 'viewer-e2e.js');
  await esbuild.build({
    stdin: { contents: entrySource, resolveDir: pluginsRoot, loader: 'jsx' },
    bundle: true,
    format: 'iife',
    outfile: bundleOut,
    alias: {
      'dsh-ui-kit': join(pluginsRoot, 'packages/dsh-ui-kit/lib/index.js'),
    },
    nodePaths: [join(repoRoot, 'node_modules'), join(pluginsRoot, 'node_modules')],
    loader: { '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const bundleCode = readFileSync(bundleOut, 'utf8');
  const themeCss = loadHostThemeCss();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Preview Chrome E2E</title>
  <style>
${themeCss}
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family);
    }
    #root {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body data-ds-dark-theme="true">
  <div id="root"></div>
  <script>${bundleCode}</script>
</body>
</html>`;
}

async function launchChrome(profileDir) {
  mkdirSync(profileDir, { recursive: true });
  const chromeArgs = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=920,820',
    'about:blank',
  ];
  if (process.platform === 'linux') {
    chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
  }
  const proc = spawn(findChromePath(), chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  const cdpPort = await new Promise((resolvePort, rejectPort) => {
    const portFile = join(profileDir, 'DevToolsActivePort');
    const stderrTail = [];
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      fn(val);
    };
    const poll = setInterval(() => {
      try {
        if (!existsSync(portFile)) return;
        const port = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim());
        if (Number.isInteger(port) && port > 0) finish(resolvePort, port);
      } catch {}
    }, 80);
    const deadline = setTimeout(() => finish(rejectPort, new Error(`Chrome startup timeout: ${stderrTail.join('')}`)), 25000);
    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrTail.push(s);
      const m = s.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) finish(resolvePort, Number(m[1]));
    });
    proc.on('error', (err) => finish(rejectPort, err));
  });

  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
  const pageTarget = targets.find((item) => item.type === 'page');
  assert.ok(pageTarget?.webSocketDebuggerUrl, 'Expected page CDP target');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let seq = 0;
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      const onMsg = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          ws.removeEventListener('message', onMsg);
          if (msg.error) rej(new Error(`CDP ${method}: ${JSON.stringify(msg.error)}`));
          else res(msg.result || msg);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) {
      throw new Error(`Browser exception: ${JSON.stringify(out.exceptionDetails)}`);
    }
    return out.result?.value;
  };

  return { proc, ws, send, evaluate };
}

async function stopChrome(chrome) {
  if (!chrome) return;
  try { chrome.ws?.close(); } catch {}
  const proc = chrome.proc;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolveExit) => proc.once('exit', resolveExit));
  try { proc.kill('SIGTERM'); } catch {}
  const timer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch {}
  }, 3000);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]);
  clearTimeout(timer);
}

test('E2E: 图像生成右侧预览图零黑边、无外围浅灰光晕、12px真圆角与动态输入框避让', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'omx-preview-chrome-e2e-'));
  const profileDir = join(tmpDir, 'profile');
  const html = await buildRealViewerHtml(tmpDir);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  let chrome = null;
  t.after(async () => {
    await stopChrome(chrome);
    try { server.close(); } catch {}
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  chrome = await launchChrome(profileDir);
  const { send, evaluate } = chrome;

  await send('Emulation.setDeviceMetricsOverride', { width: 920, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await evaluate(`new Promise((res, rej) => {
    const deadline = Date.now() + 10000;
    const tick = () => {
      if (window.__viewerReady === true && document.querySelector('.omx-media-slot img')?.complete) res(true);
      else if (Date.now() > deadline) rej(new Error('Viewer image load timeout (10s)'));
      else setTimeout(tick, 30);
    };
    tick();
  })`);
  await new Promise((r) => setTimeout(r, 200));

  const measureExpr = `(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const display = document.querySelector('.omx-mv-display');
    const slot = document.querySelector('.omx-media-slot');
    const img = document.querySelector('.omx-media-slot img');
    const thumbs = document.querySelector('.omx-mv-thumbnails-rail');
    const composer = document.querySelector('.omx-mv-composer-outer');
    const dr = display.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    const ir = img ? img.getBoundingClientRect() : null;
    const tr = thumbs ? thumbs.getBoundingClientRect() : null;
    const cr = composer.getBoundingClientRect();
    const ds = getComputedStyle(display);
    const ss = getComputedStyle(slot);
    const is = img ? getComputedStyle(img) : null;
    const target = ir || sr;
    return {
      displayShadow: ds.boxShadow,
      slotShadow: ss.boxShadow,
      displayOverflow: ds.overflow,
      slotRadius: ss.borderRadius,
      imgRadius: is ? is.borderRadius : null,
      displayW: dr.width,
      displayH: dr.height,
      slotW: sr.width,
      slotH: sr.height,
      imgW: ir ? ir.width : null,
      imgH: ir ? ir.height : null,
      natW: img ? img.naturalWidth : null,
      natH: img ? img.naturalHeight : null,
      composerTop: cr.top,
      composerH: cr.height,
      overlapComposer: Math.max(0, target.bottom - cr.top),
      overlapThumbs: tr ? Math.max(0, tr.right - target.left) : 0,
    };
  })()`;

  const assertCompletedMetrics = (m, label) => {
    assert.equal(m.displayShadow, 'none', `${label}: .omx-mv-display 不得有阴影光晕`);
    assert.equal(m.slotShadow, 'none', `${label}: .omx-media-slot 不得有阴影光晕`);
    assert.equal(m.displayOverflow, 'visible', `${label}: .omx-mv-display 必须保持 overflow: visible`);
    assert.equal(m.slotRadius, '12px', `${label}: 容器圆角应为 12px`);
    assert.equal(m.imgRadius, '12px', `${label}: 图片圆角应为 12px`);
    assert.equal(Math.abs(m.slotW - m.imgW) <= 1, true, `${label}: 容器宽度应紧贴图片 (${m.slotW} vs ${m.imgW})`);
    assert.equal(Math.abs(m.slotH - m.imgH) <= 1, true, `${label}: 容器高度应紧贴图片 (${m.slotH} vs ${m.imgH})`);
    assert.equal(Math.abs(m.displayW - m.imgW) <= 1, true, `${label}: .omx-mv-display 宽度应紧贴图片 (${m.displayW} vs ${m.imgW})`);
    assert.equal(Math.abs(m.displayH - m.imgH) <= 1, true, `${label}: .omx-mv-display 高度应紧贴图片 (${m.displayH} vs ${m.imgH})`);
    const natRatio = m.natW / m.natH;
    const renRatio = m.imgW / m.imgH;
    assert.equal(Math.abs(natRatio - renRatio) <= 0.02, true, `${label}: 图片宽高比须与原图一致 (${renRatio} vs ${natRatio})`);
    assert.equal(m.overlapComposer, 0, `${label}: 不得遮挡底部悬浮输入框 (overlap=${m.overlapComposer})`);
    assert.equal(m.overlapThumbs, 0, `${label}: 不得压住左侧缩略图栏 (overlap=${m.overlapThumbs})`);
  };

  // 1. 暗色宽屏：竖图 512x890（未传 aspectRatio）、横图 1280x720、方图 800x800
  const portraitDark = await evaluate(measureExpr);
  assertCompletedMetrics(portraitDark, 'dark-wide-portrait');

  await evaluate(`window.__viewerStore.setActiveId('landscape-1')`);
  const landscapeDark = await evaluate(measureExpr);
  assertCompletedMetrics(landscapeDark, 'dark-wide-landscape');

  await evaluate(`window.__viewerStore.setActiveId('square-1')`);
  const squareDark = await evaluate(measureExpr);
  assertCompletedMetrics(squareDark, 'dark-wide-square');

  // 2. 底部输入框多行撑高动态避让（输入 6 行提示词）
  await evaluate(`window.__viewerStore.setActiveId('portrait-1')`);
  const multilineDark = await evaluate(`(async () => {
    const ta = document.querySelector('.omx-mv-prompt-textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '第1行\\n第2行\\n第3行\\n第4行\\n第5行\\n第6行');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    return await ${measureExpr};
  })()`);
  assertCompletedMetrics(multilineDark, 'dark-wide-multiline');
  assert.equal(multilineDark.composerH > portraitDark.composerH, true, '多行提示词应撑高底部输入框');
  assert.equal(multilineDark.imgH < portraitDark.imgH, true, '输入框撑高后图片高度应自适应缩小避让');

  // 3. 浅色主题
  await evaluate(`(async () => {
    const ta = document.querySelector('.omx-mv-prompt-textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.removeAttribute('data-ds-dark-theme');
  })()`);
  const portraitLight = await evaluate(measureExpr);
  assertCompletedMetrics(portraitLight, 'light-wide-portrait');

  // 4. 窄屏 460px
  await evaluate(`document.body.setAttribute('data-ds-dark-theme', 'true')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 460, height: 780, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 150));
  const portraitNarrow = await evaluate(measureExpr);
  assertCompletedMetrics(portraitNarrow, 'dark-narrow-portrait');

  // 5. 生成中 3:4 与失败卡槽保持正常尺寸、无阴影光晕且不遮挡
  await send('Emulation.setDeviceMetricsOverride', { width: 920, height: 820, deviceScaleFactor: 1, mobile: false });
  await evaluate(`window.__viewerStore.setActiveId('gen-3-4')`);
  const genMetrics = await evaluate(measureExpr);
  assert.equal(genMetrics.slotShadow, 'none');
  assert.equal(genMetrics.slotW > 200 && genMetrics.slotH > 200, true, '3:4 生成中卡槽不得塌陷');
  assert.equal(genMetrics.overlapComposer, 0);

  await evaluate(`window.__viewerStore.setActiveId('fail-1')`);
  const failMetrics = await evaluate(measureExpr);
  assert.equal(failMetrics.slotShadow, 'none');
  assert.equal(failMetrics.slotW > 200 && failMetrics.slotH > 200, true, '失败卡槽不得塌陷');
  assert.equal(failMetrics.overlapComposer, 0);

  // 6. 边缘打点评论图钉不被裁切
  await evaluate(`window.__viewerStore.setActiveId('portrait-1')`);
  const pinState = await evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 80));
    const draft = window.__viewerStore.addDraftAnnotation('portrait-1', { xPercent: 98, yPercent: 6 });
    window.__viewerStore.commitAnnotation('portrait-1', draft.id, '边缘微调');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pin = document.querySelector('.omx-mv-annotation-pin');
    const display = document.querySelector('.omx-mv-display');
    const pr = pin.getBoundingClientRect();
    const dr = display.getBoundingClientRect();
    return {
      overflow: getComputedStyle(display).overflow,
      pinRightExceedsDisplay: pr.right > dr.right,
      pinWidth: pr.width,
      pinHeight: pr.height,
    };
  })()`);
  assert.equal(pinState.overflow, 'visible');
  assert.equal(pinState.pinWidth > 0 && pinState.pinHeight > 0, true);
  assert.equal(pinState.pinRightExceedsDisplay, true, '边缘图钉应可越出 .omx-mv-display 边界而不被裁切');
});
