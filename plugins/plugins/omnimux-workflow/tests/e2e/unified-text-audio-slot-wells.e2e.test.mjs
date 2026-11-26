/**
 * Issue #339 — 真实生产包 + 真实 DSH 主题 + 真实 Chromium（ego-browser）端到端验收：
 *
 * 1. 首帧（named）+ 长名称文本：图片与文本同处顶部 wf-slot-wells，无底部 wf-prompt-references；
 * 2. 全能参考（strip）+ 图片 + 长名称文本 + 长名称音频：全部排在 + 添加位之前，44×44 单行省略截断，无溢出；
 * 3. 首尾帧（pair）+ 文本：保留首尾帧互换按钮，文本并排顶部；
 * 4. 数字人（named）+ 驱动音频：已填音频展示图标 + 节点名，不与底标重叠；
 * 5. 亮/暗双主题与窄屏下悬停预览（标题 + 正文/音频播放 + 不透明表面 ≥4.5:1 对比度 + 替换/停用）完整可用。
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBundledSnapshot } from '../../../omnimux/src/catalog/cloud/bundled.js';
import { buildModelCatalog } from '../../../omnimux/src/catalog/list.js';

const plugin = fileURLToPath(new URL('../..', import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));

function makeSilentWav() {
  const samples = Buffer.alloc(16000, 0x80); // 2s 8kHz mono 8-bit PCM
  const wav = Buffer.alloc(44 + samples.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length, 40);
  samples.copy(wav, 44);
  return wav;
}

async function loadVendoredTheme() {
  const pin = JSON.parse(await readFile(join(root, 'dsh-version.json'), 'utf8')).dsh;
  const archive = join(root, 'app', dirname(pin.runtimeSource), `deepseek-ai-dsh-client-ui-theme-${pin.runtimePackageVersion}.tgz`);
  try {
    const direct = execFileSync('tar', ['-xOzf', archive, 'package/src/styles/design-platform.css'], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
    if (direct.includes('--dsw-')) return direct;
  } catch { /* fallback for older tarballs */ }
  const bundle = execFileSync('tar', ['-xOzf', archive, 'package/lib/client.js'], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
  const css = bundle.match(/var design_platform_css_default\s*=\s*("(?:[^"\\]|\\.)*")/)?.[1];
  assert.ok(css, 'The pinned DSH theme archive must carry design-platform.css');
  return JSON.parse(css);
}

async function mountServer(run, canvasBundle, themeCss) {
  const { mountWorkflowHost } = await import(pathToFileURL(join(plugin, 'dist/index.js')).href);
  const catalog = buildModelCatalog({ snapshot: structuredClone(readBundledSnapshot().snapshot), env: {} });
  const referencePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=', 'base64');
  const sampleWav = makeSilentWav();

  const routes = [];
  const appRoot = join(run, 'workflow');
  const dispose = mountWorkflowHost({
    webServer: { register(route) { routes.push(route); return () => {}; } },
    get: (name) => (name === 'modelCatalog' ? { list: () => catalog } : undefined),
  }, {
    paths: { root: appRoot, workspacesDir: join(appRoot, 'workspaces'), executionsDir: join(appRoot, 'executions'), mediaDir: join(appRoot, 'media') },
    libraryRoot: join(run, 'library'),
    gatewayMode: 'omnimux',
    env: {},
  });

  const workspaceIds = new Map();
  let origin = '';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const { pathname } = url;
    const scenario = url.searchParams.get('scenario') ?? 'strip';
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self' data:");
    if (pathname === '/canvas.js' || pathname === '/boot.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      const activeWorkspace = workspaceIds.get(scenario);
      return res.end(pathname === '/canvas.js'
        ? canvasBundle
        : `globalThis.__omnimuxWorkflowCanvas.mountCanvas(document.getElementById('root'),${JSON.stringify({ workspaceId: activeWorkspace, locale: 'zh' })});`);
    }
    if (pathname === '/theme.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(themeCss);
    }
    if (pathname === '/') {
      const dark = url.searchParams.get('theme') === 'dark';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="zh" data-theme="${dark ? 'dark' : 'light'}" data-platform="darwin"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Issue #339 Slot Wells QA</title><link rel="stylesheet" href="/theme.css"><style>html,body,#root{height:100%;margin:0}</style></head><body${dark ? ' data-ds-dark-theme="true"' : ''}><div id="root"></div><script src="/canvas.js"></script><script src="/boot.js?scenario=${encodeURIComponent(scenario)}"></script></body></html>`);
    }
    if (pathname === '/assets/dog.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(referencePng);
    }
    if (pathname === '/assets/voice.wav') {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(sampleWav);
    }
    const route = routes.find((candidate) => pathname.startsWith(candidate.path));
    if (route) return route.handler(req, res);
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${origin}/omnimux-workflow${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }

  const imgUrl = `${origin}/assets/dog.png`;
  const wavUrl = `${origin}/assets/voice.wav`;
  const imgNode = (id, label, y) => ({
    id, type: 'material', position: { x: 24, y },
    data: {
      label, materialType: 'image', nodeKind: 'import', selectedTool: 'image-import', status: 'ready',
      mediaUrl: imgUrl, mimeType: 'image/png', sizeBytes: referencePng.length,
      mediaAssets: [{ type: 'image', url: imgUrl, mimeType: 'image/png', sizeBytes: referencePng.length }],
      params: {},
    },
  });
  const txtNode = (id, label, content, y) => ({
    id, type: 'material', position: { x: 24, y },
    data: { label, content, materialType: 'text', nodeKind: 'import', selectedTool: 'text-editor', status: 'ready', params: {} },
  });
  const audNode = (id, label, y) => ({
    id, type: 'material', position: { x: 24, y },
    data: {
      label, materialType: 'audio', nodeKind: 'import', selectedTool: 'audio-import', status: 'ready',
      mediaUrl: wavUrl, mimeType: 'audio/wav', sizeBytes: sampleWav.length, durationSec: 2,
      mediaAssets: [{ type: 'audio', url: wavUrl, mimeType: 'audio/wav', sizeBytes: sampleWav.length, durationSec: 2 }],
      params: {},
    },
  });
  const mkEdge = (id, source, target) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'animated' });

  // Scenario 1: wan-3.0 video_multi_ref (strip) with image + long text + long audio + replacement text
  const stripWs = (await request('/api/workspaces', 'POST', { name: '全能参考统一卡槽' })).workspace.id;
  workspaceIds.set('strip', stripWs);
  await request(`/api/workspaces/${stripWs}`, 'PUT', {
    expectedVersion: 0,
    nodes: [
      imgNode('s-img', '首帧小狗.png', 20),
      txtNode('s-txt', '核心文案槽位 (Copywriting)', '雨后的橱窗映着街灯，主角抬头看向镜头。', 170),
      txtNode('s-alt', '备用分镜文案_最终确认版', '镜头缓慢拉远，画面淡出。', 320),
      audNode('s-aud', '11月23日_产品口播配音_最终版.wav', 470),
      {
        id: 'target-strip', type: 'material', position: { x: 420, y: 140 },
        data: {
          label: 'Wan 3.0 全能参考', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
          status: 'empty', prompt: '', inputBindingVersion: 1, autoOperationId: null,
          params: { model: 'wan-3.0', operation: 'video_multi_ref', routing: { allowedGroups: ['wan-3.0-720p'] } },
          slotBindings: {
            reference_images: [{ edgeId: 'e-s-img', sourceNodeId: 's-img', role: 'reference', pinned: true, ordinal: 0 }],
            reference_audios: [{ edgeId: 'e-s-aud', sourceNodeId: 's-aud', role: 'reference', pinned: true, ordinal: 1 }],
            prompt: [{ edgeId: 'e-s-txt', sourceNodeId: 's-txt', role: 'prompt', pinned: true, ordinal: 2 }],
          },
        },
      },
    ],
    edges: [
      mkEdge('e-s-img', 's-img', 'target-strip'),
      mkEdge('e-s-txt', 's-txt', 'target-strip'),
      mkEdge('e-s-aud', 's-aud', 'target-strip'),
    ],
  });

  // Scenario 2: wan-3.0 first_frame (named), first_last_frame (pair), minimax-h3-video digital_human (named audio), text_to_video (unbound none)
  const layoutsWs = (await request('/api/workspaces', 'POST', { name: '多布局卡槽验收' })).workspace.id;
  workspaceIds.set('layouts', layoutsWs);
  await request(`/api/workspaces/${layoutsWs}`, 'PUT', {
    expectedVersion: 0,
    nodes: [
      imgNode('l-img1', '首帧图.png', 20),
      imgNode('l-img2', '尾帧图.png', 160),
      txtNode('l-txt', '核心文案槽位 (Copywriting)', '开场镜头由近及远。', 300),
      audNode('l-aud', '11月23日口播.wav', 440),
      {
        id: 'target-first', type: 'material', position: { x: 380, y: 20 },
        data: {
          label: 'Wan 3.0 首帧', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
          status: 'empty', prompt: '', inputBindingVersion: 1, autoOperationId: null,
          params: { model: 'wan-3.0', operation: 'first_frame', routing: { allowedGroups: ['wan-3.0-720p'] } },
          slotBindings: {
            first_frame: [{ edgeId: 'e-f-img', sourceNodeId: 'l-img1', role: 'first_frame', pinned: true }],
            prompt: [{ edgeId: 'e-f-txt', sourceNodeId: 'l-txt', role: 'prompt', pinned: true }],
          },
        },
      },
      {
        id: 'target-pair', type: 'material', position: { x: 760, y: 20 },
        data: {
          label: 'Wan 3.0 首尾帧', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
          status: 'empty', prompt: '', inputBindingVersion: 1, autoOperationId: null,
          params: { model: 'wan-3.0', operation: 'first_last_frame', routing: { allowedGroups: ['wan-3.0-720p'] } },
          slotBindings: {
            first_frame: [{ edgeId: 'e-p-1', sourceNodeId: 'l-img1', role: 'first_frame', pinned: true }],
            last_frame: [{ edgeId: 'e-p-2', sourceNodeId: 'l-img2', role: 'last_frame', pinned: true }],
            prompt: [{ edgeId: 'e-p-txt', sourceNodeId: 'l-txt', role: 'prompt', pinned: true }],
          },
        },
      },
      {
        id: 'target-dh', type: 'material', position: { x: 380, y: 320 },
        data: {
          label: 'H3 数字人', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
          status: 'empty', prompt: '', inputBindingVersion: 1, autoOperationId: null,
          params: { model: 'minimax-h3-video', operation: 'digital_human', routing: { allowedGroups: ['default'] } },
          slotBindings: {
            reference_image: [{ edgeId: 'e-dh-img', sourceNodeId: 'l-img1', role: 'reference', pinned: true }],
            reference_audio: [{ edgeId: 'e-dh-aud', sourceNodeId: 'l-aud', role: 'reference', pinned: true }],
          },
        },
      },
      {
        id: 'target-empty', type: 'material', position: { x: 760, y: 320 },
        data: {
          label: 'Wan 3.0 文生视频', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
          status: 'empty', prompt: '', inputBindingVersion: 1, autoOperationId: null,
          params: { model: 'wan-3.0', operation: 'text_to_video', routing: { allowedGroups: ['wan-3.0-720p'] } },
          slotBindings: {},
        },
      },
    ],
    edges: [
      mkEdge('e-f-img', 'l-img1', 'target-first'),
      mkEdge('e-f-txt', 'l-txt', 'target-first'),
      mkEdge('e-p-1', 'l-img1', 'target-pair'),
      mkEdge('e-p-2', 'l-img2', 'target-pair'),
      mkEdge('e-p-txt', 'l-txt', 'target-pair'),
      mkEdge('e-dh-img', 'l-img1', 'target-dh'),
      mkEdge('e-dh-aud', 'l-aud', 'target-dh'),
    ],
  });

  return {
    origin,
    async close() {
      dispose();
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}

async function driveBrowser(config) {
  const assert = (await import('node:assert/strict')).default;
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const task = await taskSpace(config.taskName);
  const page = task.page('p1');
  const report = { taskSpaceId: task.spaceId, taskSpaceName: task.name, strip: [], layouts: {} };

  function readPreviewColors(selector) {
    const portal = document.querySelector(selector);
    const card = portal.querySelector('.wf-slot-hover-preview__card');
    const ctx = document.createElement('canvas').getContext('2d');
    const channels = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data;
    };
    const lum = ([r, g, b]) => {
      const lin = (byte) => {
        const v = byte / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const surface = (el, textEl = el) => {
      const style = getComputedStyle(el);
      const ink = channels(getComputedStyle(textEl).color);
      const fill = channels(style.backgroundColor);
      const a = lum(ink), b = lum(fill);
      return {
        alpha: fill[3] / 255,
        textAlpha: ink[3] / 255,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        border: style.borderTopStyle,
      };
    };
    const titleEl = card.querySelector('.wf-slot-hover-preview__title');
    const bodyEl = card.querySelector('.wf-slot-hover-preview__media span');
    return {
      titleText: titleEl?.textContent?.trim() ?? '',
      bodyText: bodyEl?.textContent?.trim() ?? '',
      title: titleEl ? surface(card, titleEl) : null,
      card: bodyEl ? surface(card, bodyEl) : null,
      actions: [...portal.querySelectorAll('.wf-slot-well__replace-pill')].map((btn) => ({ label: btn.textContent.trim(), ...surface(btn) })),
    };
  }

  try {
    // 1. Strip mode (image + long text + long audio + append controls) in dark (1280) and light (760)
    const stripNode = '.react-flow__node[data-id="target-strip"]';
    const textTileSel = stripNode + ' [data-testid="wf-slot-wells"] [data-slot="prompt"][data-slot-edge="e-s-txt"]';
    const audioTileSel = stripNode + ' [data-testid="wf-slot-wells"] [data-slot="reference_audios"][data-slot-edge="e-s-aud"]';
    for (const [theme, width] of [['dark', 1280], ['light', 760]]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${config.origin}/?scenario=strip&theme=${theme}`);
      await page.waitForSelector('loc=css:' + stripNode + ' .wf-node-header', { timeout: 15000 });
      await page.click('loc=css:' + stripNode + ' .wf-node-header', { label: 'Open strip video node' });
      await page.waitForSelector('loc=css:' + textTileSel, { timeout: 8000 });
      await page.waitForSelector('loc=css:' + audioTileSel, { timeout: 8000 });
      const metrics = await page.evaluate((nodeSel) => {
        const panel = document.querySelector(nodeSel + '.selected .wf-config-panel');
        const wells = panel?.querySelector('[data-testid="wf-slot-wells"]');
        const children = wells ? [...wells.children] : [];
        const firstAdd = children.findIndex((el) => el.dataset.testid === 'wf-add-reference');
        const inspect = (sel) => {
          const well = wells?.querySelector(sel);
          const tile = well?.querySelector('.wf-slot-well__tile');
          const name = well?.querySelector('.wf-slot-well__tile-name');
          const wr = well?.getBoundingClientRect();
          const tr = tile?.getBoundingClientRect();
          const nr = name?.getBoundingClientRect();
          const tileBg = tile ? getComputedStyle(tile).backgroundColor : '';
          const probe = document.createElement('canvas').getContext('2d');
          probe.fillStyle = tileBg;
          probe.fillRect(0, 0, 1, 1);
          const tileAlpha = probe.getImageData(0, 0, 1, 1).data[3] / 255;
          return {
            index: children.indexOf(well),
            width: wr ? Math.round(wr.width) : 0,
            height: wr ? Math.round(wr.height) : 0,
            tileAlpha,
            nameText: name?.textContent?.trim() ?? '',
            nameHeight: nr ? Math.round(nr.height) : 0,
            truncated: Boolean(name && name.scrollWidth > name.clientWidth),
            clippedInside: Boolean(nr && tr && nr.left >= tr.left - 1 && nr.right <= tr.right + 1 && nr.bottom <= tr.bottom + 1),
            hasPositionOverlay: Boolean(well?.querySelector('.wf-slot-well__position')),
          };
        };
        return {
          legacyPromptRows: panel?.querySelectorAll('[data-testid="wf-prompt-references"]').length ?? -1,
          firstAdd,
          textTile: inspect('[data-slot="prompt"][data-slot-edge="e-s-txt"]'),
          audioTile: inspect('[data-slot="reference_audios"][data-slot-edge="e-s-aud"]'),
        };
      }, stripNode);

      assert.equal(metrics.legacyPromptRows, 0);
      assert.ok(metrics.firstAdd > 0);
      for (const tile of [metrics.textTile, metrics.audioTile]) {
        assert.equal(tile.width, 44);
        assert.equal(tile.height, 44);
        assert.ok(tile.tileAlpha > 0, `${theme} tile background must be visible (alpha=${tile.tileAlpha})`);
        assert.ok(tile.index >= 0 && tile.index < metrics.firstAdd);
        assert.ok(tile.nameHeight > 0 && tile.nameHeight <= 14);
        assert.equal(tile.truncated, true);
        assert.equal(tile.clippedInside, true);
        assert.equal(tile.hasPositionOverlay, false);
      }
      assert.equal(metrics.textTile.nameText, '核心文案槽位 (Copywriting)');
      assert.equal(metrics.audioTile.nameText, '11月23日_产品口播配音_最终版.wav');

      await page.hover('loc=css:' + textTileSel, { label: 'Hover text tile for preview' });
      await page.waitForSelector('loc=css:.wf-slot-hover-preview', { timeout: 6000 });
      const textPreview = await page.evaluate(readPreviewColors, '.wf-slot-hover-preview');
      assert.equal(textPreview.titleText, '核心文案槽位 (Copywriting)');
      assert.match(textPreview.bodyText, /雨后的橱窗映着街灯/);
      assert.deepEqual(textPreview.actions.map((a) => a.label), ['替换', '停用']);
      for (const s of [textPreview.title, textPreview.card, ...textPreview.actions]) {
        assert.equal(s.alpha, 1);
        assert.equal(s.textAlpha, 1);
        assert.ok(s.contrast >= 4.5, `${theme} contrast ${s.contrast.toFixed(2)}`);
      }
      await page.screenshot({ path: join(config.shotDir, `real-strip-text-preview-${theme}.png`) });

      await page.hover('loc=css:' + audioTileSel, { label: 'Hover audio tile for preview' });
      await page.waitForFunction(() => document.querySelector('.wf-slot-hover-preview__title')?.textContent?.trim() === '11月23日_产品口播配音_最终版.wav');
      const hasAudioEl = await page.evaluate(() => Boolean(document.querySelector('.wf-slot-hover-preview audio')));
      assert.equal(hasAudioEl, true);
      await page.screenshot({ path: join(config.shotDir, `real-strip-audio-preview-${theme}.png`) });
      report.strip.push({ theme, width, ...metrics, hasAudioEl });
    }

    // 2. Replace & disable text interaction on strip node
    await page.hover('loc=css:' + textTileSel, { label: 'Re-hover text tile before replace' });
    await page.waitForSelector('loc=css:.wf-slot-hover-preview button[aria-label="替换"]');
    await page.click('loc=css:.wf-slot-hover-preview button[aria-label="替换"]', { label: 'Open replace picker' });
    await page.waitForSelector('loc=css:.wf-picker-modal .wf-picker-card[aria-label="备用分镜文案_最终确认版"]');
    await page.click('loc=css:.wf-picker-modal .wf-picker-card[aria-label="备用分镜文案_最终确认版"]', { label: 'Choose replacement text' });
    await page.click('loc=css:.wf-picker-modal .wf-picker-btn--primary:not(:disabled)', { label: 'Confirm replacement' });
    const replacedTileSel = stripNode + ' [data-testid="wf-slot-wells"] [data-slot="prompt"][data-slot-edge]';
    await page.waitForFunction((sel) => document.querySelector(sel + ' .wf-slot-well__tile-name')?.textContent?.trim() === '备用分镜文案_最终确认版', replacedTileSel);
    await page.hover('loc=css:' + replacedTileSel, { label: 'Hover replaced text tile' });
    await page.click('loc=css:.wf-slot-hover-preview button:has-text("停用")', { label: 'Disable text source' });
    await page.waitForFunction((sel) => !document.querySelector(sel), replacedTileSel);
    report.replaceAndDisable = true;

    // 3. Multi-layout verification: named (first_frame), pair (first_last_frame), digital_human (named audio), unbound none (text_to_video)
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${config.origin}/?scenario=layouts&theme=dark`);

    await page.waitForSelector('loc=css:.react-flow__node[data-id="target-first"] .wf-node-header', { timeout: 15000 });
    await page.click('loc=css:.react-flow__node[data-id="target-first"] .wf-node-header', { label: 'Open first_frame node' });
    await page.waitForSelector('loc=css:.react-flow__node[data-id="target-first"] [data-slot="prompt"][data-slot-edge="e-f-txt"]');
    report.layouts.firstFrame = await page.evaluate(() => {
      const panel = document.querySelector('.react-flow__node[data-id="target-first"].selected .wf-config-panel');
      return {
        preset: panel?.querySelector('[data-testid="wf-slot-wells"]')?.dataset.preset,
        legacyRows: panel?.querySelectorAll('[data-testid="wf-prompt-references"]').length,
        hasFirstFrame: Boolean(panel?.querySelector('[data-slot="first_frame"][data-slot-edge="e-f-img"]')),
        textTileName: panel?.querySelector('[data-slot="prompt"] .wf-slot-well__tile-name')?.textContent?.trim(),
      };
    });
    assert.deepEqual(report.layouts.firstFrame, {
      preset: 'named', legacyRows: 0, hasFirstFrame: true, textTileName: '核心文案槽位 (Copywriting)',
    });
    await page.screenshot({ path: join(config.shotDir, 'real-first-frame-dark.png') });

    await page.click('loc=css:.react-flow__node[data-id="target-pair"] .wf-node-header', { label: 'Open first_last_frame pair node' });
    await page.waitForSelector('loc=css:.react-flow__node[data-id="target-pair"] .wf-slot-wells__swap');
    report.layouts.pair = await page.evaluate(() => {
      const panel = document.querySelector('.react-flow__node[data-id="target-pair"].selected .wf-config-panel');
      return {
        preset: panel?.querySelector('[data-testid="wf-slot-wells"]')?.dataset.preset,
        hasSwap: Boolean(panel?.querySelector('.wf-slot-wells__swap')),
        textTileName: panel?.querySelector('[data-slot="prompt"] .wf-slot-well__tile-name')?.textContent?.trim(),
      };
    });
    assert.deepEqual(report.layouts.pair, { preset: 'pair', hasSwap: true, textTileName: '核心文案槽位 (Copywriting)' });

    await page.click('loc=css:.react-flow__node[data-id="target-dh"] .wf-node-header', { label: 'Open digital_human node' });
    await page.waitForSelector('loc=css:.react-flow__node[data-id="target-dh"] [data-slot="reference_audio"] .wf-slot-well__tile-name');
    report.layouts.digitalHuman = await page.evaluate(() => {
      const panel = document.querySelector('.react-flow__node[data-id="target-dh"].selected .wf-config-panel');
      const audioWell = panel?.querySelector('[data-slot="reference_audio"]');
      return {
        audioName: audioWell?.querySelector('.wf-slot-well__tile-name')?.textContent?.trim(),
        hasPositionOverlay: Boolean(audioWell?.querySelector('.wf-slot-well__position')),
      };
    });
    assert.deepEqual(report.layouts.digitalHuman, { audioName: '11月23日口播.wav', hasPositionOverlay: false });

    await page.click('loc=css:.react-flow__node[data-id="target-empty"] .wf-node-header', { label: 'Open unbound text_to_video node' });
    await page.waitForSelector('loc=css:.react-flow__node[data-id="target-empty"].selected .wf-config-panel');
    report.layouts.unbound = await page.evaluate(() => {
      const panel = document.querySelector('.react-flow__node[data-id="target-empty"].selected .wf-config-panel');
      return {
        hasEmptyHeader: Boolean(panel?.querySelector('.wf-config-panel__prompt-header--empty-slots')),
        wellsCount: panel?.querySelectorAll('[data-testid="wf-slot-wells"], [data-testid="wf-prompt-references"]').length,
      };
    });
    assert.deepEqual(report.layouts.unbound, { hasEmptyHeader: true, wellsCount: 0 });
  } finally {
    await writeFile(join(config.run, 'report.json'), JSON.stringify(report, null, 2));
    await task.finish({ keep: [] });
  }
}

test('Issue #339: unified text and audio slot wells render in top material bar across presets and themes', { timeout: 120000 }, async () => {
  const run = await mkdtemp(join(tmpdir(), 'omnimux-issue339-e2e-'));
  const shotDir = process.env.OMNIMUX_E2E_SHOT_DIR || run;
  await mkdir(shotDir, { recursive: true });
  for (const entry of ['scripts/build-host.mjs', 'scripts/build-canvas.mjs']) {
    execFileSync(process.execPath, [entry], { cwd: plugin, stdio: 'inherit' });
  }
  const canvasBundle = await readFile(join(plugin, 'lib/canvas.js'));
  const themeCss = await loadVendoredTheme();
  const fixture = await mountServer(run, canvasBundle, themeCss);
  try {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
    const completed = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`ego-browser exited with ${signal ?? code}`))));
    });
    child.stdin.on('error', (err) => { if (err.code !== 'EPIPE') child.emit('error', err); });
    const config = { origin: fixture.origin, run, shotDir, taskName: 'Issue 339 Slot Wells QA ' + randomUUID().slice(0, 8) };
    child.stdin.end(`const driveBrowser = ${driveBrowser.toString()}; await driveBrowser(${JSON.stringify(config)});`);
    await completed;
  } finally {
    await fixture.close();
    await rm(run, { recursive: true, force: true });
  }
});
